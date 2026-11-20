//! A HEIC photo turned into a PNG on this computer (6.27n; Kevin, Nov 19 and 20), for Windows, whose webview can't
//! decode HEIC: the bytes in, a PNG out, fitted inside 2560 × 2560 and tagged with the file's own colour, so Windows
//! stores from a HEIC what the Mac stores. The Mac never decodes here: WebKit reads HEIC itself, and the command answers
//! there with the page's own HEIC line, as before.
//!
//! The work is the ffmpeg and ffprobe sidecars', run through video.rs's own runner (`command`, `run_stoppable`): ffprobe
//! says where the picture is (a tile grid, or one stream), its depth and its colour; one ffmpeg run decodes and scales
//! it into a PNG on stdout; for a file that carries an ICC profile, a second, tiny run gives that profile as a PNG's
//! iCCP chunk (the grid's own PNG doesn't carry it). The answer holds only IHDR, the colour chunk, the IDAT chunks and
//! IEND. No colour is converted: the page's decoder reads the tag.
//!
//! The bytes are untrusted. They are refused before any decode over 64 MiB or when they aren't a HEIF (exif.rs's
//! `is_heif`, which keeps AVIF out). The HEIF reader has to seek, so they go to a file of our own in the app's cache
//! folder, under a random name, made new, and gone after every outcome. At most two photos decode at a time (a 48 MP
//! one peaks at about 300 MB), each given 10 s from its turn. No file name, path or ffmpeg output goes into a message.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Condvar, Mutex, PoisonError};
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::{ipc::Response, AppHandle, Manager, Runtime};

use crate::video;

/// The page's own HEIC line (en.ts `error.heic`), character for character: what the Mac answers, as before 6.27n.
const ON_THE_MAC: &str =
    "This is an HEIC photo, which Storiiboard can’t read on this computer yet. Convert it to JPEG first.";
const TOO_BIG: &str =
    "This HEIC photo is too large to read (over 64 MB). Convert it to JPEG first.";
const NOT_HEIC: &str = "That file isn't an HEIC photo.";
/// Kevin, Nov 20: an HDR HEIF (PQ or HLG) isn't tone-mapped here, which wouldn't match the Mac's own curve.
const HDR: &str = "This is an HDR photo, which Storiiboard can't read on this computer yet. Export it as a JPEG first.";
const TOO_SLOW: &str =
    "This HEIC photo took too long to read. Try again, or convert it to JPEG first.";
const UNREAD: &str = "This HEIC photo couldn't be read. Convert it to JPEG first.";
const PROFILE_TOO_BIG: &str = "This photo's colour profile is too large to keep, so its colours can't be shown as they are. Convert it to JPEG first.";
/// A bug in the page, never something a person did (the same words as exif.rs's).
const NOT_RAW: &str = "Expected the picture as raw bytes.";

/// The most a HEIC may hold to be read at all.
const MAX_INPUT: usize = 64 * 1024 * 1024;
/// The most of ffprobe's JSON that is read (compact JSON; a 12 MP grid of 48 tiles says about 110 KB).
const MAX_PROBE: usize = 1024 * 1024;
/// The most of ffmpeg's PNG that is taken: 2560 × 2560 at 16 bits is under 40 MB unpacked.
const MAX_OUTPUT: usize = 64 * 1024 * 1024;
/// A colour profile as stored, counted as cleanPicture.ts and picture_door.rs count it: the iCCP chunk's data as it
/// sits in the PNG, nothing inflated.
const MAX_PROFILE_BYTES: usize = 64 * 1024;
/// The picture pipeline's own long edge (src/core/media/image.ts), as video.rs's stills use.
const LONG_EDGE: u32 = 2560;
/// For the whole call once it has its turn, every run together (Kevin, Nov 20: the slowest 48 MP run on GitHub's
/// Windows machine took 2.2 s; the larger of 10 s and four times that).
const LIMIT: Duration = Duration::from_secs(10);
/// Photos decoded at once (Kevin, Nov 20).
const AT_ONCE: usize = 2;

/// What a system answers instead of decoding: the Mac its HEIC line, every other system nothing (it decodes). A
/// function of the system's name, so a test reads both answers on any system.
fn refusal_on(os: &str) -> Option<&'static str> {
    (os == "macos").then_some(ON_THE_MAC)
}

/// Refused before anything is written or run: too large, or not a HEIF.
fn refuse(bytes: &[u8]) -> Result<(), &'static str> {
    if bytes.len() > MAX_INPUT {
        return Err(TOO_BIG);
    }
    if !crate::exif::is_heif(bytes) {
        return Err(NOT_HEIC);
    }
    Ok(())
}

/// At most `most` callers inside at once; the next waits its turn (std only, no crate).
pub(crate) struct Gate {
    inside: Mutex<usize>,
    turn: Condvar,
    most: usize,
}

/// A turn inside the gate, given back when it goes.
pub(crate) struct Pass<'a>(&'a Gate);

impl Gate {
    pub(crate) const fn new(most: usize) -> Self {
        Self {
            inside: Mutex::new(0),
            turn: Condvar::new(),
            most,
        }
    }

    pub(crate) fn enter(&self) -> Pass<'_> {
        let mut inside = self.inside.lock().unwrap_or_else(PoisonError::into_inner);
        while *inside >= self.most {
            inside = self
                .turn
                .wait(inside)
                .unwrap_or_else(PoisonError::into_inner);
        }
        *inside += 1;
        Pass(self)
    }
}

impl Drop for Pass<'_> {
    fn drop(&mut self) {
        let mut inside = self.0.inside.lock().unwrap_or_else(PoisonError::into_inner);
        *inside = inside.saturating_sub(1);
        self.0.turn.notify_one();
    }
}

static GATE: Gate = Gate::new(AT_ONCE);

