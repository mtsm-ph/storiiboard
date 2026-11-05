//! Video files (Phase 2): what ffprobe says about one, through the LGPL ffmpeg and ffprobe sidecars that
//! scripts/ffmpeg/build.sh builds. The tools run as separate programs, with their arguments passed as a list, never
//! through a shell, so a file name can't be read as a command. Like pictures (pictures.rs), only a file the person
//! dropped or chose is read.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{ipc::Response, AppHandle, Manager};

use crate::pictures::Offered;
use crate::sbd::OpenFiles;

/// The target triple the sidecars are named for in src-tauri/binaries, as Tauri's externalBin names them.
#[cfg(debug_assertions)]
const TRIPLE: &str = env!("SBD_TARGET_TRIPLE");

/// Where a sidecar is: beside the app's own executable, where Tauri puts it in a bundle and in development. A release
/// build looks nowhere else, so a missing sidecar fails instead of running whatever sits in a folder above. A debug
/// build (development and tests) also takes `STORIIBOARD_FFMPEG_DIR`, the build folder above a test binary
/// (target/debug for target/debug/deps), and last src-tauri/binaries with its triple, as built.
pub fn tool(name: &str) -> PathBuf {
    let file = format!("{name}{}", std::env::consts::EXE_SUFFIX);
    #[cfg(debug_assertions)]
    if let Some(dir) = std::env::var_os("STORIIBOARD_FFMPEG_DIR") {
        return PathBuf::from(dir).join(&file);
    }
    let levels = if cfg!(debug_assertions) { 2 } else { 1 };
    let exe = std::env::current_exe().ok();
    if let Some(exe) = &exe {
        for dir in exe.ancestors().skip(1).take(levels) {
            let candidate = dir.join(&file);
            if candidate.is_file() {
                return candidate;
            }
        }
    }
    #[cfg(debug_assertions)]
    {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!("{name}-{TRIPLE}{}", std::env::consts::EXE_SUFFIX))
    }
    #[cfg(not(debug_assertions))]
    {
        // Where it should be, so the error says it's missing; never a bare name, which would search PATH.
        exe.as_deref()
            .and_then(Path::parent)
            .unwrap_or(Path::new("."))
            .join(file)
    }
}

/// A sidecar, ready to run. On Windows it gets no console window: the app is a windowed program, and a console tool
/// started from one opens a black window for as long as it runs. Its input is closed, so ffmpeg never waits for keys
/// or changes the terminal's mode.
pub fn command(name: &str) -> Command {
    let mut command = Command::new(tool(name));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command.stdin(Stdio::null());
    if name == "ffmpeg" {
        command.arg("-nostdin");
    }
    command
}

/// What the app needs to know about a video, from ffprobe.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    pub codec: String,
    pub width: u32,
    pub height: u32,
    /// The pixel shape as a fraction, 1/1 for square pixels; 4/3 for HDV's 1440x1080, 2/1 for a 2x anamorphic.
    pub sar_num: u32,
    pub sar_den: u32,
    /// The frame rate as an exact fraction: 24000/1001, never 23.976.
    pub fps_num: u32,
    pub fps_den: u32,
    /// Frames at that rate.
    pub duration_frames: u64,
    /// The source's start timecode as it writes it ("01:00:00:00", or "01:00:00;00" for drop-frame); none without.
    pub start_timecode: Option<String>,
    /// Degrees clockwise to turn the stored picture so it shows upright: 0, 90, 180 or 270 (a phone held upright:
    /// 90). ffprobe's display matrix says it counter-clockwise; an old `rotate` tag says it clockwise.
    pub rotation: i32,
    pub has_audio: bool,
    /// HDR (PQ or HLG): shown as SDR only once tone-mapped (Phase 2.3).
    pub hdr: bool,
    pub bit_depth: u32,
}

/// Rates cameras actually shoot at, to tell a real constant rate from a variable phone's average.
const STANDARD_RATES: &[(u32, u32)] = &[
    (24000, 1001),
    (24, 1),
    (25, 1),
    (30000, 1001),
    (30, 1),
    (48000, 1001),
    (48, 1),
    (50, 1),
    (60000, 1001),
    (60, 1),
    (96, 1),
    (100, 1),
    (120000, 1001),
    (120, 1),
    (200, 1),
    (240000, 1001),
    (240, 1),
];

/// A fraction in lowest terms, so 48000/2002 and 24000/1001 are the same rate. `separator` is '/' for rates and ':'
/// for a pixel shape.
fn fraction(text: &str, separator: char) -> Option<(u32, u32)> {
    let (num, den) = text.split_once(separator)?;
    let (num, den): (u32, u32) = (num.parse().ok()?, den.parse().ok()?);
    if num == 0 || den == 0 {
        return None;
    }
    let (mut a, mut b) = (num, den);
    while b != 0 {
        (a, b) = (b, a % b);
    }
    Some((num / a, den / a))
}

fn as_f64(rate: (u32, u32)) -> f64 {
    f64::from(rate.0) / f64::from(rate.1)
}

