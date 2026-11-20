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
//! folder, under a random name, made new, and gone after every outcome. ffprobe's answer is read for the pixels before
//! ffmpeg is asked anything else: over 120 MP, or a grid's tiles or canvas far more than the picture, is refused (Kevin,
//! Nov 20: a few kilobytes can describe gigabytes once decoded), a grid's placed tiles must all declare one size, and
//! no decoder may make a frame larger than that size with its sides rounded up to 64 (`max_pixels`, as ffmpeg counts
//! it). At most two photos decode at a time (a 48 MP
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
/// Kevin, Nov 20: a few kilobytes of HEIC can describe gigabytes of pixels, so the size is read before any decode.
const TOO_MANY_PIXELS: &str =
    "This HEIC photo is too large to read (over 120 megapixels). Convert it to JPEG first.";
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
/// The most pixels a picture may have to be decoded (Kevin, Nov 20): a 102 MP camera frame passes.
const MAX_PIXELS: u64 = 120_000_000;
/// What a grid's tiles may add up to beyond twice the picture's own pixels. Tiles overhang the picture by less than one
/// tile per row and per column, so real files sit between 1.0 and about 1.5 times (a 102 MP 11648 × 8736 frame in
/// 4096 px tiles: 1.48); twice leaves room for a layout nobody has shown us, and this keeps a tiny picture in one
/// 512 px tile from being refused.
const TILE_ALLOWANCE: u64 = 1_000_000;

/// What a system answers instead of decoding: the Mac its HEIC line, every other system nothing (it decodes). A
/// function of the system's name, so a test reads both answers on any system.
fn refusal_on(os: &str) -> Option<&'static str> {
    (os == "macos").then_some(ON_THE_MAC)
}

/// The cheap refusals, before anything is written or run: too large, or not a HEIF. The grid's own boxes are read
/// later, once, in the blocking part (`grid_check` in `decode_within`).
fn refuse(bytes: &[u8]) -> Result<(), &'static str> {
    if bytes.len() > MAX_INPUT {
        return Err(TOO_BIG);
    }
    if !crate::exif::is_heif(bytes) {
        return Err(NOT_HEIC);
    }
    Ok(())
}

// ---- The HEIF's own boxes (ISO/IEC 14496-12 and 23008-12) -----------------------------------------------------------
//
// ffprobe reports the colour of a grid's tiles but has no section for the grid item's own properties, so a colour the
// grid alone describes would go unseen. This reads the boxes for that one question: the primary item, its tiles
// (`dimg`), and the `colr` properties of the primary item and its first tile. It reads a person's file: every length
// is checked before a slice, nothing panics, no list is followed past `MAX_ENTRIES`, and a file whose boxes can't be
// followed adds no refusal and no numbers (ffmpeg stays the judge of whether it decodes). What it finds is either a
// refusal or the grid's own four numbers for the tag (`grid_check`).

/// The most entries of any list followed: boxes in a container, references, associations, `ipma` entries.
const MAX_ENTRIES: usize = 4096;
/// H.273's PQ and HLG transfers.
const HDR_TRANSFERS: [u16; 2] = [16, 18];

/// The boxes one after another in `bytes`, each as its type and its body. A size of 0 runs to the end, 1 means a
/// 64-bit size follows; a size smaller than its header, or past the end, ends the list (`broken` says so).
struct Boxes<'a> {
    rest: &'a [u8],
    seen: usize,
    broken: bool,
}

fn boxes(bytes: &[u8]) -> Boxes<'_> {
    Boxes {
        rest: bytes,
        seen: 0,
        broken: false,
    }
}

impl<'a> Iterator for Boxes<'a> {
    type Item = ([u8; 4], &'a [u8]);

    fn next(&mut self) -> Option<Self::Item> {
        if self.rest.is_empty() {
            return None;
        }
        let found = if self.seen < MAX_ENTRIES {
            split_box(self.rest)
        } else {
            None
        };
        match found {
            Some((kind, body, rest)) => {
                self.seen += 1;
                self.rest = rest;
                Some((kind, body))
            }
            None => {
                self.broken = true;
                self.rest = &[];
                None
            }
        }
    }
}

/// The first box of `bytes`: its type, its body and what follows it.
fn split_box(bytes: &[u8]) -> Option<([u8; 4], &[u8], &[u8])> {
    let size = u64::from(be_u32(bytes, 0)?);
    let kind: [u8; 4] = bytes.get(4..8)?.try_into().ok()?;
    let (head, size) = match size {
        0 => (8, bytes.len() as u64),
        1 => (16, be_u64(bytes, 8)?),
        size => (8, size),
    };
    if size < head as u64 {
        return None;
    }
    let size = usize::try_from(size).ok()?;
    Some((kind, bytes.get(head..size)?, bytes.get(size..)?))
}

fn be_u16(bytes: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes(
        bytes.get(at..at.checked_add(2)?)?.try_into().ok()?,
    ))
}

fn be_u32(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(
        bytes.get(at..at.checked_add(4)?)?.try_into().ok()?,
    ))
}

fn be_u64(bytes: &[u8], at: usize) -> Option<u64> {
    Some(u64::from_be_bytes(
        bytes.get(at..at.checked_add(8)?)?.try_into().ok()?,
    ))
}

/// A full box's version, flags and the rest of its body.
fn full_box(body: &[u8]) -> Option<(u8, u32, &[u8])> {
    let version = *body.first()?;
    let flags = be_u32(body, 0)? & 0x00ff_ffff;
    Some((version, flags, body.get(4..)?))
}

/// Every box of a list, or None when the list can't be followed to its end.
fn all_boxes(bytes: &[u8]) -> Option<Vec<([u8; 4], &[u8])>> {
    let mut list = boxes(bytes);
    let found: Vec<_> = list.by_ref().collect();
    (!list.broken).then_some(found)
}

/// An item id of 16 bits (version 0) or 32 (version 1) at `at`, and where the next field starts.
fn item_id(bytes: &[u8], at: usize, version: u8) -> Option<(u32, usize)> {
    match version {
        0 => Some((u32::from(be_u16(bytes, at)?), at + 2)),
        1 => Some((be_u32(bytes, at)?, at + 4)),
        _ => None,
    }
}

/// What an item's `colr` properties say: an ICC profile (`prof` or `rICC`), the first `nclx`'s primaries and transfer
/// (H.273 numbers), and whether any `nclx` names an HDR transfer.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct ItemColour {
    icc: bool,
    nclx: Option<(u16, u16)>,
    hdr: bool,
}

impl ItemColour {
    fn with(self, other: Self) -> Self {
        Self {
            icc: self.icc || other.icc,
            nclx: self.nclx.or(other.nclx),
            hdr: self.hdr || other.hdr,
        }
    }
}

/// A `colr` property's body: None when it can't be read.
fn colr(body: &[u8]) -> Option<ItemColour> {
    match body.get(..4)? {
        b"prof" | b"rICC" => Some(ItemColour {
            icc: true,
            ..ItemColour::default()
        }),
        b"nclx" => {
            // Primaries, transfer and matrix as 16-bit numbers, then the byte whose top bit is the range.
            body.get(10)?;
            let (primaries, transfer) = (be_u16(body, 4)?, be_u16(body, 6)?);
            Some(ItemColour {
                nclx: Some((primaries, transfer)),
                hdr: HDR_TRANSFERS.contains(&transfer),
                ..ItemColour::default()
            })
        }
        // Another colour type says nothing either way.
        _ => Some(ItemColour::default()),
    }
}

/// The primary item's colour and its first tile's, when the primary item has tiles; None for a single picture or a
/// file whose boxes can't be followed. Only the boxes needed are walked: the top level until `meta`, and `meta`'s
/// children until `pitm`, `iref` and `iprp` are found, so a broken box after them (stray bytes after `mdat`) changes
/// nothing, while one before them ends the walk.
fn grid_colours(bytes: &[u8]) -> Option<(ItemColour, ItemColour)> {
    let (_, meta) = boxes(bytes).find(|(kind, _)| kind == b"meta")?;
    let (_, _, meta) = full_box(meta)?;
    let (mut pitm, mut iref, mut iprp) = (None, None, None);
    for (kind, body) in boxes(meta) {
        match &kind {
            b"pitm" => pitm = pitm.or(Some(body)),
            b"iref" => iref = iref.or(Some(body)),
            b"iprp" => iprp = iprp.or(Some(body)),
            _ => {}
        }
        if pitm.is_some() && iref.is_some() && iprp.is_some() {
            break;
        }
    }
    // The primary item.
    let (version, _, pitm) = full_box(pitm?)?;
    let (primary, _) = item_id(pitm, 0, version)?;
    // Its first tile: the first to-item of its first `dimg` reference.
    let (version, _, iref) = full_box(iref?)?;
    let mut first_tile = None;
    for (kind, reference) in all_boxes(iref)? {
        if &kind != b"dimg" {
            continue;
        }
        let (from, at) = item_id(reference, 0, version)?;
        let count = usize::from(be_u16(reference, at)?);
        if count > MAX_ENTRIES {
            return None;
        }
        if from == primary && count > 0 {
            first_tile = Some(item_id(reference, at + 2, version)?.0);
            break;
        }
    }
    let first_tile = first_tile?;
    // The properties, counted from 1, and which item has which.
    let iprp = all_boxes(iprp?)?;
    let (_, ipco) = iprp.iter().find(|(kind, _)| kind == b"ipco")?;
    let properties = all_boxes(ipco)?
        .into_iter()
        .map(|(kind, body)| {
            if &kind == b"colr" {
                colr(body)
            } else {
                Some(ItemColour::default())
            }
        })
        .collect::<Option<Vec<_>>>()?;
    let mut colours = [ItemColour::default(); 2];
    for (_, ipma) in iprp.iter().filter(|(kind, _)| kind == b"ipma") {
        let (version, flags, ipma) = full_box(ipma)?;
        let entries = usize::try_from(be_u32(ipma, 0)?).ok()?;
        if entries > MAX_ENTRIES {
            return None;
        }
        let mut at = 4;
        for _ in 0..entries {
            let (item, next) = item_id(ipma, at, version)?;
            let count = usize::from(*ipma.get(next)?);
            at = next + 1;
            for _ in 0..count {
                // The top bit is "essential"; the rest is the property's index, 0 for none.
                let index = if flags & 1 == 1 {
                    let index = usize::from(be_u16(ipma, at)? & 0x7fff);
                    at += 2;
                    index
                } else {
                    let index = usize::from(*ipma.get(at)? & 0x7f);
                    at += 1;
                    index
                };
                let property = match index {
                    0 => ItemColour::default(),
                    index => *properties.get(index - 1)?,
                };
                for (slot, id) in [primary, first_tile].into_iter().enumerate() {
                    if item == id {
                        colours[slot] = colours[slot].with(property);
                    }
                }
            }
        }
    }
    Some((colours[0], colours[1]))
}

/// What a grid's own boxes call for (Kevin, Nov 20: never shown in the wrong colour): refused for an HDR transfer on
/// the grid, whatever its tiles say, and for a profile on the grid its first tile lacks (no PNG of the tile can carry
/// it); else the grid's own primaries and transfer when it has an `nclx`, the picture's own description, which the tag
/// takes over the stream's (except a 0 or 2, which states nothing: `tag_for`). Nothing for a single picture or a file
/// whose boxes can't be followed.
fn grid_check(bytes: &[u8]) -> Result<Option<(u16, u16)>, &'static str> {
    let Some((grid, tile)) = grid_colours(bytes) else {
        return Ok(None);
    };
    if grid.hdr {
        return Err(HDR);
    }
    if grid.icc && !tile.icc {
        return Err(UNREAD);
    }
    Ok(grid.nclx)
}

/// At most `most` callers inside at once; the next waits its turn (std only, no crate).
pub(crate) struct Gate {
    turns: Mutex<Turns>,
    turn: Condvar,
    most: usize,
}