/// The photo's bytes in a file of our own: a random name (lock.rs's `random_id`), made new so it can't be one someone
/// else put there, removed when this goes. A run that was killed removes it too, once its ffmpeg has let go of it
/// (video.rs's leftover), since Windows deletes no file a process still has open.
struct TempPicture {
    path: PathBuf,
}

impl TempPicture {
    fn write(folder: &Path, bytes: &[u8]) -> Result<Self, &'static str> {
        fs::create_dir_all(folder).map_err(|_| UNREAD)?;
        let path = folder.join(format!("heic-{}.heic", crate::lock::random_id()));
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|_| UNREAD)?;
        let written = file.write_all(bytes);
        drop(file);
        // Made: from here it goes on every outcome, this one included.
        let temp = Self { path };
        written.map_err(|_| UNREAD)?;
        Ok(temp)
    }
}

impl Drop for TempPicture {
    fn drop(&mut self) {
        // As video.rs's runner removes a leftover: Windows can refuse for a moment after the process has gone.
        for _ in 0..20 {
            if fs::remove_file(&self.path).is_ok() || !self.path.exists() {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

/// Where the picture is in the file.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Source {
    /// A tile grid, by its place among the file's stream groups (`[0:g:N]`).
    Grid(usize),
    /// A video stream, by its place among the file's video streams (`[0:v:M]`).
    Stream(usize),
}

/// What ffprobe says about the picture.
#[derive(Clone, Debug, PartialEq)]
struct Picture {
    source: Source,
    /// The picture's first stream, by its place among the video streams: its PNG alone carries the profile.
    first: usize,
    /// More than 8 bits a sample: a 16-bit PNG.
    deep: bool,
    /// An ICC profile in the file (the stream's side data).
    profile: bool,
    primaries: Option<String>,
    transfer: Option<String>,
}

/// Reads ffprobe's JSON (`-show_streams -show_stream_groups`): the picture is the tile grid marked default, else the
/// first tile grid, else the first video stream not marked `dependent` (a tile). An HDR transfer is refused.
fn read_picture(json: &Value) -> Result<Picture, &'static str> {
    let streams = json["streams"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let videos: Vec<&Value> = streams
        .iter()
        .filter(|stream| stream["codec_type"] == "video")
        .collect();
    let groups = json["stream_groups"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let grids = || {
        groups
            .iter()
            .enumerate()
            .filter(|(_, group)| group["type"] == "Tile Grid")
    };
    let grid = grids()
        .find(|(_, group)| group["disposition"]["default"] == 1)
        .or_else(|| grids().next());
    let (source, first) = match grid {
        Some((n, group)) => {
            let index = &group["streams"][0]["index"];
            let first = videos
                .iter()
                .position(|stream| !index.is_null() && stream["index"] == *index)
                .ok_or(UNREAD)?;
            (Source::Grid(n), first)
        }
        None => {
            let first = videos
                .iter()
                .position(|stream| stream["disposition"]["dependent"] != 1)
                .ok_or(UNREAD)?;
            (Source::Stream(first), first)
        }
    };
    let stream = videos[first];
    let name = |key: &str| stream[key].as_str().map(str::to_owned);
    let transfer = name("color_transfer");
    // By the transfer only: sips-made SDR files carry content light level data too.
    if matches!(transfer.as_deref(), Some("smpte2084" | "arib-std-b67")) {
        return Err(HDR);
    }
    let bits = stream["bits_per_raw_sample"]
        .as_str()
        .and_then(|bits| bits.parse().ok())
        .filter(|&bits: &u32| bits > 0)
        .unwrap_or_else(|| video::bit_depth(stream["pix_fmt"].as_str().unwrap_or("")));
    let profile = stream["side_data_list"].as_array().is_some_and(|list| {
        list.iter()
            .any(|data| data["side_data_type"] == "ICC Profile")
    });
    Ok(Picture {
        source,
        first,
        deep: bits > 8,
        profile,
        primaries: name("color_primaries"),
        transfer,
    })
}

/// ffmpeg's names for colour primaries, as H.273 numbers them.
const PRIMARIES: [(&str, u8); 10] = [
    ("bt709", 1),
    ("bt470m", 4),
    ("bt470bg", 5),
    ("smpte170m", 6),
    ("smpte240m", 7),
    ("film", 8),
    ("bt2020", 9),
    ("smpte428", 10),
    ("smpte431", 11),
    ("smpte432", 12),
];

/// ffmpeg's names for transfer characteristics, as H.273 numbers them (the SDR ones; PQ and HLG are refused).
const TRANSFERS: [(&str, u8); 9] = [
    ("bt709", 1),
    ("gamma22", 4),
    ("gamma28", 5),
    ("smpte170m", 6),
    ("smpte240m", 7),
    ("linear", 8),
    ("iec61966-2-1", 13),
    ("bt2020-10", 14),
    ("bt2020-12", 15),
];

/// sRGB's four numbers: BT.709 primaries, the sRGB curve, RGB, full range.
const SRGB: [u8; 4] = [1, 13, 0, 1];

/// How the answer says its colour (Kevin, Nov 20).
#[derive(Debug, PartialEq)]
enum Tag {
    /// The file's ICC profile, carried as the iCCP chunk of the picture's first stream.
    Profile,
    /// A cICP chunk: primaries, transfer, RGB (0), full range (1).
    Cicp([u8; 4]),
}

/// A profile in the file wins; else the file's own four-number tag; else sRGB. A name that is missing, "unknown",
/// "unspecified" or not in the tables reads as sRGB, for either number.
fn tag_for(picture: &Picture) -> Tag {
    if picture.profile {
        return Tag::Profile;
    }
    let code = |table: &[(&str, u8)], name: &Option<String>| {
        let name = name.as_deref()?;
        table
            .iter()
            .find(|(known, _)| *known == name)
            .map(|&(_, code)| code)
    };
    match (
        code(&PRIMARIES, &picture.primaries),
        code(&TRANSFERS, &picture.transfer),
    ) {
        (Some(primaries), Some(transfer)) => Tag::Cicp([primaries, transfer, 0, 1]),
        _ => Tag::Cicp(SRGB),
    }
}

// ---- PNG --------------------------------------------------------------------------------------------------------------

const SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

/// PNG's CRC-32 table (ISO 3309, polynomial 0xEDB88320), worked out as the file is compiled.
const CRC_TABLE: [u32; 256] = {
    let mut table = [0u32; 256];
    let mut n = 0;
    while n < 256 {
        let mut c = n as u32;
        let mut k = 0;
        while k < 8 {
            c = if c & 1 == 1 {
                0xedb8_8320 ^ (c >> 1)
            } else {
                c >> 1
            };
            k += 1;
        }
        table[n] = c;
        n += 1;
    }
    table
};

/// PNG's CRC-32, over a chunk's type and data.
fn crc32(bytes: &[u8]) -> u32 {
    !bytes.iter().fold(!0u32, |c, &byte| {
        CRC_TABLE[((c ^ u32::from(byte)) & 0xff) as usize] ^ (c >> 8)
    })
}

/// A chunk's bytes: length, type, data and CRC.
fn chunk(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(12 + data.len());
    out.extend((data.len() as u32).to_be_bytes());
    out.extend(kind);
    out.extend(data);
    out.extend(crc32(&out[4..]).to_be_bytes());
    out
}

/// One chunk as it sits in a PNG.
struct Chunk<'a> {
    kind: [u8; 4],
    data: &'a [u8],
    /// Length, type, data and CRC.
    whole: &'a [u8],
}

/// Every chunk of a PNG, in order, each one's CRC checked, through IEND and nothing after it; None for anything else.
/// Every step moves forward and reads only within the bytes.
fn chunks(png: &[u8]) -> Option<Vec<Chunk<'_>>> {
    let mut rest = png.strip_prefix(SIGNATURE.as_slice())?;
    let mut found = Vec::new();
    loop {
        let length = u32::from_be_bytes(rest.get(..4)?.try_into().ok()?);
        // PNG's own bound on a chunk's length.
        if length > 0x7fff_ffff {
            return None;
        }
        let end = (length as usize).checked_add(12)?;
        let whole = rest.get(..end)?;
        let kind: [u8; 4] = whole.get(4..8)?.try_into().ok()?;
        let crc = u32::from_be_bytes(whole.get(end - 4..)?.try_into().ok()?);
        if crc != crc32(whole.get(4..end - 4)?) {
            return None;
        }
        found.push(Chunk {
            kind,
            data: whole.get(8..end - 4)?,
            whole,
        });
        rest = rest.get(end..)?;
        if &kind == b"IEND" {
            return rest.is_empty().then_some(found);
        }
    }
}

/// ffmpeg's PNG with only IHDR, then `tag` (a whole chunk), then its IDAT chunks in order, then IEND: everything else
/// it wrote is dropped. None for a PNG that doesn't read whole, or has no IHDR first or no IDAT.
fn rewrite(png: &[u8], tag: &[u8]) -> Option<Vec<u8>> {
    let found = chunks(png)?;
    let (ihdr, rest) = found.split_first()?;
    if &ihdr.kind != b"IHDR" || ihdr.data.len() != 13 {
        return None;
    }
    let idat: Vec<&Chunk> = rest.iter().filter(|c| &c.kind == b"IDAT").collect();
    let iend = rest.last()?;
    if idat.is_empty() {
        return None;
    }
    let mut out = SIGNATURE.to_vec();
    out.extend(ihdr.whole);
    out.extend(tag);
    for chunk in idat {
        out.extend(chunk.whole);
    }
    out.extend(iend.whole);
    Some(out)
}

/// The iCCP chunk, whole and as it is, of the tiny PNG of the picture's first stream. None there when ffprobe named a
/// profile: unreadable, never guessed. Over 64 KiB as stored: refused, never shown in the wrong colour.
fn profile_chunk(png: &[u8]) -> Result<Vec<u8>, &'static str> {
    let found = chunks(png).ok_or(UNREAD)?;
    let iccp = found.iter().find(|c| &c.kind == b"iCCP").ok_or(UNREAD)?;
    if iccp.data.len() > MAX_PROFILE_BYTES {
        return Err(PROFILE_TOO_BIG);
    }
    Ok(iccp.whole.to_vec())
}

// ---- The sidecars -----------------------------------------------------------------------------------------------------

/// ffprobe's streams and stream groups, as compact JSON. The path is one argument of the list, and only local files
/// may be opened.
fn probe_command(file: &Path) -> Command {
    let mut command = video::command("ffprobe");
    command
        .args(["-v", "error", "-protocol_whitelist", "file"])
        .args([
            "-print_format",
            "json=compact=1",
            "-show_streams",
            "-show_stream_groups",
            "-i",
        ])
        .arg(file);
    command
}

/// The picture through `scale`, fitted inside 2560 × 2560, its shape kept, never up, as one PNG on stdout. The size is
/// never worked out here: ffmpeg applies a recorded turn itself, and the PNG's IHDR says what came out. No colour
/// conversion. The filter is one argument, never through a shell, so its quotes reach ffmpeg's own parser as they are.
fn decode_command(file: &Path, picture: &Picture) -> Command {
    let input = match picture.source {
        Source::Grid(n) => format!("[0:g:{n}]"),
        Source::Stream(m) => format!("[0:v:{m}]"),
    };
    let filter = format!(
        "{input}scale=w='min({LONG_EDGE},iw)':h='min({LONG_EDGE},ih)':force_original_aspect_ratio=decrease:flags=lanczos[o]"
    );
    let pixels = if picture.deep { "rgb48be" } else { "rgb24" };
    let mut command = video::command("ffmpeg");
    command
        .args([
            "-hide_banner",
            "-v",
            "error",
            "-protocol_whitelist",
            "file",
            "-i",
        ])
        .arg(file)
        .args(["-filter_complex", &filter, "-map", "[o]", "-frames:v", "1"])
        .args(["-c:v", "png", "-pix_fmt", pixels, "-f", "image2pipe", "-"]);
    command
}

/// A 16 × 16 PNG of the picture's first stream alone, which carries the file's ICC profile as its iCCP chunk.
fn profile_command(file: &Path, picture: &Picture) -> Command {
    let mut command = video::command("ffmpeg");
    command
        .args([
            "-hide_banner",
            "-v",
            "error",
            "-protocol_whitelist",
            "file",
            "-i",
        ])
        .arg(file)
        .args(["-map", &format!("0:v:{}", picture.first), "-frames:v", "1"])
        .args([
            "-vf",
            "scale=16:16",
            "-c:v",
            "png",
            "-pix_fmt",
            "rgb24",
            "-f",
            "image2pipe",
            "-",
        ]);
    command
}

/// One sidecar run in what's left of the call's time, through video.rs's runner (its error output never read): what
/// it wrote, at most `cap` bytes. Killed at the deadline, it removes `file` once it has ended.
fn run(
    command: Command,
    deadline: Instant,
    file: &Path,
    cap: usize,
) -> Result<Vec<u8>, &'static str> {
    let left = deadline.saturating_duration_since(Instant::now());
    match video::run_stoppable(command, left, false, None, Some(file)) {
        Ok((status, out, _)) if status.success() && !out.is_empty() && out.len() <= cap => Ok(out),
        Ok(_) => Err(UNREAD),
        Err(said) if said == video::TOO_SLOW => Err(TOO_SLOW),
        Err(_) => Err(UNREAD),
    }
}

