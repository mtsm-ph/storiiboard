//! Pictures from files on disk, for frames (1.11). The page never names a file for Rust to read on its own: it can read
//! only files the person dropped on the window or picked in the Open dialog shown from here, so a bug or a script
//! slipped into the page can't read anything else on the computer.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{ipc::Response, AppHandle, Emitter, Manager, PhysicalPosition, State, Window};
use tauri_plugin_dialog::DialogExt;

/// The largest file read as a picture. A 48 MP ProRAW photo is about 75 MB; a file far past that isn't for a board.
const MAX_BYTES: u64 = 200 * 1024 * 1024;

/// What the Open dialog offers. The webview decides what it can read (HEIC only on a Mac); the rest gets a message.
const EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "heic", "heif", "tif", "tiff", "gif", "bmp",
];

/// The files the person has handed the app this session, by drop or by the Open dialog.
#[derive(Default)]
pub struct Offered(Mutex<HashSet<PathBuf>>);

impl Offered {
    fn offer(&self, paths: &[PathBuf]) {
        if let Ok(mut offered) = self.0.lock() {
            offered.extend(paths.iter().cloned());
        }
    }

    fn has(&self, path: &Path) -> bool {
        self.0.lock().is_ok_and(|offered| offered.contains(path))
    }
}

/// Where files were dropped, in the window's physical pixels, for the page to find the frame under them.
#[derive(Clone, Serialize)]
struct Dropped {
    paths: Vec<String>,
    x: f64,
    y: f64,
}

pub const DROPPED_EVENT: &str = "storiiboard://pictures-dropped";

/// Called for every drop on the window (lib.rs). The files become readable first, and only then does the page hear of
/// them, so it never asks for one it can't have yet.
pub fn dropped(window: &Window, paths: &[PathBuf], position: PhysicalPosition<f64>) {
    window.state::<Offered>().offer(paths);
    let paths = paths
        .iter()
        .filter_map(|path| path.to_str().map(str::to_owned))
        .collect();
    let _ = window.emit(
        DROPPED_EVENT,
        Dropped {
            paths,
            x: position.x,
            y: position.y,
        },
    );
}

/// Shows the Open dialog for pictures and returns what was picked, now readable; empty if the dialog was cancelled.
#[tauri::command]
pub async fn pictures_choose(app: AppHandle, multiple: bool) -> Result<Vec<String>, String> {
    let dialog = app.clone();
    // The dialog waits for the person, so it waits on a thread of its own.
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let builder = dialog
            .dialog()
            .file()
            .set_title(if multiple {
                "Choose pictures"
            } else {
                "Choose a picture"
            })
            .add_filter("Pictures", EXTENSIONS);
        if multiple {
            builder.blocking_pick_files()
        } else {
            builder.blocking_pick_file().map(|path| vec![path])
        }
    })
    .await
    .map_err(|error| error.to_string())?;
    let paths: Vec<PathBuf> = picked
        .unwrap_or_default()
        .into_iter()
        .filter_map(|path| path.into_path().ok())
        .collect();
    app.state::<Offered>().offer(&paths);
    Ok(paths
        .iter()
        .filter_map(|path| path.to_str().map(str::to_owned))
        .collect())
}

/// The bytes of a file the person dropped or picked.
#[tauri::command]
pub async fn pictures_read(offered: State<'_, Offered>, path: String) -> Result<Response, String> {
    read(&offered, Path::new(&path)).map(Response::new)
}

fn read(offered: &Offered, path: &Path) -> Result<Vec<u8>, String> {
    if !offered.has(path) {
        return Err("Storiiboard reads only the pictures you drop on it or choose.".into());
    }
    let meta = fs::metadata(path).map_err(|_| "That file isn't there any more.".to_string())?;
    if !meta.is_file() {
        return Err("That's a folder, not a picture.".into());
    }
    if meta.len() > MAX_BYTES {
        return Err("That file is too large to be a picture for the board.".into());
    }
    fs::read(path).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_only_what_was_offered() {
        let dir = std::env::temp_dir().join(format!("sbd-pictures-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let (dropped, other) = (dir.join("still.jpg"), dir.join("secret.txt"));
        fs::write(&dropped, [0xff, 0xd8, 0xff, 0xd9]).unwrap();
        fs::write(&other, "private").unwrap();

        let offered = Offered::default();
        assert!(read(&offered, &dropped).is_err(), "nothing offered yet");
        offered.offer(std::slice::from_ref(&dropped));
        assert_eq!(read(&offered, &dropped).unwrap(), [0xff, 0xd8, 0xff, 0xd9]);
        assert!(read(&offered, &other).is_err());
        // The same file by another spelling of its path isn't the file that was offered.
        let name = dir.file_name().unwrap();
        assert!(read(&offered, &dir.join("..").join(name).join("still.jpg")).is_err());

        fs::remove_file(&dropped).unwrap();
        assert_eq!(
            read(&offered, &dropped).err().unwrap(),
            "That file isn't there any more."
        );
        fs::remove_dir_all(&dir).unwrap();
    }
}
