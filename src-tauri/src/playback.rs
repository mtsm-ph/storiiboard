//! Playback copies (Phase 2.3): the app never plays an original (CLAUDE.md). ffmpeg makes an H.264 MP4 of each linked
//! video with the computer's own encoder, at most 1920 px on the long edge, at a constant rate, with a keyframe every
//! 12 frames so stepping and scrubbing land fast; frame 0 is the video stream's first frame, as stills count it.
//!
//! The copies live in a folder of the app's own, `Storiiboard Playback Copies`, on this computer (never in the .sbd,
//! never synced): in the app's cache folder, or on a drive the person picks. Rust alone knows where it is and deletes
//! only files it named there, so the page can never point a Clear or the cap at anything else. A copy is written as
//! `.partial` and renamed only once it's checked whole (the original unchanged, nothing read wrong, its length and
//! sound all there), so a crash, a kill, a Cancel or a card pulled midway never leaves a copy that looks done. The
//! folder is kept under a cap (about 50 GB by default), the copies used longest ago going first, and never leaves its
//! drive with less than a floor free (10 GB by default; D2).

use std::cell::Cell;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, RwLock, RwLockReadGuard, TryLockError};
use std::time::{Duration, Instant, SystemTime};

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::os;
use crate::video::{self, Access};

/// The folder of copies, inside the cache folder or a folder the person picks.
pub const FOLDER_NAME: &str = "Storiiboard Playback Copies";
/// Changes when the way copies are made changes, so older copies are made again rather than played. 2.3-2: HDR
/// tone-mapped (D1). 2.3-3: separate mono tracks mixed (2.3b). 2.3-4: silent ones left out of the mix (2.3c).
const RECIPE: &str = "2.3-4";
/// The long edge of a copy, at most.
const LONG_EDGE: u32 = 1920;
const DEFAULT_CAP_GB: u64 = 50;
/// The free space copies always leave on their drive, unless the person changes it (Settings, Storage): a copy that
/// would take the drive below it makes room by removing the copies used longest ago, or isn't made.
const DEFAULT_FLOOR_GB: u64 = 10;
const GB: u64 = 1_000_000_000;
/// About what a copy takes a second, for the room it needs before it starts: 12 Mb/s of picture and 160 kb/s of
/// sound, rounded up.
const BYTES_A_SECOND: u64 = 1_600_000;
/// How often the free space is read while a copy is made, on a thread of its own: a drive that stopped answering never
/// holds up the encode's watch.
const SPACE_TICK: Duration = Duration::from_secs(2);
/// An encode that moves no further for this long has stalled (a read stuck on a share that stopped answering, an
/// encoder hung in its driver) and is stopped. ffmpeg 8 writes its progress every half second whether anything moved
/// or not, so only a count that goes up (frames, bytes written, time reached) is word that it's working. Nothing in a
/// copy keeps it still for long while it works: there's no index pass at the end (`+faststart` isn't used, as a local
/// file plays as well with its index last, and that pass rewrote the whole copy without a word).
const STALL: Duration = Duration::from_secs(90);
/// How long a stopped ffmpeg is given to end. A read stuck on a share that stopped answering can hold a kill back until
/// it returns; past this the copy fails anyway and the next one starts, and the old ffmpeg is waited for on its own.
const KILL_GRACE: Duration = Duration::from_secs(10);
/// How often an encode looks at its ffmpeg, its progress and a Cancel.
const TICK: Duration = Duration::from_millis(100);
/// A tick that comes this late means the computer slept (Windows' clock goes on counting through sleep): the time
/// ffmpeg was quiet starts over, so a copy isn't taken for stalled when the lid opens.
const SLEPT: Duration = Duration::from_secs(5);

const CANCELLED: &str = "The playback copy was cancelled.";
const FAILED: &str = "That video couldn't be made into a playback copy.";
const SHORT: &str =
    "The playback copy came out shorter than the video. If it's on a card or a drive, check it's still connected.";
const STALLED: &str = "That video stopped being read partway. If it's on a card, a drive or a network share, check it's still connected.";
const UNWRITABLE: &str = "Playback copies can't be written in that folder.";
const MOVING: &str = "The playback copies are being moved; try again once that's done.";
const UNSAVED: &str = "The settings for playback copies couldn't be saved.";
const A_COPY: &str =
    "That file is one of Storiiboard's playback copies. Link the original video instead.";
const NO_ROOM: &str = "There isn't enough free space on that drive for the playback copy. Storiiboard always leaves some free there (Settings, Storage): free some space, or move the copies to another drive.";
const NO_ROOM_THERE: &str = "That drive has less free space than Storiiboard leaves for playback copies (Settings, Storage). The copies stayed where they were.";
const NO_ROOM_TO_MOVE: &str = "Not every playback copy fit on that drive with the free space Storiiboard leaves there. The rest stayed where they were, and still play.";
const FLOOR_RANGE: &str = "The free space to leave for playback copies is between 1 and 1,000 GB.";

/// What Rust keeps about the cache, in the app's data folder; the page never writes it. Every field has a default, so a
/// file from another version still reads.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Settings {
    /// The folder the person picked, which holds `FOLDER_NAME`; none for the cache folder.
    root: Option<PathBuf>,
    cap_gb: u64,
    /// The free space copies always leave on their drive (D2; files from before it take the default).
    floor_gb: u64,
    /// Folders of copies a Move left behind (cut short by a crash, a drive unplugged, copies that couldn't go): still
    /// counted, found, capped and cleared, and moved along with the next Move, so none sits where the app no longer
    /// looks.
    leftovers: Vec<PathBuf>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            root: None,
            cap_gb: DEFAULT_CAP_GB,
            floor_gb: DEFAULT_FLOOR_GB,
            leftovers: Vec::new(),
        }
    }
}

/// One request for a copy, from the moment it's asked: Cancel reaches it while the original is checked, while it waits
/// its turn, while the original is read, and once ffmpeg runs. A video can have several at once (two frames linking it,
/// the queue and the Player both asking, React's development double run), each with its own entry.
struct Job {
    id: u64,
    child: Option<Arc<Mutex<Child>>>,
    cancelled: Arc<AtomicBool>,
}

type Jobs = Arc<Mutex<HashMap<String, Vec<Job>>>>;

/// A request on the list. It owns what it needs, so a Tauri command can put it there before it reads anything; it comes
/// off the list when dropped, however the make ends, and the video's other requests stay.
pub struct Asked {
    jobs: Jobs,
    name: String,
    id: u64,
    cancelled: Arc<AtomicBool>,
}

impl Asked {
    fn stopped(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    /// Hands the request its ffmpeg, so a Cancel can kill it. A Cancel (or the app quitting) that came just before is
    /// honoured at once.
    fn running(&self, child: &Arc<Mutex<Child>>) {
        if let Some(job) = lock(&self.jobs)
            .get_mut(&self.name)
            .and_then(|list| list.iter_mut().find(|job| job.id == self.id))
        {
            job.child = Some(Arc::clone(child));
        }
        if self.stopped() {
            let _ = lock(child).kill();
        }
    }
}

impl Drop for Asked {
    fn drop(&mut self) {
        let mut jobs = lock(&self.jobs);
        if let Some(list) = jobs.get_mut(&self.name) {
            list.retain(|job| job.id != self.id);
            if list.is_empty() {
                jobs.remove(&self.name);
            }
        }
    }
}

/// How many bytes a drive has free, by a folder on it; none when it can't be told (`os::free_bytes`). Tests stand in
/// for a drive with one of their own.
type FreeSpace = Arc<dyn Fn(&Path) -> Option<u64> + Send + Sync>;

/// The encodes' ffmpeg processes while each runs, by id and start (`os::started`), in a file beside the settings, on a
/// Mac (and Linux, for the tests). Windows' Job Object ends them with the app (`os::keep_with_app`); here a crash or a
/// Force Quit would leave one writing a copy nobody keeps until it ends. The file outlives the crash, and the next
/// start stops any that is still that same process (`load`), wherever the app ran from then and runs from now.
#[cfg(unix)]
struct Running {
    file: Option<PathBuf>,
    pids: Mutex<Vec<(u32, u64)>>,
}

#[cfg(unix)]
impl Running {
    /// The list an earlier run left: any of its ffmpegs still running are stopped, and the list starts over.
    fn load(file: Option<PathBuf>) -> Self {
        if let Some(text) = file.as_deref().and_then(|f| fs::read_to_string(f).ok()) {
            for line in text.lines() {
                let mut numbers = line.split_whitespace().map(str::parse::<u64>);
                if let (Some(Ok(pid)), Some(Ok(started))) = (numbers.next(), numbers.next()) {
                    if let Ok(pid) = u32::try_from(pid) {
                        if os::is_same(pid, started) {
                            os::kill(pid);
                        }
                    }
                }
            }
        }
        let running = Self {
            file,
            pids: Mutex::new(Vec::new()),
        };
        running.write(&[]);
        running
    }

    fn write(&self, pids: &[(u32, u64)]) {
        if let Some(file) = &self.file {
            let text: String = pids
                .iter()
                .map(|(pid, started)| format!("{pid} {started}\n"))
                .collect();
            let _ = write_atomically(file, text.as_bytes());
        }
    }

    /// Kept from just after it starts; one that has ended already has nothing to stop.
    fn add(&self, pid: u32) {
        if let Some(started) = os::started(pid) {
            let mut pids = lock(&self.pids);
            pids.push((pid, started));
            self.write(&pids);
        }
    }

    fn remove(&self, pid: u32) {
        let mut pids = lock(&self.pids);
        pids.retain(|&(p, _)| p != pid);
        self.write(&pids);
    }
}

pub struct PlaybackCache {
    settings_file: Option<PathBuf>,
    default_root: PathBuf,
    /// Held across each change written to the file, so two changes at once never mix.
    settings: Mutex<Settings>,
    /// By the original's path as the page names it, every request for it; Cancel stops them all.
    jobs: Jobs,
    next_job: AtomicU64,
    /// One copy at a time: a hardware encoder is shared, and the drive is too. A Move and the start-up clean-up take it
    /// too, so neither touches a copy being made.
    turn: Mutex<()>,
    /// Where the copies are: a Move holds it to write for as long as it runs; finding, Clear and the cap hold it to
    /// read, and don't wait for a Move (where a copy is can't be told until it's done).
    layout: RwLock<()>,
    /// The settings file was there but couldn't be read (or set aside): a Move, which this run couldn't remember, is
    /// refused.
    unsaved: bool,
    /// The app is quitting: no new ffmpeg starts.
    quitting: AtomicBool,
    /// Copies made without sound whose sound was found unreadable in this run (by key): played as they are. In a
    /// later run the sound is tried once more, so a fix (a newer app, the file replaced) brings it back.
    checked_silent: Mutex<HashSet<String>>,
    /// The encoders to try, in order.
    encoders: Vec<Vec<&'static str>>,
    /// See `STALL`; shorter in tests.
    stall: Duration,
    /// See `FreeSpace`.
    free: FreeSpace,
    /// See `Held`.
    held: Held,
    /// See `SPACE_TICK`; shorter in tests.
    space_tick: Duration,
    /// Moves copy every file, as across drives; tests only.
    #[cfg(test)]
    copy_moves: bool,
    /// See `Running`.
    #[cfg(unix)]
    running: Arc<Running>,
    /// Extra environment for ffmpeg as it encodes; tests only (a shim that makes reads fail or hang as a pulled card or
    /// a dead share does).
    #[cfg(test)]
    encode_env: Vec<(String, String)>,
    /// How many times ffmpeg was started to encode; tests only.
    #[cfg(test)]
    attempts: AtomicU64,
}

/// A lock that a panic elsewhere doesn't make unusable: what's guarded stays valid (a map, a unit).
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Writes a small file whole: to a new file, flushed to the disk, then renamed over the old one, so a crash or a
/// power cut leaves the old file or the new one, never half of either.
pub(crate) fn write_atomically(file: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir)?;
    }
    let partial = file.with_extension("partial");
    let mut out = fs::File::create(&partial)?;
    std::io::Write::write_all(&mut out, bytes)?;
    out.sync_all()?;
    drop(out);
    fs::rename(&partial, file)
}

/// FNV-1a over the bytes, twice with different starts: a stable 128-bit name for a copy (Rust's own hasher may change
/// between versions, which would orphan every copy after an update).
fn fnv128(bytes: &[u8]) -> String {
    let hash = |mut h: u64| {
        for &b in bytes {
            h ^= u64::from(b);
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
        h
    };
    format!(
        "{:016x}{:016x}",
        hash(0xcbf2_9ce4_8422_2325),
        hash(0x6c62_272e_07bb_0142)
    )
}

/// A copy's name: the original's path, size and modified time, and the recipe. A file changed or replaced gets a new
/// copy; the old one ages out under the cap. The time counts in two-second steps: a network share can report a file's
/// time finer one moment and coarser the next (to the second, or to FAT's two seconds), and the same file must keep its
/// copy.
pub fn key_of(path: &Path, lut: Option<&str>) -> Result<String, String> {
    let meta = fs::metadata(path).map_err(|_| "That file isn't there any more.".to_string())?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs() & !1);
    let mut text = format!(
        "{RECIPE}\0{}\0{}\0{modified}",
        path.to_string_lossy(),
        meta.len()
    );
    // A LUT joins the key (2.5): the same take under another LUT, or none, is another copy. Without one, the key is
    // what it was before LUTs, so no copy made earlier is made again.
    if let Some(sha256) = lut {
        text.push_str("\0lut\0");
        text.push_str(sha256);
    }
    Ok(fnv128(text.as_bytes()))
}

/// A LUT for a video's copy (2.5): the `.cube` text, and the SHA-256 the project stores it by (docs/SBD_FORMAT.md,
/// `luts`), which names it in the copy's key. Applied to the copy only, never the original.
#[derive(Clone, Debug, serde::Deserialize)]
pub struct Lut {
    pub sha256: String,
    pub cube: String,
}

/// Whether `sha256` reads as the hex SHA-256 the project names a LUT by.
pub fn is_lut_name(sha256: &str) -> bool {
    sha256.len() == 64
        && sha256
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

/// The name a request for a video's copy goes by on the list, where Cancel finds it: its path, and its LUT's SHA-256
/// when it has one, so the same file under two LUTs (two frames of one take, graded apart) is two requests.
pub fn job_name(path: &str, lut: Option<&str>) -> String {
    match lut {
        Some(sha256) => format!("{path}\0{sha256}"),
        None => path.to_owned(),
    }
}

/// The `.cube` a copy is made with, in a folder of its own for the one encode, gone when it is: ffmpeg runs in that
/// folder and names the file alone, so no path needs escaping in its filter.
pub(crate) struct LutFile {
    pub(crate) folder: PathBuf,
}

/// The file's name inside its folder.
pub(crate) const LUT_FILE: &str = "grade.cube";

impl LutFile {
    /// A folder no one can have made ahead of it: a random name, made new (never one already there, which on a
    /// computer several people share could be someone else's, or lead elsewhere), and the file made new in it.
    pub(crate) fn write(lut: &Lut) -> Result<Self, String> {
        let folder =
            std::env::temp_dir().join(format!("storiiboard-lut-{}", crate::lock::random_id()));
        fs::create_dir(&folder).map_err(|_| FAILED.to_string())?;
        let file = Self { folder };
        let mut out = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(file.folder.join(LUT_FILE))
            .map_err(|_| FAILED.to_string())?;
        std::io::Write::write_all(&mut out, lut.cube.as_bytes()).map_err(|_| FAILED.to_string())?;
        Ok(file)
    }
}

impl Drop for LutFile {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.folder);
    }
}

/// The file name of a finished copy. One made without sound has a name of its own, so it's never taken for a whole one.
fn file_name(key: &str, silent: bool) -> String {
    if silent {
        format!("{key}-silent.mp4")
    } else {
        format!("{key}.mp4")
    }
}

/// The file name of a copy without sound because every one of the original's sound tracks is silent (2.3c): whole as it
/// is, nothing to try again, and the app says why.
fn quiet_name(key: &str) -> String {
    format!("{key}-quiet.mp4")
}

/// A file of ours in the folder, by its name: a finished copy (`<key>.mp4`, `<key>-silent.mp4` without sound, or
/// `<key>-quiet.mp4` without sound as every track is silent), or
/// one being made (`.partial` after either, or `<key>-<request>-<attempt>.mp4.partial`, each attempt its own).
#[derive(Debug, PartialEq)]
struct Ours<'a> {
    key: &'a str,
    silent: bool,
    partial: bool,
}

fn ours(name: &str) -> Option<Ours<'_>> {
    let (stem, partial) = match name.strip_suffix(".partial") {
        Some(stem) => (stem, true),
        None => (name, false),
    };
    let stem = stem.strip_suffix(".mp4")?;
    let key = stem.get(..32)?;
    if !key
        .bytes()
        .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return None;
    }
    let silent = match &stem[32..] {
        "" => false,
        "-silent" | "-quiet" => true,
        attempt
            if partial
                && attempt.len() > 1
                && attempt.starts_with('-')
                && attempt[1..]
                    .bytes()
                    .all(|b| b.is_ascii_digit() || b == b'-') =>
        {
            false
        }
        _ => return None,
    };
    Some(Ours {
        key,
        silent,
        partial,
    })
}

/// A finished copy in a folder.
struct Stored {
    path: PathBuf,
    bytes: u64,
    used: SystemTime,
}

/// The finished copies in a folder; none when the folder can't be read (a drive unplugged, a share gone).
fn listed(folder: &Path) -> Option<Vec<Stored>> {
    let entries = fs::read_dir(folder).ok()?;
    Some(
        entries
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let name = entry.file_name();
                let found = ours(name.to_str()?)?;
                let meta = entry.metadata().ok().filter(fs::Metadata::is_file)?;
                (!found.partial).then(|| Stored {
                    path: entry.path(),
                    bytes: meta.len(),
                    used: meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                })
            })
            .collect(),
    )
}

fn copies(folder: &Path) -> Vec<Stored> {
    listed(folder).unwrap_or_default()
}

/// Deletes the half copies in a folder: never played, and never left to take space.
fn delete_partials(folder: &Path) {
    for entry in fs::read_dir(folder).into_iter().flatten().flatten() {
        if entry
            .file_name()
            .to_str()
            .and_then(ours)
            .is_some_and(|found| found.partial)
        {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// Marks a copy as just used: the cap removes the copies used longest ago. Opened for its times only, not its data,
/// so a virus scanner doesn't read a whole copy again each time.
fn touch(path: &Path) {
    let mut options = fs::File::options();
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_WRITE_ATTRIBUTES: u32 = 0x0100;
        options.access_mode(FILE_WRITE_ATTRIBUTES);
    }
    #[cfg(not(windows))]
    options.write(true);
    if let Ok(file) = options.open(path) {
        let _ = file.set_modified(SystemTime::now());
    }
}

/// The encoders to try, in order, each with the pixel format it takes: the computer's own hardware first, then its
/// software encoder where one can stand in. Linux builds only for the tests, with no H.264 encoder in an LGPL build, so
/// it makes MPEG-4 there.
pub(crate) fn encoders() -> Vec<Vec<&'static str>> {
    #[cfg(target_os = "macos")]
    return vec![vec![
        "-c:v",
        "h264_videotoolbox",
        "-allow_sw",
        "1",
        "-b:v",
        "12M",
        "-pix_fmt",
        "yuv420p",
    ]];
    // NV12, the format hardware H.264 encoders take (most list no other; Microsoft's software one takes it too). High
    // profile, as Media Foundation otherwise makes Baseline, larger for the same picture: as a number (FFmpeg's
    // AV_PROFILE_H264_HIGH), since h264_mf knows no profile names. The bitrate is set too: a
    // hardware encoder that ignores the quality mode falls back to it, not to 200 kb/s.
    #[cfg(windows)]
    return vec![
        vec![
            "-c:v",
            "h264_mf",
            "-hw_encoding",
            "1",
            "-rate_control",
            "quality",
            "-quality",
            "70",
            "-b:v",
            "12M",
            "-profile:v",
            "100",
            "-pix_fmt",
            "nv12",
        ],
        vec![
            "-c:v",
            "h264_mf",
            "-hw_encoding",
            "0",
            "-rate_control",
            "quality",
            "-quality",
            "70",
            "-b:v",
            "12M",
            "-profile:v",
            "100",
            "-pix_fmt",
            "nv12",
        ],
    ];
    #[cfg(not(any(windows, target_os = "macos")))]
    return vec![vec!["-c:v", "mpeg4", "-q:v", "3", "-pix_fmt", "yuv420p"]];
}

/// Deletes the copies in `folders` used longest ago until they come to `cap` bytes or less; never `keep`, the copy
/// just made (by its name, which is its key, so another spelling of its folder can't count it twice).
fn keep_under(folders: &[PathBuf], keep: &Path, cap: u64) {
    let mut all: Vec<Stored> = folders.iter().flat_map(|f| copies(f)).collect();
    let mut total: u64 = all.iter().map(|c| c.bytes).sum();
    all.sort_by_key(|c| c.used);
    for copy in all {
        if total <= cap {
            break;
        }
        if keep.file_name().is_some() && copy.path.file_name() == keep.file_name() {
            continue;
        }
        if fs::remove_file(&copy.path).is_ok() {
            total = total.saturating_sub(copy.bytes);
        }
    }
}

/// The copies in `folder` that may go to make room, the ones used longest ago first: never `key`'s own (one made
/// without sound may be all there is to play), never a half copy.
fn others(folder: &Path, key: &str) -> Vec<Stored> {
    let mut all: Vec<Stored> = copies(folder)
        .into_iter()
        .filter(|copy| {
            copy.path
                .file_name()
                .and_then(|name| name.to_str())
                .and_then(ours)
                .is_some_and(|found| found.key != key)
        })
        .collect();
    all.sort_by_key(|copy| copy.used);
    all
}

/// Drives that kept the space of a copy removed to make room (a Time Machine snapshot, a share's recycle bin), by the
/// folder copies go to: nothing more goes there for room until the drive reads at least the free space given here
/// (what it had then, the space a refusal itself gave back, and half the removed copy: its space really came back), or
/// `HELD_FOR` has passed, or the floor or the folder changed. So a run of refused copies never empties the folder one
/// copy at a time.
type Held = Mutex<HashMap<PathBuf, (u64, Instant)>>;
// (The Instant is when the drive is forgotten: added to, never taken from, as Windows' clock starts at boot.)

/// How long a drive stays remembered as keeping removed copies' space before one more removal is tried there.
const HELD_FOR: Duration = Duration::from_secs(30 * 60);

/// How many times, a tenth of a second apart, the drive is read after a copy is removed before it's taken that the
/// space didn't come back: a NAS (btrfs or ZFS over SMB) can report it a moment late. One that reports it later still
/// is remembered (`Held`) and forgotten once its reading shows the space.
const SETTLE_READS: u32 = 10;
const SETTLE_TICK: Duration = Duration::from_millis(100);

/// The drive that holds a folder of copies, as room is made on it. Only a make makes room, before its copy starts and
/// once its copy is whole, on its own thread and in its turn, so two never make room at once.
struct Drive<'a> {
    free: &'a FreeSpace,
    held: &'a Held,
    folder: &'a Path,
}

