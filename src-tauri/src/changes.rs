//! Change files in (7.1, docs/SBD_FORMAT.md "Change files"): suggestions from the assistant or brought by hand, read
//! here and handed to the page as bytes, which reads them with its one checked reader (src/core/storage/changeFile.ts).
//! A change file is untrusted input, and so is the folder it sits in: anyone can put anything there. So this side
//! reads only regular files, never through a link or a Windows junction, at most 5 MB each, and the page never names a
//! path for the folder or the project's id: it names the open project's handle, the folder is found beside it and the
//! id read from inside it. Nothing in the folder is ever written, moved or deleted, but for the one rename a person
//! asks for (a renamed project's folder, renamed to match), and that only from a folder beside the project whose marker
//! names it and which no other project beside it is named for, only to `<Project> Suggestions`, and never over anything
//! already there.
//!
//! - `changes_choose` and `changes_read`: Import changes… and a dropped file. Only a path the Open dialog or the drop gave
//!   Rust (pictures.rs's `Offered`), only a name ending in `.sbdchanges`, read once (taken out of the set as it's read)
//!   and at most 5 MB.
//! - `changes_folder`: the listing of `<Project> Suggestions/` beside the open project, with its marker's word on it:
//!   every change file among the first 10,000 entries, saying when there were more, and, when there is no folder, a
//!   renamed project's folder to offer to rename.
//! - `changes_folder_read`: one listed file's bytes, by its name in that folder.
//! - `changes_folder_rename`: the rename, after the person says so.

use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value as Json;
use tauri::{ipc::Response, AppHandle, Manager, Runtime, State};

use crate::pictures::Offered;
use crate::sbd::OpenFiles;

/// The largest change file read: the page's own limit (changeFile.ts, MAX_CHANGE_FILE_BYTES).
pub(crate) const MAX_CHANGE_FILE_BYTES: u64 = 5 * 1024 * 1024;
/// The most entries of a folder looked at, so a folder of a million files can't hold the app up. Past it the listing
/// says so (`capped`), never silently.
const MAX_ENTRIES: usize = 10_000;
/// The most names listed as too large.
const MAX_TOO_LARGE_LISTED: usize = 20;
/// The marker: which project the folder is for. Never read as a change file.
pub(crate) const MARKER_NAME: &str = "storiiboard-folder.json";
const MARKER_FORMAT: &str = "storiiboard.suggestions-folder";
/// The largest marker read; a larger one reads as no marker.
const MAX_MARKER_BYTES: u64 = 64 * 1024;
const EXTENSION: &str = "sbdchanges";
const FOLDER_SUFFIX: &str = " Suggestions";

const TOO_LARGE: &str = "That change file is larger than 5 MB.";
const NOT_SBDCHANGES: &str = "Only a .sbdchanges file can be brought in as changes.";
const UNREADABLE: &str = "Storiiboard couldn't read that change file.";
const FOLDER_UNREADABLE: &str = "Storiiboard couldn't read this project's suggestions folder.";
const RENAME_REFUSED: &str = "Storiiboard couldn't rename the suggestions folder.";
const NOT_OFFERED: &str = "Storiiboard reads only the files you drop on it or choose.";

/// Whether a name ends in `.sbdchanges`, whatever its case.
fn is_change_file_name(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case(EXTENSION))
}

/// A plain name in a folder: no separator, no `.` or `..`, no drive or stream colon (`a:b.sbdchanges` is a Windows
/// stream), no NUL, not empty.
fn plain_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains(['/', '\\', ':', '\0'])
        && Path::new(name).file_name().and_then(|n| n.to_str()) == Some(name)
}

/// The folder's name for a project: `<stem> Suggestions`, `<stem>` the .sbd's file name, as Backups names copies.
fn folder_name(project: &Path) -> Option<String> {
    let stem = project.file_stem()?.to_str()?;
    Some(format!("{stem}{FOLDER_SUFFIX}"))
}

/// Whether a project of the folder's own name sits beside it: `<name minus " Suggestions">.sbd`. An opened backup or
/// version copy has its original's id, so the original's folder names the copy in its marker too; it is the
/// original's, never the copy's to take.
fn named_for_a_project(beside: &Path, folder: &str) -> bool {
    let Some(stem) = folder.strip_suffix(FOLDER_SUFFIX) else {
        return false;
    };
    // Anything there of that name, or a name that can't be looked at, counts: the folder stays where it is.
    !matches!(fs::symlink_metadata(beside.join(format!("{stem}.sbd"))), Err(error) if error.kind() == io::ErrorKind::NotFound)
}

fn refused(message: &str) -> io::Error {
    io::Error::other(message.to_owned())
}