/// The rate to step and number frames by. The average comes first when it's a rate cameras use: an interlaced
/// stream's own rate is often its field rate (50 for 25i), its average the frame rate. Then the stream's own rate,
/// unless it's twice the average (fields again). Otherwise (a phone's variable rate) the average, made the nearest
/// standard rate, which is what the playback copy is made at.
fn frame_rate(stream: &Value) -> Option<(u32, u32)> {
    let real = stream["r_frame_rate"]
        .as_str()
        .and_then(|t| fraction(t, '/'));
    let average = stream["avg_frame_rate"]
        .as_str()
        .and_then(|t| fraction(t, '/'));
    if let Some(rate) = average.filter(|rate| STANDARD_RATES.contains(rate)) {
        return Some(rate);
    }
    let fields = |rate: (u32, u32)| {
        average.is_some_and(|avg| (as_f64(rate) - 2.0 * as_f64(avg)).abs() < 1.0)
    };
    if let Some(rate) = real.filter(|&rate| STANDARD_RATES.contains(&rate) && !fields(rate)) {
        return Some(rate);
    }
    let average = average.or(real)?;
    let value = as_f64(average);
    STANDARD_RATES
        .iter()
        .copied()
        .min_by(|a, b| {
            (as_f64(*a) - value)
                .abs()
                .total_cmp(&(as_f64(*b) - value).abs())
        })
        .filter(|rate| (as_f64(*rate) - value).abs() < 1.0)
        .or(Some(average))
}

/// Bits per sample from a pixel format's name, when the stream doesn't say: the digits before a byte order
/// (yuv420p10le: 10; p016le: 16; rgb48le and rgba64le: 16). A name without a byte order is 8 bits (nv12, yuv420p).
fn bit_depth(pix_fmt: &str) -> u32 {
    let Some(name) = pix_fmt
        .strip_suffix("le")
        .or_else(|| pix_fmt.strip_suffix("be"))
    else {
        return 8;
    };
    let digits = name.len() - name.trim_end_matches(|c: char| c.is_ascii_digit()).len();
    match name[name.len() - digits..].parse::<u32>() {
        Ok(bits @ 9..=16) => bits,
        Ok(48 | 64) => 16,
        _ => 8,
    }
}

fn number(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
}

/// Reads ffprobe's JSON for a file into what the app keeps. A file with no video stream is refused.
pub fn read_probe(json: &Value) -> Result<Probe, String> {
    let streams = json["streams"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let video = streams
        .iter()
        // A cover picture in an audio file is a video stream too; it isn't footage.
        .find(|s| s["codec_type"] == "video" && s["disposition"]["attached_pic"] != 1)
        .ok_or("That file has no video in it.")?;
    let (fps_num, fps_den) = frame_rate(video).ok_or("That video's frame rate can't be read.")?;
    let fps = as_f64((fps_num, fps_den));
    let duration = number(&video["duration"]).or_else(|| number(&json["format"]["duration"]));
    // The stored frame count only when the stream is truly constant: for a variable phone clip or interlaced footage
    // it counts something other than frames at the chosen rate, so the length decides.
    let constant = video["r_frame_rate"]
        .as_str()
        .and_then(|t| fraction(t, '/'))
        == video["avg_frame_rate"]
            .as_str()
            .and_then(|t| fraction(t, '/'));
    let counted = video["nb_frames"]
        .as_str()
        .and_then(|n| n.parse::<u64>().ok())
        .filter(|&n| n > 0 && constant);
    let duration_frames = counted
        .or_else(|| duration.map(|seconds| (seconds * fps).round() as u64))
        .unwrap_or(0);
    // The timecode can sit on the video stream, on the file, or on a timecode (tmcd) data stream.
    let start_timecode = std::iter::once(&video["tags"]["timecode"])
        .chain(std::iter::once(&json["format"]["tags"]["timecode"]))
        .chain(streams.iter().map(|s| &s["tags"]["timecode"]))
        .find_map(|t| t.as_str().map(str::to_owned));
    let clockwise = video["side_data_list"]
        .as_array()
        .and_then(|list| list.iter().find_map(|d| number(&d["rotation"])))
        .map(|counter_clockwise| -counter_clockwise)
        .or_else(|| number(&video["tags"]["rotate"]));
    let rotation = clockwise.map_or(0, |degrees| (degrees.round() as i32).rem_euclid(360));
    let (sar_num, sar_den) = video["sample_aspect_ratio"]
        .as_str()
        .and_then(|t| fraction(t, ':'))
        .unwrap_or((1, 1));
    let transfer = video["color_transfer"].as_str().unwrap_or("");
    let bit_depth = video["bits_per_raw_sample"]
        .as_str()
        .and_then(|b| b.parse().ok())
        .filter(|&b: &u32| b > 0)
        .unwrap_or_else(|| bit_depth(video["pix_fmt"].as_str().unwrap_or("")));
    Ok(Probe {
        codec: video["codec_name"].as_str().unwrap_or("").to_owned(),
        width: video["width"].as_u64().unwrap_or(0) as u32,
        height: video["height"].as_u64().unwrap_or(0) as u32,
        sar_num,
        sar_den,
        fps_num,
        fps_den,
        duration_frames,
        start_timecode,
        rotation,
        has_audio: streams.iter().any(|s| s["codec_type"] == "audio"),
        hdr: transfer == "smpte2084" || transfer == "arib-std-b67",
        bit_depth,
    })
}

/// Long enough for a camera file on a slow drive; a file on a network share that stopped answering is given up on.
const PROBE_TIMEOUT: Duration = Duration::from_secs(30);
/// A still decodes from the keyframe before it: a long-GOP 8K frame can take a few seconds.
const STILL_TIMEOUT: Duration = Duration::from_secs(60);

const TOO_SLOW: &str =
    "That video took too long to read. If it's on a network drive, copy it to this computer first.";
const CANT_READ: &str = "That file can't be read as a video.";

/// Runs a sidecar to the end and returns what it wrote, or gives up after `timeout`. Its output is read while it runs,
/// so a long answer can't fill the pipe and stall it.
fn run(mut command: Command, timeout: Duration) -> Result<Vec<u8>, String> {
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| {
            "Storiiboard's video reader couldn't start. Reinstalling Storiiboard puts it back."
                .to_string()
        })?;
    let mut stdout = child.stdout.take().ok_or(CANT_READ)?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.read_to_end(&mut bytes).map(|_| bytes)
    });
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < timeout => {
                std::thread::sleep(Duration::from_millis(20));
            }
            Ok(None) => {
                // A read stuck on a share that stopped answering can hold the kill back until it returns, so the
                // wait for the process happens on a thread of its own, never here.
                let _ = child.kill();
                std::thread::spawn(move || child.wait());
                return Err(TOO_SLOW.into());
            }
            Err(_) => return Err(CANT_READ.into()),
        }
    };
    reader
        .join()
        .ok()
        .and_then(Result::ok)
        .filter(|_| status.success())
        .ok_or_else(|| CANT_READ.to_string())
}

