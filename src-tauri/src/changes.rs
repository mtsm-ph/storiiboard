//! Change files in (7.1, docs/SBD_FORMAT.md "Change files"): suggestions from the assistant or brought by hand, read
//! here and handed to the page as bytes, which reads them with its one checked reader (src/core/storage/changeFile.ts).
//! A change file is untrusted input, and so is the folder it sits in: anyone can put anything there. So this side
//! reads only regular files, never through a link or a Windows junction, at most 5 MB each and 200 at a time, and the
//! page never names a path for the folder: it names the open project's handle, and the folder is found beside it.
//! Nothing in the folder is ever written, moved or deleted, but for the one rename a person asks for (a renamed
//! project's folder, renamed to match), and that only from a folder beside the project whose marker names it, only to
//! `<Project> Suggestions`, and never over anything already there.
//!
//! - `changes_choose` and `changes_read`: Import changes… and a dropped file. Only a path the Open dialog or the drop gave
//!   Rust (pictures.rs's `Offered`), only a name ending in `.sbdchanges`, read once and at most 5 MB.
//! - `changes_folder`: the listing of `<Project> Suggestions/` beside the open project, with its marker's word on it,
//!   and, when there is none, a renamed project's folder to offer to rename.
//! - `changes_folder_read`: one listed file's bytes, by its name in that folder.
//! - `changes_folder_rename`: the rename, after the person says so.

use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{ipc::Response, AppHandle, Manager, Runtime, State};

use crate::pictures::Offered;
use crate::sbd::OpenFiles;

/// The largest change file read: the page's own limit (changeFile.ts, MAX_CHANGE_FILE_BYTES).
pub(crate) const MAX_CHANGE_FILE_BYTES: u64 = 5 * 1024 * 1024;
/// The most change files listed at a time; the rest wait for the next bring-in.
const MAX_FOLDER_FILES: usize = 200;
/// The most entries of a folder looked at, so a folder of a million files can't hold the app up.
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

fn refused(message: &str) -> io::Error {
    io::Error::other(message.to_owned())
}

/// Opens a regular file without following a link or a junction at its last step, and checks the file opened is the one
/// looked at (a link swapped in between can't be followed out of the folder). Windows opens the reparse point itself
/// (FILE_FLAG_OPEN_REPARSE_POINT), so a link opens as a link and is refused; elsewhere the opened file's device and
/// inode must be the ones the path had without following anything.
fn open_regular(path: &Path) -> io::Result<(fs::File, fs::Metadata)> {
    let before = fs::symlink_metadata(path)?;
    if !before.file_type().is_file() {
        return Err(refused("not a regular file"));
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options.open(path)?;
    let meta = file.metadata()?;
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
    let Ok(json) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
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

/// Whether `folder` is a real folder sitting where it is named, not a link or a junction, and not reached through one:
/// its real path is its parent's real path and its own name (in any case, as Windows and a Mac match names).
fn real_folder(folder: &Path) -> Result<bool, io::Error> {
    let meta = fs::symlink_metadata(folder)?;
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return Ok(false);
    }
    let (Some(parent), Some(name)) = (folder.parent(), folder.file_name().and_then(|n| n.to_str()))
    else {
        return Ok(false);
    };
    let real = fs::canonicalize(folder)?;
    let same_name = real
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.eq_ignore_ascii_case(name));
    Ok(same_name && real.parent() == Some(fs::canonicalize(parent)?.as_path()))
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Listed {
    name: String,
    bytes: u64,
    /// Modified time in ms since the epoch, 0 when the system has none: with the size, how the page knows a file it
    /// has read already this session.
    modified: u64,
}

/// What `changes_folder` found. `state`: `none` (no folder), `read` (files listed), `other_project` (its marker names
/// another project: nothing listed) or `link` (a link or a junction, or not a folder: never followed, nothing listed).
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    folder: String,
    state: &'static str,
    other_project_name: Option<String>,
    files: Vec<Listed>,
    too_large: Vec<String>,
    /// Change files past the first 200, which wait.
    more: usize,
    /// With no folder of this project's name: a `* Suggestions` folder beside it whose marker names this project, to
    /// offer to rename.
    rename_from: Option<String>,
}

