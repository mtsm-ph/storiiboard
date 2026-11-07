//! Exports (1.24): the Save dialog for one file and the folder dialog for a set of files open from here, so the page
//! never names a place on disk to write. A write goes only to a file the person chose, once, or into a new folder made
//! inside the folder they chose, so an export never overwrites anything already there.
use std::collections::HashSet;
use std::ffi::OsStr;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Deserialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

/// What an export may write: the file extensions of its formats.
const EXTENSIONS: &[&str] = &["csv", "png", "pdf", "mp4"];

/// The places chosen this session: whole files from the Save dialog, and folders made for a set of files.
#[derive(Default)]
pub struct Chosen {
    files: Mutex<HashSet<PathBuf>>,
    folders: Mutex<HashSet<PathBuf>>,
    choosing: AtomicBool,
}

fn remember(set: &Mutex<HashSet<PathBuf>>, path: &Path) {
    if let Ok(mut paths) = set.lock() {
        paths.insert(path.to_path_buf());
    }
}

fn has(set: &Mutex<HashSet<PathBuf>>, path: &Path) -> bool {
    set.lock().is_ok_and(|paths| paths.contains(path))
}

/// Takes `path` out of the set, saying whether it was there. A file from the Save dialog is written once: kept for
/// the session, the page could write over it again long after the person had moved on to other work in it.
fn take(set: &Mutex<HashSet<PathBuf>>, path: &Path) -> bool {
    set.lock().is_ok_and(|mut paths| paths.remove(path))
}

/// Takes the file the Save dialog picked for `path`, once, for a writer other than `export_write` (a clip saved as a
/// file, 2.8b, which ffmpeg writes): only a file the person chose, as every export.
pub(crate) fn take_chosen_file(app: &AppHandle, path: &Path) -> bool {
    take(&app.state::<Chosen>().files, path)
}

/// Whether a path names a video file (an export of type mp4).
fn is_video_path(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|e| e.eq_ignore_ascii_case("mp4"))
}

/// One plain name for a file or folder inside another: no folders, no way up, nothing hidden. A colon is refused
/// too: on Windows `D:evil.png` joined onto a folder is a path on drive D, and `a.png:b` names a stream of `a.png`.
fn plain_part(name: &str) -> bool {
    if name.is_empty() || name.contains(['/', '\\', ':', '\0']) || name.starts_with('.') {
        return false;
    }
    let mut parts = Path::new(name).components();
    matches!(
        (parts.next(), parts.next()),
        (Some(Component::Normal(part)), None) if part == OsStr::new(name)
    )
}

/// A plain file name with an export extension.
fn plain_name(name: &str) -> bool {
    let extension = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    plain_part(name) && extension.is_some_and(|e| EXTENSIONS.contains(&e.as_str()))
}

/// `folder/name`, only when that lands right inside `folder`: the name check and the path agree, or nothing.
fn inside(folder: &Path, name: &str) -> Option<PathBuf> {
    let joined = folder.join(name);
    (plain_part(name) && joined.parent() == Some(folder)).then_some(joined)
}

/// Runs one dialog at a time, on a thread of its own since it waits for the person.
pub(crate) async fn dialog<T: Send + 'static>(
    app: &AppHandle,
    run: impl FnOnce(&AppHandle) -> Option<T> + Send + 'static,
) -> Result<Option<T>, String> {
    if app.state::<Chosen>().choosing.swap(true, Ordering::SeqCst) {
        return Ok(None);
    }
    let handle = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || run(&handle)).await;
    app.state::<Chosen>()
        .choosing
        .store(false, Ordering::SeqCst);
    picked.map_err(|error| error.to_string())
}

