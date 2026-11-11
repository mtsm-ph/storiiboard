//! This computer's fonts for a board's text (5.1a; Kevin, Nov 10). Two commands: the families with their styles, read
//! once per session and kept, and one font's bytes with its OpenType `fsType` bits. The page draws a system font by
//! loading these bytes into a `FontFace`, so it doesn't depend on what the webview lets pages see. Nothing is written
//! and nothing leaves the computer; a board stores only family, weight and italic, never font bytes.
//!
//! font-kit reaches the system's fonts through the platform's own font service: CoreText on macOS and DirectWrite on
//! Windows. Adobe Fonts that are activated register with the system (Creative Cloud puts them where the OS lists them),
//! so they appear with the rest. On Linux (tested, not shipped) it reads fontconfig, loaded at run time.
//!
//! Two things keep one odd font from spoiling the rest: font-kit's sources and loaders can panic on a malformed font, so
//! each family and each face is read inside `catch_unwind` and skipped if it does; and a face inside a collection
//! (.ttc, .otc) is cut out into a font file of its own here, since a browser draws only the first face of a collection.

use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::OnceLock;

use font_kit::handle::Handle;
use font_kit::properties::Style;
use font_kit::source::SystemSource;
use serde::Serialize;

/// One face of a family: what a board stores (weight, italic) and the name the bytes are asked for by.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FontStyleInfo {
    /// The weight rounded to the nearest 100, as CSS and a board have it (a board stores 100 to 900 in hundreds, so a
    /// Semilight face is the 300 or 400 it rounds to; `real_weight` keeps the two apart in the list's order).
    pub weight: u16,
    /// The weight the font says (450 stays 450), so two faces that round alike stay apart.
    pub real_weight: u16,
    pub italic: bool,
    pub postscript_name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FontFamily {
    pub name: String,
    pub styles: Vec<FontStyleInfo>,
}

/// The licensing bits of the OS/2 table's `fsType`. 5.6's PDF rule reads them: a font whose bits forbid it is never
/// embedded. 5.1a only reads and keeps them.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FsType {
    /// 0x0002: restricted licence, no embedding.
    pub restricted: bool,
    /// 0x0004: preview and print embedding.
    pub preview_print: bool,
    /// 0x0008: editable embedding.
    pub editable: bool,
    /// 0x0100: no subsetting.
    pub no_subsetting: bool,
    /// 0x0200: bitmap embedding only.
    pub bitmap_only: bool,
    /// The number as the font has it.
    pub raw: u16,
}

/// `fsType` from an OS/2 table: a 16-bit number at byte 8 (version, xAvgCharWidth, usWeightClass and usWidthClass come
/// first, two bytes each). A missing or too-short table says nothing (None), which is not the same as "installable".
pub fn parse_fs_type(os2: Option<&[u8]>) -> Option<FsType> {
    let table = os2?;
    let bytes: [u8; 2] = table.get(8..10)?.try_into().ok()?;
    let raw = u16::from_be_bytes(bytes);
    Some(FsType {
        restricted: raw & 0x0002 != 0,
        preview_print: raw & 0x0004 != 0,
        editable: raw & 0x0008 != 0,
        no_subsetting: raw & 0x0100 != 0,
        bitmap_only: raw & 0x0200 != 0,
        raw,
    })
}

/// The whole file a face is read from (a collection of CJK faces can be large); a bigger file is not read.
const MAX_FILE_BYTES: u64 = 512 * 1024 * 1024;
/// One face as sent to the page; a bigger one is left out rather than sent whole.
const MAX_FACE_BYTES: usize = 64 * 1024 * 1024;
/// More tables than any real font has: a count past this is a malformed file.
const MAX_TABLES: usize = 4096;

fn be16(data: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes(
        data.get(at..at.checked_add(2)?)?.try_into().ok()?,
    ))
}

fn be32(data: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(
        data.get(at..at.checked_add(4)?)?.try_into().ok()?,
    ))
}

struct TableRecord {
    tag: [u8; 4],
    checksum: [u8; 4],
    offset: usize,
    length: usize,
}

/// The table directory of the font whose header starts at `base`, with every table checked to lie inside `data`.
fn read_directory(data: &[u8], base: usize) -> Result<(Vec<u8>, Vec<TableRecord>), String> {
    let bad = || "That font can't be read.".to_string();
    let header = data
        .get(base..base.checked_add(12).ok_or_else(bad)?)
        .ok_or_else(bad)?
        .to_vec();
    let count = usize::from(be16(data, base + 4).ok_or_else(bad)?);
    if count == 0 || count > MAX_TABLES {
        return Err(bad());
    }
    let mut records = Vec::with_capacity(count);
    for i in 0..count {
        let at = i
            .checked_mul(16)
            .and_then(|n| n.checked_add(base))
            .and_then(|n| n.checked_add(12))
            .ok_or_else(bad)?;
        let entry = data
            .get(at..at.checked_add(16).ok_or_else(bad)?)
            .ok_or_else(bad)?;
        let offset = usize::try_from(be32(entry, 8).ok_or_else(bad)?).map_err(|_| bad())?;
        let length = usize::try_from(be32(entry, 12).ok_or_else(bad)?).map_err(|_| bad())?;
        if offset.checked_add(length).ok_or_else(bad)? > data.len() {
            return Err(bad());
        }
        records.push(TableRecord {
            tag: entry[0..4].try_into().map_err(|_| bad())?,
            checksum: entry[4..8].try_into().map_err(|_| bad())?,
            offset,
            length,
        });
    }
    Ok((header, records))
}

