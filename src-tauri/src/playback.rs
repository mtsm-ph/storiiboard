//! Playback copies (Phase 2.3): the app never plays an original (CLAUDE.md). ffmpeg makes an H.264 MP4 of each linked
//! video with the computer's own encoder, at most 1920 px on the long edge, at a constant rate, with a keyframe every
//! 12 frames so stepping and scrubbing land fast; frame 0 is the video stream's first frame, as stills count it.
//!
//! The copies live in a folder of the app's own, `Storiiboard Playback Copies`, on this computer (never in the .sbd,
//! never synced): in the app's cache folder, or on a drive the person picks. Rust alone knows where it is and deletes
//! only files it named there, so the page can never point a Clear or the cap at anything else. A copy is written as
//! `.partial` and renamed only once it's checked whole (the original unchanged, nothing read wrong, its length and
//! sound all there), so a crash, a kill, a Cancel or a card pulled midway never leaves a copy that looks done. The
//! folder is kept under a cap (about 50 GB by default), the copies used longest ago going first.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant, SystemTime};

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::video::{self, Access};

/// The folder of copies, inside the cache folder or a folder the person picks.
pub const FOLDER_NAME: &str = "Storiiboard Playback Copies";
/// Changes when the way copies are made changes, so older copies are made again rather than played.
const RECIPE: &str = "2.3-1";
/// The long edge of a copy, at most.
const LONG_EDGE: u32 = 1920;
const DEFAULT_CAP_GB: u64 = 50;
const GB: u64 = 1_000_000_000;
/// An encode that says nothing for this long has stalled (a dead share, a stuck encoder) and is stopped. ffmpeg reports
/// its progress about twice a second however slow it is; with no index pass at the end (`+faststart` isn't used: a
/// local file plays as well with its index last, and that pass rewrote the whole copy saying nothing) it never goes
/// quiet for long while it works.
const STALL: Duration = Duration::from_secs(90);
/// How long a stopped ffmpeg is given to end. A read stuck on a share that stopped answering can hold a kill back until
/// it returns; past this the copy fails anyway and the next one starts, and the old ffmpeg is waited for on its own.
const KILL_GRACE: Duration = Duration::from_secs(10);
/// How often an encode looks at its ffmpeg, its progress and a Cancel.
const TICK: Duration = Duration::from_millis(100);

const CANCELLED: &str = "The playback copy was cancelled.";
const FAILED: &str = "That video couldn't be made into a playback copy.";
const SHORT: &str =
    "The playback copy came out shorter than the video. If it's on a card or a drive, check it's still connected.";
const STALLED: &str = "That video stopped being read partway. If it's on a card, a drive or a network share, check it's still connected.";
const UNWRITABLE: &str = "Playback copies can't be written in that folder.";

/// What Rust keeps about the cache, in the app's data folder; the page never writes it. Every field has a default, so a
/// file from another version still reads.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Settings {
    /// The folder the person picked, which holds `FOLDER_NAME`; none for the cache folder.
    root: Option<PathBuf>,
    cap_gb: u64,
    /// Folders of copies a Move left behind (cut short by a crash, or copies that couldn't go): still counted, found,
    /// capped and cleared, and moved along with the next Move, so none sits where the app no longer looks.
    leftovers: Vec<PathBuf>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            root: None,
            cap_gb: DEFAULT_CAP_GB,
            leftovers: Vec::new(),
        }
    }
}

/// One request for a copy, from the moment it's asked: Cancel reaches it while it waits its turn, while the original is
/// read, and once ffmpeg runs. A video can have several at once (two frames linking it, the queue and the Player both
/// asking, React's development double run), each with its own entry.
struct Job {
    id: u64,
    child: Option<Arc<Mutex<Child>>>,
    cancelled: Arc<AtomicBool>,
}

pub struct PlaybackCache {
    settings_file: Option<PathBuf>,
    default_root: PathBuf,
    settings: Mutex<Settings>,
    /// By the original's path as the page names it, every request for it; Cancel stops them all.
    jobs: Mutex<HashMap<String, Vec<Job>>>,
    next_job: AtomicU64,
    /// One copy at a time: a hardware encoder is shared, and the drive is too.
    turn: Mutex<()>,
    /// Copies made without sound whose sound was found unreadable in this run (by key): played as they are. In a
    /// later run the sound is tried once more, so a fix (a newer app, the file replaced) brings it back.
    checked_silent: Mutex<HashSet<String>>,
    /// The encoders to try, in order.
    encoders: Vec<Vec<&'static str>>,
    /// See `STALL`; shorter in tests.
    stall: Duration,
    /// Extra environment for ffmpeg as it encodes; tests only (a shim that makes reads fail as a pulled card does).
    #[cfg(test)]
    encode_env: Vec<(String, String)>,
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
/// copy; the old one ages out under the cap. The time counts whole seconds: a network share can report a file's time
/// finer one moment and coarser the next, and the same file must keep its copy.
pub fn key_of(path: &Path) -> Result<String, String> {
    let meta = fs::metadata(path).map_err(|_| "That file isn't there any more.".to_string())?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs());
    let text = format!(
        "{RECIPE}\0{}\0{}\0{modified}",
        path.to_string_lossy(),
        meta.len()
    );
    Ok(fnv128(text.as_bytes()))
}