/// The Save dialog for one export file, suggesting `name`. The path picked can then be written, once.
#[tauri::command]
pub async fn export_choose_file(app: AppHandle, name: String) -> Result<Option<String>, String> {
    if !plain_name(&name) {
        return Err("That isn't a name an export can have.".into());
    }
    let extension = Path::new(&name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let filter = extension.clone();
    let picked = dialog(&app, move |handle| {
        let mut builder = handle
            .dialog()
            .file()
            .set_file_name(&name)
            .add_filter(filter.to_ascii_uppercase(), &[filter.as_str()]);
        if let Some(window) = handle.get_webview_window("main") {
            builder = builder.set_parent(&window);
        }
        builder.blocking_save_file()
    })
    .await?;
    let Some(picked) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    let path = as_export(picked, &extension)?;
    remember(&app.state::<Chosen>().files, &path);
    Ok(path.to_str().map(str::to_owned))
}

/// The file the Save dialog picked, made to end in the export's own extension. The filter is only a suggestion: on
/// Windows a name typed with its own extension keeps it, and GTK enforces nothing, so a pick of `Bey County.sbd` would
/// cut the open project down to a CSV. With the extension, an export can never be a project (`.sbd`) or its lock file
/// (`.lock`), open here or not, nor a backup.
fn as_export(picked: PathBuf, extension: &str) -> Result<PathBuf, String> {
    let name = picked
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or("That isn't a name an export can have.")?;
    // `Bey County.sbd:x.csv` on Windows is a stream inside the project file, whatever its extension says. Elsewhere a
    // colon is a plain letter: a Mac Save panel hands a `/` typed in the name over as `:`.
    if cfg!(windows) && name.contains(':') {
        return Err("That isn't a name an export can have.".into());
    }
    let ends_right = picked
        .extension()
        .and_then(OsStr::to_str)
        .is_some_and(|e| e.eq_ignore_ascii_case(extension));
    if ends_right {
        return Ok(picked);
    }
    let mut appended = picked.into_os_string();
    appended.push(".");
    appended.push(extension);
    let appended = PathBuf::from(appended);
    // The dialog asked before replacing the name the person gave, not this one, so this one must be new.
    if appended.symlink_metadata().is_ok() {
        return Err(format!(
            "{} is there already; choose another name.",
            appended.file_name().unwrap_or_default().to_string_lossy()
        ));
    }
    Ok(appended)
}

/// The folder dialog for a set of files. A new folder named `folder` (or `folder 2`…) is made inside the one picked,
/// and only that can then be written into.
#[tauri::command]
pub async fn export_choose_folder(
    app: AppHandle,
    folder: String,
) -> Result<Option<String>, String> {
    if !plain_part(&folder) {
        return Err("That isn't a name an export folder can have.".into());
    }
    let picked = dialog(&app, |handle| {
        let mut builder = handle.dialog().file();
        if let Some(window) = handle.get_webview_window("main") {
            builder = builder.set_parent(&window);
        }
        builder.blocking_pick_folder()
    })
    .await?;
    let Some(parent) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    let made = new_folder(&parent, &folder)?;
    remember(&app.state::<Chosen>().folders, &made);
    Ok(made.to_str().map(str::to_owned))
}

/// `parent/name`, or `parent/name 2` and so on when that's taken: always a folder that wasn't there, right inside
/// `parent`.
fn new_folder(parent: &Path, name: &str) -> Result<PathBuf, String> {
    for attempt in 1..=99 {
        let candidate = if attempt == 1 {
            inside(parent, name)
        } else {
            inside(parent, &format!("{name} {attempt}"))
        }
        .ok_or("That isn't a name an export folder can have.")?;
        match fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("There are many exports in that folder already; choose another.".into())
}

#[derive(Deserialize)]
struct WriteHeader {
    /// A file from the Save dialog, or a folder from the folder dialog.
    path: String,
    /// In a folder: the file's name.
    name: Option<String>,
}

/// Writes an export's bytes: the body is a 4-byte big-endian length, that many bytes of JSON header (`WriteHeader`),
/// then the file's bytes.
#[tauri::command]
pub async fn export_write(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err("Expected the export as raw bytes.".into());
    };
    let (header, bytes) = split_body(body)?;
    let target = target_of(&app.state::<Chosen>(), &header)?;
    let bytes = bytes.to_vec();
    tauri::async_runtime::spawn_blocking(move || write_to(&target, &bytes))
        .await
        .map_err(|error| error.to_string())?
}

fn split_body(body: &[u8]) -> Result<(WriteHeader, &[u8]), String> {
    let bad = || "The export's bytes are malformed.".to_string();
    let length = u32::from_be_bytes(
        body.get(..4)
            .ok_or_else(bad)?
            .try_into()
            .map_err(|_| bad())?,
    ) as usize;
    // Checked, so a length near the top of the range can't wrap round on a 32-bit build.
    let end = length.checked_add(4).ok_or_else(bad)?;
    let header = body.get(4..end).ok_or_else(bad)?;
    let header: WriteHeader = serde_json::from_slice(header).map_err(|_| bad())?;
    Ok((header, &body[end..]))
}

/// Where a write goes.
#[derive(Debug, PartialEq)]
enum Target {
    /// The file picked in the Save dialog, which asked the person before replacing one there.
    Chosen(PathBuf),
    /// A new file in a folder made for the export: never one already there.
    New(PathBuf),
}

/// Where a write goes, if it may go anywhere: the chosen file itself, once, or a plain new name in a folder made for
/// it.
fn target_of(chosen: &Chosen, header: &WriteHeader) -> Result<Target, String> {
    let path = PathBuf::from(&header.path);
    match &header.name {
        // Never a video from here: only a clip's own render writes one (video.rs save_clip), with its own guards.
        None if is_video_path(&path) => {
            Err("Storiiboard writes exports only where you choose.".into())
        }
        None if take(&chosen.files, &path) => Ok(Target::Chosen(path)),
        Some(name) if has(&chosen.folders, &path) && plain_name(name) => inside(&path, name)
            .map(Target::New)
            .ok_or_else(|| "That isn't a name an export can have.".into()),
        _ => Err("Storiiboard writes exports only where you choose.".into()),
    }
}

fn write_to(target: &Target, bytes: &[u8]) -> Result<(), String> {
    match target {
        Target::Chosen(path) => replace(path, |file| file.write_all(bytes)),
        Target::New(path) => {
            // create_new checks and makes the file in one step, so nothing can slip in between, and it fails on a
            // link already there rather than writing wherever the link points. Names in one export are unique, so a
            // file there means a second write by mistake.
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
                .map_err(|error| match error.kind() {
                    std::io::ErrorKind::AlreadyExists => format!(
                        "{} is in that folder already.",
                        path.file_name().unwrap_or_default().to_string_lossy()
                    ),
                    _ => error.to_string(),
                })?;
            file.write_all(bytes).map_err(|error| {
                // Made a moment ago and ours alone: a half-written frame helps no one.
                let _ = fs::remove_file(path);
                error.to_string()
            })
        }
    }
}

/// Writes the file the Save dialog picked by filling a new file beside it and renaming that over it once it is whole.
/// Truncated first, as fs::write does, a write that failed partway (a full disk) lost the file the person had agreed
/// to replace and left a cut-short one in its place. The new file is made with create_new, so a name already there,
/// a link included, is never written through; on any failure it is removed and the chosen file is as it was.
fn replace(
    path: &Path,
    fill: impl FnOnce(&mut fs::File) -> std::io::Result<()>,
) -> Result<(), String> {
    let folder = path.parent().unwrap_or(Path::new(""));
    let name = path
        .file_name()
        .ok_or("That isn't a name an export can have.")?
        .to_string_lossy();
    let mut made = None;
    for attempt in 1..=99 {
        let temp = folder.join(format!(".{name}.{}-{attempt}.part", std::process::id()));
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
        {
            Ok(file) => {
                made = Some((temp, file));
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    let (temp, mut file) = made.ok_or("There are many unfinished exports in that folder.")?;
    let written = fill(&mut file).and_then(|()| file.sync_all());
    // Closed before the rename: Windows won't move a file that is still open.
    drop(file);
    written
        .and_then(|()| fs::rename(&temp, path))
        .map_err(|error| {
            let _ = fs::remove_file(&temp);
            error.to_string()
        })
}

#[cfg(test)]
mod tests {

    #[test]
    fn writes_no_video_through_the_export_writer() {
        // A clip is rendered by video.rs, with its own guards; bytes the page sends are never a video, even to a file
        // the Save dialog picked (which could be a camera original).
        let chosen = Chosen::default();
        remember(&chosen.files, Path::new("/Footage/A001_C003.MP4"));
        let header = WriteHeader {
            path: "/Footage/A001_C003.MP4".into(),
            name: None,
        };
        assert!(target_of(&chosen, &header).is_err());
        assert!(
            has(&chosen.files, Path::new("/Footage/A001_C003.MP4")),
            "not taken either"
        );
    }
    use super::*;

    fn temp(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sbd-export-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn header(path: &Path, name: Option<&str>) -> WriteHeader {
        WriteHeader {
            path: path.to_str().unwrap().to_owned(),
            name: name.map(str::to_owned),
        }
    }

    fn body(header: &[u8], bytes: &[u8]) -> Vec<u8> {
        let mut body = (header.len() as u32).to_be_bytes().to_vec();
        body.extend_from_slice(header);
        body.extend_from_slice(bytes);
        body
    }

    #[test]
    fn writes_only_where_chosen_and_never_over_a_file() {
        let dir = temp("chosen");
        let chosen = Chosen::default();

        let file = dir.join("Bey County shot list.csv");
        assert!(
            target_of(&chosen, &header(&file, None)).is_err(),
            "nothing chosen yet"
        );
        remember(&chosen.files, &file);
        // A chosen file isn't a folder to write other names into.
        assert!(target_of(&chosen, &header(&file, Some("x.png"))).is_err());
        assert_eq!(
            target_of(&chosen, &header(&file, None)).unwrap(),
            Target::Chosen(file.clone())
        );
        assert!(
            target_of(&chosen, &header(&file, None)).is_err(),
            "written once, the file is no longer the page's to write"
        );

        let made = new_folder(&dir, "Bey County frames").unwrap();
        assert_eq!(
            new_folder(&dir, "Bey County frames").unwrap(),
            dir.join("Bey County frames 2")
        );
        remember(&chosen.folders, &made);
        let frame = target_of(&chosen, &header(&made, Some("SC004_4A.png"))).unwrap();
        assert_eq!(frame, Target::New(made.join("SC004_4A.png")));
        for bad in [
            "../SC004_4A.png",
            "sub/SC004_4A.png",
            "sub\\SC004_4A.png",
            ".hidden.png",
            "notes.txt",
            "",
        ] {
            assert!(
                target_of(&chosen, &header(&made, Some(bad))).is_err(),
                "{bad}"
            );
        }
        write_to(&frame, &[1]).unwrap();
        assert!(
            write_to(&frame, &[2]).unwrap_err().contains("already"),
            "never over a file already there"
        );
        assert_eq!(fs::read(made.join("SC004_4A.png")).unwrap(), [1]);
        // The folder picked, not the one made inside it, can't be written into.
        assert!(target_of(&chosen, &header(&dir, Some("SC004_4B.png"))).is_err());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_name_with_a_drive_or_a_stream_never_leaves_the_folder() {
        let dir = temp("drive");
        let chosen = Chosen::default();
        let made = new_folder(&dir, "Bey County frames").unwrap();
        remember(&chosen.folders, &made);
        for bad in [
            "D:evil.png",
            "C:\\Windows\\evil.png",
            "\\\\server\\share\\evil.png",
            "/etc/evil.png",
            "SC004_4A.png:hidden.png",
            "D:",
        ] {
            assert!(!plain_name(bad), "{bad}");
            assert!(
                target_of(&chosen, &header(&made, Some(bad))).is_err(),
                "{bad}"
            );
        }
        for bad in ["D:evil", "..", ".", "a/b", "C:\\x", ""] {
            assert!(new_folder(&dir, bad).is_err(), "folder {bad}");
        }
        assert!(plain_part("Bey County SC 04 frames"));
        assert!(plain_name("SC012A_12AA.png"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_save_dialog_pick_of_the_project_never_writes_over_it() {
        let dir = temp("pick");
        let project = dir.join("Bey County.sbd");
        fs::write(&project, b"SQLite format 3\0").unwrap();

        let csv = as_export(project.clone(), "csv").unwrap();
        assert_eq!(csv, dir.join("Bey County.sbd.csv"));
        // Its extension in any case, and the lock file beside it, end up as exports of their own too.
        assert_eq!(
            as_export(dir.join("Bey County.SBD"), "csv").unwrap(),
            dir.join("Bey County.SBD.csv")
        );
        assert_eq!(
            as_export(dir.join(".Bey County.sbd.lock"), "csv").unwrap(),
            dir.join(".Bey County.sbd.lock.csv")
        );
        for kept in ["Bey County shot list.csv", "Bey County shot list.CSV"] {
            assert_eq!(as_export(dir.join(kept), "csv").unwrap(), dir.join(kept));
        }
        // A name typed without an extension, as GTK returns it.
        assert_eq!(
            as_export(dir.join("shots"), "csv").unwrap(),
            dir.join("shots.csv")
        );
        // Nobody was asked about replacing the name with the extension added, so a file there stays.
        fs::write(&csv, b"kept").unwrap();
        assert!(as_export(project.clone(), "csv")
            .unwrap_err()
            .contains("there already"));

        // The whole way through: the remembered path is the CSV, and the project is untouched.
        let chosen = Chosen::default();
        fs::remove_file(&csv).unwrap();
        remember(&chosen.files, &as_export(project.clone(), "csv").unwrap());
        assert!(target_of(&chosen, &header(&project, None)).is_err());
        let target = target_of(&chosen, &header(&csv, None)).unwrap();
        write_to(&target, b"Scene,Shot\r\n").unwrap();
        assert_eq!(fs::read(&project).unwrap(), b"SQLite format 3\0");
        assert!(EXTENSIONS.iter().all(|e| !["sbd", "lock"].contains(e)));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn a_save_dialog_pick_of_a_stream_is_refused() {
        let dir = temp("stream");
        assert!(as_export(dir.join("Bey County.sbd:x.csv"), "csv").is_err());
        assert!(as_export(dir.join("Bey County 11:04.csv"), "csv").is_err());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_colon_in_a_save_dialog_pick_is_a_plain_letter_off_windows() {
        let dir = temp("colon");
        let picked = dir.join("Bey County 11:04.csv");
        assert_eq!(as_export(picked.clone(), "csv").unwrap(), picked);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_link_in_the_folder_is_never_followed() {
        let dir = temp("link");
        let outside = dir.join("outside.png");
        fs::write(&outside, [9]).unwrap();
        let made = new_folder(&dir, "frames").unwrap();
        std::os::unix::fs::symlink(&outside, made.join("SC004_4A.png")).unwrap();
        assert!(write_to(&Target::New(made.join("SC004_4A.png")), &[1]).is_err());
        assert_eq!(fs::read(&outside).unwrap(), [9]);
        fs::remove_dir_all(&dir).unwrap();
    }

    /// What is in `dir`, by name, sorted.
    fn names_in(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn a_chosen_file_is_replaced_only_once_the_new_one_is_whole() {
        let dir = temp("replace");
        let pdf = dir.join("Bey County storyboard.pdf");
        fs::write(&pdf, b"%PDF old").unwrap();

        // Half the new PDF goes out, then the disk is full: the old one is still there, and nothing else is.
        let failed = replace(&pdf, |file| {
            file.write_all(b"%PDF new, half")?;
            Err(std::io::Error::other("disk full"))
        });
        assert!(failed.unwrap_err().contains("disk full"));
        assert_eq!(fs::read(&pdf).unwrap(), b"%PDF old");
        assert_eq!(names_in(&dir), ["Bey County storyboard.pdf"]);

        // A file already at the first temporary name is someone else's: left as it was, the next name is used.
        let taken = dir.join(format!(
            ".Bey County storyboard.pdf.{}-1.part",
            std::process::id()
        ));
        fs::write(&taken, b"not ours").unwrap();
        let chosen = Chosen::default();
        remember(&chosen.files, &pdf);
        let target = target_of(&chosen, &header(&pdf, None)).unwrap();
        write_to(&target, b"%PDF new").unwrap();
        assert_eq!(fs::read(&pdf).unwrap(), b"%PDF new");
        assert_eq!(fs::read(&taken).unwrap(), b"not ours");
        fs::remove_file(&taken).unwrap();
        assert_eq!(names_in(&dir), ["Bey County storyboard.pdf"]);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_link_at_the_temporary_name_is_never_followed() {
        let dir = temp("replace-link");
        let outside = dir.join("outside.pdf");
        fs::write(&outside, b"kept").unwrap();
        let pdf = dir.join("Bey County storyboard.pdf");
        let link = dir.join(format!(
            ".Bey County storyboard.pdf.{}-1.part",
            std::process::id()
        ));
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        replace(&pdf, |file| file.write_all(b"%PDF new")).unwrap();
        assert_eq!(fs::read(&pdf).unwrap(), b"%PDF new");
        assert_eq!(fs::read(&outside).unwrap(), b"kept");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_malformed_body_is_refused() {
        let good = br#"{"path":"/x","name":"SC004_4A.png"}"#;
        let whole = body(good, &[1, 2, 3]);
        let (parsed, bytes) = split_body(&whole).unwrap();
        assert_eq!(parsed.name.as_deref(), Some("SC004_4A.png"));
        assert_eq!(bytes, [1, 2, 3]);

        let mut long = body(good, &[]);
        long[..4].copy_from_slice(&(good.len() as u32 + 1).to_be_bytes());
        let mut huge = body(good, &[]);
        huge[..4].copy_from_slice(&u32::MAX.to_be_bytes());
        for bad in [
            Vec::new(),
            vec![0, 0],
            long,
            huge,
            body(b"not json", &[1]),
            body(br#"{"name":"SC004_4A.png"}"#, &[1]),
        ] {
            assert!(split_body(&bad).is_err(), "{bad:?}");
        }
    }
}
