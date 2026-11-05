//! Video files (Phase 2): what ffprobe says about one, through the LGPL ffmpeg and ffprobe sidecars that
//! scripts/ffmpeg/build.sh builds. The tools run as separate programs, with their arguments passed as a list, never
//! through a shell, so a file name can't be read as a command. Like pictures (pictures.rs), only a file the person
//! dropped or chose is read.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::pictures::Offered;

/// The target triple the sidecars are named for in src-tauri/binaries, as Tauri's externalBin names them.
const TRIPLE: &str = env!("SBD_TARGET_TRIPLE");

/// Where a sidecar is. `STORIIBOARD_FFMPEG_DIR` first (tests and tools may point elsewhere); then beside the app's own
/// executable, where Tauri puts it in a bundle and in development; then the build folder above a test binary
/// (target/debug for target/debug/deps); last, src-tauri/binaries with its triple, as built.
pub fn tool(name: &str) -> PathBuf {
    let file = format!("{name}{}", std::env::consts::EXE_SUFFIX);
    if let Some(dir) = std::env::var_os("STORIIBOARD_FFMPEG_DIR") {
        return PathBuf::from(dir).join(&file);
    }
    if let Ok(exe) = std::env::current_exe() {
        for dir in exe.ancestors().skip(1).take(2) {
            let candidate = dir.join(&file);
            if candidate.is_file() {
                return candidate;
            }
        }
    }
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!("{name}-{TRIPLE}{}", std::env::consts::EXE_SUFFIX))
}

/// What the app needs to know about a video, from ffprobe.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    pub codec: String,
    pub width: u32,
    pub height: u32,
    /// The frame rate as an exact fraction: 24000/1001, never 23.976.
    pub fps_num: u32,
    pub fps_den: u32,
    pub duration_frames: u64,
    /// The source's start timecode as it writes it ("01:00:00:00", or "01:00:00;00" for drop-frame); none without.
    pub start_timecode: Option<String>,
    /// Degrees the picture is turned to be shown upright (a phone held upright: 90), from the display matrix.
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
    (48, 1),
    (50, 1),
    (60000, 1001),
    (60, 1),
    (100, 1),
    (120000, 1001),
    (120, 1),
];

fn rational(text: &str) -> Option<(u32, u32)> {
    let (num, den) = text.split_once('/')?;
    let (num, den): (u32, u32) = (num.parse().ok()?, den.parse().ok()?);
    if num == 0 || den == 0 {
        return None;
    }
    // In lowest terms, so 48000/2002 and 24000/1001 are the same rate.
    let (mut a, mut b) = (num, den);
    while b != 0 {
        (a, b) = (b, a % b);
    }
    Some((num / a, den / a))
}