/// One face as a font file of its own. A plain font (not a collection) comes back as it is. From a collection (`ttcf`),
/// face `index` is cut out: a new header and table directory with fresh offsets, 4-byte aligned, then its tables, each
/// padded to 4 bytes. Anything malformed is an error, never a panic.
pub fn extract_face(data: &[u8], index: u32) -> Result<Vec<u8>, String> {
    let bad = || "That font can't be read.".to_string();
    if data.get(0..4) != Some(b"ttcf") {
        if data.len() > MAX_FACE_BYTES {
            return Err("That font is too large to draw.".into());
        }
        return if index == 0 && data.len() >= 12 {
            Ok(data.to_vec())
        } else {
            Err(bad())
        };
    }
    let faces = usize::try_from(be32(data, 8).ok_or_else(bad)?).map_err(|_| bad())?;
    let index = usize::try_from(index).map_err(|_| bad())?;
    if index >= faces {
        return Err(bad());
    }
    let at = index
        .checked_mul(4)
        .and_then(|n| n.checked_add(12))
        .ok_or_else(bad)?;
    let base = usize::try_from(be32(data, at).ok_or_else(bad)?).map_err(|_| bad())?;
    let (header, records) = read_directory(data, base)?;
    let mut total = 0usize;
    for record in &records {
        total = total.checked_add(record.length).ok_or_else(bad)?;
        if total > MAX_FACE_BYTES {
            return Err("That font is too large to draw.".into());
        }
    }
    let directory = 12usize
        .checked_add(records.len().checked_mul(16).ok_or_else(bad)?)
        .ok_or_else(bad)?;
    let mut out = header;
    let mut body: Vec<u8> = Vec::new();
    let mut entries: Vec<u8> = Vec::with_capacity(records.len() * 16);
    for record in &records {
        // Tables start on a 4-byte boundary, counted from the start of the new file.
        let start = directory.checked_add(body.len()).ok_or_else(bad)?;
        let new_offset = u32::try_from(start).map_err(|_| bad())?;
        entries.extend_from_slice(&record.tag);
        entries.extend_from_slice(&record.checksum);
        entries.extend_from_slice(&new_offset.to_be_bytes());
        entries.extend_from_slice(
            &u32::try_from(record.length)
                .map_err(|_| bad())?
                .to_be_bytes(),
        );
        let end = record.offset.checked_add(record.length).ok_or_else(bad)?;
        body.extend_from_slice(data.get(record.offset..end).ok_or_else(bad)?);
        while !body.len().is_multiple_of(4) {
            body.push(0);
        }
    }
    out.extend_from_slice(&entries);
    out.extend_from_slice(&body);
    Ok(out)
}

/// The OS/2 table of a single font file (not a collection), found through its own table directory.
fn os2_table(face: &[u8]) -> Option<&[u8]> {
    let (_, records) = read_directory(face, 0).ok()?;
    let record = records.iter().find(|r| &r.tag == b"OS/2")?;
    face.get(record.offset..record.offset.checked_add(record.length)?)
}

/// Name ID 6 (the PostScript name) of the font whose table directory starts at `base` in `data` (0 for a plain font, a
/// face's offset in a collection), read in place. The Windows record (platform 3) is preferred, then Unicode (0), then
/// Macintosh (1); a record that is cut short, points past its table or has an odd UTF-16 length is passed over.
pub fn postscript_name_of(data: &[u8], base: usize) -> Option<String> {
    let (_, records) = read_directory(data, base).ok()?;
    let record = records.iter().find(|r| &r.tag == b"name")?;
    let table = data.get(record.offset..record.offset.checked_add(record.length)?)?;
    let count = usize::from(be16(table, 2)?);
    let strings = usize::from(be16(table, 4)?);
    let mut best: Option<(u8, String)> = None;
    for i in 0..count {
        let Some(at) = i.checked_mul(12).and_then(|n| n.checked_add(6)) else {
            break;
        };
        let (Some(platform), Some(id), Some(length), Some(offset)) = (
            be16(table, at),
            be16(table, at.saturating_add(6)),
            be16(table, at.saturating_add(8)),
            be16(table, at.saturating_add(10)),
        ) else {
            break;
        };
        if id != 6 {
            continue;
        }
        let rank = match platform {
            3 => 0,
            0 => 1,
            1 => 2,
            _ => continue,
        };
        if best.as_ref().is_some_and(|(held, _)| *held <= rank) {
            continue;
        }
        let Some(start) = strings.checked_add(usize::from(offset)) else {
            continue;
        };
        let Some(raw) = start
            .checked_add(usize::from(length))
            .and_then(|end| table.get(start..end))
        else {
            continue;
        };
        let name = if platform == 1 {
            String::from_utf8_lossy(raw).into_owned()
        } else if raw.len() % 2 == 0 {
            let units: Vec<u16> = (0..raw.len() / 2)
                .filter_map(|i| be16(raw, i * 2))
                .collect();
            String::from_utf16_lossy(&units)
        } else {
            continue;
        };
        best = Some((rank, name));
    }
    best.map(|(_, name)| name)
}

