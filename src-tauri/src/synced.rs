//! Is a project in a folder a sync service manages: iCloud Drive, Dropbox, Google Drive, OneDrive, Box? A .sbd works
//! there, but it should be open on one computer at a time (docs/PLAN.md, F · Synced folders), so the app says so
//! once, and New project starts in a local folder when Documents itself is synced.
//!
//! Nothing here goes on the network: each service marks its folders on disk, and this reads the marks.
//! - macOS: every File Provider service (iCloud Drive, including a synced Desktop and Documents, and current Dropbox,
//!   Google Drive, OneDrive and Box) tags its folders with a `com.apple.file-provider-domain-id` attribute. Older
//!   installs are recognised by where they keep their folders.
//! - Windows: cloud files carry placeholder attributes; OneDrive, Dropbox, iCloud and Google Drive are also matched
//!   by their known folders.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

/// The service's name, from the File Provider domain id macOS stores on its folders.
pub fn service_from_domain(domain: &str) -> &'static str {
    let domain = domain.to_ascii_lowercase();
    if domain.contains("clouddocs") || domain.contains("icloud") {
        "iCloud Drive"
    } else if domain.contains("dropbox") {
        "Dropbox"
    } else if domain.contains("google") {
        "Google Drive"
    } else if domain.contains("onedrive") || domain.contains("microsoft") {
        "OneDrive"
    } else if domain.contains("box") {
        "Box"
    } else {
        "a sync service"
    }
}

/// The service from a folder's place on disk, for installs that don't mark their folders. `home` is the user's home
/// folder.
pub fn service_from_location(path: &Path, home: &Path) -> Option<&'static str> {
    let library = home.join("Library");
    if path.starts_with(library.join("Mobile Documents")) {
        return Some("iCloud Drive");
    }
    if let Ok(rest) = path.strip_prefix(library.join("CloudStorage")) {
        // ~/Library/CloudStorage/<Service>-<account>/…
        let folder = rest.components().next()?.as_os_str().to_str()?;
        return Some(service_from_domain(folder));
    }
    for (folder, service) in [
        ("Dropbox", "Dropbox"),
        ("iCloudDrive", "iCloud Drive"),
        ("Google Drive", "Google Drive"),
        ("My Drive", "Google Drive"),
        ("OneDrive", "OneDrive"),
    ] {
        if path.starts_with(home.join(folder)) {
            return Some(service);
        }
    }
    None
}

/// The folder itself, or for a file that doesn't exist yet (a project about to be created), the nearest folder up the
/// path that does, with links resolved.
fn existing(path: &Path) -> Option<PathBuf> {
    path.ancestors().find_map(|p| p.canonicalize().ok())
}

#[cfg(target_os = "macos")]
fn marked_service(path: &Path) -> Option<&'static str> {
    domain_mark(path, c"com.apple.file-provider-domain-id")
        .map(|domain| service_from_domain(&domain))
}

/// The first value of `attribute` on `path` or a folder above it. macOS lets only the system set the File Provider
/// attribute, so the tests read a stand-in name through this same code.
#[cfg(target_os = "macos")]
fn domain_mark(path: &Path, attribute: &std::ffi::CStr) -> Option<String> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    for folder in path.ancestors() {
        let Ok(c_path) = CString::new(folder.as_os_str().as_bytes()) else {
            continue;
        };
        let mut value = [0u8; 512];
        // SAFETY: both strings are NUL-terminated and the buffer is as long as the length passed with it.
        let read = unsafe {
            libc::getxattr(
                c_path.as_ptr(),
                attribute.as_ptr(),
                value.as_mut_ptr().cast(),
                value.len(),
                0,
                0,
            )
        };
        if read > 0 {
            return Some(String::from_utf8_lossy(&value[..read as usize]).into_owned());
        }
    }
    None
}