/// The file name of a finished copy. One made without sound has a name of its own, so it's never taken for a whole one.
fn file_name(key: &str, silent: bool) -> String {
    if silent {
        format!("{key}-silent.mp4")
    } else {
        format!("{key}.mp4")
    }
}

/// A file of ours in the folder, by its name: a finished copy (`<key>.mp4`, or `<key>-silent.mp4` without sound), or
/// one being made (either name and `.partial`).
#[derive(Debug, PartialEq)]
struct Ours<'a> {
    key: &'a str,
    silent: bool,
    partial: bool,
}

fn ours(name: &str) -> Option<Ours<'_>> {
    let (name, partial) = match name.strip_suffix(".partial") {
        Some(name) => (name, true),
        None => (name, false),
    };
    let name = name.strip_suffix(".mp4")?;
    let (key, silent) = match name.strip_suffix("-silent") {
        Some(key) => (key, true),
        None => (name, false),
    };
    (key.len() == 32
        && key
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()))
    .then_some(Ours {
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

fn copies(folder: &Path) -> Vec<Stored> {
    let Ok(entries) = fs::read_dir(folder) else {
        return Vec::new();
    };
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
        .collect()
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

/// The encoders to try, in order: the computer's own hardware first, then its software encoder where one can stand
/// in. Linux builds only for the tests, with no H.264 encoder in an LGPL build, so it makes MPEG-4 there.
fn encoders() -> Vec<Vec<&'static str>> {
    #[cfg(target_os = "macos")]
    return vec![vec![
        "-c:v",
        "h264_videotoolbox",
        "-allow_sw",
        "1",
        "-b:v",
        "12M",
    ]];
    // The bitrate is set too: a hardware encoder that ignores the quality mode falls back to it, not to 200 kb/s.
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
        ],
    ];
    #[cfg(not(any(windows, target_os = "macos")))]
    return vec![vec!["-c:v", "mpeg4", "-q:v", "3"]];
}

/// Deletes the copies in `folders` used longest ago until they come to `cap` bytes or less; never `keep`.
fn keep_under(folders: &[PathBuf], keep: &Path, cap: u64) {
    let mut all: Vec<Stored> = folders.iter().flat_map(|f| copies(f)).collect();
    let mut total: u64 = all.iter().map(|c| c.bytes).sum();
    all.sort_by_key(|c| c.used);
    for copy in all {
        if total <= cap {
            break;
        }
        if copy.path == keep {
            continue;
        }
        if fs::remove_file(&copy.path).is_ok() {
            total = total.saturating_sub(copy.bytes);
        }
    }
}

/// What ffmpeg said on its error output while it made a copy.
#[derive(Debug, Default, Clone, Copy, PartialEq)]
struct Said {
    /// Reading the original failed partway (a card pulled, a share gone): ffmpeg then ends as if the file had ended,
    /// and exits as if all went well.
    read_failed: bool,
    /// The original's data stopped making sense partway: a file cut short, or only a damaged tail.
    damaged: bool,
}

impl Said {
    /// One line of ffmpeg 8's error output. A failed read is "Error during demuxing: <reason>"
    /// (fftools/ffmpeg_demux.c); undecodable data has its own reason, every other one is the drive or the share.
    fn hear(&mut self, line: &str) {
        if let Some((_, reason)) = line.split_once("Error during demuxing: ") {
            if reason.starts_with("Invalid data found") {
                self.damaged = true;
            } else {
                self.read_failed = true;
            }
        }
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
/// flushed to the disk and renamed, before the old one goes. A copy that can't be moved is deleted (it's ours, and is
/// made again when it's played), so none is ever left where the app no longer looks. Whether it moved.
fn move_one(from: &Path, to: &Path, force_copy: bool) -> bool {
    if !force_copy && fs::rename(from, to).is_ok() {
        return true;
    }
    let partial = to.with_extension("mp4.partial");
    let copied = fs::copy(from, &partial)
        // Opened for writing: Windows flushes only a file it may write.
        .and_then(|_| fs::File::options().write(true).open(&partial)?.sync_all())
        .and_then(|()| fs::rename(&partial, to));
    let _ = fs::remove_file(&partial);
    let _ = fs::remove_file(from);
    copied.is_ok()
}

/// What a copy being made reports: how far along, 0 to 1. It can step back once, when a hardware encoder gives way to
/// the software one. A video whose length isn't known reports only the end.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct Progress {
    pub done: f64,
}

/// A finished copy: where it is, and whether it was made without sound because the original's sound couldn't be read
/// (the app says so).
#[derive(Debug, Clone, PartialEq)]
pub struct Made {
    pub path: PathBuf,
    pub silent: bool,
}

/// `Made`, for the page.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MadeCopy {
    pub path: String,
    pub silent: bool,
}

