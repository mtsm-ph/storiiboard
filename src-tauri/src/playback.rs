//! Playback copies (Phase 2.3): the app never plays an original (CLAUDE.md). ffmpeg makes an H.264 MP4 of each linked
//! video with the computer's own encoder, at most 1920 px on the long edge, at a constant rate, with a keyframe every
//! 12 frames so stepping and scrubbing land fast; frame 0 is the video stream's first frame, as stills count it.
//!
//! The copies live in a folder of the app's own, `Storiiboard Playback Copies`, on this computer (never in the .sbd,
//! never synced): in the app's cache folder, or on a drive the person picks. Rust alone knows where it is and deletes
//! only files it named there, so the page can never point a Clear or the cap at anything else. A copy is written as
//! `.partial` and renamed when complete, so a crash, a kill or a Cancel never leaves a half copy that looks done. The
//! folder is kept under a cap (about 50 GB by default), the copies used longest ago going first.

use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

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

/// What Rust keeps about the cache, in the app's data folder; the page never writes it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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

/// A copy being made, so Cancel can stop it.
struct Job {
    child: Arc<Mutex<Child>>,
    cancelled: Arc<AtomicBool>,
}

pub struct PlaybackCache {
    settings_file: Option<PathBuf>,
    default_root: PathBuf,
    settings: Mutex<Settings>,
    jobs: Mutex<HashMap<String, Job>>,
    /// One copy at a time: a hardware encoder is shared, and the drive is too.
    turn: Mutex<()>,
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

/// A finished copy in the folder.
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

/// Marks a copy as just used: the cap removes the copies used longest ago.
fn touch(path: &Path) {
    if let Ok(file) = fs::File::options().write(true).open(path) {
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
        ],
    ];
    #[cfg(not(any(windows, target_os = "macos")))]
    return vec![vec!["-c:v", "mpeg4", "-q:v", "3"]];
}

/// Deletes the copies in `folder` used longest ago until they come to `cap` bytes or less; never `keep`.
fn keep_under(folder: &Path, keep: &Path, cap: u64) {
    let mut all = copies(folder);
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

/// What a copy being made reports: how far along, 0 to 1.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct Progress {
    pub done: f64,
}

/// The cache folder as it is now.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheInfo {
    pub folder: String,
    pub bytes: u64,
    pub copies: usize,
    pub cap_gb: u64,
    /// The picked drive isn't there (unplugged): copies go to the cache folder until it's back.
    pub fallback: bool,
    /// A copy is being made.
    pub busy: bool,
}

