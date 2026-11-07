//! Pictures from files on disk, for frames (1.11), and scripts to import (1.17). The page never names a file for Rust
//! to read on its own: it can read only files the person dropped on the window or picked in an Open dialog shown from
//! here, so a bug or a script slipped into the page can't read anything else on the computer.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{ipc::Response, AppHandle, DragDropEvent, Emitter, Manager, PhysicalPosition, Window};
use tauri_plugin_dialog::DialogExt;

/// The largest file read as a picture. A 48 MP ProRAW photo is about 75 MB; a file far past that isn't for a board.
const MAX_BYTES: u64 = 200 * 1024 * 1024;

/// What the Open dialog offers. The webview decides what it can read (HEIC only on a Mac); the rest gets a message.
const EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "heic", "heif", "tif", "tiff", "gif", "bmp",
];
/// What the Open dialog offers for a script: Fountain (and its older .spmd and plain .txt), Final Draft and PDF.
const SCRIPT_EXTENSIONS: &[&str] = &["fountain", "spmd", "txt", "fdx", "pdf"];
/// The largest text script read: a feature script is well under 1 MB, and the page parses all of it at once.
const MAX_SCRIPT_BYTES: u64 = 10 * 1024 * 1024;
/// A script PDF may carry pictures (a title page, storyboards), so it may be larger.
const MAX_SCRIPT_PDF_BYTES: u64 = 50 * 1024 * 1024;

/// What the Open dialog offers for a LUT (2.5): Resolve's `.cube`, which cameras and colourists ship.
const LUT_EXTENSIONS: &[&str] = &["cube"];
/// The largest LUT read: a 65-point cube, the largest in common use, is about 8 MB of text.
const MAX_LUT_BYTES: u64 = 16 * 1024 * 1024;

/// What the Open dialog offers for project data to import (2.9): the JSON a project exports.
const PROJECT_JSON_EXTENSIONS: &[&str] = &["json"];
/// The largest project JSON read, the page's own limit (src/core/storage/projectJson.ts, MAX_IMPORT_CHARS): it
/// parses it in one piece, and a webview's longest string is about 512 million characters.
const MAX_PROJECT_JSON_BYTES: u64 = 400_000_000;

/// How large a file may be read, by what it is.
fn max_bytes(path: &Path) -> u64 {
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    match extension.as_deref() {
        Some("pdf") => MAX_SCRIPT_PDF_BYTES,
        Some(e) if SCRIPT_EXTENSIONS.contains(&e) => MAX_SCRIPT_BYTES,
        Some(e) if LUT_EXTENSIONS.contains(&e) => MAX_LUT_BYTES,
        Some(e) if PROJECT_JSON_EXTENSIONS.contains(&e) => MAX_PROJECT_JSON_BYTES,
        _ => MAX_BYTES,
    }
}

/// The files the person has handed the app this session, by drop or by the Open dialog, and whether the dialog is
/// open now.
#[derive(Default)]
pub struct Offered {
    paths: Mutex<HashSet<PathBuf>>,
    choosing: AtomicBool,
}

impl Offered {
    /// Makes the paths readable and returns them as text. A path that isn't valid text (rare, but possible on
    /// Windows) can't reach the page, so it isn't offered either.
    pub(crate) fn offer(&self, paths: &[PathBuf]) -> Vec<String> {
        let usable: Vec<(PathBuf, String)> = paths
            .iter()
            .filter_map(|path| Some((path.clone(), path.to_str()?.to_owned())))
            .collect();
        if let Ok(mut offered) = self.paths.lock() {
            offered.extend(usable.iter().map(|(path, _)| path.clone()));
        }
        usable.into_iter().map(|(_, text)| text).collect()
    }

    pub(crate) fn has(&self, path: &Path) -> bool {
        self.paths
            .lock()
            .is_ok_and(|offered| offered.contains(path))
    }
}

/// A point in the page, in CSS pixels.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct PagePoint {
    x: f64,
    y: f64,
}

