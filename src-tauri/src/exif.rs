//! A scout photo's date, time and place from its EXIF (6.27; Kevin, Nov 16), read on this computer from the bytes the
//! page is importing (kamadak-exif). Nothing is requested, nothing is written, and nothing is ever logged: where a
//! photo was taken is personal data. The bytes are untrusted, so the whole answer is "not there" for anything missing,
//! malformed or out of range, never an error: a photo with no EXIF imports exactly as before.
//!
//! JPEG is the format this is for; a TIFF file reads too, and a HEIF (HEIC) file (Kevin, Nov 20): its `Exif` item is
//! found by heic.rs's own box reader (`exif_item`), and its block then gets exactly what a JPEG's does. The EXIF's TIFF
//! block is checked here before the crate parses it (`block_is_safe`). A HEIF whose boxes can't be followed, or whose
//! item is stored a way that reader doesn't read, answers `heic`; PNG and WebP answer `none`: the crate gives their
//! block only already parsed (`exif_block`). No picture is decoded or converted here.
//!
//! Beside the values, the answer says why there are none (6.27 round 3, Kevin Nov 17: `Reason`), so the Locations tile
//! can say when a photo's date and place couldn't be read. The photo imports either way.

use std::borrow::Cow;
use std::io::Cursor;
use std::panic::{catch_unwind, AssertUnwindSafe};

use exif::{Exif, In, Reader, Tag, Value};
use serde::Serialize;

use crate::heic::ExifItem;
use crate::pictures::MAX_BYTES;

/// Why a photo's answer holds what it holds (6.27 round 3, Kevin Nov 17), so the page can say when a photo's date and
/// place were left out. Whatever the reason, the photo imports.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Reason {
    /// The EXIF was read: its values, or none when it held none of them.
    Read,
    /// The picture has no EXIF at all.
    None,
    /// The EXIF was refused: by the walk here, or by the crate's own error or panic.
    Refused,
    /// A HEIF (HEIC) container whose boxes can't be followed, or whose EXIF item is stored a way this doesn't read.
    Heic,
}

/// What the command answers: the four values, and why there are none when there are none.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PhotoAnswer {
    #[serde(flatten)]
    pub exif: PhotoExif,
    pub reason: Reason,
}

impl PhotoAnswer {
    const fn empty(reason: Reason) -> Self {
        Self {
            exif: PhotoExif {
                taken_at: None,
                taken_offset: None,
                latitude: None,
                longitude: None,
            },
            reason,
        }
    }
}

/// What a photo's EXIF says, each part only when it reads: the page stores them on the photo's record.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoExif {
    /// The wall-clock time as the camera wrote it, `YYYY-MM-DDTHH:mm:ss`, with no zone.
    pub taken_at: Option<String>,
    /// The camera's offset from UTC at that time (`+02:00`), only when the file says.
    pub taken_offset: Option<String>,
    /// Decimal degrees, south negative. Both or neither.
    pub latitude: Option<f64>,
    /// Decimal degrees, west negative.
    pub longitude: Option<f64>,
}

/// What the EXIF in a picture's bytes says. A file over the import's own cap (pictures.rs) is not parsed at all. The
/// command answers `answer`, with its reason; the tests read the values alone through this.
#[cfg(test)]
pub fn read(bytes: &[u8]) -> PhotoExif {
    answer(bytes).exif
}

/// What the EXIF in a picture's bytes says, with why (`Reason`). A file over the cap is refused unparsed.
pub fn answer(bytes: &[u8]) -> PhotoAnswer {
    if bytes.len() as u64 > MAX_BYTES {
        return PhotoAnswer::empty(Reason::Refused);
    }
    // The parser returns errors for malformed input; a panic in it on a crafted file must not take the command down.
    catch_unwind(AssertUnwindSafe(|| parse(bytes))).unwrap_or(PhotoAnswer::empty(Reason::Refused))
}

/// The brands a HEIF or HEIC file names in its file type box.
const HEIF_BRANDS: [&[u8]; 6] = [b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1"];
/// The brands of an AVIF, which shares HEIF's container and its `mif1` brand but is not a HEIC.
const AVIF_BRANDS: [&[u8]; 2] = [b"avif", b"avis"];
/// The most compatible brands read from the file type box: a real file names a handful.
const MAX_BRANDS: usize = 64;

/// Whether the bytes start with a file type box (`ftyp`) that names a HEIF brand, as its major brand or a compatible
/// one, and no AVIF brand. Only the first box is read, and only as far as it says it reaches (to the end for a size of
/// 0); a box with a 64-bit size (1) is not one a HEIC writes, and reads as no HEIF.
pub(crate) fn is_heif(bytes: &[u8]) -> bool {
    if bytes.get(4..8) != Some(b"ftyp".as_slice()) {
        return false;
    }
    let Some(size) = bytes
        .get(..4)
        .and_then(|b| <[u8; 4]>::try_from(b).ok())
        .map(u32::from_be_bytes)
    else {
        return false;
    };
    let end = match size {
        0 => bytes.len(),
        1 => return false,
        size => (size as usize).min(bytes.len()),
    };
    let compatible = bytes
        .get(16..end.max(16))
        .unwrap_or_default()
        .as_chunks::<4>()
        .0
        .iter()
        .take(MAX_BRANDS)
        .map(|brand| brand.as_slice());
    let brands: Vec<&[u8]> = bytes.get(8..12).into_iter().chain(compatible).collect();
    // An AVIF names `mif1` too (6.27 round 4): with an AVIF brand among them it is not a HEIC.
    let avif = brands.iter().any(|brand| AVIF_BRANDS.contains(brand));
    !avif && brands.iter().any(|brand| HEIF_BRANDS.contains(brand))
}

/// The most directory entries a block may hold over every directory the parser would visit. A camera's EXIF has 50 to
/// 150 (the primary image's, the Exif and GPS directories, a thumbnail's; maker notes are one opaque entry), a
/// many-paged TIFF a few hundred; a JPEG's whole EXIF segment (64 KB) could hold 5,460.
const MAX_ENTRIES: usize = 1024;
/// The most chained top-level directories the crate reads (its own limit, tiff.rs `parse_body`); a longer chain is
/// refused here as it is there.
const MAX_CHAIN: usize = 8;
/// The longest value of a tag this file reads (a date is 20 bytes, an offset 7, a coordinate 3 rationals).
const MAX_READ_COUNT: u32 = 64;
const READ_TAGS: [u16; 8] = [0x0132, 0x9003, 0x9010, 0x9011, 0x1, 0x2, 0x3, 0x4];

const EXIF_POINTER: u16 = 0x8769;
const GPS_POINTER: u16 = 0x8825;
const INTEROP_POINTER: u16 = 0xa005;

/// Which kind of directory is being walked, and so which pointer tags the walk follows from it.
#[derive(Clone, Copy, PartialEq)]
enum Kind {
    /// A top-level directory: may point to an Exif and a GPS directory.
    Top,
    /// The Exif directory: may point to an Interop directory.
    Exif,
    /// GPS and Interop directories point nowhere.
    Leaf,
}

/// A TIFF block's own bounds-checked reader.
struct Block<'a> {
    bytes: &'a [u8],
    little_endian: bool,
}

