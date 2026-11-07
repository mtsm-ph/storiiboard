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
    // And only when it agrees with the stream's own length: a MOV edit list (a trim made without re-encoding, as a
    // stream copy from a point between keyframes writes) keeps every sample in the count but plays only part, and the
    // stream's length follows the edit list.
    let stream_length = number(&video["duration"]).map(|seconds| seconds * fps);
    let counted = video["nb_frames"]
        .as_str()
        .and_then(|n| n.parse::<u64>().ok())
        .filter(|&n| n > 0 && constant)
        .filter(|&n| stream_length.is_none_or(|length| (n as f64 - length).abs() <= 2.0));
    let duration_frames = counted
        .or_else(|| duration.map(|seconds| (seconds * fps).round() as u64))
        .unwrap_or(0);
    // The timecode can sit on the video stream, on the file, or on a timecode (tmcd) data stream.
    let start_timecode = std::iter::once(&video["tags"]["timecode"])
        .chain(std::iter::once(&json["format"]["tags"]["timecode"]))
        .chain(streams.iter().map(|s| &s["tags"]["timecode"]))
        // An empty tag is no timecode at all.
        .find_map(|t| t.as_str().filter(|t| !t.is_empty()).map(str::to_owned));
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
fn run(command: Command, timeout: Duration) -> Result<Vec<u8>, String> {
    let (status, out, _) = run_heard(command, timeout, false)?;
    if status.success() {
        Ok(out)
    } else {
        Err(CANT_READ.into())
    }
}

/// Runs a sidecar to the end, or gives up after `timeout`: how it ended, what it wrote, and (if `errors`) what it said
/// on its error output. Both are read while it runs, so neither pipe fills and stalls it.
fn run_heard(
    command: Command,
    timeout: Duration,
    errors: bool,
) -> Result<(std::process::ExitStatus, Vec<u8>, Vec<u8>), String> {
    run_stoppable(command, timeout, errors, None)
}