impl Drive<'_> {
    /// Brings the drive back to `wanted` bytes free if the copies in the folder can, and says whether it is. Any go only
    /// when all of them together could make it, so none is lost for a copy that can't be made; then one at a time, the
    /// one used longest ago first, the drive read just before and after each, as it's the judge. One that can't be
    /// removed (held by another program) is passed over while the rest can still make it; one whose space doesn't come
    /// back stops the rest going, and the drive is remembered (`Held`), counting `refused_frees`, what a refusal will
    /// itself give back (a finished copy that isn't kept). A drive whose free space can't be told is taken as having
    /// room.
    fn room_for(&self, key: &str, wanted: u64, refused_frees: u64) -> bool {
        let read = || (self.free)(self.folder);
        let Some(now) = read() else {
            return true;
        };
        {
            let mut held = lock(self.held);
            if let Some(&(until, forget_at)) = held.get(self.folder) {
                if now >= until || Instant::now() >= forget_at {
                    held.remove(self.folder);
                } else if now < wanted {
                    return false;
                }
            }
        }
        if now >= wanted {
            return true;
        }
        let others = others(self.folder, key);
        let mut could = others
            .iter()
            .map(|copy| copy.bytes)
            .fold(0u64, u64::saturating_add);
        if could < wanted - now {
            return false;
        }
        for copy in others {
            let Some(before) = read() else {
                return true;
            };
            could = could.saturating_sub(copy.bytes);
            if fs::remove_file(&copy.path).is_err() {
                // Held by another program, or gone already (a Clear): what's left must still make it.
                if could < wanted.saturating_sub(before) {
                    return false;
                }
                continue;
            }
            let (mut after, mut freed) = (before, 0);
            for reading in 1..=SETTLE_READS {
                let Some(now) = read() else {
                    return true;
                };
                after = now;
                freed = after.saturating_sub(before);
                if freed >= copy.bytes / 2 || after >= wanted || reading == SETTLE_READS {
                    break;
                }
                std::thread::sleep(SETTLE_TICK);
            }
            if after >= wanted {
                lock(self.held).remove(self.folder);
                return true;
            }
            if freed < copy.bytes / 2 {
                let until = after
                    .saturating_add(refused_frees)
                    .saturating_add(copy.bytes / 2);
                lock(self.held).insert(
                    self.folder.to_path_buf(),
                    (until, Instant::now() + HELD_FOR),
                );
                return false;
            }
            if could < wanted - after {
                return false;
            }
        }
        read().is_none_or(|now| now >= wanted)
    }
}

/// A folder as the file system knows it, so two spellings of one (a link, a different case) count once.
fn real(folder: &Path) -> PathBuf {
    folder
        .canonicalize()
        .unwrap_or_else(|_| folder.to_path_buf())
}

/// What ffmpeg said on its error output while it made a copy.
#[derive(Debug, Default, Clone, Copy, PartialEq)]
struct Said {
    /// Reading the original failed partway (a card pulled, a share gone): ffmpeg then ends as if the file had ended,
    /// and exits as if all went well.
    read_failed: bool,
    /// The original's data stopped making sense partway: a file cut short, or only a damaged tail.
    damaged: bool,
    /// Where a MOV's next piece couldn't be reached ("partial file"), the earliest: past the file's end it's a file cut
    /// short; inside it, the read failed.
    partial_at: Option<u64>,
}

impl Said {
    /// One line of ffmpeg 8's error output. A failed read is "Error during demuxing: <reason>"
    /// (fftools/ffmpeg_demux.c), where undecodable data has its own reason and every other one is the drive or the
    /// share. A MOV whose next piece couldn't be reached says "stream N, offset 0x…: partial file"
    /// (libavformat/mov.c), and a read that failed can end as a plain end of file with only that said.
    fn hear(&mut self, line: &str) {
        let line = line.trim_end();
        if let Some((_, reason)) = line.split_once("Error during demuxing: ") {
            if reason.starts_with("Invalid data found") {
                self.damaged = true;
            } else {
                self.read_failed = true;
            }
        } else if line.starts_with("[in#") && line.ends_with(": partial file") {
            let at = line
                .rsplit_once("offset 0x")
                .and_then(|(_, rest)| rest.split(':').next())
                .and_then(|hex| u64::from_str_radix(hex, 16).ok())
                .unwrap_or(0);
            self.partial_at = Some(self.partial_at.map_or(at, |earlier| earlier.min(at)));
        }
    }

    /// Settles what "partial file" meant, by the original's size now: a piece past its end is a file cut short (the
    /// length check decides), one inside it a read that failed (a drive that dropped and came back).
    fn settle(mut self, original: &Path) -> Self {
        if let Some(at) = self.partial_at {
            match fs::metadata(original) {
                Ok(meta) if at >= meta.len() => self.damaged = true,
                _ => self.read_failed = true,
            }
        }
        self
    }
}

/// Whether a copy is whole: nothing failed to read, sound where it was made with sound, and no shorter than the
/// original by more than a second or one frame in a hundred (a header's length can be a little off; a longer copy only
/// means the header said too little). With the original's length unknown (some WebM and MKV files don't say), only
/// ffmpeg's own word can tell a cut.
fn complete(original: &video::Probe, with_sound: bool, copy: &video::Probe, said: Said) -> bool {
    if said.read_failed || (with_sound && !copy.has_audio) {
        return false;
    }
    if original.duration_frames == 0 {
        return !said.damaged;
    }
    let second = u64::from(original.fps_num).div_ceil(u64::from(original.fps_den.max(1)));
    let slack = (original.duration_frames / 100).max(second).max(2);
    copy.duration_frames + slack >= original.duration_frames
}

/// Moves one copy into another folder: a rename on the same drive; across drives, a copy written as `.partial`,
/// flushed to the disk and renamed, before the old one goes, if `room` says the drive has room for its bytes. A copy
/// that can't be moved (no room, the new drive full or gone) stays where it was, and its folder stays on the list the
/// app looks in. Whether it moved.
fn move_one(from: &Path, to: &Path, force_copy: bool, room: impl Fn(u64) -> bool) -> bool {
    if !force_copy && fs::rename(from, to).is_ok() {
        return true;
    }
    if !fs::metadata(from).is_ok_and(|meta| room(meta.len())) {
        return false;
    }
    let partial = to.with_extension("mp4.partial");
    let copied = fs::copy(from, &partial)
        // Opened for writing: Windows flushes only a file it may write.
        .and_then(|_| fs::File::options().write(true).open(&partial)?.sync_all())
        .and_then(|()| fs::rename(&partial, to));
    let _ = fs::remove_file(&partial);
    // A source that won't go (held by another program) leaves the copy in both places: not a move.
    copied.is_ok() && fs::remove_file(from).is_ok()
}

/// What a copy being made reports: how far along, 0 to 1. It can step back, when a hardware encoder gives way to the
/// software one, or when a copy stopped at the floor starts again once older copies made room for it. A video whose length isn't known reports only the end.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct Progress {
    pub done: f64,
}

/// A finished copy: where it is, and whether it was made without sound because the original's sound couldn't be read
/// (`silent`), or, also `quiet`, because every one of its sound tracks is silent (the app says which).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Made {
    pub path: PathBuf,
    pub silent: bool,
    pub quiet: bool,
}

/// `Made`, for the page.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MadeCopy {
    pub path: String,
    pub silent: bool,
    pub quiet: bool,
}

impl From<Made> for MadeCopy {
    fn from(made: Made) -> Self {
        Self {
            path: made.path.to_string_lossy().into_owned(),
            silent: made.silent,
            quiet: made.quiet,
        }
    }
}

/// The cache folder as it is now.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheInfo {
    pub folder: String,
    /// All the copies the cache keeps, including any made in the cache folder while a picked drive was away.
    pub bytes: u64,
    pub copies: usize,
    pub cap_gb: u64,
    /// The free space copies leave on their drive.
    pub floor_gb: u64,
    /// What the drive where copies go now has free; none when it can't be told.
    pub free_bytes: Option<u64>,
    /// The picked drive isn't there (unplugged): copies go to the cache folder until it's back.
    pub fallback: bool,
    /// The copies were moved to a folder the person picked, so they can be moved back (2.3b).
    pub moved: bool,
    /// A copy is being made, or waiting its turn.
    pub busy: bool,
}

/// Why an encode didn't give a copy.
#[derive(Debug, PartialEq)]
enum Stop {
    Cancelled,
    /// ffmpeg moved no further for `stall`.
    Stalled,
    /// The drive came down to the floor while the copy was made (the watch removes nothing for it).
    NoRoom,
    /// ffmpeg ended with an error.
    Failed(Said),
    /// ffmpeg couldn't start.
    Unstarted(String),
}

impl Stop {
    fn message(self) -> String {
        match self {
            Self::Cancelled => CANCELLED.into(),
            Self::Stalled => STALLED.into(),
            Self::NoRoom => NO_ROOM.into(),
            Self::Failed(said) if said.read_failed => SHORT.into(),
            Self::Failed(_) => FAILED.into(),
            Self::Unstarted(message) => message,
        }
    }
}

/// The values in ffmpeg's progress that go up as it works.
const MOVING_ON: [&str; 3] = ["frame=", "total_size=", "out_time_us="];

impl PlaybackCache {
    /// The cache as this computer left it. A settings file that can't be read is never written over: one that doesn't
    /// parse (a later version's, or damaged) is set aside as `playback.json.unreadable` and the defaults start a new
    /// one; one that's there but can't be read now (held by another program), or can't be set aside, leaves this
    /// session's changes in memory, and a Move is refused, since its new place would be forgotten.
    pub fn load(data_dir: &Path, cache_dir: &Path) -> Self {
        let file = data_dir.join("playback.json");
        let (settings, kept) = match fs::read(&file) {
            Ok(bytes) => match serde_json::from_slice(&bytes) {
                Ok(settings) => (settings, Some(file)),
                Err(_) => {
                    let aside = fs::rename(&file, file.with_extension("json.unreadable")).is_ok();
                    (Settings::default(), aside.then_some(file))
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                (Settings::default(), Some(file))
            }
            Err(_) => (Settings::default(), None),
        };
        let unsaved = kept.is_none();
        Self {
            unsaved,
            #[cfg(unix)]
            running: Arc::new(Running::load(Some(data_dir.join("playback-running.txt")))),
            ..Self::new(kept, cache_dir, settings)
        }
    }

    fn new(settings_file: Option<PathBuf>, default_root: &Path, settings: Settings) -> Self {
        Self {
            settings_file,
            default_root: default_root.to_path_buf(),
            settings: Mutex::new(settings),
            jobs: Arc::new(Mutex::new(HashMap::new())),
            next_job: AtomicU64::new(0),
            turn: Mutex::new(()),
            layout: RwLock::new(()),
            unsaved: false,
            quitting: AtomicBool::new(false),
            checked_silent: Mutex::new(HashSet::new()),
            encoders: encoders(),
            stall: STALL,
            // Tests make copies in the computer's own temp folder, whose free space is none of their business: those that
            // test the floor put in a drive of their own.
            #[cfg(not(test))]
            free: Arc::new(os::free_bytes),
            #[cfg(test)]
            free: Arc::new(|_| None),
            held: Mutex::new(HashMap::new()),
            space_tick: SPACE_TICK,
            #[cfg(test)]
            copy_moves: false,
            #[cfg(unix)]
            running: Arc::new(Running {
                file: None,
                pids: Mutex::new(Vec::new()),
            }),
            #[cfg(test)]
            encode_env: Vec::new(),
            #[cfg(test)]
            attempts: AtomicU64::new(0),
        }
    }

    #[cfg(test)]
    fn in_folder(root: &Path) -> Self {
        Self::new(None, root, Settings::default())
    }

    /// Deletes the half copies a crash or a quit cut off, in every folder of ours. Run once at start, on a thread of its
    /// own (lib.rs). It takes the turn, so it never deletes the one a copy started meanwhile is writing.
    pub fn clean_up(&self) {
        let _turn = lock(&self.turn);
        for folder in self.all_folders() {
            delete_partials(&folder);
        }
    }

    fn settings(&self) -> Settings {
        lock(&self.settings).clone()
    }

    /// The free space copies leave on their drive, in bytes.
    fn floor(&self) -> u64 {
        self.settings().floor_gb.saturating_mul(GB)
    }

    /// The drive that holds `folder`, to make room on.
    fn drive<'a>(&'a self, folder: &'a Path) -> Drive<'a> {
        Drive {
            free: &self.free,
            held: &self.held,
            folder,
        }
    }

    /// Changes the settings and writes them, all under one lock, so two changes at once never mix in the file or undo
    /// each other.
    fn update(&self, change: impl FnOnce(&mut Settings)) -> Result<(), String> {
        let mut settings = lock(&self.settings);
        let mut next = settings.clone();
        change(&mut next);
        if let Some(file) = &self.settings_file {
            let json = serde_json::to_vec(&next).map_err(|_| UNSAVED.to_string())?;
            write_atomically(file, &json).map_err(|_| UNSAVED.to_string())?;
        }
        *settings = next;
        Ok(())
    }

    fn default_folder(&self) -> PathBuf {
        self.default_root.join(FOLDER_NAME)
    }

    /// The copies stay where they are while this is held; none if a Move is running.
    fn settled(&self) -> Option<RwLockReadGuard<'_, ()>> {
        match self.layout.try_read() {
            Ok(guard) => Some(guard),
            Err(TryLockError::Poisoned(poisoned)) => Some(poisoned.into_inner()),
            Err(TryLockError::WouldBlock) => None,
        }
    }

    /// Where copies go now, made if it isn't there; and whether that's the cache folder standing in for a picked
    /// drive that isn't there.
    pub fn folder(&self) -> Result<(PathBuf, bool), String> {
        let (folder, fallback) = match self.settings().root {
            Some(root) if root.is_dir() => (root.join(FOLDER_NAME), false),
            Some(_) => (self.default_folder(), true),
            None => (self.default_folder(), false),
        };
        fs::create_dir_all(&folder).map_err(|_| UNWRITABLE.to_string())?;
        Ok((folder, fallback))
    }

    /// Every folder that holds copies of ours, each once however it's spelled: where they go now; the cache folder
    /// when a picked drive is the usual place, since copies made while it was away are there; and any a Move left
    /// behind. Counted, capped and cleared together.
    fn all_folders(&self) -> Vec<PathBuf> {
        let settings = self.settings();
        let mut folders = Vec::new();
        let mut seen = Vec::new();
        let candidates = settings
            .root
            .map(|root| root.join(FOLDER_NAME))
            .into_iter()
            .chain(std::iter::once(self.default_folder()))
            .chain(settings.leftovers);
        for folder in candidates {
            if folder.is_dir() {
                let real = real(&folder);
                if !seen.contains(&real) {
                    seen.push(real);
                    folders.push(folder);
                }
            }
        }
        folders
    }

    /// Whether a file is one of our own copies (named as ours, in a folder of ours).
    fn is_a_copy(&self, path: &Path) -> bool {
        let named = path
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(ours)
            .is_some();
        named
            && path.parent().is_some_and(|parent| {
                let parent = real(parent);
                self.all_folders().iter().any(|f| real(f) == parent)
            })
    }

    /// The finished copy of a video, if there is one; marked as used. A whole one before one made without sound;
    /// where copies go now first, then the other folders of ours. None while the copies are being moved: where one is
    /// can't be told until the Move is done, and a make waits for it.
    pub fn find(&self, path: &Path, lut: Option<&str>) -> Result<Option<Made>, String> {
        // The original first, outside the lock: a share slow to answer never holds a Move up.
        let key = key_of(path, lut)?;
        let Some(_settled) = self.settled() else {
            return Ok(None);
        };
        let (now, _) = self.folder()?;
        let folders: Vec<PathBuf> = std::iter::once(now).chain(self.all_folders()).collect();
        // Whole first, then the one whose tracks are all silent (as good as whole), then one whose sound couldn't be read.
        let found = [(false, false), (true, true), (true, false)]
            .into_iter()
            .find_map(|(silent, quiet)| {
                let name = if quiet {
                    quiet_name(&key)
                } else {
                    file_name(&key, silent)
                };
                folders
                    .iter()
                    .map(|folder| folder.join(&name))
                    .find(|copy| {
                        fs::symlink_metadata(copy).is_ok_and(|meta| meta.file_type().is_file())
                    })
                    .map(|path| Made {
                        path,
                        silent,
                        quiet,
                    })
            });
        if let Some(made) = &found {
            touch(&made.path);
        }
        Ok(found)
    }

    /// A finished copy by its file name (`<key>.mp4`, `-silent`, `-quiet`), in any folder of ours, for the Player (2.4);
    /// nothing else on the computer is ever reached this way. None while the copies are being moved.
    pub fn copy_named(&self, name: &str) -> Option<PathBuf> {
        if ours(name).is_none_or(|found| found.partial) {
            return None;
        }
        let _settled = self.settled()?;
        let (now, _) = self.folder().ok()?;
        // A file of its own, never a link: one planted under a copy's name (a shared drive) would lead elsewhere.
        std::iter::once(now)
            .chain(self.all_folders())
            .map(|folder| folder.join(name))
            .find(|copy| fs::symlink_metadata(copy).is_ok_and(|meta| meta.file_type().is_file()))
    }

    /// Puts a request for the copy of the video the page names `name` on the list, where Cancel finds it, before
    /// anything is read; off again when it drops. Once the app is quitting a request is stopped before it starts.
    pub fn ask(&self, name: &str) -> Asked {
        let id = self.next_job.fetch_add(1, Ordering::SeqCst);
        // Read under the lock cancel_all holds as it sets it, so a request can't slip between the two.
        let mut jobs = lock(&self.jobs);
        let cancelled = Arc::new(AtomicBool::new(self.quitting.load(Ordering::SeqCst)));
        jobs.entry(name.to_owned()).or_default().push(Job {
            id,
            child: None,
            cancelled: Arc::clone(&cancelled),
        });
        drop(jobs);
        Asked {
            jobs: Arc::clone(&self.jobs),
            name: name.to_owned(),
            id,
            cancelled,
        }
    }

    /// A copy found that serves as it is: a whole one, or one without sound whose sound was found unreadable in this
    /// run.
    fn ready(&self, found: Option<&Made>, key: &str) -> bool {
        found.is_some_and(|made| {
            !made.silent || made.quiet || lock(&self.checked_silent).contains(key)
        })
    }

    /// Makes the playback copy of a video, or finds the one already made; see `make_asked`. The tests' way in; the
    /// command puts its request on the list itself, before it checks the file.
    #[cfg(test)]
    pub fn make(&self, path: &Path, on_progress: impl FnMut(f64)) -> Result<Made, String> {
        self.make_graded(path, None, on_progress)
    }

    /// `make`, with a LUT.
    #[cfg(test)]
    pub fn make_graded(
        &self,
        path: &Path,
        lut: Option<&Lut>,
        on_progress: impl FnMut(f64),
    ) -> Result<Made, String> {
        let name = job_name(&path.to_string_lossy(), lut.map(|lut| lut.sha256.as_str()));
        let asked = self.ask(&name);
        self.make_asked(&asked, path, lut, on_progress)
    }