impl From<Made> for MadeCopy {
    fn from(made: Made) -> Self {
        Self {
            path: made.path.to_string_lossy().into_owned(),
            silent: made.silent,
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
    /// The picked drive isn't there (unplugged): copies go to the cache folder until it's back.
    pub fallback: bool,
    /// A copy is being made, or waiting its turn.
    pub busy: bool,
}

/// Takes one request off the list when its make ends, however it ends; the video's other requests stay.
struct Registered<'a> {
    cache: &'a PlaybackCache,
    name: String,
    id: u64,
}

impl Drop for Registered<'_> {
    fn drop(&mut self) {
        let mut jobs = lock(&self.cache.jobs);
        if let Some(list) = jobs.get_mut(&self.name) {
            list.retain(|job| job.id != self.id);
            if list.is_empty() {
                jobs.remove(&self.name);
            }
        }
    }
}

/// Why an encode didn't give a copy.
#[derive(Debug, PartialEq)]
enum Stop {
    Cancelled,
    /// ffmpeg said nothing for `stall`.
    Stalled,
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
            Self::Failed(said) if said.read_failed => SHORT.into(),
            Self::Failed(_) => FAILED.into(),
            Self::Unstarted(message) => message,
        }
    }
}

impl PlaybackCache {
    pub fn load(data_dir: &Path, cache_dir: &Path) -> Self {
        let settings_file = data_dir.join("playback.json");
        let settings = fs::read(&settings_file)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self::new(Some(settings_file), cache_dir, settings)
    }

