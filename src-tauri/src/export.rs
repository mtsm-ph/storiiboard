//! Exports (1.24): the Save dialog for one file and the folder dialog for a set of files open from here, so the page
//! never names a place on disk to write. A write goes only to a file the person chose, or into a new folder made
//! inside the folder they chose, so an export never overwrites anything already there.
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
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

/// A plain file name with an export extension: no folders, no way up.
fn plain_name(name: &str) -> bool {
    let extension = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    !name.is_empty()
        && !name.contains(['/', '\\', '\0'])
        && name != "."
        && name != ".."
        && !name.starts_with('.')
        && extension.is_some_and(|e| EXTENSIONS.contains(&e.as_str()))
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

/// The Save dialog for one export file, suggesting `name`. The path picked can then be written.
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
    if folder.is_empty() || folder.contains(['/', '\\', '\0']) || folder.starts_with('.') {
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

/// `parent/name`, or `parent/name 2` and so on when that's taken: always a folder that wasn't there.
fn new_folder(parent: &Path, name: &str) -> Result<PathBuf, String> {
    for attempt in 1..=99 {
        let candidate = if attempt == 1 {
            parent.join(name)
        } else {
            parent.join(format!("{name} {attempt}"))
        };
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
    tauri::async_runtime::spawn_blocking(move || fs::write(&target, bytes))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

fn split_body(body: &[u8]) -> Result<(WriteHeader, &[u8]), String> {
    let bad = || "The export's bytes are malformed.".to_string();
    let length = u32::from_be_bytes(
        body.get(..4)
            .ok_or_else(bad)?
            .try_into()
            .map_err(|_| bad())?,
    ) as usize;
    let header = body.get(4..4 + length).ok_or_else(bad)?;
    let header: WriteHeader = serde_json::from_slice(header).map_err(|error| error.to_string())?;
    Ok((header, &body[4 + length..]))
}

/// Where a write goes, if it may go anywhere: the chosen file itself, or a plain new name in a folder made for it.
fn target_of(chosen: &Chosen, header: &WriteHeader) -> Result<PathBuf, String> {
    let path = PathBuf::from(&header.path);
    match &header.name {
        None if has(&chosen.files, &path) => Ok(path),
        Some(name) if has(&chosen.folders, &path) && plain_name(name) => {
            let file = path.join(name);
            // Never over a file already there: names in one export are unique, so this is a second write by mistake.
            if file.exists() {
                return Err(format!("{name} is in that folder already."));
            }
            Ok(file)
        }
        _ => Err("Storiiboard writes exports only where you choose.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_only_where_chosen_and_never_over_a_file() {
        let dir = std::env::temp_dir().join(format!("sbd-export-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let chosen = Chosen::default();
        let header = |path: &Path, name: Option<&str>| WriteHeader {
            path: path.to_str().unwrap().to_owned(),
            name: name.map(str::to_owned),
        };

        let file = dir.join("Bey County shot list.csv");
        assert!(
            target_of(&chosen, &header(&file, None)).is_err(),
            "nothing chosen yet"
        );
        remember(&chosen.files, &file);
        assert_eq!(target_of(&chosen, &header(&file, None)).unwrap(), file);
        // A chosen file isn't a folder to write other names into.
        assert!(target_of(&chosen, &header(&file, Some("x.png"))).is_err());

        let made = new_folder(&dir, "Bey County frames").unwrap();
        assert_eq!(
            new_folder(&dir, "Bey County frames").unwrap(),
            dir.join("Bey County frames 2")
        );
        remember(&chosen.folders, &made);
        assert_eq!(
            target_of(&chosen, &header(&made, Some("SC004_4A.png"))).unwrap(),
            made.join("SC004_4A.png")
        );
        for bad in [
            "../SC004_4A.png",
            "sub/SC004_4A.png",
            ".hidden.png",
            "notes.txt",
            "",
        ] {
            assert!(
                target_of(&chosen, &header(&made, Some(bad))).is_err(),
                "{bad}"
            );
        }
        fs::write(made.join("SC004_4A.png"), [1]).unwrap();
        assert!(
            target_of(&chosen, &header(&made, Some("SC004_4A.png"))).is_err(),
            "already there"
        );
        // The folder picked, not the one made inside it, can't be written into.
        assert!(target_of(&chosen, &header(&dir, Some("SC004_4B.png"))).is_err());
        fs::remove_dir_all(&dir).unwrap();
    }
}