    /// Makes the playback copy of a video for a request already on the list, or finds the one already made. One at a
    /// time; `on_progress` hears how far along it is. Several requests for one video share the work: the first makes
    /// it, the others find it made.
    pub fn make_asked(
        &self,
        asked: &Asked,
        path: &Path,
        lut: Option<&Lut>,
        mut on_progress: impl FnMut(f64),
    ) -> Result<Made, String> {
        if asked.stopped() {
            return Err(CANCELLED.into());
        }
        // A copy of a copy: Clear or the cap would one day delete the "original" from under its frame.
        if self.is_a_copy(path) {
            return Err(A_COPY.into());
        }
        let sha256 = lut.map(|lut| lut.sha256.as_str());
        if sha256.is_some_and(|sha256| !is_lut_name(sha256)) {
            return Err(FAILED.into());
        }
        let key = key_of(path, sha256)?;
        let found = self.find(path, sha256)?;
        if self.ready(found.as_ref(), &key) {
            return Ok(found.expect("ready means found"));
        }
        let _turn = lock(&self.turn);
        if asked.stopped() {
            return Err(CANCELLED.into());
        }
        // Made while this one waited its turn (or moved meanwhile: a Move holds the turn too).
        let found = self.find(path, sha256)?;
        if self.ready(found.as_ref(), &key) {
            return Ok(found.expect("ready means found"));
        }
        // Made without sound in an earlier run: made again only if the sound reads now. Kept if it can't be told, and
        // if the copy with sound can't be made after all.
        let earlier = found;
        // A copy refused for want of room isn't a sound found unreadable: the next request tries the sound again.
        let keep_earlier = |error: String| match &earlier {
            Some(silent) => {
                if error != NO_ROOM {
                    lock(&self.checked_silent).insert(key.clone());
                }
                Ok(silent.clone())
            }
            None => Err(error),
        };
        if earlier.is_some() && !matches!(video::sound_plays(path), Ok(true)) {
            return keep_earlier(String::new());
        }
        let (folder, _) = self.folder()?;
        let probe = video::probe(path)?;
        let facts = video::facts(path)?;
        // A LUT is made for the signal the camera recorded (S-Log3, an HLG or PQ grade), so it takes the place of the
        // tone-mapping: the LUT brings the picture to BT.709 itself.
        let grade = match lut {
            Some(lut) => Some(LutFile::write(lut)?),
            None => None,
        };
        let hdr = video::tone_map(&facts.colour);
        // HDR footage whose matrix FFmpeg's own filters refuse is still re-tagged for them ahead of the LUT.
        let retag = hdr.as_ref().map_or("", |hdr| hdr.before);
        let tone_map = if grade.is_some() { None } else { hdr };
        if asked.stopped() {
            return Err(CANCELLED.into());
        }
        let total = probe.duration_frames;
        // Room for it, leaving the floor free, before it starts: the copies used longest ago make it if they can. A
        // video whose length isn't known gets none ahead; if the watch stops it at the floor, it's measured then.
        let seconds = total as f64 * f64::from(probe.fps_den) / f64::from(probe.fps_num.max(1));
        let needs = (seconds.ceil() as u64).saturating_mul(BYTES_A_SECOND);
        if !self
            .drive(&folder)
            .room_for(&key, self.floor().saturating_add(needs), 0)
        {
            return keep_earlier(NO_ROOM.into());
        }
        let reached = Cell::new(0f64);
        let mut on_frame = |frame: f64| {
            reached.set(frame);
            if total > 0 {
                on_progress((frame / total as f64).min(1.0));
            }
        };
        // Each encoder in turn, with the sound if there is any. The sound is left out only when it's the cause: an
        // attempt failed and the sound alone can't be read. Never for any other failure, which would keep a copy
        // without sound for good. Each attempt writes a partial of its own, so one whose ffmpeg was given up on (and
        // may still hold its file) never stands in the next one's way.
        let mut sound = probe.has_audio;
        let mut sound_tested = false;
        // Several tracks, each one channel: mixed. Like the sound, the mix is given up only when it's the cause: an
        // attempt failed and the mix alone can't be made. Then each track is tried alone, and the ones that decode are
        // mixed (or the one that does, as it is); with none, the copy has no sound.
        // Tracks that can't be counted now (a share slow to answer): no copy yet rather than one with CH1 alone, kept
        // as if whole; it's tried again when next asked for.
        let channels = if sound {
            match video::audio_tracks(path) {
                Ok(channels) => channels,
                // Not a judgement on the sound: an earlier copy plays meanwhile, unmarked, so the next request tries
                // again, as after a refusal for room.
                Err(error) => return earlier.clone().ok_or(error),
            }
        } else {
            Vec::new()
        };
        let mut tracks: Vec<usize> =
            if channels.len() >= 2 && channels.iter().all(|&count| count == 1) {
                (0..channels.len()).collect()
            } else {
                Vec::new()
            };
        let mut mix_tested = false;
        // Silent ones left out (2.3c, Kevin): an FX6's two empty inputs don't halve its two live mics. Each track is
        // listened to; the ones with sound are mixed, each at 1/N of them. None: a copy without sound that says why.
        // If they can't be listened to now, all are mixed, as before, which never clips either.
        let mut quiet = false;
        if tracks.len() >= 2 {
            if let Ok(peaks) = video::track_peaks(path, &tracks, seconds) {
                tracks = tracks
                    .iter()
                    .zip(&peaks)
                    // NaN (not heard either way) keeps the track: only a track heard to be silent is left out.
                    .filter(|(_, &peak)| peak.is_nan() || peak > video::SILENT_DB)
                    .map(|(&track, _)| track)
                    .collect();
                if tracks.is_empty() {
                    quiet = true;
                    sound = false;
                    sound_tested = true;
                }
            }
            if asked.stopped() {
                return Err(CANCELLED.into());
            }
        }
        let mut stalled = false;
        let mut measured = false;
        let mut outcome = Err(Stop::Failed(Said::default()));
        let mut partial = PathBuf::new();
        let mut attempt = 0;
        'encoders: for (i, encoder) in self.encoders.iter().enumerate() {
            let last = i + 1 == self.encoders.len();
            loop {
                attempt += 1;
                partial = folder.join(format!("{key}-{}-{attempt}.mp4.partial", asked.id));
                let run = Run {
                    path,
                    partial: &partial,
                    rate: (probe.fps_num, probe.fps_den),
                    offset: facts.stream_start - facts.file_start,
                    tone_map: tone_map.as_ref(),
                    lut: grade.as_ref().map(|grade| grade.folder.as_path()),
                    retag,
                    encoder,
                    sound,
                    tracks: &tracks,
                };
                outcome = self.encode(&run, asked, &mut on_frame);
                match &outcome {
                    // Stopped at the floor, the first time: the copy came out bigger than its estimate (or its length
                    // wasn't known), so it's measured by what it wrote, and made again if older copies can make that
                    // room. Once only.
                    Err(Stop::NoRoom) if !measured => {
                        measured = true;
                        let written = fs::metadata(&partial).map_or(0, |meta| meta.len());
                        let _ = fs::remove_file(&partial);
                        let frames = reached.get();
                        let estimate = if total > 0 && frames >= 1.0 {
                            (written as f64 * total as f64 / frames) as u64
                        } else {
                            written.saturating_mul(2)
                        };
                        let wanted = self.floor().saturating_add(estimate.max(needs));
                        if !asked.stopped() && self.drive(&folder).room_for(&key, wanted, 0) {
                            continue;
                        }
                        break 'encoders;
                    }
                    // Done, stopped, out of room, or the drive gone: no other encoder would do better.
                    Ok(_) | Err(Stop::Cancelled | Stop::NoRoom) => break 'encoders,
                    Err(Stop::Failed(said)) if said.read_failed => break 'encoders,
                    // Stalled: another encoder is worth a try (a hardware one hung in its driver), but only if one
                    // follows and the original still answers.
                    Err(Stop::Stalled) => {
                        stalled = true;
                        if last || video::starts(path).is_err() {
                            break 'encoders;
                        }
                    }
                    Err(Stop::Failed(_)) if sound && tracks.len() >= 2 && !mix_tested => {
                        mix_tested = true;
                        match mix_plays(path, &tracks) {
                            // The mix reads: the failure is the encoder's, and the sound needs no test of its own.
                            Ok(true) => sound_tested = true,
                            Ok(false) => {
                                let _ = fs::remove_file(&partial);
                                tracks = after_the_mix_failed(
                                    &tracks,
                                    tracks_that_play(path, &tracks, asked),
                                );
                                // Each track tried: the sound itself is known now.
                                sound_tested = true;
                                sound = !tracks.is_empty();
                                continue;
                            }
                            // Couldn't tell (the file stopped answering): the next encoder, mix and all.
                            Err(_) => {}
                        }
                    }
                    Err(Stop::Failed(_)) if sound && !sound_tested => {
                        sound_tested = true;
                        if video::sound_plays(path) == Ok(false) {
                            let _ = fs::remove_file(&partial);
                            sound = false;
                            continue;
                        }
                    }
                    Err(_) => {}
                }
                let _ = fs::remove_file(&partial);
                break;
            }
        }
        // A Cancel that came while the original or its sound was being checked.
        if asked.stopped() {
            outcome = Err(Stop::Cancelled);
        }
        let checked = outcome
            .map_err(|stop| match stop {
                // A later attempt that failed with no cause of its own, after one stalled: the stall says why.
                Stop::Failed(said) if stalled && !said.read_failed => STALLED.into(),
                stop => stop.message(),
            })
            .and_then(|said| {
                // The original changed while it was read (an offload still writing): this copy isn't of it.
                if key_of(path, sha256)? != key {
                    return Err(FAILED.into());
                }
                let made = video::probe(&partial)?;
                if complete(&probe, sound, &made, said) {
                    Ok(())
                } else if said.damaged && !said.read_failed && total == 0 {
                    // A damaged file, not a missing drive.
                    Err(FAILED.into())
                } else {
                    Err(SHORT.into())
                }
            })
            .and_then(|()| {
                // Whole, and held to the floor too (it may have ended between two readings, or come out bigger than
                // its estimate): older copies make room for it, or it isn't kept, which gives its own space back.
                let size = fs::metadata(&partial).map_or(0, |meta| meta.len());
                if self.drive(&folder).room_for(&key, self.floor(), size) {
                    Ok(())
                } else {
                    Err(NO_ROOM.into())
                }
            });
        if let Err(error) = checked {
            let _ = fs::remove_file(&partial);
            return if error == CANCELLED {
                Err(error)
            } else {
                keep_earlier(error)
            };
        }
        let silent = probe.has_audio && !sound;
        let done = folder.join(if quiet {
            quiet_name(&key)
        } else {
            file_name(&key, silent)
        });
        fs::rename(&partial, &done).map_err(|_| {
            let _ = fs::remove_file(&partial);
            UNWRITABLE.to_string()
        })?;
        if silent && !quiet {
            lock(&self.checked_silent).insert(key);
        } else {
            // The sound reads now (or is known silent): the copy without it goes.
            for folder in self.all_folders() {
                let _ = fs::remove_file(folder.join(file_name(&key, true)));
            }
        }
        on_progress(1.0);
        self.keep_under_cap(&done);
        Ok(Made {
            path: done,
            silent,
            quiet,
        })
    }

    fn encode(
        &self,
        run: &Run<'_>,
        asked: &Asked,
        mut on_frame: impl FnMut(f64),
    ) -> Result<Said, Stop> {
        // The tests on a Mac: one encode at a time, as the app makes them, which spares a CI runner's virtual GPU (its
        // VideoToolbox wedges once a run opens many sessions; the sound tests leave it alone, LIGHT_ENCODER).
        #[cfg(all(test, target_os = "macos"))]
        let _one_at_a_time = mac_test_encode_turn();
        let (fps_num, fps_den) = run.rate;
        // Square pixels and the long-edge cap in one scale; deinterlaced first if the frames are interlaced. The
        // encoder's own pixel format comes with its options.
        let fit = format!("min(1,{LONG_EDGE}/max(iw*sar,ih))");
        let filter = format!(
            "bwdif=mode=send_frame:deint=interlaced,scale=w='trunc(iw*sar*{fit}/2)*2':h='trunc(ih*{fit}/2)*2',setsar=1"
        );
        // HDR brought to normal-range BT.709 after the scale, so the tone-mapping works on the smaller picture. A LUT,
        // likewise after the scale: tetrahedral, as grading tools interpolate.
        let filter = match (run.tone_map, run.lut) {
            // Its output said to be BT.709 on the frames too, where an encoder takes its colour from.
            (_, Some(_)) => format!(
                "{}{filter},lut3d=file={LUT_FILE}:interp=tetrahedral,\
                 setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709",
                run.retag
            ),
            (Some(tone_map), None) => tone_map.around(&filter),
            (None, None) => filter,
        };
        let mut command = video::command("ffmpeg");
        command
            .args(["-hide_banner", "-loglevel", "error", "-y"])
            .args(["-protocol_whitelist", "file"]);
        if let Some(folder) = run.lut {
            command.current_dir(folder);
        }
        // Starts at the video's first frame (a quarter frame early, so rounding keeps it): sound that leads the
        // picture is left out, and the copy's frame 0 is the original's.
        if run.offset > 0.0 {
            let early = (run.offset - 0.25 * f64::from(fps_den) / f64::from(fps_num)).max(0.0);
            command.arg("-ss").arg(format!("{early:.6}"));
        }
        command.arg("-i").arg(run.path).args(["-map", "0:V:0"]);
        if run.sound && run.tracks.len() >= 2 {
            command
                .args(["-filter_complex", &mix_filter(run.tracks), "-map", "[mix]"])
                .args(["-c:a", "aac", "-b:a", "160k"]);
        } else if run.sound {
            let track = format!("0:a:{}?", run.tracks.first().copied().unwrap_or(0));
            command
                .args(["-map", &track])
                .args(["-c:a", "aac", "-b:a", "160k", "-ac", "2"]);
        } else {
            command.arg("-an");
        }
        command
            .args(["-vf", &filter, "-fps_mode", "cfr", "-r"])
            .arg(format!("{fps_num}/{fps_den}"))
            .args(run.encoder);
        // Said in the file too, so a player shows the copy as what it is now.
        if run.tone_map.is_some() || run.lut.is_some() {
            command.args(["-color_primaries", "bt709", "-color_trc", "bt709"]);
            command.args(["-colorspace", "bt709", "-color_range", "tv"]);
        }
        command
            .args(["-g", "12", "-f", "mp4"])
            .args(["-progress", "pipe:1", "-nostats"])
            .arg(run.partial)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(test)]
        {
            for (key, value) in &self.encode_env {
                command.env(key, value);
            }
            self.attempts.fetch_add(1, Ordering::SeqCst);
        }
        if asked.stopped() {
            return Err(Stop::Cancelled);
        }
        let mut child = self.start(&mut command).map_err(|_| {
            Stop::Unstarted(
                "Storiiboard's video reader couldn't start. Reinstalling Storiiboard puts it back."
                    .into(),
            )
        })?;
        #[cfg(unix)]
        let pid = child.id();
        let (stdout, stderr) = (child.stdout.take(), child.stderr.take());
        let child = Arc::new(Mutex::new(child));
        asked.running(&child);
        // The drive's free space, read on a thread of its own every few seconds while the copy is made: the room for
        // it was made before it started, so a drive come down to the floor means another program filled it, or the copy
        // came out bigger than its estimate, and the copy stops. It only reads (it removes nothing), and it ends when the
        // encode does (its channel closes), or when a reading stuck on a share that stopped answering returns.
        let low = Arc::new(AtomicBool::new(false));
        let (_watching, watched) = mpsc::channel::<()>();
        if let Some(folder) = run.partial.parent() {
            let (free, folder) = (Arc::clone(&self.free), folder.to_path_buf());
            let (floor, tick, low) = (self.floor(), self.space_tick, Arc::clone(&low));
            std::thread::spawn(move || loop {
                if free(&folder).is_some_and(|now| now < floor) {
                    low.store(true, Ordering::SeqCst);
                    return;
                }
                if !matches!(watched.recv_timeout(tick), Err(RecvTimeoutError::Timeout)) {
                    return;
                }
            });
        }
        // ffmpeg's two outputs are read on threads of their own, so neither pipe fills and holds it up, and a read
        // that never returns (ffmpeg stuck on a dead share) never holds up this one. Word that it's working is a
        // progress count that went up; its error output is only listened to.
        let started = Instant::now();
        let heard = Arc::new(AtomicU64::new(0));
        let (frames_sent, frames) = mpsc::channel::<f64>();
        let progress = stdout.map(|stdout| {
            let heard = Arc::clone(&heard);
            std::thread::spawn(move || {
                let mut last: [String; 3] = Default::default();
                for_each_line(stdout, |line| {
                    let line = line.trim_end();
                    for (i, key) in MOVING_ON.iter().enumerate() {
                        if let Some(value) = line.strip_prefix(key) {
                            if value != last[i] {
                                last[i] = value.to_owned();
                                heard.store(started.elapsed().as_millis() as u64, Ordering::SeqCst);
                            }
                        }
                    }
                    if let Some(frame) = line
                        .strip_prefix("frame=")
                        .and_then(|n| n.trim().parse::<f64>().ok())
                    {
                        let _ = frames_sent.send(frame);
                    }
                });
            })
        });
        let errors = stderr.map(|stderr| {
            std::thread::spawn(move || {
                let mut said = Said::default();
                for_each_line(stderr, |line| {
                    // In the tests, ffmpeg's own words, which a failing test prints (an encoder refused on a CI
                    // runner says why only there).
                    #[cfg(test)]
                    eprintln!("ffmpeg: {}", line.trim_end());
                    said.hear(line);
                });
                said
            })
        });
        // The watch: progress passed on, a Cancel or a stall stopped, and a stop that doesn't take given up on: its
        // ffmpeg is left to end on a thread of its own, so this copy fails now and the next one can start.
        let give_up = |child: &Arc<Mutex<Child>>| {
            let _ = lock(child).kill();
            let child = Arc::clone(child);
            #[cfg(unix)]
            let running = Arc::clone(&self.running);
            std::thread::spawn(move || {
                while matches!(lock(&child).try_wait(), Ok(None)) {
                    std::thread::sleep(Duration::from_secs(1));
                }
                #[cfg(unix)]
                running.remove(pid);
            });
        };
        let mut stopped_at: Option<Instant> = None;
        let mut stalled = false;
        let mut no_room = false;
        let mut last_tick = Instant::now();
        let status: Option<ExitStatus> = loop {
            match frames.recv_timeout(TICK) {
                Ok(frame) => on_frame(frame),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => std::thread::sleep(TICK),
            }
            if last_tick.elapsed() > SLEPT {
                heard.store(started.elapsed().as_millis() as u64, Ordering::SeqCst);
                stopped_at = stopped_at.map(|_| Instant::now());
            }
            last_tick = Instant::now();
            // Locked only to look, so a Cancel can always reach the kill in between.
            let exited = lock(&child).try_wait();
            match exited {
                Ok(Some(status)) => break Some(status),
                Ok(None) => {}
                Err(_) => {
                    give_up(&child);
                    break None;
                }
            }
            match stopped_at {
                None => {
                    let quiet = started
                        .elapsed()
                        .saturating_sub(Duration::from_millis(heard.load(Ordering::SeqCst)));
                    let cancel = asked.stopped();
                    let low = low.load(Ordering::SeqCst);
                    if cancel || low || quiet > self.stall {
                        no_room = !cancel && low;
                        stalled = !cancel && !low;
                        let _ = lock(&child).kill();
                        stopped_at = Some(Instant::now());
                    }
                }
                Some(at) if at.elapsed() >= KILL_GRACE => {
                    give_up(&child);
                    break None;
                }
                Some(_) => {}
            }
        };
        // Once ffmpeg has ended its outputs are closed, so the readers end too; one given up on keeps its readers.
        let said = match status {
            Some(_) => {
                #[cfg(unix)]
                self.running.remove(pid);
                if let Some(progress) = progress {
                    let _ = progress.join();
                }
                while let Ok(frame) = frames.try_recv() {
                    on_frame(frame);
                }
                errors
                    .and_then(|errors| errors.join().ok())
                    .unwrap_or_default()
                    .settle(run.path)
            }
            None => Said::default(),
        };
        if asked.stopped() {
            return Err(Stop::Cancelled);
        }
        // The drive came down to the floor while the copy was made, whether or not ffmpeg ended before the watch
        // could stop it.
        if no_room || low.load(Ordering::SeqCst) {
            return Err(Stop::NoRoom);
        }
        if stalled {
            return Err(Stop::Stalled);
        }
        match status {
            Some(status) if status.success() => Ok(said),
            _ => Err(Stop::Failed(said)),
        }
    }

    /// Starts an encode's ffmpeg so that it ends with the app, however the app ends: on Windows in the app's Job Object;
    /// on a Mac with its process id kept (`Running`) until the encode is done with it.
    fn start(&self, command: &mut Command) -> std::io::Result<Child> {
        let child = command.spawn()?;
        os::keep_with_app(&child);
        #[cfg(unix)]
        self.running.add(child.id());
        Ok(child)
    }

    /// Stops every copy of this video asked for, wherever each is: being checked, waiting its turn, reading the
    /// original, or encoding; the half copy is deleted. By the path as the page names it, without reading the
    /// original, so it works when the card is gone or the share has stopped answering. Whether there was one to stop.
    pub fn cancel(&self, name: &str) -> bool {
        let jobs = lock(&self.jobs);
        let Some(list) = jobs.get(name) else {
            return false;
        };
        for job in list {
            job.cancelled.store(true, Ordering::SeqCst);
            if let Some(child) = &job.child {
                let _ = lock(child).kill();
            }
        }
        !list.is_empty()
    }

    /// Stops every copy being made, and any asked for from now on: the app is quitting, and ffmpeg shouldn't go on
    /// alone.
    pub fn cancel_all(&self) {
        let jobs = lock(&self.jobs);
        self.quitting.store(true, Ordering::SeqCst);
        for job in jobs.values().flatten() {
            job.cancelled.store(true, Ordering::SeqCst);
            if let Some(child) = &job.child {
                let _ = lock(child).kill();
            }
        }
    }

    /// Deletes copies used longest ago until all of them are under the cap. Never `keep`, the copy just made. Not
    /// while a Move runs: it keeps to the cap itself when it's done.
    fn keep_under_cap(&self, keep: &Path) {
        if let Some(_settled) = self.settled() {
            keep_under(
                &self.all_folders(),
                keep,
                self.settings().cap_gb.saturating_mul(GB),
            );
        }
    }

    pub fn info(&self) -> Result<CacheInfo, String> {
        let (folder, fallback) = self.folder()?;
        let all: Vec<Stored> = self.all_folders().iter().flat_map(|f| copies(f)).collect();
        Ok(CacheInfo {
            folder: folder.to_string_lossy().into_owned(),
            bytes: all.iter().map(|c| c.bytes).sum(),
            copies: all.len(),
            cap_gb: self.settings().cap_gb,
            floor_gb: self.settings().floor_gb,
            free_bytes: (self.free)(&folder),
            fallback,
            moved: self.settings().root.is_some(),
            busy: !lock(&self.jobs).is_empty(),
        })
    }

    /// Deletes every finished copy, in every folder of ours (they're made again when played). Returns how many went.
    /// Not while the copies are being moved.
    pub fn clear(&self) -> Result<usize, String> {
        let Some(_settled) = self.settled() else {
            return Err(MOVING.into());
        };
        Ok(self
            .all_folders()
            .iter()
            .flat_map(|f| copies(f))
            .filter(|c| fs::remove_file(&c.path).is_ok())
            .count())
    }

    /// Sets the cap and keeps to it (once a Move is done, if one is running).
    pub fn set_cap(&self, gb: u64) -> Result<(), String> {
        if !(1..=10_000).contains(&gb) {
            return Err("The cap for playback copies is between 1 and 10,000 GB.".into());
        }
        self.update(|settings| settings.cap_gb = gb)?;
        self.keep_under_cap(Path::new(""));
        Ok(())
    }

    /// Sets the free space copies leave on their drive. The copies already made stay; the next one keeps to it.
    pub fn set_floor(&self, gb: u64) -> Result<(), String> {
        if !(1..=1_000).contains(&gb) {
            return Err(FLOOR_RANGE.into());
        }
        self.update(|settings| settings.floor_gb = gb)
    }

    /// Moves the copies into `root` (or back to the cache folder with None). Not while one is being made. The new
    /// folder is tested for writing first. Then the setting is saved, with the old folders kept on the list of
    /// leftovers, so a crash partway leaves copies only where the app still looks; then each copy is moved, and an old
    /// folder comes off the list once nothing of ours is left in it. One that can't be read now (unplugged), or that
    /// still holds copies that couldn't go, stays on the list for the next Move. Returns how many moved. A copy that
    /// would take the new drive below the floor stays where it is (and still plays), and the Move then says so.
    pub fn move_to(&self, root: Option<&Path>) -> Result<usize, String> {
        if self.unsaved {
            return Err(UNSAVED.into());
        }
        if !lock(&self.jobs).is_empty() {
            return Err("A playback copy is being made; move the copies once it's done.".into());
        }
        let _turn = lock(&self.turn);
        let moved = {
            // Waits for a Clear or the cap already running; finding, Clear and the cap don't start until it's done.
            let _moving = self.layout.write().unwrap_or_else(PoisonError::into_inner);
            self.move_copies(root)
        };
        // A cap lowered while the copies moved is kept to now, however the Move ended. One lowered after this looks
        // finds the copies settled and keeps to itself.
        self.keep_under_cap(Path::new(""));
        moved
    }

    /// The part of a Move that holds the layout.
    fn move_copies(&self, root: Option<&Path>) -> Result<usize, String> {
        let new = root.unwrap_or(&self.default_root).join(FOLDER_NAME);
        let existed = new.is_dir();
        fs::create_dir_all(&new).map_err(|_| UNWRITABLE.to_string())?;
        // Refused with nothing changed: the folder made for it goes again (only if it's still empty).
        let refuse = || {
            if !existed {
                let _ = fs::remove_dir(&new);
            }
            Err(NO_ROOM_THERE.to_string())
        };
        // A drive already below the floor would take no copy at all: the copies stay where they are.
        let floor = self.floor();
        if (self.free)(&new).is_some_and(|free| free < floor) {
            return refuse();
        }
        let probe = new.join(format!("{:032x}.mp4.partial", 0));
        fs::write(&probe, b"")
            .and_then(|()| fs::remove_file(&probe))
            .map_err(|_| UNWRITABLE.to_string())?;
        // Every folder of ours, each once however it's spelled, a picked drive that's unplugged now among them.
        let settings = self.settings();
        let was = (settings.root.clone(), settings.leftovers.clone());
        let home = self.default_folder();
        let new_real = real(&new);
        let mut olds: Vec<PathBuf> = Vec::new();
        let mut seen = vec![new_real];
        let candidates = settings
            .root
            .map(|root| root.join(FOLDER_NAME))
            .into_iter()
            .chain(std::iter::once(home.clone()))
            .chain(settings.leftovers);
        for old in candidates {
            let real = real(&old);
            if !seen.contains(&real) {
                seen.push(real);
                olds.push(old);
            }
        }
        // The cache folder is always looked in; only the others need remembering.
        let away = |folders: &[PathBuf]| -> Vec<PathBuf> {
            folders.iter().filter(|f| **f != home).cloned().collect()
        };
        self.update(|settings| {
            settings.root = root.map(Path::to_path_buf);
            settings.leftovers = away(&olds);
        })?;
        let mut moved = 0;
        let mut crossed = false;
        let mut left = Vec::new();
        // A copy across drives goes only if the new one keeps the floor free after it.
        let short = Cell::new(false);
        let room = |bytes: u64| {
            let fits = (self.free)(&new).is_none_or(|free| free >= floor.saturating_add(bytes));
            if !fits {
                short.set(true);
            }
            fits
        };
        #[cfg(test)]
        let force_copy = self.copy_moves;
        #[cfg(not(test))]
        let force_copy = false;
        for old in &olds {
            if !old.is_dir() {
                // A drive that isn't there now (its mount folder may be): its copies move once it's back. Remembering a
                // folder that's simply gone costs nothing; the app only looks in folders that are there.
                left.push(old.clone());
                continue;
            }
            // The turn is held, so no half copy here is being written: one a crash left goes now.
            delete_partials(old);
            let Some(list) = listed(old) else {
                left.push(old.clone());
                continue;
            };
            let mut all_moved = true;
            for copy in list {
                let Some(file) = copy.path.file_name() else {
                    all_moved = false;
                    continue;
                };
                let to = new.join(file);
                if move_one(&copy.path, &to, force_copy, room) {
                    moved += 1;
                } else {
                    all_moved = false;
                    // Written there, but its original couldn't go (held by another program).
                    crossed |= to.is_file() && copy.path.is_file();
                }
            }
            // Only our folder, and only if nothing else is in it.
            let _ = fs::remove_dir(old);
            // Still on the list while anything of ours is in it: a copy that couldn't go, a half copy held open, one
            // that couldn't be listed.
            let anything_ours = || {
                fs::read_dir(old).map_or(true, |entries| {
                    entries
                        .filter_map(Result::ok)
                        .any(|entry| entry.file_name().to_str().and_then(ours).is_some())
                })
            };
            if !all_moved || (old.is_dir() && anything_ours()) {
                left.push(old.clone());
            }
        }
        // Not one copy could cross for want of room: nothing moved, so the copies' place goes back to what it was. One
        // that this Move wrote there but whose original couldn't go keeps the new folder on the list.
        if short.get() && moved == 0 {
            let (root, mut leftovers) = was;
            if crossed && new != home && !leftovers.contains(&new) {
                leftovers.push(new.clone());
            }
            self.update(|settings| {
                settings.root = root;
                settings.leftovers = leftovers;
            })?;
            return refuse();
        }
        // The copies moved: what was known of their old drives no longer applies.
        lock(&self.held).clear();
        // The moves are done; a list that can't be saved only means looking in folders that hold nothing.
        let _ = self.update(|settings| settings.leftovers = away(&left));
        if short.get() {
            return Err(NO_ROOM_TO_MOVE.into());
        }
        Ok(moved)
    }
}