/// Opens a regular file, refusing a link or a junction at its last step, and checks the file opened is the one looked
/// at. First the path's own entry is looked at without following it (`symlink_metadata`): a link, a junction or
/// anything not a regular file is refused before any open. Windows then opens it as any program does, so a OneDrive or
/// Dropbox placeholder is read through its cloud filter; that open follows a link put there after the look, and the
/// handle it gives is the target's, so its own type can't tell. What protects there is the look before the open and,
/// for the folder's files, the caller's check that the opened handle's final path is `<real folder>/<name>`
/// (`opened_path`). A Mac opens it with O_NOFOLLOW and O_NONBLOCK, so neither a link nor a FIFO (an open that would
/// wait for a writer) holds it, and Linux (tests only) refuses a FIFO by the look before the open, as close as std
/// allows; elsewhere than Windows the opened file's device and inode must also be the ones the path had.
fn open_regular(path: &Path) -> io::Result<(fs::File, fs::Metadata)> {
    let before = fs::symlink_metadata(path)?;
    if !before.file_type().is_file() {
        return Err(refused("not a regular file"));
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options.open(path)?;
    let meta = file.metadata()?;
    // What was opened must be a regular file (a FIFO or a folder swapped in after the look is refused here). The handle's
    // `is_symlink` is kept, but protects nothing on its own: an open that followed a link gives the target's handle.
    if !meta.file_type().is_file() || meta.file_type().is_symlink() {
        return Err(refused("not a regular file"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if meta.dev() != before.dev() || meta.ino() != before.ino() {
            return Err(refused("the file changed while it was opened"));
        }
    }
    Ok((file, meta))
}

/// The real path of a file already open, from its handle (never its name again): what a folder swapped for a junction
/// between the listing and the read would change.
#[cfg(windows)]
fn opened_path(file: &fs::File) -> io::Result<PathBuf> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFinalPathNameByHandleW, FILE_NAME_NORMALIZED, VOLUME_NAME_DOS,
    };
    let mut buf = vec![0u16; 1024];
    loop {
        let len = u32::try_from(buf.len()).map_err(|_| refused("path too long"))?;
        // SAFETY: the handle is open for the whole call, and `buf` is writable for `len` UTF-16 units.
        let n = unsafe {
            GetFinalPathNameByHandleW(
                file.as_raw_handle(),
                buf.as_mut_ptr(),
                len,
                FILE_NAME_NORMALIZED | VOLUME_NAME_DOS,
            )
        } as usize;
        if n == 0 {
            return Err(io::Error::last_os_error());
        }
        if n < buf.len() {
            // The same `\\?\C:\…` form fs::canonicalize gives.
            return Ok(PathBuf::from(OsString::from_wide(&buf[..n])));
        }
        // Too small: `n` is the length needed, its NUL included.
        buf.resize(n, 0);
    }
}

#[cfg(target_os = "macos")]
fn opened_path(file: &fs::File) -> io::Result<PathBuf> {
    use std::ffi::{CStr, OsStr};
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::io::AsRawFd;
    let mut buf = vec![libc::c_char::default(); libc::PATH_MAX as usize];
    // SAFETY: F_GETPATH writes at most MAXPATHLEN (PATH_MAX, 1024) bytes, NUL included, into `buf`, which is that long.
    if unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GETPATH, buf.as_mut_ptr()) } == -1 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: F_GETPATH succeeded, so `buf` holds a NUL-terminated path.
    let path = unsafe { CStr::from_ptr(buf.as_ptr()) };
    Ok(PathBuf::from(OsStr::from_bytes(path.to_bytes())))
}

#[cfg(target_os = "linux")]
fn opened_path(file: &fs::File) -> io::Result<PathBuf> {
    use std::os::unix::io::AsRawFd;
    fs::read_link(format!("/proc/self/fd/{}", file.as_raw_fd()))
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
fn opened_path(_file: &fs::File) -> io::Result<PathBuf> {
    Err(io::Error::from(io::ErrorKind::Unsupported))
}

/// Reads at most `max` bytes, once, from a file already open: a file that grew past the cap after it was looked at is
/// still refused, since one byte more than the cap is all that's read.
fn read_capped(file: fs::File, max: u64) -> io::Result<Option<Vec<u8>>> {
    let mut bytes = Vec::new();
    file.take(max + 1).read_to_end(&mut bytes)?;
    Ok(if bytes.len() as u64 > max {
        None
    } else {
        Some(bytes)
    })
}

/// What a folder's marker says about the open project.
#[derive(Debug, PartialEq)]
enum Marker {
    /// No marker, or one that can't be read: the folder is read (a person may have made it).
    None,
    /// It names this project.
    Ours,
    /// It names another project, with that project's name as the marker gives it (text, cut short).
    Other(String),
}

fn read_marker(folder: &Path, project_id: &str) -> Marker {
    let Ok((file, _)) = open_regular(&folder.join(MARKER_NAME)) else {
        return Marker::None;
    };
    let Ok(Some(bytes)) = read_capped(file, MAX_MARKER_BYTES) else {
        return Marker::None;
    };
    let Ok(json) = serde_json::from_slice::<Json>(&bytes) else {
        return Marker::None;
    };
    if json.get("format").and_then(|f| f.as_str()) != Some(MARKER_FORMAT) {
        return Marker::None;
    }
    match json.get("project_id").and_then(|id| id.as_str()) {
        Some(id) if id == project_id => Marker::Ours,
        Some(_) => {
            let name = json
                .get("project_name")
                .and_then(|n| n.as_str())
                .unwrap_or("");
            // Shown as text by the page; cut here so a marker can't hand it a long one.
            Marker::Other(name.chars().filter(|c| !c.is_control()).take(100).collect())
        }
        None => Marker::None,
    }
}

/// The folder's real path, when it is a real folder (not a link or a junction) whose real parent is `beside_real`, the
/// real path of the project's own folder; None otherwise. By identity, never by names: a name compared in any case
/// misreads non-ASCII case and the two Unicode spellings of an accent (NFC and NFD) as a link.
fn real_folder(folder: &Path, beside_real: &Path) -> io::Result<Option<PathBuf>> {
    let meta = fs::symlink_metadata(folder)?;
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return Ok(None);
    }
    let real = fs::canonicalize(folder)?;
    Ok((real.parent() == Some(beside_real)).then_some(real))
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Listed {
    name: String,
    bytes: u64,
    /// Modified time in ms since the epoch, 0 when the system has none: with the name and size, how the page knows a
    /// file it has read already this session.
    modified: u64,
}

/// What `changes_folder` found. `state`: `none` (no folder), `read` (files listed), `other_project` (its marker names
/// another project: nothing listed) or `link` (a link or a junction, or not a folder, or not beside the project:
/// never followed, nothing listed).
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    folder: String,
    state: &'static str,
    other_project_name: Option<String>,
    /// Every change file of at most 5 MB among the entries looked at, by name: the page picks the ones it hasn't read.
    files: Vec<Listed>,
    too_large: Vec<String>,
    /// The folder holds more than 10,000 entries: only the first 10,000 were looked at.
    capped: bool,
    /// With no folder of this project's name: a `* Suggestions` folder beside it whose marker names this project, to
    /// offer to rename.
    rename_from: Option<String>,
}