/// Runs ffprobe on a file. The path is one argument of the list, after `-i`, never part of a shell string, and ffprobe
/// may open local files only (a playlist named like a video can't send it to the network).
pub fn probe(path: &Path) -> Result<Probe, String> {
    let mut command = command("ffprobe");
    command
        .args([
            "-v",
            "error",
            "-protocol_whitelist",
            "file",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            "-i",
        ])
        .arg(path);
    let bytes = run(command, PROBE_TIMEOUT)?;
    let json = serde_json::from_slice::<Value>(&bytes).map_err(|_| CANT_READ.to_string())?;
    read_probe(&json)
}

/// Where the video stream starts and where the file starts, in the file's own seconds. Frame 0 is the video stream's
/// first frame, but a file's start is its earliest stream: sound that starts before the picture (AVCHD, an MP4 without
/// an edit list) would otherwise move every still a few frames early. The playback copy (2.3) and the Player (2.4)
/// count frame 0 the same way.
fn starts(path: &Path) -> Result<(f64, f64), String> {
    let mut command = command("ffprobe");
    command
        .args(["-v", "error", "-protocol_whitelist", "file"])
        .args(["-select_streams", "V:0"])
        .args(["-show_entries", "stream=start_time:format=start_time"])
        .args(["-print_format", "json", "-i"])
        .arg(path);
    let json: Value =
        serde_json::from_slice(&run(command, PROBE_TIMEOUT)?).map_err(|_| CANT_READ.to_string())?;
    let file = number(&json["format"]["start_time"]).unwrap_or(0.0);
    let stream = number(&json["streams"][0]["start_time"]).unwrap_or(file);
    Ok((stream, file))
}

/// The long edge a still is made at, at most: the picture pipeline's own cap (src/core/media/image.ts), so a 6K or 8K
/// frame isn't sent across at full size only to be scaled down.
const STILL_LONG_EDGE: u32 = 2560;
/// How far before a still the quick seek lands: longer than any camera's keyframe interval.
const STILL_PREROLL: f64 = 3.0;

/// Frame `frame` of a video, counted from 0 at its exact rate from the video's first frame, as a PNG: from the
/// original, turned upright, deinterlaced if it's interlaced, its pixels made square, at most 2560 px on the long edge.
/// Two seeks: a quick one to a few seconds before (some containers, a transport stream among them, can land on the
/// keyframe after the time asked for, never before it by much), counted from the file's start; then decoding up to
/// the frame's own timestamp, which `-copyts` keeps as the file has it. The time asked for is a quarter frame early, so
/// rounding can't skip the frame.
pub fn still(path: &Path, frame: u64, fps_num: u32, fps_den: u32) -> Result<Vec<u8>, String> {
    if fps_num == 0 || fps_den == 0 {
        return Err("That video's frame rate can't be read.".into());
    }
    let (stream_start, file_start) = starts(path)?;
    // A quarter frame early, frame 0 included: the output seek compares against the frame's own timestamp.
    let into = (frame as f64 - 0.25) * f64::from(fps_den) / f64::from(fps_num);
    // One scale: square pixels and the cap together, so an 8K 2x anamorphic frame never makes a 16K one on the way.
    // Quoted, so the commas in min() and max() stay inside the expressions.
    let fit = format!("min(1,{STILL_LONG_EDGE}/max(iw*sar,ih))");
    let filter = format!(
        "bwdif=mode=send_frame:deint=interlaced,scale=w='trunc(iw*sar*{fit}/2)*2':h='trunc(ih*{fit}/2)*2',setsar=1"
    );
    let early = (stream_start - file_start + into - STILL_PREROLL).max(0.0);
    let mut command = command("ffmpeg");
    command
        .args(["-hide_banner", "-loglevel", "error", "-copyts"])
        .args(["-protocol_whitelist", "file", "-ss"])
        .arg(format!("{early:.6}"))
        .arg("-i")
        .arg(path)
        .arg("-ss")
        .arg(format!("{:.6}", stream_start + into))
        // V, not v: never a cover picture stored as a video stream.
        .args(["-map", "0:V:0", "-frames:v", "1", "-vf", &filter])
        .args(["-pix_fmt", "rgb24", "-c:v", "png", "-f", "image2pipe", "-"]);
    let bytes = run(command, STILL_TIMEOUT)?;
    // A frame past the end gives no picture at all.
    if bytes.is_empty() {
        return Err(CANT_READ.into());
    }
    Ok(bytes)
}

/// File types a video may be (src/core/media/video.ts, VIDEO_EXTENSIONS). RAW formats need a maker's SDK.
const VIDEO_EXTENSIONS: &[&str] = &[
    "mov", "mp4", "m4v", "mxf", "mts", "m2ts", "ts", "mkv", "avi", "webm", "mpg", "mpeg", "3gp",
];