/// Where a listed face lives. On Windows font-kit gives a path, kept as it is. On macOS CoreText hands over the whole
/// file in memory, which must not be held for every font on the computer for the session: only the face's index is
/// kept, and the one file is asked for again when its bytes are wanted.
struct FaceRef {
    path: Option<std::path::PathBuf>,
    font_index: u32,
}

/// Only the names the list holds are accepted, and where each one lives.
struct Registry {
    families: Vec<FontFamily>,
    faces: HashMap<String, FaceRef>,
}

fn rounded(weight: f32) -> (u16, u16) {
    let real = weight.round().clamp(1.0, 1000.0) as u16;
    // To the nearest 100: 450 goes up to 500, and a weight past 900 is 900.
    let near = (((u32::from(real) + 50) / 100) * 100).clamp(100, 900) as u16;
    (near, real)
}

/// The style a listed face's file gives, for the handle font-kit gave. A file read for it is kept only until the next one.
fn own_style_of(
    handle: &Handle,
    name: &str,
    last: &mut Option<(std::path::PathBuf, Vec<u8>)>,
) -> Option<(u16, bool)> {
    let (data, index): (&[u8], u32) = match handle {
        Handle::Memory { bytes, font_index } => (bytes, *font_index),
        Handle::Path { path, font_index } => {
            if last.as_ref().is_none_or(|(held, _)| held != path) {
                *last = None;
                if std::fs::metadata(path).ok()?.len() <= MAX_FILE_BYTES {
                    *last = Some((path.clone(), std::fs::read(path).ok()?));
                }
            }
            (&last.as_ref()?.1, *font_index)
        }
    };
    let (_, base) = find_face(data, index, name).ok()?;
    own_style(data, base)
}

/// Reads every family. A family or face that makes font-kit panic is skipped, so one bad font never costs the list.
fn read_registry() -> Result<Registry, String> {
    let source = SystemSource::new();
    let mut names = catch_unwind(AssertUnwindSafe(|| source.all_families()))
        .map_err(|_| "The fonts on this computer couldn't be listed.".to_string())?
        .map_err(|_| "The fonts on this computer couldn't be listed.".to_string())?;
    names.sort_by_key(|name| name.to_lowercase());
    names.dedup();
    let mut families = Vec::new();
    let mut faces = HashMap::new();
    // The file last read for a style: a family's faces often share one, and only this one is held while listing.
    let mut last_file: Option<(std::path::PathBuf, Vec<u8>)> = None;
    for name in names {
        let Ok(Ok(family)) = catch_unwind(AssertUnwindSafe(|| source.select_family_by_name(&name)))
        else {
            continue;
        };
        let mut styles: Vec<FontStyleInfo> = Vec::new();
        for handle in family.fonts() {
            let Ok(Ok(font)) = catch_unwind(AssertUnwindSafe(|| handle.load())) else {
                continue;
            };
            let read = catch_unwind(AssertUnwindSafe(|| {
                let properties = font.properties();
                (
                    font.postscript_name(),
                    properties.weight.0,
                    matches!(properties.style, Style::Italic | Style::Oblique),
                )
            }));
            let Ok((Some(postscript_name), weight, italic)) = read else {
                continue;
            };
            if faces.contains_key(&postscript_name) {
                continue;
            }
            // The file's own word on weight and slant beats the loader's, which can describe another face of a collection.
            let (weight, italic) = own_style_of(handle, &postscript_name, &mut last_file)
                .map_or((weight, italic), |(w, i)| (f32::from(w), i));
            let (weight, real_weight) = rounded(weight);
            let face = match handle {
                Handle::Path { path, font_index } => FaceRef {
                    path: Some(path.clone()),
                    font_index: *font_index,
                },
                Handle::Memory { font_index, .. } => FaceRef {
                    path: None,
                    font_index: *font_index,
                },
            };
            faces.insert(postscript_name.clone(), face);
            styles.push(FontStyleInfo {
                weight,
                real_weight,
                italic,
                postscript_name,
            });
        }
        styles.sort_by_key(|a| (a.weight, a.italic, a.real_weight));
        if !styles.is_empty() {
            families.push(FontFamily { name, styles });
        }
    }
    Ok(Registry { families, faces })
}