const CANCELLED: &str = "The playback copy was cancelled.";

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
        // A copy cut off by a crash or a quit: never played, and never left to take space.
        if let Ok((folder, _)) = cache.folder() {
            for entry in fs::read_dir(&folder).into_iter().flatten().flatten() {
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
        self.settings.lock().map(|s| s.clone()).unwrap_or_default()
    }

    fn save(&self, settings: Settings) -> Result<(), String> {
        if let Some(file) = &self.settings_file {
            let json = serde_json::to_vec(&settings).map_err(|e| e.to_string())?;
            write_atomically(file, &json).map_err(|e| e.to_string())?;
        }
        if let Ok(mut now) = self.settings.lock() {
            *now = settings;
        }
        Ok(())
    }

    /// Where copies go now, made if it isn't there; and whether that's the cache folder standing in for a picked
    /// drive that isn't there.
    pub fn folder(&self) -> Result<(PathBuf, bool), String> {
        let (root, fallback) = match self.settings().root {
            Some(root) if root.is_dir() => (root, false),
            Some(_) => (self.default_root.clone(), true),
            None => (self.default_root.clone(), false),
        };
        let folder = root.join(FOLDER_NAME);
        fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        Ok((folder, fallback))
    }

    /// The finished copy of a video, if there is one; marked as used.
    pub fn find(&self, path: &Path) -> Result<Option<PathBuf>, String> {
        let key = key_of(path)?;
        let (folder, _) = self.folder()?;
        let done = folder.join(format!("{key}.mp4"));
        Ok(done.is_file().then(|| {
            touch(&done);
            done
        }))
    }

    /// Makes the playback copy of a video, or finds the one already made. One at a time; `on_progress` hears how far
    /// along it is.
    pub fn make(&self, path: &Path, mut on_progress: impl FnMut(f64)) -> Result<PathBuf, String> {
        if let Some(done) = self.find(path)? {
            return Ok(done);
        }
        let _turn = self
            .turn
            .lock()
            .map_err(|_| "Playback copies are unavailable.")?;
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
        let rate = (probe.fps_num, probe.fps_den);
        let total = probe.duration_frames.max(1) as f64;
        let mut outcome = Err("That video couldn't be made into a playback copy.".to_string());
        for encoder in encoders() {
            outcome = self.encode(
                path,
                &partial,
                &key,
                rate,
                stream_start - file_start,
                &encoder,
                |frame| on_progress((frame / total).min(1.0)),
            );
            match &outcome {
                Ok(()) => break,
                // Cancelled: no next encoder.
                Err(error) if error == CANCELLED => break,
                Err(_) => {}
            }
        }
        if outcome.is_err() {
            let _ = fs::remove_file(&partial);
        }
        outcome?;
        fs::rename(&partial, &done).map_err(|e| e.to_string())?;
        on_progress(1.0);
        self.keep_under_cap(&folder, &done);
        Ok(done)
    }

    #[allow(clippy::too_many_arguments)]
    fn encode(
        &self,
        path: &Path,
        partial: &Path,
        key: &str,
        (fps_num, fps_den): (u32, u32),
        offset: f64,
        encoder: &[&str],
        mut on_frame: impl FnMut(f64),
    ) -> Result<(), String> {
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
        if offset > 0.0 {
            let early = (offset - 0.25 * f64::from(fps_den) / f64::from(fps_num)).max(0.0);
            command.arg("-ss").arg(format!("{early:.6}"));
        }
        command
            .arg("-i")
            .arg(path)
            .args(["-map", "0:V:0", "-map", "0:a:0?", "-vf", &filter])
            .args(["-fps_mode", "cfr", "-r"])
            .arg(format!("{fps_num}/{fps_den}"))
            .args(encoder)
            .args(["-g", "12", "-c:a", "aac", "-b:a", "160k", "-ac", "2"])
            .args(["-movflags", "+faststart", "-f", "mp4"])
            .args(["-progress", "pipe:1", "-nostats"])
            .arg(partial)
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let mut child = command.spawn().map_err(|_| {
            "Storiiboard's video reader couldn't start. Reinstalling Storiiboard puts it back."
                .to_string()
        })?;
        let stdout = child.stdout.take();
        let child = Arc::new(Mutex::new(child));
        let cancelled = Arc::new(AtomicBool::new(false));
        if let Ok(mut jobs) = self.jobs.lock() {
            jobs.insert(
                key.to_owned(),
                Job {
                    child: Arc::clone(&child),
                    cancelled: Arc::clone(&cancelled),
                },
            );
        }
        // ffmpeg reports `frame=N` as it goes; a kill closes the pipe and ends the loop.
        if let Some(stdout) = stdout {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Some(frame) = line
                    .strip_prefix("frame=")
                    .and_then(|n| n.trim().parse::<f64>().ok())
                {
                    on_frame(frame);
                }
            }
        }
        let status = child.lock().map_err(|e| e.to_string())?.wait();
        if let Ok(mut jobs) = self.jobs.lock() {
            jobs.remove(key);
        }
        if cancelled.load(Ordering::SeqCst) {
            return Err(CANCELLED.into());
        }
        match status {
            Ok(status) if status.success() => Ok(()),
            _ => Err("That video couldn't be made into a playback copy.".into()),
        }
    }

    /// Stops the copy of this video being made, if one is; the half copy is deleted.
    pub fn cancel(&self, path: &Path) -> Result<bool, String> {
        let key = key_of(path)?;
        let jobs = self.jobs.lock().map_err(|e| e.to_string())?;
        let Some(job) = jobs.get(&key) else {
            return Ok(false);
        };
        job.cancelled.store(true, Ordering::SeqCst);
        if let Ok(mut child) = job.child.lock() {
            let _ = child.kill();
        }
        Ok(true)
    }

    /// Deletes copies used longest ago until the folder is under the cap. Never `keep`, the copy just made.
    fn keep_under_cap(&self, folder: &Path, keep: &Path) {
        keep_under(folder, keep, self.settings().cap_gb.saturating_mul(GB));
    }

    pub fn info(&self) -> Result<CacheInfo, String> {
        let (folder, fallback) = self.folder()?;
        let all = copies(&folder);
        Ok(CacheInfo {
            folder: folder.to_string_lossy().into_owned(),
            bytes: all.iter().map(|c| c.bytes).sum(),
            copies: all.len(),
            cap_gb: self.settings().cap_gb,
            fallback,
            busy: self.jobs.lock().is_ok_and(|jobs| !jobs.is_empty()),
        })
    }

    /// Deletes every finished copy (they're made again when played). Returns how many went.
    pub fn clear(&self) -> Result<usize, String> {
        let (folder, _) = self.folder()?;
        Ok(copies(&folder)
            .into_iter()
            .filter(|c| fs::remove_file(&c.path).is_ok())
            .count())
    }

    pub fn set_cap(&self, gb: u64) -> Result<(), String> {
        if !(1..=10_000).contains(&gb) {
            return Err("The cap for playback copies is between 1 and 10,000 GB.".into());
        }
        let folder = self.folder()?.0;
        self.save(Settings {
            cap_gb: gb,
            ..self.settings()
        })?;
        self.keep_under_cap(&folder, Path::new(""));
        Ok(())
    }

    /// Moves the copies into `root` (or back to the cache folder with None), each one moved or, where it can't be,
    /// left to be made again. Not while one is being made. Returns how many moved.
    pub fn move_to(&self, root: Option<&Path>) -> Result<usize, String> {
        if self.jobs.lock().is_ok_and(|jobs| !jobs.is_empty()) {
            return Err("A playback copy is being made; move the copies once it's done.".into());
        }
        let _turn = self
            .turn
            .lock()
            .map_err(|_| "Playback copies are unavailable.")?;
        let (old, _) = self.folder()?;
        let new = root.unwrap_or(&self.default_root).join(FOLDER_NAME);
        fs::create_dir_all(&new).map_err(|e| e.to_string())?;
        let mut moved = 0;
        if new != old {
            for copy in copies(&old) {
                let Some(name) = copy.path.file_name() else {
                    continue;
                };
                let target = new.join(name);
                // A rename on the same drive; a copy then a delete across drives. A copy that fails is removed, and
                // that video's copy is made again when it's played.
                let done = fs::rename(&copy.path, &target).is_ok()
                    || match fs::copy(&copy.path, &target) {
                        Ok(_) => fs::remove_file(&copy.path).is_ok(),
                        Err(_) => {
                            let _ = fs::remove_file(&target);
                            false
                        }
                    };
                if done {
                    moved += 1;
                }
            }
            // Only our folder, and only if nothing else is in it.
            let _ = fs::remove_dir(&old);
        }
        self.save(Settings {
            root: root.map(Path::to_path_buf),
            ..self.settings()
        })?;
        Ok(moved)
    }
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