fn is_video_name(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| VIDEO_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

/// The most videos remembered; the oldest go first.
const KNOWN_LIMIT: usize = 20_000;

/// Videos the person handed over (dropped or chosen) that the app has read, remembered on this computer, so a project
/// reopened next week reads its footage again. Rust keeps the list, in the app's data folder, and only Rust adds to
/// it: neither the page nor a project file someone sent can name a path into it, so neither can make the app read,
/// or reach across the network for, a file the person never gave it.
pub struct KnownVideos {
    file: Option<PathBuf>,
    paths: Mutex<Vec<PathBuf>>,
}

impl KnownVideos {
    pub fn load(data_dir: &Path) -> Self {
        let file = data_dir.join("known-videos.json");
        let (paths, file) = match std::fs::read(&file) {
            Ok(bytes) => match serde_json::from_slice::<Vec<PathBuf>>(&bytes) {
                Ok(paths) => (paths, Some(file)),
                Err(_) => {
                    // Kept aside, never written over: the next video remembered starts a new list.
                    let _ = std::fs::rename(&file, file.with_extension("json.unreadable"));
                    (Vec::new(), Some(file))
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (Vec::new(), Some(file)),
            // There but unreadable now (held by another program, say): this session remembers in memory only, so
            // the list on disk is never replaced by a shorter one.
            Err(_) => (Vec::new(), None),
        };
        Self {
            file,
            paths: Mutex::new(paths),
        }
    }

    #[cfg(test)]
    fn in_memory() -> Self {
        Self {
            file: None,
            paths: Mutex::new(Vec::new()),
        }
    }

    fn has(&self, path: &Path) -> bool {
        self.paths
            .lock()
            .is_ok_and(|paths| paths.iter().any(|known| known == path))
    }

    /// Remembers a video read for the person. Written whole to a new file, then renamed over the old one, so a crash
    /// never leaves half a list.
    fn remember(&self, path: &Path) {
        let Ok(mut paths) = self.paths.lock() else {
            return;
        };
        if paths.iter().any(|known| known == path) {
            return;
        }
        paths.push(path.to_path_buf());
        if paths.len() > KNOWN_LIMIT {
            let extra = paths.len() - KNOWN_LIMIT;
            paths.drain(..extra);
        }
        let (Some(file), Ok(json)) = (&self.file, serde_json::to_vec(&*paths)) else {
            return;
        };
        if let Some(dir) = file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        // On disk before it takes the list's name, so a power cut leaves the old list or the new one, never an empty
        // file.
        let partial = file.with_extension("json.partial");
        let written = std::fs::File::create(&partial).and_then(|mut out| {
            std::io::Write::write_all(&mut out, &json)?;
            out.sync_all()
        });
        if written.is_ok() {
            let _ = std::fs::rename(&partial, file);
        }
    }
}

/// What a request to read a video is checked against.
struct Access<'a> {
    offered: &'a Offered,
    known: &'a KnownVideos,
    files: &'a OpenFiles,
    /// The open project asking (ProjectFile.nativeHandle), if any.
    handle: Option<u32>,
}

impl<'a> Access<'a> {
    fn of(app: &'a AppHandle, handle: Option<u32>) -> Self {
        Self {
            offered: app.state::<Offered>().inner(),
            known: app.state::<KnownVideos>().inner(),
            files: app.state::<OpenFiles>().inner(),
            handle,
        }
    }

    /// Whether the page may read this file as a video: one the person dropped or chose this session; one they handed
    /// over before, which this computer remembers; or one inside the open project's own folder that a video record of
    /// it links, as when a project folder is copied with its footage. Always an absolute path named like a video.
    fn may_read(&self, path: &Path) -> bool {
        if self.offered.has(path) {
            return true;
        }
        if !path.is_absolute() || !is_video_name(path) {
            return false;
        }
        self.known.has(path)
            || self
                .handle
                .is_some_and(|handle| self.files.links_video_inside(handle, path).unwrap_or(false))
    }

    fn readable(&self, path: &Path) -> Result<(), String> {
        if !self.may_read(path) {
            return Err("Storiiboard reads only the files you drop on it or choose.".into());
        }
        if path.is_dir() {
            return Err("That's a folder, not a file.".into());
        }
        if !path.is_file() {
            return Err("That file isn't there any more.".into());
        }
        Ok(())
    }

    /// Whether a linked video's file is where the project says; None for one the page may not ask about.
    fn status(&self, path: &Path) -> Option<FileStatus> {
        if !self.may_read(path) {
            return None;
        }
        let meta = std::fs::metadata(path)
            .ok()
            .filter(std::fs::Metadata::is_file);
        Some(FileStatus {
            exists: meta.is_some(),
            size: meta.map(|meta| meta.len()),
        })
    }
}

/// What ffprobe says about a video the person dropped or chose, or one the open project links. A video the person
/// handed over this session is remembered once it reads, so it reads again next time.
#[tauri::command]
pub async fn video_probe(
    app: AppHandle,
    path: String,
    handle: Option<u32>,
) -> Result<Probe, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = Path::new(&path);
        let access = Access::of(&app, handle);
        access.readable(path)?;
        let probe = probe(path)?;
        if access.offered.has(path) && path.is_absolute() && is_video_name(path) {
            access.known.remember(path);
        }
        Ok(probe)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// One frame of a video as a PNG (see `still`).
#[tauri::command]
pub async fn video_still(
    app: AppHandle,
    path: String,
    handle: Option<u32>,
    frame: u64,
    fps_num: u32,
    fps_den: u32,
) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = Path::new(&path);
        Access::of(&app, handle).readable(path)?;
        still(path, frame, fps_num, fps_den).map(Response::new)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Whether a linked video's file is still where the project says, and its size, for the missing flag and Relink.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FileStatus {
    pub exists: bool,
    pub size: Option<u64>,
}

/// The status of each path, in order: null for one the page may not ask about.
#[tauri::command]
pub async fn video_status(
    app: AppHandle,
    paths: Vec<String>,
    handle: Option<u32>,
) -> Result<Vec<Option<FileStatus>>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let access = Access::of(&app, handle);
        paths
            .iter()
            .map(|path| access.status(Path::new(path)))
            .collect()
    })
    .await
    .map_err(|error| error.to_string())
}

