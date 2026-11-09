//! Opening outside the app (3.12; Kevin, Nov 9): a web link in the browser, and a PDF attachment in the computer's PDF
//! reader, through Tauri's opener plugin, and nothing else. The page is given no opener permission
//! (capabilities/default.json), so these two commands are the only way to it:
//! - `open_link` takes only an http or https address;
//! - `open_pdf` takes a PDF the project holds, by its SHA-256: Rust reads its bytes from the open .sbd itself, checks
//!   they are a PDF, writes a read-only copy named `<name>.pdf` into a folder of the app's own, and opens that copy.
//!   The page never names a path, so it can't have anything else opened, an executable least of all.

use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use reqwest::Url;
use serde_json::Value as Json;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::sbd::OpenFiles;

const NOT_A_LINK: &str = "Storiiboard opens only web links (http or https).";
const NOT_A_PDF: &str = "That attachment isn't a PDF, so Storiiboard won't open it.";
const PDF_GONE: &str = "That PDF isn't in this project any more.";
const COULD_NOT_OPEN: &str = "Storiiboard couldn't open it. Save a copy and open that instead.";

/// The longest link opened: longer is no address a person typed.
const MAX_LINK: usize = 2048;
/// Copies opened longer ago than this are tidied away as the app starts and whenever a PDF is opened.
const KEEP_OPENED: Duration = Duration::from_secs(24 * 60 * 60);
/// The folder the copies go in, inside the app's cache folder, and the start of each copy's own folder in it.
const OPENED: &str = "Opened PDFs";
const COPY_PREFIX: &str = "sbd-";

/// A web address that may be opened: http or https, with a host, and no name or password in it.
fn web_link(text: &str) -> Option<Url> {
    let text = text.trim();
    if text.len() > MAX_LINK {
        return None;
    }
    let url = Url::parse(text).ok()?;
    (matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some_and(|host| !host.is_empty())
        && url.username().is_empty()
        && url.password().is_none())
    .then_some(url)
}

/// Opens a web link in the browser.
#[tauri::command]
pub async fn open_link(app: AppHandle, url: String) -> Result<(), String> {
    let url = web_link(&url).ok_or_else(|| NOT_A_LINK.to_owned())?;
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|_| COULD_NOT_OPEN.to_owned())
}

/// Names Windows keeps for devices: a file can't be called one, whatever follows the dot.
const DEVICE_NAMES: &[&str] = &[
    "con",
    "prn",
    "aux",
    "nul",
    "conin$",
    "conout$",
    "com0",
    "com1",
    "com2",
    "com3",
    "com4",
    "com5",
    "com6",
    "com7",
    "com8",
    "com9",
    "com\u{b9}",
    "com\u{b2}",
    "com\u{b3}",
    "lpt0",
    "lpt1",
    "lpt2",
    "lpt3",
    "lpt4",
    "lpt5",
    "lpt6",
    "lpt7",
    "lpt8",
    "lpt9",
    "lpt\u{b9}",
    "lpt\u{b2}",
    "lpt\u{b3}",
];

/// The longest name before `.pdf`, in UTF-16 units (as Windows counts): well inside its path limit with the folder.
const MAX_STEM: usize = 100;

/// Characters a file name never keeps: folders, drives, streams (`:`), wildcards and quotes; control characters; and
/// the invisible ones that change how a name reads (bidi overrides such as U+202E, which can make `fdp.exe` look like
/// a PDF's name, zero-width characters, the byte-order mark).
fn unsafe_in_name(c: char) -> bool {
    c.is_control()
        || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
        || matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2069}' | '\u{FEFF}' | '\u{061C}')
}