impl Block<'_> {
    fn u16_at(&self, at: usize) -> Option<u16> {
        let b: [u8; 2] = self.bytes.get(at..at.checked_add(2)?)?.try_into().ok()?;
        Some(if self.little_endian {
            u16::from_le_bytes(b)
        } else {
            u16::from_be_bytes(b)
        })
    }

    fn u32_at(&self, at: usize) -> Option<u32> {
        let b: [u8; 4] = self.bytes.get(at..at.checked_add(4)?)?.try_into().ok()?;
        Some(if self.little_endian {
            u32::from_le_bytes(b)
        } else {
            u32::from_be_bytes(b)
        })
    }
}

/// What the walk has seen so far.
#[derive(Default)]
struct Walked {
    directories: Vec<usize>,
    entries: usize,
}

/// One directory, checked, with every directory it points to; its "next directory" offset, or None to refuse the
/// block. Refused: a directory seen before, one that runs past the block, a second pointer of a kind in one directory,
/// a pointer that isn't one LONG or one SHORT, a pointed-to directory that chains on, an over-long value of a tag this
/// file reads, or too many entries in all.
fn walk_directory(block: &Block, at: usize, kind: Kind, walked: &mut Walked) -> Option<usize> {
    if walked.directories.contains(&at) {
        return None;
    }
    walked.directories.push(at);
    let count = usize::from(block.u16_at(at)?);
    walked.entries += count;
    if walked.entries > MAX_ENTRIES {
        return None;
    }
    let entries_at = at.checked_add(2)?;
    let next_at = entries_at.checked_add(count.checked_mul(12)?)?;
    // The whole directory is inside the block before any of it is read.
    let next = block.u32_at(next_at)? as usize;
    let (mut exif, mut gps, mut interop) = (0, 0, 0);
    for i in 0..count {
        let entry = entries_at + 12 * i;
        let tag = block.u16_at(entry)?;
        let child = match (kind, tag) {
            (Kind::Top, EXIF_POINTER) => {
                exif += 1;
                Some((Kind::Exif, exif))
            }
            (Kind::Top, GPS_POINTER) => {
                gps += 1;
                Some((Kind::Leaf, gps))
            }
            (Kind::Exif, INTEROP_POINTER) => {
                interop += 1;
                Some((Kind::Leaf, interop))
            }
            _ => None,
        };
        let Some((child_kind, seen)) = child else {
            if READ_TAGS.contains(&tag) && block.u32_at(entry + 4)? > MAX_READ_COUNT {
                return None;
            }
            continue;
        };
        // A pointer is one LONG or one SHORT (the crate reads either, `get_uint`), its value the directory's offset.
        if seen > 1 || block.u32_at(entry + 4)? != 1 {
            return None;
        }
        let to = match block.u16_at(entry + 2)? {
            4 => block.u32_at(entry + 8)? as usize,
            3 => usize::from(block.u16_at(entry + 8)?),
            _ => return None,
        };
        if walk_directory(block, to, child_kind, walked)? != 0 {
            return None;
        }
    }
    Some(next)
}

/// Whether a TIFF block passes the walk (6.27 round 2): the directories the parser would visit (the chained top-level
/// ones, each one's Exif and GPS directories, the Exif directory's Interop one) are walked here first, each within the
/// block's bounds, each visited once, and all of them together under a cap on entries. Only a block that passes is
/// parsed.
// Our own bound on the work one photo's EXIF can cause: permanent, whatever the library's version (Kevin, Nov 17).
fn block_is_safe(bytes: &[u8]) -> bool {
    let little_endian = match bytes.get(..4) {
        Some(b"II*\0") => true,
        Some(b"MM\0*") => false,
        _ => return false,
    };
    let block = Block {
        bytes,
        little_endian,
    };
    let Some(mut at) = block.u32_at(4).map(|at| at as usize) else {
        return false;
    };
    let mut walked = Walked::default();
    let mut chain = 0;
    while at != 0 {
        chain += 1;
        if chain > MAX_CHAIN {
            return false;
        }
        match walk_directory(&block, at, Kind::Top, &mut walked) {
            Some(next) => at = next,
            None => return false,
        }
    }
    true
}

/// The EXIF's TIFF block in a picture's bytes, unparsed: `Ok(None)` for a picture with none, `Err` for a JPEG whose
/// segments can't be read. A JPEG's comes from its APP1 segment (the crate's own `get_exif_attr_from_jpeg`, which only
/// copies the segment out); a TIFF file is its own block, borrowed, so nothing is copied before it is checked. A HEIF
/// (HEIC) file never comes here: `parse` asks heic.rs's box reader for its block. PNG and WebP give no block here, so
/// they answer `none`.
fn exif_block(bytes: &[u8]) -> Result<Option<Cow<'_, [u8]>>, ()> {
    if bytes.starts_with(&[0xff, 0xd8]) {
        return match exif::get_exif_attr_from_jpeg(&mut Cursor::new(bytes)) {
            Ok(block) => Ok(Some(Cow::Owned(block))),
            Err(exif::Error::NotFound(_)) => Ok(None),
            Err(_) => Err(()),
        };
    }
    Ok(
        (bytes.starts_with(b"II*\0") || bytes.starts_with(b"MM\0*"))
            .then_some(Cow::Borrowed(bytes)),
    )
}

#[cfg(test)]
thread_local! {
    /// How many blocks were handed to `read_raw` on this thread, so a test can see that a refused block never was.
    pub(crate) static RAW_READS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

fn parse(bytes: &[u8]) -> PhotoAnswer {
    let block = if is_heif(bytes) {
        // A HEIC's block from its `Exif` item (Kevin, Nov 20), then exactly what a JPEG's gets.
        match crate::heic::exif_item(bytes) {
            ExifItem::Block(block) => block,
            ExifItem::None => return PhotoAnswer::empty(Reason::None),
            ExifItem::NotFollowed => return PhotoAnswer::empty(Reason::Heic),
        }
    } else {
        match exif_block(bytes) {
            Ok(Some(block)) => block,
            Ok(None) => return PhotoAnswer::empty(Reason::None),
            Err(()) => return PhotoAnswer::empty(Reason::Refused),
        }
    };
    // Never a block the walk hasn't passed, and a copy only of one that has.
    if !block_is_safe(&block) {
        return PhotoAnswer::empty(Reason::Refused);
    }
    #[cfg(test)]
    RAW_READS.with(|reads| reads.set(reads.get() + 1));
    let Ok(exif) = Reader::new().read_raw(block.into_owned()) else {
        return PhotoAnswer::empty(Reason::Refused);
    };
    PhotoAnswer {
        exif: values(&exif),
        reason: Reason::Read,
    }
}

/// The four values a parsed EXIF gives, each only when it reads.
fn values(exif: &Exif) -> PhotoExif {
    let (taken_at, taken_offset) = taken(exif);
    let place = coordinate(
        exif,
        Tag::GPSLatitude,
        Tag::GPSLatitudeRef,
        b'N',
        b'S',
        90.0,
    )
    .zip(coordinate(
        exif,
        Tag::GPSLongitude,
        Tag::GPSLongitudeRef,
        b'E',
        b'W',
        180.0,
    ));
    // 0, 0 is what a camera with no fix writes, a point in the Gulf of Guinea: not a place a photo was taken.
    let place = place.filter(|(latitude, longitude)| *latitude != 0.0 || *longitude != 0.0);
    PhotoExif {
        taken_at,
        taken_offset,
        latitude: place.map(|(latitude, _)| latitude),
        longitude: place.map(|(_, longitude)| longitude),
    }
}

/// A tag's first ASCII value, in the primary image.
fn ascii(exif: &Exif, tag: Tag) -> Option<&[u8]> {
    match &exif.get_field(tag, In::PRIMARY)?.value {
        Value::Ascii(values) => values.first().map(Vec::as_slice),
        _ => None,
    }
}

/// When the photo was taken: `DateTimeOriginal` with `OffsetTimeOriginal`, else `DateTime` with `OffsetTime`. The
/// offset counts only beside the time it belongs to.
fn taken(exif: &Exif) -> (Option<String>, Option<String>) {
    for (time, offset) in [
        (Tag::DateTimeOriginal, Tag::OffsetTimeOriginal),
        (Tag::DateTime, Tag::OffsetTime),
    ] {
        if let Some(at) = ascii(exif, time).and_then(wall_clock) {
            return (Some(at), ascii(exif, offset).and_then(utc_offset));
        }
    }
    (None, None)
}

/// A run of ASCII digits as a number; None for anything else (a space, a sign, a blank field).
fn digits(bytes: &[u8]) -> Option<u32> {
    if bytes.is_empty() || !bytes.iter().all(u8::is_ascii_digit) {
        return None;
    }
    std::str::from_utf8(bytes).ok()?.parse().ok()
}

/// EXIF's `YYYY:MM:DD HH:MM:SS` as `YYYY-MM-DDTHH:mm:ss`, only for a real date and time: a camera that was never set
/// writes zeros or blanks, which read as not there.
fn wall_clock(text: &[u8]) -> Option<String> {
    if text.len() != 19
        || text[4] != b':'
        || text[7] != b':'
        || text[10] != b' '
        || text[13] != b':'
        || text[16] != b':'
    {
        return None;
    }
    let year = digits(&text[0..4])?;
    let month = digits(&text[5..7])?;
    let day = digits(&text[8..10])?;
    let hour = digits(&text[11..13])?;
    let minute = digits(&text[14..16])?;
    let second = digits(&text[17..19])?;
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return None,
    };
    // No digital photo is from before 1970: an earlier year is a clock that was never set (and the page's instants
    // start there).
    if year < 1970 || day < 1 || day > days || hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    Some(format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}"
    ))
}

