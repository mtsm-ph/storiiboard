//! .sbd files the OS asks Storiiboard to open: a double-click in Finder or Explorer, Open With, or a file dropped on
//! the Dock icon. They arrive three ways: as launch arguments (Windows), as an Apple Event (macOS), or from a second
//! launch that hands its arguments to the running app and exits (the single-instance plugin, so a double-click on
//! Windows never starts a second copy). All three go into one queue, which the window drains.
//!
//! The window may not be listening yet when a file arrives (a double-click that launches the app), so the event
//! only says "there's something to take"; the page takes the queue when it loads and on every event.

use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use tauri::{AppHandle, Emitter, Manager, State};

/// The event the page listens for. Its payload is empty: the paths come from `opened_files_take`.
pub const EVENT: &str = "opened-files";

#[derive(Default)]
pub struct OpenedFiles(Mutex<Vec<String>>);

/// The .sbd paths in a list of launch arguments, made absolute against the directory the launch came from.
/// Flags and other files are skipped, and so is a path that isn't valid Unicode, rather than opening a mangled one.
pub fn sbd_paths<I, S>(args: I, cwd: &Path) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter()
        .filter_map(|arg| {
            let arg = arg.as_ref();
            if arg.starts_with('-') {
                return None;
            }
            let path = Path::new(arg);
            let is_sbd = path
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("sbd"));
            if !is_sbd {
                return None;
            }
            let absolute: PathBuf = if path.is_absolute() {
                path.to_path_buf()
            } else {
                cwd.join(path)
            };
            absolute.to_str().map(str::to_owned)
        })
        .collect()
}

/// Queues paths for the window, tells it, and brings it to the front: the person just asked for this project.
pub fn queue(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    if let Ok(mut pending) = app.state::<OpenedFiles>().0.lock() {
        for path in paths {
            if !pending.contains(&path) {
                pending.push(path);
            }
        }
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = app.emit(EVENT, ());
}

/// Everything queued since the last call, oldest first. The page opens the last one: one window, one project.
#[tauri::command]
pub fn opened_files_take(state: State<'_, OpenedFiles>) -> Vec<String> {
    state
        .0
        .lock()
        .map(|mut pending| std::mem::take(&mut *pending))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_sbd_files_and_makes_them_absolute() {
        let cwd = if cfg!(windows) {
            PathBuf::from(r"C:\Users\kevin\Films")
        } else {
            PathBuf::from("/Users/kevin/Films")
        };
        let absolute = if cfg!(windows) {
            r"D:\Jobs\Bey County.SBD"
        } else {
            "/Volumes/Jobs/Bey County.SBD"
        };
        let paths = sbd_paths(
            [
                "Pilot.sbd",
                "--flag",
                "-psn_0_12345",
                "notes.txt",
                absolute,
                "Pilot.sbd.bak-v1-2026-11-02 14-05",
            ],
            &cwd,
        );
        assert_eq!(
            paths,
            vec![
                cwd.join("Pilot.sbd").to_str().unwrap().to_owned(),
                absolute.to_owned()
            ]
        );
    }

    #[test]
    fn finds_nothing_in_a_plain_launch() {
        assert!(sbd_paths(Vec::<String>::new(), Path::new("/")).is_empty());
    }
}