/// Reading every face is slow (a few hundred files), so it is done once and kept for the session.
fn registry() -> &'static Result<Registry, String> {
    static REGISTRY: OnceLock<Result<Registry, String>> = OnceLock::new();
    REGISTRY.get_or_init(read_registry)
}

/// Which face of a font file is the one called `name`, and where its table directory starts. The index the loader gave
/// is tried first; but a loader's index and a face's name can disagree (DirectWrite's index for "Nirmala UI" is the
/// file's "Nirmala Text Bold"), so a collection is searched for the face whose own PostScript name is the one asked
/// for, each read in place. A face with no PostScript name at all is taken at the index; a face that has another name
/// is not the one asked for, which is an error.
fn find_face(data: &[u8], index: u32, name: &str) -> Result<(u32, usize), String> {
    let bad = || "That font can't be read.".to_string();
    if data.get(0..4) != Some(b"ttcf") {
        return match postscript_name_of(data, 0) {
            Some(own) if own != name => Err(bad()),
            _ if index == 0 => Ok((0, 0)),
            _ => Err(bad()),
        };
    }
    let faces = be32(data, 8).ok_or_else(bad)?.min(4096);
    let base_of = |i: u32| -> Option<usize> {
        let at = usize::try_from(i).ok()?.checked_mul(4)?.checked_add(12)?;
        usize::try_from(be32(data, at)?).ok()
    };
    let named = std::iter::once(index)
        .chain((0..faces).filter(|i| *i != index))
        .filter(|i| *i < faces)
        .find_map(|i| {
            let base = base_of(i)?;
            (postscript_name_of(data, base).as_deref() == Some(name)).then_some((i, base))
        });
    if let Some(found) = named {
        return Ok(found);
    }
    match base_of(index) {
        Some(base) if index < faces && postscript_name_of(data, base).is_none() => {
            Ok((index, base))
        }
        _ => Err(bad()),
    }
}

fn extract_named(data: &[u8], index: u32, name: &str) -> Result<Vec<u8>, String> {
    extract_face(data, find_face(data, index, name)?.0)
}

/// The weight (`usWeightClass`) and slant (`fsSelection` italic or oblique) a face says in its own OS/2 table, read in
/// place. The loader's properties can belong to another face of the file (it called Nirmala UI italic), the file does not.
fn own_style(data: &[u8], base: usize) -> Option<(u16, bool)> {
    let (_, records) = read_directory(data, base).ok()?;
    let record = records.iter().find(|r| &r.tag == b"OS/2")?;
    let table = data.get(record.offset..record.offset.checked_add(record.length)?)?;
    let weight = be16(table, 4)?;
    let selection = be16(table, 62)?;
    ((1..=1000).contains(&weight)).then_some((weight, selection & 0x0201 != 0))
}

/// One listed face as a font file of its own. A face with a path is read from it; one without (macOS) is asked of
/// CoreText by name, which gives that one file. A size is checked before anything is copied.
fn face_bytes(name: &str, face: &FaceRef) -> Result<Vec<u8>, String> {
    let bad = || "That font can't be read.".to_string();
    let large = || "That font is too large to draw.".to_string();
    if let Some(path) = &face.path {
        let size = std::fs::metadata(path).map_err(|_| bad())?.len();
        if size > MAX_FILE_BYTES {
            return Err(large());
        }
        let data = std::fs::read(path).map_err(|_| bad())?;
        return extract_named(&data, face.font_index, name);
    }
    match SystemSource::new()
        .select_by_postscript_name(name)
        .map_err(|_| bad())?
    {
        Handle::Memory { bytes, font_index } => {
            if bytes.len() as u64 > MAX_FILE_BYTES {
                return Err(large());
            }
            extract_named(&bytes, font_index, name)
        }
        Handle::Path { path, font_index } => {
            if std::fs::metadata(&path).map_err(|_| bad())?.len() > MAX_FILE_BYTES {
                return Err(large());
            }
            extract_named(&std::fs::read(&path).map_err(|_| bad())?, font_index, name)
        }
    }
}

