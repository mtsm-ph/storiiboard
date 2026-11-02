//! Small JSON files that belong to the person, not to a project, such as the list of recent projects. They live in
//! the app's data folder and never go into a .sbd.

use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

/// The only files the UI may read or write here, so a bug can't reach anything else in the folder.
const FILES: &[&str] = &["recent.json"];

fn checked(dir: &Path, name: &str) -> Result<PathBuf, String> {
    if FILES.contains(&name) {
        Ok(dir.join(name))
    } else {
        Err(format!("\"{name}\" isn't an app data file."))
    }
}

pub fn read(dir: &Path, name: &str) -> Result<Option<String>, String> {
    match fs::read_to_string(checked(dir, name)?) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

/// Writes a temporary file and renames it over the old one, so a crash mid-write leaves the old list intact.
pub fn write(dir: &Path, name: &str, contents: &str) -> Result<(), String> {
    let path = checked(dir, name)?;
    fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    let temp = dir.join(format!("{name}.tmp"));
    fs::write(&temp, contents).map_err(|error| error.to_string())?;
    fs::rename(&temp, &path).map_err(|error| error.to_string())
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn app_data_read(app: AppHandle, name: String) -> Result<Option<String>, String> {
    read(&data_dir(&app)?, &name)
}

#[tauri::command]
pub async fn app_data_write(app: AppHandle, name: String, contents: String) -> Result<(), String> {
    write(&data_dir(&app)?, &name, &contents)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("app-data-{}-{nanos}", std::process::id()))
    }

    #[test]
    fn reads_nothing_before_the_first_write_then_what_was_written() {
        let dir = temp_dir();
        assert_eq!(read(&dir, "recent.json").unwrap(), None);
        write(&dir, "recent.json", "[1]").unwrap();
        write(&dir, "recent.json", "[2]").unwrap();
        assert_eq!(read(&dir, "recent.json").unwrap().as_deref(), Some("[2]"));
        assert!(!dir.join("recent.json.tmp").exists());
    }

    #[test]
    fn refuses_any_other_file() {
        let dir = temp_dir();
        assert!(write(&dir, "../recent.json", "[]").is_err());
        assert!(read(&dir, "settings.json").is_err());
    }
}