/// Whether drag positions come in points rather than device pixels. Tauri labels them physical, but on a Mac wry
/// reports AppKit's window points, which are CSS pixels already; WebView2 on Windows reports device pixels.
const DRAG_IN_POINTS: bool = cfg!(target_os = "macos");

fn page_point(position: PhysicalPosition<f64>, scale: f64, in_points: bool) -> PagePoint {
    if in_points || scale <= 0.0 {
        PagePoint {
            x: position.x,
            y: position.y,
        }
    } else {
        PagePoint {
            x: position.x / scale,
            y: position.y / scale,
        }
    }
}

/// Where files were dropped, for the page to find the frame under them.
#[derive(Clone, Serialize)]
struct Dropped {
    paths: Vec<String>,
    at: PagePoint,
}

pub const DROPPED_EVENT: &str = "storiiboard://pictures-dropped";
/// Where a drag of files is over the page now, or null once it has left.
pub const DRAGGED_EVENT: &str = "storiiboard://pictures-dragged";

/// Called for every drag of files over the window (lib.rs). A drop's files become readable first, and only then does
/// the page hear of them, so it never asks for one it can't have yet.
pub fn dragged(window: &Window, event: &DragDropEvent) {
    let scale = window.scale_factor().unwrap_or(1.0);
    match event {
        DragDropEvent::Enter { position, .. } | DragDropEvent::Over { position } => {
            let _ = window.emit(
                DRAGGED_EVENT,
                Some(page_point(*position, scale, DRAG_IN_POINTS)),
            );
        }
        DragDropEvent::Drop { paths, position } => {
            let _ = window.emit(DRAGGED_EVENT, None::<PagePoint>);
            let paths = window.state::<Offered>().offer(paths);
            let at = page_point(*position, scale, DRAG_IN_POINTS);
            let _ = window.emit(DROPPED_EVENT, Dropped { paths, at });
        }
        _ => {
            let _ = window.emit(DRAGGED_EVENT, None::<PagePoint>);
        }
    }
}

/// Shows the Open dialog for pictures and returns what was picked, now readable; empty if the dialog was cancelled.
/// The title and the filter's name come from the app, in the person's language (polish 7).
#[tauri::command]
pub async fn pictures_choose(
    app: AppHandle,
    multiple: bool,
    title: String,
    kind: String,
) -> Result<Vec<String>, String> {
    choose(app, title, (kind, EXTENSIONS), multiple).await
}

/// The Open dialog for a script to import; the file picked becomes readable through `pictures_read`.
#[tauri::command]
pub async fn script_choose(
    app: AppHandle,
    title: String,
    kind: String,
) -> Result<Vec<String>, String> {
    choose(app, title, (kind, SCRIPT_EXTENSIONS), false).await
}

/// The Open dialog for a LUT to load for a video (2.5); the file picked becomes readable through `pictures_read`.
#[tauri::command]
pub async fn lut_choose(
    app: AppHandle,
    title: String,
    kind: String,
) -> Result<Vec<String>, String> {
    choose(app, title, (kind, LUT_EXTENSIONS), false).await
}

/// The Open dialog for project data to import (2.9); the file picked becomes readable through `pictures_read`.
#[tauri::command]
pub async fn project_json_choose(
    app: AppHandle,
    title: String,
    kind: String,
) -> Result<Vec<String>, String> {
    choose(app, title, (kind, PROJECT_JSON_EXTENSIONS), false).await
}

