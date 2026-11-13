//! Opening outside the app (3.12; Kevin, Nov 9): a web link in the browser, and a PDF attachment in the computer's PDF
//! reader, through Tauri's opener plugin, and one thing more (below). The page is given no opener permission
//! (capabilities/default.json), so these commands are the only way to it:
//! - `open_link` takes only an http or https address;
//! - `open_pdf` takes a PDF the project holds, by its SHA-256: Rust reads its bytes from the open .sbd itself, checks
//!   they are a PDF, writes a read-only copy named `<name>.pdf` into a folder of the app's own, and opens that copy.
//!   The page never names a path, so it can't have anything else opened, an executable least of all;
//! - `original_shown` and `reveal_original` (5.9; Kevin, Nov 11) show a board picture's recorded original in its folder,
//!   selected, in Finder or Explorer: the opener's reveal only, never an open, and only when the file exists. The page
//!   names the picture's media record and its SHA-256; the path comes from that record in the open .sbd
//!   (src-tauri/src/originals.rs, with its path rules), the file is looked at by its metadata and name alone (never
//!   opened or read, so an online-only file isn't downloaded; whether macOS prompts for a protected folder is checked by
//!   hand), only a picture's name is let through, and no error here holds a path or a file name.

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

use crate::{
    originals::{self, Pointers},
    sbd::OpenFiles,
};

const NOT_A_LINK: &str = "Storiiboard opens only web links (http or https).";
const NOT_A_PDF: &str = "That attachment isn't a PDF, so Storiiboard won't open it.";
const PDF_GONE: &str = "That PDF isn't in this project any more.";
const ORIGINAL_GONE: &str = "That picture's original isn't where it was.";
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

/// The path to show for a picture's pointer: a plain file that is there now, refused or missing alike with one message
/// whatever the reason. Everything before the plugin call, so the tests can reach it.
fn original_to_show(found: Option<Pointers>) -> Result<PathBuf, String> {
    match found.map(|found| originals::existing_path(&found)) {
        Some(Ok(Some(path))) => Ok(path),
        _ => Err(ORIGINAL_GONE.to_owned()),
    }
}

/// Whether the picture's recorded original can be shown in its folder now (false for anything else, a refusal included).
/// `record_id` is the picture's own `media` record: only that one's recorded path is looked at.
#[tauri::command]
pub async fn original_shown(
    files: State<'_, OpenFiles>,
    handle: u32,
    record_id: String,
    sha256: String,
) -> Result<bool, String> {
    // Only the lookup under the lock; the disk is asked once it is let go, off the main thread.
    let Ok(found) = files.with(handle, |file| {
        originals::record_pointer(file, &record_id, &sha256)
    }) else {
        return Ok(false);
    };
    tauri::async_runtime::spawn_blocking(move || original_to_show(found).is_ok())
        .await
        .map_err(|_| COULD_NOT_OPEN.to_owned())
}

