//! A picture's original file, for a full-quality export (5.6a, Kevin Nov 10: the project stores a pointer to the original
//! next to the 2560 px copy it keeps). The page names only the open project and the picture's SHA-256; the path comes from
//! the project's own `media` record for that picture (`source_path`, as src/core/media/store.ts stores it), never from the
//! page, so a bug or a script in the page can't make this read any file it likes. Read-only, and not an open: nothing here
//! shows or runs the file (src-tauri/src/open.rs stays the one place that does).
//!
//! Only the lookup runs under the open projects' lock; the file is read after it is let go, on a thread of its own, so a
//! slow disk or a network share never holds up an edit or the window.
//!
//! Refused: anything that isn't a plain file (a directory, a link, a junction or other reparse point, a device, a pipe),
//! anything that isn't a picture (by its first bytes, not its name), a file over 200 MB, a relative path that climbs out of
//! the project's folder or goes through a link or names a device, Windows' `\\.\` and `\\?\` paths, a network path
//! (`\\host\share`) unless the project itself is on that server, and a `/net/` automount path unless the project is there.
//! A file that simply isn't there is not an error: the page prints the copy kept in the project and says so.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde_json::Value as Json;
use tauri::State;

use crate::sbd::{OpenFiles, SbdFile};

/// The largest original read, as for any picture (pictures.rs, MAX_BYTES).
const MAX_BYTES: u64 = 200 * 1024 * 1024;

/// A path as the project stores it: absolute (a drive, or a root), or relative to the .sbd's folder with `/`.
fn is_absolute_text(stored: &str) -> bool {
    let bytes = stored.as_bytes();
    stored.starts_with('/')
        || stored.starts_with('\\')
        || (bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes[2] == b'/' || bytes[2] == b'\\'))
}

/// A name Windows treats as a device whatever its extension: CON, PRN, AUX, NUL, COM1 to COM9, LPT1 to LPT9.
fn is_device_name(part: &str) -> bool {
    let stem = part.split('.').next().unwrap_or("").trim_end();
    let upper = stem.to_ascii_uppercase();
    matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((upper.starts_with("COM") || upper.starts_with("LPT"))
            && upper.len() == 4
            && matches!(upper.as_bytes()[3], b'1'..=b'9'))
}

/// The host of a `\\host\share` or `//host/share` path; None for any other. `\\?\` and `\\.\` are no network path.
fn network_host(text: &str) -> Option<String> {
    let flat = text.replace('\\', "/");
    let rest = flat.strip_prefix("//")?;
    let host = rest.split('/').next().unwrap_or("");
    (!host.is_empty() && host != "?" && host != ".").then(|| host.to_ascii_lowercase())
}

/// Whether an absolute stored path may be read, given where the project itself is. Pure text work: nothing here asks the disk.
fn absolute_allowed(stored: &str, project: &str) -> Result<(), String> {
    let flat = stored.replace('\\', "/");
    // Device and extended paths (\\.\pipe\x, \\?\C:\x, \\?\UNC\host\x, \\?\GLOBALROOT\x): never.
    // `\??\C:\x` is the same door (the NT object namespace) by another name.
    if flat.starts_with("//?/") || flat.starts_with("//./") || flat.starts_with("/??/") {
        return Err("That picture's path isn't a plain file path.".into());
    }
    // The app writes an absolute path whole: a `.` or `..` part, or a wildcard, is never from it.
    if stored.contains(['?', '*']) || flat.split('/').any(|part| part == "." || part == "..") {
        return Err("That picture's path isn't a plain file path.".into());
    }
    if let Some(host) = network_host(stored) {
        if network_host(project).as_deref() != Some(host.as_str()) {
            return Err("That picture's path is on a network share the project isn't on.".into());
        }
    }
    // macOS mounts network volumes under /net/ on demand: reading there would reach out to a server.
    if flat.to_ascii_lowercase().starts_with("/net/")
        && !project
            .replace('\\', "/")
            .to_ascii_lowercase()
            .starts_with("/net/")
    {
        return Err("That picture's path is on a network share the project isn't on.".into());
    }
    if let Some(last) = flat.rsplit('/').next() {
        if is_device_name(last) {
            return Err("That picture's path isn't a plain file path.".into());
        }
    }
    Ok(())
}

