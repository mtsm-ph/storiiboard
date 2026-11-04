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
const EXTENSIONS: &[&str] = &["csv", "png", "pdf"];

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
async fn dialog<T: Send + 'static>(
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
    let picked = dialog(&app, move |handle| {
        let mut builder = handle
            .dialog()
            .file()
            .set_file_name(&name)
            .add_filter(extension.to_ascii_uppercase(), &[extension.as_str()]);
        if let Some(window) = handle.get_webview_window("main") {
            builder = builder.set_parent(&window);
        }
        builder.blocking_save_file()
    })
    .await?;
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    remember(&app.state::<Chosen>().files, &path);
    Ok(path.to_str().map(str::to_owned))
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
        None if take(&chosen.files, &path) => Ok(Target::Chosen(path)),
        Some(name) if has(&chosen.folders, &path) && plain_name(name) => inside(&path, name)
            .map(Target::New)
            .ok_or_else(|| "That isn't a name an export can have.".into()),
        _ => Err("Storiiboard writes exports only where you choose.".into()),
    }
}

fn write_to(target: &Target, bytes: &[u8]) -> Result<(), String> {
    match target {
        Target::Chosen(path) => fs::write(path, bytes).map_err(|error| error.to_string()),
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

#[cfg(test)]
mod tests {
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