/// The `.sbdchanges` files in a folder already known to be real: regular files only, the marker left out, by name.
fn list_files(folder: &Path) -> io::Result<(Vec<Listed>, Vec<String>, usize)> {
    let mut found: Vec<Listed> = Vec::new();
    let mut too_large: Vec<String> = Vec::new();
    for entry in fs::read_dir(folder)?.take(MAX_ENTRIES) {
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
    found.sort_by(|a, b| a.name.cmp(&b.name));
    too_large.sort();
    too_large.truncate(MAX_TOO_LARGE_LISTED);
    let more = found.len().saturating_sub(MAX_FOLDER_FILES);
    found.truncate(MAX_FOLDER_FILES);
    Ok((found, too_large, more))
}

/// A renamed project's folder: a real `* Suggestions` folder beside the project whose marker names it, the first by
/// name; never the project's own name.
fn renamed_folder(beside: &Path, own: &str, project_id: &str) -> Option<String> {
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
        .collect();
    candidates.sort();
    candidates.into_iter().find(|name| {
        let folder = beside.join(name);
        real_folder(&folder).unwrap_or(false) && read_marker(&folder, project_id) == Marker::Ours
    })
}

/// The listing for the project at `project`.
fn listing(project: &Path, project_id: &str) -> Result<Listing, String> {
    let fail = |_| FOLDER_UNREADABLE.to_owned();
    let beside = project.parent().ok_or(FOLDER_UNREADABLE)?;
    let name = folder_name(project).ok_or(FOLDER_UNREADABLE)?;
    let folder = beside.join(&name);
    let mut out = Listing {
        folder: name.clone(),
        state: "none",
        other_project_name: None,
        files: Vec::new(),
        too_large: Vec::new(),
        more: 0,
        rename_from: None,
    };
    match fs::symlink_metadata(&folder) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            out.rename_from = renamed_folder(beside, &name, project_id);
            return Ok(out);
        }
        Err(error) => return Err(fail(error)),
        Ok(_) => {}
    }
    if !real_folder(&folder).map_err(fail)? {
        out.state = "link";
        return Ok(out);
    }
    if let Marker::Other(other) = read_marker(&folder, project_id) {
        out.state = "other_project";
        out.other_project_name = Some(other);
        return Ok(out);
    }
    let (files, too_large, more) = list_files(&folder).map_err(fail)?;
    out.state = "read";
    out.files = files;
    out.too_large = too_large;
    out.more = more;
    Ok(out)
}

/// One file of the project's folder, by its name: only a listed kind of file (a `.sbdchanges` regular file, not the
/// marker) in a real folder whose marker doesn't name another project, read once, at most 5 MB.
fn read_from_folder(project: &Path, project_id: &str, name: &str) -> Result<Vec<u8>, String> {
    if !plain_name(name) || !is_change_file_name(name) || name.eq_ignore_ascii_case(MARKER_NAME) {
        return Err(NOT_SBDCHANGES.to_owned());
    }
    let beside = project.parent().ok_or(FOLDER_UNREADABLE)?;
    let folder = beside.join(folder_name(project).ok_or(FOLDER_UNREADABLE)?);
    if !real_folder(&folder).unwrap_or(false)
        || matches!(read_marker(&folder, project_id), Marker::Other(_))
    {
        return Err(FOLDER_UNREADABLE.to_owned());
    }
    let path = folder.join(name);
    let (file, meta) = open_regular(&path).map_err(|_| UNREADABLE.to_owned())?;
    if meta.len() > MAX_CHANGE_FILE_BYTES {
        return Err(TOO_LARGE.to_owned());
    }
    // Still in the folder by its real path, once open.
    let real = fs::canonicalize(&path).map_err(|_| UNREADABLE.to_owned())?;
    if real.parent()
        != Some(
            fs::canonicalize(&folder)
                .map_err(|_| UNREADABLE.to_owned())?
                .as_path(),
        )
    {
        return Err(UNREADABLE.to_owned());
    }
    read_capped(file, MAX_CHANGE_FILE_BYTES)
        .map_err(|_| UNREADABLE.to_owned())?
        .ok_or_else(|| TOO_LARGE.to_owned())
}

