//! export_write as exportFiles.ts calls it: the body raw (writeBody: a 4-byte length, the JSON header, the bytes),
//! by name through the app's IPC. The dialogs can't be answered in a test, so the choice they record is made here
//! directly, on the app's own `Chosen` state: `remember` as export_choose_file does after its Save dialog, `begin_run`
//! as export_choose_folder does after its folder dialog. Everything after the dialog is the command's own.

use std::fs;

use serde_json::{json, Value as Json};
use tauri::Manager;

use super::{begin_run, remember, Chosen};
use crate::command_tests::{raw_body, refused, Harness};

#[test]
fn writes_the_file_the_save_dialog_chose_once_and_nothing_else() {
    let h = Harness::new("export-file");
    let path = h.path("Bey County call sheet.pdf");
    let write =
        |bytes: &[u8]| h.call_raw("export_write", raw_body(&json!({ "path": path }), bytes));
    // Not chosen: refused, and nothing is written.
    let denied = "Storiiboard writes exports only where you choose.";
    assert_eq!(refused(write(b"%PDF-1.7")), denied);
    assert!(!h.dir().join("Bey County call sheet.pdf").exists());
    remember(
        &h.app.state::<Chosen>().files,
        &h.dir().join("Bey County call sheet.pdf"),
    );
    assert_eq!(write(b"%PDF-1.7 sheet"), Ok(json!("")));
    assert_eq!(
        fs::read(h.dir().join("Bey County call sheet.pdf")).unwrap(),
        b"%PDF-1.7 sheet"
    );
    // Once: a second write to the same choice is refused.
    assert_eq!(refused(write(b"again")), denied);
    // JSON instead of the raw body, or a body cut short.
    assert_eq!(
        refused(h.call("export_write", json!({ "path": path }))),
        "Expected the export as raw bytes."
    );
    assert_eq!(
        refused(h.call_raw("export_write", vec![0, 0, 0, 9, b'{'])),
        "The export's bytes are malformed."
    );
}

#[test]
fn stages_and_commits_a_set_of_files_into_a_new_folder_then_finishes_the_run() {
    let h = Harness::new("export-folder");
    let parent = h.path("Exports");
    fs::create_dir_all(&parent).unwrap();
    let token = begin_run(&h.app.state::<Chosen>(), h.dir().join("Exports").as_path());
    let send = |action: &str, name: Option<&str>, bytes: &[u8]| {
        let mut header =
            json!({ "path": parent, "folder": "Pitch", "action": action, "token": token });
        if let Some(name) = name {
            header["name"] = Json::from(name);
        }
        h.call_raw("export_write", raw_body(&header, bytes))
    };
    // The first stage makes the folder and answers its name; the file waits under a temporary name.
    assert_eq!(
        send("stage", Some("SC004_4A.png"), b"png one"),
        Ok(json!("Pitch"))
    );
    let folder = h.dir().join("Exports").join("Pitch");
    assert!(folder.join(".SC004_4A.png.part").is_file());
    assert!(!folder.join("SC004_4A.png").exists());
    assert_eq!(
        send("commit", Some("SC004_4A.png"), b""),
        Ok(json!("Pitch"))
    );
    assert_eq!(fs::read(folder.join("SC004_4A.png")).unwrap(), b"png one");
    // A name with a way out of the folder is refused.
    assert_eq!(
        refused(send("stage", Some("../SC004_4B.png"), b"x")),
        "Storiiboard writes exports only where you choose."
    );
    assert_eq!(send("finish", None, b""), Ok(json!("Pitch")));
    // The run is over: its token is no good.
    assert_eq!(
        refused(send("stage", Some("SC004_4C.png"), b"late")),
        "Storiiboard writes exports only where you choose."
    );
    // A second run into the same folder gets a folder of its own.
    let second = begin_run(&h.app.state::<Chosen>(), h.dir().join("Exports").as_path());
    let header = json!({ "path": parent, "folder": "Pitch", "action": "stage", "name": "a.png", "token": second });
    assert_eq!(
        h.call_raw("export_write", raw_body(&header, b"two")),
        Ok(json!("Pitch 2"))
    );
    // A token never handed out writes nothing.
    let forged = json!({ "path": parent, "folder": "Pitch", "action": "stage", "name": "b.png", "token": "guess" });
    assert_eq!(
        refused(h.call_raw("export_write", raw_body(&forged, b"x"))),
        "Storiiboard writes exports only where you choose."
    );
}

/// 6.15 review, through the registered command: a single-file export that stops after the Save dialog sends the header
/// exportFiles.ts's `end` sends (`{ path, action: 'end' }`, no bytes); the command answers as for a write, writes nothing,
/// and the file chosen can't be written afterwards.
#[test]
fn ends_a_single_file_export_so_the_file_chosen_cant_be_written() {
    let h = Harness::new("export-end");
    let path = h.path("Bey County.csv");
    remember(
        &h.app.state::<Chosen>().files,
        &h.dir().join("Bey County.csv"),
    );
    assert_eq!(
        h.call_raw(
            "export_write",
            raw_body(&json!({ "path": path, "action": "end" }), b"")
        ),
        Ok(json!(""))
    );
    assert!(!h.dir().join("Bey County.csv").exists());
    assert_eq!(
        refused(h.call_raw(
            "export_write",
            raw_body(&json!({ "path": path }), b"scene,shot")
        )),
        "Storiiboard writes exports only where you choose."
    );
    assert!(!h.dir().join("Bey County.csv").exists());
}
