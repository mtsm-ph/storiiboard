//! The licences of what ships beside the app (2.3b): FFmpeg's LGPL and its notes, zimg's and dav1d's, and where the
//! exact sources are. The build puts them among the app's resources (tauri.conf.json); the page asks for one by its
//! name, from a fixed list, so it can never name any other file.

use std::fs;
use std::path::Path;

use tauri::{AppHandle, Manager};

/// The files, as `bundle.resources` names them.
pub const NAMES: [&str; 5] = [
    "ffmpeg-LICENSE.txt",
    "ffmpeg-LICENSE.md",
    "zimg-LICENSE.txt",
    "dav1d-LICENSE.txt",
    "ffmpeg-SOURCE.txt",
];

const MISSING: &str =
    "That licence isn't in this copy of Storiiboard. Reinstalling Storiiboard puts it back.";

/// The text of licence `name` in the folder `dir`; only a name on the list.
fn read(dir: &Path, name: &str) -> Result<String, String> {
    if !NAMES.contains(&name) {
        return Err(MISSING.into());
    }
    fs::read_to_string(dir.join(name)).map_err(|_| MISSING.to_string())
}

/// One of the licences, as text.
#[tauri::command]
pub async fn licence_text(app: AppHandle, name: String) -> Result<String, String> {
    let dir = app.path().resource_dir().map_err(|_| MISSING.to_string())?;
    tauri::async_runtime::spawn_blocking(move || read(&dir, &name))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_only_a_licence_on_the_list() {
        let dir = std::env::temp_dir().join(format!("sbd-licences-{}", crate::lock::random_id()));
        fs::create_dir_all(dir.join("inside")).unwrap();
        fs::write(dir.join("zimg-LICENSE.txt"), "zimg's licence").unwrap();
        fs::write(dir.join("other.txt"), "not a licence").unwrap();
        assert_eq!(read(&dir, "zimg-LICENSE.txt").unwrap(), "zimg's licence");
        // Off the list, a path, or a file not there: the same answer, and nothing read.
        for name in [
            "other.txt",
            "../other.txt",
            "inside/../zimg-LICENSE.txt",
            "dav1d-LICENSE.txt",
        ] {
            assert_eq!(read(&dir, name).unwrap_err(), MISSING, "{name}");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn lists_what_the_bundle_ships() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let mut shipped: Vec<&str> = config["bundle"]["resources"]
            .as_object()
            .unwrap()
            .values()
            .filter_map(|name| name.as_str())
            .collect();
        shipped.sort_unstable();
        let mut listed = NAMES.to_vec();
        listed.sort_unstable();
        assert_eq!(shipped, listed);
    }
}