/// EXIF's `+HH:MM` or `-HH:MM`, only within the offsets clocks use (14 hours either way).
fn utc_offset(text: &[u8]) -> Option<String> {
    if text.len() != 6 || (text[0] != b'+' && text[0] != b'-') || text[3] != b':' {
        return None;
    }
    let hours = digits(&text[1..3])?;
    let minutes = digits(&text[4..6])?;
    if hours > 14 || minutes > 59 || (hours == 14 && minutes != 0) {
        return None;
    }
    Some(format!("{}{hours:02}:{minutes:02}", char::from(text[0])))
}

/// One GPS coordinate as decimal degrees: three rationals (degrees, minutes, seconds) and the letter that says which
/// side, `positive` or `negative`. None without the letter (the side can't be guessed), for a zero denominator, for
/// minutes or seconds of 60 or more, or for a value off the Earth.
fn coordinate(
    exif: &Exif,
    tag: Tag,
    side: Tag,
    positive: u8,
    negative: u8,
    range: f64,
) -> Option<f64> {
    let Value::Rational(parts) = &exif.get_field(tag, In::PRIMARY)?.value else {
        return None;
    };
    let [degrees, minutes, seconds] = parts.as_slice() else {
        return None;
    };
    if degrees.denom == 0 || minutes.denom == 0 || seconds.denom == 0 {
        return None;
    }
    let (degrees, minutes, seconds) = (degrees.to_f64(), minutes.to_f64(), seconds.to_f64());
    if minutes >= 60.0 || seconds >= 60.0 {
        return None;
    }
    let size = degrees + minutes / 60.0 + seconds / 3600.0;
    if !size.is_finite() || size > range {
        return None;
    }
    let letter = match &exif.get_field(side, In::PRIMARY)?.value {
        Value::Ascii(values) => values.first()?.first()?.to_ascii_uppercase(),
        _ => return None,
    };
    if letter == positive {
        Some(size)
    } else if letter == negative {
        // Never -0.0, which would serialize with a sign.
        Some(if size == 0.0 { 0.0 } else { -size })
    } else {
        None
    }
}