/// The bytes of one listed font with a three-byte header: 1 if the font has an OS/2 table else 0, then `fsType` as two
/// big-endian bytes (0 when there is none). Everything after the header is one font file, a collection's face cut out.
/// Only names the list holds are accepted.
pub fn font_payload(name: &str) -> Result<Vec<u8>, String> {
    let registry = registry().as_ref().map_err(Clone::clone)?;
    let listed = registry
        .faces
        .get(name)
        .ok_or_else(|| "That font isn't on this computer.".to_string())?;
    let face = catch_unwind(AssertUnwindSafe(|| face_bytes(name, listed)))
        .map_err(|_| "That font can't be read.".to_string())??;
    let fs_type = parse_fs_type(os2_table(&face));
    let mut out = Vec::with_capacity(face.len() + 3);
    out.push(u8::from(fs_type.is_some()));
    out.extend_from_slice(&fs_type.map_or(0, |f| f.raw).to_be_bytes());
    out.extend_from_slice(&face);
    Ok(out)
}

/// The families with their styles.
#[tauri::command]
pub async fn fonts_list() -> Result<Vec<FontFamily>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        registry()
            .as_ref()
            .map(|r| r.families.clone())
            .map_err(Clone::clone)
    })
    .await
    .map_err(|_| "The fonts on this computer couldn't be listed.".to_string())?
}