/// The `.sbdchanges` files in a folder already known to be real, among its first `max_entries` entries: regular files
/// only, the marker left out, by name; and whether there were more entries than that.
fn list_files(folder: &Path, max_entries: usize) -> io::Result<(Vec<Listed>, Vec<String>, bool)> {
    let mut found: Vec<Listed> = Vec::new();
    let mut too_large: Vec<String> = Vec::new();
    let mut entries = fs::read_dir(folder)?;
    for entry in entries.by_ref().take(max_entries) {
        let Ok(entry) = entry else { continue };
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if name.eq_ignore_ascii_case(MARKER_NAME)
            || !is_change_file_name(&name)
            || !plain_name(&name)
        {
            continue;
        }
        // The entry's own type, never followed: a link or a junction is skipped.
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if !kind.is_file() || kind.is_symlink() {
            continue;
        }
        let Ok(meta) = fs::symlink_metadata(entry.path()) else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        if meta.len() > MAX_CHANGE_FILE_BYTES {
            too_large.push(name);
            continue;
        }
        let modified = meta
            .modified()
            .ok()
            .and_then(|at| at.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |at| at.as_millis() as u64);
        found.push(Listed {
            name,
            bytes: meta.len(),
            modified,
        });
    }
    let capped = entries.next().is_some();
    found.sort_by(|a, b| a.name.cmp(&b.name));
    too_large.sort();
    too_large.truncate(MAX_TOO_LARGE_LISTED);
    Ok((found, too_large, capped))
}

/// A renamed project's folder: a real `* Suggestions` folder beside the project whose marker names it and which no
/// project beside it is named for, the first by name; never the project's own name.
fn renamed_folder(
    beside: &Path,
    beside_real: &Path,
    own: &str,
    project_id: &str,
) -> Option<String> {
    let mut candidates: Vec<String> = fs::read_dir(beside)
        .ok()?
        .take(MAX_ENTRIES)
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_type()
                .is_ok_and(|kind| kind.is_dir() && !kind.is_symlink())
        })
        .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
        .filter(|name| name != own && name.ends_with(FOLDER_SUFFIX) && plain_name(name))
        .filter(|name| !named_for_a_project(beside, name))
        .collect();
    candidates.sort();
    candidates.into_iter().find(|name| {
        real_folder(&beside.join(name), beside_real)
            .ok()
            .flatten()
            .is_some_and(|real| read_marker(&real, project_id) == Marker::Ours)
    })
}

/// The real path of the folder the project sits in.
fn beside_of(project: &Path) -> io::Result<(PathBuf, PathBuf)> {
    let beside = project.parent().ok_or_else(|| refused("no folder"))?;
    Ok((beside.to_path_buf(), fs::canonicalize(beside)?))
}

/// The listing for the project at `project`.
fn listing(project: &Path, project_id: &str) -> Result<Listing, String> {
    listing_capped(project, project_id, MAX_ENTRIES)
}

fn listing_capped(project: &Path, project_id: &str, max_entries: usize) -> Result<Listing, String> {
    let fail = |_| FOLDER_UNREADABLE.to_owned();
    let (beside, beside_real) = beside_of(project).map_err(fail)?;
    let name = folder_name(project).ok_or(FOLDER_UNREADABLE)?;
    let folder = beside.join(&name);
    let mut out = Listing {
        folder: name.clone(),
        state: "none",
        other_project_name: None,
        files: Vec::new(),
        too_large: Vec::new(),
        capped: false,
        rename_from: None,
    };
    match fs::symlink_metadata(&folder) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            out.rename_from = renamed_folder(&beside, &beside_real, &name, project_id);
            return Ok(out);
        }
        Err(error) => return Err(fail(error)),
        Ok(_) => {}
    }
    let Some(real) = real_folder(&folder, &beside_real).map_err(fail)? else {
        out.state = "link";
        return Ok(out);
    };
    if let Marker::Other(other) = read_marker(&real, project_id) {
        out.state = "other_project";
        out.other_project_name = Some(other);
        return Ok(out);
    }
    let (files, too_large, capped) = list_files(&real, max_entries).map_err(fail)?;
    out.state = "read";
    out.files = files;
    out.too_large = too_large;
    out.capped = capped;
    Ok(out)
}