/// `run_heard`, stopped as soon as `stop` is set (a Cancel, the app quitting): `CLIP_CANCELLED`.
fn run_stoppable(
    mut command: Command,
    timeout: Duration,
    errors: bool,
    stop: Option<&std::sync::atomic::AtomicBool>,
) -> Result<(std::process::ExitStatus, Vec<u8>, Vec<u8>), String> {
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(if errors {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .spawn()
        .map_err(|_| {
            "Storiiboard's video reader couldn't start. Reinstalling Storiiboard puts it back."
                .to_string()
        })?;
    // On Windows it ends with the app, crash or not (os.rs). These runs end on their own within their timeout.
    crate::os::keep_with_app(&child);
    let read_all = |pipe: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            match pipe {
                Some(mut pipe) => pipe.read_to_end(&mut bytes).map(|_| bytes),
                None => Ok(bytes),
            }
        })
    };
    let stdout = read_all(
        child
            .stdout
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let stderr = read_all(
        child
            .stderr
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let started = Instant::now();
    let status = loop {
        let stopped = stop.is_some_and(|stop| stop.load(std::sync::atomic::Ordering::SeqCst));
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if stopped => {
                let _ = child.kill();
                std::thread::spawn(move || child.wait());
                return Err(CLIP_CANCELLED.into());
            }
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
    let all = |reader: std::thread::JoinHandle<std::io::Result<Vec<u8>>>| {
        reader
            .join()
            .ok()
            .and_then(Result::ok)
            .ok_or_else(|| CANT_READ.to_string())
    };
    Ok((status, all(stdout)?, all(stderr)?))
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

/// What a video stream's colour is tagged with, in ffprobe's (and zscale's) names; empty where untagged. And, for HDR,
/// the brightest it's said to get, in nits: its content light level, else its mastering display's peak.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct Colour {
    pub transfer: String,
    pub primaries: String,
    pub matrix: String,
    pub range: String,
    pub peak_nits: Option<f64>,
}

/// What the stills and the playback copy need to know beyond the probe: where the video stream starts and where the
/// file starts, in the file's own seconds, and the stream's colour. Frame 0 is the video stream's first frame, but a
/// file's start is its earliest stream: sound that starts before the picture (AVCHD, an MP4 without an edit list) would
/// otherwise move every still a few frames early. The playback copy (2.3) and the Player (2.4) count frame 0 the same
/// way.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Facts {
    pub stream_start: f64,
    pub file_start: f64,
    pub colour: Colour,
}

pub(crate) fn facts(path: &Path) -> Result<Facts, String> {
    let mut command = command("ffprobe");
    command
        .args(["-v", "error", "-protocol_whitelist", "file"])
        .args(["-select_streams", "V:0"])
        .args([
            "-show_entries",
            "stream=start_time,color_transfer,color_primaries,color_space,color_range:\
             stream_side_data=side_data_type,max_luminance,max_content:format=start_time",
        ])
        .args(["-print_format", "json", "-i"])
        .arg(path);
    let json: Value =
        serde_json::from_slice(&run(command, PROBE_TIMEOUT)?).map_err(|_| CANT_READ.to_string())?;
    Ok(read_facts(&json))
}

/// `facts` from ffprobe's JSON.
fn read_facts(json: &Value) -> Facts {
    let file_start = number(&json["format"]["start_time"]).unwrap_or(0.0);
    let stream = &json["streams"][0];
    let tag = |key: &str| stream[key].as_str().unwrap_or("").to_owned();
    let side_data = stream["side_data_list"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    // The content's own brightest pixel first (MaxCLL), as it's what the picture holds; else the mastering display's
    // peak, as ffprobe prints it ("10000000/10000").
    let content = side_data
        .iter()
        .find_map(|d| d["max_content"].as_f64())
        .filter(|&nits| nits > 0.0);
    let mastering = side_data.iter().find_map(|d| {
        let (num, den) = d["max_luminance"].as_str()?.split_once('/')?;
        let (num, den) = (num.parse::<f64>().ok()?, den.parse::<f64>().ok()?);
        (num > 0.0 && den > 0.0).then(|| num / den)
    });
    Facts {
        stream_start: number(&stream["start_time"]).unwrap_or(file_start),
        file_start,
        colour: Colour {
            transfer: tag("color_transfer"),
            primaries: tag("color_primaries"),
            matrix: tag("color_space"),
            range: tag("color_range"),
            peak_nits: content.or(mastering),
        },
    }
}

/// How many channels each of a file's sound tracks has, in their order: `[2]` for a camera's stereo track, `[1, 1, 1, 1]`
/// for a Sony or Canon MXF that keeps each channel on a track of its own.
pub(crate) fn audio_tracks(path: &Path) -> Result<Vec<u32>, String> {
    let mut command = command("ffprobe");
    command
        .args(["-v", "error", "-protocol_whitelist", "file"])
        .args(["-select_streams", "a", "-show_entries", "stream=channels"])
        .args(["-print_format", "json", "-i"])
        .arg(path);
    let json: Value =
        serde_json::from_slice(&run(command, PROBE_TIMEOUT)?).map_err(|_| CANT_READ.to_string())?;
    Ok(read_audio_tracks(&json))
}

/// A track whose loudest moment stays at or below this, in dB below full scale, is silent: a camera input with nothing
/// plugged in, which sits far below it, where a live mic's room tone alone comes above it (2.3c, Kevin).
pub(crate) const SILENT_DB: f64 = -70.0;
/// Where a take is listened to: this many windows of this many seconds, spread evenly through it, so a mic live for
/// any stretch longer than a fortieth of the take (a wireless lav unmuted for a few minutes of half an hour) is heard,
/// while only 40 s of a 100 GB MXF are read before its copy is made. A take this short, or of unknown length, is
/// listened to from its start for as long.
const LISTEN_WINDOWS: usize = 40;
const LISTEN_SECONDS: f64 = 1.0;
/// Up to 40 files' opening, seeking and a second each: more than a probe.
const LISTEN_TIMEOUT: Duration = Duration::from_secs(90);

/// The loudest each of the file's sound `tracks` (their indexes among its sound tracks) gets, in dB below full scale,
/// over 40 seconds spread through its `seconds` (the start of a short one), in one run of ffmpeg. A track with nothing in
/// those seconds reads as `-inf`; one ffmpeg says nothing of (no samples where it was listened to) reads as NaN, not
/// silent: it's kept in the mix.
pub(crate) fn track_peaks(path: &Path, tracks: &[usize], seconds: f64) -> Result<Vec<f64>, String> {
    let windows = LISTEN_WINDOWS as f64;
    let whole = windows * LISTEN_SECONDS;
    let starts: Vec<f64> = if seconds > whole {
        (0..LISTEN_WINDOWS)
            .map(|i| seconds * (2.0 * i as f64 + 1.0) / (2.0 * windows) - LISTEN_SECONDS / 2.0)
            .collect()
    } else {
        vec![0.0]
    };
    let mut command = command("ffmpeg");
    command.args(["-hide_banner", "-nostats"]);
    for start in &starts {
        command.args(["-protocol_whitelist", "file"]);
        if starts.len() > 1 {
            command
                .args(["-ss", &format!("{start:.3}"), "-t"])
                .arg(LISTEN_SECONDS.to_string());
        } else {
            // Short, or of unknown length: from its start, never more than the windows would read.
            command.args(["-t"]).arg(whole.to_string());
        }
        command.arg("-i").arg(path);
    }
    // Per track: its windows end to end, then volumedetect; so each track's volumedetect is its chain's second filter.
    let graph: Vec<String> = tracks
        .iter()
        .enumerate()
        .map(|(j, track)| {
            let inputs: String = (0..starts.len())
                .map(|i| format!("[{i}:a:{track}]"))
                .collect();
            format!(
                "{inputs}concat=n={}:v=0:a=1,volumedetect[p{j}]",
                starts.len()
            )
        })
        .collect();
    command.args(["-filter_complex", &graph.join(";")]);
    for j in 0..tracks.len() {
        command.args(["-map", &format!("[p{j}]")]);
    }
    command.args(["-f", "null", "-"]);
    let (status, _, said) = run_heard(command, LISTEN_TIMEOUT, true)?;
    let said = String::from_utf8_lossy(&said);
    if !status.success() || read_failed_in(&said, path) {
        return Err(CANT_READ.into());
    }
    Ok(read_track_peaks(&said, tracks.len()))
}

/// `track_peaks` from ffmpeg's words: "[Parsed_volumedetect_<n> @ 0x…] max_volume: -12.3 dB", track j's at n = 2j + 1.
fn read_track_peaks(said: &str, tracks: usize) -> Vec<f64> {
    let mut peaks = vec![f64::NAN; tracks];
    for line in said.lines() {
        let Some((_, rest)) = line.split_once("[Parsed_volumedetect_") else {
            continue;
        };
        let Some((index, rest)) = rest.split_once(' ') else {
            continue;
        };
        let Some((_, value)) = rest.split_once("max_volume: ") else {
            continue;
        };
        let (Ok(index), Ok(db)) = (
            index.parse::<usize>(),
            value.trim().trim_end_matches("dB").trim().parse::<f64>(),
        ) else {
            continue;
        };
        if index % 2 == 1 {
            if let Some(peak) = peaks.get_mut(index / 2) {
                *peak = db;
            }
        }
    }
    peaks
}

/// `audio_tracks` from ffprobe's JSON; a track that doesn't say counts as one channel.
fn read_audio_tracks(json: &Value) -> Vec<u32> {
    json["streams"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .map(|stream| {
            stream["channels"]
                .as_u64()
                .and_then(|n| u32::try_from(n).ok())
                .unwrap_or(1)
        })
        .collect()
}

/// Where the video stream starts and where the file starts (see `facts`).
pub(crate) fn starts(path: &Path) -> Result<(f64, f64), String> {
    facts(path).map(|facts| (facts.stream_start, facts.file_start))
}

/// For HDR (PQ or HLG), the filters that bring it to normal-range BT.709, as stills and playback copies show it (D1).
/// FFmpeg's own `scale` only re-tags the colours; zimg's `zscale` takes the picture to linear light (100 nits as 1),
/// `tonemap` brings the highlights down, and `zscale` takes it to BT.709. Mobius keeps the range up to a third of white
/// as it is and rolls off above, so 203-nit reference white lands near SDR white (236 of 255 in a still) where Hable
/// would leave it mid-grey. Highlights reach white at the signal's peak: the file's own (`Colour::peak_nits`), handed to
/// tonemap since zscale doesn't pass the metadata on, else tonemap's 1000 nits. A tag the file doesn't carry, or one
/// zscale doesn't know, is taken as HDR's usual (BT.2020, non-constant luminance, limited range): zscale won't guess.
/// zimg's HLG is display-referred with a 1.2 gamma per channel, close to BT.2100's luminance-based one. The peak is read
/// from the container (`facts`); a stream that carries it only in its frames (some transport streams) gets 1000 nits.
pub(crate) fn tone_map(colour: &Colour) -> Option<ToneMap> {
    let transfer = colour.transfer.as_str();
    if !matches!(transfer, "smpte2084" | "arib-std-b67") {
        return None;
    }
    // The names zscale takes, as ffprobe prints them.
    let known = |value: &str, names: &[&str], otherwise: &str| {
        if names.contains(&value) {
            value.to_owned()
        } else {
            otherwise.to_owned()
        }
    };
    let primaries = known(
        &colour.primaries,
        &[
            "bt709",
            "bt470m",
            "bt470bg",
            "smpte170m",
            "smpte240m",
            "film",
            "bt2020",
            "smpte428",
            "smpte431",
            "smpte432",
            "jedec-p22",
            "ebu3213",
        ],
        "bt2020",
    );
    // Constant luminance zimg does only with SDR's transfer, and ICtCp only with BT.2020 primaries (as BT.2100 has
    // them): an HDR file tagged otherwise is mis-tagged, and decoded as the usual non-constant luminance.
    let mut matrix = known(
        &colour.matrix,
        &[
            "bt709",
            "fcc",
            "bt470bg",
            "smpte170m",
            "smpte240m",
            "ycgco",
            "bt2020nc",
            "chroma-derived-nc",
            "ictcp",
        ],
        "bt2020nc",
    );
    if matrix == "ictcp" && primaries != "bt2020" {
        matrix = "bt2020nc".into();
    }
    let range = known(&colour.range, &["tv", "pc"], "tv");
    // In tonemap's units (100 nits as 1), and never below white itself. PQ only: zimg shows HLG on a 1000-nit display
    // whatever its metadata says, which is tonemap's own peak.
    let peak = colour
        .peak_nits
        .filter(|_| transfer == "smpte2084")
        .map(|nits| format!(":peak={:.2}", (nits / 100.0).clamp(1.0, 100.0)))
        .unwrap_or_default();
    // FFmpeg's own filters (bwdif, scale) refuse frames tagged with a matrix swscale doesn't know: such frames are only
    // re-tagged for them, and zscale is told the real one.
    let before = if SWSCALE_MATRICES.contains(&colour.matrix.as_str()) {
        ""
    } else {
        "setparams=colorspace=bt2020nc,"
    };
    Some(ToneMap {
        before,
        after: format!(
            "zscale=tin={transfer}:pin={primaries}:min={matrix}:rin={range}:t=linear:npl=100:p={primaries}:m={matrix},\
             format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=mobius:desat=0{peak},zscale=t=bt709:m=bt709:r=tv"
        ),
    })
}

/// The matrices swscale (and so FFmpeg's scale and bwdif) take, as ffprobe names them; untagged too.
const SWSCALE_MATRICES: [&str; 9] = [
    "",
    "unknown",
    "gbr",
    "bt709",
    "fcc",
    "bt470bg",
    "smpte170m",
    "smpte240m",
    "bt2020nc",
];

/// HDR's way to normal range: `before` goes ahead of FFmpeg's own filters, `after` follows them.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ToneMap {
    pub before: &'static str,
    pub after: String,
}

impl ToneMap {
    /// `middle` (deinterlacing, scaling) with the tone map around it.
    pub(crate) fn around(&self, middle: &str) -> String {
        format!("{}{middle},{}", self.before, self.after)
    }
}

/// Whether a video's sound can go into a playback copy: its first second decoded and made into the copy's AAC, a line
/// of checksums for each piece made, then thrown away. False when ffmpeg can't (no decoder for it, a layout the encoder
/// refuses) or makes nothing (a track with no sound in it); an error when it couldn't tell (the file itself can't be
/// read now, or stopped answering). The playback copy drops the sound only on a false (playback.rs).
pub(crate) fn sound_plays(path: &Path) -> Result<bool, String> {
    sound_reads(path, &["-map", "0:a:0"])
}

/// `sound_plays` for the sound as `map` takes it: one track (`-map 0:a:N`), or several mixed by a filter
/// (`-filter_complex … -map [mix]`, playback.rs).
pub(crate) fn sound_reads(path: &Path, map: &[&str]) -> Result<bool, String> {
    let mut command = command("ffmpeg");
    command
        .args(["-hide_banner", "-loglevel", "error"])
        .args(["-protocol_whitelist", "file", "-i"])
        .arg(path)
        .args(map)
        .args(["-t", "1"])
        .args([
            "-c:a", "aac", "-b:a", "160k", "-ac", "2", "-f", "framemd5", "-",
        ]);
    let (status, out, said) = run_heard(command, PROBE_TIMEOUT, true)?;
    // A read that failed partway (ffmpeg goes on as if the file had ended, and exits as if all went well): it can't
    // tell, whatever came out.
    if read_failed_in(&String::from_utf8_lossy(&said), path) {
        return Err(CANT_READ.into());
    }
    if !status.success() {
        // The file opens and its picture reads: it's the sound.
        return starts(path).map(|_| false);
    }
    Ok(String::from_utf8_lossy(&out)
        .lines()
        .any(|line| !line.starts_with('#') && !line.trim().is_empty()))
}

/// Whether ffmpeg 8's error output says a read of `original` failed partway: "Error during demuxing: <reason>" for
/// any reason but undecodable data, or a MOV's "stream N, offset 0x…: partial file" at a place inside the file as it
/// is now (past its end, the file was only cut short). The playback copy listens for the same (playback.rs, Said).
pub(crate) fn read_failed_in(said: &str, original: &Path) -> bool {
    // Read only if a "partial file" line comes; an original that's gone since is a read that failed.
    let size = std::cell::OnceCell::new();
    let size = || *size.get_or_init(|| std::fs::metadata(original).ok().map(|meta| meta.len()));
    said.lines().map(str::trim_end).any(|line| {
        if let Some((_, reason)) = line.split_once("Error during demuxing: ") {
            return !reason.starts_with("Invalid data found");
        }
        line.starts_with("[in#")
            && line.ends_with(": partial file")
            && line
                .rsplit_once("offset 0x")
                .and_then(|(_, rest)| rest.split(':').next())
                .and_then(|hex| u64::from_str_radix(hex, 16).ok())
                .is_none_or(|at| size().is_none_or(|size| at < size))
    })
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
#[cfg(test)]
pub fn still(path: &Path, frame: u64, fps_num: u32, fps_den: u32) -> Result<Vec<u8>, String> {
    still_graded(path, frame, fps_num, fps_den, None)
}

/// `still`, graded with the video's LUT when it has one (2.7, as its playback copy is, 2.5): the LUT after the scale,
/// in place of the tone-mapping for HDR footage. The original is only read.
pub fn still_graded(
    path: &Path,
    frame: u64,
    fps_num: u32,
    fps_den: u32,
    lut: Option<&crate::playback::Lut>,
) -> Result<Vec<u8>, String> {
    if fps_num == 0 || fps_den == 0 {
        return Err("That video's frame rate can't be read.".into());
    }
    if lut.is_some_and(|lut| !crate::playback::is_lut_name(&lut.sha256)) {
        return Err(CANT_READ.into());
    }
    let facts = facts(path)?;
    let (early, at) = still_times(&facts, frame, fps_num, fps_den);
    // Its own folder for the one grab, gone after; ffmpeg runs there and names the file alone (playback.rs LutFile).
    let grade = match lut {
        Some(lut) => Some(crate::playback::LutFile::write(lut)?),
        None => None,
    };
    // The frame's own time, on the file's clock: the second seek and the trim before the tone map take the same one.
    let filter = match &grade {
        Some(_) => graded_still_filter(&facts.colour, at),
        None => still_filter(&facts.colour, at),
    };
    let mut command = command("ffmpeg");
    if let Some(grade) = &grade {
        command.current_dir(&grade.folder);
    }
    command
        .args(["-hide_banner", "-loglevel", "error", "-copyts"])
        .args(["-protocol_whitelist", "file", "-ss"])
        .arg(format!("{early:.6}"))
        .arg("-i")
        .arg(path)
        .arg("-ss")
        .arg(format!("{at:.6}"))
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

/// Where a still's two seeks land: the quick one a few seconds before, counted from the file's start, and the frame's
/// own time on the file's clock (which -copyts keeps), a quarter frame early, frame 0 included, as the output seek
/// compares against the frame's own timestamp.
fn still_times(facts: &Facts, frame: u64, fps_num: u32, fps_den: u32) -> (f64, f64) {
    let into = (frame as f64 - 0.25) * f64::from(fps_den) / f64::from(fps_num);
    let early = (facts.stream_start - facts.file_start + into - STILL_PREROLL).max(0.0);
    (early, facts.stream_start + into)
}

/// A still's filters, for a frame at `at` in the file's own seconds (as -copyts keeps them): deinterlaced, its pixels
/// made square at most 2560 px on the long edge (one scale: an 8K 2x anamorphic frame never makes a 16K one on the
/// way; quoted, so the commas in min() and max() stay inside the expressions), and HDR brought to normal range, as the
/// playback copy shows it. Only the frame asked for is tone-mapped: those decoded on the way to it are dropped first,
/// by their own timestamps.
fn still_filter(colour: &Colour, at: f64) -> String {
    let fit = format!("min(1,{STILL_LONG_EDGE}/max(iw*sar,ih))");
    let scale = format!("scale=w='trunc(iw*sar*{fit}/2)*2':h='trunc(ih*{fit}/2)*2',setsar=1");
    match tone_map(colour) {
        Some(tone_map) => tone_map.around(&format!(
            "bwdif=mode=send_frame:deint=interlaced,trim=start={at:.6},{scale}"
        )),
        None => format!("bwdif=mode=send_frame:deint=interlaced,{scale}"),
    }
}

/// A graded still's filters: as `still_filter`'s, with the LUT after the scale for the frame asked for alone (those
/// decoded on the way are dropped first), and no tone-mapping: a camera's LUT is made for the signal it recorded. HDR
/// footage tagged with a matrix FFmpeg's own filters refuse is re-tagged for them first, as for the copy. The result
/// is said to be BT.709, as the LUT made it: the PNG's colour chunks would otherwise still say PQ or HLG, and the
/// picture would be converted a second time when it's stored.
fn graded_still_filter(colour: &Colour, at: f64) -> String {
    let fit = format!("min(1,{STILL_LONG_EDGE}/max(iw*sar,ih))");
    let scale = format!("scale=w='trunc(iw*sar*{fit}/2)*2':h='trunc(ih*{fit}/2)*2',setsar=1");
    let retag = tone_map(colour).map_or("", |hdr| hdr.before);
    format!(
        "{retag}bwdif=mode=send_frame:deint=interlaced,trim=start={at:.6},{scale},lut3d=file={}:interp=tetrahedral,\
         setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709",
        crate::playback::LUT_FILE
    )
}

/// The part of the picture a saved clip keeps (2.8b): the frame's window, as fractions of the take's picture once
/// it's upright with square pixels (src/core/media/crop.ts cropWindow, as fractions).
#[derive(Clone, Copy, Debug, serde::Deserialize)]
pub struct ClipWindow {
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
}

/// The long edge a saved clip is made at, at most: a reference to send or cut with, not a master.
const CLIP_LONG_EDGE: u32 = 1920;

pub(crate) const CLIP_CANCELLED: &str = "Saving the clip was cancelled.";
const CLIP_NOT_SAVED: &str = "The clip couldn't be saved there.";
const CLIP_OVER_VIDEO: &str =
    "A clip is never saved over a video that's there. Choose another name.";

/// A clip being saved, and whether it's been asked to stop: one at a time, as the export dialog allows.
static CLIP_STOP: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static CLIP_BUSY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Stops the clip being saved, if one is (a Cancel, or the app quitting): its ffmpeg ends and nothing is left of it.
pub fn cancel_clip() -> bool {
    let busy = CLIP_BUSY.load(std::sync::atomic::Ordering::SeqCst);
    if busy {
        CLIP_STOP.store(true, std::sync::atomic::Ordering::SeqCst);
    }
    busy
}

/// A hidden file of its own beside `dest`, made new (never one already there, never through a link), for ffmpeg to
/// write the clip into before it's put in place: as export.rs makes its temporary files.
fn clip_partial(dest: &Path) -> Result<PathBuf, String> {
    let folder = dest.parent().ok_or(CLIP_NOT_SAVED)?;
    let name = dest
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or(CLIP_NOT_SAVED)?;
    for n in 0..100 {
        let partial = folder.join(format!(".{name}.{}-{n}.part", std::process::id()));
        if std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&partial)
            .is_ok()
        {
            return Ok(partial);
        }
    }
    Err(CLIP_NOT_SAVED.into())
}

/// Whether a clip may be saved at `dest`: never over the file it's made from, nor over any file there that reads as
/// a video (a camera original the Save panel opened beside), whatever the dialog asked.
fn clip_may_go(dest: &Path, source: &Path) -> bool {
    let same = matches!((std::fs::canonicalize(dest), std::fs::canonicalize(source)), (Ok(a), Ok(b)) if a == b);
    !same && !(dest.exists() && probe(dest).is_ok())
}

/// A saved clip's filters: deinterlaced; the frames before its in point dropped by their own timestamps (so nothing is
/// graded for nothing); its pixels made square at full size; cut to the frame's window; fitted to 1920 px on its long
/// edge; graded with the LUT (as the copy and the still are) or, for HDR without one, tone-mapped; its times from 0.
fn clip_filter(
    colour: &Colour,
    at: f64,
    zero: f64,
    (num, den): (u32, u32),
    window: ClipWindow,
    graded: bool,
) -> String {
    let w = window.width.clamp(0.01, 1.0);
    let h = window.height.clamp(0.01, 1.0);
    let l = window.left.clamp(0.0, 1.0 - w);
    let t = window.top.clamp(0.0, 1.0 - h);
    // Cut from the picture as stored, then one scale for the pixels' shape and the fit together: an 8K 2x anamorphic
    // frame is never blown up to 16K on the way (the window's fractions are the same either side of a sideways
    // stretch). At the video's own rate: a phone's variable-rate clip comes out as the copy plays it, frame for frame.
    let fit = format!("min(1,{CLIP_LONG_EDGE}/max(iw*sar,ih))");
    let middle = format!(
        "bwdif=mode=send_frame:deint=interlaced,trim=start={at:.6},fps={num}/{den},\
         crop=w='trunc(iw*{w:.6}/2)*2':h='trunc(ih*{h:.6}/2)*2':x='iw*{l:.6}':y='ih*{t:.6}',\
         scale=w='trunc(iw*sar*{fit}/2)*2':h='trunc(ih*{fit}/2)*2',setsar=1"
    );
    let hdr = tone_map(colour);
    let picture = match (graded, hdr) {
        (true, hdr) => format!(
            "{}{middle},lut3d=file={}:interp=tetrahedral,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709",
            hdr.map_or("", |hdr| hdr.before),
            crate::playback::LUT_FILE
        ),
        (false, Some(hdr)) => hdr.around(&middle),
        (false, None) => middle,
    };
    // The in frame's own time is 0, for the sound too: the two keep together.
    format!("{picture},setpts=PTS-{zero:.6}/TB")
}

/// How long a clip's encode may take before it's given up on: generous, as an 8K original decodes slowly.
fn clip_timeout(frames: u64, fps_num: u32, fps_den: u32) -> Duration {
    let seconds = frames as f64 * f64::from(fps_den) / f64::from(fps_num.max(1));
    Duration::from_secs_f64(60.0 + seconds * 8.0)
}

/// Saves frames `in_frame` to `out_frame` of a video (both included, counted as a still's are) as an H.264 MP4 at
/// `dest`: from the original, never the copy; framed by `window`; graded with `lut` when given; with its first sound
/// track, from the same moment. Each of the computer's encoders is tried in turn. It's written beside `dest` first and
/// put in place only once whole, so a clip given up on leaves nothing half made.
pub fn save_clip(
    path: &Path,
    (in_frame, out_frame): (u64, u64),
    (fps_num, fps_den): (u32, u32),
    window: ClipWindow,
    lut: Option<&crate::playback::Lut>,
    dest: &Path,
) -> Result<(), String> {
    if fps_num == 0 || fps_den == 0 {
        return Err("That video's frame rate can't be read.".into());
    }
    if out_frame < in_frame {
        return Err(CANT_READ.into());
    }
    if lut.is_some_and(|lut| !crate::playback::is_lut_name(&lut.sha256)) {
        return Err(CANT_READ.into());
    }
    let facts = facts(path)?;
    // The sound only if it plays: a track ffmpeg can't decode would fail the whole clip (the copy drops it too).
    let has_audio = probe(path)?.has_audio && matches!(sound_plays(path), Ok(true));
    let (early, at) = still_times(&facts, in_frame, fps_num, fps_den);
    // The in frame's own time on the file's clock, where the picture and the sound both start.
    let zero = facts.stream_start + in_frame as f64 * f64::from(fps_den) / f64::from(fps_num);
    let frames = out_frame - in_frame + 1;
    let seconds = frames as f64 * f64::from(fps_den) / f64::from(fps_num);
    let grade = match lut {
        Some(lut) => Some(crate::playback::LutFile::write(lut)?),
        None => None,
    };
    let filter = clip_filter(
        &facts.colour,
        at,
        zero,
        (fps_num, fps_den),
        window,
        grade.is_some(),
    );
    let partial = clip_partial(dest)?;
    let mut said = String::from(CANT_READ);
    for encoder in crate::playback::encoders() {
        let mut command = command("ffmpeg");
        if let Some(grade) = &grade {
            command.current_dir(&grade.folder);
        }
        command
            .args(["-hide_banner", "-loglevel", "error", "-y", "-copyts"])
            .args(["-protocol_whitelist", "file", "-ss"])
            .arg(format!("{early:.6}"))
            .arg("-i")
            .arg(path)
            .args(["-map", "0:V:0", "-vf", &filter])
            .arg("-frames:v")
            .arg(frames.to_string())
            .args(&encoder)
            .args(["-fps_mode", "cfr", "-r"])
            .arg(format!("{fps_num}/{fps_den}"));
        if has_audio {
            command
                .args(["-map", "0:a:0?", "-af"])
                .arg(format!(
                    // From the in frame's own time, which is 0 for the picture too; a sound that starts after it is
                    // padded with silence from 0, so it plays where it was recorded.
                    "atrim=start={zero:.6},asetpts=PTS-{zero:.6}/TB,aresample=async=1:first_pts=0"
                ))
                .args(["-c:a", "aac", "-b:a", "192k", "-ac", "2"]);
        }
        command
            .arg("-t")
            .arg(format!("{seconds:.6}"))
            .args(["-movflags", "+faststart", "-f", "mp4"])
            .arg(&partial);
        let outcome = run_stoppable(
            command,
            clip_timeout(frames, fps_num, fps_den),
            true,
            Some(&CLIP_STOP),
        );
        match outcome {
            Ok((status, _, _)) if status.success() => {
                return std::fs::rename(&partial, dest).map_err(|_| {
                    let _ = std::fs::remove_file(&partial);
                    CLIP_NOT_SAVED.to_string()
                });
            }
            // Cancelled, or too slow: no other encoder would do better, and trying one would double the wait.
            Err(error) => {
                let _ = std::fs::remove_file(&partial);
                return Err(error);
            }
            // Failed: the source unreadable says so; else the next encoder (a hardware one that wouldn't open).
            Ok((_, _, errors)) => {
                if read_failed_in(&String::from_utf8_lossy(&errors), path) {
                    let _ = std::fs::remove_file(&partial);
                    return Err(CANT_READ.into());
                }
                said = CLIP_NOT_SAVED.into();
            }
        }
    }
    let _ = std::fs::remove_file(&partial);
    Err(said)
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
/// Forget couldn't save the empty list: the videos are still remembered, as they were.
const CANT_FORGET: &str =
    "The remembered videos couldn't be forgotten: the list of them couldn't be saved. They're still remembered.";

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

    fn count(&self) -> usize {
        self.paths.lock().map_or(0, |paths| paths.len())
    }

    /// Forgets every video remembered (Settings → Storage): each reads again once dropped, chosen or relinked.
    /// The file first: if it can't be written, nothing is forgotten, here or on disk. A list that couldn't be read at
    /// start can't be written either (this session kept its videos in memory only, so as not to replace it): Forget
    /// would only last until the next start, so it's refused the same way.
    fn forget_all(&self) -> Result<(), String> {
        let mut paths = self.paths.lock().map_err(|_| CANT_FORGET.to_string())?;
        let file = self.file.as_ref().ok_or_else(|| CANT_FORGET.to_string())?;
        crate::playback::write_atomically(file, b"[]").map_err(|_| CANT_FORGET.to_string())?;
        paths.clear();
        Ok(())
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
pub(crate) struct Access<'a> {
    offered: &'a Offered,
    known: &'a KnownVideos,
    files: &'a OpenFiles,
    /// The open project asking (ProjectFile.nativeHandle), if any.
    handle: Option<u32>,
}

impl<'a> Access<'a> {
    pub(crate) fn of(app: &'a AppHandle, handle: Option<u32>) -> Self {
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

    pub(crate) fn readable(&self, path: &Path) -> Result<(), String> {
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
    lut: Option<crate::playback::Lut>,
) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = Path::new(&path);
        Access::of(&app, handle).readable(path)?;
        still_graded(path, frame, fps_num, fps_den, lut.as_ref()).map(Response::new)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Saves a frame's clip as a file (2.8b), to the file the Save dialog picked (export_choose_file), once.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn clip_save(
    app: AppHandle,
    path: String,
    handle: Option<u32>,
    in_frame: u64,
    out_frame: u64,
    fps_num: u32,
    fps_den: u32,
    window: ClipWindow,
    lut: Option<crate::playback::Lut>,
    dest: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = Path::new(&path);
        Access::of(&app, handle).readable(path)?;
        let dest = PathBuf::from(&dest);
        if !crate::export::take_chosen_file(&app, &dest) {
            return Err("Storiiboard writes exports only where you choose.".into());
        }
        if !clip_may_go(&dest, path) {
            return Err(CLIP_OVER_VIDEO.into());
        }
        if CLIP_BUSY.swap(true, std::sync::atomic::Ordering::SeqCst) {
            return Err(CLIP_NOT_SAVED.into());
        }
        CLIP_STOP.store(false, std::sync::atomic::Ordering::SeqCst);
        let saved = save_clip(
            path,
            (in_frame, out_frame),
            (fps_num, fps_den),
            window,
            lut.as_ref(),
            &dest,
        );
        CLIP_BUSY.store(false, std::sync::atomic::Ordering::SeqCst);
        saved
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Stops the clip being saved (2.8b); false when none is.
#[tauri::command]
pub fn clip_cancel() -> bool {
    cancel_clip()
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

/// How many videos this computer remembers the person handed over.
#[tauri::command]
pub fn known_videos_count(app: AppHandle) -> usize {
    app.state::<KnownVideos>().count()
}

/// Forgets them all; a project's videos outside its folder then need Relink (or a drop) to read again.
#[tauri::command]
pub fn known_videos_forget(app: AppHandle) -> Result<(), String> {
    app.state::<KnownVideos>().forget_all()
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

    #[test]
    fn reads_each_tracks_peak_from_ffmpegs_words() {
        let said = "[Parsed_volumedetect_1 @ 0x6000] n_samples: 960000\n\
            [Parsed_volumedetect_1 @ 0x6000] max_volume: -6.0 dB\n\
            [Parsed_volumedetect_3 @ 0x6010] max_volume: -inf dB\n\
            [Parsed_concat_2 @ 0x6020] max_volume: -1.0 dB\n";
        let peaks = read_track_peaks(said, 3);
        assert_eq!(peaks[0], -6.0);
        assert_eq!(peaks[1], f64::NEG_INFINITY);
        // Not said at all (no samples where it was listened to): not known to be silent, so kept.
        assert!(peaks[2].is_nan());
    }

    #[test]
    fn hears_a_mic_live_only_later_in_a_long_take_and_not_an_empty_input() {
        let dir = temp_dir("peaks");
        // A minute, three mono tracks: an empty input; a lav live only from 40 s to 45 s; another at a whisper of
        // room tone (-60 dB) throughout.
        let take = dir.join("C0089.mka");
        let status = command("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error", "-y"])
            .args(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono:d=60"])
            .args([
                "-f",
                "lavfi",
                "-i",
                "aevalsrc=if(between(t\\,40\\,45)\\,0.5*sin(2*PI*1000*t)\\,0):s=48000:d=60",
            ])
            .args([
                "-f",
                "lavfi",
                "-i",
                "aevalsrc=0.001*sin(2*PI*300*t):s=48000:d=60",
            ])
            .args([
                "-map",
                "0:a",
                "-map",
                "1:a",
                "-map",
                "2:a",
                "-c:a",
                "pcm_s24le",
            ])
            .arg(&take)
            .status()
            .unwrap();
        assert!(status.success());
        let peaks = track_peaks(&take, &[0, 1, 2], 60.0).unwrap();
        // Its length not known: only its first 40 s are read, so the lav (40 to 45 s) isn't heard.
        let start = track_peaks(&take, &[1], 0.0).unwrap();
        assert!(
            start[0] <= SILENT_DB,
            "no more than 40 s read: {}",
            start[0]
        );
        assert!(peaks[0] <= SILENT_DB, "the empty input: {}", peaks[0]);
        assert!(
            peaks[1] > -10.0,
            "the lav, heard in a later window: {}",
            peaks[1]
        );
        assert!(
            peaks[2] > SILENT_DB && peaks[2] < -50.0,
            "room tone: {}",
            peaks[2]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn counts_the_channels_of_each_sound_track() {
        let json = serde_json::json!({
            "streams": [{ "channels": 1 }, { "channels": 1 }, { "channels": 1 }, {}]
        });
        assert_eq!(read_audio_tracks(&json), [1, 1, 1, 1]);
        assert_eq!(
            read_audio_tracks(&serde_json::json!({ "streams": [{ "channels": 2 }] })),
            [2]
        );
        assert_eq!(read_audio_tracks(&serde_json::json!({})), Vec::<u32>::new());
    }

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
        assert_eq!(saved, std::slice::from_ref(&card));
        assert_eq!(known.count(), 1);
        known.forget_all().unwrap();
        assert!(!Access {
            known: &known,
            ..access
        }
        .may_read(&card));
        assert!(
            !KnownVideos::load(&dir.join("data")).has(&card),
            "forgotten on disk too"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_forget_that_cant_be_saved_forgets_nothing() {
        let dir = temp_dir("known-unsaved");
        let card = dir.join("A001_C003.mov");
        let known = KnownVideos::load(&dir.join("data"));
        known.remember(&card);
        // The list's file can't be replaced (a folder stands where it goes): Forget says so in its own words, and the
        // video is still remembered, as the file on disk still says.
        let file = dir.join("data").join("known-videos.json");
        fs::remove_file(&file).unwrap();
        fs::create_dir(&file).unwrap();
        assert_eq!(known.forget_all().unwrap_err(), CANT_FORGET);
        assert!(known.has(&card));
        assert_eq!(known.count(), 1);
        // A list that couldn't be read at start, so is kept in memory only: Forget would last until the next start, so
        // it's refused too, and nothing is forgotten.
        let unread = KnownVideos::in_memory();
        unread.remember(&card);
        assert_eq!(unread.forget_all().unwrap_err(), CANT_FORGET);
        assert!(unread.has(&card));
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

    #[test]
    fn counts_a_mov_trimmed_by_an_edit_list_by_what_it_plays() {
        let stream = |nb_frames: &str, duration: &str| {
            serde_json::json!({ "streams": [{
                "codec_type": "video", "r_frame_rate": "25/1", "avg_frame_rate": "25/1",
                "nb_frames": nb_frames, "duration": duration,
            }]})
        };
        // A 10 s take stream-copied from 3 s in: every sample is still there, 7 s of them play (ffprobe's own figures).
        assert_eq!(
            read_probe(&stream("250", "7.000000"))
                .unwrap()
                .duration_frames,
            175
        );
        // An untrimmed file: the exact count, though its length rounds a frame off.
        assert_eq!(
            read_probe(&stream("250", "9.960000"))
                .unwrap()
                .duration_frames,
            250
        );
        let no_length = serde_json::json!({ "streams": [{
            "codec_type": "video", "r_frame_rate": "25/1", "avg_frame_rate": "25/1", "nb_frames": "250",
        }]});
        assert_eq!(read_probe(&no_length).unwrap().duration_frames, 250);
    }

    #[test]
    fn reads_a_trimmed_mov_as_long_as_it_plays_and_hears_sound_it_can_and_cant_decode() {
        let dir = temp_dir("trim");
        let take = make(
            &dir,
            "C0060.mov",
            &[
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x180:rate=25:duration=10",
                "-f",
                "lavfi",
                "-i",
                "sine=duration=10",
            ],
            &["-c:v", "mpeg4", "-g", "100", "-c:a", "pcm_s16le"],
        );
        // A stream copy from between two keyframes: an edit list hides the frames before 3 s.
        let trimmed = make(
            &dir,
            "C0060 trimmed.mov",
            &["-ss", "3", "-i", take.to_str().unwrap()],
            &["-c", "copy"],
        );
        assert_eq!(probe(&trimmed).unwrap().duration_frames, 175);
        assert_eq!(sound_plays(&take), Ok(true));
        // The same take with its sound's codec tag made unknown: ffmpeg has no decoder for it.
        let bytes = fs::read(&take).unwrap();
        let at = bytes
            .windows(4)
            .position(|w| w == b"sowt")
            .expect("PCM sound's tag");
        let mut unknown = bytes.clone();
        unknown[at..at + 4].copy_from_slice(b"abcd");
        let silent = dir.join("C0060 unknown sound.mov");
        fs::write(&silent, unknown).unwrap();
        assert!(probe(&silent).unwrap().has_audio);
        assert_eq!(sound_plays(&silent), Ok(false));
        // A file that can't be read at all says nothing about its sound.
        assert!(sound_plays(&dir.join("gone.mov")).is_err());
        // Nor does one whose read failed partway, in either of ffmpeg's words for it.
        let size = fs::metadata(&take).unwrap().len();
        for said in [
            "[in#0/mov,mp4,m4a,3gp,3g2,mj2 @ 0x1] Error during demuxing: Input/output error\n"
                .to_owned(),
            format!(
                "[in#0/mov,mp4,m4a,3gp,3g2,mj2 @ 0x1] stream 1, offset 0x{:x}: partial file\r\n",
                size / 2
            ),
        ] {
            assert!(read_failed_in(&said, &take), "{said}");
        }
        // The original gone since: a failed read, as the playback copy counts it.
        let at_end = format!(
            "[in#0/mov,mp4,m4a,3gp,3g2,mj2 @ 0x1] stream 1, offset 0x{size:x}: partial file\n"
        );
        assert!(read_failed_in(&at_end, &dir.join("gone.mov")));
        // A file cut short, or damaged data, is no failed read.
        for said in [
            format!(
                "[in#0/mov,mp4,m4a,3gp,3g2,mj2 @ 0x1] stream 1, offset 0x{size:x}: partial file\n"
            ),
            "[in#0/mxf @ 0x1] Error during demuxing: Invalid data found when processing input\n"
                .to_owned(),
            "[aist#0:1/pcm_s16le @ 0x1] Decoding error: Invalid data found when processing input\n"
                .to_owned(),
        ] {
            assert!(!read_failed_in(&said, &take), "{said}");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    /// A one-second 10-bit ProRes clip of one flat grey, its code value `luma` (10-bit, limited range), its frames
    /// tagged with `tags` (setparams' own, as an encoder takes its colour from the frames).
    fn flat_10_bit(dir: &Path, name: &str, luma: u32, tags: &str) -> PathBuf {
        make(
            dir,
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
                    "format=yuv422p10le,geq=lum={luma}:cb=512:cr=512,setparams=range=tv:{tags}"
                ),
                "-c:v",
                "prores_ks",
                "-profile:v",
                "3",
            ],
        )
    }

    /// 203 nits, HDR's reference white: PQ's code value, and HLG's 75%.
    const PQ_WHITE: u32 = 572;
    const HLG_WHITE: u32 = 721;
    const PQ: &str = "color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc";
    const HLG: &str = "color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc";

    /// The mean grey of a picture file (a still's PNG), read back with the sidecar.
    fn mean_grey(dir: &Path, png: &[u8]) -> f64 {
        let file = dir.join(format!("{}.png", crate::lock::random_id()));
        fs::write(&file, png).unwrap();
        let out = command("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error", "-i"])
            .arg(&file)
            .args(["-pix_fmt", "gray", "-f", "rawvideo", "-"])
            .output()
            .unwrap();
        assert!(!out.stdout.is_empty());
        out.stdout.iter().map(|&b| f64::from(b)).sum::<f64>() / out.stdout.len() as f64
    }

    #[test]
    fn tone_maps_hdr_reference_white_near_sdr_white_and_leaves_sdr_alone() {
        let dir = temp_dir("hdr");
        let pq = flat_10_bit(&dir, "pq.mov", PQ_WHITE, PQ);
        let hlg = flat_10_bit(&dir, "hlg.mov", HLG_WHITE, HLG);
        // Only the transfer tagged, as some exports leave it: the rest taken as HDR's usual.
        let pq_untagged = flat_10_bit(&dir, "pq untagged.mov", PQ_WHITE, "color_trc=smpte2084");
        // The same code value in SDR: not touched.
        let sdr = flat_10_bit(
            &dir,
            "sdr.mov",
            PQ_WHITE,
            "color_primaries=bt709:color_trc=bt709:colorspace=bt709",
        );
        for clip in [&pq, &hlg, &pq_untagged] {
            assert!(probe(clip).unwrap().hdr, "{}", clip.display());
            let grey = mean_grey(&dir, &still(clip, 0, 25, 1).unwrap());
            // Near SDR white (236 measured), never the mid-grey an untouched PQ frame shows (146).
            assert!(
                (225.0..=250.0).contains(&grey),
                "{}: {grey}",
                clip.display()
            );
        }
        let grey = mean_grey(&dir, &still(&sdr, 0, 25, 1).unwrap());
        assert!((135.0..=160.0).contains(&grey), "SDR as it is: {grey}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn grades_a_still_with_the_videos_lut_and_hdr_with_the_lut_alone() {
        let dir = temp_dir("lut-still");
        // An inverting 2-point cube, written here: no camera maker's LUT is ever shipped.
        let invert = crate::playback::Lut {
            sha256: "ab".repeat(32),
            cube: "LUT_3D_SIZE 2\n1 1 1\n0 1 1\n1 0 1\n0 0 1\n1 1 0\n0 1 0\n1 0 0\n0 0 0\n"
                .to_owned(),
        };
        let dark = flat_10_bit(
            &dir,
            "dark.mov",
            200,
            "color_primaries=bt709:color_trc=bt709:colorspace=bt709",
        );
        let plain = mean_grey(&dir, &still(&dark, 0, 25, 1).unwrap());
        let graded = mean_grey(&dir, &still_graded(&dark, 0, 25, 1, Some(&invert)).unwrap());
        assert!(plain < 80.0, "dark as shot: {plain}");
        assert!(graded > 175.0, "light through the inverting LUT: {graded}");
        // HDR under a LUT: the LUT alone (an identity one leaves PQ's own level, about 146), never the tone-map (236).
        let identity = crate::playback::Lut {
            sha256: "cd".repeat(32),
            cube: "LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n"
                .to_owned(),
        };
        let pq = flat_10_bit(&dir, "pq.mov", PQ_WHITE, PQ);
        let grey = mean_grey(&dir, &still_graded(&pq, 0, 25, 1, Some(&identity)).unwrap());
        assert!((125.0..=170.0).contains(&grey), "PQ under its LUT: {grey}");
        // Its colour tags: what the LUT made (BT.709), never the PQ it was read as.
        let png = still_graded(&pq, 0, 25, 1, Some(&identity)).unwrap();
        let file = dir.join("pq-graded.png");
        fs::write(&file, &png).unwrap();
        let tags = command("ffprobe")
            .args([
                "-v",
                "error",
                "-show_entries",
                "frame=color_transfer,color_primaries",
                "-of",
                "csv=p=0",
            ])
            .arg(&file)
            .output()
            .unwrap();
        let tags = String::from_utf8_lossy(&tags.stdout).trim().to_owned();
        assert_eq!(
            tags, "bt709,bt709",
            "what the LUT made, never the PQ it was read as"
        );
        // One named by anything but a SHA-256 is refused before anything is written.
        let odd = crate::playback::Lut {
            sha256: "../x".to_owned(),
            cube: invert.cube.clone(),
        };
        assert!(still_graded(&dark, 0, 25, 1, Some(&odd)).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_graded_still_is_the_frame_asked_for_through_its_lut() {
        let dir = temp_dir("lut-frame");
        let identity = crate::playback::Lut {
            sha256: "ef".repeat(32),
            cube: "LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n"
                .to_owned(),
        };
        // As the plain still's test: frame n is grey 8 (n mod 32), in an AVCHD file whose sound starts a tenth of a
        // second before its picture, so the graded path's seeks and trim are held to the same frame.
        let clip = make(
            &dir,
            "00002.MTS",
            &[
                "-f",
                "lavfi",
                "-i",
                "color=c=black:size=64x36:rate=24000/1001:duration=6",
                "-itsoffset",
                "-0.1",
                "-f",
                "lavfi",
                "-i",
                "sine=duration=6",
            ],
            &[
                "-vf",
                "format=gray,geq=lum='mod(N,32)*8',format=yuv420p",
                "-c:v",
                "mpeg2video",
                "-q:v",
                "1",
                "-g",
                "12",
                "-map",
                "0:v",
                "-map",
                "1:a",
                "-c:a",
                "mp2",
            ],
        );
        for frame in [0_u64, 1, 13, 100, 137] {
            let png = still_graded(&clip, frame, 24000, 1001, Some(&identity)).unwrap();
            let level = i32::from(grey(&dir, &png));
            let expected = (frame % 32 * 8) as i32;
            assert!(
                (level - expected).abs() <= 3,
                "frame {frame}: grey {level}, expected {expected}"
            );
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn saves_a_clip_frame_exact_framed_and_with_its_sound() {
        let dir = temp_dir("clip");
        // Frame n is grey 8 (n mod 32), with its sound starting a tenth of a second before its picture.
        let take = make(
            &dir,
            "A001_C003.MTS",
            &[
                "-f",
                "lavfi",
                "-i",
                "color=c=black:size=320x180:rate=25:duration=3",
                "-itsoffset",
                "-0.1",
                "-f",
                "lavfi",
                "-i",
                "sine=duration=3",
            ],
            &[
                "-vf",
                "format=gray,geq=lum='mod(N,32)*8',format=yuv420p",
                "-c:v",
                "mpeg2video",
                "-q:v",
                "1",
                "-g",
                "12",
                "-map",
                "0:v",
                "-map",
                "1:a",
                "-c:a",
                "mp2",
            ],
        );
        let window = ClipWindow {
            left: 0.25,
            top: 0.25,
            width: 0.5,
            height: 0.5,
        };
        let dest = dir.join("SC004_4A.mp4");
        save_clip(&take, (10, 20), (25, 1), window, None, &dest).unwrap();
        let saved = probe(&dest).unwrap();
        // The frame's window, half the picture each way; frames 10 to 20, eleven of them; its sound with it.
        assert_eq!((saved.width, saved.height), (160, 90));
        assert_eq!(saved.duration_frames, 11);
        assert!(saved.has_audio);
        let first = i32::from(grey(&dir, &still(&dest, 0, 25, 1).unwrap()));
        let last = i32::from(grey(&dir, &still(&dest, 10, 25, 1).unwrap()));
        assert!(
            (first - 80).abs() <= 3,
            "first frame is the in frame: {first}"
        );
        assert!(
            (last - 160).abs() <= 3,
            "last frame is the out frame: {last}"
        );
        // The sound starts with the picture and lasts as long: in sync, whatever led in the original.
        let timing = command("ffprobe")
            .args([
                "-v",
                "error",
                "-show_entries",
                "stream=codec_type,start_time,duration",
                "-of",
                "csv=p=0",
            ])
            .arg(&dest)
            .output()
            .unwrap();
        let timing = String::from_utf8_lossy(&timing.stdout).to_string();
        for line in timing.lines() {
            let parts: Vec<&str> = line.split(',').collect();
            let start: f64 = parts.get(1).and_then(|v| v.parse().ok()).unwrap_or(9.0);
            let length: f64 = parts.get(2).and_then(|v| v.parse().ok()).unwrap_or(0.0);
            assert!(start.abs() < 0.03, "{line}: starts at 0");
            assert!((length - 0.44).abs() < 0.05, "{line}: 11 frames long");
        }
        // Through a LUT (an inverting one, so it shows): frame 10's grey 80 comes out near 255 - 80.
        let invert = crate::playback::Lut {
            sha256: "ab".repeat(32),
            cube: "LUT_3D_SIZE 2\n1 1 1\n0 1 1\n1 0 1\n0 0 1\n1 1 0\n0 1 0\n1 0 0\n0 0 0\n"
                .to_owned(),
        };
        let graded = dir.join("SC004_4B.mp4");
        save_clip(&take, (10, 20), (25, 1), window, Some(&invert), &graded).unwrap();
        let first = i32::from(grey(&dir, &still(&graded, 0, 25, 1).unwrap()));
        assert!(
            (first - 175).abs() <= 8,
            "graded, the in frame inverted: {first}"
        );
        // Never over footage: not over the take itself, nor over any file there that reads as a video.
        assert!(!clip_may_go(&take, &take));
        assert!(!clip_may_go(&dest, &take));
        assert!(clip_may_go(&dir.join("SC004_4D.mp4"), &take));
        fs::write(dir.join("notes.mp4"), b"not a video").unwrap();
        assert!(clip_may_go(&dir.join("notes.mp4"), &take));
        // No unfinished file left anywhere beside them.
        assert!(fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .all(|entry| !entry.file_name().to_string_lossy().ends_with(".part")));
        // A backwards clip is refused, and makes nothing.
        let none = dir.join("SC004_4C.mp4");
        assert!(save_clip(&take, (20, 10), (25, 1), window, None, &none).is_err());
        assert!(!none.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn tone_maps_only_pq_and_hlg_and_fills_in_tags_a_file_leaves_out() {
        let colour = |transfer: &str, primaries: &str, matrix: &str, range: &str| Colour {
            transfer: transfer.into(),
            primaries: primaries.into(),
            matrix: matrix.into(),
            range: range.into(),
            peak_nits: None,
        };
        assert_eq!(tone_map(&colour("bt709", "bt709", "bt709", "tv")), None);
        assert_eq!(tone_map(&colour("", "", "", "")), None);
        let pq = tone_map(&colour("smpte2084", "bt2020", "bt2020nc", "tv"))
            .unwrap()
            .after;
        assert!(
            pq.starts_with("zscale=tin=smpte2084:pin=bt2020:min=bt2020nc:rin=tv:t=linear:npl=100")
        );
        assert!(
            pq.contains("tonemap=tonemap=mobius") && pq.ends_with("zscale=t=bt709:m=bt709:r=tv")
        );
        // ICtCp, which zscale knows, kept.
        let ictcp = tone_map(&colour("smpte2084", "bt2020", "ictcp", "tv"))
            .unwrap()
            .after;
        assert!(ictcp.contains(":min=ictcp:"), "{ictcp}");
        // ICtCp only with BT.2020 primaries, constant luminance never: both mis-tagged for HDR.
        let ictcp_p3 = tone_map(&colour("smpte2084", "smpte432", "ictcp", "tv"))
            .unwrap()
            .after;
        assert!(ictcp_p3.contains(":min=bt2020nc:"), "{ictcp_p3}");
        let cl = tone_map(&colour("smpte2084", "bt2020", "bt2020c", "tv")).unwrap();
        assert!(cl.after.contains(":min=bt2020nc:"), "{cl:?}");
        // Frames tagged with a matrix FFmpeg's own filters refuse are re-tagged for them; zscale still reads the real one.
        assert_eq!(cl.before, "setparams=colorspace=bt2020nc,");
        assert_eq!(
            tone_map(&colour("smpte2084", "bt2020", "ictcp", "tv"))
                .unwrap()
                .before,
            "setparams=colorspace=bt2020nc,"
        );
        assert_eq!(
            tone_map(&colour("smpte2084", "bt2020", "bt2020nc", "tv"))
                .unwrap()
                .before,
            ""
        );
        assert_eq!(
            tone_map(&colour("smpte2084", "", "", "")).unwrap().before,
            ""
        );
        // P3 primaries kept; an unknown matrix and range taken as HDR's usual.
        let p3 = tone_map(&colour("arib-std-b67", "smpte432", "unknown", ""))
            .unwrap()
            .after;
        assert!(
            p3.starts_with("zscale=tin=arib-std-b67:pin=smpte432:min=bt2020nc:rin=tv"),
            "{p3}"
        );
    }

    /// The AV1 conformance vector (testdata/README.md), remuxed to MP4 as a camera or an export would hand it over.
    fn av1_clip(dir: &Path) -> PathBuf {
        let vector = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("testdata")
            .join("av1-1-b8-01-size-226x226.ivf");
        make(
            dir,
            "av1.mp4",
            &["-i", vector.to_str().unwrap()],
            &["-c", "copy"],
        )
    }

    #[test]
    fn decodes_av1_exactly_with_dav1d_and_makes_a_still() {
        let dir = temp_dir("av1");
        let clip = av1_clip(&dir);
        let probe = probe(&clip).unwrap();
        assert_eq!(probe.codec, "av1");
        assert_eq!(
            (probe.width, probe.height, probe.duration_frames),
            (226, 226, 2)
        );
        // Each decoded frame's MD5, as AOMedia lists them: the decode is exact.
        let out = command("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error", "-i"])
            .arg(&clip)
            .args([
                "-map", "0:V:0", "-pix_fmt", "yuv420p", "-f", "framemd5", "-",
            ])
            .output()
            .unwrap();
        let sums: Vec<String> = String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter(|line| !line.starts_with('#'))
            .filter_map(|line| line.rsplit(',').next().map(|sum| sum.trim().to_owned()))
            .collect();
        assert_eq!(
            sums,
            [
                "68fd0575b5211242727c2bc77c27453d",
                "448d6b4cb8379eaee950670af0f5ab41"
            ]
        );
        let png = still(&clip, 1, probe.fps_num, probe.fps_den).unwrap();
        assert_eq!(&png[1..4], b"PNG");
        let _ = fs::remove_dir_all(&dir);
    }

    /// The mean red, green and blue of a picture file (a still's PNG), read back with the sidecar.
    fn mean_rgb(dir: &Path, png: &[u8]) -> [f64; 3] {
        let file = dir.join(format!("{}.png", crate::lock::random_id()));
        fs::write(&file, png).unwrap();
        let out = command("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error", "-i"])
            .arg(&file)
            .args(["-pix_fmt", "rgb24", "-f", "rawvideo", "-"])
            .output()
            .unwrap();
        let pixels = out.stdout.len() as f64 / 3.0;
        let mut sums = [0.0; 3];
        for (i, &b) in out.stdout.iter().enumerate() {
            sums[i % 3] += f64::from(b);
        }
        sums.map(|sum| sum / pixels)
    }

    #[test]
    fn an_hdr_still_is_the_exact_frame_asked_for_in_a_file_that_starts_late() {
        let dir = temp_dir("hdr-frames");
        // Black but for frame 10, at reference white, in a file whose timestamps start at 10 s: only the frame asked
        // for is tone-mapped, by the file's own clock, and it's that one.
        let clip = make(
            &dir,
            "pq frames.mkv",
            &["-f", "lavfi", "-i", "color=c=black:size=320x180:rate=25:duration=1"],
            &[
                "-vf",
                &format!("format=yuv422p10le,geq=lum='if(eq(N,10),{PQ_WHITE},64)':cb=512:cr=512,setparams=range=tv:{PQ}"),
                "-c:v",
                "prores_ks",
                "-output_ts_offset",
                "10",
            ],
        );
        let (stream_start, _) = starts(&clip).unwrap();
        assert!(
            (stream_start - 10.0).abs() < 0.01,
            "starts at {stream_start}"
        );
        for (frame, white) in [(9, false), (10, true), (11, false)] {
            let grey = mean_grey(&dir, &still(&clip, frame, 25, 1).unwrap());
            assert_eq!(grey > 200.0, white, "frame {frame}: {grey}");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_still_trims_to_its_frame_before_the_tone_map_and_only_for_hdr() {
        let pq = Colour {
            transfer: "smpte2084".into(),
            ..Colour::default()
        };
        let filter = still_filter(&pq, 13.49);
        let trim = filter.find("trim=start=13.490000,").expect("trimmed");
        assert!(
            trim < filter.find("scale=").unwrap() && trim < filter.find("zscale=").unwrap(),
            "{filter}"
        );
        let sdr = still_filter(&Colour::default(), 13.49);
        assert!(!sdr.contains("trim") && !sdr.contains("zscale"), "{sdr}");
        // A file whose clock starts at 10 s (its sound a tenth of a second earlier): frame 10 at 25 fps is 10.49 s (10.1 + 0.39) on
        // that clock, for the seek and the trim alike, and the quick seek lands at the file's start.
        let late = Facts {
            stream_start: 10.1,
            file_start: 10.0,
            colour: pq,
        };
        let (early, at) = still_times(&late, 10, 25, 1);
        assert!((at - 10.49).abs() < 1e-9 && early == 0.0, "{early} {at}");
        let (early, _) = still_times(&late, 200, 25, 1);
        assert!((early - (0.1 + 7.99 - 3.0)).abs() < 1e-9, "{early}");
    }

    #[test]
    fn hdr_colours_come_out_right_whatever_the_file_tags_its_matrix() {
        let dir = temp_dir("hdr-colour");
        // One BT.2020 colour each, inside BT.709's gamut, as measured with this build: the first moves its green by 32
        // without the primaries' conversion, the second by 12 when read with BT.709's matrix.
        let colour = |name: &str, y: u32, cb: u32, cr: u32, matrix: &str| {
            make(
                &dir,
                name,
                &["-f", "lavfi", "-i", "color=c=black:size=64x36:rate=25:duration=0.2"],
                &[
                    "-vf",
                    &format!(
                        "format=yuv422p10le,geq=lum={y}:cb={cb}:cr={cr},setparams=range=tv:color_primaries=bt2020:\
                         color_trc=smpte2084:colorspace={matrix}"
                    ),
                    "-c:v",
                    "prores_ks",
                ],
            )
        };
        let near = |rgb: [f64; 3], expected: [f64; 3]| {
            rgb.iter()
                .zip(expected)
                .all(|(got, want)| (got - want).abs() <= 5.0)
        };
        let orange = colour("orange.mov", 520, 470, 560, "bt2020nc");
        let rgb = mean_rgb(&dir, &still(&orange, 0, 25, 1).unwrap());
        assert!(near(rgb, [246.0, 127.0, 98.0]), "{rgb:?}");
        let cyan = colour("cyan.mov", 500, 560, 400, "bt2020nc");
        let rgb = mean_rgb(&dir, &still(&cyan, 0, 25, 1).unwrap());
        assert!(near(rgb, [0.0, 212.0, 241.0]), "{rgb:?}");
        // ICtCp, read as itself: its codes read as BT.2020's Y'CbCr would come out (246, 127, 98).
        let ictcp = colour("ictcp colour.mov", 520, 470, 560, "ictcp");
        let rgb = mean_rgb(&dir, &still(&ictcp, 0, 25, 1).unwrap());
        assert!(near(rgb, [233.0, 182.0, 152.0]), "{rgb:?}");
        // The same pixels tagged BT.709's matrix are read with it.
        let cyan_709 = colour("cyan 709.mov", 500, 560, 400, "bt709");
        let rgb = mean_rgb(&dir, &still(&cyan_709, 0, 25, 1).unwrap());
        assert!(near(rgb, [0.0, 200.0, 241.0]), "{rgb:?}");
        // Constant luminance, which zimg does only for SDR: read as the usual matrix, never refused. ICtCp with BT.2020:
        // read as ICtCp, whose I at PQ's reference white lands where Y does.
        for matrix in ["bt2020c", "chroma-derived-c", "ictcp"] {
            let clip = colour(&format!("{matrix}.mov"), 572, 512, 512, matrix);
            let grey = mean_grey(&dir, &still(&clip, 0, 25, 1).unwrap());
            assert!((225.0..=250.0).contains(&grey), "{matrix}: {grey}");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_an_hdr_files_peak_from_its_light_level_or_its_mastering_display() {
        let json = |side_data: serde_json::Value| {
            serde_json::json!({
                "streams": [{ "start_time": "0.000000", "color_transfer": "smpte2084", "side_data_list": side_data }],
                "format": { "start_time": "0.000000" },
            })
        };
        let both = json(serde_json::json!([
            { "side_data_type": "Mastering display metadata", "max_luminance": "40000000/10000" },
            { "side_data_type": "Content light level metadata", "max_content": 1200, "max_average": 400 },
        ]));
        assert_eq!(read_facts(&both).colour.peak_nits, Some(1200.0));
        let mastering = json(serde_json::json!([
            { "side_data_type": "Mastering display metadata", "max_luminance": "40000000/10000" },
            { "side_data_type": "Content light level metadata", "max_content": 0, "max_average": 0 },
        ]));
        let facts = read_facts(&mastering);
        assert_eq!(facts.colour.peak_nits, Some(4000.0));
        assert!(tone_map(&facts.colour)
            .unwrap()
            .after
            .contains("tonemap=tonemap=mobius:desat=0:peak=40.00,"));
        // None said: tonemap's own 1000 nits.
        let none = read_facts(&json(serde_json::json!([])));
        assert_eq!(none.colour.peak_nits, None);
        assert!(tone_map(&none.colour)
            .unwrap()
            .after
            .contains("desat=0,zscale"));
        // HLG is always shown on a 1000-nit display: a peak in its metadata (copied from a PQ master, say) is left out.
        let hlg = Colour {
            transfer: "arib-std-b67".into(),
            peak_nits: Some(4000.0),
            ..Colour::default()
        };
        assert!(!tone_map(&hlg).unwrap().after.contains(":peak="));
        // A peak below white itself is taken as white.
        let dim = Colour {
            transfer: "smpte2084".into(),
            peak_nits: Some(50.0),
            ..Colour::default()
        };
        assert!(tone_map(&dim).unwrap().after.contains(":peak=1.00"));
    }
}