/// Where a stored path points: an absolute one as it is (once `absolute_allowed`), a relative one under `folder`. A relative
/// path with a `..`, a drive, a device name or an empty part is refused (it could leave the project's folder), and so is one
/// through a symbolic link or junction: a folder sent with the project can't point the app at another place.
fn resolve(folder: &Path, stored: &str) -> Result<PathBuf, String> {
    if is_absolute_text(stored) {
        absolute_allowed(stored, &folder.to_string_lossy())?;
        return Ok(PathBuf::from(stored));
    }
    // Every part is checked before the disk is asked about any: a part that isn't there ends the walk below, and what
    // follows it must not go unchecked.
    let mut parts = Vec::new();
    for part in stored.split(['/', '\\']) {
        match part {
            "." => continue,
            "" | ".." => return Err("That picture's path leaves the project's folder.".into()),
            _ if part.contains(':') || is_device_name(part) => {
                return Err("That picture's path leaves the project's folder.".into())
            }
            _ => parts.push(part),
        }
    }
    let mut at = folder.to_path_buf();
    for part in parts {
        at.push(part);
        match fs::symlink_metadata(&at) {
            Ok(meta) if is_link(&meta) => {
                return Err("That picture's path goes through a link.".into())
            }
            Ok(_) => {}
            // Not there: the file is missing, which the caller reads as "use the stored copy".
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(_) => return Err("That picture can't be looked at.".into()),
        }
    }
    Ok(at)
}

/// A symbolic link, or on Windows a junction or mount point: std counts the reparse points that redirect to another
/// name as symlinks. Other reparse tags are not links to refuse: OneDrive, Dropbox and iCloud files carry
/// FILE_ATTRIBUTE_REPARSE_POINT (0x400) as cloud placeholders, and refusing every reparse point refused all of them.
fn is_link(meta: &fs::Metadata) -> bool {
    meta.file_type().is_symlink()
}

/// Whether the first bytes of a file are a picture the webview might draw: JPEG, PNG, GIF, WebP, BMP, TIFF, or a HEIF
/// family file (HEIC, AVIF). Decided by the bytes, so a renamed program or document isn't read as a picture. A BMP is also
/// told by its header size field (12, 40, 52, 56, 108 or 124), since "BM" alone starts plenty of text.
fn looks_like_picture(head: &[u8]) -> bool {
    let bmp = head.len() >= 18
        && head.starts_with(b"BM")
        && matches!(
            u32::from_le_bytes([head[14], head[15], head[16], head[17]]),
            12 | 40 | 52 | 56 | 108 | 124
        );
    bmp || head.starts_with(&[0xFF, 0xD8, 0xFF])
        || head.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A])
        || head.starts_with(b"GIF87a")
        || head.starts_with(b"GIF89a")
        || (head.len() >= 12 && &head[0..4] == b"RIFF" && &head[8..12] == b"WEBP")
        || head.starts_with(&[b'I', b'I', 0x2A, 0x00])
        || head.starts_with(&[b'M', b'M', 0x00, 0x2A])
        || (head.len() >= 12
            && &head[4..8] == b"ftyp"
            && [
                &b"heic"[..],
                b"heix",
                b"hevc",
                b"hevx",
                b"heim",
                b"heis",
                b"mif1",
                b"msf1",
                b"avif",
            ]
            .contains(&&head[8..12]))
}

/// What the lookup under the lock hands on: the project's folder and the paths its records store for the picture.
#[derive(Debug)]
pub struct Pointers {
    folder: PathBuf,
    stored: Vec<String>,
}

fn check_hash(sha256: &str) -> Result<(), String> {
    if sha256.len() != 64
        || !sha256
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("That isn't a picture's hash.".into());
    }
    Ok(())
}