/// One file of the project's folder, by its name: only a listed kind of file (a `.sbdchanges` regular file, not the
/// marker) in a real folder whose marker doesn't name another project, read once, at most 5 MB, and only when the file
/// opened is, by its handle's own real path, `<the folder's real path>/<name>`.
fn read_from_folder(project: &Path, project_id: &str, name: &str) -> Result<Vec<u8>, String> {
    if !plain_name(name) || !is_change_file_name(name) || name.eq_ignore_ascii_case(MARKER_NAME) {
        return Err(NOT_SBDCHANGES.to_owned());
    }
    let (beside, beside_real) = beside_of(project).map_err(|_| FOLDER_UNREADABLE.to_owned())?;
    let folder = beside.join(folder_name(project).ok_or(FOLDER_UNREADABLE)?);
    let real = match real_folder(&folder, &beside_real) {
        Ok(Some(real)) if !matches!(read_marker(&real, project_id), Marker::Other(_)) => real,
        _ => return Err(FOLDER_UNREADABLE.to_owned()),
    };
    let path = real.join(name);
    let (file, meta) = open_regular(&path).map_err(|_| UNREADABLE.to_owned())?;
    if meta.len() > MAX_CHANGE_FILE_BYTES {
        return Err(TOO_LARGE.to_owned());
    }
    if opened_path(&file).map_err(|_| UNREADABLE.to_owned())? != path {
        return Err(UNREADABLE.to_owned());
    }
    read_capped(file, MAX_CHANGE_FILE_BYTES)
        .map_err(|_| UNREADABLE.to_owned())?
        .ok_or_else(|| TOO_LARGE.to_owned())
}

/// Renames `from` to `to`, refusing if `to` exists, without the gap a check and then a rename would leave: on a Mac
/// renamex_np with RENAME_EXCL, on Windows MoveFileEx without MOVEFILE_REPLACE_EXISTING. Linux (tests only, no shipping
/// build) keeps std's rename after the caller's check, which would replace an empty folder made in between.
#[cfg(target_os = "macos")]
fn rename_new(from: &Path, to: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let source = CString::new(from.as_os_str().as_bytes()).map_err(|_| refused("NUL in path"))?;
    let dest = CString::new(to.as_os_str().as_bytes()).map_err(|_| refused("NUL in path"))?;
    excl_or_plain(
        || {
            // SAFETY: both paths are NUL-terminated and outlive the call.
            if unsafe { libc::renamex_np(source.as_ptr(), dest.as_ptr(), libc::RENAME_EXCL) } == 0 {
                Ok(())
            } else {
                Err(io::Error::last_os_error())
            }
        },
        || fs::rename(from, to),
        libc::ENOTSUP,
    )
}

/// The exclusive rename, or, on a volume that can't do one (`unsupported`: a Mac's exFAT, FAT and some SMB shares answer
/// ENOTSUP to RENAME_EXCL), the plain rename after the caller's check that nothing of the name is there. That plain
/// rename leaves the gap the exclusive one closes: a folder made in the moment between would be replaced, only if it
/// is empty (a rename never replaces a folder that holds anything). Any other error stops it.
#[cfg(any(target_os = "macos", test))]
fn excl_or_plain(
    excl: impl FnOnce() -> io::Result<()>,
    plain: impl FnOnce() -> io::Result<()>,
    unsupported: i32,
) -> io::Result<()> {
    match excl() {
        Err(error) if error.raw_os_error() == Some(unsupported) => plain(),
        done => done,
    }
}

#[cfg(windows)]
fn rename_new(from: &Path, to: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::MoveFileExW;
    let source: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let dest: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: both are NUL-terminated UTF-16 paths that outlive the call, which only reads them. No flags: an existing
    // `to` is refused, never replaced.
    if unsafe { MoveFileExW(source.as_ptr(), dest.as_ptr(), 0) } != 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
fn rename_new(from: &Path, to: &Path) -> io::Result<()> {
    fs::rename(from, to)
}

/// The rename a person asked for: `from`, a real `* Suggestions` folder beside the project whose marker names it and
/// which no project beside it is named for, to `<Project> Suggestions`, only when nothing of that name is there.
fn rename_folder(project: &Path, project_id: &str, from: &str) -> Result<(), String> {
    let no = || RENAME_REFUSED.to_owned();
    let (beside, beside_real) = beside_of(project).map_err(|_| no())?;
    let to = folder_name(project).ok_or_else(no)?;
    if !plain_name(from)
        || !from.ends_with(FOLDER_SUFFIX)
        || from == to
        || named_for_a_project(&beside, from)
    {
        return Err(no());
    }
    let source = match real_folder(&beside.join(from), &beside_real) {
        Ok(Some(real)) if read_marker(&real, project_id) == Marker::Ours => real,
        _ => return Err(no()),
    };
    let dest = beside_real.join(&to);
    // Never over anything: a file, a folder or a link of that name stops it, here and again in the rename itself.
    match fs::symlink_metadata(&dest) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        _ => return Err(no()),
    }
    rename_new(&source, &dest).map_err(|_| no())
}

/// A file the person picked or dropped: only a `.sbdchanges` (checked first, so asking for a picture dropped beside it
/// leaves the picture's path for the picture), only one Rust was given, taken out of the set as it's read (once, as
/// export.rs takes a chosen file), at most 5 MB.
fn read_offered(offered: &Offered, path: &Path) -> Result<Vec<u8>, String> {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if !is_change_file_name(name) {
        return Err(NOT_SBDCHANGES.to_owned());
    }
    if !offered.take(path) {
        return Err(NOT_OFFERED.to_owned());
    }
    let (file, meta) = open_regular(path).map_err(|_| UNREADABLE.to_owned())?;
    if meta.len() > MAX_CHANGE_FILE_BYTES {
        return Err(TOO_LARGE.to_owned());
    }
    read_capped(file, MAX_CHANGE_FILE_BYTES)
        .map_err(|_| UNREADABLE.to_owned())?
        .ok_or_else(|| TOO_LARGE.to_owned())
}

/// The open project's path and its id, read from the file itself under the lock and let go before any folder is
/// looked at: the page never names either.
fn project_of(files: &OpenFiles, handle: u32) -> Result<(PathBuf, String), String> {
    files.with(handle, |file| {
        let rows = file
            .query(
                "SELECT id FROM records WHERE type = 'project' AND parent_id IS NULL LIMIT 1",
                &[],
            )
            .map_err(|_| FOLDER_UNREADABLE.to_owned())?;
        let id = rows
            .first()
            .and_then(|row| row.get("id"))
            .and_then(Json::as_str)
            .filter(|id| !id.is_empty())
            .ok_or(FOLDER_UNREADABLE)?
            .to_owned();
        Ok((file.file_path().to_path_buf(), id))
    })
}