/// Shows the picture's recorded original in its folder, selected: the opener's reveal, never an open.
#[tauri::command]
pub async fn reveal_original(
    app: AppHandle,
    files: State<'_, OpenFiles>,
    handle: u32,
    record_id: String,
    sha256: String,
) -> Result<(), String> {
    let found = files
        .with(handle, |file| {
            originals::record_pointer(file, &record_id, &sha256)
        })
        .map_err(|_| ORIGINAL_GONE.to_owned())?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = original_to_show(found)?;
        app.opener()
            .reveal_item_in_dir(path)
            .map_err(|_| ORIGINAL_GONE.to_owned())
    })
    .await
    .map_err(|_| COULD_NOT_OPEN.to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sbd::{SbdFile, Statement};
    use std::ops::Deref;

    const SHA: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const JPEG: &[u8] = &[
        0xFF, 0xD8, 0xFF, 0xE0, 0, 16, b'J', b'F', b'I', b'F', 0, 1, 2, 3,
    ];

    /// A folder in the system's temp folder that goes when the test ends, a failed one too.
    struct Temp(PathBuf);
    impl Deref for Temp {
        type Target = PathBuf;
        fn deref(&self) -> &PathBuf {
            &self.0
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn temp_dir(tag: &str) -> Temp {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "sbd-show-{tag}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        Temp(dir)
    }

    /// A project in `dir` with these media records (id, props).
    fn project_with(dir: &Path, records: &[(&str, Json)]) -> SbdFile {
        let mut file = SbdFile::create(&dir.join("Bey County.sbd")).unwrap();
        let mut statements = vec![Statement {
            sql: "CREATE TABLE records (id TEXT PRIMARY KEY, type TEXT NOT NULL, props TEXT NOT NULL, trashed_at TEXT)".into(),
            params: vec![],
        }];
        for (id, props) in records {
            statements.push(Statement {
                sql: "INSERT INTO records (id, type, props) VALUES (?, 'media', ?)".into(),
                params: vec![Json::String((*id).into()), Json::String(props.to_string())],
            });
        }
        file.tx(&statements).unwrap();
        file
    }

    /// A project whose record m1 points at `stored`.
    fn project(dir: &Path, stored: &str) -> SbdFile {
        project_with(
            dir,
            &[(
                "m1",
                serde_json::json!({ "kind": "image", "file": SHA, "source_path": stored }),
            )],
        )
    }

    /// What the disk says about record m1: `Ok(None)` not there, `Err` refused.
    fn looked_at(file: &SbdFile) -> Result<Option<PathBuf>, String> {
        let found = originals::record_pointer(file, "m1", SHA).unwrap();
        originals::existing_path(&found.expect("a recorded path"))
    }

    fn shown(file: &SbdFile) -> Result<PathBuf, String> {
        original_to_show(originals::record_pointer(file, "m1", SHA).unwrap())
    }

    #[test]
    fn a_real_file_is_found_and_a_missing_one_is_not_there() {
        let dir = temp_dir("real");
        fs::create_dir_all(dir.join("refs")).unwrap();
        fs::write(dir.join("refs").join("still.jpg"), JPEG).unwrap();
        let found = shown(&project(&dir, "refs/still.jpg")).unwrap();
        assert!(found.ends_with("still.jpg"));
        let absolute = temp_dir("absolute");
        fs::write(absolute.join("still.jpg"), JPEG).unwrap();
        let elsewhere = temp_dir("absolute-project");
        let file = project(&elsewhere, absolute.join("still.jpg").to_str().unwrap());
        assert_eq!(shown(&file).unwrap(), absolute.join("still.jpg"));
        // Gone: not there (not a refusal), and shown refuses with the constant message, which names no path.
        let gone = temp_dir("gone");
        let file = project(&gone, "refs/gone.jpg");
        assert_eq!(looked_at(&file), Ok(None));
        assert_eq!(shown(&file).unwrap_err(), ORIGINAL_GONE);
    }

    #[test]
    fn a_file_over_the_reading_limit_is_still_shown() {
        let dir = temp_dir("large");
        let path = dir.join("huge.jpg");
        fs::write(&path, JPEG).unwrap();
        fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .unwrap()
            .set_len(201 * 1024 * 1024)
            .unwrap();
        assert!(shown(&project(&dir, "huge.jpg")).is_ok());
    }

    #[test]
    fn only_a_pictures_name_is_shown_whatever_the_case_and_nothing_is_read() {
        for name in ["setup.exe", "README", "still.jpg.exe"] {
            let own = temp_dir("name");
            fs::write(own.join(name), JPEG).unwrap();
            assert!(looked_at(&project(&own, name)).is_err(), "{name}");
        }
        // Not a picture inside, and shown all the same: it is only revealed, never opened.
        for name in ["STILL.JPG", "ref.HEIC", "a.tiff"] {
            let own = temp_dir("name");
            fs::write(own.join(name), b"MZ\x90\x00 not a picture at all").unwrap();
            assert!(shown(&project(&own, name)).is_ok(), "{name}");
        }
    }

    #[test]
    fn a_directory_is_refused_not_missing() {
        let dir = temp_dir("directory");
        fs::create_dir_all(dir.join("still.jpg")).unwrap();
        assert!(looked_at(&project(&dir, "still.jpg")).is_err());
    }

    #[test]
    fn a_path_climbing_out_of_the_project_is_refused_whatever_is_at_the_target() {
        let outer = temp_dir("climb");
        let inner = outer.join("inner");
        fs::create_dir_all(&inner).unwrap();
        fs::write(outer.join("secret.jpg"), JPEG).unwrap();
        assert!(looked_at(&project(&inner, "../secret.jpg")).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn an_extended_path_to_a_real_file_is_refused() {
        let dir = temp_dir("extended");
        let real = dir.join("still.jpg");
        fs::write(&real, JPEG).unwrap();
        let other = temp_dir("extended-project");
        let stored = format!(r"\\?\{}", real.display());
        assert!(looked_at(&project(&other, &stored)).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn a_junction_and_a_folder_reached_through_one_are_refused() {
        let dir = temp_dir("junction");
        let target = temp_dir("junction-target");
        fs::write(target.join("still.jpg"), JPEG).unwrap();
        let made = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(dir.join("refs"))
            .arg(&**target)
            .output()
            .unwrap();
        assert!(made.status.success(), "mklink /J didn't make the junction");
        assert!(looked_at(&project(&dir, "refs/still.jpg")).is_err());
        // Cleared first: removing the folder must not be able to follow the junction into the target.
        let _ = fs::remove_dir(dir.join("refs"));
    }

    #[cfg(unix)]
    #[test]
    fn a_link_to_a_picture_is_refused() {
        let dir = temp_dir("link");
        fs::write(dir.join("real.jpg"), JPEG).unwrap();
        std::os::unix::fs::symlink(dir.join("real.jpg"), dir.join("link.jpg")).unwrap();
        assert!(looked_at(&project(&dir, "link.jpg")).is_err());
    }

    #[test]
    fn only_the_pictures_own_record_counts() {
        let dir = temp_dir("records");
        fs::write(dir.join("a.jpg"), JPEG).unwrap();
        let file = project_with(
            &dir,
            &[
                (
                    "m1",
                    serde_json::json!({ "kind": "image", "file": SHA, "source_path": "a.jpg" }),
                ),
                // A pasted copy of the same bytes: no recorded original, and so none to show, whatever the other says.
                ("m2", serde_json::json!({ "kind": "image", "file": SHA })),
                (
                    "m3",
                    serde_json::json!({ "kind": "image", "file": SHA, "source_path": "" }),
                ),
                (
                    "m4",
                    serde_json::json!({ "kind": "video", "file": SHA, "source_path": "a.jpg" }),
                ),
                (
                    "m5",
                    serde_json::json!({ "kind": "image", "file": SHA, "source_path": "a.jpg" }),
                ),
                (
                    "m6",
                    serde_json::json!({ "kind": "image", "file": SHA, "source_path": "a.jpg" }),
                ),
            ],
        );
        // A record of another type with an image's props, and one in the Trash.
        let mut file = file;
        file.tx(&[
            Statement {
                sql: "UPDATE records SET type = 'board_item' WHERE id = 'm5'".into(),
                params: vec![],
            },
            Statement {
                sql: "UPDATE records SET trashed_at = '2026-01-01' WHERE id = 'm6'".into(),
                params: vec![],
            },
        ])
        .unwrap();
        assert!(original_to_show(originals::record_pointer(&file, "m1", SHA).unwrap()).is_ok());
        for id in ["m2", "m3", "m4", "m5", "m6", "nothing"] {
            let found = originals::record_pointer(&file, id, SHA).unwrap();
            assert_eq!(original_to_show(found).unwrap_err(), ORIGINAL_GONE, "{id}");
        }
        // The record's hash must be the one asked for.
        let other = "f".repeat(64);
        assert!(originals::record_pointer(&file, "m1", &other)
            .unwrap()
            .is_none());
    }

    #[test]
    fn a_picture_the_project_has_no_record_of_is_refused() {
        assert_eq!(original_to_show(None).unwrap_err(), ORIGINAL_GONE);
    }

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