/// The rename a person asked for: `from`, a real `* Suggestions` folder beside the project whose marker names it, to
/// `<Project> Suggestions`, only when nothing of that name is there.
fn rename_folder(project: &Path, project_id: &str, from: &str) -> Result<(), String> {
    let no = || RENAME_REFUSED.to_owned();
    let beside = project.parent().ok_or_else(no)?;
    let to = folder_name(project).ok_or_else(no)?;
    if !plain_name(from) || !from.ends_with(FOLDER_SUFFIX) || from == to {
        return Err(no());
    }
    let source = beside.join(from);
    if !real_folder(&source).unwrap_or(false) || read_marker(&source, project_id) != Marker::Ours {
        return Err(no());
    }
    let dest = beside.join(&to);
    // Never over anything: a file, a folder or a link of that name stops it.
    match fs::symlink_metadata(&dest) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        _ => return Err(no()),
    }
    fs::rename(&source, &dest).map_err(|_| no())
}

/// A file the person picked or dropped: only one Rust was given, only a `.sbdchanges`, read once, at most 5 MB.
fn read_offered(offered: &Offered, path: &Path) -> Result<Vec<u8>, String> {
    if !offered.has(path) {
        return Err(NOT_OFFERED.to_owned());
    }
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if !is_change_file_name(name) {
        return Err(NOT_SBDCHANGES.to_owned());
    }
    let (file, meta) = open_regular(path).map_err(|_| UNREADABLE.to_owned())?;
    if meta.len() > MAX_CHANGE_FILE_BYTES {
        return Err(TOO_LARGE.to_owned());
    }
    read_capped(file, MAX_CHANGE_FILE_BYTES)
        .map_err(|_| UNREADABLE.to_owned())?
        .ok_or_else(|| TOO_LARGE.to_owned())
}