/// The PNG for a HEIC already checked by `refuse`, within `limit` from now: the file written, probed, its profile
/// fetched when it has one, decoded and rewritten. `decode` makes the decode's command (a test stands in for it).
fn decode_within(
    bytes: &[u8],
    folder: &Path,
    limit: Duration,
    decode: &dyn Fn(&Path, &Picture) -> Command,
) -> Result<Vec<u8>, &'static str> {
    let deadline = Instant::now() + limit;
    let temp = TempPicture::write(folder, bytes)?;
    let said = run(probe_command(&temp.path), deadline, &temp.path, MAX_PROBE)?;
    let json: Value = serde_json::from_slice(&said).map_err(|_| UNREAD)?;
    let picture = read_picture(&json)?;
    // The profile first: a photo refused for it never waits for its decode.
    let tag = match tag_for(&picture) {
        Tag::Profile => profile_chunk(&run(
            profile_command(&temp.path, &picture),
            deadline,
            &temp.path,
            MAX_OUTPUT,
        )?)?,
        Tag::Cicp(numbers) => chunk(b"cICP", &numbers),
    };
    let png = run(
        decode(&temp.path, &picture),
        deadline,
        &temp.path,
        MAX_OUTPUT,
    )?;
    rewrite(&png, &tag).ok_or(UNREAD)
}

