//! Playback copies (Phase 2.3): the app never plays an original (CLAUDE.md). ffmpeg makes an H.264 MP4 of each linked
//! video with the computer's own encoder, at most 1920 px on the long edge, at a constant rate, with a keyframe every
//! 12 frames so stepping and scrubbing land fast; frame 0 is the video stream's first frame, as stills count it.
//!
//! The copies live in a folder of the app's own, `Storiiboard Playback Copies`, on this computer (never in the .sbd,
//! never synced): in the app's cache folder, or on a drive the person picks. Rust alone knows where it is and deletes
//! only files it named there, so the page can never point a Clear or the cap at anything else. A copy is written as
//! `.partial` and renamed only once it's checked whole (the original unchanged, its length and sound all there), so a
//! crash, a kill, a Cancel or a card pulled midway never leaves a copy that looks done. The folder is kept under a cap
//! (about 50 GB by default), the copies used longest ago going first.

use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
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
/// An encode that reports no progress for this long has stalled (a dead share, a stuck encoder) and is stopped.
const STALL: Duration = Duration::from_secs(90);

const CANCELLED: &str = "The playback copy was cancelled.";
const FAILED: &str = "That video couldn't be made into a playback copy.";
const SHORT: &str =
    "The playback copy came out shorter than the video. If it's on a card or a drive, check it's still connected.";
const UNWRITABLE: &str = "Playback copies can't be written in that folder.";

/// What Rust keeps about the cache, in the app's data folder; the page never writes it. Every field has a default, so a
/// file from another version still reads.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Settings {
    /// The folder the person picked, which holds `FOLDER_NAME`; none for the cache folder.
    root: Option<PathBuf>,
    cap_gb: u64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            root: None,
            cap_gb: DEFAULT_CAP_GB,
        }
    }
}

/// A copy asked for, from the moment it's asked: Cancel reaches it while it waits its turn, while the original is read,
/// and once ffmpeg runs.
struct Job {
    child: Option<Arc<Mutex<Child>>>,
    cancelled: Arc<AtomicBool>,
}

pub struct PlaybackCache {
    settings_file: Option<PathBuf>,
    default_root: PathBuf,
    settings: Mutex<Settings>,
    /// By the original's path as the page names it.
    jobs: Mutex<HashMap<String, Job>>,
    /// One copy at a time: a hardware encoder is shared, and the drive is too.
    turn: Mutex<()>,
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
/// copy; the old one ages out under the cap.
pub fn key_of(path: &Path) -> Result<String, String> {
    let meta = fs::metadata(path).map_err(|_| "That file isn't there any more.".to_string())?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_nanos());
    let text = format!(
        "{RECIPE}\0{}\0{}\0{modified}",
        path.to_string_lossy(),
        meta.len()
    );
    Ok(fnv128(text.as_bytes()))
}

/// A file of ours in the folder: a finished copy (`<key>.mp4`), or one being made (`<key>.mp4.partial`).
fn ours(name: &str) -> Option<(&str, bool)> {
    let (key, partial) = match name.strip_suffix(".mp4.partial") {
        Some(key) => (key, true),
        None => (name.strip_suffix(".mp4")?, false),
    };
    (key.len() == 32
        && key
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()))
    .then_some((key, partial))
}

/// A finished copy in a folder.
struct Copy {
    path: PathBuf,
    bytes: u64,
    used: SystemTime,
}