/// The Open dialog for videos; the files picked become readable.
#[tauri::command]
pub async fn video_choose(
    app: AppHandle,
    multiple: bool,
    title: String,
    kind: String,
) -> Result<Vec<String>, String> {
    crate::pictures::choose(app, title, (kind, VIDEO_EXTENSIONS), multiple).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("sbd-video-{tag}-{}", crate::lock::random_id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Makes a short clip with the sidecar ffmpeg itself (no clips committed to the repo): `input` and `output` are
    /// ffmpeg's own options, as a list.
    fn make(dir: &Path, name: &str, input: &[&str], output: &[&str]) -> PathBuf {
        let path = dir.join(name);
        let status = command("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error", "-y"])
            .args(input)
            .args(output)
            .arg(&path)
            .status()
            .expect("the ffmpeg sidecar runs (scripts/ffmpeg/build.sh)");
        assert!(status.success(), "ffmpeg made {name}");
        path
    }

    #[test]
    fn reads_a_23_976_clip_with_its_timecode_as_an_exact_rate() {
        let dir = temp_dir("23976");
        let clip = make(
            &dir,
            "A001_C003.mov",
            &[
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x180:rate=24000/1001:duration=1",
            ],
            &["-c:v", "mpeg4", "-timecode", "01:00:00:00"],
        );
        let probe = probe(&clip).unwrap();
        assert_eq!((probe.fps_num, probe.fps_den), (24000, 1001));
        assert_eq!(probe.duration_frames, 24);
        assert_eq!(probe.start_timecode.as_deref(), Some("01:00:00:00"));
        assert_eq!((probe.width, probe.height), (320, 180));
        assert_eq!((probe.sar_num, probe.sar_den), (1, 1));
        assert_eq!(probe.rotation, 0);
        assert!(!probe.has_audio);
        assert!(!probe.hdr);
        assert_eq!(probe.bit_depth, 8);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn keeps_drop_frame_timecode_and_hears_audio_in_a_file_named_in_spanish_and_japanese() {
        let dir = temp_dir("2997");
        // Spaces, a semicolon, a dash and letters outside ASCII: MinGW-built tools on Windows get those wrong when
        // arguments go through the system's code page.
        let clip = make(
            &dir,
            "Escena 4 – Café 日本; toma 2.mov",
            &[
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x180:rate=30000/1001:duration=1",
                "-f",
                "lavfi",
                "-i",
                "sine=duration=1",
            ],
            &["-c:v", "mpeg4", "-c:a", "aac", "-timecode", "01:00:00;00"],
        );
        let probe = probe(&clip).unwrap();
        assert_eq!((probe.fps_num, probe.fps_den), (30000, 1001));
        assert_eq!(probe.start_timecode.as_deref(), Some("01:00:00;00"));
        assert!(probe.has_audio);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_a_phone_clips_rotation_clockwise_and_an_hlg_clips_depth() {
        let dir = temp_dir("phone");
        let flat = make(
            &dir,
            "flat.mov",
            &[
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x180:rate=30:duration=1",
            ],
            &["-c:v", "mpeg4"],
        );
        // A phone stores its rotation as a display matrix. Re-encoding would turn the pictures instead (ffmpeg
        // auto-rotates), so the matrix is added by copying the stream, as a phone's file has it.
        let flat_path = flat.to_string_lossy().into_owned();
        let turned = |name: &str, counter_clockwise: &str| {
            let clip = make(
                &dir,
                name,
                &["-display_rotation", counter_clockwise, "-i", &flat_path],
                &["-c", "copy"],
            );
            probe(&clip).unwrap().rotation
        };
        // -display_rotation is counter-clockwise: a quarter turn that way is shown by turning three quarters clockwise.
        assert_eq!(turned("ccw.mov", "90"), 270);
        assert_eq!(turned("IMG_0001.mov", "-90"), 90);
        assert_eq!(turned("upside down.mov", "180"), 180);
        let hlg = make(
            &dir,
            "hlg.mov",
            &[
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x180:rate=25:duration=1",
            ],
            &[
                "-c:v",
                "prores_ks",
                "-pix_fmt",
                "yuv422p10le",
                // Tagged on the frames: since FFmpeg 7 the frames' own colour (unset here) overrides -color_trc.
                "-vf",
                "setparams=color_trc=arib-std-b67:color_primaries=bt2020:colorspace=bt2020nc",
            ],
        );
        let probe = probe(&hlg).unwrap();
        assert!(probe.hdr);
        assert_eq!(probe.bit_depth, 10);
        assert_eq!(probe.codec, "prores");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_interlaced_hdv_with_its_anamorphic_pixels_and_a_ts_files_length() {
        // mpeg2video's interlaced pictures read as 25/1 both ways; a field rate twice the average (H.264 1080i) is
        // in chooses_frame_rates_from_what_ffprobe_reports, as this build can't encode H.264 to make one.
        let dir = temp_dir("interlaced");
        let clip = make(
            &dir,
            "00001.ts",
            &[
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=1440x1080:rate=25:duration=1",
            ],
            &[
                "-c:v",
                "mpeg2video",
                "-flags",
                "+ildct+ilme",
                "-top",
                "1",
                "-aspect",
                "16:9",
            ],
        );
        let probe = probe(&clip).unwrap();
        assert_eq!((probe.fps_num, probe.fps_den), (25, 1));
        assert!(
            (24..=26).contains(&probe.duration_frames),
            "{}",
            probe.duration_frames
        );
        // HDV's 1440x1080 shown at 16:9: each pixel is 4/3 as wide as it is tall.
        assert_eq!((probe.sar_num, probe.sar_den), (4, 3));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn counts_a_variable_rate_clip_by_its_length_at_the_standard_rate() {
        let dir = temp_dir("vfr");
        // 30 frames with a tenth of a second missing after the 15th, kept as they are: a phone dropping frames.
        let clip = make(
            &dir,
            "IMG_0002.mov",
            &[
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x180:rate=30:duration=1",
            ],
            &[
                "-vf",
                "setpts=if(gte(N\\,15)\\,N+3\\,N)/(30*TB)",
                "-fps_mode",
                "vfr",
                "-c:v",
                "mpeg4",
            ],
        );
        let probe = probe(&clip).unwrap();
        assert_eq!((probe.fps_num, probe.fps_den), (30, 1));
        // 1.1 seconds at 30: the playback copy's frames, not the 30 stored ones.
        assert!(
            (32..=34).contains(&probe.duration_frames),
            "{}",
            probe.duration_frames
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn applies_a_cube_lut_with_the_lgpl_build() {
        // An inverting 2-point .cube, written here: no camera maker's LUT is ever shipped. ffmpeg runs in the LUT's
        // folder, so the filter names only the file: a Windows path's drive colon would need escaping twice over.
        let dir = temp_dir("lut");
        fs::write(
            dir.join("invert.cube"),
            "LUT_3D_SIZE 2\n1 1 1\n0 1 1\n1 0 1\n0 0 1\n1 1 0\n0 1 0\n1 0 0\n0 0 0\n",
        )
        .unwrap();
        let status = command("ffmpeg")
            .current_dir(&dir)
            .args(["-hide_banner", "-loglevel", "error", "-y"])
            .args([
                "-f",
                "lavfi",
                "-i",
                "color=c=black:size=16x16:duration=0.04",
            ])
            .args(["-vf", "lut3d=file=invert.cube", "-frames:v", "1"])
            .args(["-f", "rawvideo", "-pix_fmt", "rgb24", "graded.rgb"])
            .status()
            .expect("the ffmpeg sidecar runs");
        assert!(status.success());
        // Black through the inverting LUT is white.
        let pixels = fs::read(dir.join("graded.rgb")).unwrap();
        assert_eq!(pixels.len(), 16 * 16 * 3);
        assert!(
            pixels.iter().all(|&value| value >= 240),
            "{:?}",
            &pixels[..6]
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_only_what_was_offered_and_refuses_a_file_with_no_video() {
        let dir = temp_dir("offered");
        let clip = make(
            &dir,
            "clip.mov",
            &[
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=64x36:rate=25:duration=0.2",
            ],
            &["-c:v", "mpeg4"],
        );
        let (offered, known, files) = (
            Offered::default(),
            KnownVideos::in_memory(),
            OpenFiles::default(),
        );
        let access = Access {
            offered: &offered,
            known: &known,
            files: &files,
            handle: None,
        };
        assert!(access.readable(&clip).is_err());
        offered.offer(std::slice::from_ref(&clip));
        assert!(access.readable(&clip).is_ok());
        offered.offer(std::slice::from_ref(&dir));
        assert_eq!(
            access.readable(&dir).unwrap_err(),
            "That's a folder, not a file."
        );
        let sound = make(
            &dir,
            "sound.wav",
            &["-f", "lavfi", "-i", "sine=duration=0.2"],
            &[],
        );
        assert_eq!(probe(&sound).unwrap_err(), "That file has no video in it.");
        let text = dir.join("notes.mov");
        fs::write(&text, "not a video").unwrap();
        assert!(probe(&text).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    /// An open project, `Bey County.sbd` in `dir`, with a video record for each `(source_path, trashed)`.
    fn project_linking(dir: &Path, files: &OpenFiles, links: &[(&str, bool)]) -> u32 {
        let mut file = crate::sbd::SbdFile::create(&dir.join("Bey County.sbd")).unwrap();
        let statement = |sql: &str, params: Vec<Value>| crate::sbd::Statement {
            sql: sql.into(),
            params,
        };
        let mut statements = vec![statement(
            "CREATE TABLE records (id TEXT PRIMARY KEY, type TEXT, props TEXT, trashed_at TEXT)",
            vec![],
        )];
        for (i, (path, trashed)) in links.iter().enumerate() {
            statements.push(statement(
                "INSERT INTO records VALUES (?, 'media', ?, ?)",
                vec![
                    Value::String(format!("v{i}")),
                    Value::String(
                        serde_json::json!({ "kind": "video", "source_path": path }).to_string(),
                    ),
                    if *trashed {
                        Value::String("2026-11-05".into())
                    } else {
                        Value::Null
                    },
                ],
            ));
        }
        // A picture's source path isn't a link to read a video through.
        statements.push(statement(
            "INSERT INTO records VALUES ('p', 'media', ?, NULL)",
            vec![Value::String(
                serde_json::json!({ "kind": "image", "source_path": "Stills/frame.mov" })
                    .to_string(),
            )],
        ));
        file.tx(&statements).unwrap();
        files.add_for_test(file)
    }

    #[test]
    fn reads_a_video_inside_the_project_folder_that_it_links_and_nothing_a_project_file_could_point_at(
    ) {
        let dir = temp_dir("linked");
        for folder in ["Footage", "Stills"] {
            fs::create_dir_all(dir.join(folder)).unwrap();
        }
        let (offered, known, files) = (
            Offered::default(),
            KnownVideos::in_memory(),
            OpenFiles::default(),
        );
        let handle = project_linking(
            &dir,
            &files,
            &[
                ("Footage/C0042.MP4", false),
                ("Footage/C0043.MP4", true),
                ("Footage/notes.txt", false),
                (r"\\192.0.2.1\share\A001.mov", false),
                ("/net/192.0.2.1/share/A001.mov", false),
                ("../Elsewhere/C0050.MP4", false),
            ],
        );
        let access = Access {
            offered: &offered,
            known: &known,
            files: &files,
            handle: Some(handle),
        };
        let linked = dir.join("Footage").join("C0042.MP4");
        fs::write(&linked, "").unwrap();
        assert!(access.may_read(&linked));
        // Not without the project, nor for another project's handle.
        assert!(!Access {
            handle: None,
            ..access
        }
        .may_read(&linked));
        assert!(!Access {
            handle: Some(handle + 1),
            ..access
        }
        .may_read(&linked));
        // Not a trashed record's, a picture's, a file not named like a video, one the project doesn't link.
        assert!(!access.may_read(&dir.join("Footage").join("C0043.MP4")));
        assert!(!access.may_read(&dir.join("Stills").join("frame.mov")));
        assert!(!access.may_read(&dir.join("Footage").join("notes.txt")));
        assert!(!access.may_read(&dir.join("Footage").join("C0044.MP4")));
        // Not a network path a shared project names, decided from the path alone and at once, never by asking the
        // network: 192.0.2.1 is a documentation address that never answers, so a lookup would take seconds.
        for remote in [
            r"\\192.0.2.1\share\A001.mov",
            "/net/192.0.2.1/share/A001.mov",
        ] {
            let started = std::time::Instant::now();
            assert!(!access.may_read(Path::new(remote)), "{remote}");
            assert!(
                started.elapsed() < std::time::Duration::from_millis(50),
                "{remote} took {:?}",
                started.elapsed()
            );
        }
        // Not a climb out of the folder, not a relative path.
        assert!(!access.may_read(&dir.join("..").join("Elsewhere").join("C0050.MP4")));
        assert!(!access.may_read(
            &dir.join("Footage")
                .join("..")
                .join("Footage")
                .join("C0042.MP4")
        ));
        assert!(!access.may_read(Path::new("Footage/C0042.MP4")));
        // The status of a linked file, and of one moved away; none for a file the page may not ask about.
        assert_eq!(
            access.status(&linked),
            Some(FileStatus {
                exists: true,
                size: Some(0)
            })
        );
        fs::remove_file(&linked).unwrap();
        assert_eq!(
            access.status(&linked),
            Some(FileStatus {
                exists: false,
                size: None
            })
        );
        assert_eq!(access.status(&dir.join("secret.txt")), None);
        files.close_all();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn refuses_a_video_reached_through_a_linked_folder_inside_the_project() {
        let dir = temp_dir("linked-folder");
        let elsewhere = temp_dir("private");
        fs::write(elsewhere.join("C0042.MP4"), "").unwrap();
        // A project folder that came with `Footage` pointing at another folder, as a zip or a git clone keeps it.
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(&elsewhere, dir.join("Footage"));
        #[cfg(windows)]
        let made = std::os::windows::fs::symlink_dir(&elsewhere, dir.join("Footage"));
        if made.is_err() {
            // Windows without Developer Mode can't make a link; the Mac checkpoint runs this.
            eprintln!("skipped: this computer can't make a symbolic link");
            return;
        }
        let (offered, known, files) = (
            Offered::default(),
            KnownVideos::in_memory(),
            OpenFiles::default(),
        );
        let handle = project_linking(&dir, &files, &[("Footage/C0042.MP4", false)]);
        let access = Access {
            offered: &offered,
            known: &known,
            files: &files,
            handle: Some(handle),
        };
        assert!(!access.may_read(&dir.join("Footage").join("C0042.MP4")));
        files.close_all();
        let _ = fs::remove_dir_all(&elsewhere);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn remembers_a_video_the_person_handed_over_so_it_reads_after_a_restart() {
        let dir = temp_dir("known");
        let card = dir.join("A001_C003.mov");
        let (offered, files) = (Offered::default(), OpenFiles::default());
        let known = KnownVideos::load(&dir.join("data"));
        let access = Access {
            offered: &offered,
            known: &known,
            files: &files,
            handle: None,
        };
        assert!(!access.may_read(&card));
        known.remember(&card);
        known.remember(&card);
        // Another session: nothing offered, a fresh list read from disk.
        let known = KnownVideos::load(&dir.join("data"));
        let access = Access {
            known: &known,
            ..access
        };
        assert!(access.may_read(&card));
        assert!(!access.may_read(&dir.join("A001_C004.mov")));
        let saved: Vec<PathBuf> =
            serde_json::from_slice(&fs::read(dir.join("data").join("known-videos.json")).unwrap())
                .unwrap();
        assert_eq!(saved, [card]);
        let _ = fs::remove_dir_all(&dir);
    }

    /// The grey level of a one-colour PNG, read back with the sidecar.
    fn grey(dir: &Path, png: &[u8]) -> u8 {
        let path = dir.join("still.png");
        fs::write(&path, png).unwrap();
        let raw = dir.join("still.raw");
        let status = command("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
            .arg(&path)
            .args(["-f", "rawvideo", "-pix_fmt", "gray"])
            .arg(&raw)
            .status()
            .unwrap();
        assert!(status.success());
        let bytes = fs::read(&raw).unwrap();
        (bytes.iter().map(|&b| u32::from(b)).sum::<u32>() / bytes.len() as u32) as u8
    }

    #[test]
    fn grabs_exactly_the_frame_asked_for_at_23_976_from_a_file_that_starts_late() {
        let dir = temp_dir("still");
        // Each frame its own grey: frame n is 8 (n mod 32). An MPEG transport stream starts its clock at 1.4 s, as camera
        // AVCHD files do, so the seek has to count from the file's own start.
        // The same frames from a camera's own container, a QuickTime file, with long gaps between keyframes.
        // And an AVCHD file whose sound starts a tenth of a second before its picture: frame 0 is the picture's first.
        for name in ["00001.MTS", "A001_C003.mov", "00002.MTS"] {
            let audio_first = name == "00002.MTS";
            let mut input = vec![
                "-f",
                "lavfi",
                "-i",
                "color=c=black:size=64x36:rate=24000/1001:duration=6",
            ];
            let mut output = vec![
                "-vf",
                "format=gray,geq=lum='mod(N,32)*8',format=yuv420p",
                "-c:v",
                if name.ends_with("MTS") {
                    "mpeg2video"
                } else {
                    "mpeg4"
                },
                "-q:v",
                "1",
                "-g",
                if name.ends_with("MTS") { "12" } else { "48" },
            ];
            if audio_first {
                input.extend(["-itsoffset", "-0.1", "-f", "lavfi", "-i", "sine=duration=6"]);
                output.extend(["-map", "0:v", "-map", "1:a", "-c:a", "mp2"]);
            }
            let clip = make(&dir, name, &input, &output);
            let untouched = (
                fs::read(&clip).unwrap(),
                fs::metadata(&clip).unwrap().modified().unwrap(),
            );
            probe(&clip).unwrap();
            // Frames past 3 s use the quick seek first.
            for frame in [0_u64, 1, 7, 13, 23, 30, 100, 137] {
                let png = still(&clip, frame, 24000, 1001).unwrap();
                assert_eq!(&png[1..4], b"PNG");
                let level = i32::from(grey(&dir, &png));
                let expected = (frame % 32 * 8) as i32;
                assert!(
                    (level - expected).abs() <= 3,
                    "{name} frame {frame}: grey {level}, expected {expected}"
                );
            }
            assert!(still(&clip, 10_000, 24000, 1001).is_err(), "past the end");
            // The original is only ever read: the same bytes, never even touched.
            assert_eq!(
                (
                    fs::read(&clip).unwrap(),
                    fs::metadata(&clip).unwrap().modified().unwrap()
                ),
                untouched
            );
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn grabs_an_anamorphic_frame_with_square_pixels_and_a_big_one_at_the_cap() {
        let dir = temp_dir("still-size");
        let size = |png: &[u8]| {
            // A PNG's IHDR: width and height, big-endian, right after the signature and the chunk header.
            let at = |i: usize| u32::from_be_bytes(png[i..i + 4].try_into().unwrap());
            (at(16), at(20))
        };
        let hdv = make(
            &dir,
            "hdv.mov",
            &[
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=1440x1080:rate=25:duration=0.2",
            ],
            &["-c:v", "mpeg4", "-aspect", "16:9"],
        );
        assert_eq!(size(&still(&hdv, 2, 25, 1).unwrap()), (1920, 1080));
        let big = make(
            &dir,
            "6k.mov",
            &[
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=6144x3240:rate=25:duration=0.08",
            ],
            &["-c:v", "mpeg4"],
        );
        let (width, height) = size(&still(&big, 0, 25, 1).unwrap());
        assert_eq!(width, 2560);
        assert!((1349..=1350).contains(&height), "{height}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn chooses_frame_rates_from_what_ffprobe_reports() {
        let rate = |r: &str, avg: &str| {
            frame_rate(&serde_json::json!({ "r_frame_rate": r, "avg_frame_rate": avg }))
        };
        // A phone's variable rate: the nearest standard one.
        assert_eq!(rate("90000/1", "2997/100"), Some((30000, 1001)));
        // A rate no camera standard has stays as it is.
        assert_eq!(rate("12/1", "12/1"), Some((12, 1)));
        // 25i and 29.97i: the stream's rate counts fields, the average frames.
        assert_eq!(rate("50/1", "25/1"), Some((25, 1)));
        assert_eq!(rate("60000/1001", "30000/1001"), Some((30000, 1001)));
        assert_eq!(rate("50/1", "2500/101"), Some((25, 1)));
        // A constant rate whose average came out slightly off (an edit list): the stream's own.
        assert_eq!(rate("24000/1001", "23976/1001"), Some((24000, 1001)));
        assert_eq!(rate("48000/1001", "48000/1001"), Some((48000, 1001)));
    }

    #[test]
    fn reads_bit_depth_from_a_pixel_formats_whole_name() {
        assert_eq!(bit_depth("nv12"), 8);
        assert_eq!(bit_depth("yuv420p"), 8);
        assert_eq!(bit_depth("yuv420p10le"), 10);
        assert_eq!(bit_depth("p010le"), 10);
        assert_eq!(bit_depth("yuv444p12be"), 12);
        assert_eq!(bit_depth("p016le"), 16);
        assert_eq!(bit_depth("rgb48le"), 16);
        assert_eq!(bit_depth("bgr565le"), 8);
    }

    #[test]
    fn reads_rotation_from_an_old_rotate_tag_clockwise() {
        let json = serde_json::json!({ "streams": [{
            "codec_type": "video", "r_frame_rate": "30/1", "avg_frame_rate": "30/1", "tags": { "rotate": "90" },
        }]});
        assert_eq!(read_probe(&json).unwrap().rotation, 90);
        let json = serde_json::json!({ "streams": [{
            "codec_type": "video", "r_frame_rate": "30/1", "avg_frame_rate": "30/1",
            "side_data_list": [{ "side_data_type": "Display Matrix", "rotation": -180 }],
        }]});
        assert_eq!(read_probe(&json).unwrap().rotation, 180);
    }
}