/// The pointer of one `media` record, for showing its original (src-tauri/src/open.rs): the record the page's board item
/// holds, not every record of the same picture (another board's, a frame's, a trashed one's, a pasted copy of the same
/// bytes). It must be an image record whose `file` is this hash and whose `source_path` is set; else none. A query only.
pub(crate) fn record_pointer(
    file: &SbdFile,
    record_id: &str,
    sha256: &str,
) -> Result<Option<Pointers>, String> {
    check_hash(sha256)?;
    let rows = file.query(
        "SELECT json_extract(props, '$.source_path') AS path FROM records
          WHERE id = ? AND type = 'media' AND json_extract(props, '$.kind') = 'image'
            AND json_extract(props, '$.file') = ?",
        &[
            Json::String(record_id.to_owned()),
            Json::String(sha256.to_owned()),
        ],
    )?;
    let Some(folder) = file.folder() else {
        return Ok(None);
    };
    let stored: Vec<String> = rows
        .into_iter()
        .filter_map(|row| match row.get("path") {
            Some(Json::String(path)) if !path.is_empty() => Some(path.clone()),
            _ => None,
        })
        .collect();
    Ok((!stored.is_empty()).then(|| Pointers {
        folder: folder.to_path_buf(),
        stored,
    }))
}

/// The pointers the open project has for the picture with this SHA-256: a query and nothing more, so it can run under the
/// lock. `Ok(None)`: no pointer, or the project's path isn't absolute (a path can't be resolved against it).
pub fn pointers(file: &SbdFile, sha256: &str) -> Result<Option<Pointers>, String> {
    check_hash(sha256)?;
    let rows = file.query(
        "SELECT json_extract(props, '$.source_path') AS path FROM records
          WHERE type = 'media' AND json_extract(props, '$.kind') = 'image'
            AND json_extract(props, '$.file') = ?
            AND json_extract(props, '$.source_path') IS NOT NULL
          ORDER BY id",
        &[Json::String(sha256.to_owned())],
    )?;
    let Some(folder) = file.folder() else {
        return Ok(None);
    };
    let stored: Vec<String> = rows
        .into_iter()
        .filter_map(|row| match row.get("path") {
            Some(Json::String(path)) if !path.is_empty() => Some(path.clone()),
            _ => None,
        })
        .collect();
    Ok((!stored.is_empty()).then(|| Pointers {
        folder: folder.to_path_buf(),
        stored,
    }))
}

/// Reads the first pointer that gives a picture. Another record of the same picture may hold a good pointer; a refusal
/// only counts when none did.
pub fn read_pointers(pointers: &Pointers) -> Result<Option<Vec<u8>>, String> {
    let mut refused = None;
    for stored in &pointers.stored {
        match read_path(&pointers.folder, stored) {
            Ok(Some(bytes)) => return Ok(Some(bytes)),
            Ok(None) => {}
            Err(reason) => refused = Some(reason),
        }
    }
    refused.map_or(Ok(None), Err)
}

/// The lookup and the read together, for the tests.
#[cfg(test)]
pub fn read_original(file: &SbdFile, sha256: &str) -> Result<Option<Vec<u8>>, String> {
    match pointers(file, sha256)? {
        Some(found) => read_pointers(&found),
        None => Ok(None),
    }
}

/// Fills `buf` as far as the file goes; the number of bytes got.
fn read_head(file: &mut fs::File, buf: &mut [u8]) -> std::io::Result<usize> {
    let mut got = 0;
    while got < buf.len() {
        match file.read(&mut buf[got..])? {
            0 => break,
            n => got += n,
        }
    }
    Ok(got)
}

/// A resolved path looked at without following a link and without opening it: opening a pipe or a device can block for good,
/// and a link or a junction may lead anywhere. `Ok(None)`: it isn't there. Otherwise a plain file's metadata, or a refusal.
fn plain_file_meta(path: &Path) -> Result<Option<fs::Metadata>, String> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(_) => return Ok(None),
    };
    if is_link(&meta) {
        return Err("That picture's path goes through a link.".into());
    }
    if !meta.is_file() {
        return Err("That isn't a plain file.".into());
    }
    Ok(Some(meta))
}