/// The copy's file name: the attachment's name made plain (no folder, drive, control, invisible or reserved
/// character, no dot at the start), ending in exactly one `.pdf`; `attachment.pdf` when nothing usable is left.
fn copy_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if unsafe_in_name(c) { '_' } else { c })
        .collect();
    let stem = without_pdf(cleaned.trim());
    // No dot at the start (a hidden file on a Mac), however it's spaced.
    let stem = stem.trim_start_matches(|c: char| c == '.' || c.is_whitespace());
    let mut kept = String::new();
    let mut units = 0;
    for c in stem.chars() {
        units += c.len_utf16();
        if units > MAX_STEM {
            break;
        }
        kept.push(c);
    }
    // Cut short, it may end in .pdf again; and Windows drops a name's trailing dots and spaces, which would leave it
    // without its .pdf.
    let stem = without_pdf(&kept);
    let stem = stem.trim_end_matches(|c: char| c == '.' || c.is_whitespace());
    let base = stem.split('.').next().unwrap_or("").trim().to_lowercase();
    if stem.is_empty() || DEVICE_NAMES.contains(&base.as_str()) {
        return "attachment.pdf".to_owned();
    }
    format!("{stem}.pdf")
}

/// A name without any `.pdf` endings (and the spaces before them), so the copy's own is its only one.
fn without_pdf(name: &str) -> String {
    let mut stem = name.trim_end().to_owned();
    while stem.to_ascii_lowercase().ends_with(".pdf") {
        stem.truncate(stem.len() - 4);
        stem = stem.trim_end().to_owned();
    }
    stem
}