/// One font's bytes (raw, an ArrayBuffer on the page) after the three-byte header `font_payload` describes.
#[tauri::command]
pub async fn font_bytes(postscript_name: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || font_payload(&postscript_name))
        .await
        .map_err(|_| "That font can't be read.".to_string())?
        .map(tauri::ipc::Response::new)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn os2_with(fs_type: u16) -> Vec<u8> {
        let mut table = vec![0u8; 10];
        table[8..10].copy_from_slice(&fs_type.to_be_bytes());
        table
    }

    /// A font file: header, directory and tables laid out from `start` (as inside a collection).
    fn sfnt_at(start: usize, tables: &[(&[u8; 4], Vec<u8>)], file: &mut Vec<u8>) -> usize {
        let dir = start;
        let mut at = dir + 12 + 16 * tables.len();
        file.resize(at, 0);
        file[dir..dir + 4].copy_from_slice(&[0, 1, 0, 0]);
        file[dir + 4..dir + 6].copy_from_slice(&(tables.len() as u16).to_be_bytes());
        for (i, (tag, bytes)) in tables.iter().enumerate() {
            let entry = dir + 12 + 16 * i;
            file[entry..entry + 4].copy_from_slice(*tag);
            file[entry + 4..entry + 8].copy_from_slice(&[0xAA, 0xBB, 0xCC, i as u8]);
            file[entry + 8..entry + 12].copy_from_slice(&(at as u32).to_be_bytes());
            file[entry + 12..entry + 16].copy_from_slice(&(bytes.len() as u32).to_be_bytes());
            file.extend_from_slice(bytes);
            at += bytes.len();
            while !file.len().is_multiple_of(4) {
                file.push(0);
                at += 1;
            }
        }
        dir
    }

    /// A two-face collection: face 0 has head and OS/2 (fsType 2); face 1 has cmap and OS/2 (fsType 8).
    fn collection() -> Vec<u8> {
        let mut file = vec![0u8; 20];
        file[0..4].copy_from_slice(b"ttcf");
        file[4..8].copy_from_slice(&[0, 1, 0, 0]);
        file[8..12].copy_from_slice(&2u32.to_be_bytes());
        let first = sfnt_at(
            file.len(),
            &[(b"head", vec![1; 20]), (b"OS/2", os2_with(2))],
            &mut file,
        );
        let second = sfnt_at(
            file.len(),
            &[(b"cmap", vec![7; 10]), (b"OS/2", os2_with(8))],
            &mut file,
        );
        file[12..16].copy_from_slice(&(first as u32).to_be_bytes());
        file[16..20].copy_from_slice(&(second as u32).to_be_bytes());
        file
    }

    #[test]
    fn each_fs_type_bit_is_read() {
        let bit = |raw: u16| parse_fs_type(Some(&os2_with(raw))).expect("a table");
        assert!(bit(0x0002).restricted);
        assert!(bit(0x0004).preview_print);
        assert!(bit(0x0008).editable);
        assert!(bit(0x0100).no_subsetting);
        assert!(bit(0x0200).bitmap_only);
        let none = bit(0);
        assert!(!none.restricted && !none.preview_print && !none.editable);
        assert!(!none.no_subsetting && !none.bitmap_only);
        let only = bit(0x0004);
        assert!(!only.restricted && !only.editable && !only.no_subsetting && !only.bitmap_only);
        assert_eq!(bit(0x010A).raw, 0x010A);
    }

    #[test]
    fn a_missing_or_short_os2_table_says_nothing() {
        assert_eq!(parse_fs_type(None), None);
        assert_eq!(parse_fs_type(Some(&[0u8; 9])), None);
    }

    #[test]
    fn weights_round_to_the_nearest_hundred_and_keep_the_real_one() {
        assert_eq!(rounded(400.0), (400, 400));
        assert_eq!(rounded(449.0), (400, 449));
        assert_eq!(rounded(450.0), (500, 450));
        assert_eq!(rounded(1000.0), (900, 1000));
        assert_eq!(rounded(0.0), (100, 1));
    }

    #[test]
    fn a_face_is_cut_out_of_a_collection_with_its_own_tables() {
        let file = collection();
        let one = extract_face(&file, 1).expect("face 1");
        assert_eq!(&one[0..4], &[0, 1, 0, 0]);
        let (_, records) = read_directory(&one, 0).expect("a directory");
        let tags: Vec<&[u8; 4]> = records.iter().map(|r| &r.tag).collect();
        assert_eq!(tags, [b"cmap", b"OS/2"]);
        assert!(records.iter().all(|r| r.offset.is_multiple_of(4)));
        assert_eq!(&one[records[0].offset..records[0].offset + 10], &[7u8; 10]);
        // Its fsType is face 1's (8), not face 0's (2).
        assert_eq!(parse_fs_type(os2_table(&one)).map(|f| f.raw), Some(8));
        let zero = extract_face(&file, 0).expect("face 0");
        assert_eq!(parse_fs_type(os2_table(&zero)).map(|f| f.raw), Some(2));
        // A plain font comes back as it is.
        assert_eq!(extract_face(&zero, 0).expect("plain"), zero);
    }

    #[test]
    fn a_malformed_collection_is_an_error_never_a_panic() {
        let file = collection();
        assert!(extract_face(&file, 2).is_err());
        assert!(extract_face(&file[..10], 0).is_err());
        assert!(extract_face(&file[..30], 0).is_err());
        // Cut inside face 1's tables.
        assert!(extract_face(&file[..file.len() - 12], 1).is_err());
        assert!(extract_face(b"", 0).is_err());
        assert!(extract_face(&[0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 3).is_err());
        // A face offset far past the end, and a table count of zero.
        let mut far = file.clone();
        far[16..20].copy_from_slice(&u32::MAX.to_be_bytes());
        assert!(extract_face(&far, 1).is_err());
        let mut empty = file.clone();
        let base = u32::from_be_bytes(file[12..16].try_into().unwrap()) as usize;
        empty[base + 4..base + 6].copy_from_slice(&0u16.to_be_bytes());
        assert!(extract_face(&empty, 0).is_err());
        // A table whose length runs past the file.
        let mut long = file.clone();
        long[base + 12 + 12..base + 12 + 16].copy_from_slice(&u32::MAX.to_be_bytes());
        assert!(extract_face(&long, 0).is_err());
        // A huge count of faces and tables never allocates or overflows.
        let mut many = file.clone();
        many[8..12].copy_from_slice(&u32::MAX.to_be_bytes());
        assert!(extract_face(&many, u32::MAX).is_err());
        let mut tables = file;
        tables[base + 4..base + 6].copy_from_slice(&u16::MAX.to_be_bytes());
        assert!(extract_face(&tables, 0).is_err());
    }

    #[cfg(any(windows, target_os = "macos"))]
    fn listed() -> &'static [FontFamily] {
        let started = std::time::Instant::now();
        let all = &registry().as_ref().expect("a font list").families;
        eprintln!(
            "font list: {} families in {:?}",
            all.len(),
            started.elapsed()
        );
        assert!(!all.is_empty(), "this computer lists no fonts");
        all
    }

    #[cfg(any(windows, target_os = "macos"))]
    #[test]
    fn the_family_list_names_arial_or_helvetica() {
        assert!(
            listed()
                .iter()
                .any(|f| f.name == "Arial" || f.name == "Helvetica"),
            "neither Arial nor Helvetica is listed"
        );
    }

    #[cfg(any(windows, target_os = "macos"))]
    #[test]
    fn bytes_come_back_for_a_listed_postscript_name() {
        let style = listed()
            .iter()
            .find(|f| f.name == "Arial" || f.name == "Helvetica")
            .and_then(|f| f.styles.first())
            .expect("a style");
        let payload = font_payload(&style.postscript_name).expect("bytes");
        assert!(
            payload.len() > 3 + 1000,
            "the font file is there after the header"
        );
        assert!(payload[0] == 0 || payload[0] == 1);
    }

    /// Faces of real collections are fonts of their own, and the face asked for. On Windows these are the listed faces
    /// that sit in a .ttc past its first face (Yu Gothic UI and others); on a Mac, Helvetica Neue, which ships as one.
    #[cfg(any(windows, target_os = "macos"))]
    #[test]
    fn a_real_collection_face_is_a_font_of_its_own() {
        let registry = registry().as_ref().expect("a font list");
        let mut names: Vec<String> = if cfg!(windows) {
            registry
                .faces
                .iter()
                .filter(|(_, face)| {
                    face.font_index > 0
                        && face.path.as_ref().is_some_and(|p| {
                            p.extension().is_some_and(|e| e.eq_ignore_ascii_case("ttc"))
                        })
                })
                .map(|(name, _)| name.clone())
                .collect()
        } else {
            registry
                .families
                .iter()
                .filter(|f| f.name == "Helvetica Neue")
                .flat_map(|f| f.styles.iter().map(|s| s.postscript_name.clone()))
                .collect()
        };
        // These come with the system: none found is a failure to look into, not a reason to pass.
        assert!(
            !names.is_empty(),
            "no collection face is listed on this computer"
        );
        names.sort();
        for name in names.iter().take(6) {
            let payload = font_payload(name).expect("bytes");
            let font = &payload[3..];
            assert!(
                font.starts_with(&[0, 1, 0, 0]) || font.starts_with(b"OTTO"),
                "{name} starts {:?}",
                &font[..4]
            );
            // It is the face that was asked for, not face 0 of its file.
            assert_eq!(postscript_name_of(font, 0).as_deref(), Some(name.as_str()));
        }
    }

    /// A `name` table (format 0) of records `(platform, name id, string bytes)`.
    fn name_table(records: &[(u16, u16, Vec<u8>)]) -> Vec<u8> {
        let mut table = vec![0, 0];
        table.extend_from_slice(&(records.len() as u16).to_be_bytes());
        table.extend_from_slice(&((6 + 12 * records.len()) as u16).to_be_bytes());
        let mut strings = Vec::new();
        for (platform, id, bytes) in records {
            for value in [
                *platform,
                0,
                0,
                *id,
                bytes.len() as u16,
                strings.len() as u16,
            ] {
                table.extend_from_slice(&value.to_be_bytes());
            }
            strings.extend_from_slice(bytes);
        }
        table.extend_from_slice(&strings);
        table
    }

    fn utf16(text: &str) -> Vec<u8> {
        text.encode_utf16().flat_map(u16::to_be_bytes).collect()
    }

    /// A two-face collection with a name table in each: face 0 names itself with a Macintosh ASCII record, face 1 with a
    /// Windows UTF-16BE one (and a Macintosh one of another name, which must lose to it).
    fn named_collection() -> Vec<u8> {
        let mut file = vec![0u8; 20];
        file[0..4].copy_from_slice(b"ttcf");
        file[4..8].copy_from_slice(&[0, 1, 0, 0]);
        file[8..12].copy_from_slice(&2u32.to_be_bytes());
        let zero = name_table(&[(1, 6, b"Face-Zero".to_vec())]);
        let one = name_table(&[
            (1, 6, b"Mac-Only".to_vec()),
            (3, 6, utf16("Face-One")),
            (3, 4, utf16("Face One")),
        ]);
        let first = sfnt_at(
            file.len(),
            &[
                (b"head", vec![1; 20]),
                (b"name", zero),
                (b"OS/2", os2_with(2)),
            ],
            &mut file,
        );
        let second = sfnt_at(
            file.len(),
            &[
                (b"cmap", vec![7; 10]),
                (b"name", one),
                (b"OS/2", os2_with(8)),
            ],
            &mut file,
        );
        file[12..16].copy_from_slice(&(first as u32).to_be_bytes());
        file[16..20].copy_from_slice(&(second as u32).to_be_bytes());
        file
    }

    fn fs_type_of(face: &[u8]) -> Option<u16> {
        parse_fs_type(os2_table(face)).map(|f| f.raw)
    }

    #[test]
    fn a_name_is_read_in_place_windows_first_then_unicode_then_macintosh() {
        let file = named_collection();
        let base = |i: usize| {
            u32::from_be_bytes(file[12 + 4 * i..16 + 4 * i].try_into().unwrap()) as usize
        };
        assert_eq!(
            postscript_name_of(&file, base(0)).as_deref(),
            Some("Face-Zero")
        );
        assert_eq!(
            postscript_name_of(&file, base(1)).as_deref(),
            Some("Face-One")
        );
        let mut plain = vec![0u8; 0];
        sfnt_at(
            0,
            &[(
                b"name",
                name_table(&[(1, 6, b"Mac".to_vec()), (0, 6, utf16("Unicode"))]),
            )],
            &mut plain,
        );
        assert_eq!(postscript_name_of(&plain, 0).as_deref(), Some("Unicode"));
        let mut none = vec![0u8; 0];
        sfnt_at(
            0,
            &[(b"name", name_table(&[(3, 4, utf16("Full name"))]))],
            &mut none,
        );
        assert_eq!(postscript_name_of(&none, 0), None);
    }

    #[test]
    fn extract_named_finds_the_face_whose_own_name_was_asked_for() {
        let file = named_collection();
        // The loader's index says 0; the name says face 1.
        assert_eq!(
            fs_type_of(&extract_named(&file, 0, "Face-One").unwrap()),
            Some(8)
        );
        assert_eq!(
            fs_type_of(&extract_named(&file, 1, "Face-Zero").unwrap()),
            Some(2)
        );
        assert_eq!(
            fs_type_of(&extract_named(&file, 1, "Face-One").unwrap()),
            Some(8)
        );
        // A name that no face has is not the font asked for, even though the index is a face.
        assert!(extract_named(&file, 0, "Nobody").is_err());
        // A collection whose faces carry no name falls back to the index.
        let bare = collection();
        assert_eq!(
            extract_named(&bare, 1, "Anything").unwrap(),
            extract_face(&bare, 1).unwrap()
        );
        assert!(extract_named(&bare, 5, "Anything").is_err());
        // A plain font must carry the name asked for, or no name at all.
        let zero = extract_face(&file, 0).unwrap();
        assert!(extract_named(&zero, 0, "Face-Zero").is_ok());
        assert!(extract_named(&zero, 0, "Face-One").is_err());
        let unnamed = extract_face(&bare, 0).unwrap();
        assert!(extract_named(&unnamed, 0, "Anything").is_ok());
    }

    #[test]
    fn a_damaged_name_table_gives_no_name_and_never_a_panic() {
        let font = |table: Vec<u8>| {
            let mut file = Vec::new();
            sfnt_at(0, &[(b"name", table)], &mut file);
            file
        };
        // Cut short: the count promises records the table doesn't hold.
        let mut short = name_table(&[(3, 6, utf16("Cut"))]);
        short[2..4].copy_from_slice(&5u16.to_be_bytes());
        // The records that are there are still read; the missing ones end the walk without a panic.
        assert_eq!(postscript_name_of(&font(short), 0).as_deref(), Some("Cut"));
        let mut chopped = name_table(&[(3, 6, utf16("Cut"))]);
        chopped.truncate(10);
        assert_eq!(postscript_name_of(&font(chopped), 0), None);
        assert_eq!(postscript_name_of(&font(vec![0, 0, 0]), 0), None);
        // A string that points past the table.
        let mut past = name_table(&[(3, 6, utf16("Past"))]);
        past[6 + 10..6 + 12].copy_from_slice(&0xFFF0u16.to_be_bytes());
        assert_eq!(postscript_name_of(&font(past), 0), None);
        // A length past the end, and an odd UTF-16 length.
        let mut long = name_table(&[(3, 6, utf16("Long"))]);
        long[6 + 8..6 + 10].copy_from_slice(&0xFFFFu16.to_be_bytes());
        assert_eq!(postscript_name_of(&font(long), 0), None);
        assert_eq!(
            postscript_name_of(&font(name_table(&[(3, 6, vec![0, 65, 0])])), 0),
            None
        );
        // The odd one doesn't hide a good one beside it.
        let both = name_table(&[(3, 6, vec![0, 65, 0]), (1, 6, b"Fine".to_vec())]);
        assert_eq!(postscript_name_of(&font(both), 0).as_deref(), Some("Fine"));
        // Nonsense in, nothing out.
        assert_eq!(postscript_name_of(&[], 0), None);
        assert_eq!(postscript_name_of(&[0u8; 40], usize::MAX), None);
        // A name asked of a damaged font is an error or the index's face, never a panic.
        let _ = extract_named(&font(vec![0, 0, 0]), 0, "Name");
    }

    #[test]
    fn a_face_gives_its_own_weight_and_slant() {
        let os2 = |weight: u16, selection: u16| {
            let mut table = vec![0u8; 70];
            table[4..6].copy_from_slice(&weight.to_be_bytes());
            table[62..64].copy_from_slice(&selection.to_be_bytes());
            table
        };
        let style = |table: Vec<u8>| {
            let mut file = Vec::new();
            sfnt_at(0, &[(b"OS/2", table)], &mut file);
            own_style(&file, 0)
        };
        assert_eq!(style(os2(350, 0)), Some((350, false)));
        assert_eq!(style(os2(700, 0x0001)), Some((700, true)));
        // Oblique (bit 9) is a slant too.
        assert_eq!(style(os2(400, 0x0200)), Some((400, true)));
        assert_eq!(style(os2(0, 0)), None);
        assert_eq!(style(vec![0u8; 20]), None);
    }

    /// The loader said "Nirmala UI" is italic (it described another face of Nirmala.ttc); the list now reads the file.
    #[cfg(windows)]
    #[test]
    fn nirmala_is_listed_upright_in_its_three_weights() {
        let family = listed()
            .iter()
            .find(|f| f.name == "Nirmala Text")
            .expect("Nirmala Text is listed");
        assert!(family.styles.iter().all(|s| !s.italic));
        let weights: Vec<u16> = family.styles.iter().map(|s| s.real_weight).collect();
        assert_eq!(weights, [350, 400, 700]);
    }

    #[test]
    fn an_unlisted_postscript_name_is_an_error() {
        assert!(font_payload("No-Such-Font-Anywhere-12345").is_err());
    }
}