/// Who is inside the gate, and who is waiting at it (so a test can see a call wait without guessing how long).
struct Turns {
    inside: usize,
    waiting: usize,
}

/// A turn inside the gate, given back when it goes.
pub(crate) struct Pass<'a>(&'a Gate);

impl Gate {
    pub(crate) const fn new(most: usize) -> Self {
        Self {
            turns: Mutex::new(Turns {
                inside: 0,
                waiting: 0,
            }),
            turn: Condvar::new(),
            most,
        }
    }

    fn turns(&self) -> std::sync::MutexGuard<'_, Turns> {
        self.turns.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn enter(&self) -> Pass<'_> {
        let mut turns = self.turns();
        turns.waiting += 1;
        while turns.inside >= self.most {
            turns = self
                .turn
                .wait(turns)
                .unwrap_or_else(PoisonError::into_inner);
        }
        turns.waiting -= 1;
        turns.inside += 1;
        Pass(self)
    }
}

impl Drop for Pass<'_> {
    fn drop(&mut self) {
        let mut turns = self.0.turns();
        turns.inside = turns.inside.saturating_sub(1);
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

/// Whether a JSON object's `side_data_list` names an ICC profile.
fn lists_profile(value: &Value) -> bool {
    value["side_data_list"].as_array().is_some_and(|list| {
        list.iter()
            .any(|data| data["side_data_type"] == "ICC Profile")
    })
}

/// A grid's size, from its first component: what decides among several grids when none is marked default.
fn grid_area(group: &Value) -> u64 {
    let component = &group["components"][0];
    component["width"].as_u64().unwrap_or(0) * component["height"].as_u64().unwrap_or(0)
}

/// Reads ffprobe's JSON (`probe_command`'s entries): the picture is the tile grid marked default, else the largest
/// tile grid (the first among equals: a phone's gain map is a grid too), else a video stream marked default and not
/// `dependent` (a tile), else the first not `dependent` (a thumbnail may come first). An HDR transfer is refused, and
/// so is a profile the grid lists but its first stream doesn't carry: never guessed.
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
        .or_else(|| {
            // The largest; `max_by_key` would keep the last among equals.
            grids().fold(
                None,
                |best: Option<(usize, &Value)>, (n, group)| match best {
                    Some((_, kept)) if grid_area(kept) >= grid_area(group) => best,
                    _ => Some((n, group)),
                },
            )
        });
    let (source, first, grid_profile) = match grid {
        Some((n, group)) => {
            let index = &group["streams"][0]["index"];
            let first = videos
                .iter()
                .position(|stream| !index.is_null() && stream["index"] == *index)
                .ok_or(UNREAD)?;
            // A profile on the group, its components or any of its tiles.
            let components = group["components"]
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or_default();
            let tiles = group["streams"]
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or_default();
            // Each tile's side data read where it is shown to be printed: its own entry in the top-level streams.
            let tile_listed = tiles.iter().any(|tile| {
                let index = &tile["index"];
                !index.is_null()
                    && streams
                        .iter()
                        .any(|stream| stream["index"] == *index && lists_profile(stream))
            });
            let listed =
                lists_profile(group) || components.iter().any(lists_profile) || tile_listed;
            (Source::Grid(n), first, listed)
        }
        None => {
            let shown = |stream: &&Value| stream["disposition"]["dependent"] != 1;
            let first = videos
                .iter()
                .position(|stream| shown(stream) && stream["disposition"]["default"] == 1)
                .or_else(|| videos.iter().position(shown))
                .ok_or(UNREAD)?;
            (Source::Stream(first), first, false)
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
    let profile = lists_profile(stream);
    // Listed for the grid but not on the stream whose PNG carries it: refused, never shown in another colour.
    if grid_profile && !profile {
        return Err(UNREAD);
    }
    Ok(Picture {
        source,
        first,
        deep: bits > 8,
        profile,
        primaries: name("color_primaries"),
        transfer,
    })
}

/// A JSON object's width × height: None when either is missing, zero, negative or not a number, or the product
/// overflows.
fn pixels_of(value: &Value) -> Option<u64> {
    let (width, height) = sides_of(value)?;
    width.checked_mul(height)
}

/// A JSON object's width and height: None when either is missing, zero, negative or not a number.
fn sides_of(value: &Value) -> Option<(u64, u64)> {
    let side = |key: &str| value[key].as_u64().filter(|&n| n > 0);
    Some((side("width")?, side("height")?))
}

/// The alignment ffmpeg's `max_pixels` check counts a frame's sides at: it checks the frame's width rounded up to the
/// memory alignment, times its height (with the bundled 8.1.3, a 1000 × 750 PNG is refused under 1024 × 750 pixels).
/// 64 is the largest alignment any ffmpeg build uses, and an HEVC decoder's coded size is the declared size rounded up
/// to its coding block (at most 64), so this bounds both.
const DECODER_ALIGN: u64 = 64;

/// The decode's cap for a frame declared `width` × `height`: each side rounded up to `DECODER_ALIGN`, so an ordinary
/// photo whose width isn't a multiple of 64 still decodes. A crafted frame gains at most 63 columns and 63 rows.
fn decoder_cap(width: u64, height: u64) -> Option<u64> {
    let up = |side: u64| side.checked_next_multiple_of(DECODER_ALIGN);
    up(width)?.checked_mul(up(height)?)
}

/// The pixels ffmpeg would be asked to decode, from ffprobe's answer, before it is asked anything else (Kevin, Nov 20):
/// the picture's own (the chosen grid's size, or its one stream's) over `MAX_PIXELS` is refused, and so are a grid's
/// canvas (its `coded_width` × `coded_height`, which ffmpeg stacks the tiles on before it crops to the picture) and its
/// tiles added up, each over twice the picture's own plus `TILE_ALLOWANCE`, a tile counted once for each place the
/// grid puts it. A place's `stream_index` is a position in the grid's own stream list (FFmpeg's
/// `AVStreamGroupTileGrid.offsets[i].idx`), never a file stream index: the list's entry there names the file stream
/// whose size it is. Only the grid `read_picture` chose is counted: no other grid (a gain map's) is decoded. A size the
/// rule needs that can't be read is unreadable, never passed on to the decode.
///
/// Passed, it gives the decode's cap (`max_pixels`), `decoder_cap` of the frame the file declares for what will be
/// decoded (the chosen grid's tile, or the one stream): every size here is what the container says, so a coded picture
/// larger than its box is refused by the decoder itself. The one cap is given to every tile's decoder, so every placed
/// tile of the grid must declare the same width and height, as HEIF requires of a grid's input images (ISO/IEC
/// 23008-12, image grid): a grid whose tiles differ is unreadable, and the cap is then each tile's own.
fn pixels_within_limit(json: &Value, picture: &Picture) -> Result<u64, &'static str> {
    let streams = json["streams"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let refuse_over = |own: u64| {
        if own > MAX_PIXELS {
            Err(TOO_MANY_PIXELS)
        } else {
            Ok(own)
        }
    };
    match picture.source {
        Source::Stream(m) => {
            let stream = streams
                .iter()
                .filter(|stream| stream["codec_type"] == "video")
                .nth(m)
                .ok_or(UNREAD)?;
            refuse_over(pixels_of(stream).ok_or(UNREAD)?)?;
            let (width, height) = sides_of(stream).ok_or(UNREAD)?;
            decoder_cap(width, height).ok_or(UNREAD)
        }
        Source::Grid(n) => {
            let group = &json["stream_groups"][n];
            let component = &group["components"][0];
            let own = refuse_over(pixels_of(component).ok_or(UNREAD)?)?;
            // `own` is at most 120 MP here, so this can't overflow.
            let allowance = own * 2 + TILE_ALLOWANCE;
            let side = |key: &str| component[key].as_u64().filter(|&n| n > 0);
            let canvas = side("coded_width")
                .zip(side("coded_height"))
                .and_then(|(width, height)| width.checked_mul(height))
                .ok_or(UNREAD)?;
            if canvas > allowance {
                return Err(TOO_MANY_PIXELS);
            }
            // Each stream's index once, so a grid of many tiles costs one pass, not one per tile.
            let by_index: std::collections::HashMap<u64, &Value> = streams
                .iter()
                .filter_map(|stream| Some((stream["index"].as_u64()?, stream)))
                .collect();
            let listed = group["streams"]
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or_default();
            let tiles = component["subcomponents"]
                .as_array()
                .filter(|tiles| !tiles.is_empty())
                .ok_or(UNREAD)?;
            let mut sum = 0u64;
            let mut size: Option<(u64, u64)> = None;
            for tile in tiles {
                let stream = tile["stream_index"]
                    .as_u64()
                    .and_then(|place| listed.get(usize::try_from(place).ok()?))
                    .and_then(|entry| entry["index"].as_u64())
                    .and_then(|index| by_index.get(&index))
                    .ok_or(UNREAD)?;
                let sides = sides_of(stream).ok_or(UNREAD)?;
                // Every placed tile the first one's size, so the one cap is each tile's own.
                if *size.get_or_insert(sides) != sides {
                    return Err(UNREAD);
                }
                let pixels = sides.0.checked_mul(sides.1).ok_or(UNREAD)?;
                sum = sum.checked_add(pixels).ok_or(UNREAD)?;
            }
            if sum > allowance {
                return Err(TOO_MANY_PIXELS);
            }
            // `tiles` isn't empty, so `size` is set.
            let (width, height) = size.ok_or(UNREAD)?;
            decoder_cap(width, height).ok_or(UNREAD)
        }
    }
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

/// H.273's "reserved" (0) and "unspecified" (2): the grid states nothing there.
const UNSTATED: [u16; 2] = [0, 2];

/// A profile carried wins. Else each of the two numbers is taken on its own: the grid's own (`grid`, H.273 numbers
/// from its `nclx`, the picture's own description) when it states one, else the stream's name. A grid's 0 or 2 says
/// nothing (writers put 2 when they don't know), so the file's other word, its stream's, stands for that number. A
/// stated number the tables don't hold, or a name that is missing, "unknown", "unspecified" or not in them, gives
/// none for its place; either place none makes the whole tag sRGB.
fn tag_for(picture: &Picture, grid: Option<(u16, u16)>) -> Tag {
    if picture.profile {
        return Tag::Profile;
    }
    // One place: the grid's stated number through the table, else the stream's name through it.
    let place = |table: &[(&str, u8)], stated: Option<u16>, name: &Option<String>| match stated {
        Some(number) if !UNSTATED.contains(&number) => table
            .iter()
            .find(|&&(_, code)| u16::from(code) == number)
            .map(|&(_, code)| code),
        _ => {
            let name = name.as_deref()?;
            table
                .iter()
                .find(|(known, _)| *known == name)
                .map(|&(_, code)| code)
        }
    };
    match (
        place(&PRIMARIES, grid.map(|g| g.0), &picture.primaries),
        place(&TRANSFERS, grid.map(|g| g.1), &picture.transfer),
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

/// What ffprobe is asked for: exactly the fields `read_picture` reads, by the section names this ffprobe lists
/// (`ffprobe -sections`), and no tags, so a crafted name or comment can't make the answer large before the cap is
/// looked at. Its streams' side data is named the same way inside a group's streams. This ffprobe has no side data
/// section on a group or a component, so a profile there can't be listed by it; the reader still looks there. The
/// streams' size, a grid's canvas (`coded_width`, `coded_height`) and its `subcomponent` entries (one per place a tile
/// goes, its position in the grid's own stream list) are what `pixels_within_limit` counts: one short line per tile, as
/// the streams already print.
const PROBE_ENTRIES: &str =
    "stream=index,codec_type,width,height,pix_fmt,bits_per_raw_sample,color_primaries,color_transfer\
    :stream_disposition=default,dependent:stream_side_data=side_data_type\
    :stream_group=index,type:stream_group_disposition=default:stream_group_stream=index\
    :stream_group_component=width,height,coded_width,coded_height:subcomponent=stream_index";

/// ffprobe's answer about the file, as compact JSON. The path is one argument of the list, and only local files may
/// be opened.
fn probe_command(file: &Path) -> Command {
    let mut command = video::command("ffprobe");
    command
        .args(["-v", "error", "-protocol_whitelist", "file"])
        .args([
            "-print_format",
            "json=compact=1",
            "-show_entries",
            PROBE_ENTRIES,
            "-i",
        ])
        .arg(file);
    command
}

/// The picture through `scale`, fitted inside 2560 × 2560, its shape kept, never up, as one PNG on stdout. The size is
/// never worked out here: ffmpeg applies a recorded turn itself, and the PNG's IHDR says what came out. No colour
/// conversion. The filter is one argument, never through a shell, so its quotes reach ffmpeg's own parser as they are.
/// `max_pixels` caps every frame the input's decoders make (`input_options`).
fn decode_command(file: &Path, picture: &Picture, max_pixels: u64) -> Command {
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
        .args(["-hide_banner", "-v", "error"])
        .args(input_options(max_pixels))
        .arg("-i")
        .arg(file)
        .args(["-filter_complex", &filter, "-map", "[o]", "-frames:v", "1"])
        .args(["-c:v", "png", "-pix_fmt", pixels, "-f", "image2pipe", "-"]);
    command
}

/// The options before `-i`, for the photo's input: local files only, and every frame its decoders make at most
/// `max_pixels` (ffmpeg's codec option, given before `-i` so it is set for that input's decoders, each tile's
/// included). ffmpeg's own default is the largest `int`; what `pixels_within_limit` passes is a declared frame's sides
/// rounded up to 64 (`decoder_cap`), which only a frame of an extreme shape (one row of 120 MP) takes past it.
fn input_options(max_pixels: u64) -> [String; 4] {
    [
        "-protocol_whitelist".into(),
        "file".into(),
        "-max_pixels".into(),
        max_pixels.min(i32::MAX as u64).to_string(),
    ]
}

/// A 16 × 16 PNG of the picture's first stream alone, which carries the file's ICC profile as its iCCP chunk. Its
/// decode is capped as the picture's is: the first stream is one of the frames `max_pixels` was taken from.
fn profile_command(file: &Path, picture: &Picture, max_pixels: u64) -> Command {
    let mut command = video::command("ffmpeg");
    command
        .args(["-hide_banner", "-v", "error"])
        .args(input_options(max_pixels))
        .arg("-i")
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

/// video.rs's runner's words for a sidecar that can't be started (they say to reinstall), kept as they are. The runner
/// writes them inline, so they are matched here by their text; `a_sidecar_that_cant_start_keeps_the_runners_words`
/// fails if the two drift apart.
const READER_MISSING: &str =
    "Storiiboard's video reader couldn't start. Reinstalling Storiiboard puts it back.";

/// One sidecar run in what's left of the call's time, through video.rs's runner (its error output never read): what
/// it wrote, at most `cap` bytes. Killed at the deadline, it removes `file` once it has ended. With no time left, none
/// is started.
fn run(
    command: Command,
    deadline: Instant,
    file: &Path,
    cap: usize,
) -> Result<Vec<u8>, &'static str> {
    let left = deadline.saturating_duration_since(Instant::now());
    if left.is_zero() {
        return Err(TOO_SLOW);
    }
    match video::run_stoppable(command, left, false, None, Some(file)) {
        Ok((status, out, _)) if status.success() && !out.is_empty() && out.len() <= cap => Ok(out),
        Ok(_) => Err(UNREAD),
        Err(said) if said == video::TOO_SLOW => Err(TOO_SLOW),
        Err(said) if said == READER_MISSING => Err(READER_MISSING),
        Err(_) => Err(UNREAD),
    }
}

/// How old a temp file of ours must be to count as left by a crash: a decode lasts seconds.
const LEFT_BEHIND: Duration = Duration::from_secs(10 * 60);

/// A name `TempPicture::write` could have given: `heic-`, 32 lowercase hex characters (`lock::random_id`), `.heic`.
fn is_temp_name(name: &str) -> bool {
    name.strip_prefix("heic-")
        .and_then(|rest| rest.strip_suffix(".heic"))
        .is_some_and(|id| {
            id.len() == 32 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
        })
}

/// Removes our temp files in `folder` older than 10 minutes, left by a crash or a power cut: they are a person's
/// photos, EXIF and all. Only `heic-*.heic`; every error is ignored (the call goes on either way).
fn sweep(folder: &Path) {
    let Ok(entries) = fs::read_dir(folder) else {
        return;
    };
    let now = std::time::SystemTime::now();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let ours = name.to_str().is_some_and(is_temp_name);
        let old = entry
            .metadata()
            .ok()
            .filter(std::fs::Metadata::is_file)
            .and_then(|meta| meta.modified().ok())
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age > LEFT_BEHIND);
        if ours && old {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// The PNG for a HEIC already checked by `refuse`, within `limit` from now: the file written, probed, its profile
/// fetched when it has one, decoded and rewritten. `decode` makes the decode's command from the file, the picture and
/// the largest frame declared (a test stands in for it).
fn decode_within(
    bytes: &[u8],
    folder: &Path,
    limit: Duration,
    decode: &dyn Fn(&Path, &Picture, u64) -> Command,
) -> Result<Vec<u8>, &'static str> {
    let deadline = Instant::now() + limit;
    // The grid's own boxes, once, here off the command's thread; refused before the photo is written anywhere.
    let grid = grid_check(bytes)?;
    sweep(folder);
    let temp = TempPicture::write(folder, bytes)?;
    let said = run(probe_command(&temp.path), deadline, &temp.path, MAX_PROBE)?;
    let json: Value = serde_json::from_slice(&said).map_err(|_| UNREAD)?;
    let picture = read_picture(&json)?;
    // Its pixels, before ffmpeg is asked anything else: a small file can describe gigabytes of them. What passes is the
    // largest frame declared, and no decoder may make a bigger one.
    let max_pixels = pixels_within_limit(&json, &picture)?;
    // The profile first: a photo refused for it never waits for its decode.
    let tag = match tag_for(&picture, grid) {
        Tag::Profile => profile_chunk(&run(
            profile_command(&temp.path, &picture, max_pixels),
            deadline,
            &temp.path,
            MAX_OUTPUT,
        )?)?,
        Tag::Cicp(numbers) => chunk(b"cICP", &numbers),
    };
    let png = run(
        decode(&temp.path, &picture, max_pixels),
        deadline,
        &temp.path,
        MAX_OUTPUT,
    )?;
    rewrite(&png, &tag).ok_or(UNREAD)
}

/// A HEIC's bytes as a tagged PNG, its temp file in `folder`: refused before anything runs when too large or not a
/// HEIF, then decoded once it has its turn, within 10 s of it.
fn picture(bytes: &[u8], folder: &Path) -> Result<Vec<u8>, &'static str> {
    picture_at(&GATE, bytes, folder)
}

/// `picture` through a given gate (the app's is `GATE`; a test brings its own, so it sees the call wait).
fn picture_at(gate: &Gate, bytes: &[u8], folder: &Path) -> Result<Vec<u8>, &'static str> {
    refuse(bytes)?;
    let _turn = gate.enter();
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
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
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
    fn takes_the_default_tile_grid_else_the_largest_else_a_stream_that_isnt_a_tile() {
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

    /// A grid of `width` × `height`, none marked default, its tiles from `first`.
    fn sized_grid(width: u64, height: u64, first: u64) -> Value {
        let mut group = grid(0, first);
        group["components"][0]["width"] = json!(width);
        group["components"][0]["height"] = json!(height);
        group
    }

    #[test]
    fn with_no_default_takes_the_largest_grid_and_a_default_stream_before_the_first() {
        let tiles = json!([
            stream(0, 1, json!({})),
            stream(1, 1, json!({})),
            stream(2, 1, json!({})),
            stream(3, 1, json!({})),
            stream(4, 1, json!({})),
            stream(5, 1, json!({})),
        ]);
        // A small gain map's grid first, then the picture's: the largest wins.
        let json = json!({ "streams": tiles, "stream_groups": [sized_grid(512, 384, 0), sized_grid(4032, 3024, 2)] });
        assert_eq!(read_picture(&json).unwrap().source, Source::Grid(1));
        assert_eq!(read_picture(&json).unwrap().first, 2);
        // Two of the same size: the first among equals.
        let json = json!({ "streams": tiles, "stream_groups": [
            sized_grid(512, 384, 0), sized_grid(1024, 768, 2), sized_grid(1024, 768, 4),
        ] });
        assert_eq!(read_picture(&json).unwrap().source, Source::Grid(1));
        // No grid: a thumbnail first, the picture marked default after it.
        let mut picture = stream(1, 0, json!({ "width": 4032, "height": 3024 }));
        picture["disposition"]["default"] = json!(1);
        let json =
            json!({ "streams": [stream(0, 0, json!({ "width": 320, "height": 240 })), picture] });
        assert_eq!(read_picture(&json).unwrap().source, Source::Stream(1));
        // A tile marked default is still a tile.
        let mut tile = stream(1, 1, json!({}));
        tile["disposition"]["default"] = json!(1);
        let json = json!({ "streams": [stream(0, 0, json!({})), tile] });
        assert_eq!(read_picture(&json).unwrap().source, Source::Stream(0));
    }

    #[test]
    fn refuses_a_profile_the_grid_lists_but_its_first_stream_doesnt_carry() {
        let streams = json!([stream(0, 1, json!({})), stream(1, 1, json!({}))]);
        // On the group, on a component.
        let mut on_group = grid(1, 0);
        on_group["side_data_list"] = icc()["side_data_list"].clone();
        let mut on_component = grid(1, 0);
        on_component["components"][0]["side_data_list"] = icc()["side_data_list"].clone();
        for group in [on_group, on_component] {
            let json = json!({ "streams": streams, "stream_groups": [group] });
            assert_eq!(read_picture(&json), Err(UNREAD), "{json}");
        }
        // On another of its tiles, found by the tile's index in the top-level streams, where real files are read.
        let json = json!({
            "streams": [stream(0, 1, json!({})), stream(1, 1, icc())],
            "stream_groups": [grid(1, 0)],
        });
        assert_eq!(read_picture(&json), Err(UNREAD));
        // A stream outside the grid with a profile isn't one of its tiles.
        let json = json!({
            "streams": [stream(0, 1, json!({})), stream(1, 1, json!({})), stream(2, 0, icc())],
            "stream_groups": [grid(1, 0)],
        });
        assert!(!read_picture(&json).unwrap().profile);
        // Side data inside the group's own stream entry is not where it's read.
        let mut inside = grid(1, 0);
        inside["streams"][1]["side_data_list"] = icc()["side_data_list"].clone();
        let json = json!({ "streams": streams, "stream_groups": [inside] });
        assert!(!read_picture(&json).unwrap().profile);
        // Listed on the group and carried by its first stream: read.
        let mut both = grid(1, 0);
        both["side_data_list"] = icc()["side_data_list"].clone();
        let json = json!({ "streams": [stream(0, 1, icc()), stream(1, 1, icc())], "stream_groups": [both] });
        assert!(read_picture(&json).unwrap().profile);
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
            decode_command(file, picture, 512 * 512)
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

    // ---- The HEIF's own boxes -------------------------------------------------------------------------------------

    fn bx(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut out = ((8 + body.len()) as u32).to_be_bytes().to_vec();
        out.extend(kind);
        out.extend(body);
        out
    }

    fn full(kind: &[u8; 4], version: u8, flags: u32, body: &[u8]) -> Vec<u8> {
        let mut head = vec![version];
        head.extend(&flags.to_be_bytes()[1..]);
        head.extend(body);
        bx(kind, &head)
    }

    fn id(version: u8, id: u32) -> Vec<u8> {
        if version == 0 {
            (id as u16).to_be_bytes().to_vec()
        } else {
            id.to_be_bytes().to_vec()
        }
    }

    fn prof() -> Vec<u8> {
        bx(b"colr", b"prof\0\0\x02\x30profile bytes")
    }

    fn ricc() -> Vec<u8> {
        bx(b"colr", b"rICC\0\0\x02\x30restricted profile")
    }

    /// The box check's refusal alone, for the tests that ask only whether one is added.
    fn grid_refusal(bytes: &[u8]) -> Option<&'static str> {
        grid_check(bytes).err()
    }

    fn nclx(primaries: u16, transfer: u16) -> Vec<u8> {
        let mut body = b"nclx".to_vec();
        for n in [primaries, transfer, 0] {
            body.extend(n.to_be_bytes());
        }
        body.push(0x80);
        bx(b"colr", &body)
    }

    /// A HEIF's box tree, built byte by byte: a grid (the primary item) whose tiles follow, with these properties.
    struct Tree {
        versions: [u8; 3],
        wide: bool,
        primary: u32,
        tiles: Vec<u32>,
        properties: Vec<Vec<u8>>,
        /// Which item has which properties, counted from 1.
        has: Vec<(u32, Vec<u16>)>,
        /// A second `ipma` box, written after the first when not empty.
        second_ipma: Vec<(u32, Vec<u16>)>,
        /// Another item's `dimg` before the primary's.
        other_dimg_first: bool,
    }

    impl Tree {
        /// A grid item 5 of tiles 1 and 2; property 1 is `ispe`, then `grid` and `tile`, the grid's and the first
        /// tile's.
        fn grid(grid: &[Vec<u8>], tile: &[Vec<u8>]) -> Self {
            let mut properties = vec![bx(b"ispe", &[0; 12])];
            let mut has = vec![(5, vec![1]), (1, vec![1]), (2, vec![1])];
            for property in grid {
                properties.push(property.clone());
                has[0].1.push(properties.len() as u16);
            }
            for property in tile {
                properties.push(property.clone());
                has[1].1.push(properties.len() as u16);
            }
            Self {
                versions: [0; 3],
                wide: false,
                primary: 5,
                tiles: vec![1, 2],
                properties,
                has,
                second_ipma: Vec::new(),
                other_dimg_first: false,
            }
        }

        fn meta_body(&self) -> Vec<u8> {
            let [pitm, iref, ipma] = self.versions;
            let mut meta = full(b"hdlr", 0, 0, b"\0\0\0\0pict\0\0\0\0\0\0\0\0\0\0\0\0\0");
            meta.extend(full(b"pitm", pitm, 0, &id(pitm, self.primary)));
            if !self.tiles.is_empty() {
                let mut dimg = id(iref, self.primary);
                dimg.extend((self.tiles.len() as u16).to_be_bytes());
                for tile in &self.tiles {
                    dimg.extend(id(iref, *tile));
                }
                // A reference of another kind first, which isn't a tile.
                let mut thmb = id(iref, 9);
                thmb.extend(1u16.to_be_bytes());
                thmb.extend(id(iref, self.primary));
                let mut references = bx(b"thmb", &thmb);
                if self.other_dimg_first {
                    // Item 7's grid (a gain map's, say) of tile 2, before the primary's.
                    let mut other = id(iref, 7);
                    other.extend(1u16.to_be_bytes());
                    other.extend(id(iref, 2));
                    references.extend(bx(b"dimg", &other));
                }
                references.extend(bx(b"dimg", &dimg));
                meta.extend(full(b"iref", iref, 0, &references));
            }
            let ipco = bx(b"ipco", &self.properties.concat());
            let ipma_box = |has: &[(u32, Vec<u16>)]| {
                let mut entries = (has.len() as u32).to_be_bytes().to_vec();
                for (item, indexes) in has {
                    entries.extend(id(ipma, *item));
                    entries.push(indexes.len() as u8);
                    for index in indexes {
                        if self.wide {
                            entries.extend((0x8000 | index).to_be_bytes());
                        } else {
                            entries.push(0x80 | *index as u8);
                        }
                    }
                }
                full(b"ipma", ipma, u32::from(self.wide), &entries)
            };
            let mut iprp = [ipco, ipma_box(&self.has)].concat();
            if !self.second_ipma.is_empty() {
                iprp.extend(ipma_box(&self.second_ipma));
            }
            meta.extend(bx(b"iprp", &iprp));
            meta
        }

        fn bytes(&self) -> Vec<u8> {
            let mut out = bx(b"ftyp", b"heic\0\0\0\0mif1heic");
            out.extend(full(b"meta", 0, 0, &self.meta_body()));
            out
        }
    }

    #[test]
    fn the_grids_own_colour_is_refused_or_used_never_ignored() {
        let check = |tree: &Tree| grid_check(&tree.bytes());
        // A profile on the grid its first tile lacks: refused, also when the tile has four numbers.
        assert_eq!(check(&Tree::grid(&[prof()], &[])), Err(UNREAD));
        assert_eq!(check(&Tree::grid(&[prof()], &[nclx(12, 13)])), Err(UNREAD));
        // An `rICC` profile is a profile too.
        assert_eq!(check(&Tree::grid(&[ricc()], &[])), Err(UNREAD));
        assert_eq!(check(&Tree::grid(&[ricc()], &[prof()])), Ok(None));
        // Both carry one: fine, and the profile is what's carried.
        assert_eq!(check(&Tree::grid(&[prof()], &[prof()])), Ok(None));
        // PQ or HLG on the grid: the HDR words, whatever the tiles say.
        for transfer in [16, 18] {
            assert_eq!(
                check(&Tree::grid(&[nclx(9, transfer)], &[prof()])),
                Err(HDR)
            );
            assert_eq!(
                check(&Tree::grid(&[nclx(9, transfer)], &[nclx(9, 1)])),
                Err(HDR)
            );
            assert_eq!(check(&Tree::grid(&[nclx(9, transfer)], &[])), Err(HDR));
            assert_eq!(
                check(&Tree::grid(&[nclx(9, transfer)], &[nclx(9, transfer)])),
                Err(HDR)
            );
        }
        // Four numbers on the grid: used, whatever the tile has (some phones say it only inside the video stream).
        assert_eq!(check(&Tree::grid(&[nclx(12, 13)], &[])), Ok(Some((12, 13))));
        assert_eq!(
            check(&Tree::grid(&[nclx(12, 13)], &[nclx(1, 1)])),
            Ok(Some((12, 13)))
        );
        assert_eq!(
            check(&Tree::grid(&[nclx(12, 13)], &[prof()])),
            Ok(Some((12, 13)))
        );
        assert_eq!(
            check(&Tree::grid(&[nclx(12, 13)], &[nclx(12, 13)])),
            Ok(Some((12, 13)))
        );
        // The raw numbers are handed on, 2 included: `tag_for` alone decides what an unspecified one means.
        assert_eq!(
            check(&Tree::grid(&[nclx(2, 2)], &[nclx(12, 13)])),
            Ok(Some((2, 2)))
        );
        // A profile and four numbers on the grid, over a tile with only one of them, each way.
        assert_eq!(
            check(&Tree::grid(&[prof(), nclx(12, 13)], &[prof()])),
            Ok(Some((12, 13)))
        );
        assert_eq!(
            check(&Tree::grid(&[nclx(12, 13), prof()], &[nclx(12, 13)])),
            Err(UNREAD)
        );
        // Nothing on the grid: as before, whatever the tile says.
        assert_eq!(check(&Tree::grid(&[], &[])), Ok(None));
        assert_eq!(check(&Tree::grid(&[], &[nclx(9, 16)])), Ok(None));
        // The colour the second tile carries isn't the first's.
        let mut second = Tree::grid(&[prof()], &[]);
        second.properties.push(prof());
        second.has[2].1.push(second.properties.len() as u16);
        assert_eq!(check(&second), Err(UNREAD));
        // A single picture, no tiles: nothing found, even PQ (ffprobe sees its stream's own).
        let mut single = Tree::grid(&[nclx(9, 16)], &[]);
        single.tiles.clear();
        assert_eq!(grid_colours(&single.bytes()), None);
        assert_eq!(check(&single), Ok(None));
    }

    #[test]
    fn a_grid_refused_by_its_boxes_is_never_written_and_the_cheap_check_doesnt_read_them() {
        let dir = temp_dir("boxes");
        let folder = dir.join("cache");
        // Not on the command's own thread: `refuse` is only the size and the brand.
        let lacking = Tree::grid(&[prof()], &[]).bytes();
        assert_eq!(refuse(&lacking), Ok(()));
        let hdr = Tree::grid(&[nclx(9, 16)], &[]).bytes();
        assert_eq!(refuse(&hdr), Ok(()));
        let hlg = Tree::grid(&[nclx(9, 18)], &[]).bytes();
        assert_eq!(refuse(&hlg), Ok(()));
        // In the blocking part, before the photo is written anywhere.
        assert_eq!(picture(&lacking, &folder), Err(UNREAD));
        assert_eq!(picture(&hdr, &folder), Err(HDR));
        assert_eq!(picture(&hlg, &folder), Err(HDR));
        assert!(!folder.exists(), "nothing written");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_index_0_two_ipma_boxes_and_a_dimg_from_another_item_first() {
        // An association with index 0 is none.
        let mut tree = Tree::grid(&[prof()], &[]);
        tree.has[1].1.push(0);
        assert_eq!(grid_check(&tree.bytes()), Err(UNREAD));
        // Two ipma boxes: the tile's colour in the second.
        let mut tree = Tree::grid(&[prof()], &[]);
        tree.properties.push(prof());
        tree.second_ipma = vec![(1, vec![tree.properties.len() as u16])];
        assert_eq!(grid_check(&tree.bytes()), Ok(None));
        tree.second_ipma.clear();
        assert_eq!(grid_check(&tree.bytes()), Err(UNREAD));
        // A dimg from another item (a gain map's grid) before the primary's: its tiles aren't the picture's.
        // Item 7's first tile is 2, which carries no profile: read as the first tile, it would refuse.
        let mut tree = Tree::grid(&[prof()], &[prof()]);
        tree.other_dimg_first = true;
        assert_eq!(grid_check(&tree.bytes()), Ok(None));
        // An nclx of exactly 10 bytes lacks its range byte: not followed; 11 is whole.
        let ten = bx(b"colr", b"nclx\0\x0c\0\x0d\0\0");
        assert_eq!(grid_check(&Tree::grid(&[ten], &[]).bytes()), Ok(None));
        let eleven = bx(b"colr", b"nclx\0\x0c\0\x0d\0\0\x80");
        assert_eq!(
            grid_check(&Tree::grid(&[eleven], &[]).bytes()),
            Ok(Some((12, 13)))
        );
    }

    #[test]
    fn needs_only_the_boxes_it_reads() {
        let tree = Tree::grid(&[prof()], &[]);
        let meta = full(b"meta", 0, 0, &tree.meta_body());
        let ftyp = bx(b"ftyp", b"heic\0\0\0\0mif1heic");
        let mdat = bx(b"mdat", &[0; 32]);
        // Stray bytes after mdat, a broken box after the three it reads in meta: still read.
        let file = [ftyp.clone(), meta.clone(), mdat.clone(), vec![0, 0, 0, 3]].concat();
        assert_eq!(grid_check(&file), Err(UNREAD));
        let mut broken_after = tree.meta_body();
        broken_after.extend([0, 0, 0, 5, b'f', b'r']);
        let file = [
            ftyp.clone(),
            full(b"meta", 0, 0, &broken_after),
            mdat.clone(),
        ]
        .concat();
        assert_eq!(grid_check(&file), Err(UNREAD));
        // A broken box before meta, or before one it needs: can't follow.
        let file = [
            ftyp.clone(),
            vec![0, 0, 0, 3, b'f', b'r', b'e', b'e'],
            meta.clone(),
        ]
        .concat();
        assert_eq!(grid_check(&file), Ok(None));
        let mut broken_before = vec![0, 0, 0, 5, b'f', b'r', b'e', b'e'];
        broken_before.extend(tree.meta_body());
        let file = [ftyp.clone(), full(b"meta", 0, 0, &broken_before)].concat();
        assert_eq!(grid_check(&file), Ok(None));
        // A size of 0 on a box that isn't last runs to its container's end, over what follows.
        let file = [ftyp.clone(), bx(b"free", &[]), meta.clone()].concat();
        assert_eq!(grid_check(&file), Err(UNREAD));
        let mut zero = bx(b"free", &[]);
        zero[..4].copy_from_slice(&0u32.to_be_bytes());
        assert_eq!(
            grid_check(&[ftyp.clone(), zero.clone(), meta.clone()].concat()),
            Ok(None)
        );
        let mut zero_in_meta = zero.clone();
        zero_in_meta.extend(tree.meta_body());
        assert_eq!(
            grid_check(&[ftyp.clone(), full(b"meta", 0, 0, &zero_in_meta)].concat()),
            Ok(None)
        );
        // A child that claims to run past its parent (pitm's size past meta's end, with mdat's bytes after it in the
        // file): an end, never a read past it.
        let mut past = meta.clone();
        let pitm = past.windows(4).position(|w| w == b"pitm").unwrap() - 4;
        past[pitm..pitm + 4].copy_from_slice(&(meta.len() as u32).to_be_bytes());
        assert_eq!(grid_check(&[ftyp, past, mdat].concat()), Ok(None));
    }

    #[test]
    fn reads_pitm_iref_and_ipma_in_both_versions_and_two_byte_indexes() {
        for versions in [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1]] {
            for wide in [false, true] {
                let mut tree = Tree::grid(&[prof()], &[]);
                tree.versions = versions;
                tree.wide = wide;
                assert_eq!(
                    grid_refusal(&tree.bytes()),
                    Some(UNREAD),
                    "{versions:?} {wide}"
                );
                // Ids past 16 bits, where version 1 allows them.
                if versions == [1, 1, 1] {
                    tree.primary = 70_000;
                    tree.tiles = vec![70_001, 70_002];
                    tree.has[0].0 = 70_000;
                    tree.has[1].0 = 70_001;
                    tree.has[2].0 = 70_002;
                    assert_eq!(grid_refusal(&tree.bytes()), Some(UNREAD), "{wide}");
                }
            }
        }
        // Two-byte indexes past 127.
        let mut tree = Tree::grid(&[], &[]);
        tree.wide = true;
        for _ in 0..200 {
            tree.properties.push(bx(b"free", &[]));
        }
        tree.properties.push(prof());
        tree.has[0].1.push(tree.properties.len() as u16);
        assert!(tree.properties.len() > 127);
        assert_eq!(grid_refusal(&tree.bytes()), Some(UNREAD));
        // A version this reader doesn't know: not followed, nothing added.
        let mut tree = Tree::grid(&[prof()], &[]);
        tree.versions = [2, 0, 0];
        assert_eq!(grid_refusal(&tree.bytes()), None);
    }

    #[test]
    fn a_tree_it_cant_follow_adds_no_refusal_and_never_panics() {
        let tree = Tree::grid(&[prof()], &[]);
        let bytes = tree.bytes();
        assert_eq!(grid_refusal(&bytes), Some(UNREAD));
        // Cut at every length.
        for end in 0..bytes.len() {
            assert_eq!(grid_refusal(&bytes[..end]), None, "cut at {end}");
        }
        let meta = full(b"meta", 0, 0, &tree.meta_body());
        let ftyp = bx(b"ftyp", b"heic\0\0\0\0mif1heic");
        // A size of 0 runs to the end: followed.
        let mut to_the_end = meta.clone();
        to_the_end[..4].copy_from_slice(&0u32.to_be_bytes());
        assert_eq!(
            grid_refusal(&[ftyp.clone(), to_the_end].concat()),
            Some(UNREAD)
        );
        // A size of 1: the 64-bit size after the type, followed.
        let mut large = 1u32.to_be_bytes().to_vec();
        large.extend(b"meta");
        large.extend(((meta.len() + 8) as u64).to_be_bytes());
        large.extend(&meta[8..]);
        assert_eq!(
            grid_refusal(&[ftyp.clone(), large.clone()].concat()),
            Some(UNREAD)
        );
        // A 64-bit size smaller than its own header, or past the end: an end.
        for size in [15u64, 0, u64::MAX, (large.len() + 1) as u64] {
            let mut bad = large.clone();
            bad[8..16].copy_from_slice(&size.to_be_bytes());
            assert_eq!(grid_refusal(&[ftyp.clone(), bad].concat()), None, "{size}");
        }
        // A 32-bit size smaller than its header, and every size from 2 to 7.
        for size in 2u32..8 {
            let mut bad = meta.clone();
            bad[..4].copy_from_slice(&size.to_be_bytes());
            assert_eq!(grid_refusal(&[ftyp.clone(), bad].concat()), None, "{size}");
        }
        // Lists longer than the limit: ipma's entries, a reference's ids, boxes in a container.
        let mut tree = Tree::grid(&[prof()], &[]);
        for item in 0..=MAX_ENTRIES as u32 {
            tree.has.push((100 + item, vec![]));
        }
        assert_eq!(grid_refusal(&tree.bytes()), None);
        let mut tree = Tree::grid(&[prof()], &[]);
        tree.tiles = (1..=MAX_ENTRIES as u32 + 1).collect();
        assert_eq!(grid_refusal(&tree.bytes()), None);
        let mut tree = Tree::grid(&[prof()], &[]);
        for _ in 0..MAX_ENTRIES {
            tree.properties.insert(0, bx(b"free", &[]));
        }
        assert_eq!(grid_refusal(&tree.bytes()), None);
        // An index past the properties, a short nclx: not followed.
        let mut tree = Tree::grid(&[prof()], &[]);
        tree.has[1].1.push(99);
        assert_eq!(grid_refusal(&tree.bytes()), None);
        let short = bx(b"colr", b"nclx\0\x09\0\x10");
        assert_eq!(grid_refusal(&Tree::grid(&[short], &[]).bytes()), None);
        // Bytes that aren't boxes at all.
        assert_eq!(grid_refusal(&[0xff; 64]), None);
        assert_eq!(grid_refusal(&[]), None);
    }

    #[test]
    fn the_real_grid_carries_its_profile_on_its_tiles_and_adds_no_refusal() {
        // sips's grid: the primary item 5, tiles 1 to 4, the one `prof` colr (property 1) on the grid and its tiles.
        let colours = grid_colours(&proof()).expect("its boxes are followed");
        let icc = ItemColour {
            icc: true,
            ..ItemColour::default()
        };
        assert_eq!(colours, (icc, icc));
        assert_eq!(grid_refusal(&proof()), None);
        assert_eq!(grid_check(&proof()), Ok(None));
        assert_eq!(refuse(&proof()), Ok(()));
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
            tag_for(
                &picture_with(Some("smpte432"), Some("iec61966-2-1"), true),
                None
            ),
            Tag::Profile
        );
        assert_eq!(tag_for(&picture_with(None, None, true), None), Tag::Profile);
        // An iPhone's: Display P3.
        assert_eq!(
            tag_for(
                &picture_with(Some("smpte432"), Some("iec61966-2-1"), false),
                None
            ),
            Tag::Cicp([12, 13, 0, 1])
        );
        assert_eq!(
            tag_for(&picture_with(Some("bt709"), Some("bt709"), false), None),
            Tag::Cicp([1, 1, 0, 1])
        );
        assert_eq!(
            tag_for(
                &picture_with(Some("bt2020"), Some("bt2020-10"), false),
                None
            ),
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
                tag_for(&picture_with(primaries, transfer, false), None),
                Tag::Cicp(SRGB),
                "{primaries:?} {transfer:?}"
            );
        }
        // Read from ffprobe's names on the picture's stream.
        let json = json!({ "streams": [stream(0, 0, json!({ "color_primaries": "smpte432", "color_transfer": "iec61966-2-1" }))] });
        assert_eq!(
            tag_for(&read_picture(&json).unwrap(), None),
            Tag::Cicp([12, 13, 0, 1])
        );
    }

    #[test]
    fn the_grids_four_numbers_win_over_the_streams_and_a_carried_profile_over_both() {
        let stream_says = picture_with(Some("bt709"), Some("bt709"), false);
        // The grid's own numbers, over the stream's.
        assert_eq!(
            tag_for(&stream_says, Some((12, 13))),
            Tag::Cicp([12, 13, 0, 1])
        );
        assert_eq!(
            tag_for(&stream_says, Some((9, 14))),
            Tag::Cicp([9, 14, 0, 1])
        );
        assert_eq!(
            tag_for(&picture_with(None, None, false), Some((1, 1))),
            Tag::Cicp([1, 1, 0, 1])
        );
        // A stated number the table doesn't hold, either one: sRGB, never the stream's instead, also when the other
        // place falls to the stream.
        for (primaries, transfer) in [(22, 13), (12, 17), (12, 16), (22, 2), (2, 17)] {
            assert_eq!(
                tag_for(&stream_says, Some((primaries, transfer))),
                Tag::Cicp(SRGB),
                "{primaries}/{transfer}"
            );
        }
        // The grid's 0 (reserved) or 2 (unspecified) states nothing: the stream's word stands for that place.
        let p3 = picture_with(Some("smpte432"), Some("iec61966-2-1"), false);
        assert_eq!(tag_for(&p3, Some((2, 2))), Tag::Cicp([12, 13, 0, 1]));
        assert_eq!(tag_for(&p3, Some((0, 0))), Tag::Cicp([12, 13, 0, 1]));
        assert_eq!(tag_for(&p3, Some((2, 1))), Tag::Cicp([12, 1, 0, 1]));
        assert_eq!(tag_for(&p3, Some((9, 2))), Tag::Cicp([9, 13, 0, 1]));
        assert_eq!(
            tag_for(&stream_says, Some((12, 2))),
            Tag::Cicp([12, 1, 0, 1])
        );
        // Nobody states it: the whole tag is sRGB, as with names.
        assert_eq!(
            tag_for(&picture_with(None, None, false), Some((12, 2))),
            Tag::Cicp(SRGB)
        );
        assert_eq!(
            tag_for(
                &picture_with(Some("unknown"), Some("unspecified"), false),
                Some((2, 2))
            ),
            Tag::Cicp(SRGB)
        );
        // A profile carried wins over the grid's numbers.
        assert_eq!(
            tag_for(&picture_with(None, None, true), Some((12, 13))),
            Tag::Profile
        );
        assert_eq!(
            tag_for(&picture_with(None, None, true), Some((2, 2))),
            Tag::Profile
        );
        // No grid numbers: the stream's, as before.
        assert_eq!(tag_for(&stream_says, None), Tag::Cicp([1, 1, 0, 1]));
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
        // Within a level: ffmpeg's colour conversion takes fast code chosen by the processor (Intel, Apple silicon),
        // and those may differ by one.
        let (theirs, ours) = (
            pixels(&dir, "committed.png", &committed),
            pixels(&dir, "answer.png", &answer),
        );
        assert_eq!(theirs.len(), ours.len());
        let worst = theirs
            .iter()
            .zip(&ours)
            .map(|(a, b)| a.abs_diff(*b))
            .max()
            .unwrap_or(0);
        assert!(
            worst <= 1,
            "the committed PNG's pixels are today's answer's, within a level: {worst} apart"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn gives_up_at_the_limit_with_its_words_and_leaves_no_file() {
        let dir = temp_dir("slow");
        // A decode that would run for a minute, with the photo open as one of its inputs.
        let stand_in = |file: &Path, _: &Picture, _: u64| {
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
    fn lets_no_more_than_two_in_at_once_and_two_do_get_in() {
        let gate = Arc::new(Gate::new(2));
        let inside = Arc::new(AtomicUsize::new(0));
        let most = Arc::new(AtomicUsize::new(0));
        let two_seen = Arc::new(AtomicBool::new(false));
        let start = Arc::new(Barrier::new(3));
        let calls: Vec<_> = (0..3)
            .map(|_| {
                let (gate, inside, most, two_seen, start) = (
                    gate.clone(),
                    inside.clone(),
                    most.clone(),
                    two_seen.clone(),
                    start.clone(),
                );
                std::thread::spawn(move || {
                    start.wait();
                    let _turn = gate.enter();
                    let now = inside.fetch_add(1, Ordering::SeqCst) + 1;
                    most.fetch_max(now, Ordering::SeqCst);
                    // Each stays in until a second is in with it (or 10 s pass), so "two at once" never hangs on
                    // how fast the machine is; the third finds it already seen.
                    let waited = Instant::now();
                    while !two_seen.load(Ordering::SeqCst)
                        && waited.elapsed() < Duration::from_secs(10)
                    {
                        if inside.load(Ordering::SeqCst) >= 2 {
                            two_seen.store(true, Ordering::SeqCst);
                        }
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    std::thread::sleep(Duration::from_millis(50));
                    inside.fetch_sub(1, Ordering::SeqCst);
                })
            })
            .collect();
        for call in calls {
            call.join().unwrap();
        }
        assert!(most.load(Ordering::SeqCst) <= 2, "never three at once");
        assert!(two_seen.load(Ordering::SeqCst), "two did get in at once");
        assert_eq!(gate.turns().inside, 0, "every turn given back");
        assert_eq!(gate.turns().waiting, 0, "no one left waiting");
    }

    #[test]
    fn picture_waits_its_turn_at_the_gate_but_a_refusal_never_does() {
        // A gate of the test's own, both turns taken here: the photo is seen waiting at it, then it can't have
        // decoded, since it holds no turn.
        let gate = Arc::new(Gate::new(2));
        let first = gate.enter();
        let second = gate.enter();
        let dir = temp_dir("gate");
        let folder = dir.join("cache");
        let (done, heard) = std::sync::mpsc::channel();
        let waiting = std::thread::spawn({
            let (gate, folder) = (gate.clone(), folder.clone());
            move || {
                let _ = done.send(picture_at(&gate, &proof(), &folder));
            }
        });
        let started = Instant::now();
        while gate.turns().waiting == 0 && started.elapsed() < Duration::from_secs(30) {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(gate.turns().waiting, 1, "the photo waits at the gate");
        assert!(heard.try_recv().is_err(), "decoded with both turns taken");
        // A file that isn't a HEIF is refused before the gate.
        assert_eq!(picture_at(&gate, &[0, 0, 0], &folder), Err(NOT_HEIC));
        assert_eq!(gate.turns().waiting, 1);
        drop(first);
        let answer = heard
            .recv_timeout(Duration::from_secs(30))
            .expect("decoded once a turn was free");
        assert!(answer.is_ok());
        drop(second);
        waiting.join().unwrap();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sweeps_its_own_temp_files_left_over_10_minutes_ago_and_nothing_else() {
        let dir = temp_dir("sweep");
        let planted = |name: &str, age: Duration| {
            let path = dir.join(name);
            let file = fs::File::create(&path).unwrap();
            file.set_modified(std::time::SystemTime::now() - age)
                .unwrap();
            path
        };
        let hour = Duration::from_secs(60 * 60);
        let old = planted(
            "heic-0123456789abcdef0123456789abcdef.heic",
            Duration::from_secs(11 * 60),
        );
        let fresh = planted(
            "heic-fedcba9876543210fedcba9876543210.heic",
            Duration::from_secs(60),
        );
        // Old, but names it could never have written: left alone.
        let not_ours = [
            planted("tile-16-20-30.png", hour),
            planted("heic-.heic", hour),
            planted("heic-abc.heic", hour),
            // Upper case, never `old`'s name in capitals: Windows would take the two for one file.
            planted("heic-ABCDEF0123456789ABCDEF0123456789.heic", hour),
            planted("heic-0123456789abcdef0123456789abcdef0.heic", hour),
            planted("heic-0123456789abcdef0123456789abcdeg.heic", hour),
        ];
        assert!(picture(&proof(), &dir).is_ok());
        assert!(!old.exists(), "an old one of ours goes");
        assert!(
            fresh.exists(),
            "a fresh one may be another call's: it stays"
        );
        for path in &not_ours {
            assert!(path.exists(), "only ours: {}", path.display());
        }
        // The names random_id gives are the ones it takes.
        assert!(is_temp_name(&format!(
            "heic-{}.heic",
            crate::lock::random_id()
        )));
        // A folder that isn't there yet: nothing to sweep, and no error.
        sweep(&dir.join("not-there"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn starts_no_run_with_no_time_left() {
        let dir = temp_dir("no-time");
        let file = dir.join("photo.heic");
        // A program that isn't there: started, it would say it couldn't start.
        let missing = || Command::new(dir.join("no-such-sidecar"));
        assert_eq!(
            run(missing(), Instant::now(), &file, MAX_PROBE),
            Err(TOO_SLOW)
        );
        assert_eq!(
            run(
                missing(),
                Instant::now() + Duration::from_secs(5),
                &file,
                MAX_PROBE
            ),
            Err(READER_MISSING)
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_sidecar_that_cant_start_keeps_the_runners_words() {
        // The runner's own words for it, read from the runner itself, are the ones heic.rs passes on.
        let dir = temp_dir("missing");
        let said = video::run_stoppable(
            Command::new(dir.join("no-such-sidecar")),
            Duration::from_secs(5),
            false,
            None,
            None,
        )
        .unwrap_err();
        assert_eq!(said, READER_MISSING);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn asks_ffprobe_by_names_it_knows_and_reads_them_back() {
        // ffprobe leaves out a name it doesn't know without a word, so each is read back from a file that has it: a
        // 10-bit clip tagged Display P3, made here by the sidecar.
        let dir = temp_dir("entries");
        let clip = dir.join("tagged.mkv");
        let status = video::command("ffmpeg")
            .args(["-hide_banner", "-v", "error", "-y", "-f", "lavfi"])
            .args(["-i", "color=c=red:size=64x64:duration=0.1"])
            .args([
                "-vf",
                "setparams=color_primaries=smpte432:color_trc=iec61966-2-1:colorspace=bt709",
                "-pix_fmt",
                "yuv420p10le",
                "-c:v",
                "ffv1",
            ])
            .arg(&clip)
            .status()
            .unwrap();
        assert!(status.success());
        let said = probe_command(&clip).output().unwrap();
        assert!(said.status.success());
        let json: Value = serde_json::from_slice(&said.stdout).unwrap();
        let picture = read_picture(&json).unwrap();
        assert_eq!(picture.source, Source::Stream(0));
        assert!(picture.deep);
        assert_eq!(picture.primaries.as_deref(), Some("smpte432"));
        assert_eq!(picture.transfer.as_deref(), Some("iec61966-2-1"));
        let stream = &json["streams"][0];
        assert_eq!(stream["bits_per_raw_sample"], "10");
        assert_eq!(stream["disposition"]["dependent"], 0);
        // Only what was asked for: no tags, no codec name.
        assert!(stream.get("tags").is_none() && stream.get("codec_name").is_none());
        // The proof: its grid, its tiles' profile, and nothing else of the file's.
        let heic = dir.join("proof.heic");
        fs::write(&heic, proof()).unwrap();
        let said = probe_command(&heic).output().unwrap();
        assert!(said.status.success());
        let json: Value = serde_json::from_slice(&said.stdout).unwrap();
        let group = &json["stream_groups"][0];
        assert_eq!(group["type"], "Tile Grid");
        assert_eq!(group["disposition"]["default"], 1);
        assert_eq!(group["components"][0]["width"], 1024);
        assert_eq!(group["components"][0]["height"], 768);
        assert_eq!(group["streams"][0]["index"], 0);
        assert_eq!(json["streams"][0]["disposition"]["dependent"], 1);
        assert_eq!(json["streams"][0]["pix_fmt"], "yuvj420p");
        assert_eq!(
            read_picture(&json).unwrap(),
            Picture {
                source: Source::Grid(0),
                first: 0,
                deep: false,
                profile: true,
                primaries: None,
                transfer: None,
            }
        );
        assert!(!String::from_utf8_lossy(&said.stdout).contains("tags"));
        let _ = fs::remove_dir_all(&dir);
    }

    // ---- The pixels, before any decode -----------------------------------------------------------------------------

    /// The limit's answer for ffprobe's JSON, as `decode_within` asks it: after the picture is chosen. Passed or not,
    /// without the largest frame it gives (`largest` reads that).
    fn limit(json: &Value) -> Result<(), &'static str> {
        largest(json).map(|_| ())
    }

    /// The largest frame the limit passes on to the decode's cap.
    fn largest(json: &Value) -> Result<u64, &'static str> {
        let picture = read_picture(json)?;
        pixels_within_limit(json, &picture)
    }

    /// ffprobe's answer for a default grid of `width` × `height` whose places are filled in turn by these tiles, each
    /// its own stream, the grid's list naming every one, and its canvas the picture's own size.
    fn tiled(width: Value, height: Value, tiles: &[(u64, u64)]) -> Value {
        tiled_after(&[], width, height, tiles)
    }

    /// `tiled` with the streams of `before` (not the grid's: a thumbnail, another grid's tiles) first in the file, so
    /// the grid's tiles' file stream indexes start after them while their places still count from 0 in the grid's
    /// own list.
    fn tiled_after(
        before: &[(u64, u64)],
        width: Value,
        height: Value,
        tiles: &[(u64, u64)],
    ) -> Value {
        let streams: Vec<Value> = before
            .iter()
            .chain(tiles)
            .enumerate()
            .map(|(n, &(w, h))| stream(n as u64, 1, json!({ "width": w, "height": h })))
            .collect();
        let first = before.len();
        let places: Vec<Value> = (0..tiles.len())
            .map(|n| json!({ "stream_index": n }))
            .collect();
        // At least one entry, so a grid of no tiles still has the first stream `read_picture` reads.
        let listed: Vec<Value> = (0..tiles.len().max(1))
            .map(|n| json!({ "index": first + n }))
            .collect();
        json!({
            "streams": streams,
            "stream_groups": [{
                "type": "Tile Grid",
                "disposition": { "default": 1 },
                "components": [{
                    "width": width.clone(),
                    "height": height.clone(),
                    "coded_width": width,
                    "coded_height": height,
                    "subcomponents": places,
                }],
                "streams": listed,
            }],
        })
    }

    /// `count` tiles of `side` × `side`.
    fn square_tiles(count: usize, side: u64) -> Vec<(u64, u64)> {
        vec![(side, side); count]
    }

    fn one_stream(width: Value, height: Value) -> Value {
        json!({ "streams": [stream(0, 0, json!({ "width": width, "height": height }))] })
    }

    #[test]
    fn a_picture_of_exactly_120_megapixels_passes_and_one_pixel_more_is_refused() {
        assert_eq!(limit(&one_stream(json!(12000), json!(10000))), Ok(()));
        // 3047 × 39383 = 120,000,001.
        assert_eq!(
            limit(&one_stream(json!(3047), json!(39383))),
            Err(TOO_MANY_PIXELS)
        );
        assert_eq!(
            limit(&one_stream(json!(120_000_001), json!(1))),
            Err(TOO_MANY_PIXELS)
        );
        // A grid of exactly 120 MP, its tiles adding up to the same, passes too.
        assert_eq!(
            limit(&tiled(json!(12000), json!(10000), &square_tiles(120, 1000))),
            Ok(())
        );
    }

    #[test]
    fn a_grid_over_the_limit_is_refused_whatever_its_tiles_are() {
        for tiles in [
            square_tiles(1, 512),
            square_tiles(121, 1000),
            vec![(0, 0)],
            Vec::new(),
        ] {
            let mut json = tiled(json!(12000), json!(10001), &tiles);
            if tiles.is_empty() {
                json["streams"] = json!([stream(0, 1, json!({}))]);
            }
            assert_eq!(limit(&json), Err(TOO_MANY_PIXELS), "{tiles:?}");
        }
        assert_eq!(
            limit(&tiled(json!(65535), json!(65535), &square_tiles(4, 512))),
            Err(TOO_MANY_PIXELS)
        );
    }

    #[test]
    fn tiles_up_to_twice_the_picture_plus_a_megapixel_pass_and_one_pixel_more_is_refused() {
        // A 100 MP picture: tiles of 1.03, 1.48 and exactly 2 times plus 1,000,000.
        for count in [103, 148, 201] {
            assert_eq!(
                limit(&tiled(
                    json!(10000),
                    json!(10000),
                    &square_tiles(count, 1000)
                )),
                Ok(()),
                "{count}"
            );
        }
        // One pixel more, in tiles that all declare one size (a grid's must): one tile of 201,000,001 × 1.
        let over = [(201_000_001, 1)];
        assert_eq!(
            limit(&tiled(json!(10000), json!(10000), &over)),
            Err(TOO_MANY_PIXELS)
        );
        // An iPhone's 48 MP photo in 512 px tiles (16 × 12): 1.03.
        assert_eq!(
            limit(&tiled(
                json!(8064),
                json!(6048),
                &square_tiles(16 * 12, 512)
            )),
            Ok(())
        );
        // A tiny picture in one 512 px tile is what the extra megapixel is for.
        assert_eq!(
            limit(&tiled(json!(16), json!(16), &square_tiles(1, 512))),
            Ok(())
        );
    }

    #[test]
    fn a_102_megapixel_frame_passes_in_4096_and_in_512_px_tiles() {
        // 11648 × 8736 in 4096 px tiles, 3 × 3: 1.48 times.
        assert_eq!(
            limit(&tiled(json!(11648), json!(8736), &square_tiles(9, 4096))),
            Ok(())
        );
        // In 512 px tiles, 23 × 18: 1.07 times.
        assert_eq!(
            limit(&tiled(
                json!(11648),
                json!(8736),
                &square_tiles(23 * 18, 512)
            )),
            Ok(())
        );
    }

    #[test]
    fn a_tiny_picture_over_huge_tiles_is_refused() {
        assert_eq!(
            limit(&tiled(json!(16), json!(16), &square_tiles(1, 16384))),
            Err(TOO_MANY_PIXELS)
        );
        assert_eq!(
            limit(&tiled(json!(16), json!(16), &square_tiles(256, 8192))),
            Err(TOO_MANY_PIXELS)
        );
    }

    #[test]
    fn a_tile_the_grid_uses_twice_counts_twice() {
        // A 1 MP picture may have 3 MP of tiles: one of 1.6 MP fits once, not twice.
        let mut json = tiled(json!(1000), json!(1000), &[(1600, 1000)]);
        assert_eq!(limit(&json), Ok(()));
        json["stream_groups"][0]["components"][0]["subcomponents"] =
            json!([{ "stream_index": 0 }, { "stream_index": 0 }]);
        assert_eq!(limit(&json), Err(TOO_MANY_PIXELS));
    }

    #[test]
    fn a_size_that_cant_be_read_is_unreadable_and_never_panics() {
        let bad = [
            Value::Null,
            json!(0),
            json!(-512),
            json!("abc"),
            json!("512"),
            json!(512.5),
        ];
        for value in &bad {
            // The one stream's width or height.
            assert_eq!(
                limit(&one_stream(value.clone(), json!(512))),
                Err(UNREAD),
                "{value}"
            );
            assert_eq!(
                limit(&one_stream(json!(512), value.clone())),
                Err(UNREAD),
                "{value}"
            );
            // The grid's.
            assert_eq!(
                limit(&tiled(value.clone(), json!(768), &square_tiles(4, 512))),
                Err(UNREAD),
                "{value}"
            );
            assert_eq!(
                limit(&tiled(json!(1024), value.clone(), &square_tiles(4, 512))),
                Err(UNREAD),
                "{value}"
            );
            // A tile's.
            let mut json = tiled(json!(1024), json!(768), &square_tiles(4, 512));
            json["streams"][2]["width"] = value.clone();
            assert_eq!(limit(&json), Err(UNREAD), "{value}");
            // A place's stream index (0 is a real one: the first tile's).
            if *value == json!(0) {
                continue;
            }
            let mut json = tiled(json!(1024), json!(768), &square_tiles(4, 512));
            json["stream_groups"][0]["components"][0]["subcomponents"][1]["stream_index"] =
                value.clone();
            assert_eq!(limit(&json), Err(UNREAD), "{value}");
        }
        // A missing size key altogether (the stream helper has 512 × 512 unless told otherwise).
        let mut json = tiled(json!(1024), json!(768), &square_tiles(4, 512));
        json["streams"][1].as_object_mut().unwrap().remove("height");
        assert_eq!(limit(&json), Err(UNREAD));
        // No places listed, none at all, a place whose stream isn't there.
        let mut json = tiled(json!(1024), json!(768), &square_tiles(4, 512));
        json["stream_groups"][0]["components"][0]
            .as_object_mut()
            .unwrap()
            .remove("subcomponents");
        assert_eq!(limit(&json), Err(UNREAD));
        json["stream_groups"][0]["components"][0]["subcomponents"] = json!([]);
        assert_eq!(limit(&json), Err(UNREAD));
        json["stream_groups"][0]["components"][0]["subcomponents"] =
            json!([{ "stream_index": 0 }, { "stream_index": 99 }]);
        assert_eq!(limit(&json), Err(UNREAD));
        // Products past 64 bits: the one stream's, the grid's, a tile's; and tiles whose sum is.
        let huge = json!(1u64 << 32);
        assert_eq!(limit(&one_stream(huge.clone(), huge.clone())), Err(UNREAD));
        assert_eq!(limit(&one_stream(json!(u64::MAX), json!(2))), Err(UNREAD));
        assert_eq!(
            limit(&tiled(huge.clone(), huge.clone(), &square_tiles(4, 512))),
            Err(UNREAD)
        );
        assert_eq!(
            limit(&tiled(json!(16), json!(16), &[(1 << 32, 1 << 32)])),
            Err(UNREAD)
        );
        let near = (1u64 << 32, (1u64 << 32) - 1);
        assert_eq!(
            limit(&tiled(json!(16), json!(16), &[near, near])),
            Err(UNREAD)
        );
    }

    /// The proof with its grid's own size (the `grid` item's output width and height, 16 bits each, in `idat`) set to
    /// `width` × `height`: a real file ffprobe reads, its four 512 px tiles as they are.
    fn proof_sized(width: u16, height: u16) -> Vec<u8> {
        let mut bytes = proof();
        // Version 0, flags 0, rows and columns less one (1, 1), then 1024 and 768.
        let payload = [0, 0, 1, 1, 0x04, 0x00, 0x03, 0x00];
        let found: Vec<usize> = bytes
            .windows(payload.len())
            .enumerate()
            .filter(|(_, w)| *w == payload)
            .map(|(at, _)| at)
            .collect();
        assert_eq!(found.len(), 1, "the grid's payload, once");
        let at = found[0] + 4;
        bytes[at..at + 2].copy_from_slice(&width.to_be_bytes());
        bytes[at + 2..at + 4].copy_from_slice(&height.to_be_bytes());
        bytes
    }

    #[test]
    fn a_photo_refused_for_its_pixels_starts_no_decode_and_leaves_no_file() {
        let dir = temp_dir("pixels");
        // 65535 × 65535 over four 512 px tiles: the picture itself. 16 × 16 over them is refused by the canvas check,
        // before the tile sum (the proof's canvas, 1024 × 1024, equals its tile sum); the tile sum stays covered by the
        // JSON-built tests above.
        for bytes in [proof_sized(65535, 65535), proof_sized(16, 16)] {
            let folder = dir.join("cache");
            let decoded = AtomicBool::new(false);
            let decode = |file: &Path, picture: &Picture, cap: u64| {
                decoded.store(true, Ordering::SeqCst);
                decode_command(file, picture, cap)
            };
            assert_eq!(
                decode_within(&bytes, &folder, LIMIT, &decode),
                Err(TOO_MANY_PIXELS)
            );
            assert!(!decoded.load(Ordering::SeqCst), "no decode was started");
            assert!(left_after_waiting(&folder).is_empty(), "no file left");
            // The whole command's path says the same.
            assert_eq!(picture(&bytes, &folder), Err(TOO_MANY_PIXELS));
            assert!(left_after_waiting(&folder).is_empty(), "no file left");
        }
        // The proof as it is passes the same check and reaches its decode.
        let folder = dir.join("cache");
        let decoded = AtomicBool::new(false);
        let decode = |file: &Path, picture: &Picture, cap: u64| {
            decoded.store(true, Ordering::SeqCst);
            decode_command(file, picture, cap)
        };
        assert!(decode_within(&proof(), &folder, LIMIT, &decode).is_ok());
        assert!(decoded.load(Ordering::SeqCst));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ffprobe_gives_the_sizes_the_limit_reads() {
        let dir = temp_dir("sizes");
        let heic = dir.join("proof.heic");
        fs::write(&heic, proof()).unwrap();
        let said = probe_command(&heic).output().unwrap();
        assert!(said.status.success());
        let json: Value = serde_json::from_slice(&said.stdout).unwrap();
        let component = &json["stream_groups"][0]["components"][0];
        assert_eq!(pixels_of(component), Some(1024 * 768));
        let places = component["subcomponents"].as_array().unwrap();
        let indexes: Vec<_> = places.iter().map(|p| p["stream_index"].clone()).collect();
        assert_eq!(indexes, [json!(0), json!(1), json!(2), json!(3)]);
        for stream in json["streams"].as_array().unwrap() {
            assert_eq!(pixels_of(stream), Some(512 * 512));
        }
        assert_eq!(limit(&json), Ok(()));
        let _ = fs::remove_dir_all(&dir);
    }

    // ---- Round 2: the grid's own list, the canvas, the decoder's cap ------------------------------------------------

    #[test]
    fn a_grids_places_are_read_through_its_own_stream_list_not_the_files() {
        // Four small streams first (a thumbnail, another grid's tiles), then the grid's: its places 0 to n−1 are
        // positions in its own list, whose entries are file streams 4 and on.
        let small = square_tiles(4, 16);
        let huge = tiled_after(&small, json!(16), json!(16), &square_tiles(4, 16384));
        assert_eq!(huge["stream_groups"][0]["streams"][0]["index"], 4);
        assert_eq!(
            huge["stream_groups"][0]["components"][0]["subcomponents"][0]["stream_index"],
            0
        );
        // Read as file indexes, places 0 to 3 would be the four small streams, and pass.
        assert_eq!(limit(&huge), Err(TOO_MANY_PIXELS));
        // Ordinary tiles after the same small streams pass, and the largest is a tile's own size.
        let ordinary = tiled_after(&small, json!(1024), json!(768), &square_tiles(4, 512));
        assert_eq!(largest(&ordinary), Ok(512 * 512));
        // The list's order is the grid's, whatever the file's: places follow it.
        let mut shuffled = tiled_after(
            &small,
            json!(1024),
            json!(768),
            &[(512, 512), (16384, 16384)],
        );
        shuffled["stream_groups"][0]["streams"] = json!([{ "index": 5 }, { "index": 4 }]);
        shuffled["stream_groups"][0]["components"][0]["subcomponents"] =
            json!([{ "stream_index": 1 }, { "stream_index": 1 }]);
        assert_eq!(
            largest(&shuffled),
            Ok(512 * 512),
            "place 1 is file stream 4"
        );
    }

    #[test]
    fn a_place_past_the_grids_own_list_is_unreadable() {
        // One small stream first, so file stream 4 is there (the grid's fourth tile) while the grid lists four
        // entries, positions 0 to 3: place 4 is past it.
        let mut json = tiled_after(&[(16, 16)], json!(1024), json!(768), &square_tiles(4, 512));
        assert_eq!(limit(&json), Ok(()));
        json["stream_groups"][0]["components"][0]["subcomponents"][3]["stream_index"] = json!(4);
        assert_eq!(limit(&json), Err(UNREAD));
        // A place far past it, and past what a position can be.
        json["stream_groups"][0]["components"][0]["subcomponents"][3]["stream_index"] =
            json!(u64::MAX);
        assert_eq!(limit(&json), Err(UNREAD));
        // An entry of the list with no file index, or one naming a stream the file doesn't have.
        let mut json = tiled_after(&[(16, 16)], json!(1024), json!(768), &square_tiles(4, 512));
        json["stream_groups"][0]["streams"][2] = json!({});
        assert_eq!(limit(&json), Err(UNREAD));
        json["stream_groups"][0]["streams"][2] = json!({ "index": 99 });
        assert_eq!(limit(&json), Err(UNREAD));
        // A list present but shorter than the places: the last place is past it.
        let mut json = tiled_after(&[(16, 16)], json!(1024), json!(768), &square_tiles(4, 512));
        json["stream_groups"][0]["streams"] =
            json!([{ "index": 1 }, { "index": 2 }, { "index": 3 }]);
        assert_eq!(read_picture(&json).map(|_| ()), Ok(()));
        assert_eq!(limit(&json), Err(UNREAD));
        // No list at all: `read_picture` refuses it first (it reads the grid's first stream from the list), so this
        // never reaches the places.
        let mut json = tiled_after(&[(16, 16)], json!(1024), json!(768), &square_tiles(4, 512));
        json["stream_groups"][0]
            .as_object_mut()
            .unwrap()
            .remove("streams");
        assert_eq!(limit(&json), Err(UNREAD));
    }

    #[test]
    fn a_canvas_past_the_allowance_is_refused_though_its_tiles_pass() {
        let with_canvas = |width: Value, height: Value| {
            // A 1 MP picture over two tiles of 1 MP each: 2 MP of tiles, within the 3 MP allowed. (Equal tiles: a grid's
            // placed tiles must all declare one size, so the canvas is what is checked here.)
            let mut json = tiled(json!(1000), json!(1000), &[(1000, 1000), (1000, 1000)]);
            json["stream_groups"][0]["components"][0]["coded_width"] = width;
            json["stream_groups"][0]["components"][0]["coded_height"] = height;
            json
        };
        // A canvas of 2000 × 2000: 4 MP, past twice the picture plus a megapixel.
        assert_eq!(
            limit(&with_canvas(json!(2000), json!(2000))),
            Err(TOO_MANY_PIXELS)
        );
        // Exactly the allowance passes; one pixel more is refused (3,000,001 is 1 × 3,000,001).
        assert_eq!(limit(&with_canvas(json!(3000), json!(1000))), Ok(()));
        assert_eq!(
            limit(&with_canvas(json!(1), json!(3_000_001))),
            Err(TOO_MANY_PIXELS)
        );
        // An ordinary grid: an iPhone's 48 MP photo on its 16 × 12 tiles' canvas, 8192 × 6144.
        let mut iphone = tiled(json!(8064), json!(6048), &square_tiles(16 * 12, 512));
        iphone["stream_groups"][0]["components"][0]["coded_width"] = json!(8192);
        iphone["stream_groups"][0]["components"][0]["coded_height"] = json!(6144);
        assert_eq!(largest(&iphone), Ok(512 * 512));
        // The 102 MP frame on its 3 × 3 canvas of 4096 px tiles, 12288 × 12288.
        let mut big = tiled(json!(11648), json!(8736), &square_tiles(9, 4096));
        big["stream_groups"][0]["components"][0]["coded_width"] = json!(12288);
        big["stream_groups"][0]["components"][0]["coded_height"] = json!(12288);
        assert_eq!(limit(&big), Ok(()));
        // Missing, zero, negative, not a number, or a product past 64 bits: unreadable, no panic.
        for (width, height) in [
            (Value::Null, json!(1000)),
            (json!(1000), Value::Null),
            (json!(0), json!(1000)),
            (json!(-1000), json!(1000)),
            (json!("1000"), json!(1000)),
            (json!(1000.5), json!(1000)),
            (json!(u64::MAX), json!(2)),
        ] {
            assert_eq!(
                limit(&with_canvas(width.clone(), height.clone())),
                Err(UNREAD),
                "{width} × {height}"
            );
        }
    }

    #[test]
    fn ffprobe_gives_the_canvas_the_limit_reads() {
        let dir = temp_dir("canvas");
        let heic = dir.join("proof.heic");
        fs::write(&heic, proof()).unwrap();
        let said = probe_command(&heic).output().unwrap();
        assert!(said.status.success());
        let json: Value = serde_json::from_slice(&said.stdout).unwrap();
        let component = &json["stream_groups"][0]["components"][0];
        // Two rows and two columns of 512 px tiles, cropped to 1024 × 768.
        assert_eq!(component["coded_width"], 1024);
        assert_eq!(component["coded_height"], 1024);
        assert_eq!(largest(&json), Ok(512 * 512));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_cap_goes_before_the_input_for_both_decodes() {
        let file = Path::new("photo.heic");
        let picture = Picture {
            source: Source::Grid(0),
            first: 0,
            deep: false,
            profile: true,
            primaries: None,
            transfer: None,
        };
        for command in [
            decode_command(file, &picture, 262_144),
            profile_command(file, &picture, 262_144),
        ] {
            let args: Vec<String> = command
                .get_args()
                .map(|a| a.to_string_lossy().into_owned())
                .collect();
            let cap = args.windows(2).position(|w| w == ["-max_pixels", "262144"]);
            let input = args.iter().position(|a| a == "-i");
            assert!(cap.is_some() && input.is_some() && cap < input, "{args:?}");
            assert!(args
                .windows(2)
                .any(|w| w == ["-protocol_whitelist", "file"]));
        }
        // Never past ffmpeg's own most, an `int`.
        let args: Vec<String> = decode_command(file, &picture, u64::MAX)
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert!(args.windows(2).any(|w| w == ["-max_pixels", "2147483647"]));
    }

    #[test]
    fn the_decoder_refuses_a_frame_one_pixel_over_its_cap_and_decodes_as_before_at_it() {
        let dir = temp_dir("cap");
        let folder = dir.join("cache");
        // The cap the limit gives for the proof: one 512 × 512 tile.
        let given = AtomicUsize::new(0);
        let at = |offset: i64| {
            let given = &given;
            move |file: &Path, picture: &Picture, cap: u64| {
                given.store(cap as usize, Ordering::SeqCst);
                decode_command(file, picture, cap.saturating_add_signed(offset))
            }
        };
        // One pixel below a tile's area: the decoder refuses the tile, the photo is unreadable, and no file is left.
        let below = at(-1);
        assert_eq!(decode_within(&proof(), &folder, LIMIT, &below), Err(UNREAD));
        assert_eq!(given.load(Ordering::SeqCst), 512 * 512);
        assert!(left_after_waiting(&folder).is_empty(), "no file left");
        // At the tile's area: what the decode gives with ffmpeg's own default cap, byte for byte.
        let exact = decode_within(&proof(), &folder, LIMIT, &at(0)).unwrap();
        let default =
            |file: &Path, picture: &Picture, _: u64| decode_command(file, picture, i32::MAX as u64);
        let before = decode_within(&proof(), &folder, LIMIT, &default).unwrap();
        assert_eq!(exact, before);
        assert_eq!(size(&exact), (1024, 768));
        // And the command's own path decodes it as ever.
        assert_eq!(picture(&proof(), &folder).unwrap(), exact);
        assert!(left_after_waiting(&folder).is_empty(), "no file left");
        let _ = fs::remove_dir_all(&dir);
    }

    // ---- Round 3: the cap as ffmpeg counts it, one size for every tile ---------------------------------------------

    #[test]
    fn the_decoders_cap_rounds_each_side_up_to_64() {
        assert_eq!(decoder_cap(1000, 750), Some(1024 * 768));
        assert_eq!(decoder_cap(512, 512), Some(262_144));
        assert_eq!(decoder_cap(1, 1), Some(64 * 64));
        assert_eq!(decoder_cap(4000, 3000), Some(4032 * 3008));
        // Past 64 bits: none, never a panic.
        assert_eq!(decoder_cap(u64::MAX, 1), None);
        assert_eq!(decoder_cap(1 << 32, 1 << 32), None);
        // What the limit gives the decode: a single stream's, and a grid's of 500 px tiles.
        assert_eq!(
            largest(&one_stream(json!(1000), json!(750))),
            Ok(1024 * 768)
        );
        assert_eq!(
            largest(&tiled(json!(1000), json!(1000), &square_tiles(4, 500))),
            Ok(512 * 512)
        );
    }

    #[test]
    fn ffmpeg_decodes_a_1000_by_750_picture_at_its_cap_and_refuses_it_under_1024_by_750() {
        // A width that isn't a multiple of 64: ffmpeg checks the width rounded up to its alignment, times the height.
        let dir = temp_dir("aligned");
        let still = dir.join("still.png");
        let made = video::command("ffmpeg")
            .args(["-hide_banner", "-v", "error", "-y", "-f", "lavfi"])
            .args(["-i", "color=c=red:size=1000x750:duration=0.1"])
            .args(["-frames:v", "1"])
            .arg(&still)
            .status()
            .unwrap();
        assert!(made.success());
        let decodes = |cap: u64| {
            video::command("ffmpeg")
                .args(["-hide_banner", "-v", "error"])
                .args(input_options(cap))
                .arg("-i")
                .arg(&still)
                .args(["-f", "null", "-"])
                .output()
                .unwrap()
                .status
                .success()
        };
        let cap = decoder_cap(1000, 750).unwrap();
        assert!(decodes(cap), "decodes at {cap}");
        assert!(
            !decodes(1024 * 750 - 1),
            "refused one pixel under 1024 × 750"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_grid_whose_tiles_differ_in_size_is_unreadable() {
        // One 1000 × 1000 tile and 1,999 of 1 × 1: the one cap would let every tiny tile decode at the big one's size.
        let mut tiles = vec![(1000, 1000)];
        tiles.extend(square_tiles(1999, 1));
        assert_eq!(limit(&tiled(json!(1000), json!(1000), &tiles)), Err(UNREAD));
        // The big one last: the same.
        tiles.rotate_left(1);
        assert_eq!(limit(&tiled(json!(1000), json!(1000), &tiles)), Err(UNREAD));
        // Same area, other shape: differs too.
        assert_eq!(
            limit(&tiled(
                json!(1000),
                json!(1000),
                &[(1000, 500), (500, 1000)]
            )),
            Err(UNREAD)
        );
        // Equal tiles pass as before.
        assert_eq!(
            limit(&tiled(json!(1000), json!(1000), &square_tiles(4, 500))),
            Ok(())
        );
        // Only placed tiles count: a listed stream no place uses may differ.
        let mut json = tiled(json!(1024), json!(768), &[(512, 512), (16, 16)]);
        json["stream_groups"][0]["components"][0]["subcomponents"] =
            json!([{ "stream_index": 0 }, { "stream_index": 0 }]);
        assert_eq!(largest(&json), Ok(512 * 512));
    }
}
