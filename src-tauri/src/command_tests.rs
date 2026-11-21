//! The commands as the page calls them (6.16): by their registered name, with the arguments as JSON in the shape the
//! page sends (src/core/storage/tauriDriver.ts and the other `invoke` calls in src), through the app's permissions,
//! and the answer read back as JSON in the shape the page reads. The app is built on Tauri's mock runtime with the
//! real app's commands, plugins and state (lib.rs's `with_commands` and `manage_at_start`) and the real config, so
//! the capability files are checked as in the app. Each inner function has its own unit tests; this is the join.
//!
//! Left out, each for its reason: the dialogs (`*_choose`, `playback_move`, a new tile server's question) can't be
//! answered here; anything that goes to the network (weather, hospitals, an address search that gets as far as the
//! service, a tile not in the cache) would contact a real service; ffmpeg's commands (`video_probe`, `video_still`,
//! `playback_make`, `playback_find`, `clip_save`; `heic_picture`, which needs only a photo's bytes and the app's
//! cache folder, is the one tested here) and the opener's (`open_link`, `open_pdf`, `reveal_original`,
//! `sbd_show_backups`) start another program; `projects_folder_for_new` can make a folder in this computer's Videos.
//! `clip_cancel` reads and sets video.rs's `CLIP_BUSY` and `CLIP_STOP`, which belong to the process, not to an app:
//! where the ffmpeg sidecars exist, video.rs's clip test holds the busy flag across its saves and asserts on both
//! flags, so a call from here running beside it would race it both ways (6.16's review). Every other command here
//! keeps its state in the app's own managed state or folders (a harness each) or only reads a process-wide cache
//! (fonts, time zones); `services_status` reads services.rs's `READING`, which only a command that goes to the network
//! ever fills, and `address_search` and `map_tile` answer here before reaching the address queue or the tile gate.
//! The export commit is tested from inside export.rs (export/ipc_tests.rs), the one place the Save dialog's choice can
//! be stood in for without a dialog.

use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value as Json};
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
use tauri::test::{get_ipc_response, mock_builder, MockRuntime, INVOKE_KEY};
use tauri::utils::config::AppDirectoriesOverride;
use tauri::webview::InvokeRequest;
use tauri::{App, Manager, WebviewWindow, WebviewWindowBuilder};