/// The rate to step and number frames by: the stream's own rate when it's one cameras use; otherwise (a phone's
/// variable rate) its average, made the nearest standard rate, which is what the playback copy is made at.
fn frame_rate(stream: &Value) -> Option<(u32, u32)> {
    let real = stream["r_frame_rate"].as_str().and_then(rational);
    if let Some(rate) = real.filter(|rate| STANDARD_RATES.contains(rate)) {
        return Some(rate);
    }
    let average = stream["avg_frame_rate"]
        .as_str()
        .and_then(rational)
        .or(real)?;
    let value = f64::from(average.0) / f64::from(average.1);
    STANDARD_RATES
        .iter()
        .copied()
        .min_by(|a, b| {
            let da = (f64::from(a.0) / f64::from(a.1) - value).abs();
            let db = (f64::from(b.0) / f64::from(b.1) - value).abs();
            da.total_cmp(&db)
        })
        .filter(|rate| (f64::from(rate.0) / f64::from(rate.1) - value).abs() < 1.0)
        .or(Some(average))
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
    let fps = f64::from(fps_num) / f64::from(fps_den);
    let duration = number(&video["duration"]).or_else(|| number(&json["format"]["duration"]));
    let duration_frames = video["nb_frames"]
        .as_str()
        .and_then(|n| n.parse::<u64>().ok())
        .filter(|&n| n > 0)
        .or_else(|| duration.map(|seconds| (seconds * fps).round() as u64))
        .unwrap_or(0);
    // The timecode can sit on the video stream, on the file, or on a timecode (tmcd) data stream.
    let start_timecode = std::iter::once(&video["tags"]["timecode"])
        .chain(std::iter::once(&json["format"]["tags"]["timecode"]))
        .chain(streams.iter().map(|s| &s["tags"]["timecode"]))
        .find_map(|t| t.as_str().map(str::to_owned));
    let rotation = video["side_data_list"]
        .as_array()
        .and_then(|list| list.iter().find_map(|d| number(&d["rotation"])))
        .or_else(|| number(&video["tags"]["rotate"]))
        .map(|degrees| degrees.round() as i32)
        .unwrap_or(0);
    let transfer = video["color_transfer"].as_str().unwrap_or("");
    let pix_fmt = video["pix_fmt"].as_str().unwrap_or("");
    let bit_depth = video["bits_per_raw_sample"]
        .as_str()
        .and_then(|b| b.parse().ok())
        .unwrap_or(if pix_fmt.contains("12") {
            12
        } else if pix_fmt.contains("10") {
            10
        } else {
            8
        });
    Ok(Probe {
        codec: video["codec_name"].as_str().unwrap_or("").to_owned(),
        width: video["width"].as_u64().unwrap_or(0) as u32,
        height: video["height"].as_u64().unwrap_or(0) as u32,
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

/// Runs ffprobe on a file. The path is one argument of the list, never part of a shell string.
pub fn probe(path: &Path) -> Result<Probe, String> {
    let output = Command::new(tool("ffprobe"))
        .args([
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(path)
        .output()
        .map_err(|error| format!("ffprobe couldn't run: {error}"))?;
    if !output.status.success() {
        return Err("That file can't be read as a video.".into());
    }
    let json: Value = serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;
    read_probe(&json)
}

fn probe_offered(offered: &Offered, path: &Path) -> Result<Probe, String> {
    if !offered.has(path) {
        return Err("Storiiboard reads only the files you drop on it or choose.".into());
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
        let status = Command::new(tool("ffmpeg"))
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
        assert!(!probe.has_audio);
        assert!(!probe.hdr);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn keeps_drop_frame_timecode_and_hears_audio() {
        let dir = temp_dir("2997");
        let clip = make(
            &dir,
            "with sound; and spaces.mov",
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
    fn reads_a_phone_clips_rotation_and_an_hlg_clips_depth() {
        let dir = temp_dir("phone");
        let phone = make(
            &dir,
            "IMG_0001.mov",
            &[
                "-display_rotation",
                "90",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x180:rate=30:duration=1",
            ],
            &["-c:v", "mpeg4"],
        );
        assert_eq!(probe(&phone).unwrap().rotation.abs(), 90);
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
                "-color_trc",
                "arib-std-b67",
                "-color_primaries",
                "bt2020",
                "-colorspace",
                "bt2020nc",
            ],
        );
        let probe = probe(&hlg).unwrap();
        assert!(probe.hdr);
        assert_eq!(probe.bit_depth, 10);
        assert_eq!(probe.codec, "prores");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn applies_a_cube_lut_with_the_lgpl_build() {
        // A 2-point identity-but-inverted .cube, written here: no camera maker's LUT is ever shipped.
        let dir = temp_dir("lut");
        let cube = dir.join("invert.cube");
        fs::write(
            &cube,
            "LUT_3D_SIZE 2\n1 1 1\n0 1 1\n1 0 1\n0 0 1\n1 1 0\n0 1 0\n1 0 0\n0 0 0\n",
        )
        .unwrap();
        let lut = format!("lut3d=file={}", cube.display())
            .replace('\\', "/")
            .replace(':', "\\:");
        make(
            &dir,
            "graded.png",
            &[
                "-f",
                "lavfi",
                "-i",
                "color=c=black:size=16x16:duration=0.04",
            ],
            &["-vf", &lut, "-frames:v", "1"],
        );
        assert!(dir.join("graded.png").is_file());
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
        let sound = make(
            &dir,
            "sound.wav",
            &["-f", "lavfi", "-i", "sine=duration=0.2"],
            &[],
        );
        assert_eq!(probe(&sound).unwrap_err(), "That file has no video in it.");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn makes_a_variable_phone_rate_the_nearest_standard_one() {
        let stream = serde_json::json!({ "r_frame_rate": "90000/1", "avg_frame_rate": "2997/100" });
        assert_eq!(frame_rate(&stream), Some((30000, 1001)));
        let odd = serde_json::json!({ "r_frame_rate": "12/1", "avg_frame_rate": "12/1" });
        assert_eq!(frame_rate(&odd), Some((12, 1)));
    }
}