#[cfg(windows)]
fn marked_service(path: &Path) -> Option<&'static str> {
    use std::os::windows::fs::MetadataExt;
    // Set by the Windows cloud files API on what OneDrive, Google Drive, Dropbox and iCloud keep in sync.
    const CLOUD: u32 = 0x0004_0000 | 0x0008_0000 | 0x0010_0000 | 0x0040_0000;
    let marked = path
        .ancestors()
        .filter_map(|folder| std::fs::metadata(folder).ok())
        .any(|meta| meta.file_attributes() & CLOUD != 0);
    if !marked {
        return None;
    }
    let text = path.to_string_lossy().to_ascii_lowercase();
    Some(if text.contains("onedrive") {
        "OneDrive"
    } else if text.contains("dropbox") {
        "Dropbox"
    } else if text.contains("icloud") {
        "iCloud Drive"
    } else if text.contains("my drive") || text.contains("google") {
        "Google Drive"
    } else {
        "a sync service"
    })
}

#[cfg(not(any(target_os = "macos", windows)))]
fn marked_service(_path: &Path) -> Option<&'static str> {
    None
}

#[cfg(windows)]
fn known_folders() -> Vec<(PathBuf, &'static str)> {
    let mut folders = Vec::new();
    for key in ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"] {
        if let Some(path) = std::env::var_os(key) {
            folders.push((PathBuf::from(path), "OneDrive"));
        }
    }
    // Dropbox lists its folders, personal and business, in info.json.
    for base in ["APPDATA", "LOCALAPPDATA"] {
        let Some(base) = std::env::var_os(base) else {
            continue;
        };
        let Ok(text) =
            std::fs::read_to_string(PathBuf::from(base).join("Dropbox").join("info.json"))
        else {
            continue;
        };
        if let Ok(serde_json::Value::Object(accounts)) = serde_json::from_str(&text) {
            for account in accounts.values() {
                if let Some(path) = account.get("path").and_then(|p| p.as_str()) {
                    folders.push((PathBuf::from(path), "Dropbox"));
                }
            }
        }
    }
    folders
}

#[cfg(not(windows))]
fn known_folders() -> Vec<(PathBuf, &'static str)> {
    Vec::new()
}

/// The sync service that manages `path`, or None for a folder only on this computer.
pub fn service(path: &Path, home: &Path) -> Option<&'static str> {
    let path = existing(path)?;
    let home = home.canonicalize().unwrap_or_else(|_| home.to_path_buf());
    marked_service(&path)
        .or_else(|| service_from_location(&path, &home))
        .or_else(|| {
            known_folders()
                .into_iter()
                .find(|(folder, _)| path.starts_with(folder))
                .map(|(_, service)| service)
        })
}

/// Where New project starts: Documents, unless a sync service manages it (iCloud's Desktop and Documents, OneDrive's
/// folder backup). Then a Storiiboard folder in Movies (Videos on Windows), which neither syncs by default, or the
/// home folder if that's synced too.
pub fn projects_folder(documents: &Path, videos: &Path, home: &Path) -> PathBuf {
    if service(documents, home).is_none() {
        return documents.to_path_buf();
    }
    let local = videos.join("Storiiboard");
    if service(videos, home).is_none() {
        let _ = std::fs::create_dir_all(&local);
        return local;
    }
    home.to_path_buf()
}

fn home(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().home_dir().map_err(|error| error.to_string())
}

/// The sync service a project or folder is in, for the one-time note; null when it's only on this computer.
#[tauri::command]
pub async fn sync_service(app: AppHandle, path: String) -> Result<Option<String>, String> {
    Ok(service(Path::new(&path), &home(&app)?).map(str::to_owned))
}