/// A folder of the test's own in the system's temp folder, as sbd.rs's tests make theirs.
fn temp_dir(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir =
        std::env::temp_dir().join(format!("sbd-commands-{tag}-{}-{nanos}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// The page's own address, which the app counts as local.
fn page_url() -> tauri::Url {
    if cfg!(windows) {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    }
    .parse()
    .unwrap()
}

/// The app on the mock runtime, its main window, and a temp folder that holds the app's own folders (data, cache) and
/// whatever a test writes, removed when the harness goes.
pub(crate) struct Harness {
    pub(crate) app: App<MockRuntime>,
    window: WebviewWindow<MockRuntime>,
    dir: PathBuf,
}

impl Harness {
    pub(crate) fn new(tag: &str) -> Self {
        let dir = temp_dir(tag);
        // The real config, capabilities included (tauri.conf.json, capabilities/default.json), from the crate's one
        // expansion of the macro (lib.rs's `app_context`).
        let mut context = crate::app_context();
        // The app's data and cache folders in the temp folder, never this computer's own.
        context.config_mut().app.app_directories_override =
            Some(AppDirectoriesOverride::Root(dir.join("app")));
        let app = crate::with_commands(mock_builder())
            .build(context)
            .expect("the app builds on the mock runtime");
        // What run()'s setup does first, which the mock runtime's build never reaches (setup waits for the event
        // loop); the window from tauri.conf.json is made there too, so it is made here, with the same label.
        crate::manage_at_start(app.handle());
        let window = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("the main window opens on the mock runtime");
        Self { app, window, dir }
    }

    /// A path in the test's folder, as text, as the page holds paths.
    pub(crate) fn path(&self, name: &str) -> String {
        self.dir.join(name).to_str().unwrap().to_owned()
    }

    pub(crate) fn dir(&self) -> &std::path::Path {
        &self.dir
    }

    /// The app's own data folder (app_data_dir), inside the test's folder.
    fn data_dir(&self) -> PathBuf {
        self.dir.join("app")
    }

    /// The app's own cache folder (app_cache_dir): a root override puts it in `caches` under the root.
    fn cache_dir(&self) -> PathBuf {
        self.dir.join("app").join("caches")
    }

    fn request_from(
        window: &WebviewWindow<MockRuntime>,
        url: tauri::Url,
        cmd: &str,
        body: InvokeBody,
    ) -> Result<InvokeResponseBody, Json> {
        get_ipc_response(
            window,
            InvokeRequest {
                cmd: cmd.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url,
                body,
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
    }

    fn request(&self, cmd: &str, body: InvokeBody) -> Result<InvokeResponseBody, Json> {
        Self::request_from(&self.window, page_url(), cmd, body)
    }

    /// `invoke(cmd, args)` with JSON arguments: the answer as JSON, or what the page's promise rejects with.
    pub(crate) fn call(&self, cmd: &str, args: Json) -> Result<Json, Json> {
        self.request(cmd, InvokeBody::Json(args)).map(as_json)
    }

    /// `invoke(cmd, bytes)`: the request body raw, as sbd_tx_raw and export_write take it.
    pub(crate) fn call_raw(&self, cmd: &str, bytes: Vec<u8>) -> Result<Json, Json> {
        self.request(cmd, InvokeBody::Raw(bytes)).map(as_json)
    }

    /// An answer that is bytes (`tauri::ipc::Response`), which the page reads as an ArrayBuffer.
    fn call_bytes(&self, cmd: &str, args: Json) -> Result<Vec<u8>, Json> {
        self.request(cmd, InvokeBody::Json(args))
            .map(|body| match body {
                InvokeResponseBody::Raw(bytes) => bytes,
                InvokeResponseBody::Json(text) => panic!("{cmd} answered JSON, not bytes: {text}"),
            })
    }

    /// `invoke(cmd, bytes)` whose answer is bytes too (heic_picture): the request body raw, the answer read as an
    /// ArrayBuffer.
    fn call_raw_bytes(&self, cmd: &str, bytes: Vec<u8>) -> Result<Vec<u8>, Json> {
        self.request(cmd, InvokeBody::Raw(bytes))
            .map(|body| match body {
                InvokeResponseBody::Raw(bytes) => bytes,
                InvokeResponseBody::Json(text) => panic!("{cmd} answered JSON, not bytes: {text}"),
            })
    }

    /// A new project with one table, as the page's first migration would leave it; its handle.
    fn project(&self, name: &str, schema: &str) -> Json {
        let handle = self
            .call("sbd_create", json!({ "path": self.path(name) }))
            .unwrap();
        self.call(
            "sbd_tx",
            json!({ "handle": handle, "statements": [{ "sql": schema, "params": [] }] }),
        )
        .unwrap();
        handle
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        // Close every project a test left open first, as the app does on exit: Windows deletes no file that's open, so
        // the folder would otherwise stay behind without a word.
        self.app.state::<crate::sbd::OpenFiles>().close_all();
        let mut tries = 0;
        let failed = loop {
            match fs::remove_dir_all(&self.dir) {
                Ok(()) => break None,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => break None,
                // Windows can take a moment to let go of a file just closed.
                Err(_) if tries < 10 => {
                    tries += 1;
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                Err(error) => break Some(error),
            }
        };
        if let Some(error) = failed {
            let message = format!(
                "the test's folder {} couldn't be deleted: {error}",
                self.dir.display()
            );
            // A test already failing keeps its own message; a second panic would abort the run.
            if std::thread::panicking() {
                eprintln!("{message}");
            } else {
                panic!("{message}");
            }
        }
    }
}

fn as_json(body: InvokeResponseBody) -> Json {
    match body {
        InvokeResponseBody::Json(text) => serde_json::from_str(&text).expect("a JSON answer"),
        InvokeResponseBody::Raw(bytes) => panic!("answered {} bytes, not JSON", bytes.len()),
    }
}

/// The message a command rejected with.
pub(crate) fn refused(answer: Result<Json, Json>) -> String {
    match answer {
        Err(Json::String(message)) => message,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

/// The body packRawTx (tauriDriver.ts) and writeBody (exportFiles.ts) make: a 4-byte big-endian length, the JSON
/// header, then the bytes.
pub(crate) fn raw_body(header: &Json, bytes: &[u8]) -> Vec<u8> {
    let json = serde_json::to_vec(header).unwrap();
    let mut body = (json.len() as u32).to_be_bytes().to_vec();
    body.extend_from_slice(&json);
    body.extend_from_slice(bytes);
    body
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

/// The project file (tauriDriver.ts → sbd.rs).
mod project_file {
    use super::*;

    const SHOTS: &str = "CREATE TABLE shots (id TEXT PRIMARY KEY, lens INTEGER)";

    #[test]
    fn creates_edits_queries_closes_and_reopens_a_project() {
        let h = Harness::new("project");
        let path = h.path("Bey County.sbd");
        let handle = h.call("sbd_create", json!({ "path": path })).unwrap();
        assert!(handle.is_u64(), "a handle is a number: {handle}");
        // The lock file beside it says this computer has it open (lock.rs).
        let lock = h.dir().join(".Bey County.sbd.lock");
        assert!(lock.is_file());
        let changes = h
            .call(
                "sbd_tx",
                json!({ "handle": handle, "statements": [
                    { "sql": SHOTS, "params": [] },
                    { "sql": "INSERT INTO shots VALUES (?, ?)", "params": ["4A", 35] },
                    { "sql": "INSERT INTO shots VALUES (?, ?)", "params": ["4B", null] },
                ] }),
            )
            .unwrap();
        assert_eq!(changes, json!([0, 1, 1]));
        let rows = h
            .call(
                "sbd_query",
                json!({ "handle": handle, "sql": "SELECT id, lens FROM shots ORDER BY id", "params": [] }),
            )
            .unwrap();
        assert_eq!(
            rows,
            json!([{ "id": "4A", "lens": 35 }, { "id": "4B", "lens": null }])
        );
        assert_eq!(
            h.call("sbd_lock_refresh", json!({ "handle": handle })),
            Ok(Json::Null)
        );
        assert_eq!(
            h.call("sbd_close", json!({ "handle": handle })),
            Ok(Json::Null)
        );
        assert!(!lock.exists(), "closing the project takes its lock away");
        assert_eq!(
            refused(h.call(
                "sbd_query",
                json!({ "handle": handle, "sql": "SELECT 1", "params": [] })
            )),
            "That project isn't open."
        );
        // Open, as the page reopens it: what was written is there.
        let again = h.call("sbd_open", json!({ "path": path })).unwrap();
        assert_ne!(again, handle, "each open gets a handle of its own");
        let rows = h
            .call(
                "sbd_query",
                json!({ "handle": again, "sql": "SELECT id FROM shots WHERE lens = ?", "params": [35] }),
            )
            .unwrap();
        assert_eq!(rows, json!([{ "id": "4A" }]));
        assert_eq!(
            h.call("sbd_close", json!({ "handle": again })),
            Ok(Json::Null)
        );
    }

    #[test]
    fn refuses_a_project_already_there_one_missing_and_a_name_not_sbd() {
        let h = Harness::new("project-refusals");
        let path = h.path("Bey County.sbd");
        let handle = h.call("sbd_create", json!({ "path": path })).unwrap();
        h.call("sbd_close", json!({ "handle": handle })).unwrap();
        assert_eq!(
            refused(h.call("sbd_create", json!({ "path": path }))),
            "A file already exists at that path."
        );
        assert_eq!(
            refused(h.call("sbd_open", json!({ "path": h.path("Gone.sbd") }))),
            "There's no project file at that path."
        );
        assert!(h
            .call("sbd_create", json!({ "path": h.path("Bey County.txt") }))
            .is_err());
        // Arguments the page never sends in that shape are refused by the command's own parsing.
        assert!(h.call("sbd_open", json!({ "file": path })).is_err());
    }

    #[test]
    fn writes_bytes_raw_and_reads_them_back_raw() {
        let h = Harness::new("blobs");
        let handle = h.project(
            "Bey County.sbd",
            "CREATE TABLE media_files (id TEXT PRIMARY KEY, bytes BLOB)",
        );
        let picture = [0x89, b'P', b'N', b'G', 0, 1, 2, 3];
        let thumb = [7u8, 8, 9];
        let header = json!({ "handle": handle, "statements": [
            { "sql": "INSERT INTO media_files VALUES (?, ?)", "params": ["full", { "$blob": [0, 8] }] },
            { "sql": "INSERT INTO media_files VALUES (?, ?)", "params": ["thumb", { "$blob": [8, 3] }] },
        ] });
        let body = raw_body(&header, &[picture.as_slice(), thumb.as_slice()].concat());
        assert_eq!(h.call_raw("sbd_tx_raw", body), Ok(json!([1, 1])));
        let read = |id: &str| {
            h.call_bytes(
                "sbd_read_blob",
                json!({ "handle": handle, "sql": "SELECT bytes FROM media_files WHERE id = ?", "params": [id] }),
            )
        };
        assert_eq!(read("full"), Ok(picture.to_vec()));
        assert_eq!(read("thumb"), Ok(thumb.to_vec()));
        // No such row: nothing, which the page reads as "not in this project".
        assert_eq!(read("none"), Ok(Vec::new()));
        // A transaction sent as JSON to the raw command, or a body cut short, is refused.
        assert_eq!(
            refused(h.call("sbd_tx_raw", json!({ "handle": handle, "statements": [] }))),
            "Expected the transaction as raw bytes."
        );
        assert_eq!(
            refused(h.call_raw("sbd_tx_raw", vec![0, 0])),
            "The transaction's bytes are malformed."
        );
    }

    /// The door (6.27b): sbd_tx_raw refuses a stored picture that carries a block outside the keep-list, in the words
    /// the page shows; sbd_import_tx_raw, Import project data's command, writes it as it came once its bytes are the
    /// ones its name says, and refuses it whole, in words, when they aren't; a clean copy goes in.
    #[test]
    fn refuses_an_unclean_picture_raw_and_imports_one_as_it_came() {
        use crate::picture_door::tests::{fixture, CLEAN, RAW};
        let h = Harness::new("door");
        let handle = h.project(
            "Bey County.sbd",
            "CREATE TABLE media_files (sha256 TEXT PRIMARY KEY, bytes BLOB)",
        );
        // As Import project data writes a row (projectJson.ts): every column named, one placeholder each.
        let insert = |sha: &str, bytes: &[u8]| {
            raw_body(
                &json!({ "handle": handle, "statements": [
                    { "sql": "INSERT INTO \"media_files\" (\"sha256\", \"bytes\") VALUES (?, ?)", "params": [sha, { "$blob": [0, bytes.len()] }] },
                ] }),
                bytes,
            )
        };
        let read = |sha: &str| {
            h.call_bytes(
                "sbd_read_blob",
                json!({ "handle": handle, "sql": "SELECT bytes FROM media_files WHERE sha256 = ?", "params": [sha] }),
            )
        };
        for (raw, clean) in RAW.iter().zip(CLEAN) {
            let (raw, clean) = (fixture(raw), fixture(clean));
            let name = crate::sbd::sha256_hex(&raw).unwrap();
            assert_eq!(
                refused(h.call_raw("sbd_tx_raw", insert(&name, &raw))),
                crate::sbd::PICTURE_NOT_CLEAN
            );
            assert_eq!(read(&name), Ok(Vec::new()));
            assert_eq!(
                h.call_raw("sbd_tx_raw", insert("clean", &clean)),
                Ok(json!([1]))
            );
            assert_eq!(read("clean"), Ok(clean.clone()));
            // Named by another picture's hash: the import is refused, and nothing lands.
            let other = crate::sbd::sha256_hex(&clean).unwrap();
            assert_eq!(
                refused(h.call_raw("sbd_import_tx_raw", insert(&other, &raw))),
                crate::sbd::IMPORT_PICTURE_MISNAMED
            );
            assert_eq!(read(&other), Ok(Vec::new()));
            assert_eq!(
                h.call_raw("sbd_import_tx_raw", insert(&name, &raw)),
                Ok(json!([1]))
            );
            assert_eq!(read(&name), Ok(raw));
            h.call(
                "sbd_tx",
                json!({ "handle": handle, "statements": [{ "sql": "DELETE FROM media_files", "params": [] }] }),
            )
            .unwrap();
        }
        // The import's command takes only the raw body, as sbd_tx_raw does.
        assert_eq!(
            refused(h.call(
                "sbd_import_tx_raw",
                json!({ "handle": handle, "statements": [] })
            )),
            "Expected the transaction as raw bytes."
        );
    }

    /// B3 (6.14): Rust refuses a query that returns bytes and a blob read of anything else, and the page sees the
    /// same words the test drivers (memoryDriver.ts, nodeDriver.ts) give.
    #[test]
    fn refuses_bytes_in_a_query_and_a_blob_read_of_text() {
        let h = Harness::new("b3");
        let handle = h.project(
            "Bey County.sbd",
            "CREATE TABLE media_files (id TEXT PRIMARY KEY, bytes BLOB)",
        );
        h.call(
            "sbd_tx",
            json!({ "handle": handle, "statements": [
                { "sql": "INSERT INTO media_files VALUES ('full', x'0102'), ('text', 'abc')", "params": [] },
            ] }),
        )
        .unwrap();
        assert_eq!(
            refused(h.call(
                "sbd_query",
                json!({ "handle": handle, "sql": "SELECT id, bytes FROM media_files WHERE id = ?", "params": ["full"] }),
            )),
            "A query can't return bytes; read them with readBlob."
        );
        assert_eq!(
            refused(h.call(
                "sbd_read_blob",
                json!({ "handle": handle, "sql": "SELECT bytes FROM media_files WHERE id = ?", "params": ["text"] }),
            )),
            "That column doesn't hold bytes."
        );
        // A failed statement rolls the whole transaction back.
        assert!(h
            .call(
                "sbd_tx",
                json!({ "handle": handle, "statements": [
                    { "sql": "INSERT INTO media_files VALUES ('new', NULL)", "params": [] },
                    { "sql": "INSERT INTO nowhere VALUES (1)", "params": [] },
                ] }),
            )
            .is_err());
        assert_eq!(
            h.call(
                "sbd_query",
                json!({ "handle": handle, "sql": "SELECT count(*) AS n FROM media_files", "params": [] }),
            ),
            Ok(json!([{ "n": 2 }]))
        );
    }

    /// Open backup (sbd_copy) and Open version (sbd_save_copy, then sbd_keep_copy or sbd_drop_copy).
    #[test]
    fn copies_a_closed_project_and_makes_keeps_and_drops_a_version_copy() {
        let h = Harness::new("copies");
        let handle = h.project("Bey County.sbd", SHOTS);
        h.call(
            "sbd_tx",
            json!({ "handle": handle, "statements": [{ "sql": "INSERT INTO shots VALUES ('1A', 50)", "params": [] }] }),
        )
        .unwrap();
        // A version's copy: a hidden draft, then its name.
        let draft = h.path(".Bey County v2.sbd");
        let kept = h.path("Bey County v2.sbd");
        assert_eq!(
            h.call("sbd_save_copy", json!({ "handle": handle, "dest": draft })),
            Ok(Json::Null)
        );
        assert_eq!(
            h.call("sbd_keep_copy", json!({ "draft": draft, "dest": kept })),
            Ok(Json::Null)
        );
        assert!(std::path::Path::new(&kept).is_file());
        assert!(!std::path::Path::new(&draft).exists());
        // Only one of the app's own drafts can be kept or dropped.
        assert_eq!(
            refused(h.call("sbd_drop_copy", json!({ "draft": kept }))),
            "That isn't a copy Storiiboard is making."
        );
        let second = h.path(".Bey County v3.sbd");
        h.call("sbd_save_copy", json!({ "handle": handle, "dest": second }))
            .unwrap();
        assert_eq!(
            h.call("sbd_drop_copy", json!({ "draft": second })),
            Ok(Json::Null)
        );
        assert!(!std::path::Path::new(&second).exists());
        h.call("sbd_close", json!({ "handle": handle })).unwrap();
        // Open backup's copy of a closed file, which then opens with what it held.
        let copy = h.path("Bey County copy.sbd");
        assert_eq!(
            h.call("sbd_copy", json!({ "source": kept, "dest": copy })),
            Ok(Json::Null)
        );
        assert_eq!(
            refused(h.call("sbd_copy", json!({ "source": kept, "dest": copy }))),
            "A file already exists at that path."
        );
        let opened = h.call("sbd_open", json!({ "path": copy })).unwrap();
        assert_eq!(
            h.call(
                "sbd_query",
                json!({ "handle": opened, "sql": "SELECT id, lens FROM shots", "params": [] })
            ),
            Ok(json!([{ "id": "1A", "lens": 50 }]))
        );
        assert_eq!(
            h.call("sbd_compact", json!({ "handle": opened })),
            Ok(Json::Null)
        );
        h.call("sbd_close", json!({ "handle": opened })).unwrap();
    }
}

/// Backups and the lock file (sbd.rs, lock.rs), the recent list (app_data.rs) and synced folders (synced.rs).
mod backups_and_app_data {
    use super::*;

    #[test]
    fn makes_lists_and_deletes_a_scheduled_backup_next_to_the_project() {
        let h = Harness::new("backups");
        let handle = h.project("Bey County.sbd", "CREATE TABLE shots (id TEXT)");
        let folder = h.dir().join("Backups").to_str().unwrap().to_owned();
        // A project in a folder no sync service has: next to it, whichever the setting says.
        assert_eq!(
            h.call(
                "sbd_place_backups",
                json!({ "handle": handle, "nextToProject": false })
            ),
            Ok(json!(folder))
        );
        assert_eq!(
            h.call("sbd_backups_folder", json!({ "handle": handle })),
            Ok(json!(folder))
        );
        assert_eq!(
            h.call("sbd_backups", json!({ "handle": handle })),
            Ok(json!([]))
        );
        let name = "Bey County 2026-11-15 10-30.sbd";
        assert_eq!(
            h.call(
                "sbd_backup",
                json!({ "handle": handle, "kind": "scheduled", "fileName": name })
            ),
            Ok(Json::Null)
        );
        let listed = h.call("sbd_backups", json!({ "handle": handle })).unwrap();
        assert_eq!(listed.as_array().map(Vec::len), Some(1));
        assert_eq!(listed[0]["name"], json!(name));
        // The space this backup alone takes (backup::own_bytes): all of a full copy; on a Mac the backup is an APFS
        // clone, which takes next to nothing while fresh, so 0 is right there (backup.rs tests that it is).
        let bytes = listed[0]["bytes"]
            .as_u64()
            .expect("a backup lists its own bytes");
        if !cfg!(target_os = "macos") {
            assert!(bytes > 0);
        }
        // Only this project's backup names, for a backup and for a deletion.
        assert_eq!(
            refused(h.call(
                "sbd_backup",
                json!({ "handle": handle, "kind": "scheduled", "fileName": "Other 2026-11-15 10-30.sbd" })
            )),
            "\"Other 2026-11-15 10-30.sbd\" isn't a backup name for this project."
        );
        assert_eq!(
            refused(h.call(
                "sbd_delete_backup",
                json!({ "handle": handle, "fileName": "../Bey County.sbd" })
            )),
            "\"../Bey County.sbd\" isn't a backup name for this project."
        );
        assert!(h
            .call(
                "sbd_backup",
                json!({ "handle": handle, "kind": "hourly", "fileName": name })
            )
            .is_err());
        assert_eq!(
            h.call(
                "sbd_delete_backup",
                json!({ "handle": handle, "fileName": name })
            ),
            Ok(Json::Null)
        );
        assert_eq!(
            h.call("sbd_backups", json!({ "handle": handle })),
            Ok(json!([]))
        );
        h.call("sbd_close", json!({ "handle": handle })).unwrap();
    }

    #[test]
    fn says_who_else_has_a_project_open_and_ignores_this_computer() {
        let h = Harness::new("lock");
        let path = h.path("Bey County.sbd");
        assert_eq!(
            h.call("sbd_lock_holder", json!({ "path": path })),
            Ok(Json::Null)
        );
        // Another computer's fresh lock, as lock.rs writes it.
        let now = now_ms();
        let other = json!({
            "app": "Storiiboard", "computer": "Edit bay", "machine": "another-machine", "session": "s1",
            "opened_at": now - 1000, "refreshed_at": now,
        });
        fs::write(h.dir().join(".Bey County.sbd.lock"), other.to_string()).unwrap();
        assert_eq!(
            h.call("sbd_lock_holder", json!({ "path": path })),
            Ok(json!({ "computer": "Edit bay", "openedAt": now - 1000 }))
        );
        // This computer's own lock never warns it (the project it creates or opens takes the lock).
        fs::remove_file(h.dir().join(".Bey County.sbd.lock")).unwrap();
        let handle = h.call("sbd_create", json!({ "path": path })).unwrap();
        assert_eq!(
            h.call("sbd_lock_holder", json!({ "path": path })),
            Ok(Json::Null)
        );
        h.call("sbd_close", json!({ "handle": handle })).unwrap();
    }

    #[test]
    fn reads_and_writes_the_recent_list_and_nothing_else() {
        let h = Harness::new("app-data");
        assert_eq!(
            h.call("app_data_read", json!({ "name": "recent.json" })),
            Ok(Json::Null)
        );
        let list = r#"[{"path":"/Projects/Bey County.sbd"}]"#;
        assert_eq!(
            h.call(
                "app_data_write",
                json!({ "name": "recent.json", "contents": list })
            ),
            Ok(Json::Null)
        );
        assert_eq!(
            h.call("app_data_read", json!({ "name": "recent.json" })),
            Ok(json!(list))
        );
        // In the app's data folder (here the test's), never anywhere the page names.
        assert_eq!(
            fs::read_to_string(h.data_dir().join("recent.json")).unwrap(),
            list
        );
        assert_eq!(
            refused(h.call(
                "app_data_write",
                json!({ "name": "../recent.json", "contents": "[]" })
            )),
            "\"../recent.json\" isn't an app data file."
        );
        assert_eq!(
            refused(h.call("app_data_read", json!({ "name": "tile-provider.json" }))),
            "\"tile-provider.json\" isn't an app data file."
        );
    }

    #[test]
    fn a_folder_no_sync_service_has_is_null() {
        let h = Harness::new("synced");
        assert_eq!(
            h.call("sync_service", json!({ "path": h.path("Bey County.sbd") })),
            Ok(Json::Null)
        );
    }
}

/// This computer: week start, time zone at a place, fonts, licences, the online services (region.rs, timezone.rs,
/// fonts.rs, licences.rs, services.rs).
mod this_computer {
    use super::*;

    #[test]
    fn week_start_answers_in_the_shape_week_start_ts_reads() {
        let h = Harness::new("week");
        let week = h.call("region_week", json!({})).unwrap();
        let object = week.as_object().expect("an object");
        let mut keys: Vec<&String> = object.keys().collect();
        keys.sort();
        assert_eq!(keys, ["firstDay", "locale"]);
        assert!(week["firstDay"].is_null() || week["firstDay"].as_u64().is_some_and(|d| d <= 6));
        assert!(week["locale"].is_null() || week["locale"].is_string());
    }

    #[test]
    fn time_zone_at_a_place_and_none_off_the_map() {
        let h = Harness::new("zone");
        assert_eq!(
            h.call(
                "time_zone_at",
                json!({ "latitude": 40.4168, "longitude": -3.7038 })
            ),
            Ok(json!("Europe/Madrid"))
        );
        assert_eq!(
            h.call(
                "time_zone_at",
                json!({ "latitude": 120.0, "longitude": 0.0 })
            ),
            Ok(Json::Null)
        );
    }

    #[test]
    fn photo_exif_reads_the_raw_body_and_answers_in_the_shape_photo_exif_ts_reads() {
        let h = Harness::new("exif");
        // A made-up photo: only its EXIF, a point in the open sea (exif.rs's fixture).
        let photo = crate::exif::tests::jpeg(&crate::exif::tests::Fixture {
            original: Some("2026:11:03 16:42:07"),
            offset_original: Some("+02:00"),
            latitude: Some(([(12, 1), (30, 1), (3600, 100)], "N")),
            longitude: Some(([(45, 1), (15, 1), (0, 1)], "W")),
            ..Default::default()
        });
        assert_eq!(
            h.call_raw("photo_exif", photo),
            Ok(json!({
                "takenAt": "2026-11-03T16:42:07",
                "takenOffset": "+02:00",
                "latitude": 12.51,
                "longitude": -45.25,
                "reason": "read"
            }))
        );
        // A picture with no EXIF, and bytes that are no picture: an answer with nothing in it, never a refusal.
        let nothing = json!({ "takenAt": null, "takenOffset": null, "latitude": null, "longitude": null, "reason": "none" });
        assert_eq!(
            h.call_raw("photo_exif", vec![0xff, 0xd8, 0xff, 0xd9]),
            Ok(nothing.clone())
        );
        assert_eq!(h.call_raw("photo_exif", b"garbage".to_vec()), Ok(nothing));
        // Round 3 (Kevin, Nov 17): why there are none, in the same answer: a refused block and a HEIC each say so.
        let empty = |reason: &str| json!({ "takenAt": null, "takenOffset": null, "latitude": null, "longitude": null, "reason": reason });
        // A block the walk refuses.
        let mut refused_block = b"II*\0".to_vec();
        refused_block.extend(8u32.to_le_bytes());
        refused_block.extend(2u16.to_le_bytes());
        for tag in [0x8769u16, 0xa005] {
            refused_block.extend(tag.to_le_bytes());
            refused_block.extend(4u16.to_le_bytes());
            refused_block.extend(1u32.to_le_bytes());
            refused_block.extend(8u32.to_le_bytes());
        }
        refused_block.extend(0u32.to_le_bytes());
        assert_eq!(
            h.call_raw("photo_exif", refused_block),
            Ok(empty("refused"))
        );
        let mut heic = 20u32.to_be_bytes().to_vec();
        heic.extend(b"ftypheic\0\0\0\0mif1");
        assert_eq!(h.call_raw("photo_exif", heic), Ok(empty("heic")));
        // Arguments as JSON are not a picture.
        assert_eq!(
            refused(h.call("photo_exif", json!({ "bytes": [1, 2, 3] }))),
            "Expected the picture as raw bytes."
        );
    }

    #[test]
    fn lists_this_computers_fonts_and_reads_one() {
        let h = Harness::new("fonts");
        let families = h.call("fonts_list", json!({})).unwrap();
        let families = families.as_array().expect("a list of families");
        for family in families {
            assert!(family["name"].is_string());
            for style in family["styles"].as_array().expect("styles") {
                assert!(style["weight"].is_u64() && style["realWeight"].is_u64());
                assert!(style["italic"].is_boolean() && style["postscriptName"].is_string());
            }
        }
        // A face the list names reads as its bytes after the three-byte fsType header (deckFonts.ts, fonts.ts).
        let named = families
            .iter()
            .flat_map(|family| family["styles"].as_array().cloned().unwrap_or_default())
            .find_map(|style| style["postscriptName"].as_str().map(str::to_owned));
        if let Some(name) = named {
            let bytes = h
                .call_bytes("font_bytes", json!({ "postscriptName": name }))
                .unwrap();
            assert!(bytes.len() > 3 && bytes[0] <= 1);
        }
        assert_eq!(
            refused(h.call(
                "font_bytes",
                json!({ "postscriptName": "No-Such-Font-Anywhere" })
            )),
            "That font isn't on this computer."
        );
    }

    #[test]
    fn reads_only_a_licence_on_the_list() {
        let h = Harness::new("licences");
        // A test build has no bundled resources, so even a listed licence answers as missing; never a file off the list.
        let missing =
            "That license isn't in this copy of Storiiboard. Reinstalling Storiiboard puts it back.";
        for name in ["ffmpeg-LICENSE.txt", "../Cargo.toml", "tauri.conf.json"] {
            assert_eq!(
                refused(h.call("licence_text", json!({ "name": name }))),
                missing
            );
        }
    }

    #[test]
    fn lists_every_online_service_unchecked_before_the_switch_is_read() {
        let h = Harness::new("services");
        let services = h.call("services_status", json!({})).unwrap();
        let ids: Vec<&str> = services
            .as_array()
            .expect("a list")
            .iter()
            .map(|service| service["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, ["nominatim", "met-norway", "osm-tiles"]);
        for service in services.as_array().unwrap() {
            assert!(service["server"]
                .as_str()
                .is_some_and(|s| s.starts_with("https://")));
            assert_eq!(service["state"], json!("unchecked"));
            assert_eq!(service["reason"], Json::Null);
        }
    }
}

/// A double-clicked .sbd (opened.rs), videos and playback copies (video.rs, playback.rs), pictures (pictures.rs,
/// originals.rs, open.rs): the parts that need no ffmpeg, no dialog and no other program.
mod files_and_media {
    use super::*;

    #[test]
    fn hands_over_the_files_opened_from_outside_once() {
        let h = Harness::new("opened");
        assert_eq!(h.call("opened_files_take", json!({})), Ok(json!([])));
        let path = h.path("Bey County.sbd");
        crate::opened::queue(h.app.handle(), vec![path.clone(), path.clone()]);
        assert_eq!(h.call("opened_files_take", json!({})), Ok(json!([path])));
        assert_eq!(h.call("opened_files_take", json!({})), Ok(json!([])));
    }

    #[test]
    fn says_nothing_about_a_video_the_page_may_not_ask_about() {
        let h = Harness::new("videos");
        let video = h.path("A001.mov");
        fs::write(&video, b"not really a video").unwrap();
        // Not dropped, chosen, remembered or inside an open project's folder: null, as video.ts reads it.
        assert_eq!(
            h.call(
                "video_status",
                json!({ "paths": [video, "relative.mov"], "handle": null })
            ),
            Ok(json!([null, null]))
        );
        assert_eq!(h.call("known_videos_count", json!({})), Ok(json!(0)));
        assert_eq!(h.call("known_videos_forget", json!({})), Ok(Json::Null));
        assert_eq!(
            h.call("playback_cancel", json!({ "path": video, "lut": null })),
            Ok(json!(false))
        );
    }

    #[test]
    fn playback_copies_report_and_keep_their_settings() {
        let h = Harness::new("playback");
        let info = h.call("playback_info", json!({})).unwrap();
        assert_eq!(info["copies"], json!(0));
        assert_eq!(info["bytes"], json!(0));
        assert_eq!(info["moved"], json!(false));
        assert_eq!(info["fallback"], json!(false));
        assert!(info["folder"]
            .as_str()
            .is_some_and(|folder| folder.starts_with(h.dir().to_str().unwrap())));
        assert_eq!(
            h.call("playback_set_cap", json!({ "gb": 40 })),
            Ok(Json::Null)
        );
        assert_eq!(
            h.call("playback_set_floor", json!({ "gb": 12 })),
            Ok(Json::Null)
        );
        let info = h.call("playback_info", json!({})).unwrap();
        assert_eq!(
            (info["capGb"].clone(), info["floorGb"].clone()),
            (json!(40), json!(12))
        );
        assert_eq!(h.call("playback_clear", json!({})), Ok(json!(0)));
        assert_eq!(h.call("playback_move_back", json!({})), Ok(json!(0)));
    }

    #[test]
    fn reads_only_pictures_the_person_offered() {
        let h = Harness::new("pictures");
        let picture = h.path("still.png");
        fs::write(&picture, [0x89, b'P', b'N', b'G']).unwrap();
        assert_eq!(
            refused(h.call("pictures_read", json!({ "path": picture }))),
            "Storiiboard reads only the files you drop on it or choose."
        );
    }

    #[test]
    fn a_pictures_original_by_its_record_and_by_its_hash() {
        let h = Harness::new("originals");
        let handle = h.project(
            "Bey County.sbd",
            "CREATE TABLE records (id TEXT PRIMARY KEY, type TEXT, props TEXT, trashed_at TEXT)",
        );
        let sha = "ab".repeat(32);
        let original = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3];
        fs::write(h.dir().join("still.png"), original).unwrap();
        let props = json!({ "kind": "image", "file": sha, "source_path": "still.png" }).to_string();
        h.call(
            "sbd_tx",
            json!({ "handle": handle, "statements": [
                { "sql": "INSERT INTO records VALUES ('m1', 'media', ?, NULL)", "params": [props] },
            ] }),
        )
        .unwrap();
        // The deck's full-quality picture (deckPictures.ts): the original's bytes, or none.
        assert_eq!(
            h.call_bytes(
                "picture_original",
                json!({ "handle": handle, "sha256": sha })
            ),
            Ok(original.to_vec())
        );
        assert_eq!(
            h.call_bytes(
                "picture_original",
                json!({ "handle": handle, "sha256": "cd".repeat(32) })
            ),
            Ok(Vec::new())
        );
        // Show in Finder's check (opener.ts): only that record's own original, and only while it's there.
        let shown = |record: &str| {
            h.call(
                "original_shown",
                json!({ "handle": handle, "recordId": record, "sha256": sha }),
            )
        };
        assert_eq!(shown("m1"), Ok(json!(true)));
        assert_eq!(shown("m2"), Ok(json!(false)));
        fs::remove_file(h.dir().join("still.png")).unwrap();
        assert_eq!(shown("m1"), Ok(json!(false)));
        h.call("sbd_close", json!({ "handle": handle })).unwrap();
    }
}

/// A HEIC photo turned into a PNG (heic.rs, 6.27n): the one ffmpeg command here, since it needs only the photo's bytes
/// and the app's own cache folder (the harness's). Where the ffmpeg sidecars run, as heic.rs's own tests need them.
mod heic_photos {
    use super::*;

    fn proof() -> Vec<u8> {
        fs::read(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("testdata")
                .join("heic")
                .join("heic-proof.heic"),
        )
        .unwrap()
    }

    #[test]
    fn heic_picture_takes_the_raw_body_and_answers_a_pngs_bytes() {
        let h = Harness::new("heic");
        let answer = h.call_raw_bytes("heic_picture", proof());
        if cfg!(target_os = "macos") {
            // WebKit reads HEIC itself: the Mac answers the page's own HEIC line, as before.
            assert_eq!(
                refused(answer.map(|_| Json::Null)),
                "This is an HEIC photo, which Storiiboard can’t read on this computer yet. Convert it to JPEG first."
            );
            return;
        }
        let png = answer.unwrap();
        assert!(png.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]));
        // IHDR first, 1024 × 768, then the file's profile.
        assert_eq!(&png[12..16], b"IHDR");
        assert_eq!(&png[16..24], [0, 0, 4, 0, 0, 0, 3, 0]);
        assert_eq!(&png[37..41], b"iCCP");
        // Its temp file was in the app's cache folder, and is gone.
        let left: Vec<_> = fs::read_dir(h.cache_dir())
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .map(|e| e.file_name())
                    .collect()
            })
            .unwrap_or_default();
        assert!(
            left.iter()
                .all(|name| !name.to_string_lossy().ends_with(".heic")),
            "{left:?}"
        );
        // A file that isn't a HEIF, refused with its words; arguments as JSON aren't a photo.
        assert_eq!(
            refused(
                h.call_raw_bytes("heic_picture", vec![0xff, 0xd8, 0xff, 0xd9])
                    .map(|_| Json::Null)
            ),
            "That file isn't an HEIC photo."
        );
        assert_eq!(
            refused(h.call("heic_picture", json!({ "bytes": [1, 2, 3] }))),
            "Expected the picture as raw bytes."
        );
    }
}

/// The online commands, only where they answer without the network: a refusal before any request, or a tile already
/// in the cache.
mod online_without_the_network {
    use super::*;

    #[test]
    fn an_empty_address_search_is_refused_before_anything_is_sent() {
        let h = Harness::new("address");
        assert_eq!(
            refused(h.call(
                "address_search",
                json!({ "query": "   ", "language": "en" })
            )),
            "Type an address or a place name to search for."
        );
    }

    #[test]
    fn map_tiles_come_from_the_cache_and_a_tile_off_the_map_is_refused() {
        let h = Harness::new("tiles");
        assert_eq!(
            refused(h.call("map_tile", json!({ "z": 2, "x": 4, "y": 0 }))),
            "That tile is outside the map."
        );
        // A tile cached with a lifetime still to run (tiles.rs: `osm/z/x/y.png` and its `y.json`): served as it is.
        let tile = [0x89, b'P', b'N', b'G', 9, 9, 9];
        let folder = h.cache_dir().join("tiles").join("osm").join("3").join("4");
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("2.png"), tile).unwrap();
        let expires = now_ms() / 1000 + 86_400;
        fs::write(
            folder.join("2.json"),
            json!({ "expires": expires, "etag": null, "last_modified": null }).to_string(),
        )
        .unwrap();
        assert_eq!(
            h.call_bytes("map_tile", json!({ "z": 3, "x": 4, "y": 2 })),
            Ok(tile.to_vec())
        );
        let info = h.call("map_tiles_info", json!({})).unwrap();
        assert_eq!(info["tiles"], json!(1));
        assert!(info["bytes"]
            .as_u64()
            .is_some_and(|bytes| bytes >= tile.len() as u64));
        assert!(info["capBytes"].as_u64().is_some_and(|cap| cap > 0));
        assert_eq!(h.call("map_tiles_clear", json!({})), Ok(json!(1)));
        assert_eq!(
            h.call("map_tiles_info", json!({})).unwrap()["tiles"],
            json!(0)
        );
    }

    #[test]
    fn a_tile_server_of_ones_own_is_read_cleared_and_checked() {
        let h = Harness::new("provider");
        assert_eq!(h.call("map_tile_provider", json!({})), Ok(Json::Null));
        // One already saved (tiles.rs's file in the app's data folder): read back, and saved again without a question.
        let saved = json!({
            "template": "https://tiles.example.org/{z}/{x}/{y}.png", "attribution": "Example", "host": "tiles.example.org",
        });
        fs::create_dir_all(h.data_dir()).unwrap();
        fs::write(h.data_dir().join("tile-provider.json"), saved.to_string()).unwrap();
        assert_eq!(h.call("map_tile_provider", json!({})), Ok(saved.clone()));
        assert_eq!(
            h.call(
                "map_tile_provider_set",
                json!({ "template": saved["template"], "attribution": "Example", "language": "en" })
            ),
            Ok(json!({ "status": "set", "provider": saved }))
        );
        // Not HTTPS: refused before any question.
        assert_eq!(
            refused(h.call(
                "map_tile_provider_set",
                json!({ "template": "http://tiles.example.org/{z}/{x}/{y}.png", "attribution": "", "language": "en" })
            )),
            "The address must be https://, a host name, and contain {z}, {x} and {y} once each."
        );
        // No template: back to OpenStreetMap.
        assert_eq!(
            h.call(
                "map_tile_provider_set",
                json!({ "template": "", "attribution": "", "language": "en" })
            ),
            Ok(json!({ "status": "cleared", "provider": null }))
        );
        assert_eq!(h.call("map_tile_provider", json!({})), Ok(Json::Null));
    }
}

/// The launch check's one command (launch_check.rs, 6.27l), as src/app/launchCheck/launchCheck.ts calls it. The mode is
/// never switched on from the environment here (tests share one process): its state is handed to the app, as run()
/// does, with a finisher that notes the verdict instead of ending the process.
mod launch_check_step {
    use super::*;
    use crate::launch_check::{LaunchCheck, Reporter, Verdict};
    use std::sync::{Arc, Mutex};

    type Noted<T> = Arc<Mutex<Vec<T>>>;

    /// The check's state on the harness's app, with what it says and what it decides noted.
    fn running(h: &Harness) -> (Noted<String>, Noted<Verdict>) {
        let lines: Noted<String> = Arc::default();
        let verdicts: Noted<Verdict> = Arc::default();
        let (said, decided) = (Arc::clone(&lines), Arc::clone(&verdicts));
        // A fake clock: each reading 1.5 s after the last, from 1.5 s, so every line's time is known.
        let readings = Arc::new(Mutex::new(0u64));
        assert!(h.app.manage(LaunchCheck::<MockRuntime>::new(
            Box::new(move |line| said.lock().unwrap().push(line.to_owned())),
            Box::new(move |_, verdict| decided.lock().unwrap().push(verdict.clone())),
            Box::new(move || {
                let mut n = readings.lock().unwrap();
                *n += 1;
                std::time::Duration::from_millis(1_500 * *n)
            }),
        )));
        (lines, verdicts)
    }

    /// The time the fake clock gives at its `n`th reading, as a line prints it.
    fn at(n: u64) -> String {
        format!("(at {:.1} s)", (1_500 * n) as f64 / 1000.0)
    }

    fn step(h: &Harness, step: &str, ok: bool, detail: &str) -> Result<Json, Json> {
        h.call(
            "launch_check_step",
            json!({ "step": step, "ok": ok, "detail": detail }),
        )
    }

    const PAGE_STEPS: [&str; 6] = [
        "page",
        "policy-watch",
        "pdf-text",
        "accents",
        "worker-policy",
        "no-violation",
    ];

    #[test]
    fn is_refused_and_records_nothing_when_the_check_is_not_running() {
        let h = Harness::new("launch-off");
        for name in PAGE_STEPS {
            assert_eq!(
                refused(step(&h, name, true, "")),
                "the launch check is not running"
            );
        }
        assert_eq!(
            refused(step(&h, "pdf-text", false, "x")),
            "the launch check is not running"
        );
        // Nothing made the check's state: only run() does, in the mode.
        assert!(h.app.try_state::<LaunchCheck<MockRuntime>>().is_none());
    }

    #[test]
    fn records_the_pages_six_steps_and_hands_the_pass_to_the_finisher() {
        let h = Harness::new("launch-pass");
        let (lines, verdicts) = running(&h);
        let check = h.app.state::<LaunchCheck<MockRuntime>>();
        check
            .report(h.app.handle(), Reporter::Rust, "window", true, "")
            .unwrap();
        check
            .report(h.app.handle(), Reporter::Rust, "loaded", true, "")
            .unwrap();
        // The app's own steps can't come from the page, nor a step that isn't one.
        for name in ["window", "loaded", "passed"] {
            assert!(step(&h, name, true, "").is_err(), "{name}");
        }
        for name in PAGE_STEPS {
            assert_eq!(step(&h, name, true, ""), Ok(Json::Null), "{name}");
        }
        assert_eq!(*verdicts.lock().unwrap(), vec![Verdict::Passed]);
        // A report after the verdict changes nothing.
        assert_eq!(step(&h, "page", false, "late"), Ok(Json::Null));
        assert_eq!(*verdicts.lock().unwrap(), vec![Verdict::Passed]);
        assert!(check.decided());
        let said = lines.lock().unwrap().clone();
        // Each step's line with its time (Nov 21), one clock reading each; `passed` as it always was.
        let mut expected: Vec<String> = crate::launch_check::STEPS
            .iter()
            .zip(1..)
            .map(|(name, n)| format!("launch check: {name} ok {}", at(n)))
            .collect();
        expected.push("launch check: passed".to_owned());
        assert_eq!(said, expected);
    }

    #[test]
    fn a_page_step_ok_with_a_detail_says_it_as_its_note_and_still_passes() {
        let h = Harness::new("launch-note");
        let (lines, verdicts) = running(&h);
        let check = h.app.state::<LaunchCheck<MockRuntime>>();
        check
            .report(h.app.handle(), Reporter::Rust, "window", true, "")
            .unwrap();
        // loaded's own note still works.
        check
            .report_noted(
                h.app.handle(),
                Reporter::Rust,
                "loaded",
                true,
                "",
                Some(crate::launch_check::SHOWN_BY_NET),
            )
            .unwrap();
        let note = "by the page: read ok, 16 × 16, 3 accents; the worker: The object is in an invalid state. \
                    (worker: read); the worker asked again: no answer in 10 s";
        for name in PAGE_STEPS {
            let detail = if name == "accents" {
                format!("{note}\n\u{7}")
            } else {
                String::new()
            };
            assert_eq!(step(&h, name, true, &detail), Ok(Json::Null), "{name}");
        }
        assert_eq!(*verdicts.lock().unwrap(), vec![Verdict::Passed]);
        assert_eq!(Verdict::Passed.code(), 0);
        let said = lines.lock().unwrap().clone();
        assert_eq!(
            said,
            vec![
                "launch check: window ok (at 1.5 s)".to_owned(),
                "launch check: loaded ok (already shown by the 3-second net) (at 3.0 s)".to_owned(),
                "launch check: page ok (at 4.5 s)".to_owned(),
                "launch check: policy-watch ok (at 6.0 s)".to_owned(),
                "launch check: pdf-text ok (at 7.5 s)".to_owned(),
                format!("launch check: accents ok ({note}) (at 9.0 s)"),
                "launch check: worker-policy ok (at 10.5 s)".to_owned(),
                "launch check: no-violation ok (at 12.0 s)".to_owned(),
                "launch check: passed".to_owned(),
            ]
        );
        // Bounded as a failure's reason is.
        let h = Harness::new("launch-long-note");
        let (lines, _) = running(&h);
        assert_eq!(step(&h, "accents", true, &"y".repeat(400)), Ok(Json::Null));
        assert_eq!(
            lines.lock().unwrap().clone(),
            vec![format!(
                "launch check: accents ok ({}) {}",
                "y".repeat(300),
                at(1)
            )]
        );
    }

    #[test]
    fn a_failed_page_step_is_the_verdict_with_its_code_and_its_cleaned_reason() {
        let h = Harness::new("launch-fail");
        let (lines, verdicts) = running(&h);
        assert_eq!(step(&h, "page", true, ""), Ok(Json::Null));
        assert_eq!(
            step(&h, "accents", false, "the worker gave\nno answer"),
            Ok(Json::Null)
        );
        let failed = Verdict::Failed {
            step: "accents",
            code: 16,
            why: "the worker gave no answer".to_owned(),
        };
        assert_eq!(*verdicts.lock().unwrap(), vec![failed]);
        assert_eq!(
            lines.lock().unwrap().last().map(String::as_str),
            Some("launch check: FAILED at accents: the worker gave no answer (at 3.0 s)")
        );
        // Decided: a later pass of every step is ignored.
        for name in PAGE_STEPS {
            assert_eq!(step(&h, name, true, ""), Ok(Json::Null), "{name}");
        }
        assert_eq!(verdicts.lock().unwrap().len(), 1);
    }
}

/// The capability files (capabilities/default.json) as the mock runtime checks them, built from the real config.
mod permissions {
    use super::*;

    #[test]
    fn the_page_may_call_what_its_capability_grants_and_nothing_more() {
        let h = Harness::new("permissions");
        // core:default grants the app plugin's version.
        assert_eq!(h.call("plugin:app|version", json!({})), Ok(json!("0.1.0")));
        // The page has none of the opener's permissions (open.rs calls it from Rust), and of the dialog's only open
        // and save.
        for command in ["plugin:opener|open_url", "plugin:dialog|message"] {
            let message = refused(h.call(command, json!({ "url": "https://example.org" })));
            assert!(message.contains("not allowed"), "{command}: {message}");
        }
    }

    #[test]
    fn a_window_the_capability_doesnt_name_and_a_remote_page_are_refused() {
        let h = Harness::new("windows");
        let other = WebviewWindowBuilder::new(&h.app, "other", Default::default())
            .build()
            .unwrap();
        let refused_from = |window: &WebviewWindow<MockRuntime>, url: tauri::Url, cmd: &str| {
            match Harness::request_from(window, url, cmd, InvokeBody::Json(json!({}))) {
                Err(Json::String(message)) => message,
                other => panic!("{cmd}: expected a refusal, got {other:?}"),
            }
        };
        assert!(refused_from(&other, page_url(), "plugin:app|version").contains("not allowed"));
        // A page from anywhere but the app itself reaches none of the app's own commands.
        let remote: tauri::Url = "https://example.org".parse().unwrap();
        assert!(refused_from(&h.window, remote, "opened_files_take").contains("not allowed"));
    }
}