fn copies(folder: &Path) -> Vec<Copy> {
    let Ok(entries) = fs::read_dir(folder) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name();
            let (_, partial) = ours(name.to_str()?)?;
            let meta = entry.metadata().ok().filter(fs::Metadata::is_file)?;
            (!partial).then(|| Copy {
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
            .is_some_and(|(_, partial)| partial)
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
    let mut all: Vec<Copy> = folders.iter().flat_map(|f| copies(f)).collect();
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

/// Whether a copy is whole: as many frames as the original (give or take a frame or two at a cut, or one in 500 for a
/// long file), and sound where the original has it and the copy was made with it. A read error midway (a card pulled,
/// a share gone) makes ffmpeg end early as if the file had ended, so the length is the tell.
fn complete(original_frames: u64, with_sound: bool, copy: &video::Probe) -> bool {
    let slack = (original_frames / 500).max(2);
    copy.duration_frames.abs_diff(original_frames) <= slack && (!with_sound || copy.has_audio)
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
/// the software one.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct Progress {
    pub done: f64,
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

/// Takes a job off the list when its make ends, however it ends.
struct Registered<'a> {
    cache: &'a PlaybackCache,
    name: String,
}

impl Drop for Registered<'_> {
    fn drop(&mut self) {
        lock(&self.cache.jobs).remove(&self.name);
    }
}

impl PlaybackCache {
    pub fn load(data_dir: &Path, cache_dir: &Path) -> Self {
        let settings_file = data_dir.join("playback.json");
        let settings = fs::read(&settings_file)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        let cache = Self {
            settings_file: Some(settings_file),
            default_root: cache_dir.to_path_buf(),
            settings: Mutex::new(settings),
            jobs: Mutex::new(HashMap::new()),
            turn: Mutex::new(()),
        };
        // Copies cut off by a crash or a quit, in both folders; on a thread of its own, so a drive slow to wake (or a
        // share that doesn't answer) never holds up the window.
        let folders: Vec<PathBuf> = cache.all_folders();
        std::thread::spawn(move || {
            for folder in folders {
                delete_partials(&folder);
            }
        });
        cache
    }

    #[cfg(test)]
    fn in_folder(root: &Path) -> Self {
        Self {
            settings_file: None,
            default_root: root.to_path_buf(),
            settings: Mutex::new(Settings::default()),
            jobs: Mutex::new(HashMap::new()),
            turn: Mutex::new(()),
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

    /// Every folder that holds copies of ours: where they go now, and the cache folder when a picked drive is the
    /// usual place, since copies made while it was away are there. Counted, capped and cleared together.
    fn all_folders(&self) -> Vec<PathBuf> {
        let mut folders = Vec::new();
        if let Some(root) = self.settings().root {
            if root.is_dir() {
                folders.push(root.join(FOLDER_NAME));
            }
        }
        let home = self.default_folder();
        if home.is_dir() && !folders.contains(&home) {
            folders.push(home);
        }
        folders
    }

    /// The finished copy of a video, if there is one; marked as used. Where copies go now, or one made in the cache
    /// folder while the picked drive was away.
    pub fn find(&self, path: &Path) -> Result<Option<PathBuf>, String> {
        let name = format!("{}.mp4", key_of(path)?);
        let (now, _) = self.folder()?;
        let found = std::iter::once(now)
            .chain(self.all_folders())
            .map(|folder| folder.join(&name))
            .find(|copy| copy.is_file());
        if let Some(copy) = &found {
            touch(copy);
        }
        Ok(found)
    }

    /// Makes the playback copy of a video, or finds the one already made. One at a time; `on_progress` hears how far
    /// along it is. `name` is the original's path as the page names it, which Cancel uses.
    pub fn make(&self, path: &Path, mut on_progress: impl FnMut(f64)) -> Result<PathBuf, String> {
        if let Some(done) = self.find(path)? {
            return Ok(done);
        }
        let name = path.to_string_lossy().into_owned();
        let cancelled = Arc::new(AtomicBool::new(false));
        lock(&self.jobs).insert(
            name.clone(),
            Job {
                child: None,
                cancelled: Arc::clone(&cancelled),
            },
        );
        let _registered = Registered {
            cache: self,
            name: name.clone(),
        };
        let stopped = || cancelled.load(Ordering::SeqCst);
        let _turn = lock(&self.turn);
        if stopped() {
            return Err(CANCELLED.into());
        }
        // Made while this one waited its turn.
        if let Some(done) = self.find(path)? {
            return Ok(done);
        }
        let key = key_of(path)?;
        let (folder, _) = self.folder()?;
        let done = folder.join(format!("{key}.mp4"));
        let partial = folder.join(format!("{key}.mp4.partial"));
        let probe = video::probe(path)?;
        let (stream_start, file_start) = video::starts(path)?;
        if stopped() {
            return Err(CANCELLED.into());
        }
        let rate = (probe.fps_num, probe.fps_den);
        let total = probe.duration_frames.max(1) as f64;
        // Each encoder with sound; then, if none could, the last one without (sound ffmpeg can't decode shouldn't cost
        // the picture).
        let mut attempts: Vec<(Vec<&str>, bool)> =
            encoders().into_iter().map(|e| (e, true)).collect();
        if let Some((last, _)) = attempts.last().cloned() {
            attempts.push((last, false));
        }
        let mut outcome = Err(FAILED.to_string());
        let mut with_sound = true;
        for (encoder, sound) in attempts {
            with_sound = sound;
            let run = Run {
                path,
                partial: &partial,
                name: &name,
                rate,
                offset: stream_start - file_start,
                encoder: &encoder,
                sound,
            };
            outcome = self.encode(&run, &cancelled, |frame| {
                on_progress((frame / total).min(1.0));
            });
            match &outcome {
                Ok(()) => break,
                Err(error) if error == CANCELLED => break,
                Err(_) => {}
            }
        }
        let checked = outcome.and_then(|()| {
            // The original changed while it was read (an offload still writing): this copy isn't of it.
            if key_of(path)? != key {
                return Err(FAILED.into());
            }
            let made = video::probe(&partial)?;
            if complete(probe.duration_frames, with_sound && probe.has_audio, &made) {
                Ok(())
            } else {
                Err(SHORT.into())
            }
        });
        if let Err(error) = checked {
            let _ = fs::remove_file(&partial);
            return Err(error);
        }
        fs::rename(&partial, &done).map_err(|_| {
            let _ = fs::remove_file(&partial);
            UNWRITABLE.to_string()
        })?;
        on_progress(1.0);
        self.keep_under_cap(&done);
        Ok(done)
    }

    fn encode(
        &self,
        run: &Run<'_>,
        cancelled: &Arc<AtomicBool>,
        mut on_frame: impl FnMut(f64),
    ) -> Result<(), String> {
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
            .args(["-g", "12", "-movflags", "+faststart", "-f", "mp4"])
            .args(["-progress", "pipe:1", "-nostats"])
            .arg(run.partial)
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        if cancelled.load(Ordering::SeqCst) {
            return Err(CANCELLED.into());
        }
        let mut child = command.spawn().map_err(|_| {
            "Storiiboard's video reader couldn't start. Reinstalling Storiiboard puts it back."
                .to_string()
        })?;
        let stdout = child.stdout.take();
        let child = Arc::new(Mutex::new(child));
        if let Some(job) = lock(&self.jobs).get_mut(run.name) {
            job.child = Some(Arc::clone(&child));
        }
        // Cancel may have come between the check above and the job knowing its child.
        if cancelled.load(Ordering::SeqCst) {
            let _ = lock(&child).kill();
        }
        // A watchdog: ffmpeg reports progress about twice a second even when it's slow; none for `STALL` and it has
        // stalled, so it's stopped and this copy fails rather than holding every later one up.
        let started = Instant::now();
        let last = Arc::new(AtomicU64::new(0));
        let finished = Arc::new(AtomicBool::new(false));
        let stalled = Arc::new(AtomicBool::new(false));
        let watchdog = {
            let (child, last, finished, stalled) = (
                Arc::clone(&child),
                Arc::clone(&last),
                Arc::clone(&finished),
                Arc::clone(&stalled),
            );
            std::thread::spawn(move || {
                while !finished.load(Ordering::SeqCst) {
                    std::thread::sleep(Duration::from_millis(250));
                    let quiet = started
                        .elapsed()
                        .saturating_sub(Duration::from_millis(last.load(Ordering::SeqCst)));
                    if quiet > STALL {
                        stalled.store(true, Ordering::SeqCst);
                        let _ = lock(&child).kill();
                        break;
                    }
                }
            })
        };
        // ffmpeg reports `frame=N` as it goes; a kill closes the pipe and ends the loop. Whatever is left is read to
        // the end, so ffmpeg never waits on a full pipe.
        if let Some(stdout) = stdout {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        last.store(started.elapsed().as_millis() as u64, Ordering::SeqCst);
                        if let Some(frame) = line
                            .strip_prefix("frame=")
                            .and_then(|n| n.trim().parse::<f64>().ok())
                        {
                            on_frame(frame);
                        }
                    }
                }
            }
            let _ = std::io::copy(&mut reader.take(u64::MAX), &mut std::io::sink());
        }
        let status = lock(&child).wait();
        finished.store(true, Ordering::SeqCst);
        let _ = watchdog.join();
        if cancelled.load(Ordering::SeqCst) {
            return Err(CANCELLED.into());
        }
        match status {
            Ok(status) if status.success() && !stalled.load(Ordering::SeqCst) => Ok(()),
            _ => Err(FAILED.into()),
        }
    }

    /// Stops the copy of this video, wherever it is: waiting its turn, reading the original, or encoding; the half
    /// copy is deleted. By the path as the page names it, without reading the original, so it works when the card is
    /// gone or the share has stopped answering. Whether there was one to stop.
    pub fn cancel(&self, name: &str) -> bool {
        let jobs = lock(&self.jobs);
        let Some(job) = jobs.get(name) else {
            return false;
        };
        job.cancelled.store(true, Ordering::SeqCst);
        if let Some(child) = &job.child {
            let _ = lock(child).kill();
        }
        true
    }

    /// Stops every copy being made: the app is quitting, and ffmpeg shouldn't go on alone.
    pub fn cancel_all(&self) {
        for job in lock(&self.jobs).values() {
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
        let all: Vec<Copy> = self.all_folders().iter().flat_map(|f| copies(f)).collect();
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

    /// Moves the copies into `root` (or back to the cache folder with None). The new folder is tested for writing
    /// first; then the setting is saved, so a crash partway leaves copies only where the app looks; then each copy is
    /// moved, or deleted where it can't be (it's made again when played). Not while one is being made. Returns how
    /// many moved.
    pub fn move_to(&self, root: Option<&Path>) -> Result<usize, String> {
        if !lock(&self.jobs).is_empty() {
            return Err("A playback copy is being made; move the copies once it's done.".into());
        }
        let _turn = lock(&self.turn);
        let olds = self.all_folders();
        let new = root.unwrap_or(&self.default_root).join(FOLDER_NAME);
        fs::create_dir_all(&new).map_err(|_| UNWRITABLE.to_string())?;
        let probe = new.join(format!("{:032x}.mp4.partial", 0));
        fs::write(&probe, b"")
            .and_then(|()| fs::remove_file(&probe))
            .map_err(|_| UNWRITABLE.to_string())?;
        self.save(Settings {
            root: root.map(Path::to_path_buf),
            ..self.settings()
        })?;
        // The same folder by another spelling is still the same folder: nothing to move.
        let same = |a: &Path, b: &Path| match (a.canonicalize(), b.canonicalize()) {
            (Ok(a), Ok(b)) => a == b,
            _ => a == b,
        };
        let mut moved = 0;
        for old in olds.iter().filter(|old| !same(old, &new)) {
            for copy in copies(old) {
                let Some(file) = copy.path.file_name() else {
                    continue;
                };
                if move_one(&copy.path, &new.join(file), false) {
                    moved += 1;
                }
            }
            // Only our folder, and only if nothing else is in it.
            let _ = fs::remove_dir(old);
        }
        Ok(moved)
    }
}

/// One encode: what to read, where to write, and how.
struct Run<'a> {
    path: &'a Path,
    partial: &'a Path,
    name: &'a str,
    rate: (u32, u32),
    offset: f64,
    encoder: &'a [&'a str],
    sound: bool,
}

/// Makes a video's playback copy (or finds it) and returns its path, reporting progress on `progress`.
#[tauri::command]
pub async fn playback_make(
    app: AppHandle,
    path: String,
    handle: Option<u32>,
    progress: Channel<Progress>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = Path::new(&path);
        Access::of(&app, handle).readable(path)?;
        let made = app.state::<PlaybackCache>().make(path, |done| {
            let _ = progress.send(Progress { done });
        })?;
        Ok(made.to_string_lossy().into_owned())
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
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = Path::new(&path);
        Access::of(&app, handle).readable(path)?;
        Ok(app
            .state::<PlaybackCache>()
            .find(path)?
            .map(|p| p.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stops the copy of a video being made. Only work already asked for can be stopped, so it reads nothing.
#[tauri::command]
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

    #[test]
    fn names_a_copy_by_the_files_path_size_and_time_and_never_the_same_for_a_changed_file() {
        let dir = temp_dir("key");
        let clip = dir.join("C0042.MP4");
        fs::write(&clip, "take one").unwrap();
        let first = key_of(&clip).unwrap();
        assert_eq!(first.len(), 32);
        assert_eq!(key_of(&clip).unwrap(), first);
        assert!(ours(&format!("{first}.mp4")).is_some());
        fs::write(&clip, "take two, longer").unwrap();
        assert_ne!(key_of(&clip).unwrap(), first);
        // Not ours: another name, capitals, too short.
        for name in [
            "notes.txt",
            "ABCDEF0123456789ABCDEF0123456789.mp4",
            "C0042.MP4",
            "0123.mp4",
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
        let copy = cache.make(&clip, |done| seen.push(done)).unwrap();
        assert!(copy.starts_with(dir.join("cache").join(FOLDER_NAME)));
        let name = copy.file_name().unwrap().to_string_lossy().into_owned();
        assert!(ours(&name).is_some_and(|(_, partial)| !partial));
        assert_eq!(seen.last().copied(), Some(1.0));
        let made = video::probe(&copy).unwrap();
        assert_eq!((made.fps_num, made.fps_den), (24000, 1001));
        assert_eq!((made.width, made.height), (1920, 1080));
        assert_eq!(made.duration_frames, 48);
        assert!(made.has_audio);
        // Stepping and scrubbing land fast: a keyframe every 12 frames, whatever the computer's encoder.
        assert_eq!(keyframes(&copy), [0, 12, 24, 36]);
        assert_eq!(cache.find(&clip).unwrap(), Some(copy.clone()));
        // Asked again: the same copy, nothing made.
        let mut again = 0;
        assert_eq!(cache.make(&clip, |_| again += 1).unwrap(), copy);
        assert_eq!(again, 0);
        // Nothing half-made left beside it, and no job left behind.
        let names: Vec<String> = fs::read_dir(copy.parent().unwrap())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names.len(), 1, "{names:?}");
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
        let copy = cache.make(&clip, |_| {}).unwrap();
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

    #[test]
    fn cancel_mid_copy_leaves_no_copy_and_nothing_half_made() {
        let dir = temp_dir("cancel");
        let clip = make_clip(
            &dir,
            "long.mov",
            &[
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=1920x1080:rate=25:duration=30",
            ],
            &["-c:v", "mpeg4", "-q:v", "10"],
        );
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
        while !lock(&cache.jobs).contains_key(&name) {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(cache.info().unwrap().busy);
        assert!(cache.cancel(&name));
        drop(turn);
        assert_eq!(waiting.join().unwrap().unwrap_err(), CANCELLED);
        assert_eq!(cache.find(&clip).unwrap(), None);
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
    fn calls_a_copy_whole_only_with_all_its_frames_and_its_sound() {
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
        assert!(complete(48, true, &probe(48, true)));
        assert!(complete(48, true, &probe(47, true)), "a frame at a cut");
        assert!(
            !complete(48, true, &probe(30, true)),
            "a card pulled midway"
        );
        assert!(!complete(48, true, &probe(48, false)), "the sound lost");
        assert!(
            complete(48, false, &probe(48, false)),
            "made without sound on purpose"
        );
        // A 40-minute take: one frame in 500 of slack.
        assert!(complete(57_600, true, &probe(57_500, true)));
        assert!(!complete(57_600, true, &probe(50_000, true)));
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
        // Clear deletes our copies, and only those.
        pretend(&folder, 4, 10, 0);
        assert_eq!(cache.clear().unwrap(), 2);
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
    fn deletes_copies_cut_off_by_a_crash_when_it_starts_and_leaves_everything_else() {
        let dir = temp_dir("partial");
        let folder = dir.join("cache").join(FOLDER_NAME);
        fs::create_dir_all(&folder).unwrap();
        let cut = folder.join(format!("{:032x}.mp4.partial", 5));
        let done = folder.join(format!("{:032x}.mp4", 6));
        let other = folder.join("readme.partial");
        for f in [&cut, &done, &other] {
            fs::write(f, "x").unwrap();
        }
        let cache = PlaybackCache::load(&dir.join("data"), &dir.join("cache"));
        // The clean-up runs on a thread of its own.
        for _ in 0..200 {
            if !cut.exists() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(!cut.exists() && done.exists() && other.exists());
        cache.set_cap(20).unwrap();
        let saved = fs::read(dir.join("data").join("playback.json")).unwrap();
        let settings: Settings = serde_json::from_slice(&saved).unwrap();
        assert_eq!(settings.cap_gb, 20);
        assert!(cache.set_cap(0).is_err());
        // A settings file from another version, with a field this one doesn't know and one missing, still reads.
        let other: Settings = serde_json::from_str(r#"{"capGb": 30, "later": true}"#).unwrap();
        assert_eq!(
            other,
            Settings {
                root: None,
                cap_gb: 30
            }
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