/// Calls `each` with every line a pipe gives (invalid UTF-8 replaced), to its end.
fn for_each_line(pipe: impl std::io::Read, mut each: impl FnMut(&str)) {
    let mut reader = BufReader::new(pipe);
    let mut line = Vec::new();
    loop {
        line.clear();
        match reader.read_until(b'\n', &mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) => each(&String::from_utf8_lossy(&line)),
        }
    }
}

/// One encode: what to read, where to write, and how.
struct Run<'a> {
    path: &'a Path,
    partial: &'a Path,
    rate: (u32, u32),
    offset: f64,
    /// HDR's way to normal range (video::tone_map), when the original is HDR and has no LUT.
    tone_map: Option<&'a video::ToneMap>,
    /// The folder holding the LUT the copy is graded with (`LUT_FILE` in it), when it has one (2.5).
    lut: Option<&'a Path>,
    /// What goes ahead of FFmpeg's own filters for HDR footage graded by a LUT (video::ToneMap's `before`); empty else.
    retag: &'static str,
    encoder: &'a [&'a str],
    sound: bool,
    /// The separate mono tracks mixed into the copy's one stereo track (see `mix_filter`), by their index among the
    /// file's sound tracks; with one, that track as it is; with none, the first track as it is.
    tracks: &'a [usize],
}

/// The Mac tests' one turn to encode (see `encode`).
#[cfg(all(test, target_os = "macos"))]
fn mac_test_encode_turn() -> std::sync::MutexGuard<'static, ()> {
    static TURN: Mutex<()> = Mutex::new(());
    TURN.lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Separate mono tracks (Sony and Canon MXF keep each channel on its own) mixed into one stereo track that never
/// clips (Kevin, Nov 6): each track at 1/N (`normalize`), a decibel to spare for the AAC encoder, and the same mix on
/// both sides. A file with a single track, stereo or not, keeps it as it is. `tracks`: their indexes among the file's
/// sound tracks.
fn mix_filter(tracks: &[usize]) -> String {
    let inputs: String = tracks.iter().map(|i| format!("[0:a:{i}]")).collect();
    let count = tracks.len();
    format!("{inputs}amix=inputs={count}:duration=longest:normalize=1,volume=-1dB,pan=stereo|c0=c0|c1=c0[mix]")
}

/// Whether the mix of `tracks` can go into a copy (`video::sound_reads`, as for the first track alone).
fn mix_plays(path: &Path, tracks: &[usize]) -> Result<bool, String> {
    video::sound_reads(
        path,
        &["-filter_complex", &mix_filter(tracks), "-map", "[mix]"],
    )
}

/// The tracks a copy takes once their mix couldn't be made, given the ones that decode alone (`playing`): those, mixed
/// (or the one, as it is); none, no sound. If each decodes alone the mix itself is the trouble, so the first track alone,
/// as before there was a mix.
fn after_the_mix_failed(tracks: &[usize], mut playing: Vec<usize>) -> Vec<usize> {
    if playing.len() == tracks.len() {
        playing.truncate(1);
    }
    playing
}

/// Of a file's separate mono tracks, the ones that decode: each tried alone, as the first track is. One that can't tell
/// (the file stopped answering) is kept, so the next attempt finds out. A Cancel stops the trying (the make then ends
/// cancelled), so it never waits on every track of a file on a share that stopped answering.
fn tracks_that_play(path: &Path, tracks: &[usize], asked: &Asked) -> Vec<usize> {
    let mut playing = Vec::new();
    for &track in tracks {
        if asked.stopped() {
            break;
        }
        if video::sound_reads(path, &["-map", &format!("0:a:{track}")]) != Ok(false) {
            playing.push(track);
        }
    }
    playing
}

/// The URL scheme the Player reads copies through (2.4): `sbdcopy://localhost/<copy's file name>` (on Windows,
/// `http://sbdcopy.localhost/…`). It serves finished copies only, found by name in the copies' folders, so no other file
/// is ever reached; and in slices, as a `<video>` asks for them, so a copy is never read into memory whole.
pub const COPY_SCHEME: &str = "sbdcopy";
/// The most one answer carries; a `<video>` asks again for the rest. Small enough that a seek answers soon on a slow
/// drive (a webview asks for "the rest" from where it seeks, and only needs the start of it).
const SLICE: u64 = 2 * 1024 * 1024;

/// One answer of the copies' scheme.
#[derive(Debug, PartialEq)]
pub struct CopyAnswer {
    pub status: u16,
    pub headers: Vec<(&'static str, String)>,
    pub body: Vec<u8>,
}

impl CopyAnswer {
    fn bare(status: u16) -> Self {
        Self {
            status,
            headers: Vec::new(),
            body: Vec::new(),
        }
    }
}

/// The bytes asked for, `first..=last`, as a `Range` header gives them ("bytes=a-b", "bytes=a-", "bytes=-n"), held to
/// a slice; no header, the start. None: nothing of the copy is asked for (416).
fn byte_range(header: Option<&str>, len: u64) -> Option<(u64, u64)> {
    if len == 0 {
        return None;
    }
    let (first, last) = match header {
        None => (0, len - 1),
        Some(header) => {
            let (first, last) = header
                .trim()
                .strip_prefix("bytes=")?
                .split(',')
                .next()?
                .split_once('-')?;
            match (first.trim(), last.trim()) {
                ("", suffix) => {
                    let count: u64 = suffix.parse().ok()?;
                    (len.saturating_sub(count), len - 1)
                }
                (first, "") => (first.parse().ok()?, len - 1),
                (first, last) => (first.parse().ok()?, last.parse::<u64>().ok()?.min(len - 1)),
            }
        }
    };
    (first <= last && first < len).then(|| (first, last.min(first + SLICE - 1)))
}

/// The answer to a request for `path` (`/<copy's file name>`) with its `Range` header, if any.
pub fn serve_copy(cache: &PlaybackCache, path: &str, range: Option<&str>) -> CopyAnswer {
    let name = path.trim_start_matches('/');
    let Some(copy) = cache.copy_named(name) else {
        return CopyAnswer::bare(404);
    };
    let Ok(mut file) = fs::File::open(&copy) else {
        return CopyAnswer::bare(404);
    };
    let len = file.metadata().map_or(0, |meta| meta.len());
    let Some((first, last)) = byte_range(range, len) else {
        let mut answer = CopyAnswer::bare(416);
        answer
            .headers
            .push(("Content-Range", format!("bytes */{len}")));
        return answer;
    };
    // The start of a play: the copy is in use, so the cap keeps it longer.
    if first == 0 {
        touch(&copy);
    }
    let mut body = vec![0; usize::try_from(last - first + 1).unwrap_or(0)];
    if file.seek(SeekFrom::Start(first)).is_err() || file.read_exact(&mut body).is_err() {
        return CopyAnswer::bare(500);
    }
    let whole = first == 0 && last == len - 1;
    let mut headers = vec![
        ("Content-Type", "video/mp4".to_owned()),
        ("Accept-Ranges", "bytes".to_owned()),
        ("Content-Length", body.len().to_string()),
    ];
    if !(whole && range.is_none()) {
        headers.push(("Content-Range", format!("bytes {first}-{last}/{len}")));
    }
    CopyAnswer {
        status: if whole && range.is_none() { 200 } else { 206 },
        headers,
        body,
    }
}

/// Makes a video's playback copy (or finds it) and returns where it is, reporting progress on `progress`. The request
/// goes on the list before the original is even checked, so a Cancel reaches it while a slow drive wakes.
#[tauri::command]
pub async fn playback_make(
    app: AppHandle,
    path: String,
    handle: Option<u32>,
    lut: Option<Lut>,
    progress: Channel<Progress>,
) -> Result<MadeCopy, String> {
    let name = job_name(&path, lut.as_ref().map(|lut| lut.sha256.as_str()));
    let asked = app.state::<PlaybackCache>().ask(&name);
    tauri::async_runtime::spawn_blocking(move || {
        let path = Path::new(&path);
        Access::of(&app, handle).readable(path)?;
        let made = app
            .state::<PlaybackCache>()
            .make_asked(&asked, path, lut.as_ref(), |done| {
                let _ = progress.send(Progress { done });
            })?;
        Ok(made.into())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The finished playback copy of a video, or null when it hasn't been made (or the copies are being moved).
#[tauri::command]
pub async fn playback_find(
    app: AppHandle,
    path: String,
    handle: Option<u32>,
    lut: Option<String>,
) -> Result<Option<MadeCopy>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = Path::new(&path);
        Access::of(&app, handle).readable(path)?;
        if lut.as_deref().is_some_and(|sha256| !is_lut_name(sha256)) {
            return Ok(None);
        }
        Ok(app
            .state::<PlaybackCache>()
            .find(path, lut.as_deref())?
            .map(MadeCopy::from))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stops the copy of a video being made (under its LUT, if any). Only work already asked for can be stopped, so it
/// reads nothing. Off the main thread, so it never holds up the window.
#[tauri::command(async)]
pub fn playback_cancel(app: AppHandle, path: String, lut: Option<String>) -> bool {
    app.state::<PlaybackCache>()
        .cancel(&job_name(&path, lut.as_deref()))
}

#[tauri::command]
pub async fn playback_info(app: AppHandle) -> Result<CacheInfo, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<PlaybackCache>().info())
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn playback_clear(app: AppHandle) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<PlaybackCache>().clear())
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn playback_set_cap(app: AppHandle, gb: u64) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<PlaybackCache>().set_cap(gb))
        .await
        .map_err(|e| e.to_string())?
}

/// Sets the free space playback copies leave on their drive, in GB.
#[tauri::command]
pub async fn playback_set_floor(app: AppHandle, gb: u64) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<PlaybackCache>().set_floor(gb))
        .await
        .map_err(|e| e.to_string())?
}