/// A HEIC's bytes as a tagged PNG, its temp file in `folder`: refused before anything runs when too large or not a
/// HEIF, then decoded once it has its turn, within 10 s of it.
fn picture(bytes: &[u8], folder: &Path) -> Result<Vec<u8>, &'static str> {
    refuse(bytes)?;
    let _turn = GATE.enter();
    decode_within(bytes, folder, LIMIT, &decode_command)
}

/// Asked by the page with a HEIC's bytes as the raw request body, as `photo_exif` takes its own; answers the PNG's
/// bytes, which the page reads as an ArrayBuffer. On the Mac, always the page's HEIC line.
#[tauri::command]
pub async fn heic_picture<R: Runtime>(
    app: AppHandle<R>,
    request: tauri::ipc::Request<'_>,
) -> Result<Response, String> {
    if let Some(refusal) = refusal_on(std::env::consts::OS) {
        return Err(refusal.into());
    }
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err(NOT_RAW.into());
    };
    refuse(body)?;
    let bytes = body.clone();
    let folder = app.path().app_cache_dir().map_err(|_| UNREAD.to_string())?;
    tauri::async_runtime::spawn_blocking(move || picture(&bytes, &folder))
        .await
        .map_err(|_| UNREAD.to_string())?
        .map(Response::new)
        .map_err(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Barrier};

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sbd-heic-{tag}-{}", crate::lock::random_id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The files left in a folder, waited for up to 10 s to be none (a killed ffmpeg lets go of its file late).
    fn left_after_waiting(dir: &Path) -> Vec<PathBuf> {
        let started = Instant::now();
        loop {
            let left: Vec<PathBuf> = fs::read_dir(dir)
                .map(|entries| entries.filter_map(|e| e.ok().map(|e| e.path())).collect())
                .unwrap_or_default();
            if left.is_empty() || started.elapsed() > Duration::from_secs(10) {
                return left;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    fn testdata(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("testdata")
            .join("heic")
            .join(name)
    }

    fn proof() -> Vec<u8> {
        fs::read(testdata("heic-proof.heic")).unwrap()
    }

    /// The start of a HEIF's file type box with these brands, then filler.
    fn heif_with(brands: &[&[u8; 4]]) -> Vec<u8> {
        let mut bytes = ((16 + 4 * brands.len()) as u32).to_be_bytes().to_vec();
        bytes.extend(b"ftyp");
        bytes.extend(brands[0]);
        bytes.extend([0, 0, 0, 0]);
        for brand in brands {
            bytes.extend(*brand);
        }
        bytes
    }

    // ---- The rule, the refusals ------------------------------------------------------------------------------------

    #[test]
    fn the_mac_answers_its_heic_line_and_every_other_system_decodes() {
        assert_eq!(refusal_on("macos"), Some(ON_THE_MAC));
        assert_eq!(refusal_on("windows"), None);
        assert_eq!(refusal_on("linux"), None);
        // The page's own words, character for character (en.ts `error.heic`, its curly apostrophe included).
        assert!(ON_THE_MAC.contains("can’t"));
    }

    #[test]
    fn refuses_too_large_and_anything_not_a_heif_before_writing_or_running_anything() {
        let dir = temp_dir("refused");
        let mut big = heif_with(&[b"heic", b"mif1"]);
        big.resize(MAX_INPUT + 1, 0);
        assert_eq!(picture(&big, &dir), Err(TOO_BIG));
        let jpeg = [0xff, 0xd8, 0xff, 0xe0, 0, 16, b'J', b'F', b'I', b'F', 0];
        assert_eq!(picture(&jpeg, &dir), Err(NOT_HEIC));
        // An AVIF shares HEIF's container and its mif1 brand: not a HEIC.
        assert_eq!(
            picture(&heif_with(&[b"avif", b"mif1"]), &dir),
            Err(NOT_HEIC)
        );
        assert_eq!(picture(&[0, 0, 0], &dir), Err(NOT_HEIC));
        assert_eq!(picture(&[], &dir), Err(NOT_HEIC));
        assert!(left_after_waiting(&dir).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    // ---- Reading ffprobe -------------------------------------------------------------------------------------------

    /// A video stream as ffprobe writes one, with its own fields over these.
    fn stream(index: u64, dependent: u8, extra: Value) -> Value {
        let mut stream = json!({
            "index": index,
            "codec_type": "video",
            "codec_name": "hevc",
            "width": 512,
            "height": 512,
            "pix_fmt": "yuvj420p",
            "color_range": "pc",
            "color_space": "smpte170m",
            "disposition": { "default": 0, "dependent": dependent },
        });
        if let (Some(stream), Some(extra)) = (stream.as_object_mut(), extra.as_object()) {
            for (key, value) in extra {
                stream.insert(key.clone(), value.clone());
            }
        }
        stream
    }

    fn grid(default: u8, first: u64) -> Value {
        json!({
            "type": "Tile Grid",
            "disposition": { "default": default },
            "components": [{ "width": 1024, "height": 768, "nb_tiles": 2 }],
            "streams": [{ "index": first }, { "index": first + 1 }],
        })
    }

    fn icc() -> Value {
        json!({ "side_data_list": [{ "side_data_type": "ICC Profile" }] })
    }

    #[test]
    fn takes_the_default_tile_grid_else_the_first_else_the_first_stream_that_isnt_a_tile() {
        // Two grids, the second marked default; an audio stream before the video ones doesn't count among them.
        let json = json!({
            "streams": [
                { "index": 0, "codec_type": "audio" },
                stream(1, 1, json!({})), stream(2, 1, json!({})),
                stream(3, 1, icc()), stream(4, 1, icc()),
            ],
            "stream_groups": [{ "type": "Slideshow" }, grid(0, 1), grid(1, 3)],
        });
        let picture = read_picture(&json).unwrap();
        assert_eq!(picture.source, Source::Grid(2));
        assert_eq!(picture.first, 2, "stream 3 is the third video stream");
        assert!(
            picture.profile,
            "read from the default grid's own first stream"
        );
        // None marked default: the first grid.
        let json = json!({
            "streams": [stream(0, 1, json!({})), stream(1, 1, json!({})), stream(2, 1, icc()), stream(3, 1, icc())],
            "stream_groups": [grid(0, 0), grid(0, 2)],
        });
        let picture = read_picture(&json).unwrap();
        assert_eq!(
            (picture.source, picture.first, picture.profile),
            (Source::Grid(0), 0, false)
        );
        // No grid: the first video stream not marked dependent, a tile skipped.
        let json = json!({
            "streams": [stream(0, 1, json!({})), stream(1, 0, json!({ "width": 4032, "height": 3024 }))],
        });
        let picture = read_picture(&json).unwrap();
        assert_eq!((picture.source, picture.first), (Source::Stream(1), 1));
        // Nothing to read: no stream at all, only tiles with no grid, a grid whose stream isn't listed.
        assert_eq!(read_picture(&json!({})), Err(UNREAD));
        assert_eq!(
            read_picture(&json!({ "streams": [stream(0, 1, json!({}))] })),
            Err(UNREAD)
        );
        assert_eq!(
            read_picture(
                &json!({ "streams": [stream(0, 1, json!({}))], "stream_groups": [grid(1, 7)] })
            ),
            Err(UNREAD)
        );
    }

    #[test]
    fn reads_8_bits_as_rgb24_and_more_as_a_16_bit_png() {
        let one =
            |extra: Value| read_picture(&json!({ "streams": [stream(0, 0, extra)] })).unwrap();
        assert!(!one(json!({})).deep);
        assert!(!one(json!({ "bits_per_raw_sample": "8" })).deep);
        assert!(one(json!({ "pix_fmt": "yuv420p10le" })).deep);
        assert!(one(json!({ "pix_fmt": "yuv422p10le" })).deep);
        assert!(one(json!({ "bits_per_raw_sample": "10" })).deep);
        let file = Path::new("photo.heic");
        let args = |picture: &Picture| -> Vec<String> {
            decode_command(file, picture)
                .get_args()
                .map(|a| a.to_string_lossy().into_owned())
                .collect()
        };
        let deep = args(&one(json!({ "pix_fmt": "yuv420p10le" })));
        assert!(deep.windows(2).any(|w| w == ["-pix_fmt", "rgb48be"]));
        let shallow = args(&one(json!({})));
        assert!(shallow.windows(2).any(|w| w == ["-pix_fmt", "rgb24"]));
        // The picture through scale, fitted inside 2560, never up, and one PNG on stdout; local files only.
        assert!(shallow.windows(2).any(|w| w
            == [
                "-filter_complex",
                "[0:v:0]scale=w='min(2560,iw)':h='min(2560,ih)':force_original_aspect_ratio=decrease:flags=lanczos[o]"
            ]));
        assert!(shallow
            .windows(2)
            .any(|w| w == ["-protocol_whitelist", "file"]));
        assert_eq!(shallow.first().map(String::as_str), Some("-nostdin"));
        assert!(shallow.ends_with(&["-f".into(), "image2pipe".into(), "-".into()]));
        let mut grid = one(json!({}));
        grid.source = Source::Grid(3);
        assert!(args(&grid).iter().any(|a| a.starts_with("[0:g:3]scale=")));
    }

    #[test]
    fn refuses_an_hdr_photo_by_its_transfer_alone() {
        for transfer in ["smpte2084", "arib-std-b67"] {
            let json = json!({ "streams": [stream(0, 0, json!({ "color_transfer": transfer, "color_primaries": "bt2020" }))] });
            assert_eq!(read_picture(&json), Err(HDR), "{transfer}");
        }
        // Content light level data on an SDR file isn't HDR.
        let json = json!({ "streams": [stream(0, 0, json!({
            "color_transfer": "iec61966-2-1",
            "side_data_list": [{ "side_data_type": "Content light level metadata" }],
        }))] });
        assert!(read_picture(&json).is_ok());
    }

    // ---- The colour tag --------------------------------------------------------------------------------------------

    fn picture_with(primaries: Option<&str>, transfer: Option<&str>, profile: bool) -> Picture {
        Picture {
            source: Source::Stream(0),
            first: 0,
            deep: false,
            profile,
            primaries: primaries.map(str::to_owned),
            transfer: transfer.map(str::to_owned),
        }
    }

    #[test]
    fn a_profile_wins_else_the_four_numbers_else_srgb() {
        assert_eq!(
            tag_for(&picture_with(Some("smpte432"), Some("iec61966-2-1"), true)),
            Tag::Profile
        );
        assert_eq!(tag_for(&picture_with(None, None, true)), Tag::Profile);
        // An iPhone's: Display P3.
        assert_eq!(
            tag_for(&picture_with(Some("smpte432"), Some("iec61966-2-1"), false)),
            Tag::Cicp([12, 13, 0, 1])
        );
        assert_eq!(
            tag_for(&picture_with(Some("bt709"), Some("bt709"), false)),
            Tag::Cicp([1, 1, 0, 1])
        );
        assert_eq!(
            tag_for(&picture_with(Some("bt2020"), Some("bt2020-10"), false)),
            Tag::Cicp([9, 14, 0, 1])
        );
        for (primaries, transfer) in [
            (None, None),
            (Some("smpte432"), None),
            (None, Some("iec61966-2-1")),
            (Some("unknown"), Some("iec61966-2-1")),
            (Some("smpte432"), Some("unspecified")),
            (Some("jedec-p22"), Some("iec61966-2-1")),
            (Some("bt709"), Some("log100")),
        ] {
            assert_eq!(
                tag_for(&picture_with(primaries, transfer, false)),
                Tag::Cicp(SRGB),
                "{primaries:?} {transfer:?}"
            );
        }
        // Read from ffprobe's names on the picture's stream.
        let json = json!({ "streams": [stream(0, 0, json!({ "color_primaries": "smpte432", "color_transfer": "iec61966-2-1" }))] });
        assert_eq!(
            tag_for(&read_picture(&json).unwrap()),
            Tag::Cicp([12, 13, 0, 1])
        );
    }

    // ---- The PNG ---------------------------------------------------------------------------------------------------

    fn ihdr() -> Vec<u8> {
        let mut data = 64u32.to_be_bytes().to_vec();
        data.extend(48u32.to_be_bytes());
        data.extend([8, 2, 0, 0, 0]);
        chunk(b"IHDR", &data)
    }

    fn png(parts: &[Vec<u8>]) -> Vec<u8> {
        let mut out = SIGNATURE.to_vec();
        for part in parts {
            out.extend(part);
        }
        out
    }

    fn kinds(png: &[u8]) -> Vec<String> {
        chunks(png)
            .expect("reads whole, every CRC right")
            .iter()
            .map(|c| String::from_utf8_lossy(&c.kind).into_owned())
            .collect()
    }

    #[test]
    fn the_crc_is_pngs() {
        // IEND's CRC, as every PNG ends.
        assert_eq!(crc32(b"IEND"), 0xae42_6082);
        assert_eq!(
            chunk(b"IEND", &[]),
            [0, 0, 0, 0, b'I', b'E', b'N', b'D', 0xae, 0x42, 0x60, 0x82]
        );
        assert_eq!(crc32(b"123456789"), 0xcbf4_3926);
    }

    #[test]
    fn keeps_only_ihdr_the_tag_the_idat_chunks_in_order_and_iend() {
        let input = png(&[
            ihdr(),
            chunk(b"pHYs", &[0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1]),
            chunk(b"iCCP", b"ffmpeg\0\0x"),
            chunk(b"tEXt", b"Comment\0made somewhere"),
            chunk(b"IDAT", b"first"),
            chunk(b"IDAT", b"second"),
            chunk(b"IDAT", b"third"),
            chunk(b"eXIf", b"MM\0*"),
            chunk(b"IEND", &[]),
        ]);
        let tag = chunk(b"cICP", &[12, 13, 0, 1]);
        let out = rewrite(&input, &tag).unwrap();
        assert_eq!(
            kinds(&out),
            ["IHDR", "cICP", "IDAT", "IDAT", "IDAT", "IEND"]
        );
        let found = chunks(&out).unwrap();
        assert_eq!(found[1].data, [12, 13, 0, 1]);
        let idat: Vec<&[u8]> = found
            .iter()
            .filter(|c| &c.kind == b"IDAT")
            .map(|c| c.data)
            .collect();
        assert_eq!(idat, [b"first".as_slice(), b"second", b"third"]);
        // An iCCP as the tag, whole as it came.
        let profile = chunk(b"iCCP", b"Display P3\0\0xyz");
        let out = rewrite(&input, &profile).unwrap();
        assert_eq!(
            kinds(&out),
            ["IHDR", "iCCP", "IDAT", "IDAT", "IDAT", "IEND"]
        );
        assert_eq!(chunks(&out).unwrap()[1].whole, profile.as_slice());
    }

    #[test]
    fn refuses_a_damaged_png_and_never_panics() {
        let tag = chunk(b"cICP", &SRGB);
        let good = png(&[ihdr(), chunk(b"IDAT", b"pixels"), chunk(b"IEND", &[])]);
        assert!(rewrite(&good, &tag).is_some());
        // Cut short anywhere.
        for end in 0..good.len() {
            assert!(rewrite(&good[..end], &tag).is_none(), "cut at {end}");
        }
        // A length past the end, and one over PNG's bound.
        for length in [0xffff_ffffu32, 0x8000_0000, 1000] {
            let mut bad = good.clone();
            bad[33..37].copy_from_slice(&length.to_be_bytes());
            assert!(rewrite(&bad, &tag).is_none(), "{length:#x}");
        }
        // A wrong CRC.
        let mut bad = good.clone();
        let last = bad.len() - 13;
        bad[last] ^= 1;
        assert!(rewrite(&bad, &tag).is_none());
        // No signature, bytes after IEND, no IHDR first, a short IHDR, no IDAT.
        assert!(rewrite(&good[8..], &tag).is_none());
        assert!(rewrite(&[good.clone(), vec![0]].concat(), &tag).is_none());
        assert!(rewrite(
            &png(&[chunk(b"IDAT", b"pixels"), ihdr(), chunk(b"IEND", &[])]),
            &tag
        )
        .is_none());
        assert!(rewrite(
            &png(&[
                chunk(b"IHDR", &[0; 12]),
                chunk(b"IDAT", b"p"),
                chunk(b"IEND", &[])
            ]),
            &tag
        )
        .is_none());
        assert!(rewrite(&png(&[ihdr(), chunk(b"IEND", &[])]), &tag).is_none());
        assert!(rewrite(&[], &tag).is_none());
    }

    #[test]
    fn a_profile_over_64_kib_as_stored_is_refused_with_its_words() {
        let with_profile = |data: usize| {
            let mut body = b"P3\0\0".to_vec();
            body.resize(data, 0x78);
            png(&[
                ihdr(),
                chunk(b"iCCP", &body),
                chunk(b"IDAT", b"p"),
                chunk(b"IEND", &[]),
            ])
        };
        let kept = profile_chunk(&with_profile(MAX_PROFILE_BYTES)).unwrap();
        assert_eq!(kept.len(), MAX_PROFILE_BYTES + 12);
        assert_eq!(
            profile_chunk(&with_profile(MAX_PROFILE_BYTES + 1)),
            Err(PROFILE_TOO_BIG)
        );
        // ffprobe named a profile but the PNG has none, or doesn't read: unreadable, never guessed.
        let none = png(&[ihdr(), chunk(b"IDAT", b"p"), chunk(b"IEND", &[])]);
        assert_eq!(profile_chunk(&none), Err(UNREAD));
        assert_eq!(profile_chunk(b"not a png"), Err(UNREAD));
    }

    // ---- The fixture, for real (the sidecars, found as the stills' tests find them) --------------------------------

    /// A PNG's pixels as 8-bit RGB, read back by the sidecar (no colour conversion on the way).
    fn pixels(dir: &Path, name: &str, png: &[u8]) -> Vec<u8> {
        let file = dir.join(name);
        fs::write(&file, png).unwrap();
        let out = video::command("ffmpeg")
            .args(["-hide_banner", "-v", "error", "-i"])
            .arg(&file)
            .args(["-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
            .output()
            .unwrap();
        assert!(out.status.success());
        out.stdout
    }

    fn size(png: &[u8]) -> (u32, u32) {
        let found = chunks(png).unwrap();
        let ihdr = found[0].data;
        (
            u32::from_be_bytes(ihdr[0..4].try_into().unwrap()),
            u32::from_be_bytes(ihdr[4..8].try_into().unwrap()),
        )
    }

    fn tag_of(png: &[u8]) -> Vec<u8> {
        chunks(png).unwrap()[1].whole.to_vec()
    }

    #[test]
    fn the_proof_picture_comes_out_fitted_tagged_with_its_profile_and_unclipped() {
        let dir = temp_dir("proof");
        let answer = picture(&proof(), &dir.join("cache")).unwrap();
        assert_eq!(size(&answer), (1024, 768));
        let found = kinds(&answer);
        assert_eq!(found.first().map(String::as_str), Some("IHDR"));
        assert_eq!(found[1], "iCCP");
        assert_eq!(found.last().map(String::as_str), Some("IEND"));
        assert!(
            found[2..found.len() - 1].iter().all(|kind| kind == "IDAT"),
            "{found:?}"
        );
        // The profile is the one a PNG of the first stream alone carries, byte for byte.
        let heic = dir.join("one-stream.heic");
        fs::write(&heic, proof()).unwrap();
        let one = video::command("ffmpeg")
            .args(["-hide_banner", "-v", "error", "-i"])
            .arg(&heic)
            .args([
                "-map",
                "0:v:0",
                "-frames:v",
                "1",
                "-vf",
                "scale=16:16",
                "-c:v",
                "png",
                "-f",
                "image2pipe",
                "-",
            ])
            .output()
            .unwrap();
        assert!(one.status.success());
        let theirs = chunks(&one.stdout).unwrap();
        let theirs = theirs.iter().find(|c| &c.kind == b"iCCP").unwrap();
        assert_eq!(chunks(&answer).unwrap()[1].data, theirs.data);
        // Every patch as drawn, within 3 levels: P3's pure colours unclipped.
        let rgb = pixels(&dir, "answer.png", &answer);
        assert_eq!(rgb.len(), 1024 * 768 * 3);
        let regions: Value =
            serde_json::from_slice(&fs::read(testdata("heic-proof-regions.json")).unwrap())
                .unwrap();
        let regions = regions["regions"].as_array().unwrap();
        assert!(regions.len() >= 6);
        for region in regions {
            let at = |key: &str| region[key].as_u64().unwrap() as usize;
            let (x, y, w, h) = (at("x"), at("y"), at("w"), at("h"));
            let mut sums = [0f64; 3];
            for row in y..y + h {
                for column in x..x + w {
                    for (channel, sum) in sums.iter_mut().enumerate() {
                        *sum += f64::from(rgb[(row * 1024 + column) * 3 + channel]);
                    }
                }
            }
            for (channel, sum) in sums.iter().enumerate() {
                let mean = sum / (w * h) as f64;
                let drawn = region["drawn"][channel].as_f64().unwrap();
                assert!(
                    (mean - drawn).abs() <= 3.0,
                    "{} channel {channel}: {mean:.1}, drawn {drawn}",
                    region["name"]
                );
            }
        }
        assert!(
            left_after_waiting(&dir.join("cache")).is_empty(),
            "the temp file is gone"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// heic-proof.from-rust.png, for part 2's end-to-end test, stays what heic_picture gives: its pixels and its tag
    /// chunk (never the file's bytes, whose zlib differs between systems). With `SBD_HEIC_WRITE_FROM_RUST=1` the test
    /// writes it first.
    #[test]
    fn the_committed_answer_stays_in_step() {
        let dir = temp_dir("in-step");
        let answer = picture(&proof(), &dir.join("cache")).unwrap();
        let committed = testdata("heic-proof.from-rust.png");
        if std::env::var_os("SBD_HEIC_WRITE_FROM_RUST").is_some_and(|v| v == "1") {
            fs::write(&committed, &answer).unwrap();
        }
        let committed = fs::read(&committed).unwrap();
        // The same chunks before the pixels (IHDR, the tag), and the same picture after.
        assert_eq!(kinds(&committed)[..2], kinds(&answer)[..2]);
        assert_eq!(kinds(&committed).last().map(String::as_str), Some("IEND"));
        assert_eq!(size(&committed), size(&answer));
        assert_eq!(tag_of(&committed), tag_of(&answer));
        assert!(
            pixels(&dir, "committed.png", &committed) == pixels(&dir, "answer.png", &answer),
            "the committed PNG's pixels are today's answer's"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn gives_up_at_the_limit_with_its_words_and_leaves_no_file() {
        let dir = temp_dir("slow");
        // A decode that would run for a minute, with the photo open as one of its inputs.
        let stand_in = |file: &Path, _: &Picture| {
            let mut command = video::command("ffmpeg");
            command
                .args(["-hide_banner", "-v", "error", "-re", "-f", "lavfi"])
                .args(["-i", "color=c=black:size=64x36:rate=25:duration=60"])
                .args(["-protocol_whitelist", "file", "-i"])
                .arg(file)
                .args(["-map", "0:v", "-f", "null", "-"]);
            command
        };
        let started = Instant::now();
        assert_eq!(
            decode_within(&proof(), &dir, Duration::from_secs(2), &stand_in),
            Err(TOO_SLOW)
        );
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "{:?}",
            started.elapsed()
        );
        assert!(left_after_waiting(&dir).is_empty(), "the temp file is gone");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn leaves_no_file_after_a_photo_it_cant_read() {
        let dir = temp_dir("unread");
        // A HEIF's first box, then nothing a reader can use.
        let mut junk = heif_with(&[b"heic", b"mif1"]);
        junk.extend([0x5a; 4096]);
        assert_eq!(picture(&junk, &dir), Err(UNREAD));
        assert!(left_after_waiting(&dir).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn lets_no_more_than_two_in_at_once() {
        let gate = Arc::new(Gate::new(2));
        let inside = Arc::new(AtomicUsize::new(0));
        let most = Arc::new(AtomicUsize::new(0));
        let start = Arc::new(Barrier::new(3));
        let calls: Vec<_> = (0..3)
            .map(|_| {
                let (gate, inside, most, start) =
                    (gate.clone(), inside.clone(), most.clone(), start.clone());
                std::thread::spawn(move || {
                    start.wait();
                    let _turn = gate.enter();
                    let now = inside.fetch_add(1, Ordering::SeqCst) + 1;
                    most.fetch_max(now, Ordering::SeqCst);
                    std::thread::sleep(Duration::from_millis(200));
                    inside.fetch_sub(1, Ordering::SeqCst);
                })
            })
            .collect();
        for call in calls {
            call.join().unwrap();
        }
        assert_eq!(
            most.load(Ordering::SeqCst),
            2,
            "two in at once, never three"
        );
        assert_eq!(*gate.inside.lock().unwrap(), 0, "every turn given back");
    }
}