const DIALOG_EXTENSIONS: &[&str] = &[EXTENSION];

/// Import changes…: the Open dialog for a change file; the file picked becomes readable through `changes_read`.
#[tauri::command]
pub async fn changes_choose<R: Runtime>(
    app: AppHandle<R>,
    title: String,
    kind: String,
) -> Result<Vec<String>, String> {
    crate::pictures::choose(app, title, (kind, DIALOG_EXTENSIONS), false).await
}

/// The bytes of a change file the person picked or dropped, once.
#[tauri::command]
pub async fn changes_read<R: Runtime>(app: AppHandle<R>, path: String) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        read_offered(&app.state::<Offered>(), Path::new(&path)).map(Response::new)
    })
    .await
    .map_err(|_| UNREADABLE.to_owned())?
}

/// The open project's suggestions folder, listed.
#[tauri::command]
pub async fn changes_folder(files: State<'_, OpenFiles>, handle: u32) -> Result<Listing, String> {
    let (project, project_id) = project_of(&files, handle)?;
    tauri::async_runtime::spawn_blocking(move || listing(&project, &project_id))
        .await
        .map_err(|_| FOLDER_UNREADABLE.to_owned())?
}

/// One file of the open project's suggestions folder, by its name.
#[tauri::command]
pub async fn changes_folder_read(
    files: State<'_, OpenFiles>,
    handle: u32,
    name: String,
) -> Result<Response, String> {
    let (project, project_id) = project_of(&files, handle)?;
    tauri::async_runtime::spawn_blocking(move || {
        read_from_folder(&project, &project_id, &name).map(Response::new)
    })
    .await
    .map_err(|_| UNREADABLE.to_owned())?
}