/// Asks for a folder (another drive, say) and moves the copies there. Null when the dialog was cancelled.
#[tauri::command]
pub async fn playback_move(app: AppHandle, title: String) -> Result<Option<usize>, String> {
    let picked = crate::export::dialog(&app, move |handle| {
        let mut builder = handle.dialog().file().set_title(title);
        if let Some(window) = handle.get_webview_window("main") {
            builder = builder.set_parent(&window);
        }
        builder.blocking_pick_folder()
    })
    .await?;
    let Some(root) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<PlaybackCache>().move_to(Some(&root)).map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Moves the copies back to the app's cache folder.
#[tauri::command]
pub async fn playback_move_back(app: AppHandle) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<PlaybackCache>().move_to(None))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deletes a test's folder when it goes out of scope, however the test ends.
    struct Gone(PathBuf);

    impl Drop for Gone {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("sbd-playback-{tag}-{}", crate::lock::random_id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A clip made with the sidecar: `input` and `output` are ffmpeg's own options.
    fn make_clip(dir: &Path, name: &str, input: &[&str], output: &[&str]) -> PathBuf {
        let path = dir.join(name);
        let status = video::command("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error", "-y"])
            .args(input)
            .args(output)
            .arg(&path)
            .status()
            .expect("the ffmpeg sidecar runs");
        assert!(status.success(), "ffmpeg made {name}");
        path
    }

    /// The grey level of a copy's frame `n`, read back with the sidecar.
    fn grey_at(copy: &Path, n: u32) -> i32 {
        let out = video::command("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error", "-i"])
            .arg(copy)
            .arg("-vf")
            .arg(format!(r"select=eq(n\,{n}),format=gray"))
            .args(["-frames:v", "1", "-f", "rawvideo", "-"])
            .output()
            .unwrap();
        assert!(!out.stdout.is_empty(), "frame {n} of the copy");
        (out.stdout.iter().map(|&b| u32::from(b)).sum::<u32>() / out.stdout.len() as u32) as i32
    }

    /// Which frames of a file are keyframes.
    fn keyframes(file: &Path) -> Vec<usize> {
        let out = video::command("ffprobe")
            .args(["-v", "error", "-select_streams", "v:0"])
            .args(["-show_entries", "frame=key_frame", "-of", "csv=p=0"])
            .arg(file)
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .enumerate()
            .filter(|(_, l)| l.trim().starts_with('1'))
            .map(|(i, _)| i)
            .collect()
    }

    fn sbd_clip(dir: &Path, name: &str, seconds: u32) -> PathBuf {
        make_clip(
            dir,
            name,
            &[
                "-f",
                "lavfi",
                "-i",
                &format!("testsrc2=size=3840x2160:rate=24000/1001:duration={seconds}"),
                "-f",
                "lavfi",
                "-i",
                &format!("sine=duration={seconds}"),
            ],
            &["-c:v", "mpeg4", "-q:v", "5", "-c:a", "aac"],
        )
    }

    /// A small clip with PCM sound, quick to copy.
    fn pcm_clip(dir: &Path, name: &str) -> PathBuf {
        make_clip(
            dir,
            name,
            &[
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x180:rate=25:duration=2",
                "-f",
                "lavfi",
                "-i",
                "sine=duration=2",
            ],
            &["-c:v", "mpeg4", "-c:a", "pcm_s16le"],
        )
    }

    /// The same clip with its sound's codec tag made one ffmpeg doesn't know: it has no decoder for that sound.
    fn unknown_sound(clip: &Path, name: &str) -> PathBuf {
        let mut bytes = fs::read(clip).unwrap();
        let at = bytes
            .windows(4)
            .position(|w| w == b"sowt")
            .expect("the PCM sound's tag");
        bytes[at..at + 4].copy_from_slice(b"abcd");
        let path = clip.with_file_name(name);
        fs::write(&path, bytes).unwrap();
        path
    }

    /// A clip with a sound track for each of `tracks` (lavfi sources), as a Sony or Canon MXF keeps each channel on a
    /// track of its own; `codec` for all of them.
    fn tracks_clip(dir: &Path, name: &str, tracks: &[&str], codec: &str) -> PathBuf {
        let mut input = vec![
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=320x180:rate=25:duration=3",
        ];
        let mut output = vec!["-map", "0:v"];
        let maps: Vec<String> = (1..=tracks.len()).map(|i| format!("{i}:a")).collect();
        for (track, map) in tracks.iter().zip(&maps) {
            input.extend(["-f", "lavfi", "-i", track]);
            output.extend(["-map", map.as_str()]);
        }
        output.extend(["-c:v", "mpeg4", "-c:a", codec]);
        make_clip(dir, name, &input, &output)
    }

    /// A copy's sound: its loudest sample and its average (RMS) level, in dB below full scale (0 is full scale), and
    /// its sound tracks' channels. The average is the one to compare levels by: AAC can move a lone peak by a few dB
    /// when the two sides differ.
    fn sound_of(copy: &Path) -> (f64, f64, Vec<u32>) {
        let out = video::command("ffmpeg")
            .args(["-hide_banner", "-i"])
            .arg(copy)
            .args(["-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"])
            .output()
            .unwrap();
        let said = String::from_utf8_lossy(&out.stderr);
        let level = |name: &str| -> f64 {
            said.lines()
                .find_map(|line| {
                    line.split_once(name)?
                        .1
                        .trim_end_matches(" dB")
                        .trim()
                        .parse()
                        .ok()
                })
                .expect("a level")
        };
        (
            level("max_volume: "),
            level("mean_volume: "),
            video::audio_tracks(copy).unwrap(),
        )
    }

    /// The picture encoder for tests of the sound: FFmpeg's own MPEG-4, as on Linux. They test the sound, and on a CI
    /// Mac the virtual GPU's VideoToolbox wedges once a run has opened many sessions in a row (checkpoints D2 and
    /// 2.3c r1 to r4: a copy hung opening its session, and every encode after it); the other tests still use it.
    const LIGHT_ENCODER: [&str; 6] = ["-c:v", "mpeg4", "-q:v", "3", "-pix_fmt", "yuv420p"];

    /// A cache in `folder` whose copies use `LIGHT_ENCODER`: for the tests of sound, the queue, the stall watch and the
    /// Move, which aren't about the encoder.
    fn sound_test_cache(folder: &Path) -> PlaybackCache {
        let mut cache = PlaybackCache::in_folder(folder);
        cache.encoders = vec![LIGHT_ENCODER.to_vec()];
        cache
    }

    #[test]
    fn mixes_separate_mono_tracks_into_one_stereo_track_that_never_clips() {
        let dir = temp_dir("mono-tracks");
        let cache = sound_test_cache(&dir.join("cache"));
        let silence = "anullsrc=r=48000:cl=mono:d=3";
        let (low, high) = (
            "aevalsrc=0.5*sin(2*PI*440*t):s=48000:d=3",
            "aevalsrc=0.5*sin(2*PI*1000*t):s=48000:d=3",
        );
        // A lavalier on CH2, CH1 left empty: the empty one is left out (2.3c), so the lav plays as its own track would:
        // -9 dB on average, 3 dB less on each side as one track is spread over two. (Mixed with the empty one, -16.)
        let second = tracks_clip(&dir, "C0080.mov", &[silence, high], "pcm_s24le");
        let (_, average, layout) = sound_of(&cache.make(&second, |_| {}).unwrap().path);
        assert_eq!(layout, [2], "one stereo track");
        assert!(
            (average + 12.0).abs() < 1.0,
            "the second track alone, not halved: {average} dB"
        );
        // Two live mics: each at half, a decibel to spare, the same on both sides: two half-scale tones at a quarter
        // each come to -12 dB, then -13.
        let pair = tracks_clip(&dir, "C0086.mov", &[low, high], "pcm_s24le");
        let (_, average, _) = sound_of(&cache.make(&pair, |_| {}).unwrap().path);
        assert!((average + 13.0).abs() < 1.0, "the pair mixed: {average} dB");
        // An FX6's four tracks, the last two empty: the live pair's own level, not a quarter each (-19).
        let fx6 = tracks_clip(
            &dir,
            "C0087.mov",
            &[low, high, silence, silence],
            "pcm_s24le",
        );
        let (_, average, layout) = sound_of(&cache.make(&fx6, |_| {}).unwrap().path);
        assert_eq!(layout, [2]);
        assert!(
            (average + 13.0).abs() < 1.0,
            "the live pair's level: {average} dB"
        );
        // Hardware first, then software, as on Windows without a GPU: the first encoder's failure isn't the mix's, so
        // the second still mixes the tracks.
        let mut fallback = PlaybackCache::in_folder(&dir.join("fallback"));
        fallback.encoders = vec![vec!["-c:v", "no_such_encoder"], LIGHT_ENCODER.to_vec()];
        let made = fallback.make(&pair, |_| {}).unwrap();
        assert!(!made.silent);
        let (_, average, layout) = sound_of(&made.path);
        assert_eq!(layout, [2]);
        assert!(
            (average + 13.0).abs() < 1.0,
            "still mixed after an encoder failed: {average} dB"
        );
        // Four tracks of the same full-scale tone, the loudest a mix can be: it never reaches full scale.
        let tone = "aevalsrc=sin(2*PI*440*t):s=48000:d=3";
        let four = tracks_clip(&dir, "C0081.mov", &[tone, tone, tone, tone], "pcm_s24le");
        let made = cache.make(&four, |_| {}).unwrap();
        let (loudest, _, layout) = sound_of(&made.path);
        assert_eq!(layout, [2]);
        assert!(!made.silent);
        assert!(loudest < -0.1, "never clips: {loudest} dB");
        assert!(loudest > -3.0, "and not much quieter: {loudest} dB");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_video_whose_every_track_is_silent_gets_a_copy_without_sound_that_says_why_and_isnt_made_again(
    ) {
        let dir = temp_dir("all-silent");
        let mut cache = sound_test_cache(&dir.join("cache"));
        let silence = "anullsrc=r=48000:cl=mono:d=3";
        let clip = tracks_clip(&dir, "C0088.mov", &[silence, silence], "pcm_s24le");
        let made = cache.make(&clip, |_| {}).unwrap();
        assert!(made.silent && made.quiet, "without sound, and why");
        assert!(made.path.to_string_lossy().ends_with("-quiet.mp4"));
        assert!(!video::probe(&made.path).unwrap().has_audio);
        // Whole as it is: found again, and asked for again, nothing is made (an encoder that can't make anything
        // isn't even tried).
        assert_eq!(cache.find(&clip, None).unwrap(), Some(made.clone()));
        cache.encoders = vec![vec!["-c:v", "no_such_encoder"]];
        assert_eq!(cache.make(&clip, |_| {}).unwrap(), made);
        // Not kept as an earlier copy after a failed attempt (which would mark it settled for this run): found whole.
        assert!(!lock(&cache.checked_silent).contains(&key_of(&clip, None).unwrap()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_luts_file_is_made_new_in_a_folder_of_its_own_and_goes_with_it() {
        let lut = Lut {
            sha256: "ab".repeat(32),
            cube: "LUT_3D_SIZE 2\n".to_owned(),
        };
        let (one, two) = (LutFile::write(&lut).unwrap(), LutFile::write(&lut).unwrap());
        assert_ne!(one.folder, two.folder, "never shared");
        assert_eq!(
            fs::read_to_string(one.folder.join(LUT_FILE)).unwrap(),
            lut.cube
        );
        let folder = one.folder.clone();
        drop(one);
        assert!(!folder.exists(), "gone with it");
        assert!(two.folder.join(LUT_FILE).is_file());
    }

    /// An inverting 2-point `.cube`, written here: no camera maker's LUT is ever shipped.
    const INVERT: &str = "LUT_3D_SIZE 2\n1 1 1\n0 1 1\n1 0 1\n0 0 1\n1 1 0\n0 1 0\n1 0 0\n0 0 0\n";

    #[test]
    fn a_lut_grades_a_copy_of_its_own_and_never_the_one_without() {
        let dir = temp_dir("lut-copy");
        let cache = sound_test_cache(&dir.join("cache"));
        let clip = make_clip(
            &dir,
            "C0090.mov",
            &[
                "-f",
                "lavfi",
                "-i",
                "color=c=0x202020:size=320x180:rate=25:duration=1",
            ],
            &["-c:v", "mpeg4", "-q:v", "2"],
        );
        let plain = cache.make(&clip, |_| {}).unwrap();
        assert!(grey_at(&plain.path, 0) < 60, "dark as shot");
        let lut = Lut {
            sha256: "ab".repeat(32),
            cube: INVERT.to_owned(),
        };
        let graded = cache.make_graded(&clip, Some(&lut), |_| {}).unwrap();
        assert_ne!(graded.path, plain.path, "a copy of its own");
        assert!(
            grey_at(&graded.path, 0) > 190,
            "dark through the inverting LUT is light"
        );
        // Each found by its own key; the one without is left as it was.
        assert_eq!(
            cache.find(&clip, Some(&lut.sha256)).unwrap(),
            Some(graded.clone())
        );
        assert_eq!(cache.find(&clip, None).unwrap(), Some(plain.clone()));
        assert!(grey_at(&plain.path, 0) < 60);
        // Said as BT.709 in the file, as the LUT made it.
        let tags = video::command("ffprobe")
            .args(["-v", "error", "-select_streams", "v:0"])
            .args([
                "-show_entries",
                "stream=color_primaries,color_transfer",
                "-of",
                "csv=p=0",
            ])
            .arg(&graded.path)
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&tags.stdout).trim(), "bt709,bt709");

        // A LUT named by anything but a SHA-256 is refused before anything is written.
        let odd = Lut {
            sha256: "../../x".to_owned(),
            cube: INVERT.to_owned(),
        };
        assert_eq!(
            cache.make_graded(&clip, Some(&odd), |_| {}).unwrap_err(),
            FAILED
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// An identity 2-point `.cube`: what goes in comes out.
    const IDENTITY: &str =
        "LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n";

    /// The RGB of the middle of a copy's first frame, read back with the sidecar.
    fn rgb_middle(copy: &Path) -> [i32; 3] {
        let out = video::command("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error", "-i"])
            .arg(copy)
            .args(["-vf", "crop=8:8,scale=1:1:flags=area,format=rgb24"])
            .args(["-frames:v", "1", "-f", "rawvideo", "-"])
            .output()
            .unwrap();
        assert_eq!(out.stdout.len(), 3, "one pixel of {}", copy.display());
        [0, 1, 2].map(|i| i32::from(out.stdout[i]))
    }

    #[test]
    fn an_identity_lut_keeps_a_saturated_colour_as_it_was_tagged_or_not() {
        let dir = temp_dir("lut-colour");
        let cache = sound_test_cache(&dir.join("cache"));
        let lut = Lut {
            sha256: "cd".repeat(32),
            cube: IDENTITY.to_owned(),
        };
        // A strong red-orange, where BT.601 and BT.709 part most; tagged BT.709, and untagged.
        for (name, tags) in [
            (
                "tagged.mov",
                ",setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709",
            ),
            ("untagged.mov", ""),
        ] {
            let clip = make_clip(
                &dir,
                name,
                &[
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=0xC03020:size=320x180:rate=25:duration=1",
                ],
                &[
                    "-vf",
                    &format!("format=yuv420p{tags}"),
                    "-c:v",
                    "mpeg4",
                    "-q:v",
                    "2",
                ],
            );
            let plain = rgb_middle(&cache.make(&clip, |_| {}).unwrap().path);
            let graded = rgb_middle(&cache.make_graded(&clip, Some(&lut), |_| {}).unwrap().path);
            for (channel, (a, b)) in plain.iter().zip(graded).enumerate() {
                assert!(
                    (a - b).abs() <= 3,
                    "{name}: channel {channel} {plain:?} through the LUT {graded:?}"
                );
            }
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn hdr_footage_under_a_lut_is_graded_by_the_lut_alone_even_with_a_matrix_scale_refuses() {
        let dir = temp_dir("lut-hdr");
        let _gone = Gone(dir.clone());
        let cache = sound_test_cache(&dir.join("cache"));
        let lut = Lut {
            sha256: "ef".repeat(32),
            cube: IDENTITY.to_owned(),
        };
        // 203-nit white in PQ, tagged once with a matrix FFmpeg's own filters refuse (as the HDR copy test has).
        for (name, matrix) in [("pq.mov", "bt2020nc"), ("pq ictcp.mov", "ictcp")] {
            let clip = make_clip(
                &dir,
                name,
                &[
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=black:size=320x180:rate=25:duration=1",
                ],
                &[
                    "-vf",
                    &format!(
                        "format=yuv422p10le,geq=lum=572:cb=512:cr=512,setparams=range=tv:\
                         color_primaries=bt2020:color_trc=smpte2084:colorspace={matrix}"
                    ),
                    "-c:v",
                    "prores_ks",
                ],
            );
            let graded = cache.make_graded(&clip, Some(&lut), |_| {}).unwrap();
            // Not tone-mapped (that brings it near SDR white, about 218): the LUT alone made it, from the signal as
            // recorded, which an identity LUT leaves near PQ's own level, about 140.
            let level = grey_at(&graded.path, 0);
            assert!((120..=165).contains(&level), "{name}: {level}");
        }
    }

    #[test]
    fn a_lut_joins_the_key_and_the_request_name_but_no_lut_keeps_the_key_it_had() {
        let dir = temp_dir("lut-key");
        let clip = pcm_clip(&dir, "C0091.mov");
        let sha = "0f".repeat(32);
        let plain = key_of(&clip, None).unwrap();
        assert_ne!(key_of(&clip, Some(&sha)).unwrap(), plain);
        assert_ne!(
            key_of(&clip, Some(&sha)).unwrap(),
            key_of(&clip, Some(&"1e".repeat(32))).unwrap()
        );
        // Without a LUT, what it was before 2.5: no copy made earlier is made again.
        let meta = fs::metadata(&clip).unwrap();
        let modified = meta
            .modified()
            .unwrap()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs()
            & !1;
        let before = format!(
            "{RECIPE}\0{}\0{}\0{modified}",
            clip.to_string_lossy(),
            meta.len()
        );
        assert_eq!(plain, fnv128(before.as_bytes()));
        let path = clip.to_string_lossy();
        assert_eq!(job_name(&path, None), path);
        assert_ne!(job_name(&path, Some(&sha)), path);
        assert!(is_lut_name(&sha));
        assert!(
            !is_lut_name(&"0F".repeat(32)) && !is_lut_name("abc") && !is_lut_name(&"g0".repeat(32))
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// A link where a copy was, to a file outside the folder: not a copy, so not found (serving refuses it too).
    #[cfg(unix)]
    #[test]
    fn a_link_under_a_copys_name_is_not_found() {
        let dir = temp_dir("find-link");
        let cache = sound_test_cache(&dir.join("cache"));
        let silence = "anullsrc=r=48000:cl=mono:d=1";
        let clip = tracks_clip(&dir, "C0089.mov", &[silence], "pcm_s24le");
        let made = cache.make(&clip, |_| {}).unwrap();
        assert_eq!(cache.find(&clip, None).unwrap(), Some(made.clone()));
        fs::write(dir.join("outside.mp4"), b"private").unwrap();
        fs::remove_file(&made.path).unwrap();
        std::os::unix::fs::symlink(dir.join("outside.mp4"), &made.path).unwrap();
        assert_eq!(cache.find(&clip, None).unwrap(), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn keeps_a_single_stereo_track_as_it_is() {
        let dir = temp_dir("stereo-track");
        let cache = sound_test_cache(&dir.join("cache"));
        // A camera's own stereo track, a sine at half scale on each side (-9 dB on average): the copy plays it at the
        // same level, not mixed down.
        let stereo = tracks_clip(
            &dir,
            "C0082.mov",
            &["aevalsrc=0.5*sin(2*PI*440*t)|0.5*sin(2*PI*660*t):s=48000:d=3"],
            "pcm_s24le",
        );
        let (_, average, layout) = sound_of(&cache.make(&stereo, |_| {}).unwrap().path);
        assert_eq!(layout, [2]);
        // Mixed down, or one side only, it would be -12.
        assert!((average + 9.0).abs() < 1.0, "its own level: {average} dB");
        let _ = fs::remove_dir_all(&dir);
    }

    /// Two mono tracks, a sine at half scale on each (440 Hz, then 1000 Hz); the one at index `broken` is then tagged
    /// with a codec ffmpeg doesn't know, so it won't decode.
    fn broken_track_clip(dir: &Path, name: &str, broken: usize) -> PathBuf {
        let (first, second) = if broken == 0 {
            ("pcm_s24le", "pcm_s16le")
        } else {
            ("pcm_s16le", "pcm_s24le")
        };
        let clip = make_clip(
            dir,
            &format!("{name}-whole.mov"),
            &[
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x180:rate=25:duration=3",
                "-f",
                "lavfi",
                "-i",
                "aevalsrc=0.5*sin(2*PI*440*t):s=48000:d=3",
                "-f",
                "lavfi",
                "-i",
                "aevalsrc=0.5*sin(2*PI*1000*t):s=48000:d=3",
            ],
            &[
                "-map", "0:v", "-map", "1:a", "-map", "2:a", "-c:v", "mpeg4", "-c:a:0", first,
                "-c:a:1", second,
            ],
        );
        let mut bytes = fs::read(&clip).unwrap();
        let at = bytes
            .windows(4)
            .position(|w| w == b"in24")
            .expect("the broken track's tag");
        bytes[at..at + 4].copy_from_slice(b"abcd");
        let broken = dir.join(format!("{name}.mov"));
        fs::write(&broken, bytes).unwrap();
        broken
    }

    #[test]
    fn a_mix_that_cant_be_made_leaves_the_tracks_that_decode_or_the_first_and_a_cancel_stops_the_trying(
    ) {
        // One of three won't decode: the other two, mixed. One of two: that one. None: no sound.
        assert_eq!(after_the_mix_failed(&[0, 1, 2], vec![0, 2]), [0, 2]);
        assert_eq!(after_the_mix_failed(&[0, 1], vec![1]), [1]);
        assert!(after_the_mix_failed(&[0, 1], vec![]).is_empty());
        // Each decodes alone: the mix is the trouble, so the first alone, never the same mix again.
        assert_eq!(after_the_mix_failed(&[0, 1, 2, 3], vec![0, 1, 2, 3]), [0]);
        // A Cancel while the tracks are tried: no more are (the make then ends cancelled).
        let dir = temp_dir("tracks-cancel");
        let clip = tracks_clip(
            &dir,
            "C0085.mov",
            &["sine=duration=2", "sine=duration=2"],
            "pcm_s16le",
        );
        let cache = PlaybackCache::in_folder(&dir.join("cache"));
        let asked = cache.ask("C0085");
        assert_eq!(tracks_that_play(&clip, &[0, 1], &asked), [0, 1]);
        cache.cancel("C0085");
        assert!(tracks_that_play(&clip, &[0, 1], &asked).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_mono_track_that_wont_decode_leaves_the_copy_the_one_that_does() {
        let dir = temp_dir("mono-broken");
        let cache = sound_test_cache(&dir.join("cache"));
        // The second track broken, then the first: either way the copy has the other one, never no sound.
        for (broken, name) in [(1, "C0083"), (0, "C0084")] {
            let clip = broken_track_clip(&dir, name, broken);
            assert_eq!(video::audio_tracks(&clip).unwrap(), [1, 1]);
            let made = cache.make(&clip, |_| {}).unwrap();
            assert!(
                !made.silent,
                "the other track plays (track {broken} broken)"
            );
            let (_, average, layout) = sound_of(&made.path);
            assert_eq!(layout, [2]);
            // -9 dB on average as its own track, 3 dB less on each side as one track is spread over two.
            assert!(
                (average + 12.0).abs() < 1.0,
                "the other track alone (track {broken} broken): {average} dB"
            );
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_the_bytes_a_range_asks_for_held_to_a_slice() {
        assert_eq!(byte_range(None, 100), Some((0, 99)));
        assert_eq!(byte_range(Some("bytes=10-19"), 100), Some((10, 19)));
        assert_eq!(byte_range(Some("bytes=90-"), 100), Some((90, 99)));
        assert_eq!(byte_range(Some("bytes=-30"), 100), Some((70, 99)));
        assert_eq!(byte_range(Some("bytes=95-500"), 100), Some((95, 99)));
        // Past the end, backwards, or not bytes: nothing.
        assert_eq!(byte_range(Some("bytes=100-"), 100), None);
        assert_eq!(byte_range(Some("bytes=20-10"), 100), None);
        assert_eq!(byte_range(Some("items=0-1"), 100), None);
        assert_eq!(byte_range(None, 0), None);
        // A big copy, asked for whole: a slice at a time.
        assert_eq!(
            byte_range(Some("bytes=0-"), 10 * SLICE),
            Some((0, SLICE - 1))
        );
        assert_eq!(byte_range(None, 10 * SLICE), Some((0, SLICE - 1)));
    }

    #[test]
    fn serves_a_finished_copy_by_name_in_slices_and_nothing_else() {
        let dir = temp_dir("serve");
        let cache = PlaybackCache::in_folder(&dir.join("cache"));
        let (folder, _) = cache.folder().unwrap();
        let name = format!("{}.mp4", "a".repeat(32));
        let bytes: Vec<u8> = (0..=255).collect();
        fs::write(folder.join(&name), &bytes).unwrap();
        // Whole, with no range; then the bytes a range asks for.
        let whole = serve_copy(&cache, &format!("/{name}"), None);
        assert_eq!((whole.status, whole.body.len()), (200, 256));
        let part = serve_copy(&cache, &format!("/{name}"), Some("bytes=16-31"));
        assert_eq!(part.status, 206);
        assert_eq!(part.body, bytes[16..=31]);
        assert!(part
            .headers
            .contains(&("Content-Range", "bytes 16-31/256".to_owned())));
        assert_eq!(
            serve_copy(&cache, &format!("/{name}"), Some("bytes=300-")).status,
            416
        );
        // Nothing that isn't a finished copy of ours: a partial, another file, a way out of the folder.
        fs::write(folder.join(format!("{name}.partial")), b"half").unwrap();
        fs::write(folder.join("notes.txt"), b"private").unwrap();
        fs::write(dir.join("secret.mp4"), b"private").unwrap();
        // A link under a copy's name, to a file outside: not followed.
        #[cfg(unix)]
        {
            let linked = format!("{}.mp4", "b".repeat(32));
            std::os::unix::fs::symlink(dir.join("secret.mp4"), folder.join(&linked)).unwrap();
            assert_eq!(serve_copy(&cache, &format!("/{linked}"), None).status, 404);
        }
        for path in [
            format!("/{name}.partial"),
            "/notes.txt".to_owned(),
            "/../../secret.mp4".to_owned(),
            format!("/../{}", name),
            "/".to_owned(),
        ] {
            assert_eq!(serve_copy(&cache, &path, None).status, 404, "{path}");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    /// The names in a folder.
    fn names(folder: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(folder)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn names_a_copy_by_the_files_path_size_and_time_to_the_second() {
        let dir = temp_dir("key");
        let clip = dir.join("C0042.MP4");
        fs::write(&clip, "take one").unwrap();
        let at = |seconds: u64, nanos: u32| {
            let file = fs::File::options().write(true).open(&clip).unwrap();
            file.set_modified(SystemTime::UNIX_EPOCH + Duration::new(seconds, nanos))
                .unwrap();
        };
        at(1_800_000_000, 100_000_000);
        let first = key_of(&clip, None).unwrap();
        assert_eq!(first.len(), 32);
        // A share that reports the time coarser one moment and finer the next (to the second, or FAT's two seconds):
        // the same file, the same copy.
        at(1_800_000_000, 700_000_000);
        assert_eq!(key_of(&clip, None).unwrap(), first);
        at(1_800_000_001, 900_000_000);
        assert_eq!(key_of(&clip, None).unwrap(), first);
        at(1_800_000_002, 100_000_000);
        assert_ne!(key_of(&clip, None).unwrap(), first);
        at(1_800_000_000, 100_000_000);
        fs::write(&clip, "take two, longer").unwrap();
        at(1_800_000_000, 100_000_000);
        assert_ne!(key_of(&clip, None).unwrap(), first);
        let whole = Ours {
            key: &first,
            silent: false,
            partial: false,
        };
        assert_eq!(ours(&format!("{first}.mp4")), Some(whole));
        assert_eq!(
            ours(&format!("{first}-silent.mp4.partial")),
            Some(Ours {
                key: &first,
                silent: true,
                partial: true
            })
        );
        assert_eq!(file_name(&first, true), format!("{first}-silent.mp4"));
        // Each attempt at a copy writes a partial of its own.
        assert_eq!(
            ours(&format!("{first}-12-2.mp4.partial")),
            Some(Ours {
                key: &first,
                silent: false,
                partial: true
            })
        );
        let finished_attempt = format!("{first}-12-2.mp4");
        // Not ours: another name, capitals, too short, another suffix.
        let (loud, mov) = (format!("{first}-loud.mp4"), format!("{first}.mov"));
        for name in [
            finished_attempt.as_str(),
            "notes.txt",
            "ABCDEF0123456789ABCDEF0123456789.mp4",
            "C0042.MP4",
            "0123.mp4",
            loud.as_str(),
            mov.as_str(),
            "readme.partial",
        ] {
            assert!(ours(name).is_none(), "{name}");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn makes_a_whole_copy_at_most_1920_wide_at_the_exact_rate_with_a_keyframe_every_12_frames() {
        let dir = temp_dir("make");
        let clip = sbd_clip(&dir, "A001_C003.mov", 2);
        let cache = PlaybackCache::in_folder(&dir.join("cache"));
        let mut seen = Vec::new();
        let made = cache.make(&clip, |done| seen.push(done)).unwrap();
        assert!(!made.silent);
        let copy = made.path.clone();
        assert!(copy.starts_with(dir.join("cache").join(FOLDER_NAME)));
        let name = copy.file_name().unwrap().to_string_lossy().into_owned();
        assert!(ours(&name).is_some_and(|found| !found.partial && !found.silent));
        assert_eq!(seen.last().copied(), Some(1.0));
        let probe = video::probe(&copy).unwrap();
        assert_eq!((probe.fps_num, probe.fps_den), (24000, 1001));
        assert_eq!((probe.width, probe.height), (1920, 1080));
        assert_eq!(probe.duration_frames, 48);
        assert!(probe.has_audio);
        // Stepping and scrubbing land fast: a keyframe every 12 frames, whatever the computer's encoder.
        assert_eq!(keyframes(&copy), [0, 12, 24, 36]);
        assert_eq!(cache.find(&clip, None).unwrap(), Some(made.clone()));
        // Asked again: the same copy, nothing made.
        let mut again = 0;
        assert_eq!(cache.make(&clip, |_| again += 1).unwrap(), made);
        assert_eq!(again, 0);
        // Nothing half-made left beside it, and no job left behind.
        assert_eq!(names(copy.parent().unwrap()), [name]);
        assert!(!cache.info().unwrap().busy);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn starts_the_copy_at_the_videos_first_frame_when_sound_leads_it() {
        let dir = temp_dir("first");
        // Each frame its own grey (8 n mod 32), sound starting a tenth of a second earlier, as AVCHD can.
        let clip = make_clip(
            &dir,
            "00002.MTS",
            &[
                "-f",
                "lavfi",
                "-i",
                "color=c=black:size=64x36:rate=24000/1001:duration=3",
                "-itsoffset",
                "-0.1",
                "-f",
                "lavfi",
                "-i",
                "sine=duration=3",
            ],
            &[
                "-map",
                "0:v",
                "-map",
                "1:a",
                "-vf",
                "format=gray,geq=lum='mod(N,32)*8',format=yuv420p",
                "-c:v",
                "mpeg2video",
                "-q:v",
                "1",
                "-g",
                "12",
                "-c:a",
                "mp2",
            ],
        );
        let cache = PlaybackCache::in_folder(&dir.join("cache"));
        let copy = cache.make(&clip, |_| {}).unwrap().path;
        for n in [0, 1, 30] {
            let expected = (n % 32 * 8) as i32;
            let level = grey_at(&copy, n);
            assert!(
                (level - expected).abs() <= 6,
                "copy frame {n}: grey {level}, expected {expected}"
            );
        }
        let _ = fs::remove_dir_all(&dir);
    }

    /// A 30-second clip: long enough to stop midway.
    fn long_clip(dir: &Path) -> PathBuf {
        make_clip(
            dir,
            "long.mov",
            &[
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=1920x1080:rate=25:duration=30",
            ],
            &["-c:v", "mpeg4", "-q:v", "10"],
        )
    }

    #[test]
    fn cancel_mid_copy_leaves_no_copy_and_nothing_half_made() {
        let dir = temp_dir("cancel");
        let clip = long_clip(&dir);
        let cache = PlaybackCache::in_folder(&dir.join("cache"));
        let name = clip.to_string_lossy().into_owned();
        let mut asked = false;
        let outcome = cache.make(&clip, |_| {
            if !asked {
                asked = true;
                assert!(cache.cancel(&name));
            }
        });
        assert_eq!(outcome.unwrap_err(), CANCELLED);
        assert_eq!(cache.find(&clip, None).unwrap(), None);
        let (folder, _) = cache.folder().unwrap();
        assert_eq!(fs::read_dir(&folder).unwrap().count(), 0, "nothing left");
        assert!(!cache.info().unwrap().busy);
        assert!(!cache.cancel(&name), "nothing left to cancel");
        let _ = fs::remove_dir_all(&dir);
    }

    /// Waits until the video has `count` requests on the list.
    fn wait_for_requests(cache: &PlaybackCache, name: &str, count: usize) {
        for _ in 0..1000 {
            if lock(&cache.jobs).get(name).map_or(0, Vec::len) == count {
                return;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("{count} requests for {name}");
    }

    #[test]
    fn cancel_reaches_a_copy_still_waiting_its_turn_and_it_never_starts() {
        let dir = temp_dir("waiting");
        let clip = sbd_clip(&dir, "C0050.mov", 1);
        let cache = Arc::new(PlaybackCache::in_folder(&dir.join("cache")));
        let name = clip.to_string_lossy().into_owned();
        // Another copy holds the turn.
        let turn = lock(&cache.turn);
        let waiting = {
            let (cache, clip) = (Arc::clone(&cache), clip.clone());
            std::thread::spawn(move || cache.make(&clip, |_| panic!("never encodes")))
        };
        wait_for_requests(&cache, &name, 1);
        assert!(cache.info().unwrap().busy);
        assert!(cache.cancel(&name));
        drop(turn);
        assert_eq!(waiting.join().unwrap().unwrap_err(), CANCELLED);
        assert_eq!(cache.find(&clip, None).unwrap(), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn two_requests_for_one_video_share_one_copy_and_one_cancel_stops_both() {
        let dir = temp_dir("twice");
        let clip = pcm_clip(&dir, "C0052.mov");
        // The queue is tested here, not the encoder: the light one (VideoToolbox wedges on the Mac runner).
        let cache = Arc::new(sound_test_cache(&dir.join("cache")));
        let name = clip.to_string_lossy().into_owned();
        let encodes = Arc::new(AtomicU64::new(0));
        let ask = || {
            let (cache, clip, encodes) = (Arc::clone(&cache), clip.clone(), Arc::clone(&encodes));
            std::thread::spawn(move || {
                let mut heard = false;
                // Only the request that encodes hears any progress (its last word, 1, at least).
                cache.make(&clip, |_| {
                    if !heard {
                        heard = true;
                        encodes.fetch_add(1, Ordering::SeqCst);
                    }
                })
            })
        };
        // Both asked while another copy holds the turn (two frames linking one take, or the queue and the Player).
        let turn = lock(&cache.turn);
        let (first, second) = (ask(), ask());
        wait_for_requests(&cache, &name, 2);
        drop(turn);
        let (first, second) = (first.join().unwrap(), second.join().unwrap());
        assert_eq!(first.unwrap(), second.unwrap(), "one copy for both");
        assert_eq!(encodes.load(Ordering::SeqCst), 1, "made once");
        // Each took only its own entry off the list.
        assert!(lock(&cache.jobs).is_empty());
        assert!(!cache.info().unwrap().busy);

        // One Cancel stops every request for the video, the one waiting and the one encoding.
        assert_eq!(cache.clear().unwrap(), 1);
        let long = long_clip(&dir);
        let long_name = long.to_string_lossy().into_owned();
        let turn = lock(&cache.turn);
        let asks: Vec<_> = (0..2)
            .map(|_| {
                let (cache, long) = (Arc::clone(&cache), long.clone());
                std::thread::spawn(move || cache.make(&long, |_| {}))
            })
            .collect();
        wait_for_requests(&cache, &long_name, 2);
        drop(turn);
        // Until one of them has its ffmpeg running.
        let running = (0..1000).any(|_| {
            std::thread::sleep(Duration::from_millis(10));
            lock(&cache.jobs)
                .get(&long_name)
                .is_some_and(|list| list.iter().any(|job| job.child.is_some()))
        });
        assert!(running, "an ffmpeg started");
        assert!(cache.cancel(&long_name));
        for ask in asks {
            assert_eq!(ask.join().unwrap().unwrap_err(), CANCELLED);
        }
        assert_eq!(cache.find(&long, None).unwrap(), None);
        let (folder, _) = cache.folder().unwrap();
        assert!(names(&folder).is_empty(), "nothing half-made");
        assert!(lock(&cache.jobs).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn keeps_no_copy_of_an_original_that_changed_while_it_was_read() {
        let dir = temp_dir("changed");
        let clip = sbd_clip(&dir, "C0051.mov", 2);
        let cache = PlaybackCache::in_folder(&dir.join("cache"));
        let mut touched = false;
        // An offload still writing the file: it grows during the copy.
        let outcome = cache.make(&clip, |_| {
            if !touched {
                touched = true;
                let mut file = fs::File::options().append(true).open(&clip).unwrap();
                std::io::Write::write_all(&mut file, b"more").unwrap();
            }
        });
        assert_eq!(outcome.unwrap_err(), FAILED);
        let (folder, _) = cache.folder().unwrap();
        assert_eq!(fs::read_dir(&folder).unwrap().count(), 0, "nothing kept");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn makes_a_copy_without_sound_only_when_the_sound_cant_be_read_and_says_so() {
        let dir = temp_dir("silent");
        let good = pcm_clip(&dir, "C0053.mov");
        let clip = unknown_sound(&good, "C0053 unknown sound.mov");
        let cache = PlaybackCache::in_folder(&dir.join("cache"));
        let made = cache.make(&clip, |_| {}).unwrap();
        assert!(made.silent);
        let name = made
            .path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        assert!(name.ends_with("-silent.mp4"), "{name}");
        let probe = video::probe(&made.path).unwrap();
        assert!(!probe.has_audio);
        assert_eq!(probe.duration_frames, 50);
        assert_eq!(cache.find(&clip, None).unwrap(), Some(made.clone()));
        // Asked again in this run: the same copy, nothing made or checked again.
        let mut again = 0;
        assert_eq!(cache.make(&clip, |_| again += 1).unwrap(), made);
        assert_eq!(again, 0);

        // A later run tries the sound once more; it still can't be read, so the copy stays as it is.
        let later = PlaybackCache::in_folder(&dir.join("cache"));
        assert_eq!(later.make(&clip, |_| again += 1).unwrap(), made);
        assert_eq!(again, 0, "not made again");

        // The sound reads in a later run (the app updated, say; here, the good take in the soundless copy's place):
        // a copy with sound is made and the one without goes.
        let good_key = key_of(&good, None).unwrap();
        let (folder, _) = later.folder().unwrap();
        fs::copy(&made.path, folder.join(file_name(&good_key, true))).unwrap();
        let whole = later.make(&good, |_| {}).unwrap();
        assert!(!whole.silent);
        assert!(video::probe(&whole.path).unwrap().has_audio);
        assert!(!folder.join(file_name(&good_key, true)).exists());
        assert_eq!(later.find(&good, None).unwrap(), Some(whole.clone()));

        // A later run whose copy with sound can't be made after all (the encoder failing, say) keeps playing the copy
        // without it rather than having none.
        let mut third = PlaybackCache::in_folder(&dir.join("cache"));
        fs::remove_file(&whole.path).unwrap();
        let soundless = folder.join(file_name(&good_key, true));
        fs::copy(&made.path, &soundless).unwrap();
        third.encoders = vec![vec!["-c:v", "no_such_encoder"]];
        let kept = third.make(&good, |_| {}).unwrap();
        assert_eq!(
            kept,
            Made {
                path: soundless,
                silent: true,
                quiet: false
            }
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn keeps_the_sound_when_something_else_fails_and_tries_the_next_encoder() {
        let dir = temp_dir("encoder");
        let clip = pcm_clip(&dir, "C0054.mov");
        let broken = vec!["-c:v", "no_such_encoder"];
        let mut cache = PlaybackCache::in_folder(&dir.join("cache"));
        // The only encoder fails (a passing hardware error, on a Mac with one): no copy, and never one without sound.
        cache.encoders = vec![broken.clone()];
        assert_eq!(cache.make(&clip, |_| {}).unwrap_err(), FAILED);
        let (folder, _) = cache.folder().unwrap();
        assert!(names(&folder).is_empty(), "nothing kept");
        // An attempt that fails only while the sound is in it, though the sound itself reads (here a sample rate the
        // AAC encoder refuses, which the sound test doesn't ask for): still no copy without sound.
        let mut picky = encoders().pop().unwrap();
        picky.extend(["-ar", "1"]);
        cache.encoders = vec![picky];
        assert_eq!(video::sound_plays(&clip), Ok(true));
        assert_eq!(cache.make(&clip, |_| {}).unwrap_err(), FAILED);
        assert!(
            names(&folder).is_empty(),
            "nothing kept, with sound or without"
        );
        // Hardware first, then software: the second makes a whole copy, with its sound. (The computer's last encoder:
        // Windows' software one, as a CI runner has no GPU.)
        cache.encoders = vec![broken, encoders().pop().unwrap()];
        let made = cache.make(&clip, |_| {}).unwrap();
        assert!(!made.silent);
        assert!(video::probe(&made.path).unwrap().has_audio);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn makes_whole_copies_of_a_trimmed_mov_a_video_with_no_length_and_one_with_no_sound() {
        let dir = temp_dir("lengths");
        let cache = PlaybackCache::in_folder(&dir.join("cache"));
        // A stream copy from between two keyframes: its edit list hides the first 3 s, so 175 of 250 frames play.
        let take = make_clip(
            &dir,
            "C0055.mov",
            &[
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x180:rate=25:duration=10",
            ],
            &["-c:v", "mpeg4", "-g", "100"],
        );
        let trimmed = make_clip(
            &dir,
            "C0055 trimmed.mov",
            &["-ss", "3", "-i", take.to_str().unwrap()],
            &["-c", "copy"],
        );
        let made = cache.make(&trimmed, |_| {}).unwrap();
        assert!(!made.silent, "no sound to lose");
        assert_eq!(video::probe(&made.path).unwrap().duration_frames, 175);
        // A Matroska file written to a pipe never gets its length: nothing to compare with, nothing wrong said.
        let piped = piped_mkv(&dir, "C0056.mkv", 2);
        assert_eq!(video::probe(&piped).unwrap().duration_frames, 0);
        let mut seen = Vec::new();
        let made = cache.make(&piped, |done| seen.push(done)).unwrap();
        assert_eq!(video::probe(&made.path).unwrap().duration_frames, 50);
        assert_eq!(
            seen,
            [1.0],
            "only the end, with no length to measure against"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// The piped Matroska clip: written to a pipe, it never gets its length.
    fn piped_mkv(dir: &Path, name: &str, seconds: u32) -> PathBuf {
        let path = dir.join(name);
        let status = video::command("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i"])
            .arg(format!("testsrc2=size=320x180:rate=25:duration={seconds}"))
            .args(["-c:v", "mpeg4", "-f", "matroska", "-"])
            .stdout(fs::File::create(&path).unwrap())
            .status()
            .unwrap();
        assert!(status.success());
        path
    }

    /// Compiles a shim for reads of any file whose path holds "cutme", past `CUT_AT` bytes, as `CUT_MODE` says: `eio`
    /// fails them as a card pulled midway does; `hang` never returns, as a share that stopped answering; `slow` waits
    /// `CUT_SLOW_MS` before each, as a drive that's slow but working. Linux only, where the sidecar links the C library
    /// dynamically.
    #[cfg(target_os = "linux")]
    fn read_shim(dir: &Path) -> PathBuf {
        let source = dir.join("reads.c");
        fs::write(
            &source,
            r#"
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
static ssize_t (*real_read)(int, void *, size_t);
static int cut(int fd) {
  char link[64], path[4096];
  snprintf(link, sizeof link, "/proc/self/fd/%d", fd);
  ssize_t n = readlink(link, path, sizeof path - 1);
  if (n <= 0) return 0;
  path[n] = 0;
  return strstr(path, "cutme") != NULL;
}
ssize_t read(int fd, void *buf, size_t count) {
  if (!real_read) real_read = dlsym(RTLD_NEXT, "read");
  if (cut(fd)) {
    const char *mode = getenv("CUT_MODE") ? getenv("CUT_MODE") : "eio";
    off_t at = lseek(fd, 0, SEEK_CUR);
    off_t end = atoll(getenv("CUT_AT") ? getenv("CUT_AT") : "0");
    if (at >= end) {
      if (strcmp(mode, "hang") == 0) for (;;) pause();
      if (strcmp(mode, "slow") == 0) usleep(1000 * atoi(getenv("CUT_SLOW_MS") ? getenv("CUT_SLOW_MS") : "0"));
      else { errno = EIO; return -1; }
    } else if (at + (off_t)count > end) {
      count = end - at;
    }
  }
  return real_read(fd, buf, count);
}
"#,
        )
        .unwrap();
        let shim = dir.join("reads.so");
        let status = std::process::Command::new("cc")
            .args(["-shared", "-fPIC", "-O2", "-o"])
            .arg(&shim)
            .arg(&source)
            .arg("-ldl")
            .status()
            .expect("a C compiler (cc) for the read shim");
        assert!(status.success(), "the shim compiled");
        shim
    }

    /// The encode's reads of a "cutme" file go through the shim, as `mode` says, past `at` bytes; the probes before
    /// it read the whole file.
    #[cfg(target_os = "linux")]
    fn through_shim(cache: &mut PlaybackCache, shim: &Path, mode: &str, at: u64) {
        cache.encode_env = vec![
            ("LD_PRELOAD".into(), shim.to_string_lossy().into_owned()),
            ("CUT_MODE".into(), mode.into()),
            ("CUT_AT".into(), at.to_string()),
            ("CUT_SLOW_MS".into(), "120".into()),
        ];
    }

    /// An 8-second take with sound, its index first, as an offload or an edit leaves it.
    #[cfg(target_os = "linux")]
    fn cutme_mov(dir: &Path) -> PathBuf {
        make_clip(
            dir,
            "cutme.mov",
            &[
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=640x360:rate=25:duration=8",
                "-f",
                "lavfi",
                "-i",
                "sine=duration=8",
            ],
            &[
                "-c:v",
                "mpeg4",
                "-q:v",
                "3",
                "-c:a",
                "aac",
                "-movflags",
                "+faststart",
            ],
        )
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_read_that_fails_near_the_end_leaves_no_copy_though_ffmpeg_says_it_went_well() {
        let dir = temp_dir("pulled");
        let shim = read_shim(&dir);
        let clip = cutme_mov(&dir);
        let size = fs::metadata(&clip).unwrap().len();
        let mut cache = PlaybackCache::in_folder(&dir.join("cache"));
        let (folder, _) = cache.folder().unwrap();
        // The last 1% lost: 198 frames of 200, inside the length check's second of slack, so only ffmpeg's own word
        // can tell. Its exit says all went well.
        through_shim(&mut cache, &shim, "eio", size * 99 / 100);
        let asked = cache.ask("cutme");
        let partial = folder.join("probe.mp4.partial");
        let probe = video::probe(&clip).unwrap();
        let run = Run {
            path: &clip,
            partial: &partial,
            rate: (probe.fps_num, probe.fps_den),
            offset: 0.0,
            tone_map: None,
            lut: None,
            retag: "",
            encoder: &cache.encoders[0],
            sound: true,
            tracks: &[],
        };
        let said = cache.encode(&run, &asked, |_| {}).unwrap();
        assert!(said.read_failed, "heard in ffmpeg's own words");
        let short = video::probe(&partial).unwrap().duration_frames;
        assert!((176..200).contains(&short), "{short} frames");
        fs::remove_file(&partial).unwrap();
        drop(asked);
        assert_eq!(cache.make(&clip, |_| {}).unwrap_err(), SHORT);
        assert!(names(&folder).is_empty(), "nothing kept");
        // A file with no length to measure against, cut at half: the same.
        let piped = piped_mkv(&dir, "cutme.mkv", 4);
        through_shim(
            &mut cache,
            &shim,
            "eio",
            fs::metadata(&piped).unwrap().len() / 2,
        );
        assert_eq!(cache.make(&piped, |_| {}).unwrap_err(), SHORT);
        assert!(names(&folder).is_empty(), "nothing kept");
        // The card back in: the copy is made whole.
        cache.encode_env.clear();
        let made = cache.make(&clip, |_| {}).unwrap();
        assert_eq!(video::probe(&made.path).unwrap().duration_frames, 200);
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn stops_an_encode_stuck_on_a_read_partway_though_ffmpeg_goes_on_reporting() {
        let dir = temp_dir("hang");
        let shim = read_shim(&dir);
        let clip = cutme_mov(&dir);
        let mut cache = PlaybackCache::in_folder(&dir.join("cache"));
        // A share that stops answering halfway: ffmpeg's report keeps coming twice a second, its counts standing still.
        through_shim(
            &mut cache,
            &shim,
            "hang",
            fs::metadata(&clip).unwrap().len() / 2,
        );
        cache.stall = Duration::from_secs(3);
        // Hardware then software, as on Windows: the second is tried (the original still answers ffprobe, which reads
        // around the shim), stalls too, and the copy ends as stalled.
        let encoder = encoders().pop().unwrap();
        cache.encoders = vec![encoder.clone(), encoder];
        let cache = Arc::new(cache);
        let (sent, outcome) = mpsc::channel();
        let making = {
            let (cache, clip) = (Arc::clone(&cache), clip.clone());
            std::thread::spawn(move || {
                let mut seen = Vec::new();
                let started = Instant::now();
                let made = cache.make(&clip, |done| seen.push(done));
                let _ = sent.send(());
                (made, seen, started.elapsed())
            })
        };
        // Waited out, the stuck copy would hold every later one up: cancelled then, so the test fails rather than
        // hangs (and its ffmpeg doesn't wait forever).
        if outcome.recv_timeout(Duration::from_secs(60)).is_err() {
            cache.cancel(&clip.to_string_lossy());
            let _ = making.join();
            panic!("the stuck copy was never stopped");
        }
        let (made, seen, took) = making.join().unwrap();
        assert_eq!(made.unwrap_err(), STALLED);
        assert!(
            seen.iter().any(|&done| done > 0.0 && done < 1.0),
            "it had started: {seen:?}"
        );
        // Each attempt reaches the hang within ffmpeg's first report, so the second shows in the time: two stalls.
        assert!(
            took >= 2 * cache.stall,
            "the second encoder was tried too: {took:?}"
        );
        let (folder, _) = cache.folder().unwrap();
        assert!(names(&folder).is_empty(), "nothing half-made");
        assert!(!cache.info().unwrap().busy);
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_slow_drive_that_keeps_going_is_never_taken_for_stalled() {
        let dir = temp_dir("slow");
        let shim = read_shim(&dir);
        let clip = cutme_mov(&dir);
        let mut cache = PlaybackCache::in_folder(&dir.join("cache"));
        // Every read waits, from the first byte: the copy takes well over the stall time, moving all the while.
        through_shim(&mut cache, &shim, "slow", 0);
        cache.stall = Duration::from_secs(2);
        let mut first: Option<Instant> = None;
        let mut seen = Vec::new();
        let made = cache
            .make(&clip, |done| {
                first.get_or_insert_with(Instant::now);
                seen.push(done);
            })
            .unwrap();
        let encoding = first.map(|at| at.elapsed()).unwrap_or_default();
        assert!(
            encoding > 2 * cache.stall,
            "encoding outlasted the stall time: {encoding:?}"
        );
        assert_eq!(video::probe(&made.path).unwrap().duration_frames, 200);
        assert!(
            seen.iter().any(|&done| done > 0.0 && done < 1.0),
            "progress along the way: {seen:?}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn stops_an_encode_that_says_nothing_for_the_stall_time_and_frees_the_turn() {
        let dir = temp_dir("stall");
        let clip = long_clip(&dir);
        // The stall watch is tested here, not the encoder: the light one (VideoToolbox wedges on the Mac runner).
        let mut cache = sound_test_cache(&dir.join("cache"));
        // Shorter than ffmpeg takes to say anything at all.
        cache.stall = Duration::from_millis(1);
        let started = Instant::now();
        assert_eq!(cache.make(&clip, |_| {}).unwrap_err(), STALLED);
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "stopped at once"
        );
        let (folder, _) = cache.folder().unwrap();
        assert!(names(&folder).is_empty(), "nothing half-made");
        assert!(!cache.info().unwrap().busy);
        // The next copy gets its turn and goes through.
        cache.stall = STALL;
        let quick = pcm_clip(&dir, "C0057.mov");
        assert!(cache.make(&quick, |_| {}).is_ok());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_cancel_before_the_original_is_read_and_each_request_ending_on_its_own() {
        let dir = temp_dir("asked");
        let clip = pcm_clip(&dir, "C0059.mov");
        let cache = PlaybackCache::in_folder(&dir.join("cache"));
        let name = clip.to_string_lossy().into_owned();
        // On the list before anything is read (the command puts it there while a slow drive wakes): a Cancel then
        // stops it before it starts.
        let asked = cache.ask(&name);
        assert!(cache.cancel(&name));
        assert_eq!(
            cache
                .make_asked(&asked, &clip, None, |_| panic!("never encodes"))
                .unwrap_err(),
            CANCELLED
        );
        drop(asked);
        // Two requests for one video: one ending takes only its own entry off, so the other can still be cancelled.
        let (first, second) = (cache.ask(&name), cache.ask(&name));
        drop(first);
        assert_eq!(lock(&cache.jobs)[&name].len(), 1);
        assert!(cache.info().unwrap().busy);
        assert!(cache.cancel(&name));
        assert!(second.stopped());
        drop(second);
        assert!(lock(&cache.jobs).is_empty());
        // The app quitting: what's asked from then on is stopped before it starts.
        cache.cancel_all();
        assert!(cache.ask(&name).stopped());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn refuses_one_of_its_own_copies_as_an_original() {
        let dir = temp_dir("own");
        let cache = PlaybackCache::in_folder(&dir.join("cache"));
        let made = cache.make(&pcm_clip(&dir, "C0061.mov"), |_| {}).unwrap();
        assert_eq!(cache.make(&made.path, |_| {}).unwrap_err(), A_COPY);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn while_the_copies_move_none_is_found_or_cleared() {
        let dir = temp_dir("moving");
        // Its 2 GB copy goes even when an assertion fails (NTFS sets the space aside).
        let _gone = Gone(dir.clone());
        // The Move is tested here, not the encoder: the light one (VideoToolbox wedges on the Mac runner).
        let cache = sound_test_cache(&dir.join("cache"));
        let clip = pcm_clip(&dir, "C0062.mov");
        let made = cache.make(&clip, |_| {}).unwrap();
        // A copy over the 1 GB cap, used before the other one (sparse: no gigabytes written).
        let (home, _) = cache.folder().unwrap();
        let big = pretend(&home, 9, 0, 600);
        let file = fs::File::options().write(true).open(&big).unwrap();
        file.set_len(2 * GB).unwrap();
        file.set_modified(SystemTime::now() - Duration::from_secs(600))
            .unwrap();
        drop(file);
        let moving = cache.layout.write().unwrap();
        // Where it is can't be told until the Move is done; a make waits its turn behind the Move.
        assert_eq!(cache.find(&clip, None).unwrap(), None);
        assert_eq!(cache.clear().unwrap_err(), MOVING);
        cache.set_cap(1).unwrap();
        assert!(big.is_file(), "the cap waits for the Move");
        drop(moving);
        assert_eq!(cache.find(&clip, None).unwrap(), Some(made.clone()));
        // A Move keeps to a cap lowered while it ran, once it's done (here a Move with nothing to move).
        assert_eq!(cache.move_to(None).unwrap(), 0);
        assert!(!big.exists() && made.path.is_file());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn hears_a_failed_read_in_ffmpegs_own_words() {
        let mut said = Said::default();
        said.hear("[mpeg4 @ 0x55e8a2b74f80] ac-tex damaged at 37 11\n");
        said.hear("[vist#0:0/h264 @ 0x1] [dec:h264 @ 0x2] Error while decoding stream #0:0: Invalid data found\n");
        assert_eq!(said, Said::default(), "a damaged frame alone is no cut");
        said.hear("[in#0/mov,mp4,m4a,3gp,3g2,mj2 @ 0x55e8a2b2cac0] Error during demuxing: Input/output error\n");
        assert!(said.read_failed && !said.damaged);
        // A MOV whose next piece couldn't be reached: inside the file, the read failed; past its end, the file was cut
        // short (and the length check decides).
        let dir = temp_dir("partial-file");
        let original = dir.join("A001.mov");
        fs::write(&original, vec![0u8; 0x2000]).unwrap();
        let mut said = Said::default();
        said.hear("[in#0/mov,mp4,m4a,3gp,3g2,mj2 @ 0x55e8a2b2cdc0] stream 1, offset 0x1fff: partial file\r\n");
        said.hear("[in#0/mov,mp4,m4a,3gp,3g2,mj2 @ 0x55e8a2b2cdc0] stream 0, offset 0x1f00: partial file\n");
        assert_eq!(said.partial_at, Some(0x1f00), "the earliest");
        assert!(said.settle(&original).read_failed);
        let mut said = Said::default();
        said.hear("[in#0/mov,mp4,m4a,3gp,3g2,mj2 @ 0x55e8a2b2cdc0] stream 1, offset 0x2000: partial file\n");
        let cut_short = said.settle(&original);
        assert!(cut_short.damaged && !cut_short.read_failed);
        // The original gone since: a failed read.
        assert!(said.settle(&dir.join("gone.mov")).read_failed);
        let _ = fs::remove_dir_all(&dir);
        let mut said = Said::default();
        said.hear(
            "[in#0/mxf @ 0x1] Error during demuxing: Invalid data found when processing input\n",
        );
        assert!(said.damaged && !said.read_failed);
        assert_eq!(Stop::Failed(said).message(), FAILED);
        assert_eq!(
            Stop::Failed(Said {
                read_failed: true,
                ..Said::default()
            })
            .message(),
            SHORT
        );
    }

    #[test]
    fn calls_a_copy_whole_only_with_all_its_frames_its_sound_and_nothing_read_wrong() {
        let probe = |frames: u64, audio: bool| video::Probe {
            codec: "h264".into(),
            width: 1920,
            height: 1080,
            sar_num: 1,
            sar_den: 1,
            fps_num: 24000,
            fps_den: 1001,
            duration_frames: frames,
            start_timecode: None,
            rotation: 0,
            has_audio: audio,
            hdr: false,
            bit_depth: 8,
        };
        let fine = Said::default();
        let read_failed = Said {
            read_failed: true,
            ..Said::default()
        };
        let damaged = Said {
            damaged: true,
            ..Said::default()
        };
        assert!(complete(&probe(48, true), true, &probe(48, true), fine));
        // Within a second at 23.976 (24 frames): a cut, a header a little off.
        assert!(complete(&probe(48, true), true, &probe(25, true), fine));
        assert!(!complete(&probe(48, true), true, &probe(23, true), fine));
        // Longer than the header said: nothing missing.
        assert!(complete(&probe(48, true), true, &probe(60, true), fine));
        assert!(
            !complete(&probe(48, true), true, &probe(48, false), fine),
            "the sound lost"
        );
        assert!(
            complete(&probe(48, true), false, &probe(48, false), fine),
            "made without on purpose"
        );
        // A read that failed partway is a cut, however long the copy came out.
        assert!(!complete(
            &probe(48, true),
            true,
            &probe(48, true),
            read_failed
        ));
        // A damaged tail with every frame there is still whole.
        assert!(complete(&probe(48, true), true, &probe(48, true), damaged));
        // A 40-minute take: one frame in a hundred of slack.
        assert!(complete(
            &probe(57_600, true),
            true,
            &probe(57_100, true),
            fine
        ));
        assert!(!complete(
            &probe(57_600, true),
            true,
            &probe(50_000, true),
            fine
        ));
        // No length to compare with: whole unless ffmpeg said the data went wrong.
        assert!(complete(&probe(0, true), true, &probe(900, true), fine));
        assert!(!complete(&probe(0, true), true, &probe(900, true), damaged));
    }

    /// A pretend copy of `bytes`, last used `ago` seconds back.
    fn pretend(folder: &Path, seed: u8, bytes: usize, ago: u64) -> PathBuf {
        fs::create_dir_all(folder).unwrap();
        let path = folder.join(format!("{:032x}.mp4", u128::from(seed)));
        // Its length only: the file system needn't hold the bytes.
        let file = fs::File::create(&path).unwrap();
        file.set_len(bytes as u64).unwrap();
        file.set_modified(SystemTime::now() - Duration::from_secs(ago))
            .unwrap();
        path
    }

    #[test]
    fn keeps_under_the_cap_by_deleting_the_copies_used_longest_ago_and_nothing_else() {
        let dir = temp_dir("cap");
        let cache = PlaybackCache::in_folder(&dir);
        let (folder, _) = cache.folder().unwrap();
        let old = pretend(&folder, 1, 1000, 300);
        let older = pretend(&folder, 2, 1000, 600);
        let new = pretend(&folder, 3, 1000, 10);
        // Not ours, though they sit in the folder or look a little like copies, and one being made: never touched.
        let foreign = [
            folder.join("notes.txt"),
            folder.join("A001_C003.mp4"),
            dir.join(format!("{:032x}.mp4", 9)),
            folder.join(format!("{:032x}.mp4.partial", 10)),
            folder.join(format!("{:032x}-silent.mp4.partial", 11)),
        ];
        for f in &foreign {
            fs::write(f, vec![0u8; 5000]).unwrap();
        }
        let folders = [folder.clone()];
        keep_under(&folders, &new, 2000);
        assert!(!older.exists() && old.exists() && new.exists());
        // The copy just made stays even when it alone is over the cap.
        keep_under(&folders, &new, 10);
        assert!(!old.exists() && new.exists());
        assert!(foreign.iter().all(|f| f.exists()));
        // Clear deletes our copies, with sound or without, and only those.
        pretend(&folder, 4, 10, 0);
        fs::write(folder.join(format!("{:032x}-silent.mp4", 5)), "x").unwrap();
        assert_eq!(cache.clear().unwrap(), 3);
        assert!(foreign.iter().all(|f| f.exists()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn moves_the_copies_to_another_folder_and_back_and_stands_in_for_a_drive_that_isnt_there() {
        let dir = temp_dir("move");
        let cache = PlaybackCache::in_folder(&dir.join("cache"));
        let (home, _) = cache.folder().unwrap();
        let copy = pretend(&home, 7, 100, 0);
        let drive = dir.join("Drive");
        fs::create_dir_all(&drive).unwrap();
        assert!(!cache.info().unwrap().moved);
        assert_eq!(cache.move_to(Some(&drive)).unwrap(), 1);
        assert!(cache.info().unwrap().moved, "moved to a folder picked");
        let moved = drive.join(FOLDER_NAME).join(copy.file_name().unwrap());
        assert!(moved.is_file() && !copy.exists());
        assert!(!home.exists(), "the empty old folder goes");
        assert_eq!(cache.folder().unwrap(), (drive.join(FOLDER_NAME), false));
        assert!(cache.settings().leftovers.is_empty());

        // The drive unplugged: copies go to the cache folder meanwhile, and the app says so.
        let away = dir.join("Drive away");
        fs::rename(&drive, &away).unwrap();
        assert_eq!(cache.folder().unwrap(), (home.clone(), true));
        assert!(cache.info().unwrap().fallback);
        let meanwhile = pretend(&home, 8, 100, 0);
        // Back again: what was made meanwhile is still counted, found and cleared.
        fs::rename(&away, &drive).unwrap();
        assert!(!cache.folder().unwrap().1);
        let info = cache.info().unwrap();
        assert_eq!((info.copies, info.bytes), (2, 200));

        // And back to the cache folder for good: both folders' copies end up there.
        assert_eq!(cache.move_to(None).unwrap(), 1);
        assert!(!cache.info().unwrap().moved, "back in the cache folder");
        assert!(home.join(moved.file_name().unwrap()).is_file() && meanwhile.is_file());
        assert_eq!(cache.folder().unwrap(), (home.clone(), false));
        assert_eq!(cache.clear().unwrap(), 2);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_move_cut_short_or_from_an_unplugged_drive_leaves_no_copy_where_the_app_doesnt_look() {
        let dir = temp_dir("leftovers");
        let cache = PlaybackCache::in_folder(&dir.join("cache"));
        let (a, b) = (dir.join("Drive A"), dir.join("Drive B"));
        fs::create_dir_all(&a).unwrap();
        fs::create_dir_all(&b).unwrap();
        cache.move_to(Some(&a)).unwrap();
        let on_a = pretend(&a.join(FOLDER_NAME), 1, 100, 0);
        // A move from A to B cut short by a crash: the setting says B, with A still on the list.
        cache
            .update(|settings| {
                settings.root = Some(b.clone());
                settings.leftovers = vec![a.join(FOLDER_NAME)];
            })
            .unwrap();
        let info = cache.info().unwrap();
        assert_eq!(info.copies, 1, "A's copy is still counted");
        let clip = dir.join("C0058.mov");
        fs::write(&clip, "take").unwrap();
        let key = key_of(&clip, None).unwrap();
        fs::rename(&on_a, a.join(FOLDER_NAME).join(file_name(&key, false))).unwrap();
        assert_eq!(
            cache.find(&clip, None).unwrap().map(|made| made.path),
            Some(a.join(FOLDER_NAME).join(file_name(&key, false)))
        );
        // The next move takes it along, and A comes off the list.
        assert_eq!(cache.move_to(Some(&b)).unwrap(), 1);
        assert!(b.join(FOLDER_NAME).join(file_name(&key, false)).is_file());
        assert!(cache.settings().leftovers.is_empty());

        // A move while the picked drive is unplugged: its copies are moved once it's back.
        let on_b = b.join(FOLDER_NAME).join(file_name(&key, false));
        let unplugged = dir.join("Drive B away");
        fs::rename(&b, &unplugged).unwrap();
        assert_eq!(cache.move_to(Some(&a)).unwrap(), 0);
        assert_eq!(cache.settings().leftovers, [b.join(FOLDER_NAME)]);
        fs::rename(&unplugged, &b).unwrap();
        assert!(on_b.is_file());
        assert_eq!(
            cache.info().unwrap().copies,
            1,
            "counted again once it's back"
        );
        assert_eq!(cache.move_to(None).unwrap(), 1);
        assert!(cache.settings().leftovers.is_empty());
        assert!(cache
            .find(&clip, None)
            .unwrap()
            .is_some_and(|made| made.path.starts_with(dir.join("cache"))));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn moves_across_drives_through_a_partial_and_never_leaves_a_copy_where_the_app_doesnt_look() {
        let dir = temp_dir("across");
        let (from, to) = (dir.join("from"), dir.join("to"));
        let copy = pretend(&from, 1, 300, 0);
        fs::create_dir_all(&to).unwrap();
        let target = to.join(copy.file_name().unwrap());
        assert!(move_one(&copy, &target, true, |_| true));
        assert!(target.is_file() && !copy.exists());
        assert_eq!(fs::read(&target).unwrap().len(), 300);
        assert_eq!(fs::read_dir(&to).unwrap().count(), 1, "no partial left");
        // A copy that can't be moved (the target folder gone, the drive full) stays where it was.
        let stuck = pretend(&from, 2, 10, 0);
        assert!(!move_one(
            &stuck,
            &dir.join("gone").join("x.mp4"),
            true,
            |_| true
        ));
        assert!(stuck.exists());
        assert!(!dir.join("gone").exists());

        // A foreign file in the old folder stays, and so does the folder that holds it.
        let cache = PlaybackCache::in_folder(&dir.join("cache"));
        let (home, _) = cache.folder().unwrap();
        pretend(&home, 3, 10, 0);
        fs::write(home.join("notes.txt"), "mine").unwrap();
        assert_eq!(cache.move_to(Some(&to)).unwrap(), 1);
        assert!(home.join("notes.txt").is_file());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn cleans_up_copies_cut_off_by_a_crash_in_its_turn_and_leaves_everything_else() {
        let dir = temp_dir("partial");
        let folder = dir.join("cache").join(FOLDER_NAME);
        fs::create_dir_all(&folder).unwrap();
        let cut = folder.join(format!("{:032x}.mp4.partial", 5));
        let cut_silent = folder.join(format!("{:032x}-silent.mp4.partial", 7));
        let done = folder.join(format!("{:032x}.mp4", 6));
        let other = folder.join("readme.partial");
        for f in [&cut, &cut_silent, &done, &other] {
            fs::write(f, "x").unwrap();
        }
        let cache = Arc::new(PlaybackCache::load(&dir.join("data"), &dir.join("cache")));
        // A copy being made holds the turn: its partial is never deleted from under it.
        let turn = lock(&cache.turn);
        let cleaning = {
            let cache = Arc::clone(&cache);
            std::thread::spawn(move || cache.clean_up())
        };
        std::thread::sleep(Duration::from_millis(200));
        assert!(cut.exists() && !cleaning.is_finished(), "waits its turn");
        drop(turn);
        cleaning.join().unwrap();
        assert!(!cut.exists() && !cut_silent.exists() && done.exists() && other.exists());
        cache.set_cap(20).unwrap();
        let saved = fs::read(dir.join("data").join("playback.json")).unwrap();
        let settings: Settings = serde_json::from_slice(&saved).unwrap();
        assert_eq!(settings.cap_gb, 20);
        assert!(cache.set_cap(0).is_err());
        // A settings file from another version, with a field this one doesn't know and some missing, still reads.
        let other: Settings = serde_json::from_str(r#"{"capGb": 30, "later": true}"#).unwrap();
        assert_eq!(
            other,
            Settings {
                root: None,
                cap_gb: 30,
                floor_gb: DEFAULT_FLOOR_GB,
                leftovers: Vec::new(),
            }
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_settings_file_that_cant_be_read_is_set_aside_never_written_over() {
        let dir = temp_dir("settings");
        let data = dir.join("data");
        fs::create_dir_all(&data).unwrap();
        let file = data.join("playback.json");
        // A later version's settings, or a damaged file.
        let theirs = r#"{"root": "/Volumes/Drive", "capGb": "fifty"}"#;
        fs::write(&file, theirs).unwrap();
        let cache = PlaybackCache::load(&data, &dir.join("cache"));
        assert_eq!(cache.settings(), Settings::default());
        cache.set_cap(20).unwrap();
        assert_eq!(
            fs::read_to_string(data.join("playback.json.unreadable")).unwrap(),
            theirs
        );
        let saved: Settings = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
        assert_eq!(saved.cap_gb, 20);
        // Changes at once never mix in the file or undo each other.
        let cache = Arc::new(cache);
        let setters: Vec<_> = [1u64, 1000]
            .into_iter()
            .map(|from| {
                let cache = Arc::clone(&cache);
                std::thread::spawn(move || (from..from + 100).all(|gb| cache.set_cap(gb).is_ok()))
            })
            .collect();
        for setter in setters {
            assert!(setter.join().unwrap(), "every change saved");
        }
        let saved: Settings = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
        assert_eq!(saved, cache.settings());
        assert!([100, 1099].contains(&saved.cap_gb), "{}", saved.cap_gb);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_copy_that_cant_move_stays_and_its_folder_stays_on_the_list() {
        let dir = temp_dir("stuck");
        let cache = PlaybackCache::in_folder(&dir.join("cache"));
        let (home, _) = cache.folder().unwrap();
        let drive = dir.join("Drive");
        let stays = pretend(&home, 1, 100, 0);
        let goes = pretend(&home, 2, 100, 0);
        // A copy that can't be written there (its name taken by a folder, as a full or failing drive would refuse it),
        // and a half copy a crash left.
        let target = drive.join(FOLDER_NAME);
        fs::create_dir_all(target.join(stays.file_name().unwrap())).unwrap();
        let crashed = home.join(format!("{:032x}-3-1.mp4.partial", 9));
        fs::write(&crashed, "x").unwrap();
        assert_eq!(cache.move_to(Some(&drive)).unwrap(), 1);
        assert!(target.join(goes.file_name().unwrap()).is_file() && !goes.exists());
        assert!(stays.is_file(), "kept where it was");
        assert!(!crashed.exists(), "the half copy went");
        // The cache folder is always looked in, so the copy is still counted, found and moved by the next Move.
        assert_eq!(cache.info().unwrap().copies, 2);
        fs::remove_dir(target.join(stays.file_name().unwrap())).unwrap();
        assert_eq!(cache.move_to(Some(&drive)).unwrap(), 1);
        assert_eq!(cache.info().unwrap().copies, 2);
        assert!(!home.exists());

        // The same from a picked drive: its folder stays on the list.
        let other = dir.join("Other");
        let on_drive = target.join(stays.file_name().unwrap());
        let blocked = other.join(FOLDER_NAME).join(on_drive.file_name().unwrap());
        fs::create_dir_all(&blocked).unwrap();
        assert_eq!(cache.move_to(Some(&other)).unwrap(), 1);
        assert!(on_drive.is_file());
        assert_eq!(cache.settings().leftovers, std::slice::from_ref(&target));
        assert_eq!(cache.info().unwrap().copies, 2);
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn counts_a_folder_once_however_its_spelled() {
        let dir = temp_dir("alias");
        let cache = PlaybackCache::in_folder(&dir.join("cache"));
        let (home, _) = cache.folder().unwrap();
        let copy = pretend(&home, 1, 1000, 0);
        // A picked folder that is the cache folder by another name.
        let alias = dir.join("alias");
        std::os::unix::fs::symlink(dir.join("cache"), &alias).unwrap();
        assert_eq!(cache.move_to(Some(&alias)).unwrap(), 0);
        assert_eq!(cache.info().unwrap().copies, 1);
        // The copy just made, by either spelling, stays under the cap, though the folder be listed under both.
        let both = [alias.join(FOLDER_NAME), home.clone()];
        keep_under(&both, &copy, 600);
        assert!(copy.is_file());
        keep_under(
            &both,
            &alias.join(FOLDER_NAME).join(copy.file_name().unwrap()),
            600,
        );
        assert!(copy.is_file());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_file_cut_short_on_a_healthy_drive_still_gets_its_copy() {
        let dir = temp_dir("truncated");
        // An export with its index first whose copy stopped just before the end: the last pieces aren't there.
        let whole = make_clip(
            &dir,
            "A001_C009.mov",
            &[
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=640x360:rate=25:duration=8",
                "-f",
                "lavfi",
                "-i",
                "sine=duration=8",
            ],
            &[
                "-c:v",
                "mpeg4",
                "-q:v",
                "3",
                "-c:a",
                "aac",
                "-movflags",
                "+faststart",
            ],
        );
        let bytes = fs::read(&whole).unwrap();
        let cut = dir.join("A001_C009 cut.mov");
        // A cut that takes two or three whole frames with it, well inside the second of slack.
        fs::write(&cut, &bytes[..bytes.len() * 985 / 1000]).unwrap();
        let cache = PlaybackCache::in_folder(&dir.join("cache"));
        let made = cache.make(&cut, |_| {}).unwrap();
        let frames = video::probe(&made.path).unwrap().duration_frames;
        assert!((190..200).contains(&frames), "{frames} frames");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_settings_file_there_but_unreadable_refuses_a_move_it_couldnt_remember() {
        let dir = temp_dir("unreadable");
        let data = dir.join("data");
        // Something at playback.json that can't be read as a file.
        fs::create_dir_all(data.join("playback.json")).unwrap();
        let cache = PlaybackCache::load(&data, &dir.join("cache"));
        assert_eq!(cache.move_to(Some(&dir)).unwrap_err(), UNSAVED);
        assert_eq!(cache.settings().root, None);
        // The cap still changes for this run.
        cache.set_cap(20).unwrap();
        assert_eq!(cache.info().unwrap().cap_gb, 20);
        assert!(data.join("playback.json").is_dir(), "never written over");
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_failure_after_a_stall_reports_the_stall() {
        let dir = temp_dir("stall-then-fail");
        let _gone = Gone(dir.clone());
        let shim = read_shim(&dir);
        let clip = cutme_mov(&dir);
        let mut cache = PlaybackCache::in_folder(&dir.join("cache"));
        through_shim(
            &mut cache,
            &shim,
            "hang",
            fs::metadata(&clip).unwrap().len() / 2,
        );
        cache.stall = Duration::from_secs(2);
        // The hardware encoder hangs; the software one then fails outright, saying nothing of its own.
        cache.encoders = vec![encoders().pop().unwrap(), vec!["-c:v", "no_such_encoder"]];
        let cache = Arc::new(cache);
        let (sent, outcome) = mpsc::channel();
        let making = {
            let (cache, clip) = (Arc::clone(&cache), clip.clone());
            std::thread::spawn(move || {
                let made = cache.make(&clip, |_| {});
                let _ = sent.send(());
                made
            })
        };
        // A stall never caught would hang here for good: cancelled, so the test fails instead.
        if outcome.recv_timeout(Duration::from_secs(60)).is_err() {
            cache.cancel(&clip.to_string_lossy());
            let _ = making.join();
            panic!("the stuck copy was never stopped");
        }
        assert_eq!(making.join().unwrap().unwrap_err(), STALLED);
        assert_eq!(
            cache.attempts.load(Ordering::SeqCst),
            2,
            "both encoders tried"
        );
    }

    #[test]
    fn makes_hdr_copies_in_normal_range_tagged_bt709() {
        let dir = temp_dir("hdr");
        let _gone = Gone(dir.clone());
        // 203-nit reference white, PQ and HLG (video.rs has the same clips for stills).
        let white = |name: &str, luma: u32, transfer: &str, matrix: &str| {
            make_clip(
                &dir,
                name,
                &[
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=black:size=320x180:rate=25:duration=1",
                ],
                // Tagged on the frames: an encoder takes its colour from them.
                &[
                    "-vf",
                    &format!(
                        "format=yuv422p10le,geq=lum={luma}:cb=512:cr=512,setparams=range=tv:\
                         color_primaries=bt2020:color_trc={transfer}:colorspace={matrix}"
                    ),
                    "-c:v",
                    "prores_ks",
                ],
            )
        };
        let cache = PlaybackCache::in_folder(&dir.join("cache"));
        // The last tagged with a matrix FFmpeg's own filters refuse: re-tagged for them, read as itself by zscale.
        for clip in [
            white("pq.mov", 572, "smpte2084", "bt2020nc"),
            white("hlg.mov", 721, "arib-std-b67", "bt2020nc"),
            white("pq ictcp.mov", 572, "smpte2084", "ictcp"),
        ] {
            assert!(video::probe(&clip).unwrap().hdr);
            let made = cache.make(&clip, |_| {}).unwrap();
            assert!(!video::probe(&made.path).unwrap().hdr);
            let tags = video::command("ffprobe")
                .args(["-v", "error", "-select_streams", "v:0", "-show_entries"])
                .args([
                    "stream=color_transfer,color_primaries,color_space",
                    "-of",
                    "csv=p=0",
                ])
                .arg(&made.path)
                .output()
                .unwrap();
            assert_eq!(
                String::from_utf8_lossy(&tags.stdout).trim(),
                "bt709,bt709,bt709"
            );
            // Near SDR white in the copy's own (limited) range: 218 measured with MPEG-4 and Microsoft's software H.264,
            // 236 with a Windows GPU's (a step past limited white); untouched PQ would be about 140.
            let level = grey_at(&made.path, 0);
            assert!((205..=240).contains(&level), "{}: {level}", clip.display());
        }
    }

    #[test]
    fn makes_a_copy_of_an_av1_video() {
        let dir = temp_dir("av1-copy");
        let _gone = Gone(dir.clone());
        let vector = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("testdata")
            .join("av1-1-b8-01-size-226x226.ivf");
        let clip = make_clip(
            &dir,
            "av1.mp4",
            &["-i", vector.to_str().unwrap()],
            &["-c", "copy"],
        );
        let cache = PlaybackCache::in_folder(&dir.join("cache"));
        let made = cache.make(&clip, |_| {}).unwrap();
        let probe = video::probe(&made.path).unwrap();
        assert_eq!(
            (probe.width, probe.height, probe.duration_frames),
            (226, 226, 2)
        );
    }

    /// A drive that holds `folder` and `budget` bytes in all: what it has free is the budget less what's in the folder,
    /// so a copy made, removed or growing counts as it would. Any other folder's free space can't be told.
    fn drive(folder: &Path, budget: &Arc<AtomicU64>) -> FreeSpace {
        let (folder, budget) = (folder.to_path_buf(), Arc::clone(budget));
        Arc::new(move |asked: &Path| {
            (real(asked) == real(&folder)).then(|| {
                budget
                    .load(Ordering::SeqCst)
                    .saturating_sub(bytes_in(&folder))
            })
        })
    }

    fn bytes_in(folder: &Path) -> u64 {
        fs::read_dir(folder)
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|entry| entry.metadata().ok())
            .map(|meta| meta.len())
            .sum()
    }

    #[test]
    fn makes_room_from_the_copies_used_longest_ago_never_the_videos_own() {
        let dir = temp_dir("others");
        let folder = dir.join(FOLDER_NAME);
        let key = format!("{:032x}", 7u128);
        let oldest = pretend(&folder, 1, 100, 400);
        let older = pretend(&folder, 2, 100, 300);
        let newest = pretend(&folder, 3, 100, 100);
        // The video's own copy without sound, used longest ago of all, and a half copy: never among them.
        let own = folder.join(file_name(&key, true));
        fs::write(&own, vec![0u8; 500]).unwrap();
        fs::File::options()
            .write(true)
            .open(&own)
            .unwrap()
            .set_modified(SystemTime::now() - Duration::from_secs(900))
            .unwrap();
        fs::write(folder.join(format!("{key}-0-1.mp4.partial")), b"half").unwrap();
        let paths: Vec<PathBuf> = others(&folder, &key).into_iter().map(|c| c.path).collect();
        assert_eq!(paths, [oldest.clone(), older.clone(), newest.clone()]);
        // 150 bytes short: the two used longest ago go, one at a time, and the third stays.
        let budget = Arc::new(AtomicU64::new(bytes_in(&folder) + 1_000 - 150));
        let (free, held) = (drive(&folder, &budget), Held::default());
        let disk = Drive {
            free: &free,
            held: &held,
            folder: &folder,
        };
        assert!(disk.room_for(&key, 1_000, 0));
        assert!(!oldest.exists() && !older.exists() && newest.exists() && own.exists());
        // More than all of them together: none goes.
        assert!(!disk.room_for(&key, 10_000, 0));
        assert!(newest.exists() && own.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    /// Makes a file impossible to remove while the returned guard lives: held open without sharing on Windows, locked
    /// on a Mac.
    #[cfg(any(windows, target_os = "macos"))]
    fn unremovable(path: &Path) -> impl Drop {
        struct Locked(PathBuf, Option<fs::File>);
        impl Drop for Locked {
            fn drop(&mut self) {
                self.1.take();
                #[cfg(target_os = "macos")]
                let _ = Command::new("chflags").arg("nouchg").arg(&self.0).status();
                #[cfg(windows)]
                let _ = &self.0;
            }
        }
        #[cfg(windows)]
        let held = {
            use std::os::windows::fs::OpenOptionsExt;
            Some(
                fs::File::options()
                    .read(true)
                    .share_mode(0)
                    .open(path)
                    .unwrap(),
            )
        };
        #[cfg(target_os = "macos")]
        let held = {
            assert!(Command::new("chflags")
                .arg("uchg")
                .arg(path)
                .status()
                .unwrap()
                .success());
            None
        };
        Locked(path.to_path_buf(), held)
    }

    #[cfg(any(windows, target_os = "macos"))]
    #[test]
    fn passes_over_a_copy_that_cant_be_removed_only_while_the_rest_can_make_the_room() {
        let dir = temp_dir("held");
        let folder = dir.join(FOLDER_NAME);
        let key = format!("{:032x}", 7u128);
        let stuck = pretend(&folder, 1, 2_000_000, 300);
        let older = pretend(&folder, 2, 1_000_000, 200);
        let newest = pretend(&folder, 3, 1_000_000, 100);
        let lock = unremovable(&stuck);
        let budget = Arc::new(AtomicU64::new(0));
        let (free, held) = (drive(&folder, &budget), Held::default());
        let disk = Drive {
            free: &free,
            held: &held,
            folder: &folder,
        };
        // 3.5 MB short: with the one used longest ago held, the other two can't make it, so neither goes.
        budget.store(bytes_in(&folder) + 10_000_000 - 3_500_000, Ordering::SeqCst);
        assert!(!disk.room_for(&key, 10_000_000, 0));
        assert!(stuck.exists() && older.exists() && newest.exists());
        // 1.5 MB short: it's passed over, and the other two make the room.
        budget.store(bytes_in(&folder) + 10_000_000 - 1_500_000, Ordering::SeqCst);
        assert!(disk.room_for(&key, 10_000_000, 0));
        assert!(stuck.exists() && !older.exists() && !newest.exists());
        drop(lock);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_drive_that_doesnt_give_the_space_back_is_remembered_until_it_does() {
        let dir = temp_dir("snapshot");
        let folder = dir.join(FOLDER_NAME);
        let key = format!("{:032x}", 7u128);
        for seed in 1..=3 {
            pretend(&folder, seed, 2_000_000, 100 * u64::from(seed));
        }
        // A Time Machine snapshot keeps every copy's space: removing one frees nothing.
        let reading = Arc::new(AtomicU64::new(GB));
        let free: FreeSpace = {
            let reading = Arc::clone(&reading);
            Arc::new(move |_| Some(reading.load(Ordering::SeqCst)))
        };
        let held = Held::default();
        let disk = Drive {
            free: &free,
            held: &held,
            folder: &folder,
        };
        let wanted = GB + 3_000_000;
        assert!(!disk.room_for(&key, wanted, 0));
        assert_eq!(names(&folder).len(), 2, "one went, and the rest stayed");
        // Asked again (the next video, a retry), or the drive a little freer (a log trimmed, a refused copy's own
        // partial gone): remembered, and nothing more goes.
        assert!(!disk.room_for(&key, wanted, 0));
        reading.store(GB + 1, Ordering::SeqCst);
        assert!(!disk.room_for(&key, wanted, 0));
        assert_eq!(names(&folder).len(), 2);
        // Half the removed copy's space back: forgotten, and room is tried again (this drive keeps it again).
        reading.store(GB + 1_000_000, Ordering::SeqCst);
        assert!(!disk.room_for(&key, wanted, 0));
        assert_eq!(names(&folder).len(), 1);
        // Room enough without removing anything: the copy goes ahead, and the drive is forgotten.
        reading.store(GB + 4_000_000, Ordering::SeqCst);
        assert!(disk.room_for(&key, wanted, 0));
        assert!(held.lock().unwrap().is_empty() && names(&folder).len() == 1);
        // A refusal that gives space back itself (a finished copy not kept) counts that too.
        pretend(&folder, 4, 2_000_000, 50);
        reading.store(GB, Ordering::SeqCst);
        assert!(!disk.room_for(&key, wanted, 50_000_000));
        // (1 MB short, with a 2 MB copy that could make it were the drive not remembered.)
        reading.store(GB + 20_000_000, Ordering::SeqCst);
        assert!(!disk.room_for(&key, GB + 21_000_000, 0));
        assert_eq!(names(&folder).len(), 1, "still remembered");
        // Time passing forgets it too (so does a Move).
        lock(&held).insert(folder.clone(), (u64::MAX, Instant::now()));
        assert!(disk.room_for(&key, GB + 20_000_000, 0));
        assert!(held.lock().unwrap().is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn waits_a_moment_for_a_drive_that_reports_freed_space_late() {
        let dir = temp_dir("late");
        let folder = dir.join(FOLDER_NAME);
        let key = format!("{:032x}", 7u128);
        let oldest = pretend(&folder, 1, 2_000_000, 200);
        let newest = pretend(&folder, 2, 2_000_000, 100);
        // A NAS: what it has free shows only every fourth reading.
        let budget = bytes_in(&folder) + 10_000_000 - 1_000_000;
        let shown = Mutex::new((0u32, 0u64));
        let free: FreeSpace = {
            let folder = folder.clone();
            Arc::new(move |_| {
                let truth = budget.saturating_sub(bytes_in(&folder));
                let mut shown = lock(&shown);
                if shown.0 % 4 == 0 {
                    shown.1 = truth;
                }
                shown.0 += 1;
                Some(shown.1)
            })
        };
        let held = Held::default();
        let disk = Drive {
            free: &free,
            held: &held,
            folder: &folder,
        };
        assert!(disk.room_for(&key, 10_000_000, 0));
        assert!(!oldest.exists() && newest.exists() && held.lock().unwrap().is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn makes_room_above_the_floor_before_a_copy_starts_or_refuses_and_removes_none() {
        let dir = temp_dir("floor");
        let mut cache = PlaybackCache::in_folder(&dir.join("cache"));
        cache.set_floor(1).unwrap();
        let (folder, _) = cache.folder().unwrap();
        let oldest = pretend(&folder, 1, 2_000_000, 300);
        let older = pretend(&folder, 2, 2_000_000, 200);
        let newest = pretend(&folder, 3, 2_000_000, 100);
        // Two seconds of video: about 3.2 MB to make, with 1 GB left free.
        let needs = 2 * BYTES_A_SECOND;
        // 3 MB short: the two copies used longest ago make the room, and nothing else goes.
        let budget = Arc::new(AtomicU64::new(GB + needs + 3_000_000));
        cache.free = drive(&folder, &budget);
        let made = cache.make(&pcm_clip(&dir, "C0070.mov"), |_| {}).unwrap();
        assert!(
            !oldest.exists() && !older.exists(),
            "used longest ago, gone"
        );
        assert!(newest.exists() && made.path.is_file());
        // Short by more than every other copy here together: none goes, and the copy isn't made.
        budget.store(GB + needs - 1, Ordering::SeqCst);
        let other = pcm_clip(&dir, "C0071.mov");
        assert_eq!(cache.make(&other, |_| {}).unwrap_err(), NO_ROOM);
        assert!(
            newest.exists() && made.path.is_file(),
            "nothing removed for it"
        );
        assert_eq!(names(&folder).len(), 2, "nothing half-made");
        // A drive whose free space can't be told: made as before.
        cache.free = Arc::new(|_| None);
        assert!(cache.make(&other, |_| {}).is_ok());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_copy_refused_for_room_keeps_the_one_without_sound_and_tries_the_sound_again_later() {
        let dir = temp_dir("floor-silent");
        let mut cache = PlaybackCache::in_folder(&dir.join("cache"));
        cache.set_floor(1).unwrap();
        let (folder, _) = cache.folder().unwrap();
        // A copy without sound from an earlier run, of a video whose sound reads now.
        let clip = pcm_clip(&dir, "C0073.mov");
        let key = key_of(&clip, None).unwrap();
        let silent = cache.make(&pcm_clip(&dir, "C0074.mov"), |_| {}).unwrap();
        fs::rename(&silent.path, folder.join(file_name(&key, true))).unwrap();
        cache.free = Arc::new(|_| Some(GB));
        let kept = cache.make(&clip, |_| {}).unwrap();
        assert!(kept.silent, "the one without sound still plays");
        assert!(
            !lock(&cache.checked_silent).contains(&key),
            "not taken for unreadable sound"
        );
        // Room again: the copy with sound is made, and the one without goes.
        cache.free = Arc::new(|_| None);
        let made = cache.make(&clip, |_| {}).unwrap();
        assert!(!made.silent && !folder.join(file_name(&key, true)).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    /// A drive for a cache in `folder` with 10 MB less than its floor of 1 GB free, as another program filled it, in
    /// the readings `low_here` says (by whether the reading is the make's own, on this thread, or the watcher's); a GB
    /// to spare in the others. `extra` is what the copies already there take.
    fn filled(folder: &Path, extra: u64, low_here: fn(bool) -> bool) -> FreeSpace {
        let (folder, own) = (folder.to_path_buf(), std::thread::current().id());
        let reads = AtomicU64::new(0);
        Arc::new(move |asked: &Path| {
            (real(asked) == real(&folder)).then(|| {
                let mine = std::thread::current().id() == own;
                // The make's first reading is the one before its copy starts.
                let first = mine && reads.fetch_add(1, Ordering::SeqCst) == 0;
                let free = (GB - 10_000_000 + extra).saturating_sub(bytes_in(&folder));
                if !first && low_here(mine) {
                    free
                } else {
                    free + GB
                }
            })
        })
    }

    #[test]
    fn stops_a_copy_once_its_drive_comes_down_to_the_floor_and_removes_nothing_for_it() {
        let dir = temp_dir("floor-watch");
        // A minute of a small grey picture: a copy that takes a moment, light for the computer's encoder.
        let clip = make_clip(
            &dir,
            "C0075.mov",
            &[
                "-f",
                "lavfi",
                "-i",
                "color=c=gray:size=320x180:rate=25:duration=60",
            ],
            &["-c:v", "mpeg4", "-q:v", "10"],
        );
        let mut cache = PlaybackCache::in_folder(&dir.join("cache"));
        cache.set_floor(1).unwrap();
        cache.space_tick = Duration::from_millis(50);
        let (folder, _) = cache.folder().unwrap();
        let older = pretend(&folder, 1, 50_000_000, 100);
        // Low only as the watcher reads it: the stop can only come from the watch.
        cache.free = filled(&folder, 50_000_000, |mine| !mine);
        assert_eq!(cache.make(&clip, |_| {}).unwrap_err(), NO_ROOM);
        assert!(older.exists(), "the watch removes nothing");
        assert_eq!(names(&folder).len(), 1, "nothing half-made");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_copy_stopped_at_the_floor_is_made_again_once_older_copies_make_room_for_what_it_wrote() {
        let dir = temp_dir("floor-again");
        let clip = pcm_clip(&dir, "C0077.mov");
        let mut cache = PlaybackCache::in_folder(&dir.join("cache"));
        cache.set_floor(1).unwrap();
        cache.space_tick = Duration::from_millis(50);
        let (folder, _) = cache.folder().unwrap();
        // A drive 10 MB under the floor while the older copy is there (another program filled it after the copy was
        // asked for: the make's first reading still had room), and above it once that copy goes.
        let older = pretend(&folder, 1, 50_000_000, 100);
        let (drive_folder, own, reads) = (
            folder.clone(),
            std::thread::current().id(),
            AtomicU64::new(0),
        );
        cache.free = Arc::new(move |asked: &Path| {
            (real(asked) == real(&drive_folder)).then(|| {
                let free = (GB + 40_000_000).saturating_sub(bytes_in(&drive_folder));
                let first =
                    std::thread::current().id() == own && reads.fetch_add(1, Ordering::SeqCst) == 0;
                if first {
                    free + GB
                } else {
                    free
                }
            })
        });
        let made = cache.make(&clip, |_| {}).unwrap();
        assert!(!older.exists() && made.path.is_file());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn holds_a_finished_copy_to_the_floor_before_it_keeps_it() {
        let dir = temp_dir("floor-done");
        let clip = pcm_clip(&dir, "C0076.mov");
        let mut cache = PlaybackCache::in_folder(&dir.join("cache"));
        cache.set_floor(1).unwrap();
        let (folder, _) = cache.folder().unwrap();
        // Low only as the make reads it once its copy is whole (it ended between two of the watch's readings).
        cache.free = filled(&folder, 0, |mine| mine);
        assert_eq!(cache.make(&clip, |_| {}).unwrap_err(), NO_ROOM);
        assert!(names(&folder).is_empty(), "not kept");
        // An older copy that can make the room: it goes, and the copy is kept.
        let big = pretend(&folder, 1, 50_000_000, 100);
        cache.free = filled(&folder, 50_000_000, |mine| mine);
        let made = cache.make(&clip, |_| {}).unwrap();
        assert!(!big.exists() && made.path.is_file());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_move_takes_only_what_fits_above_the_floor_and_never_moves_to_a_drive_below_it() {
        let dir = temp_dir("floor-move");
        let mut cache = PlaybackCache::in_folder(&dir.join("cache"));
        cache.copy_moves = true;
        cache.set_floor(1).unwrap();
        let (home, _) = cache.folder().unwrap();
        pretend(&home, 1, 3_000_000, 200);
        pretend(&home, 2, 3_000_000, 100);
        let root = dir.join("drive");
        let new = root.join(FOLDER_NAME);
        // A drive already below the floor, then one just above it with room for neither copy: nothing moves, the
        // copies' place stays as it was, and the folder made for them goes again.
        let budget = Arc::new(AtomicU64::new(GB - 1));
        cache.free = drive(&new, &budget);
        for free in [GB - 1, GB + 1_000_000] {
            budget.store(free, Ordering::SeqCst);
            assert_eq!(cache.move_to(Some(&root)).unwrap_err(), NO_ROOM_THERE);
            assert_eq!(cache.settings().root, None);
            assert_eq!(names(&home).len(), 2);
            assert!(!new.exists());
        }
        // Room for one of the two above the floor.
        budget.store(GB + 4_000_000, Ordering::SeqCst);
        assert_eq!(cache.move_to(Some(&root)).unwrap_err(), NO_ROOM_TO_MOVE);
        assert_eq!(names(&new).len(), 1, "one moved");
        assert_eq!(names(&home).len(), 1, "one stayed, whole");
        // Both still found, counted and played.
        assert_eq!(cache.info().unwrap().copies, 2);
        assert_eq!(cache.settings().root.as_deref(), Some(root.as_path()));
        // Room for it now: the next Move takes it.
        budget.store(10 * GB, Ordering::SeqCst);
        assert_eq!(cache.move_to(Some(&root)), Ok(1));
        assert!(copies(&home).is_empty() && names(&new).len() == 2);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_floor_is_kept_with_the_settings_and_shown_with_the_drives_free_space() {
        let dir = temp_dir("floor-settings");
        let (data, cache_dir) = (dir.join("data"), dir.join("cache"));
        let mut cache = PlaybackCache::load(&data, &cache_dir);
        assert_eq!(cache.info().unwrap().floor_gb, DEFAULT_FLOOR_GB);
        cache.set_floor(25).unwrap();
        assert_eq!(cache.set_floor(0).unwrap_err(), FLOOR_RANGE);
        assert_eq!(cache.set_floor(1_001).unwrap_err(), FLOOR_RANGE);
        assert_eq!(
            PlaybackCache::load(&data, &cache_dir)
                .info()
                .unwrap()
                .floor_gb,
            25
        );
        cache.free = Arc::new(|_| Some(123_456));
        assert_eq!(cache.info().unwrap().free_bytes, Some(123_456));
        let _ = fs::remove_dir_all(&dir);
    }

    /// Run as a process of its own by the test below: starts ffmpeg as an encode does, says its process id, and waits
    /// to be killed.
    #[test]
    fn killed_child() {
        let Ok(data) = std::env::var("SBD_KILLED_CHILD") else {
            return;
        };
        let data = PathBuf::from(data);
        let cache = PlaybackCache::load(&data, &data.join("cache"));
        let mut command = video::command("ffmpeg");
        command
            .args(["-hide_banner", "-loglevel", "error", "-re", "-f", "lavfi"])
            .args(["-i", "testsrc2=duration=60", "-f", "null", "-"])
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut child = cache.start(&mut command).unwrap();
        let mut out = std::io::stdout();
        std::io::Write::write_all(&mut out, format!("ffmpeg={}\n", child.id()).as_bytes()).unwrap();
        std::io::Write::flush(&mut out).unwrap();
        // A minute of ffmpeg's: the test kills this process long before.
        let _ = child.wait();
    }

    /// The killed app's ffmpeg, held from while it surely runs: on Windows by a handle, so its id can't pass to another
    /// process; elsewhere by its id and start. Stopped when dropped, so a failed test leaves nothing running.
    struct Orphan {
        #[cfg(unix)]
        pid: u32,
        #[cfg(unix)]
        started: u64,
        #[cfg(windows)]
        handle: windows_sys::Win32::Foundation::HANDLE,
    }

    impl Orphan {
        fn hold(pid: u32) -> Self {
            #[cfg(unix)]
            return Self {
                pid,
                started: os::started(pid).expect("ffmpeg running"),
            };
            #[cfg(windows)]
            {
                use windows_sys::Win32::System::Threading::{
                    OpenProcess, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
                };
                // SAFETY: opened here, closed in drop.
                let handle =
                    unsafe { OpenProcess(PROCESS_SYNCHRONIZE | PROCESS_TERMINATE, 0, pid) };
                assert!(!handle.is_null(), "ffmpeg running");
                Self { handle }
            }
        }

        fn running(&self) -> bool {
            #[cfg(unix)]
            return os::is_same(self.pid, self.started);
            #[cfg(windows)]
            {
                use windows_sys::Win32::Foundation::WAIT_TIMEOUT;
                use windows_sys::Win32::System::Threading::WaitForSingleObject;
                // SAFETY: the handle is open until drop.
                unsafe { WaitForSingleObject(self.handle, 0) == WAIT_TIMEOUT }
            }
        }

        /// Whether it ends within ten seconds.
        fn ends(&self) -> bool {
            let waited = Instant::now();
            while self.running() {
                if waited.elapsed() > Duration::from_secs(10) {
                    return false;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            true
        }
    }

    impl Drop for Orphan {
        fn drop(&mut self) {
            #[cfg(unix)]
            if self.running() {
                os::kill(self.pid);
            }
            #[cfg(windows)]
            // SAFETY: the handle is open; it's closed once, here.
            unsafe {
                windows_sys::Win32::System::Threading::TerminateProcess(self.handle, 1);
                windows_sys::Win32::Foundation::CloseHandle(self.handle);
            }
        }
    }

    #[test]
    fn an_encodes_ffmpeg_ends_with_the_app_even_when_the_app_is_killed() {
        let dir = temp_dir("killed");
        let data = dir.join("data");
        // Each encode's ffmpeg comes off the list when it's done.
        let cache = PlaybackCache::load(&data, &dir.join("cache"));
        cache.make(&pcm_clip(&dir, "C0072.mov"), |_| {}).unwrap();
        #[cfg(unix)]
        assert_eq!(
            fs::read_to_string(data.join("playback-running.txt")).unwrap(),
            ""
        );
        drop(cache);
        let mut app = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "playback::tests::killed_child",
                "--nocapture",
                "--test-threads=1",
            ])
            .env("SBD_KILLED_CHILD", &data)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        // Its line comes after the test harness's own words on the same line; read on a thread of its own, so a child
        // that never says it can't hold the test up.
        let stdout = app.stdout.take().unwrap();
        let (said, heard) = mpsc::channel();
        std::thread::spawn(move || {
            let pid = BufReader::new(stdout)
                .lines()
                .map_while(Result::ok)
                .find_map(|line| line.rsplit_once("ffmpeg=")?.1.trim().parse::<u32>().ok());
            let _ = said.send(pid);
        });
        let Some(pid) = heard.recv_timeout(Duration::from_secs(60)).ok().flatten() else {
            let _ = app.kill();
            panic!("the app never said it started ffmpeg");
        };
        let ffmpeg = Orphan::hold(pid);
        assert!(ffmpeg.running());
        // Killed as Task Manager or Force Quit does: nothing of the app's own runs.
        app.kill().unwrap();
        app.wait().unwrap();
        // Windows: the Job Object ends it with the app.
        #[cfg(windows)]
        assert!(ffmpeg.ends(), "ended with the app");
        // A Mac: it goes on alone until the app starts again, which stops it.
        #[cfg(unix)]
        {
            std::thread::sleep(Duration::from_millis(500));
            assert!(ffmpeg.running(), "left running by the kill");
            let _cache = PlaybackCache::load(&data, &dir.join("cache"));
            assert!(ffmpeg.ends(), "stopped at the next start");
            assert_eq!(
                fs::read_to_string(data.join("playback-running.txt")).unwrap(),
                ""
            );
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn the_next_start_stops_only_the_process_it_kept() {
        let dir = temp_dir("not-ours");
        let data = dir.join("data");
        fs::create_dir_all(&data).unwrap();
        // Kept from a run before: another program now, and an ffmpeg whose id came back with another start.
        let mut other = Command::new("sleep").arg("30").spawn().unwrap();
        let mut ffmpeg = video::command("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error", "-re", "-f", "lavfi"])
            .args(["-i", "testsrc2=duration=60", "-f", "null", "-"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let other_at = os::started(other.id()).unwrap();
        let ffmpeg_at = os::started(ffmpeg.id()).unwrap();
        fs::write(
            data.join("playback-running.txt"),
            format!(
                "{} {other_at}\n{} {}\nnot a number\n",
                other.id(),
                ffmpeg.id(),
                ffmpeg_at + 1
            ),
        )
        .unwrap();
        let _cache = PlaybackCache::load(&data, &dir.join("cache"));
        // A kill, had there been one, is given time to land.
        let until = Instant::now() + Duration::from_secs(1);
        while Instant::now() < until
            && matches!((other.try_wait(), ffmpeg.try_wait()), (Ok(None), Ok(None)))
        {
            std::thread::sleep(Duration::from_millis(50));
        }
        let left = (other.try_wait(), ffmpeg.try_wait());
        for child in [&mut other, &mut ffmpeg] {
            let _ = child.kill();
            let _ = child.wait();
        }
        assert!(matches!(left, (Ok(None), Ok(None))), "both left alone");
        let _ = fs::remove_dir_all(&dir);
    }
}