/// The open project's path, read under the lock and let go before any folder is looked at.
fn project_path(files: &OpenFiles, handle: u32) -> Result<PathBuf, String> {
    files.with(handle, |file| Ok(file.file_path().to_path_buf()))
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

/// The bytes of a change file the person picked or dropped.
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
pub async fn changes_folder(
    files: State<'_, OpenFiles>,
    handle: u32,
    project_id: String,
) -> Result<Listing, String> {
    let project = project_path(&files, handle)?;
    tauri::async_runtime::spawn_blocking(move || listing(&project, &project_id))
        .await
        .map_err(|_| FOLDER_UNREADABLE.to_owned())?
}

/// One file of the open project's suggestions folder, by its name.
#[tauri::command]
pub async fn changes_folder_read(
    files: State<'_, OpenFiles>,
    handle: u32,
    project_id: String,
    name: String,
) -> Result<Response, String> {
    let project = project_path(&files, handle)?;
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
    project_id: String,
    from: String,
) -> Result<(), String> {
    let project = project_path(&files, handle)?;
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
        let project = dir.join("Bey County.sbd");
        let folder = dir.join("Bey County Suggestions");
        fs::create_dir_all(&folder).unwrap();
        (project, folder)
    }

    fn names(listing: &Listing) -> Vec<&str> {
        listing.files.iter().map(|f| f.name.as_str()).collect()
    }

    #[test]
    fn no_folder_is_none_and_lists_nothing() {
        let dir = temp_dir("none");
        let listed = listing(&dir.join("Bey County.sbd"), ID).unwrap();
        assert_eq!(listed.state, "none");
        assert_eq!(listed.folder, "Bey County Suggestions");
        assert!(listed.files.is_empty());
        assert_eq!(listed.rename_from, None);
    }

    #[test]
    fn lists_only_change_files_and_skips_the_marker_and_folders() {
        let dir = temp_dir("only");
        let (project, folder) = project_and_folder(&dir);
        marker(&folder, ID, "Bey County");
        fs::write(folder.join("b.sbdchanges"), "{}").unwrap();
        fs::write(folder.join("A.SBDCHANGES"), "{}").unwrap();
        fs::write(folder.join("notes.txt"), "x").unwrap();
        fs::write(folder.join("c.sbdchanges.json"), "{}").unwrap();
        fs::create_dir(folder.join("d.sbdchanges")).unwrap();
        let listed = listing(&project, ID).unwrap();
        assert_eq!(listed.state, "read");
        assert_eq!(names(&listed), ["A.SBDCHANGES", "b.sbdchanges"]);
        assert_eq!(listed.files[1].bytes, 2);
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
        marker(&folder, OTHER, "Harbor Lights");
        fs::write(folder.join("a.sbdchanges"), "{}").unwrap();
        let listed = listing(&project, ID).unwrap();
        assert_eq!(listed.state, "other_project");
        assert_eq!(listed.other_project_name.as_deref(), Some("Harbor Lights"));
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
    fn at_most_200_files_by_name_and_the_rest_counted() {
        let dir = temp_dir("cap");
        let (project, folder) = project_and_folder(&dir);
        for i in 0..205 {
            fs::write(folder.join(format!("{i:03}.sbdchanges")), "{}").unwrap();
        }
        let listed = listing(&project, ID).unwrap();
        assert_eq!(listed.files.len(), 200);
        assert_eq!(listed.more, 5);
        assert_eq!(listed.files[0].name, "000.sbdchanges");
        assert_eq!(listed.files[199].name, "199.sbdchanges");
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
        let project = dir.join("Bey County.sbd");
        let old = dir.join("Old Name Suggestions");
        fs::create_dir(&old).unwrap();
        // No marker: not this project's, so no offer.
        assert_eq!(listing(&project, ID).unwrap().rename_from, None);
        marker(&old, OTHER, "Harbor Lights");
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
    fn renames_only_its_own_marked_folder_beside_the_project_to_its_name() {
        let dir = temp_dir("rename");
        let project = dir.join("Bey County.sbd");
        let old = dir.join("Old Name Suggestions");
        fs::create_dir(&old).unwrap();
        fs::write(old.join("a.sbdchanges"), "{}").unwrap();
        // Unmarked, or marked for another project: refused.
        assert_eq!(
            rename_folder(&project, ID, "Old Name Suggestions").unwrap_err(),
            RENAME_REFUSED
        );
        marker(&old, OTHER, "Harbor Lights");
        assert!(rename_folder(&project, ID, "Old Name Suggestions").is_err());
        marker(&old, ID, "Old Name");
        // Only a plain `* Suggestions` name beside the project.
        let notes = dir.join("Old Name Notes");
        fs::create_dir(&notes).unwrap();
        marker(&notes, ID, "Old Name");
        for from in [
            "Old Name Notes",
            "../Old Name Suggestions",
            "Bey County Suggestions",
            "",
        ] {
            assert!(rename_folder(&project, ID, from).is_err(), "{from}");
        }
        assert!(notes.is_dir());
        rename_folder(&project, ID, "Old Name Suggestions").unwrap();
        assert!(!old.exists());
        assert!(dir
            .join("Bey County Suggestions")
            .join("a.sbdchanges")
            .is_file());
    }

    #[test]
    fn never_renames_over_an_existing_folder_or_file() {
        let dir = temp_dir("over");
        let project = dir.join("Bey County.sbd");
        let old = dir.join("Old Name Suggestions");
        fs::create_dir(&old).unwrap();
        marker(&old, ID, "Old Name");
        let own = dir.join("Bey County Suggestions");
        fs::create_dir(&own).unwrap();
        assert!(rename_folder(&project, ID, "Old Name Suggestions").is_err());
        assert!(old.is_dir() && own.is_dir());
        fs::remove_dir(&own).unwrap();
        fs::write(&own, "a file").unwrap();
        assert!(rename_folder(&project, ID, "Old Name Suggestions").is_err());
        assert_eq!(fs::read_to_string(&own).unwrap(), "a file");
        assert!(old.is_dir());
    }

    #[test]
    fn reads_only_an_offered_change_file_of_at_most_5_mb() {
        let dir = temp_dir("offered");
        let offered = Offered::default();
        let file = dir.join("Robin.sbdchanges");
        fs::write(&file, "{}").unwrap();
        assert_eq!(read_offered(&offered, &file).unwrap_err(), NOT_OFFERED);
        offered.offer(std::slice::from_ref(&file));
        assert_eq!(read_offered(&offered, &file).unwrap(), b"{}");
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
}