/// A renamed project's folder renamed to match, after the person said Rename.
#[tauri::command]
pub async fn changes_folder_rename(
    files: State<'_, OpenFiles>,
    handle: u32,
    from: String,
) -> Result<(), String> {
    let (project, project_id) = project_of(&files, handle)?;
    tauri::async_runtime::spawn_blocking(move || rename_folder(&project, &project_id, &from))
        .await
        .map_err(|_| RENAME_REFUSED.to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ops::Deref;
    use std::sync::atomic::{AtomicU64, Ordering};

    const ID: &str = "0b6e2d0a-3f5c-4d8e-9c1a-7e2f4b5a6c3d";
    const OTHER: &str = "6f1c0d2e-8a4b-4c3d-9e2f-1a0b9c8d7e6f";

    /// A folder in the system's temp folder that goes when the test ends, a failed one too.
    struct Temp(PathBuf);
    impl Deref for Temp {
        type Target = PathBuf;
        fn deref(&self) -> &PathBuf {
            &self.0
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn temp_dir(tag: &str) -> Temp {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "sbd-changes-{tag}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        Temp(dir)
    }

    fn marker(folder: &Path, project_id: &str, name: &str) {
        fs::write(
            folder.join(MARKER_NAME),
            serde_json::json!({ "format": MARKER_FORMAT, "project_id": project_id, "project_name": name }).to_string(),
        )
        .unwrap();
    }

    /// A project path in `dir` (the file itself isn't needed: only its folder and name are read) and its folder, made.
    fn project_and_folder(dir: &Path) -> (PathBuf, PathBuf) {
        let project = dir.join("Harbor Lights.sbd");
        let folder = dir.join("Harbor Lights Suggestions");
        fs::create_dir_all(&folder).unwrap();
        (project, folder)
    }

    fn names(listing: &Listing) -> Vec<&str> {
        listing.files.iter().map(|f| f.name.as_str()).collect()
    }

    #[test]
    fn no_folder_is_none_and_lists_nothing() {
        let dir = temp_dir("none");
        let listed = listing(&dir.join("Harbor Lights.sbd"), ID).unwrap();
        assert_eq!(listed.state, "none");
        assert_eq!(listed.folder, "Harbor Lights Suggestions");
        assert!(listed.files.is_empty());
        assert_eq!(listed.rename_from, None);
    }

    #[test]
    fn lists_only_change_files_and_skips_the_marker_and_folders() {
        let dir = temp_dir("only");
        let (project, folder) = project_and_folder(&dir);
        marker(&folder, ID, "Harbor Lights");
        fs::write(folder.join("b.sbdchanges"), "{}").unwrap();
        fs::write(folder.join("A.SBDCHANGES"), "{}").unwrap();
        fs::write(folder.join("notes.txt"), "x").unwrap();
        fs::write(folder.join("c.sbdchanges.json"), "{}").unwrap();
        fs::create_dir(folder.join("d.sbdchanges")).unwrap();
        let listed = listing(&project, ID).unwrap();
        assert_eq!(listed.state, "read");
        assert_eq!(names(&listed), ["A.SBDCHANGES", "b.sbdchanges"]);
        assert_eq!(listed.files[1].bytes, 2);
        assert!(!listed.capped);
        // The marker, whatever it holds, is never a change file to read.
        assert_eq!(
            read_from_folder(&project, ID, MARKER_NAME).unwrap_err(),
            NOT_SBDCHANGES
        );
        assert_eq!(
            read_from_folder(&project, ID, "b.sbdchanges").unwrap(),
            b"{}"
        );
    }

    #[test]
    fn a_folder_with_no_marker_or_an_unreadable_one_is_read() {
        let dir = temp_dir("no-marker");
        let (project, folder) = project_and_folder(&dir);
        fs::write(folder.join("a.sbdchanges"), "{}").unwrap();
        assert_eq!(listing(&project, ID).unwrap().state, "read");
        fs::write(folder.join(MARKER_NAME), "not json").unwrap();
        assert_eq!(names(&listing(&project, ID).unwrap()), ["a.sbdchanges"]);
    }

    #[test]
    fn another_projects_marker_skips_the_folder_and_its_files() {
        let dir = temp_dir("other");
        let (project, folder) = project_and_folder(&dir);
        marker(&folder, OTHER, "Saltmarsh");
        fs::write(folder.join("a.sbdchanges"), "{}").unwrap();
        let listed = listing(&project, ID).unwrap();
        assert_eq!(listed.state, "other_project");
        assert_eq!(listed.other_project_name.as_deref(), Some("Saltmarsh"));
        assert!(listed.files.is_empty());
        assert_eq!(
            read_from_folder(&project, ID, "a.sbdchanges").unwrap_err(),
            FOLDER_UNREADABLE
        );
    }

    #[test]
    fn a_file_over_5_mb_is_named_and_skipped_and_never_read() {
        let dir = temp_dir("large");
        let (project, folder) = project_and_folder(&dir);
        let big = fs::File::create(folder.join("big.sbdchanges")).unwrap();
        big.set_len(MAX_CHANGE_FILE_BYTES + 1).unwrap();
        drop(big);
        let edge = fs::File::create(folder.join("edge.sbdchanges")).unwrap();
        edge.set_len(MAX_CHANGE_FILE_BYTES).unwrap();
        drop(edge);
        let listed = listing(&project, ID).unwrap();
        assert_eq!(names(&listed), ["edge.sbdchanges"]);
        assert_eq!(listed.too_large, ["big.sbdchanges"]);
        assert_eq!(
            read_from_folder(&project, ID, "big.sbdchanges").unwrap_err(),
            TOO_LARGE
        );
        assert_eq!(
            read_from_folder(&project, ID, "edge.sbdchanges")
                .unwrap()
                .len() as u64,
            MAX_CHANGE_FILE_BYTES
        );
    }

    #[test]
    fn lists_every_change_file_so_none_is_left_unseen() {
        let dir = temp_dir("every");
        let (project, folder) = project_and_folder(&dir);
        for i in 0..205 {
            fs::write(folder.join(format!("{i:03}.sbdchanges")), "{}").unwrap();
        }
        let listed = listing(&project, ID).unwrap();
        assert_eq!(listed.files.len(), 205);
        assert!(!listed.capped);
        assert_eq!(listed.files[0].name, "000.sbdchanges");
        assert_eq!(listed.files[204].name, "204.sbdchanges");
    }

    #[test]
    fn says_when_the_walk_stopped_at_its_cap() {
        let dir = temp_dir("capped");
        let (project, folder) = project_and_folder(&dir);
        for i in 0..6 {
            fs::write(folder.join(format!("{i}.sbdchanges")), "{}").unwrap();
        }
        // The cap made small here, as 10,000 entries would be in the app.
        let listed = listing_capped(&project, ID, 5).unwrap();
        assert!(listed.capped);
        assert_eq!(listed.files.len(), 5);
        let all = listing_capped(&project, ID, 6).unwrap();
        assert!(!all.capped);
        assert_eq!(all.files.len(), 6);
    }

    #[test]
    fn a_name_that_leaves_the_folder_is_refused() {
        let dir = temp_dir("names");
        let (project, folder) = project_and_folder(&dir);
        fs::write(dir.join("outside.sbdchanges"), "{}").unwrap();
        fs::write(folder.join("a.sbdchanges"), "{}").unwrap();
        for name in [
            "../outside.sbdchanges",
            "..\\outside.sbdchanges",
            "a.sbdchanges:stream.sbdchanges",
            "",
            "..",
            "a.sbdchanges/",
        ] {
            assert!(read_from_folder(&project, ID, name).is_err(), "{name}");
        }
        let outside = dir.join("outside.sbdchanges");
        assert!(read_from_folder(&project, ID, outside.to_str().unwrap()).is_err());
    }

    /// Windows and a Mac match names in any case: a folder on disk in another non-ASCII case is the project's folder,
    /// read as the real folder it is, never taken for a link (round 1 compared names in ASCII case only).
    #[cfg(any(windows, target_os = "macos"))]
    #[test]
    fn a_folder_named_in_another_case_is_read_by_identity() {
        let dir = temp_dir("names-identity");
        let project = dir.join("Ñandú Café.sbd");
        let folder = dir.join("ñandú café Suggestions");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("a.sbdchanges"), "{}").unwrap();
        let listed = listing(&project, ID).unwrap();
        assert_eq!(listed.state, "read");
        assert_eq!(
            read_from_folder(&project, ID, "a.sbdchanges").unwrap(),
            b"{}"
        );
    }

    #[test]
    fn the_file_read_is_the_one_in_the_folder_by_its_real_path() {
        let dir = temp_dir("real-path");
        let (project, folder) = project_and_folder(&dir);
        fs::write(folder.join("a.sbdchanges"), "{}").unwrap();
        let real = fs::canonicalize(&folder).unwrap();
        let (file, _) = open_regular(&real.join("a.sbdchanges")).unwrap();
        assert_eq!(opened_path(&file).unwrap(), real.join("a.sbdchanges"));
        drop(file);
        assert_eq!(
            read_from_folder(&project, ID, "a.sbdchanges").unwrap(),
            b"{}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_link_out_of_the_folder_is_never_followed() {
        let dir = temp_dir("links");
        let (project, folder) = project_and_folder(&dir);
        let elsewhere = temp_dir("links-target");
        fs::write(elsewhere.join("secret.sbdchanges"), "{}").unwrap();
        std::os::unix::fs::symlink(
            elsewhere.join("secret.sbdchanges"),
            folder.join("link.sbdchanges"),
        )
        .unwrap();
        std::os::unix::fs::symlink(&**elsewhere, folder.join("sub.sbdchanges")).unwrap();
        let listed = listing(&project, ID).unwrap();
        assert!(listed.files.is_empty(), "{:?}", names(&listed));
        assert!(read_from_folder(&project, ID, "link.sbdchanges").is_err());
        // The folder itself a link: never followed, nothing listed.
        fs::remove_dir_all(&folder).unwrap();
        std::os::unix::fs::symlink(&**elsewhere, &folder).unwrap();
        assert_eq!(listing(&project, ID).unwrap().state, "link");
        assert!(read_from_folder(&project, ID, "secret.sbdchanges").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn a_fifo_is_refused_without_waiting_for_a_writer() {
        let dir = temp_dir("fifo");
        let (project, folder) = project_and_folder(&dir);
        let made = std::process::Command::new("mkfifo")
            .arg(folder.join("pipe.sbdchanges"))
            .status()
            .unwrap();
        assert!(made.success());
        assert!(listing(&project, ID).unwrap().files.is_empty());
        assert!(read_from_folder(&project, ID, "pipe.sbdchanges").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn a_junction_out_of_the_folder_is_never_followed() {
        let dir = temp_dir("junction");
        let (project, folder) = project_and_folder(&dir);
        let elsewhere = temp_dir("junction-target");
        fs::write(elsewhere.join("secret.sbdchanges"), "{}").unwrap();
        let junction = |at: &Path| {
            let made = std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(at)
                .arg(&**elsewhere)
                .output()
                .unwrap();
            assert!(made.status.success(), "mklink /J didn't make the junction");
        };
        // A junction inside the folder named like a change file: skipped.
        junction(&folder.join("sub.sbdchanges"));
        assert!(listing(&project, ID).unwrap().files.is_empty());
        assert!(read_from_folder(&project, ID, "sub.sbdchanges").is_err());
        // Cleared first: removing the folder must not be able to follow the junction into the target.
        fs::remove_dir(folder.join("sub.sbdchanges")).unwrap();
        // The folder itself a junction: never followed, nothing listed or read.
        fs::remove_dir(&folder).unwrap();
        junction(&folder);
        assert_eq!(listing(&project, ID).unwrap().state, "link");
        assert!(read_from_folder(&project, ID, "secret.sbdchanges").is_err());
        fs::remove_dir(&folder).unwrap();
        assert!(
            elsewhere.join("secret.sbdchanges").is_file(),
            "the target is untouched"
        );
    }

    #[test]
    fn offers_a_renamed_projects_folder_by_its_marker_only() {
        let dir = temp_dir("renamed");
        let project = dir.join("Harbor Lights.sbd");
        let old = dir.join("Old Name Suggestions");
        fs::create_dir(&old).unwrap();
        // No marker: not this project's, so no offer.
        assert_eq!(listing(&project, ID).unwrap().rename_from, None);
        marker(&old, OTHER, "Saltmarsh");
        assert_eq!(listing(&project, ID).unwrap().rename_from, None);
        marker(&old, ID, "Old Name");
        assert_eq!(
            listing(&project, ID).unwrap().rename_from.as_deref(),
            Some("Old Name Suggestions")
        );
        // A folder not named `* Suggestions` never counts, whatever its marker.
        let elsewhere = dir.join("Old Name Notes");
        fs::create_dir(&elsewhere).unwrap();
        marker(&elsewhere, ID, "Old Name");
        assert_eq!(
            listing(&project, ID).unwrap().rename_from.as_deref(),
            Some("Old Name Suggestions")
        );
    }

    #[test]
    fn never_offers_or_takes_the_folder_of_a_project_beside_it() {
        // Harbor Lights.sbd and its folder, and an opened copy of it beside them, with the same id: the copy has no
        // folder of its own, and the original's is never its to take.
        let dir = temp_dir("copy");
        fs::write(dir.join("Harbor Lights.sbd"), "").unwrap();
        let own = dir.join("Harbor Lights Suggestions");
        fs::create_dir(&own).unwrap();
        marker(&own, ID, "Harbor Lights");
        fs::write(own.join("a.sbdchanges"), "{}").unwrap();
        let copy = dir.join("Harbor Lights (copy).sbd");
        fs::write(&copy, "").unwrap();
        let listed = listing(&copy, ID).unwrap();
        assert_eq!(listed.state, "none");
        assert_eq!(listed.rename_from, None);
        assert_eq!(
            rename_folder(&copy, ID, "Harbor Lights Suggestions").unwrap_err(),
            RENAME_REFUSED
        );
        assert!(own.join("a.sbdchanges").is_file());
        assert!(!dir.join("Harbor Lights (copy) Suggestions").exists());
        // The original's own listing is as it was.
        assert_eq!(
            names(&listing(&dir.join("Harbor Lights.sbd"), ID).unwrap()),
            ["a.sbdchanges"]
        );
    }

    #[test]
    fn renames_only_its_own_marked_folder_beside_the_project_to_its_name() {
        let dir = temp_dir("rename");
        let project = dir.join("Harbor Lights.sbd");
        let old = dir.join("Old Name Suggestions");
        fs::create_dir(&old).unwrap();
        fs::write(old.join("a.sbdchanges"), "{}").unwrap();
        // Unmarked, or marked for another project: refused.
        assert_eq!(
            rename_folder(&project, ID, "Old Name Suggestions").unwrap_err(),
            RENAME_REFUSED
        );
        marker(&old, OTHER, "Saltmarsh");
        assert!(rename_folder(&project, ID, "Old Name Suggestions").is_err());
        marker(&old, ID, "Old Name");
        // Only a plain `* Suggestions` name beside the project.
        let notes = dir.join("Old Name Notes");
        fs::create_dir(&notes).unwrap();
        marker(&notes, ID, "Old Name");
        for from in [
            "Old Name Notes",
            "../Old Name Suggestions",
            "Harbor Lights Suggestions",
            "",
        ] {
            assert!(rename_folder(&project, ID, from).is_err(), "{from}");
        }
        assert!(notes.is_dir());
        rename_folder(&project, ID, "Old Name Suggestions").unwrap();
        assert!(!old.exists());
        assert!(dir
            .join("Harbor Lights Suggestions")
            .join("a.sbdchanges")
            .is_file());
    }

    #[test]
    fn never_renames_over_an_existing_folder_or_file() {
        let dir = temp_dir("over");
        let project = dir.join("Harbor Lights.sbd");
        let old = dir.join("Old Name Suggestions");
        fs::create_dir(&old).unwrap();
        marker(&old, ID, "Old Name");
        let own = dir.join("Harbor Lights Suggestions");
        fs::create_dir(&own).unwrap();
        assert!(rename_folder(&project, ID, "Old Name Suggestions").is_err());
        assert!(old.is_dir() && own.is_dir());
        fs::remove_dir(&own).unwrap();
        fs::write(&own, "a file").unwrap();
        assert!(rename_folder(&project, ID, "Old Name Suggestions").is_err());
        assert_eq!(fs::read_to_string(&own).unwrap(), "a file");
        assert!(old.is_dir());
    }

    #[cfg(any(windows, target_os = "macos"))]
    #[test]
    fn the_rename_itself_refuses_a_folder_that_appeared_meanwhile() {
        // The check before it passed; a folder made in between is still never replaced.
        let dir = temp_dir("excl");
        let from = dir.join("Old Name Suggestions");
        let to = dir.join("Harbor Lights Suggestions");
        fs::create_dir(&from).unwrap();
        fs::create_dir(&to).unwrap();
        assert!(rename_new(&from, &to).is_err());
        assert!(from.is_dir() && to.is_dir());
        fs::remove_dir(&to).unwrap();
        rename_new(&from, &to).unwrap();
        assert!(to.is_dir() && !from.exists());
    }

    #[test]
    fn reads_only_an_offered_change_file_once_and_of_at_most_5_mb() {
        let dir = temp_dir("offered");
        let offered = Offered::default();
        let file = dir.join("Robin.sbdchanges");
        fs::write(&file, "{}").unwrap();
        assert_eq!(read_offered(&offered, &file).unwrap_err(), NOT_OFFERED);
        offered.offer(std::slice::from_ref(&file));
        assert_eq!(read_offered(&offered, &file).unwrap(), b"{}");
        // Read once: the second read is refused, as for a file never given.
        assert_eq!(read_offered(&offered, &file).unwrap_err(), NOT_OFFERED);
        let picture = dir.join("still.jpg");
        fs::write(&picture, [0xff, 0xd8]).unwrap();
        offered.offer(std::slice::from_ref(&picture));
        assert_eq!(
            read_offered(&offered, &picture).unwrap_err(),
            NOT_SBDCHANGES
        );
        let big = dir.join("big.sbdchanges");
        fs::File::create(&big)
            .unwrap()
            .set_len(MAX_CHANGE_FILE_BYTES + 1)
            .unwrap();
        offered.offer(std::slice::from_ref(&big));
        assert_eq!(read_offered(&offered, &big).unwrap_err(), TOO_LARGE);
    }

    #[test]
    fn a_picture_asked_for_as_changes_stays_offered_for_the_picture() {
        // Round 3: the name is checked before the path is taken out of the set.
        let dir = temp_dir("name-first");
        let offered = Offered::default();
        let picture = dir.join("still.jpg");
        fs::write(&picture, [0xff, 0xd8]).unwrap();
        offered.offer(std::slice::from_ref(&picture));
        assert_eq!(
            read_offered(&offered, &picture).unwrap_err(),
            NOT_SBDCHANGES
        );
        assert!(offered.has(&picture));
    }

    #[test]
    fn a_volume_without_an_exclusive_rename_falls_back_to_the_checked_plain_one() {
        // Round 3: as renamex_np's ENOTSUP on exFAT, FAT or some SMB shares, played here by a made-up error number.
        const UNSUPPORTED: i32 = 45;
        let plain_ran = std::cell::Cell::new(false);
        let plain = || {
            plain_ran.set(true);
            Ok(())
        };
        excl_or_plain(
            || Err(io::Error::from_raw_os_error(UNSUPPORTED)),
            plain,
            UNSUPPORTED,
        )
        .unwrap();
        assert!(plain_ran.get());
        // Any other error stops it: an existing target is never replaced by the fallback.
        plain_ran.set(false);
        let other = excl_or_plain(
            || Err(io::Error::from(io::ErrorKind::AlreadyExists)),
            || {
                plain_ran.set(true);
                Ok(())
            },
            UNSUPPORTED,
        );
        assert!(other.is_err() && !plain_ran.get());
        // A rename that worked is the end of it.
        excl_or_plain(
            || Ok(()),
            || {
                plain_ran.set(true);
                Ok(())
            },
            UNSUPPORTED,
        )
        .unwrap();
        assert!(!plain_ran.get());
    }
}
