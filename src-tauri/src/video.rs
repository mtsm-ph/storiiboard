//! Video files (Phase 2): what ffprobe says about one, through the LGPL ffmpeg and ffprobe sidecars that
//! scripts/ffmpeg/build.sh builds. The tools run as separate programs, with their arguments passed as a list, never
//! through a shell, so a file name can't be read as a command. Like pictures (pictures.rs), only a file the person
//! dropped or chose is read.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::pictures::Offered;

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

/// Runs ffprobe on a file. The path is one argument of the list, never part of a shell string, and ffprobe may open
/// local files only (a playlist named like a video can't send it to the network).
pub fn probe(path: &Path) -> Result<Probe, String> {
    let mut child = command("ffprobe")
        .args([
            "-v",
            "error",
            "-protocol_whitelist",
            "file",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(path)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| {
            "Storiiboard's video reader couldn't start. Reinstalling Storiiboard puts it back."
                .to_string()
        })?;
    // Read while waiting, so a long answer can't fill the pipe and stall ffprobe.
    let mut stdout = child
        .stdout
        .take()
        .ok_or("That file can't be read as a video.")?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.read_to_end(&mut bytes).map(|_| bytes)
    });
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < PROBE_TIMEOUT => {
                std::thread::sleep(Duration::from_millis(20));
            }
            Ok(None) => {
                // A read stuck on a share that stopped answering can hold the kill back until it returns, so the
                // wait for the process happens on a thread of its own, never here.
                let _ = child.kill();
                std::thread::spawn(move || child.wait());
                return Err("That video took too long to read. If it's on a network drive, copy it to this computer first.".into());
            }
            Err(_) => return Err("That file can't be read as a video.".into()),
        }
    };
    let bytes = reader.join().ok().and_then(Result::ok);
    let json = bytes
        .filter(|_| status.success())
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .ok_or("That file can't be read as a video.")?;
    read_probe(&json)
}

fn probe_offered(offered: &Offered, path: &Path) -> Result<Probe, String> {
    if !offered.has(path) {
        return Err("Storiiboard reads only the files you drop on it or choose.".into());
    }
    if path.is_dir() {
        return Err("That's a folder, not a file.".into());
    }
    if !path.is_file() {
        return Err("That file isn't there any more.".into());
    }
    probe(path)
}

/// What ffprobe says about a video the person dropped or chose.
#[tauri::command]
pub async fn video_probe(app: AppHandle, path: String) -> Result<Probe, String> {
    tauri::async_runtime::spawn_blocking(move || {
        probe_offered(&app.state::<Offered>(), Path::new(&path))
    })
    .await
    .map_err(|error| error.to_string())?
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
    fn reads_interlaced_footage_at_its_frame_rate_and_anamorphic_pixels() {
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
        let offered = Offered::default();
        assert!(probe_offered(&offered, &clip).is_err());
        offered.offer(std::slice::from_ref(&clip));
        assert!(probe_offered(&offered, &clip).is_ok());
        offered.offer(std::slice::from_ref(&dir));
        assert_eq!(
            probe_offered(&offered, &dir).unwrap_err(),
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