fn is_sha256(text: &str) -> bool {
    text.len() == 64 && text.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Takes away copies opened more than a day ago; only folders this module made, and only inside its own folder.
fn tidy(folder: &Path, now: SystemTime) {
    let Ok(entries) = fs::read_dir(folder) else {
        return;
    };
    for entry in entries.flatten() {
        let ours = entry.file_name().to_string_lossy().starts_with(COPY_PREFIX);
        let is_folder = entry.file_type().is_ok_and(|kind| kind.is_dir());
        let old = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .is_ok_and(|at| now.duration_since(at).unwrap_or_default() > KEEP_OPENED);
        if ours && is_folder && old {
            // The copies are read-only, which Windows won't delete: writable again first (elsewhere a folder's own
            // permission is what counts, so the copies are left as they are).
            #[cfg(windows)]
            if let Ok(inside) = fs::read_dir(entry.path()) {
                for file in inside.flatten() {
                    if let Ok(meta) = file.metadata() {
                        let mut permissions = meta.permissions();
                        #[allow(clippy::permissions_set_readonly_false)]
                        permissions.set_readonly(false);
                        let _ = fs::set_permissions(file.path(), permissions);
                    }
                }
            }
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

/// Writes the copy into a folder of its own (so two PDFs of one name never meet) and makes it read-only, since a
/// change made there would never reach the project. Returns its path.
fn write_copy(folder: &Path, name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let own = folder.join(format!(
        "{COPY_PREFIX}{stamp}-{}",
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&own).map_err(|_| COULD_NOT_OPEN.to_owned())?;
    let path = own.join(copy_name(name));
    fs::write(&path, bytes).map_err(|_| COULD_NOT_OPEN.to_owned())?;
    // Marked as from the internet, as a download would be: a PDF from someone else's project then opens in the
    // reader's protected view. Best effort; the copy opens either way.
    #[cfg(windows)]
    {
        let mut stream = path.clone().into_os_string();
        stream.push(":Zone.Identifier");
        let _ = fs::write(stream, "[ZoneTransfer]\r\nZoneId=3\r\n");
    }
    if let Ok(meta) = fs::metadata(&path) {
        let mut permissions = meta.permissions();
        permissions.set_readonly(true);
        let _ = fs::set_permissions(&path, permissions);
    }
    Ok(path)
}

/// Where the copies go: a folder of the app's own, in its cache folder.
fn opened_folder(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|_| COULD_NOT_OPEN.to_owned())?
        .join(OPENED))
}

/// Tidies the copies once as the app starts too, so one opened once doesn't stay for good.
pub(crate) fn tidy_at_start(app: &AppHandle) {
    if let Ok(folder) = opened_folder(app) {
        tidy(&folder, SystemTime::now());
    }
}

/// The copy to open, from the bytes the project holds under the hash (none when it holds none): a PDF only, written
/// into `folder`, its path checked once more, as this is the one place a file is opened.
fn pdf_copy(bytes: Option<Vec<u8>>, folder: &Path, name: &str) -> Result<PathBuf, String> {
    let bytes = bytes.ok_or_else(|| PDF_GONE.to_owned())?;
    if !bytes.starts_with(b"%PDF-") {
        return Err(NOT_A_PDF.to_owned());
    }
    tidy(folder, SystemTime::now());
    let path = write_copy(folder, name, &bytes)?;
    if !path.starts_with(folder) || path.extension().and_then(|e| e.to_str()) != Some("pdf") {
        return Err(COULD_NOT_OPEN.to_owned());
    }
    Ok(path)
}

/// Opens a PDF the open project holds, by its SHA-256, in the computer's PDF reader, as a read-only copy.
#[tauri::command]
pub async fn open_pdf(
    app: AppHandle,
    files: State<'_, OpenFiles>,
    handle: u32,
    sha256: String,
    name: String,
) -> Result<(), String> {
    if !is_sha256(&sha256) {
        return Err(PDF_GONE.to_owned());
    }
    let bytes = files.with(handle, |file| {
        file.read_blob(
            "SELECT bytes FROM media_files WHERE sha256 = ?",
            &[Json::String(sha256.to_ascii_lowercase())],
        )
    })?;
    let path = pdf_copy(bytes, &opened_folder(&app)?, &name)?;
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|_| COULD_NOT_OPEN.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_only_web_links() {
        assert!(web_link("https://vimeo.com/1").is_some());
        assert!(web_link(" http://example.com/a b ").is_some());
        for refused in [
            "file:///C:/Windows/System32/calc.exe",
            "C:\\Windows\\System32\\calc.exe",
            "javascript:alert(1)",
            "mailto:a@b.c",
            "ftp://example.com/x",
            "https://user:pass@example.com/",
            "smb://server/share",
            "ms-settings:privacy",
            "https://",
            "",
        ] {
            assert!(web_link(refused).is_none(), "{refused}");
        }
        assert!(web_link(&format!("https://x.com/{}", "a".repeat(MAX_LINK))).is_none());
    }

    #[test]
    fn a_copy_is_always_a_plain_pdf_name() {
        assert_eq!(copy_name("Contract.pdf"), "Contract.pdf");
        assert_eq!(copy_name("Release"), "Release.pdf");
        assert_eq!(copy_name("x.PDF.pdf"), "x.pdf");
        assert_eq!(copy_name("tool.exe"), "tool.exe.pdf");
        assert_eq!(copy_name("..\\..\\evil.exe"), "_.._evil.exe.pdf");
        assert_eq!(copy_name("a/b:c*?.pdf"), "a_b_c__.pdf");
        assert_eq!(copy_name(".hidden"), "hidden.pdf");
        assert_eq!(copy_name("CON"), "attachment.pdf");
        assert_eq!(copy_name("nul.txt"), "attachment.pdf");
        assert_eq!(copy_name("Notes. "), "Notes.pdf");
        assert_eq!(copy_name("   "), "attachment.pdf");
        assert_eq!(copy_name(".pdf"), "attachment.pdf");
        assert!(copy_name(&"a".repeat(500)).len() <= MAX_STEM + 4);
        // Review lows: a dot after a space, bidi overrides, the other device names, and length in UTF-16 units.
        assert_eq!(copy_name(". .x"), "x.pdf");
        assert_eq!(copy_name("Invoice\u{202E}fdp.exe"), "Invoice_fdp.exe.pdf");
        assert_eq!(copy_name("a\u{200B}b"), "a_b.pdf");
        assert_eq!(copy_name("COM\u{b9}"), "attachment.pdf");
        assert_eq!(copy_name("conout$.txt"), "attachment.pdf");
        let cut = copy_name(&format!("{}x.pdf and more", "a".repeat(95)));
        assert!(
            cut.ends_with("x.pdf") && !cut.ends_with(".pdf.pdf"),
            "{cut}"
        );
        let wide = copy_name(&"\u{1F3AC}".repeat(100));
        assert!(wide.encode_utf16().count() <= MAX_STEM + 4);
    }

    #[test]
    fn opens_only_a_pdf_the_project_holds() {
        let root = std::env::temp_dir().join(format!("sbd-open-pdf-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        assert_eq!(pdf_copy(None, &root, "x"), Err(PDF_GONE.to_owned()));
        assert_eq!(
            pdf_copy(Some(b"MZ\x90\x00 an executable".to_vec()), &root, "x.pdf"),
            Err(NOT_A_PDF.to_owned())
        );
        let made = pdf_copy(Some(b"%PDF-1.7".to_vec()), &root, "tool.exe").expect("copy");
        assert!(made.starts_with(&root) && made.ends_with("tool.exe.pdf"));
        // Marked as from the internet, so the reader opens it in its protected view.
        #[cfg(windows)]
        {
            let mut stream = made.clone().into_os_string();
            stream.push(":Zone.Identifier");
            assert!(fs::read_to_string(stream)
                .expect("mark")
                .contains("ZoneId=3"));
        }
        if let Ok(meta) = fs::metadata(&made) {
            let mut permissions = meta.permissions();
            #[allow(clippy::permissions_set_readonly_false)]
            permissions.set_readonly(false);
            let _ = fs::set_permissions(&made, permissions);
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_page_has_no_opener_permission() {
        // The page may never call the opener plugin itself. Every permission the page holds is on this list, so a new
        // grant of any kind (the opener's, or a set of our own that holds it) fails here until it's looked at.
        const GRANTED: &[&str] = &[
            "core:default",
            "dialog:allow-open",
            "dialog:allow-save",
            "core:window:allow-set-background-color",
            "core:webview:allow-set-webview-background-color",
        ];
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));
        let mut read = 0;
        for entry in fs::read_dir(root.join("capabilities"))
            .expect("capabilities")
            .flatten()
        {
            let text = fs::read_to_string(entry.path()).expect("capability");
            let capability: Json = serde_json::from_str(&text).expect("JSON");
            for permission in capability["permissions"].as_array().expect("permissions") {
                let name = permission
                    .as_str()
                    .or_else(|| permission["identifier"].as_str())
                    .unwrap_or_default();
                assert!(
                    GRANTED.contains(&name),
                    "{} grants {name}",
                    entry.path().display()
                );
            }
            read += 1;
        }
        assert!(read > 0);
        // No capability given anywhere else: in the config, a platform's config, or a permission set of our own.
        for entry in fs::read_dir(root).expect("crate").flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with("tauri.") && name.ends_with(".json") {
                let text = fs::read_to_string(entry.path()).expect("config");
                assert!(
                    !text.contains("opener:") && !text.contains("\"capabilities\""),
                    "{name}"
                );
            }
        }
        assert!(!root.join("permissions").exists());
    }

    #[test]
    fn writes_a_read_only_copy_in_a_folder_of_its_own_and_tidies_only_old_ones_of_its_own() {
        let root = std::env::temp_dir().join(format!("sbd-open-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("folder");
        let first = write_copy(&root, "Release", b"%PDF-1.7").expect("copy");
        let second = write_copy(&root, "Release", b"%PDF-1.7").expect("copy");
        assert_ne!(first, second);
        assert!(first.starts_with(&root) && first.ends_with("Release.pdf"));
        assert!(fs::metadata(&first).expect("meta").permissions().readonly());
        // Someone else's folder in there is never touched.
        fs::create_dir_all(root.join("keep")).expect("folder");
        tidy(&root, SystemTime::now() + KEEP_OPENED * 2);
        assert!(!first.exists() && !second.exists());
        assert!(root.join("keep").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_pdf_is_named_by_its_hash() {
        assert!(is_sha256(&"a".repeat(64)));
        assert!(!is_sha256("../../etc"));
        assert!(!is_sha256(&"g".repeat(64)));
    }
}