/// The folder New project's Save dialog starts in.
#[tauri::command]
pub async fn projects_folder_for_new(app: AppHandle) -> Result<String, String> {
    let paths = app.path();
    let home = home(&app)?;
    let documents = paths
        .document_dir()
        .unwrap_or_else(|_| home.join("Documents"));
    let videos = paths.video_dir().unwrap_or_else(|_| home.join("Movies"));
    projects_folder(&documents, &videos, &home)
        .to_str()
        .map(str::to_owned)
        .ok_or_else(|| "The projects folder's path isn't valid text.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_the_service_from_its_file_provider_domain() {
        assert_eq!(
            service_from_domain("com.apple.CloudDocs.iCloudDriveFileProvider/86177519"),
            "iCloud Drive"
        );
        assert_eq!(
            service_from_domain("com.google.drivefs.fpext/gdrive-1058"),
            "Google Drive"
        );
        assert_eq!(
            service_from_domain("com.getdropbox.dropbox.fileprovider/a"),
            "Dropbox"
        );
        assert_eq!(
            service_from_domain("com.microsoft.OneDrive.FileProvider/b"),
            "OneDrive"
        );
        assert_eq!(service_from_domain("com.example.sync/c"), "a sync service");
    }

    #[test]
    fn knows_the_services_by_their_folders() {
        let home = Path::new("/Users/kevin");
        let at = |p: &str| service_from_location(Path::new(p), home);
        assert_eq!(
            at("/Users/kevin/Library/Mobile Documents/com~apple~CloudDocs/Films"),
            Some("iCloud Drive")
        );
        assert_eq!(
            at("/Users/kevin/Library/CloudStorage/GoogleDrive-someone/My Drive/Jobs"),
            Some("Google Drive")
        );
        assert_eq!(
            at("/Users/kevin/Library/CloudStorage/Dropbox/Jobs"),
            Some("Dropbox")
        );
        assert_eq!(
            at("/Users/kevin/Dropbox/Jobs/Bey County.sbd"),
            Some("Dropbox")
        );
        assert_eq!(at("/Users/kevin/Movies/Storiiboard"), None);
        assert_eq!(at("/Volumes/Shoot Drive/Bey County.sbd"), None);
    }

    #[test]
    fn a_plain_local_folder_is_not_synced() {
        let dir = std::env::temp_dir().join(format!("sbd-local-{}", crate::lock::random_id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(
            service(&dir.join("Not Yet.sbd"), Path::new("/nowhere")),
            None
        );
        let documents = dir.join("Documents");
        std::fs::create_dir_all(&documents).unwrap();
        assert_eq!(
            projects_folder(&documents, &dir.join("Movies"), &dir),
            documents
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn reads_a_folder_mark_from_the_nearest_folder_that_has_one() {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        let dir = std::env::temp_dir().join(format!("sbd-marked-{}", crate::lock::random_id()));
        let project_folder = dir.join("Jobs").join("Bey County");
        std::fs::create_dir_all(&project_folder).unwrap();
        let attribute = c"org.storiiboard.test-domain";
        let path = CString::new(dir.canonicalize().unwrap().as_os_str().as_bytes()).unwrap();
        let value = b"com.google.drivefs.fpext/gdrive-1";
        // SAFETY: NUL-terminated strings and a buffer passed with its length.
        let set = unsafe {
            libc::setxattr(
                path.as_ptr(),
                attribute.as_ptr(),
                value.as_ptr().cast(),
                value.len(),
                0,
                0,
            )
        };
        assert_eq!(set, 0);
        // A project two folders down, not created yet, is still under the marked folder.
        let found = domain_mark(
            &existing(&project_folder.join("Bey County.sbd")).unwrap(),
            attribute,
        );
        assert_eq!(
            found.as_deref().map(service_from_domain),
            Some("Google Drive")
        );
        assert_eq!(domain_mark(Path::new("/"), attribute), None);
    }

    #[test]
    fn starts_new_projects_locally_when_documents_is_synced() {
        let home = std::env::temp_dir().join(format!("sbd-home-{}", crate::lock::random_id()));
        let documents = home.join("Dropbox");
        std::fs::create_dir_all(&documents).unwrap();
        let movies = home.join("Movies");
        std::fs::create_dir_all(&movies).unwrap();
        let home = home.canonicalize().unwrap();
        let chosen = projects_folder(&home.join("Dropbox"), &home.join("Movies"), &home);
        assert_eq!(chosen, home.join("Movies").join("Storiiboard"));
        assert!(chosen.is_dir());
    }
}