#[tauri::command]
pub async fn playback_cancel(
    app: AppHandle,
    path: String,
    handle: Option<u32>,
) -> Result<bool, String> {
    let path = Path::new(&path);
    Access::of(&app, handle).readable(path)?;
    app.state::<PlaybackCache>().cancel(path)
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
    use std::time::Duration;

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
    fn makes_a_copy_at_most_1920_wide_at_the_exact_rate_reporting_progress_and_finds_it_after() {
        let dir = temp_dir("make");
        let clip = make_clip(
            &dir,
            "A001_C003.mov",
            &[
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=3840x2160:rate=24000/1001:duration=2",
                "-f",
                "lavfi",
                "-i",
                "sine=duration=2",
            ],
            &["-c:v", "mpeg4", "-q:v", "5", "-c:a", "aac"],
        );
        let cache = PlaybackCache::in_folder(&dir.join("cache"));
        let mut seen = Vec::new();
        let copy = cache.make(&clip, |done| seen.push(done)).unwrap();
        assert!(copy.starts_with(dir.join("cache").join(FOLDER_NAME)));
        let name = copy.file_name().unwrap().to_string_lossy().into_owned();
        assert!(ours(&name).is_some_and(|(_, partial)| !partial));
        assert_eq!(seen.last().copied(), Some(1.0));
        assert!(seen.windows(2).all(|w| w[0] <= w[1]), "{seen:?}");
        let made = video::probe(&copy).unwrap();
        assert_eq!((made.fps_num, made.fps_den), (24000, 1001));
        assert_eq!((made.width, made.height), (1920, 1080));
        assert_eq!(made.duration_frames, 48);
        assert!(made.has_audio);
        assert_eq!(cache.find(&clip).unwrap(), Some(copy.clone()));
        // Asked again: the same copy, nothing made.
        let mut again = 0;
        assert_eq!(cache.make(&clip, |_| again += 1).unwrap(), copy);
        assert_eq!(again, 0);
        // Nothing half-made left beside it.
        let names: Vec<String> = fs::read_dir(copy.parent().unwrap())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names.len(), 1, "{names:?}");
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
        let mut asked = false;
        let outcome = cache.make(&clip, |_| {
            if !asked {
                asked = true;
                assert!(cache.cancel(&clip).unwrap());
            }
        });
        assert_eq!(outcome.unwrap_err(), CANCELLED);
        assert_eq!(cache.find(&clip).unwrap(), None);
        let (folder, _) = cache.folder().unwrap();
        assert_eq!(
            fs::read_dir(&folder).unwrap().count(),
            0,
            "nothing left in the folder"
        );
        assert!(!cache.info().unwrap().busy);
        let _ = fs::remove_dir_all(&dir);
    }

    /// A pretend copy of `bytes`, last used `ago` seconds back.
    fn pretend(folder: &Path, seed: u8, bytes: usize, ago: u64) -> PathBuf {
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
        // Not ours, though they sit in the folder or look a little like copies: never touched.
        let foreign = [
            folder.join("notes.txt"),
            folder.join("A001_C003.mp4"),
            dir.join(format!("{:032x}.mp4", 9)),
        ];
        for f in &foreign {
            fs::write(f, vec![0u8; 5000]).unwrap();
        }
        keep_under(&folder, &new, 2000);
        assert!(!older.exists() && old.exists() && new.exists());
        // The copy just made stays even when it alone is over the cap.
        keep_under(&folder, &new, 10);
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
        fs::remove_dir_all(&drive).unwrap();
        assert_eq!(cache.folder().unwrap(), (home.clone(), true));
        assert!(cache.info().unwrap().fallback);

        // And back to the cache folder for good.
        fs::create_dir_all(&drive).unwrap();
        let again = pretend(&cache.folder().unwrap().0, 8, 100, 0);
        assert_eq!(cache.move_to(None).unwrap(), 1);
        assert!(home.join(again.file_name().unwrap()).is_file());
        assert_eq!(cache.folder().unwrap(), (home, false));
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
        assert!(!cut.exists() && done.exists() && other.exists());
        cache.set_cap(20).unwrap();
        let saved = fs::read(dir.join("data").join("playback.json")).unwrap();
        let settings: Settings = serde_json::from_slice(&saved).unwrap();
        assert_eq!(settings.cap_gb, 20);
        assert!(cache.set_cap(0).is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