fn read_path(folder: &Path, stored: &str) -> Result<Option<Vec<u8>>, String> {
    let path = resolve(folder, stored)?;
    let Some(meta) = plain_file_meta(&path)? else {
        return Ok(None);
    };
    if meta.len() > MAX_BYTES {
        return Err("That picture is too large to print from its original.".into());
    }
    let mut opened = match fs::File::open(&path) {
        Ok(opened) => opened,
        Err(_) => return Ok(None),
    };
    // And again once it is open: what was looked at may have been swapped for something else meanwhile.
    let opened_meta = opened.metadata().map_err(|e| e.to_string())?;
    if !opened_meta.is_file() || opened_meta.len() > MAX_BYTES {
        return Err("That isn't a plain file.".into());
    }
    let mut head = [0u8; 32];
    let got = read_head(&mut opened, &mut head).map_err(|e| e.to_string())?;
    if !looks_like_picture(&head[..got]) {
        return Err("That file isn't a picture.".into());
    }
    let mut bytes = head[..got].to_vec();
    // `take`, so a file that grew after the check still can't pass the limit.
    opened
        .take(MAX_BYTES + 1 - got as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("That picture is too large to print from its original.".into());
    }
    Ok(Some(bytes))
}

/// The path of the first pointer that is a plain file, for showing it in its folder (src-tauri/src/open.rs). The path rules
/// and the plain-file check of reading, from the disk's metadata alone: the file is never opened or read, so showing an
/// online-only file (OneDrive, Dropbox, iCloud) downloads nothing and a Mac asks for no folder access. It is only revealed,
/// so what is in it doesn't matter. `Ok(None)`: none is there; `Err`: refused.
pub(crate) fn existing_path(pointers: &Pointers) -> Result<Option<PathBuf>, String> {
    let mut refused = None;
    for stored in &pointers.stored {
        let looked = resolve(&pointers.folder, stored)
            .and_then(|path| plain_file_meta(&path).map(|found| found.map(|_| path)));
        match looked {
            Ok(Some(path)) => return Ok(Some(path)),
            Ok(None) => {}
            Err(reason) => refused = Some(reason),
        }
    }
    refused.map_or(Ok(None), Err)
}