pub(crate) async fn choose(
    app: AppHandle,
    title: String,
    (kind, extensions): (String, &'static [&'static str]),
    multiple: bool,
) -> Result<Vec<String>, String> {
    // One dialog at a time: a second press while it's open does nothing.
    if app.state::<Offered>().choosing.swap(true, Ordering::SeqCst) {
        return Ok(Vec::new());
    }
    let dialog = app.clone();
    // The dialog waits for the person, so it waits on a thread of its own.
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut builder = dialog
            .dialog()
            .file()
            .set_title(title)
            .add_filter(kind, extensions);
        // Attached to the window, so it's a sheet on a Mac and modal on Windows.
        if let Some(window) = dialog.get_webview_window("main") {
            builder = builder.set_parent(&window);
        }
        if multiple {
            builder.blocking_pick_files()
        } else {
            builder.blocking_pick_file().map(|path| vec![path])
        }
    })
    .await;
    app.state::<Offered>()
        .choosing
        .store(false, Ordering::SeqCst);
    let paths: Vec<PathBuf> = picked
        .map_err(|error| error.to_string())?
        .unwrap_or_default()
        .into_iter()
        .filter_map(|path| path.into_path().ok())
        .collect();
    Ok(app.state::<Offered>().offer(&paths))
}

/// The bytes of a file the person dropped or picked: a picture, or a script to import.
#[tauri::command]
pub async fn pictures_read(app: AppHandle, path: String) -> Result<Response, String> {
    // Off the async runtime: a 200 MB file takes a moment to read.
    tauri::async_runtime::spawn_blocking(move || {
        read(&app.state::<Offered>(), Path::new(&path)).map(Response::new)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn read(offered: &Offered, path: &Path) -> Result<Vec<u8>, String> {
    if !offered.has(path) {
        return Err("Storiiboard reads only the files you drop on it or choose.".into());
    }
    let meta = fs::metadata(path).map_err(|_| "That file isn't there any more.".to_string())?;
    if !meta.is_file() {
        return Err("That's a folder, not a file.".into());
    }
    if meta.len() > max_bytes(path) {
        return Err("That file is too large to open.".into());
    }
    fs::read(path).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caps_a_script_well_below_a_picture() {
        assert_eq!(
            max_bytes(Path::new("/Films/Bey County.fountain")),
            MAX_SCRIPT_BYTES
        );
        assert_eq!(
            max_bytes(Path::new("/Films/Bey County.FDX")),
            MAX_SCRIPT_BYTES
        );
        assert_eq!(
            max_bytes(Path::new("/Films/Bey County.pdf")),
            MAX_SCRIPT_PDF_BYTES
        );
        // Project data (2.9) may hold every picture of a feature, so it's allowed far more than a script.
        assert_eq!(
            max_bytes(Path::new("/Films/Bey County project data.JSON")),
            MAX_PROJECT_JSON_BYTES
        );
        // A LUT: a 65-point cube is about 8 MB of text.
        assert_eq!(
            max_bytes(Path::new("/Luts/SLog3SGamut3.CineToLC-709.CUBE")),
            MAX_LUT_BYTES
        );
        assert_eq!(max_bytes(Path::new("/Films/still.jpg")), MAX_BYTES);
        assert_eq!(max_bytes(Path::new("/Films/no-extension")), MAX_BYTES);
    }

    #[test]
    fn reads_only_what_was_offered() {
        let dir = std::env::temp_dir().join(format!("sbd-pictures-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let (dropped, other) = (dir.join("still.jpg"), dir.join("secret.txt"));
        fs::write(&dropped, [0xff, 0xd8, 0xff, 0xd9]).unwrap();
        fs::write(&other, "private").unwrap();

        let offered = Offered::default();
        assert!(read(&offered, &dropped).is_err(), "nothing offered yet");
        assert_eq!(
            offered.offer(std::slice::from_ref(&dropped)),
            [dropped.to_str().unwrap()]
        );
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

    #[test]
    fn turns_a_drag_position_into_css_pixels() {
        let at = PhysicalPosition::new(600.0, 300.0);
        // A Mac reports points, the page's own pixels, even on a Retina screen.
        assert_eq!(page_point(at, 2.0, true), PagePoint { x: 600.0, y: 300.0 });
        // Windows reports device pixels: at 150% scaling, 600 of them are 400 in the page.
        assert_eq!(page_point(at, 1.5, false), PagePoint { x: 400.0, y: 200.0 });
        assert_eq!(page_point(at, 0.0, false), PagePoint { x: 600.0, y: 300.0 });
    }
}