    fn new(settings_file: Option<PathBuf>, default_root: &Path, settings: Settings) -> Self {
        Self {
            settings_file,
            default_root: default_root.to_path_buf(),
            settings: Mutex::new(settings),
            jobs: Mutex::new(HashMap::new()),
            next_job: AtomicU64::new(0),
            turn: Mutex::new(()),
            checked_silent: Mutex::new(HashSet::new()),
            encoders: encoders(),
            stall: STALL,
            #[cfg(test)]
            encode_env: Vec::new(),
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

    fn save(&self, settings: Settings) -> Result<(), String> {
        if let Some(file) = &self.settings_file {
            let json = serde_json::to_vec(&settings).map_err(|e| e.to_string())?;
            write_atomically(file, &json).map_err(|_| UNWRITABLE.to_string())?;
        }
        *lock(&self.settings) = settings;
        Ok(())
    }

    fn default_folder(&self) -> PathBuf {
        self.default_root.join(FOLDER_NAME)
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

    /// Every folder that holds copies of ours: where they go now; the cache folder when a picked drive is the usual
    /// place, since copies made while it was away are there; and any a Move left behind. Counted, capped and cleared
    /// together.
    fn all_folders(&self) -> Vec<PathBuf> {
        let settings = self.settings();
        let mut folders = Vec::new();
        let candidates = settings
            .root
            .map(|root| root.join(FOLDER_NAME))
            .into_iter()
            .chain(std::iter::once(self.default_folder()))
            .chain(settings.leftovers);
        for folder in candidates {
            if !folders.contains(&folder) && folder.is_dir() {
                folders.push(folder);
            }
        }
        folders
    }

    /// The finished copy of a video, if there is one; marked as used. A whole one before one made without sound;
    /// where copies go now first, then the other folders of ours.
    pub fn find(&self, path: &Path) -> Result<Option<Made>, String> {
        let key = key_of(path)?;
        let (now, _) = self.folder()?;
        let folders: Vec<PathBuf> = std::iter::once(now).chain(self.all_folders()).collect();
        let found = [false, true].into_iter().find_map(|silent| {
            let name = file_name(&key, silent);
            folders
                .iter()
                .map(|folder| folder.join(&name))
                .find(|copy| copy.is_file())
                .map(|path| Made { path, silent })
        });
        if let Some(made) = &found {
            touch(&made.path);
        }
        Ok(found)
    }

    /// Puts a request for a copy on the list, where Cancel finds it; off again when the guard drops.
    fn register(&self, name: &str, cancelled: &Arc<AtomicBool>) -> Registered<'_> {
        let id = self.next_job.fetch_add(1, Ordering::SeqCst);
        lock(&self.jobs)
            .entry(name.to_owned())
            .or_default()
            .push(Job {
                id,
                child: None,
                cancelled: Arc::clone(cancelled),
            });
        Registered {
            cache: self,
            name: name.to_owned(),
            id,
        }
    }

    /// A copy found that serves as it is: a whole one, or one without sound whose sound was found unreadable in this
    /// run.
    fn ready(&self, found: Option<&Made>, key: &str) -> bool {
        found.is_some_and(|made| !made.silent || lock(&self.checked_silent).contains(key))
    }

    /// Makes the playback copy of a video, or finds the one already made. One at a time; `on_progress` hears how far
    /// along it is. Several requests for one video share the work: the first makes it, the others find it made.
    pub fn make(&self, path: &Path, mut on_progress: impl FnMut(f64)) -> Result<Made, String> {
        let name = path.to_string_lossy().into_owned();
        let cancelled = Arc::new(AtomicBool::new(false));
        let job = self.register(&name, &cancelled);
        let stopped = || cancelled.load(Ordering::SeqCst);
        let key = key_of(path)?;
        let found = self.find(path)?;
        if self.ready(found.as_ref(), &key) {
            return Ok(found.expect("ready means found"));
        }
        let _turn = lock(&self.turn);
        if stopped() {
            return Err(CANCELLED.into());
        }
        // Made while this one waited its turn.
        let found = self.find(path)?;
        if self.ready(found.as_ref(), &key) {
            return Ok(found.expect("ready means found"));
        }
        // Made without sound in an earlier run: made again only if the sound reads now. Kept if it can't be told.
        if let Some(silent) = found {
            if !matches!(video::sound_plays(path), Ok(true)) {
                lock(&self.checked_silent).insert(key);
                return Ok(silent);
            }
        }
        let (folder, _) = self.folder()?;
        let partial = folder.join(format!("{key}.mp4.partial"));
        let probe = video::probe(path)?;
        let (stream_start, file_start) = video::starts(path)?;
        if stopped() {
            return Err(CANCELLED.into());
        }
        let total = probe.duration_frames;
        let mut on_frame = |frame: f64| {
            if total > 0 {
                on_progress((frame / total as f64).min(1.0));
            }
        };
        // Each encoder in turn, with the sound if there is any. The sound is left out only when it's the cause: an
        // attempt failed and the sound alone can't be read. Never for any other failure, which would keep a copy
        // without sound for good.
        let mut sound = probe.has_audio;
        let mut sound_tested = false;
        let mut outcome = Err(Stop::Failed(Said::default()));
        'encoders: for encoder in &self.encoders {
            loop {
                let run = Run {
                    path,
                    partial: &partial,
                    name: &name,
                    job: job.id,
                    rate: (probe.fps_num, probe.fps_den),
                    offset: stream_start - file_start,
                    encoder,
                    sound,
                };
                outcome = self.encode(&run, &cancelled, &mut on_frame);
                match &outcome {
                    // Done, stopped, or the drive gone: no other encoder would do better.
                    Ok(_) | Err(Stop::Cancelled) => break 'encoders,
                    Err(Stop::Failed(said)) if said.read_failed => break 'encoders,
                    Err(Stop::Failed(_)) if sound && !sound_tested => {
                        sound_tested = true;
                        if video::sound_plays(path) == Ok(false) {
                            sound = false;
                            continue;
                        }
                    }
                    Err(_) => {}
                }
                break;
            }
        }
        let checked = outcome.map_err(Stop::message).and_then(|said| {
            // The original changed while it was read (an offload still writing): this copy isn't of it.
            if key_of(path)? != key {
                return Err(FAILED.into());
            }
            let made = video::probe(&partial)?;
            if complete(&probe, sound, &made, said) {
                Ok(())
            } else {
                Err(SHORT.into())
            }
        });
        if let Err(error) = checked {
            let _ = fs::remove_file(&partial);
            return Err(error);
        }
        let silent = probe.has_audio && !sound;
        let done = folder.join(file_name(&key, silent));
        fs::rename(&partial, &done).map_err(|_| {
            let _ = fs::remove_file(&partial);
            UNWRITABLE.to_string()
        })?;
        if silent {
            lock(&self.checked_silent).insert(key);
        } else {
            // The sound reads now: the copy without it goes.
            for folder in self.all_folders() {
                let _ = fs::remove_file(folder.join(file_name(&key, true)));
            }
        }
        on_progress(1.0);
        self.keep_under_cap(&done);
        Ok(Made { path: done, silent })
    }

    fn encode(
        &self,
        run: &Run<'_>,
        cancelled: &Arc<AtomicBool>,
        mut on_frame: impl FnMut(f64),
    ) -> Result<Said, Stop> {
        let (fps_num, fps_den) = run.rate;
        // Square pixels and the long-edge cap in one scale; deinterlaced first if the frames are interlaced.
        let fit = format!("min(1,{LONG_EDGE}/max(iw*sar,ih))");
        let filter = format!(
            "bwdif=mode=send_frame:deint=interlaced,scale=w='trunc(iw*sar*{fit}/2)*2':h='trunc(ih*{fit}/2)*2',setsar=1,format=yuv420p"
        );
        let mut command = video::command("ffmpeg");
        command
            .args(["-hide_banner", "-loglevel", "error", "-y"])
            .args(["-protocol_whitelist", "file"]);
        // Starts at the video's first frame (a quarter frame early, so rounding keeps it): sound that leads the
        // picture is left out, and the copy's frame 0 is the original's.
        if run.offset > 0.0 {
            let early = (run.offset - 0.25 * f64::from(fps_den) / f64::from(fps_num)).max(0.0);
            command.arg("-ss").arg(format!("{early:.6}"));
        }
        command.arg("-i").arg(run.path).args(["-map", "0:V:0"]);
        if run.sound {
            command.args(["-map", "0:a:0?", "-c:a", "aac", "-b:a", "160k", "-ac", "2"]);
        } else {
            command.arg("-an");
        }
        command
            .args(["-vf", &filter, "-fps_mode", "cfr", "-r"])
            .arg(format!("{fps_num}/{fps_den}"))
            .args(run.encoder)
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
        }
        if cancelled.load(Ordering::SeqCst) {
            return Err(Stop::Cancelled);
        }
        let mut child = command.spawn().map_err(|_| {
            Stop::Unstarted(
                "Storiiboard's video reader couldn't start. Reinstalling Storiiboard puts it back."
                    .into(),
            )
        })?;
        let (stdout, stderr) = (child.stdout.take(), child.stderr.take());
        let child = Arc::new(Mutex::new(child));
        if let Some(job) = lock(&self.jobs)
            .get_mut(run.name)
            .and_then(|list| list.iter_mut().find(|job| job.id == run.job))
        {
            job.child = Some(Arc::clone(&child));
        }
        // ffmpeg's two outputs are read on threads of their own, so neither pipe fills and holds it up, and a read
        // that never returns (ffmpeg stuck on a dead share) never holds up this one. Each line counts as word from it.
        let started = Instant::now();
        let heard = Arc::new(AtomicU64::new(0));
        let (frames_sent, frames) = mpsc::channel::<f64>();
        let progress = stdout.map(|stdout| {
            let heard = Arc::clone(&heard);
            std::thread::spawn(move || {
                for_each_line(stdout, |line| {
                    heard.store(started.elapsed().as_millis() as u64, Ordering::SeqCst);
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
            let heard = Arc::clone(&heard);
            std::thread::spawn(move || {
                let mut said = Said::default();
                for_each_line(stderr, |line| {
                    heard.store(started.elapsed().as_millis() as u64, Ordering::SeqCst);
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
            std::thread::spawn(move || {
                while matches!(lock(&child).try_wait(), Ok(None)) {
                    std::thread::sleep(Duration::from_secs(1));
                }
            });
        };
        let mut stopped_at: Option<Instant> = None;
        let mut stalled = false;
        let status: Option<ExitStatus> = loop {
            match frames.recv_timeout(TICK) {
                Ok(frame) => on_frame(frame),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => std::thread::sleep(TICK),
            }
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
                    let cancel = cancelled.load(Ordering::SeqCst);
                    if cancel || quiet > self.stall {
                        stalled = !cancel;
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
                if let Some(progress) = progress {
                    let _ = progress.join();
                }
                while let Ok(frame) = frames.try_recv() {
                    on_frame(frame);
                }
                errors
                    .and_then(|errors| errors.join().ok())
                    .unwrap_or_default()
            }
            None => Said::default(),
        };
        if cancelled.load(Ordering::SeqCst) {
            return Err(Stop::Cancelled);
        }
        if stalled {
            return Err(Stop::Stalled);
        }
        match status {
            Some(status) if status.success() => Ok(said),
            _ => Err(Stop::Failed(said)),
        }
    }

    /// Stops every copy of this video asked for, wherever each is: waiting its turn, reading the original, or encoding;
    /// the half copy is deleted. By the path as the page names it, without reading the original, so it works when the
    /// card is gone or the share has stopped answering. Whether there was one to stop.
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

    /// Stops every copy being made: the app is quitting, and ffmpeg shouldn't go on alone.
    pub fn cancel_all(&self) {
        for job in lock(&self.jobs).values().flatten() {
            job.cancelled.store(true, Ordering::SeqCst);
            if let Some(child) = &job.child {
                let _ = lock(child).kill();
            }
        }
    }

    /// Deletes copies used longest ago until all of them are under the cap. Never `keep`, the copy just made.
    fn keep_under_cap(&self, keep: &Path) {
        keep_under(
            &self.all_folders(),
            keep,
            self.settings().cap_gb.saturating_mul(GB),
        );
    }

    pub fn info(&self) -> Result<CacheInfo, String> {
        let (folder, fallback) = self.folder()?;
        let all: Vec<Stored> = self.all_folders().iter().flat_map(|f| copies(f)).collect();
        Ok(CacheInfo {
            folder: folder.to_string_lossy().into_owned(),
            bytes: all.iter().map(|c| c.bytes).sum(),
            copies: all.len(),
            cap_gb: self.settings().cap_gb,
            fallback,
            busy: !lock(&self.jobs).is_empty(),
        })
    }

    /// Deletes every finished copy, in every folder of ours (they're made again when played). Returns how many went.
    pub fn clear(&self) -> Result<usize, String> {
        Ok(self
            .all_folders()
            .iter()
            .flat_map(|f| copies(f))
            .filter(|c| fs::remove_file(&c.path).is_ok())
            .count())
    }

    pub fn set_cap(&self, gb: u64) -> Result<(), String> {
        if !(1..=10_000).contains(&gb) {
            return Err("The cap for playback copies is between 1 and 10,000 GB.".into());
        }
        self.save(Settings {
            cap_gb: gb,
            ..self.settings()
        })?;
        self.keep_under_cap(Path::new(""));
        Ok(())
    }

    /// Moves the copies into `root` (or back to the cache folder with None). Not while one is being made. The new
    /// folder is tested for writing first. Then the setting is saved, with the old folders kept on the list of
    /// leftovers, so a crash partway leaves copies only where the app still looks; then each copy is moved, or deleted
    /// where it can't be (it's made again when played), and an old folder comes off the list once nothing of ours is
    /// left in it. Returns how many moved.
    pub fn move_to(&self, root: Option<&Path>) -> Result<usize, String> {
        if !lock(&self.jobs).is_empty() {
            return Err("A playback copy is being made; move the copies once it's done.".into());
        }
        let _turn = lock(&self.turn);
        let new = root.unwrap_or(&self.default_root).join(FOLDER_NAME);
        fs::create_dir_all(&new).map_err(|_| UNWRITABLE.to_string())?;
        let probe = new.join(format!("{:032x}.mp4.partial", 0));
        fs::write(&probe, b"")
            .and_then(|()| fs::remove_file(&probe))
            .map_err(|_| UNWRITABLE.to_string())?;
        // The same folder by another spelling is still the same folder: nothing to move.
        let same = |a: &Path, b: &Path| match (a.canonicalize(), b.canonicalize()) {
            (Ok(a), Ok(b)) => a == b,
            _ => a == b,
        };
        // Every folder of ours, a picked drive that's unplugged now among them: its copies are moved once it's back.
        let settings = self.settings();
        let home = self.default_folder();
        let mut olds: Vec<PathBuf> = Vec::new();
        let candidates = settings
            .root
            .map(|root| root.join(FOLDER_NAME))
            .into_iter()
            .chain(std::iter::once(home.clone()))
            .chain(settings.leftovers);
        for old in candidates {
            if !olds.contains(&old) && !same(&old, &new) {
                olds.push(old);
            }
        }
        // The cache folder is always looked in; only the others need remembering.
        let away = |folders: &[PathBuf]| -> Vec<PathBuf> {
            folders.iter().filter(|f| **f != home).cloned().collect()
        };
        self.save(Settings {
            root: root.map(Path::to_path_buf),
            leftovers: away(&olds),
            ..self.settings()
        })?;
        let mut moved = 0;
        // Kept on the list: a folder on a drive that isn't there (unplugged; its copies move once it's back), and one
        // that still holds copies that couldn't go.
        let mut left = Vec::new();
        for old in &olds {
            if !old.is_dir() {
                if !old.parent().is_some_and(Path::is_dir) {
                    left.push(old.clone());
                }
                continue;
            }
            for copy in copies(old) {
                let Some(file) = copy.path.file_name() else {
                    continue;
                };
                if move_one(&copy.path, &new.join(file), false) {
                    moved += 1;
                }
            }
            if !copies(old).is_empty() {
                left.push(old.clone());
            }
            // Only our folder, and only if nothing else is in it.
            let _ = fs::remove_dir(old);
        }
        // The moves are done; a list that can't be saved only means looking in folders that hold nothing.
        let _ = self.save(Settings {
            leftovers: away(&left),
            ..self.settings()
        });
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
    /// The request's entry on the list of jobs, where Cancel finds its ffmpeg.
    name: &'a str,
    job: u64,
    rate: (u32, u32),
    offset: f64,
    encoder: &'a [&'a str],
    sound: bool,
}

/// Makes a video's playback copy (or finds it) and returns where it is, reporting progress on `progress`.
#[tauri::command]
pub async fn playback_make(
    app: AppHandle,
    path: String,
    handle: Option<u32>,
    progress: Channel<Progress>,
) -> Result<MadeCopy, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = Path::new(&path);
        Access::of(&app, handle).readable(path)?;
        let made = app.state::<PlaybackCache>().make(path, |done| {
            let _ = progress.send(Progress { done });
        })?;
        Ok(made.into())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The finished playback copy of a video, or null when it hasn't been made.
#[tauri::command]
pub async fn playback_find(
    app: AppHandle,
    path: String,
    handle: Option<u32>,
) -> Result<Option<MadeCopy>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = Path::new(&path);
        Access::of(&app, handle).readable(path)?;
        Ok(app.state::<PlaybackCache>().find(path)?.map(MadeCopy::from))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stops the copy of a video being made. Only work already asked for can be stopped, so it reads nothing. Off the main
/// thread, so it never holds up the window.
#[tauri::command(async)]
pub fn playback_cancel(app: AppHandle, path: String) -> bool {
    app.state::<PlaybackCache>().cancel(&path)
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
        let first = key_of(&clip).unwrap();
        assert_eq!(first.len(), 32);
        // A share that reports the time coarser one moment and finer the next: the same file, the same copy.
        at(1_800_000_000, 700_000_000);
        assert_eq!(key_of(&clip).unwrap(), first);
        at(1_800_000_001, 100_000_000);
        assert_ne!(key_of(&clip).unwrap(), first);
        at(1_800_000_000, 100_000_000);
        fs::write(&clip, "take two, longer").unwrap();
        at(1_800_000_000, 100_000_000);
        assert_ne!(key_of(&clip).unwrap(), first);
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
        // Not ours: another name, capitals, too short, another suffix.
        let (loud, mov) = (format!("{first}-loud.mp4"), format!("{first}.mov"));
        for name in [
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
        assert!(seen.len() > 1, "progress along the way: {seen:?}");
        let probe = video::probe(&copy).unwrap();
        assert_eq!((probe.fps_num, probe.fps_den), (24000, 1001));
        assert_eq!((probe.width, probe.height), (1920, 1080));
        assert_eq!(probe.duration_frames, 48);
        assert!(probe.has_audio);
        // Stepping and scrubbing land fast: a keyframe every 12 frames, whatever the computer's encoder.
        assert_eq!(keyframes(&copy), [0, 12, 24, 36]);
        assert_eq!(cache.find(&clip).unwrap(), Some(made.clone()));
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
        assert_eq!(cache.find(&clip).unwrap(), None);
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
        assert_eq!(cache.find(&clip).unwrap(), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn two_requests_for_one_video_share_one_copy_and_one_cancel_stops_both() {
        let dir = temp_dir("twice");
        let clip = pcm_clip(&dir, "C0052.mov");
        let cache = Arc::new(PlaybackCache::in_folder(&dir.join("cache")));
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
        for _ in 0..1000 {
            if lock(&cache.jobs)
                .get(&long_name)
                .is_some_and(|list| list.iter().any(|job| job.child.is_some()))
            {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(cache.cancel(&long_name));
        for ask in asks {
            assert_eq!(ask.join().unwrap().unwrap_err(), CANCELLED);
        }
        assert_eq!(cache.find(&long).unwrap(), None);
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
        assert_eq!(cache.find(&clip).unwrap(), Some(made.clone()));
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
        let good_key = key_of(&good).unwrap();
        let (folder, _) = later.folder().unwrap();
        fs::copy(&made.path, folder.join(file_name(&good_key, true))).unwrap();
        let whole = later.make(&good, |_| {}).unwrap();
        assert!(!whole.silent);
        assert!(video::probe(&whole.path).unwrap().has_audio);
        assert!(!folder.join(file_name(&good_key, true)).exists());
        assert_eq!(later.find(&good).unwrap(), Some(whole));
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
        let piped = dir.join("C0056.mkv");
        let status = video::command("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error"])
            .args([
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x180:rate=25:duration=2",
            ])
            .args(["-c:v", "mpeg4", "-f", "matroska", "-"])
            .stdout(fs::File::create(&piped).unwrap())
            .status()
            .unwrap();
        assert!(status.success());
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

    /// Compiles a shim that makes reads of any file whose path holds "cutme" fail past `CUT_AT` bytes, as a card
    /// pulled midway does (EIO). Linux only, where the sidecar links the C library dynamically.
    #[cfg(target_os = "linux")]
    fn pulled_card_shim(dir: &Path) -> PathBuf {
        let source = dir.join("pulled.c");
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
    off_t at = lseek(fd, 0, SEEK_CUR);
    off_t end = atoll(getenv("CUT_AT") ? getenv("CUT_AT") : "0");
    if (at >= end) { errno = EIO; return -1; }
    if (at + (off_t)count > end) count = end - at;
  }
  return real_read(fd, buf, count);
}
"#,
        )
        .unwrap();
        let shim = dir.join("pulled.so");
        let status = std::process::Command::new("cc")
            .args(["-shared", "-fPIC", "-O2", "-o"])
            .arg(&shim)
            .arg(&source)
            .arg("-ldl")
            .status()
            .expect("a C compiler (cc) for the pulled-card shim");
        assert!(status.success(), "the shim compiled");
        shim
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_card_pulled_midway_leaves_no_copy_though_ffmpeg_says_it_went_well() {
        let dir = temp_dir("pulled");
        let shim = pulled_card_shim(&dir);
        let clip = make_clip(
            &dir,
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
        );
        let half = fs::metadata(&clip).unwrap().len() / 2;
        let mut cache = PlaybackCache::in_folder(&dir.join("cache"));
        // Only the encode reads through the shim: the probes before it read the whole file.
        cache.encode_env = vec![
            ("LD_PRELOAD".into(), shim.to_string_lossy().into_owned()),
            ("CUT_AT".into(), half.to_string()),
        ];
        assert_eq!(cache.make(&clip, |_| {}).unwrap_err(), SHORT);
        let (folder, _) = cache.folder().unwrap();
        assert!(names(&folder).is_empty(), "nothing kept");
        // The card back in: the copy is made whole.
        cache.encode_env.clear();
        let made = cache.make(&clip, |_| {}).unwrap();
        assert_eq!(video::probe(&made.path).unwrap().duration_frames, 200);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn stops_an_encode_that_says_nothing_for_the_stall_time_and_frees_the_turn() {
        let dir = temp_dir("stall");
        let clip = long_clip(&dir);
        let mut cache = PlaybackCache::in_folder(&dir.join("cache"));
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
    fn hears_a_failed_read_in_ffmpegs_own_words() {
        let mut said = Said::default();
        said.hear("[mpeg4 @ 0x55e8a2b74f80] ac-tex damaged at 37 11\n");
        said.hear("[in#0/mov,mp4,m4a,3gp,3g2,mj2 @ 0x55e8a2b2cdc0] stream 1, offset 0x14fc26: partial file\n");
        assert_eq!(said, Said::default(), "a damaged frame alone is no cut");
        said.hear("[in#0/mov,mp4,m4a,3gp,3g2,mj2 @ 0x55e8a2b2cac0] Error during demuxing: Input/output error\n");
        assert!(said.read_failed && !said.damaged);
        let mut said = Said::default();
        said.hear(
            "[in#0/mxf @ 0x1] Error during demuxing: Invalid data found when processing input\n",
        );
        assert!(said.damaged && !said.read_failed);
        assert_eq!(Stop::Failed(said).message(), FAILED);
        assert_eq!(
            Stop::Failed(Said {
                read_failed: true,
                damaged: false
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
            damaged: false,
        };
        let damaged = Said {
            read_failed: false,
            damaged: true,
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
        fs::write(&path, vec![0u8; bytes]).unwrap();
        let file = fs::File::options().write(true).open(&path).unwrap();
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
        assert_eq!(cache.move_to(Some(&drive)).unwrap(), 1);
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
            .save(Settings {
                root: Some(b.clone()),
                leftovers: vec![a.join(FOLDER_NAME)],
                ..cache.settings()
            })
            .unwrap();
        let info = cache.info().unwrap();
        assert_eq!(info.copies, 1, "A's copy is still counted");
        let clip = dir.join("C0058.mov");
        fs::write(&clip, "take").unwrap();
        let key = key_of(&clip).unwrap();
        fs::rename(&on_a, a.join(FOLDER_NAME).join(file_name(&key, false))).unwrap();
        assert_eq!(
            cache.find(&clip).unwrap().map(|made| made.path),
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
            .find(&clip)
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
        assert!(move_one(&copy, &target, true));
        assert!(target.is_file() && !copy.exists());
        assert_eq!(fs::read(&target).unwrap().len(), 300);
        assert_eq!(fs::read_dir(&to).unwrap().count(), 1, "no partial left");
        // A copy that can't be moved (the target folder gone) is deleted, never left behind.
        let stuck = pretend(&from, 2, 10, 0);
        assert!(!move_one(&stuck, &dir.join("gone").join("x.mp4"), true));
        assert!(!stuck.exists());

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
        assert!(cut.exists(), "waits its turn");
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
                leftovers: Vec::new(),
            }
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