/// The original of a picture, raw (an ArrayBuffer on the page); empty when the project has none to read, which the page
/// reads as "print the copy kept in the project". A refusal is an error the page treats the same way.
#[tauri::command]
pub async fn picture_original(
    files: State<'_, OpenFiles>,
    handle: u32,
    sha256: String,
) -> Result<tauri::ipc::Response, String> {
    // Only the query under the lock; the read is on a thread of its own once it is let go.
    let found = files.with(handle, |file| pointers(file, &sha256))?;
    let bytes = match found {
        Some(found) => tauri::async_runtime::spawn_blocking(move || read_pointers(&found))
            .await
            .map_err(|error| error.to_string())??,
        None => None,
    };
    Ok(tauri::ipc::Response::new(bytes.unwrap_or_default()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sbd::Statement;
    use std::time::{SystemTime, UNIX_EPOCH};

    const SHA: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const JPEG: &[u8] = &[
        0xFF, 0xD8, 0xFF, 0xE0, 0, 16, b'J', b'F', b'I', b'F', 0, 1, 2, 3,
    ];

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("sbd-orig-{tag}-{}-{nanos}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A project in `dir` whose one picture record points at `stored`.
    fn project(dir: &Path, stored: &str) -> SbdFile {
        let mut file = SbdFile::create(&dir.join("Bey County.sbd")).unwrap();
        let props =
            serde_json::json!({ "kind": "image", "file": SHA, "source_path": stored }).to_string();
        file.tx(&[
            Statement {
                sql: "CREATE TABLE records (id TEXT PRIMARY KEY, type TEXT NOT NULL, props TEXT NOT NULL)".into(),
                params: vec![],
            },
            Statement {
                sql: "INSERT INTO records (id, type, props) VALUES ('m1', 'media', ?)".into(),
                params: vec![Json::String(props)],
            },
        ])
        .unwrap();
        file
    }

    #[test]
    fn reads_a_path_stored_relative_to_the_project() {
        let dir = temp_dir("relative");
        fs::create_dir_all(dir.join("refs")).unwrap();
        fs::write(dir.join("refs").join("still.jpg"), JPEG).unwrap();
        let file = project(&dir, "refs/still.jpg");
        assert_eq!(read_original(&file, SHA).unwrap(), Some(JPEG.to_vec()));
    }

    #[test]
    fn reads_an_absolute_path_the_project_stores() {
        let dir = temp_dir("absolute");
        let elsewhere = temp_dir("absolute-elsewhere").join("still.jpg");
        fs::write(&elsewhere, JPEG).unwrap();
        let file = project(&dir, elsewhere.to_str().unwrap());
        assert_eq!(read_original(&file, SHA).unwrap(), Some(JPEG.to_vec()));
    }

    #[test]
    fn refuses_a_relative_path_climbing_out_of_the_project() {
        let dir = temp_dir("climb");
        let inner = dir.join("inner");
        fs::create_dir_all(&inner).unwrap();
        // The picture is real and one folder up from the project: only the path says it shouldn't be read.
        fs::write(dir.join("secret.jpg"), JPEG).unwrap();
        let file = project(&inner, "../secret.jpg");
        assert!(read_original(&file, SHA).is_err());
        let file = project(&temp_dir("climb-b"), "refs/../../secret.jpg");
        assert!(read_original(&file, SHA).is_err());
        let file = project(&temp_dir("climb-c"), "C:secret.jpg");
        assert!(read_original(&file, SHA).is_err());
    }

    #[test]
    fn refuses_a_file_that_is_not_a_picture_whatever_its_name() {
        let dir = temp_dir("document");
        fs::write(dir.join("still.jpg"), b"MZ\x90\x00 not a picture at all").unwrap();
        let file = project(&dir, "still.jpg");
        assert!(read_original(&file, SHA).is_err());
        // A text file that starts with "BM" is no BMP: its header size field isn't one.
        fs::write(
            dir.join("notes.txt"),
            b"BM: plain words, no picture at all here",
        )
        .unwrap();
        let text_dir = temp_dir("document-text");
        fs::write(
            text_dir.join("notes.txt"),
            b"BM: plain words, no picture at all here",
        )
        .unwrap();
        let file = project(&text_dir, "notes.txt");
        assert!(read_original(&file, SHA).is_err());
        // A short file of picture bytes is read all the same.
        let short = temp_dir("short");
        fs::write(short.join("tiny.jpg"), [0xFF, 0xD8, 0xFF]).unwrap();
        let file = project(&short, "tiny.jpg");
        assert_eq!(
            read_original(&file, SHA).unwrap(),
            Some(vec![0xFF, 0xD8, 0xFF])
        );
    }

    #[test]
    fn refuses_a_file_over_the_limit() {
        let dir = temp_dir("large");
        let path = dir.join("huge.jpg");
        let big = fs::File::create(&path).unwrap();
        // Sparse where the file system allows it: the length is what's checked, before anything is read.
        big.set_len(MAX_BYTES + 1).unwrap();
        let file = project(&dir, "huge.jpg");
        assert!(read_original(&file, SHA).is_err());
        // The sparse file may take real space on some disks: not left in the temp folder.
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_hash_the_project_does_not_have_reads_nothing() {
        let dir = temp_dir("unknown");
        fs::write(dir.join("still.jpg"), JPEG).unwrap();
        let file = project(&dir, "still.jpg");
        let other = "f".repeat(64);
        assert_eq!(read_original(&file, &other).unwrap(), None);
        // And a hash that isn't one is refused before it reaches the query.
        assert!(read_original(&file, "x' OR '1'='1").is_err());
    }

    #[test]
    fn a_file_that_is_gone_is_none_not_an_error() {
        let dir = temp_dir("gone");
        let file = project(&dir, "refs/gone.jpg");
        assert_eq!(read_original(&file, SHA).unwrap(), None);
    }

    #[test]
    fn refuses_a_directory_whatever_it_is_called() {
        let dir = temp_dir("directory");
        fs::create_dir_all(dir.join("still.jpg")).unwrap();
        let file = project(&dir, "still.jpg");
        assert!(read_original(&file, SHA).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_symbolic_link_to_a_picture() {
        let dir = temp_dir("symlink");
        fs::write(dir.join("real.jpg"), JPEG).unwrap();
        std::os::unix::fs::symlink(dir.join("real.jpg"), dir.join("link.jpg")).unwrap();
        let file = project(&dir, "link.jpg");
        assert!(read_original(&file, SHA).is_err());
        // The same link named by an absolute path.
        let absolute = temp_dir("symlink-absolute");
        let file = project(&absolute, dir.join("link.jpg").to_str().unwrap());
        assert!(read_original(&file, SHA).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn refuses_a_junction_and_a_folder_reached_through_one() {
        let dir = temp_dir("junction");
        let target = temp_dir("junction-target");
        fs::write(target.join("still.jpg"), JPEG).unwrap();
        let made = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(dir.join("refs"))
            .arg(&target)
            .output()
            .unwrap();
        assert!(made.status.success(), "mklink /J didn't make the junction");
        let file = project(&dir, "refs/still.jpg");
        assert!(read_original(&file, SHA).is_err());
    }

    #[test]
    fn refuses_a_device_name_with_or_without_an_extension() {
        for name in [
            "CON",
            "nul.jpg",
            "refs/COM1.png",
            "LPT9",
            "aux.txt",
            "Prn.JPG",
        ] {
            let file = project(&temp_dir("device"), name);
            assert!(read_original(&file, SHA).is_err(), "{name}");
        }
        assert!(!is_device_name("COM0"));
        assert!(!is_device_name("CONSOLE.jpg"));
        assert!(!is_device_name("still.jpg"));
    }

    #[test]
    fn refuses_extended_device_and_network_paths_unless_the_project_is_there() {
        for stored in [
            r"\\.\pipe\storiiboard",
            r"\\?\C:\Footage\still.jpg",
            r"\\?\UNC\server\share\still.jpg",
            r"\\?\GLOBALROOT\Device\HarddiskVolume1\still.jpg",
            "//./pipe/x",
            r"\\server\share\still.jpg",
            "//server/share/still.jpg",
            "/net/server/export/still.jpg",
        ] {
            let file = project(&temp_dir("network"), stored);
            assert!(read_original(&file, SHA).is_err(), "{stored}");
        }
        // On the same server as the project: allowed by the rules (the file may well not be there).
        assert!(
            absolute_allowed(r"\\server\share\refs\still.jpg", r"\\server\share\Films").is_ok()
        );
        assert!(absolute_allowed(r"\\other\share\still.jpg", r"\\server\share\Films").is_err());
        assert!(
            absolute_allowed("/net/server/export/still.jpg", "/net/server/export/Films").is_ok()
        );
        assert!(absolute_allowed(r"\\?\UNC\server\share\x.jpg", r"\\server\share\Films").is_err());
        assert!(absolute_allowed(r"C:\Footage\still.jpg", r"C:\Films").is_ok());
        assert!(absolute_allowed("/Volumes/Card/still.jpg", "/Users/k/Films").is_ok());
        // The NT object namespace, dot parts and wildcards in a stored absolute path, and /net/ in any case.
        for bad in [
            r"\??\C:\x.jpg",
            "/??/C:/x.jpg",
            r"C:\Footage\..\Secret\x.jpg",
            r"C:\Footage\.\x.jpg",
            "/Volumes/Card/../x.jpg",
            "/Volumes/Card/st?ll.jpg",
            r"C:\Footage\*.jpg",
        ] {
            assert!(absolute_allowed(bad, r"C:\Films").is_err(), "{bad}");
        }
        assert!(absolute_allowed("/NET/server/x.jpg", "/Users/k/Films").is_err());
        assert!(absolute_allowed("/Net/server/x.jpg", "/NET/server/Films").is_ok());
    }

    #[test]
    fn knows_pictures_by_their_first_bytes() {
        assert!(looks_like_picture(JPEG));
        assert!(looks_like_picture(&[
            0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0
        ]));
        assert!(looks_like_picture(b"RIFF\0\0\0\0WEBPVP8 "));
        assert!(looks_like_picture(b"\0\0\0\x18ftypheic\0\0\0\0"));
        let mut bmp = vec![b'B', b'M'];
        bmp.extend_from_slice(&[0; 12]);
        bmp.extend_from_slice(&40u32.to_le_bytes());
        assert!(looks_like_picture(&bmp));
        assert!(!looks_like_picture(b"BM: words words words words"));
        assert!(!looks_like_picture(b"%PDF-1.7 not a picture"));
        assert!(!looks_like_picture(b"MZ\x90\0"));
        assert!(!looks_like_picture(b""));
    }
}