/// Asked by the page for each picture it imports as a location's photo, with the picture's bytes as the raw request
/// body (as `sbd_tx_raw` takes its own). Always an answer; its parts are null where the file says nothing, and its
/// `reason` says why (`read`, `none`, `refused`, `heic`).
#[tauri::command]
pub async fn photo_exif(request: tauri::ipc::Request<'_>) -> Result<PhotoAnswer, String> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err("Expected the picture as raw bytes.".into());
    };
    Ok(answer(body))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// One entry of a TIFF directory, as the fixtures below write it.
    enum Entry<'a> {
        Ascii(u16, &'a str),
        /// Rationals, as (numerator, denominator).
        Rational(u16, &'a [(u32, u32)]),
        /// A pointer to another directory: filled in by `tiff`.
        Ifd(u16, usize),
    }

    /// What a made-up photo's EXIF says. The place is made up too: a point in the open sea in each test.
    #[derive(Default)]
    pub(crate) struct Fixture<'a> {
        pub date_time: Option<&'a str>,
        pub original: Option<&'a str>,
        pub offset_original: Option<&'a str>,
        pub offset: Option<&'a str>,
        /// (degrees, minutes, seconds, letter), each part a rational.
        pub latitude: Option<([(u32, u32); 3], &'a str)>,
        pub longitude: Option<([(u32, u32); 3], &'a str)>,
    }

    /// One directory's bytes at `at` in the file: the count, the 12-byte entries, no next directory, then the values
    /// that don't fit in an entry. `pointers` are the offsets its `Ifd` entries point to, by index.
    fn directory(entries: &[Entry], at: usize, pointers: &[usize]) -> Vec<u8> {
        let mut head = Vec::new();
        let mut tail: Vec<u8> = Vec::new();
        let values_at = at + 2 + 12 * entries.len() + 4;
        head.extend((entries.len() as u16).to_le_bytes());
        for entry in entries {
            let (tag, kind, count, value): (u16, u16, u32, Vec<u8>) = match entry {
                Entry::Ascii(tag, text) => {
                    let mut bytes = text.as_bytes().to_vec();
                    bytes.push(0);
                    (*tag, 2, bytes.len() as u32, bytes)
                }
                Entry::Rational(tag, parts) => (
                    *tag,
                    5,
                    parts.len() as u32,
                    parts
                        .iter()
                        .flat_map(|(n, d)| [n.to_le_bytes(), d.to_le_bytes()].concat())
                        .collect(),
                ),
                Entry::Ifd(tag, index) => {
                    (*tag, 4, 1, (pointers[*index] as u32).to_le_bytes().to_vec())
                }
            };
            head.extend(tag.to_le_bytes());
            head.extend(kind.to_le_bytes());
            head.extend(count.to_le_bytes());
            if value.len() <= 4 {
                let mut inline = value.clone();
                inline.resize(4, 0);
                head.extend(inline);
            } else {
                head.extend(((values_at + tail.len()) as u32).to_le_bytes());
                tail.extend(value);
                // Values start on an even offset.
                if tail.len() % 2 == 1 {
                    tail.push(0);
                }
            }
        }
        head.extend(0u32.to_le_bytes());
        head.extend(tail);
        head
    }

    /// The EXIF's TIFF structure, little-endian: the primary directory, then the Exif and GPS directories it points to.
    pub(crate) fn tiff(fixture: &Fixture) -> Vec<u8> {
        let mut exif_entries = Vec::new();
        if let Some(text) = fixture.original {
            exif_entries.push(Entry::Ascii(0x9003, text));
        }
        if let Some(text) = fixture.offset {
            exif_entries.push(Entry::Ascii(0x9010, text));
        }
        if let Some(text) = fixture.offset_original {
            exif_entries.push(Entry::Ascii(0x9011, text));
        }
        let mut gps_entries = Vec::new();
        if let Some((parts, letter)) = &fixture.latitude {
            gps_entries.push(Entry::Ascii(0x1, letter));
            gps_entries.push(Entry::Rational(0x2, parts));
        }
        if let Some((parts, letter)) = &fixture.longitude {
            gps_entries.push(Entry::Ascii(0x3, letter));
            gps_entries.push(Entry::Rational(0x4, parts));
        }
        let mut primary = Vec::new();
        if let Some(text) = fixture.date_time {
            primary.push(Entry::Ascii(0x0132, text));
        }
        if !exif_entries.is_empty() {
            primary.push(Entry::Ifd(0x8769, 0));
        }
        if !gps_entries.is_empty() {
            primary.push(Entry::Ifd(0x8825, 1));
        }
        // Laid out twice: once to learn each directory's length, then with the pointers known.
        let primary_len = directory(&primary, 8, &[0, 0]).len();
        let exif_at = 8 + primary_len;
        let exif_len = directory(&exif_entries, exif_at, &[]).len();
        let gps_at = exif_at + exif_len;
        let mut out = b"II*\0".to_vec();
        out.extend(8u32.to_le_bytes());
        out.extend(directory(&primary, 8, &[exif_at, gps_at]));
        out.extend(directory(&exif_entries, exif_at, &[]));
        out.extend(directory(&gps_entries, gps_at, &[]));
        out
    }

    /// A JPEG that is only its EXIF: start of image, the APP1 segment, end of image. No picture, no person, no place.
    pub(crate) fn jpeg(fixture: &Fixture) -> Vec<u8> {
        jpeg_with(&tiff(fixture))
    }

    pub(crate) fn jpeg_with(tiff: &[u8]) -> Vec<u8> {
        let mut out = vec![0xff, 0xd8, 0xff, 0xe1];
        out.extend(((2 + 6 + tiff.len()) as u16).to_be_bytes());
        out.extend(b"Exif\0\0");
        out.extend(tiff);
        out.extend([0xff, 0xd9]);
        out
    }

    fn boxed(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut out = ((8 + body.len()) as u32).to_be_bytes().to_vec();
        out.extend(kind);
        out.extend(body);
        out
    }

    /// A HEIF container that is only its EXIF item: the file type (with the `mif1` brand), then a meta box whose item
    /// info names item 1 as `Exif` and whose item location points into its own item data box.
    fn heif(fixture: &Fixture) -> Vec<u8> {
        let tiff = tiff(fixture);
        // The item: 4 bytes saying how far in the TIFF header is, then "Exif\0\0", then the TIFF.
        let mut item = 6u32.to_be_bytes().to_vec();
        item.extend(b"Exif\0\0");
        item.extend(&tiff);
        // infe, version 2: item 1, no protection, type "Exif", an empty name.
        let mut infe = vec![2, 0, 0, 0];
        infe.extend(1u16.to_be_bytes());
        infe.extend(0u16.to_be_bytes());
        infe.extend(b"Exif");
        infe.push(0);
        // iinf, version 0: one entry.
        let mut iinf = vec![0, 0, 0, 0];
        iinf.extend(1u16.to_be_bytes());
        iinf.extend(boxed(b"infe", &infe));
        // iloc, version 1: 4-byte offsets and lengths, no base offset; item 1, built from the item data box (method 1).
        let mut iloc = vec![1, 0, 0, 0, 0x44, 0x00];
        iloc.extend(1u16.to_be_bytes());
        iloc.extend(1u16.to_be_bytes());
        iloc.extend([0, 1]);
        iloc.extend(0u16.to_be_bytes());
        iloc.extend(1u16.to_be_bytes());
        iloc.extend(0u32.to_be_bytes());
        iloc.extend((item.len() as u32).to_be_bytes());
        let mut meta = vec![0, 0, 0, 0];
        meta.extend(boxed(b"iinf", &iinf));
        meta.extend(boxed(b"iloc", &iloc));
        meta.extend(boxed(b"idat", &item));
        let mut ftyp = b"heic".to_vec();
        ftyp.extend(0u32.to_be_bytes());
        ftyp.extend(b"mif1heic");
        let mut out = boxed(b"ftyp", &ftyp);
        out.extend(boxed(b"meta", &meta));
        out
    }

    const NONE: PhotoExif = PhotoExif {
        taken_at: None,
        taken_offset: None,
        latitude: None,
        longitude: None,
    };

    /// 12° 30' 36" and 45° 15' 0": made-up points, in the open sea whichever the hemispheres.
    const LATITUDE: [(u32, u32); 3] = [(12, 1), (30, 1), (3600, 100)];
    const LONGITUDE: [(u32, u32); 3] = [(45, 1), (15, 1), (0, 1)];

    #[test]
    fn reads_the_time_taken_with_its_offset_when_the_file_has_one() {
        let with = read(&jpeg(&Fixture {
            original: Some("2026:11:03 16:42:07"),
            offset_original: Some("+02:00"),
            date_time: Some("2026:11:05 09:00:00"),
            ..Default::default()
        }));
        assert_eq!(with.taken_at.as_deref(), Some("2026-11-03T16:42:07"));
        assert_eq!(with.taken_offset.as_deref(), Some("+02:00"));
        let without = read(&jpeg(&Fixture {
            original: Some("2026:11:03 16:42:07"),
            ..Default::default()
        }));
        assert_eq!(without.taken_at.as_deref(), Some("2026-11-03T16:42:07"));
        assert_eq!(without.taken_offset, None);
        assert_eq!((without.latitude, without.longitude), (None, None));
    }

    #[test]
    fn falls_back_to_the_files_date_time_and_its_own_offset() {
        let read_back = read(&jpeg(&Fixture {
            date_time: Some("2026:02:28 23:59:59"),
            offset: Some("-05:30"),
            // Belongs to a time the file doesn't have: never paired with another.
            offset_original: Some("+09:00"),
            ..Default::default()
        }));
        assert_eq!(read_back.taken_at.as_deref(), Some("2026-02-28T23:59:59"));
        assert_eq!(read_back.taken_offset.as_deref(), Some("-05:30"));
    }

    #[test]
    fn a_time_that_is_not_one_reads_as_not_there() {
        for odd in [
            "0000:00:00 00:00:00",
            "    :  :     :  :  ",
            "2026:13:01 10:00:00",
            "2026:02:30 10:00:00",
            "2025:02:29 10:00:00",
            "2026:11:03 24:00:00",
            "2026:11:03 16:60:00",
            "2026-11-03 16:42:07",
            "2026:11:03",
        ] {
            let read_back = read(&jpeg(&Fixture {
                original: Some(odd),
                offset_original: Some("+02:00"),
                ..Default::default()
            }));
            assert_eq!(read_back, NONE, "{odd}");
        }
        // A leap day is a day.
        assert_eq!(
            read(&jpeg(&Fixture {
                original: Some("2028:02:29 10:00:00"),
                ..Default::default()
            }))
            .taken_at
            .as_deref(),
            Some("2028-02-29T10:00:00")
        );
        // An offset that is not one is left out; the time stays.
        for odd in ["+2:00", "02:00", "+15:00", "+14:30", "+02:60", "Z", ""] {
            let read_back = read(&jpeg(&Fixture {
                original: Some("2026:11:03 16:42:07"),
                offset_original: Some(odd),
                ..Default::default()
            }));
            assert_eq!(
                read_back.taken_at.as_deref(),
                Some("2026-11-03T16:42:07"),
                "{odd}"
            );
            assert_eq!(read_back.taken_offset, None, "{odd}");
        }
    }

    #[test]
    fn reads_the_place_in_each_hemisphere() {
        let size = (12.0 + 30.0 / 60.0 + 36.0 / 3600.0, 45.0 + 15.0 / 60.0);
        for (north, east, expected) in [
            ("N", "E", (size.0, size.1)),
            ("N", "W", (size.0, -size.1)),
            ("S", "E", (-size.0, size.1)),
            ("S", "W", (-size.0, -size.1)),
        ] {
            let read_back = read(&jpeg(&Fixture {
                latitude: Some((LATITUDE, north)),
                longitude: Some((LONGITUDE, east)),
                ..Default::default()
            }));
            assert_eq!(
                (read_back.latitude, read_back.longitude),
                (Some(expected.0), Some(expected.1)),
                "{north} {east}"
            );
            assert_eq!(read_back.taken_at, None);
        }
        // Every decimal the file gives is kept: 12.51 degrees exactly, not rounded to a display's places.
        assert_eq!(size.0, 12.51);
    }

    #[test]
    fn a_place_that_is_not_one_reads_as_not_there() {
        let place = |latitude: ([(u32, u32); 3], &'static str),
                     longitude: ([(u32, u32); 3], &'static str)| {
            let read_back = read(&jpeg(&Fixture {
                latitude: Some(latitude),
                longitude: Some(longitude),
                original: Some("2026:11:03 16:42:07"),
                ..Default::default()
            }));
            // The time is read whatever the place.
            assert_eq!(read_back.taken_at.as_deref(), Some("2026-11-03T16:42:07"));
            (read_back.latitude, read_back.longitude)
        };
        let none = (None, None);
        // Off the Earth.
        assert_eq!(
            place(([(91, 1), (0, 1), (0, 1)], "N"), (LONGITUDE, "E")),
            none
        );
        assert_eq!(
            place((LATITUDE, "N"), ([(181, 1), (0, 1), (0, 1)], "E")),
            none
        );
        // A zero denominator, minutes of 60, a letter that names no side, the letters swapped.
        assert_eq!(
            place(([(12, 0), (30, 1), (0, 1)], "N"), (LONGITUDE, "E")),
            none
        );
        assert_eq!(
            place(([(12, 1), (60, 1), (0, 1)], "N"), (LONGITUDE, "E")),
            none
        );
        assert_eq!(place((LATITUDE, "X"), (LONGITUDE, "E")), none);
        assert_eq!(place((LATITUDE, "E"), (LONGITUDE, "N")), none);
        // A camera with no fix writes 0, 0.
        let zero = [(0, 1), (0, 1), (0, 1)];
        assert_eq!(place((zero, "N"), (zero, "E")), none);
        // One half alone is no place.
        let half = read(&jpeg(&Fixture {
            latitude: Some((LATITUDE, "N")),
            ..Default::default()
        }));
        assert_eq!((half.latitude, half.longitude), none);
        // On the equator, west: a place, and its 0 has no sign.
        let equator = place((zero, "S"), (LONGITUDE, "W"));
        assert_eq!(equator, (Some(0.0), Some(-45.25)));
        assert!(equator.0.is_some_and(|l| l.is_sign_positive()));
    }

    #[test]
    fn a_picture_with_no_exif_reads_as_nothing() {
        // A JPEG with no APP1 segment, a PNG's first bytes, text, nothing.
        assert_eq!(read(&[0xff, 0xd8, 0xff, 0xd9]), NONE);
        assert_eq!(read(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR"), NONE);
        assert_eq!(read(b"not a picture"), NONE);
        assert_eq!(read(&[]), NONE);
        // EXIF with neither a time nor a place.
        assert_eq!(read(&jpeg(&Fixture::default())), NONE);
    }

    #[test]
    fn truncated_and_garbage_exif_never_panics_and_reads_as_nothing() {
        let whole = jpeg(&Fixture {
            original: Some("2026:11:03 16:42:07"),
            offset_original: Some("+02:00"),
            latitude: Some((LATITUDE, "N")),
            longitude: Some((LONGITUDE, "E")),
            ..Default::default()
        });
        assert_eq!(
            read(&whole).taken_at.as_deref(),
            Some("2026-11-03T16:42:07")
        );
        // Cut at every length: whatever is read, nothing panics, and a file cut inside its EXIF gives nothing (the
        // last two bytes are the end-of-image marker, which the EXIF doesn't need).
        for length in 0..whole.len() {
            let cut = read(&whole[..length]);
            if length < whole.len() - 2 {
                assert_eq!(cut, NONE, "cut at {length}");
            }
        }
        // Garbage after the marker: every byte of the TIFF replaced, one pattern after another.
        for seed in 0u8..=255 {
            let mut garbage = whole.clone();
            for (i, byte) in garbage.iter_mut().enumerate().skip(12) {
                *byte = seed
                    .wrapping_mul(31)
                    .wrapping_add((i as u8).wrapping_mul(seed | 1));
            }
            let _ = read(&garbage);
        }
        // Each byte of the EXIF flipped in turn: read or not, never a panic, and never a value out of range.
        for at in 4..whole.len() {
            let mut flipped = whole.clone();
            flipped[at] ^= 0xff;
            let read_back = read(&flipped);
            assert!(read_back.latitude.is_none_or(|l| l.abs() <= 90.0));
            assert!(read_back.longitude.is_none_or(|l| l.abs() <= 180.0));
            assert_eq!(read_back.latitude.is_some(), read_back.longitude.is_some());
        }
        // Directories that point at themselves and far past the end. The primary directory here has one entry (the
        // pointer to the Exif directory), so its "next directory" is the 4 bytes after it: pointed back at itself.
        let mut looped = tiff(&Fixture {
            original: Some("2026:11:03 16:42:07"),
            ..Default::default()
        });
        let next = 8 + 2 + 12;
        looped[next..next + 4].copy_from_slice(&8u32.to_le_bytes());
        let _ = read(&jpeg_with(&looped));
        let mut far = b"II*\0".to_vec();
        far.extend(0xffff_fff0u32.to_le_bytes());
        assert_eq!(read(&jpeg_with(&far)), NONE);
    }

    #[test]
    fn a_file_over_the_cap_is_not_parsed() {
        let mut big = jpeg(&Fixture {
            original: Some("2026:11:03 16:42:07"),
            ..Default::default()
        });
        // Read while it is under the cap, with anything after its end.
        big.resize(MAX_BYTES as usize, 0);
        assert_eq!(read(&big).taken_at.as_deref(), Some("2026-11-03T16:42:07"));
        big.push(0);
        assert_eq!(read(&big), NONE);
    }

    /// One raw directory entry: tag, type, count, and the four value bytes as a number.
    pub(crate) type Raw = (u16, u16, u32, u32);

    /// A directory written as given, with no checks: its count, its entries, the offset of the next one.
    pub(crate) fn raw_directory(entries: &[Raw], next: u32) -> Vec<u8> {
        let mut out = (entries.len() as u16).to_le_bytes().to_vec();
        for (tag, kind, count, value) in entries {
            out.extend(tag.to_le_bytes());
            out.extend(kind.to_le_bytes());
            out.extend(count.to_le_bytes());
            out.extend(value.to_le_bytes());
        }
        out.extend(next.to_le_bytes());
        out
    }

    pub(crate) fn raw_block(parts: &[Vec<u8>]) -> Vec<u8> {
        let mut out = b"II*\0".to_vec();
        out.extend(8u32.to_le_bytes());
        for part in parts {
            out.extend(part);
        }
        out
    }

    /// How long a directory of n entries is, in bytes.
    pub(crate) const fn directory_len(n: usize) -> usize {
        2 + 12 * n + 4
    }

    pub(crate) const WHEN: &[u8] = b"2026:11:03 16:42:07\0";
    /// A `DateTime` entry whose 20 bytes sit at `at`.
    pub(crate) const fn date_time(at: usize) -> Raw {
        (0x0132, 2, 20, at as u32)
    }
    /// An entry nothing reads: one byte.
    const FILLER: Raw = (0x9999, 1, 1, 0);

    /// A block the walk refuses.
    pub(crate) fn refused_block(n: usize) -> Vec<u8> {
        let entries: Vec<Raw> = (0..n)
            .map(|i| (if i < n / 2 { 0x8769 } else { 0xa005 }, 4, 1, 8))
            .collect();
        raw_block(&[raw_directory(&entries, 0)])
    }

    #[test]
    fn a_block_the_walk_refuses_is_never_parsed() {
        // A small one, a large one, and the most a JPEG's segment can hold.
        for n in [30, 1000, 5400] {
            let block = refused_block(n);
            assert!(!block_is_safe(&block), "n = {n}");
            assert_eq!(read(&jpeg_with(&block)), NONE, "n = {n}");
            // As a TIFF file of its own, too.
            assert_eq!(read(&block), NONE, "n = {n}");
        }
        // Big-endian, the same.
        let mut big = b"MM\0*".to_vec();
        big.extend(8u32.to_be_bytes());
        big.extend(2u16.to_be_bytes());
        for tag in [0x8769u16, 0xa005] {
            big.extend(tag.to_be_bytes());
            big.extend(4u16.to_be_bytes());
            big.extend(1u32.to_be_bytes());
            big.extend(8u32.to_be_bytes());
        }
        big.extend(0u32.to_be_bytes());
        assert!(!block_is_safe(&big));
        assert_eq!(read(&jpeg_with(&big)), NONE);
    }

    #[test]
    fn a_block_is_parsed_only_when_each_directory_is_visited_once() {
        let one = directory_len(1);
        let two = directory_len(2);
        // A control: a date in the first directory reads, as a JPEG's EXIF and as a TIFF file.
        let good = raw_block(&[raw_directory(&[date_time(8 + one)], 0), WHEN.to_vec()]);
        assert!(block_is_safe(&good));
        for file in [jpeg_with(&good), good.clone()] {
            assert_eq!(read(&file).taken_at.as_deref(), Some("2026-11-03T16:42:07"));
        }
        // The first directory pointing at itself as its own Exif directory.
        let own = raw_block(&[
            raw_directory(&[date_time(8 + two), (0x8769, 4, 1, 8)], 0),
            WHEN.to_vec(),
        ]);
        assert!(!block_is_safe(&own));
        assert_eq!(read(&jpeg_with(&own)), NONE);
        // Two GPS pointers in one directory, to two different, harmless directories.
        let three = directory_len(3);
        let gps_at = (8 + three + WHEN.len()) as u32;
        let twice = raw_block(&[
            raw_directory(
                &[
                    date_time(8 + three),
                    (0x8825, 4, 1, gps_at),
                    (0x8825, 4, 1, gps_at + one as u32),
                ],
                0,
            ),
            WHEN.to_vec(),
            raw_directory(&[FILLER], 0),
            raw_directory(&[FILLER], 0),
        ]);
        assert!(!block_is_safe(&twice));
        assert_eq!(read(&jpeg_with(&twice)), NONE);
        // One of them: read.
        let once = raw_block(&[
            raw_directory(
                &[
                    date_time(8 + two),
                    (0x8825, 4, 1, (8 + two + WHEN.len()) as u32),
                ],
                0,
            ),
            WHEN.to_vec(),
            raw_directory(&[FILLER], 0),
        ]);
        assert!(block_is_safe(&once));
        assert_eq!(
            read(&jpeg_with(&once)).taken_at.as_deref(),
            Some("2026-11-03T16:42:07")
        );
        // The Exif and the GPS pointer naming the same directory; a pointed-to directory that chains on; a pointer
        // that isn't one LONG or one SHORT; a pointer past the end.
        let shared = (8 + two) as u32;
        for entries in [
            [(0x8769, 4, 1, shared), (0x8825, 4, 1, shared)],
            [(0x8769, 1, 1, shared), FILLER],
            [(0x8769, 4, 2, shared), FILLER],
            [(0x8825, 4, 1, 60_000), FILLER],
        ] {
            let block = raw_block(&[raw_directory(&entries, 0), raw_directory(&[FILLER], 0)]);
            assert!(!block_is_safe(&block), "{entries:?}");
            assert_eq!(read(&jpeg_with(&block)), NONE, "{entries:?}");
        }
        let chained_child = raw_block(&[
            raw_directory(&[(0x8769, 4, 1, (8 + one) as u32)], 0),
            raw_directory(&[FILLER], 8),
        ]);
        assert!(!block_is_safe(&chained_child));
        // An over-long value for a tag this file reads: never built.
        let long = raw_block(&[raw_directory(&[(0x0132, 2, 65, 8)], 0), vec![b'1'; 80]]);
        assert!(!block_is_safe(&long));
        assert_eq!(read(&jpeg_with(&long)), NONE);
    }

    #[test]
    fn a_chain_of_eight_directories_reads_and_nine_does_not() {
        let one = directory_len(1);
        let chain = |length: usize| {
            let mut parts = Vec::new();
            for i in 0..length {
                let next = if i + 1 < length {
                    (8 + one * (i + 1)) as u32
                } else {
                    0
                };
                // The first holds the date, written after the last directory.
                let entry = if i == 0 {
                    date_time(8 + one * length)
                } else {
                    FILLER
                };
                parts.push(raw_directory(&[entry], next));
            }
            parts.push(WHEN.to_vec());
            raw_block(&parts)
        };
        assert!(block_is_safe(&chain(8)));
        assert_eq!(
            read(&jpeg_with(&chain(8))).taken_at.as_deref(),
            Some("2026-11-03T16:42:07")
        );
        assert!(!block_is_safe(&chain(9)));
        assert_eq!(read(&jpeg_with(&chain(9))), NONE);
        // A chain that comes back to its first directory.
        let round = raw_block(&[
            raw_directory(&[FILLER], (8 + one) as u32),
            raw_directory(&[FILLER], 8),
        ]);
        assert!(!block_is_safe(&round));
        assert_eq!(read(&jpeg_with(&round)), NONE);
    }

    /// The library's own fix (0.6.2, GHSA-53gf-vqf6-qvp8: an IFD already parsed isn't visited again) under our walk:
    /// a chain that comes back to an earlier directory is refused by the walk, and read straight by the library, as
    /// `parse` would with the walk bypassed, returns, refusing it.
    #[test]
    fn a_chain_back_to_an_earlier_directory_is_refused_and_the_library_alone_still_returns() {
        let one = directory_len(1);
        let two = directory_len(2);
        // Three directories: the third chains back to the second; the first also holds the date.
        let back = raw_block(&[
            raw_directory(&[date_time(8 + two + 2 * one), FILLER], (8 + two) as u32),
            raw_directory(&[FILLER], (8 + two + one) as u32),
            raw_directory(&[FILLER], (8 + two) as u32),
            WHEN.to_vec(),
        ]);
        assert!(!block_is_safe(&back));
        assert_eq!(read(&jpeg_with(&back)), NONE);
        assert_eq!(read(&back), NONE);
        // The library alone, as `parse` calls it: since 0.6.2 it returns, refusing the directory it has seen.
        assert!(Reader::new().read_raw(back).is_err());
        // A directory chaining to itself, too.
        let own = raw_block(&[raw_directory(&[FILLER], 8)]);
        assert!(!block_is_safe(&own));
        assert!(Reader::new().read_raw(own).is_err());
    }

    #[test]
    fn more_entries_than_the_cap_are_never_parsed() {
        let with = |entries: usize| {
            let mut list = vec![FILLER; entries];
            list[0] = date_time(8 + directory_len(entries));
            raw_block(&[raw_directory(&list, 0), WHEN.to_vec()])
        };
        // At the cap: read.
        assert!(block_is_safe(&with(MAX_ENTRIES)));
        assert_eq!(
            read(&jpeg_with(&with(MAX_ENTRIES))).taken_at.as_deref(),
            Some("2026-11-03T16:42:07")
        );
        // One over, in one directory.
        assert!(!block_is_safe(&with(MAX_ENTRIES + 1)));
        assert_eq!(read(&jpeg_with(&with(MAX_ENTRIES + 1))), NONE);
        // Over it across two directories, each under it.
        let half = MAX_ENTRIES / 2 + 1;
        let first = directory_len(half);
        let split = raw_block(&[
            raw_directory(&vec![FILLER; half], (8 + first) as u32),
            raw_directory(&vec![FILLER; half], 0),
        ]);
        assert!(!block_is_safe(&split));
        assert_eq!(read(&jpeg_with(&split)), NONE);
    }

    #[test]
    fn a_year_before_1970_reads_as_not_there() {
        for (written, expected) in [
            ("1969:12:31 23:59:59", None),
            ("1904:01:01 00:00:00", None),
            ("0001:01:01 00:00:00", None),
            ("1970:01:01 00:00:00", Some("1970-01-01T00:00:00")),
        ] {
            let read_back = read(&jpeg(&Fixture {
                original: Some(written),
                offset_original: Some("+02:00"),
                ..Default::default()
            }));
            assert_eq!(read_back.taken_at.as_deref(), expected, "{written}");
            assert_eq!(read_back.taken_offset.is_some(), expected.is_some());
        }
    }

    /// The real-HEIC check (Kevin, Nov 20), run by hand by the main session, never in CI:
    /// `SB_SAMPLE_HEICS=<folder> cargo test real_heics -- --ignored --nocapture`. For every .heic and .heif in the
    /// folder, one line: its number in name order, whether a date and a place were read, and the answer's reason. Real
    /// photos hold where and when they were taken, so nothing else is printed: never a name, a path, a date, a time
    /// or a coordinate. Nothing is written.
    #[test]
    #[ignore = "reads a folder of real photos named by SB_SAMPLE_HEICS; run by hand"]
    fn real_heics_say_whether_their_date_and_place_read() {
        let Some(folder) = std::env::var_os("SB_SAMPLE_HEICS") else {
            panic!("SB_SAMPLE_HEICS names no folder");
        };
        let Ok(entries) = std::fs::read_dir(&folder) else {
            panic!("the SB_SAMPLE_HEICS folder couldn't be read");
        };
        let mut paths: Vec<std::path::PathBuf> = entries
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| {
                path.extension().and_then(|e| e.to_str()).is_some_and(|e| {
                    e.eq_ignore_ascii_case("heic") || e.eq_ignore_ascii_case("heif")
                })
            })
            .collect();
        paths.sort();
        assert!(!paths.is_empty(), "the folder holds no .heic or .heif");
        // As the JPEG check: the default hook would print a caught panic's message, which may hold the file's values.
        let old_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let word = |yes: bool| if yes { "yes" } else { "no" };
        for (index, path) in paths.iter().enumerate() {
            let n = index + 1;
            let Ok(bytes) = std::fs::read(path) else {
                println!("{n}: couldn't be read");
                continue;
            };
            let found = answer(&bytes);
            let reason = match found.reason {
                Reason::Read => "read",
                Reason::None => "none",
                Reason::Refused => "refused",
                Reason::Heic => "heic",
            };
            println!(
                "{n}: date {}, place {}, reason {reason}",
                word(found.exif.taken_at.is_some()),
                word(found.exif.latitude.is_some()),
            );
        }
        std::panic::set_hook(old_hook);
    }

    #[test]
    fn a_pointer_stored_as_one_short_is_followed_as_the_crate_follows_it() {
        let two = directory_len(2);
        let exif_at = 8 + two + WHEN.len();
        // The Exif directory's pointer as one SHORT (round 3, L-F): its directory holds the time taken.
        let short = raw_block(&[
            raw_directory(&[date_time(8 + two), (0x8769, 3, 1, exif_at as u32)], 0),
            WHEN.to_vec(),
            raw_directory(&[(0x9003, 2, 20, (exif_at + directory_len(1)) as u32)], 0),
            b"2026:11:04 07:15:00\0".to_vec(),
        ]);
        assert!(block_is_safe(&short));
        assert_eq!(
            read(&jpeg_with(&short)).taken_at.as_deref(),
            Some("2026-11-04T07:15:00")
        );
        // Pointing at itself as a SHORT: refused as a LONG would be.
        let own = raw_block(&[raw_directory(&[(0x8769, 3, 1, 8), FILLER], 0)]);
        assert!(!block_is_safe(&own));
        // Two SHORTs, or a BYTE: not one pointer.
        for (kind, count) in [(3, 2), (1, 1)] {
            let odd = raw_block(&[
                raw_directory(&[(0x8769, kind, count, (8 + two) as u32), FILLER], 0),
                raw_directory(&[FILLER], 0),
            ]);
            assert!(!block_is_safe(&odd), "{kind} {count}");
        }
    }

    #[test]
    fn each_answer_says_why_it_holds_what_it_holds() {
        let good = jpeg(&Fixture {
            original: Some("2026:11:03 16:42:07"),
            ..Default::default()
        });
        assert_eq!(answer(&good).reason, Reason::Read);
        assert_eq!(answer(&good).exif, read(&good));
        // EXIF with none of the four values is still read.
        assert_eq!(answer(&jpeg(&Fixture::default())).reason, Reason::Read);
        // No EXIF at all: a JPEG without APP1, a PNG, text, nothing.
        for none in [
            &[0xff, 0xd8, 0xff, 0xd9][..],
            b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR",
            b"not a picture",
            b"",
        ] {
            assert_eq!(answer(none), PhotoAnswer::empty(Reason::None));
        }
        // Refused by the walk, as a JPEG's EXIF and as a TIFF file.
        for n in [30, 1000] {
            assert_eq!(
                answer(&jpeg_with(&refused_block(n))),
                PhotoAnswer::empty(Reason::Refused)
            );
            assert_eq!(
                answer(&refused_block(n)),
                PhotoAnswer::empty(Reason::Refused)
            );
        }
        // Refused by the crate: a block the walk passes (an entry nothing reads, its value past the end) that
        // `read_raw` rejects.
        let rejected = raw_block(&[raw_directory(&[(0x9999, 4, 100, 60_000)], 0)]);
        assert!(block_is_safe(&rejected));
        assert!(Reader::new().read_raw(rejected.clone()).is_err());
        assert_eq!(
            answer(&jpeg_with(&rejected)),
            PhotoAnswer::empty(Reason::Refused)
        );
        // A JPEG cut inside its EXIF segment: refused, not "none".
        assert_eq!(answer(&good[..12]).reason, Reason::Refused);
        // Over the cap: refused unparsed.
        let mut big = good.clone();
        big.resize(MAX_BYTES as usize + 1, 0);
        assert_eq!(answer(&big), PhotoAnswer::empty(Reason::Refused));
        // The answer as the page reads it: the four values and the reason, side by side.
        assert_eq!(
            serde_json::to_value(answer(&good)).unwrap(),
            serde_json::json!({
                "takenAt": "2026-11-03T16:42:07",
                "takenOffset": null,
                "latitude": null,
                "longitude": null,
                "reason": "read"
            })
        );
    }

    #[test]
    fn a_heif_container_is_named_by_its_brand_and_nothing_else_is() {
        let whole = heif(&Fixture {
            original: Some("2026:11:03 16:42:07"),
            ..Default::default()
        });
        assert_eq!(answer(&whole), PhotoAnswer::empty(Reason::Heic));
        // Each brand, as the major brand or a compatible one, in a file type box alone.
        let ftyp = |major: &[u8; 4], compatible: &[&[u8; 4]]| {
            let mut body = major.to_vec();
            body.extend(0u32.to_be_bytes());
            for brand in compatible {
                body.extend(*brand);
            }
            boxed(b"ftyp", &body)
        };
        for brand in HEIF_BRANDS {
            let brand: &[u8; 4] = brand.try_into().unwrap();
            assert_eq!(answer(&ftyp(brand, &[])).reason, Reason::Heic);
            assert_eq!(
                answer(&ftyp(b"isom", &[b"mp41", brand])).reason,
                Reason::Heic
            );
        }
        // An MP4's or an AVIF's brands are not HEIC's: no EXIF read.
        assert_eq!(answer(&ftyp(b"isom", &[b"mp41"])).reason, Reason::None);
        assert_eq!(answer(&ftyp(b"avif", &[b"avis"])).reason, Reason::None);
        // An AVIF names `mif1` too (round 4): still not a HEIC, by its major brand or a compatible one.
        assert_eq!(
            answer(&ftyp(b"avif", &[b"avif", b"mif1", b"miaf"])).reason,
            Reason::None
        );
        assert_eq!(
            answer(&ftyp(b"mif1", &[b"avif", b"miaf"])).reason,
            Reason::None
        );
        // A brand past the first box doesn't count, nor one past the box's own size.
        let mut after = ftyp(b"isom", &[b"mp41"]);
        after.extend(b"heic");
        assert_eq!(answer(&after).reason, Reason::None);
        // Cut anywhere, never a panic.
        for length in 0..whole.len() {
            let _ = answer(&whole[..length]);
        }
    }

    #[test]
    fn a_heif_container_reads_as_nothing_until_its_block_can_be_checked() {
        let whole = heif(&Fixture {
            original: Some("2026:11:03 16:42:07"),
            offset_original: Some("-08:00"),
            latitude: Some((LATITUDE, "S")),
            longitude: Some((LONGITUDE, "W")),
            ..Default::default()
        });
        // The fixture is a HEIF container the crate reads EXIF from (its block is the test's own, made to pass the
        // walk)...
        let unchecked = Reader::new()
            .read_from_container(&mut Cursor::new(&whole[..]))
            .expect("the fixture is a HEIF container with EXIF");
        assert!(unchecked
            .get_field(Tag::DateTimeOriginal, In::PRIMARY)
            .is_some());
        // ...but its item is stored in its item data box (`idat`, construction method 1), which the box reader doesn't
        // follow (Nov 20), and it has no primary item: it answers `heic`, so `read` answers nothing for it, cut short
        // or whole, and never panics.
        assert_eq!(read(&whole), NONE);
        for length in 0..whole.len() {
            assert_eq!(read(&whole[..length]), NONE);
        }
        // PNG and WebP containers likewise: nothing.
        assert_eq!(read(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR"), NONE);
        assert_eq!(read(b"RIFF\x10\0\0\0WEBPEXIF"), NONE);
    }

    /// The real-JPEG guard check (6.27b, round 2's reviewer, Kevin Nov 18), run by hand by the main session, never in
    /// CI: `SB_SAMPLE_JPEGS=<folder> cargo test real_jpegs -- --ignored --nocapture`. For every .jpg and .jpeg in the
    /// folder, (1) the walk passes its EXIF block, and (2) what the app reads through the walk equals what the crate
    /// reads from the same block without it. A file with no EXIF block has nothing to refuse and reads as nothing both
    /// ways. Real photos hold where and when they were taken, so the output and every failure name a file only by its
    /// number in name order: never its name, its path, a date, a time or a coordinate.
    #[test]
    #[ignore = "reads a folder of real photos named by SB_SAMPLE_JPEGS; run by hand"]
    fn real_jpegs_pass_the_walk_and_read_the_same_without_it() {
        let Some(folder) = std::env::var_os("SB_SAMPLE_JPEGS") else {
            panic!("SB_SAMPLE_JPEGS names no folder");
        };
        let Ok(entries) = std::fs::read_dir(&folder) else {
            panic!("the SB_SAMPLE_JPEGS folder couldn't be read");
        };
        let mut paths: Vec<std::path::PathBuf> = entries
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| {
                path.extension().and_then(|e| e.to_str()).is_some_and(|e| {
                    e.eq_ignore_ascii_case("jpg") || e.eq_ignore_ascii_case("jpeg")
                })
            })
            .collect();
        paths.sort();
        assert!(!paths.is_empty(), "the folder holds no .jpg or .jpeg");
        // A panic the library raises on a file is caught below, but the default hook would print its message, which
        // may hold the file's own values: silenced for the loop, the old hook back before the test's own assert.
        let old_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let mut failed: Vec<usize> = Vec::new();
        for (index, path) in paths.iter().enumerate() {
            let n = index + 1;
            let Ok(bytes) = std::fs::read(path) else {
                println!("{n}: couldn't be read");
                failed.push(n);
                continue;
            };
            let (safe, same) = match exif_block(&bytes) {
                Ok(None) => (true, answer(&bytes).exif == PhotoExif::default()),
                Err(()) => (false, false),
                Ok(Some(block)) => {
                    let safe = block_is_safe(&block);
                    let unguarded = catch_unwind(AssertUnwindSafe(|| {
                        Reader::new()
                            .read_raw(block.to_vec())
                            .map(|exif| values(&exif))
                            .unwrap_or_default()
                    }))
                    .unwrap_or_default();
                    (safe, answer(&bytes).exif == unguarded)
                }
            };
            let word = |yes: bool| if yes { "yes" } else { "no" };
            println!("{n}: safe {}, same {}", word(safe), word(same));
            if !safe || !same {
                failed.push(n);
            }
        }
        std::panic::set_hook(old_hook);
        assert!(
            failed.is_empty(),
            "files failing the check, by number: {failed:?}"
        );
    }
}
