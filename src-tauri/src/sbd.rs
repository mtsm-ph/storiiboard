//! The .sbd project file: one SQLite database per project. This module is the only code that opens one. The UI sends
//! SQL with parameters and gets rows back; the schema and migrations live in TypeScript (src/core/storage), so the
//! MCP server can run the same ones through Node's own SQLite.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::types::{Value, ValueRef};
use rusqlite::{params_from_iter, Connection, OpenFlags, TransactionBehavior};
use serde::Deserialize;
use serde_json::{Map, Number, Value as Json};
use tauri::State;

/// One statement in a batch: SQL with `?` placeholders, and its parameters.
#[derive(Debug, Deserialize)]
pub struct Statement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Json>,
}

/// A scheduled backup goes to `Backups/` next to the project; the copy made before a migration sits beside the file.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BackupKind {
    Scheduled,
    Migration,
}

pub type Row = Map<String, Json>;

pub struct SbdFile {
    conn: Connection,
    path: PathBuf,
}

impl SbdFile {
    /// Makes a new, empty project file. Refuses to touch a file that already exists.
    pub fn create(path: &Path) -> Result<Self, String> {
        check_extension(path)?;
        if path.exists() {
            return Err("A file already exists at that path.".into());
        }
        let flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE;
        Self::configure(
            Connection::open_with_flags(path, flags).map_err(text)?,
            path,
        )
    }

    pub fn open(path: &Path) -> Result<Self, String> {
        check_extension(path)?;
        if !path.is_file() {
            return Err("There's no project file at that path.".into());
        }
        let flags = OpenFlags::SQLITE_OPEN_READ_WRITE;
        Self::configure(
            Connection::open_with_flags(path, flags).map_err(text)?,
            path,
        )
    }

    fn configure(conn: Connection, path: &Path) -> Result<Self, String> {
        // The rollback journal, not WAL: WAL keeps -wal and -shm files beside the project, and Dropbox or email can
        // split them from it. This is also the first read of the file, so it's where a non-SQLite file fails.
        let mode: String = conn
            .pragma_update_and_check(None, "journal_mode", "DELETE", |row| row.get(0))
            .map_err(|error| match error.sqlite_error_code() {
                Some(rusqlite::ErrorCode::NotADatabase) => {
                    "This file isn't a Storiiboard project.".to_string()
                }
                _ => text(error),
            })?;
        if !mode.eq_ignore_ascii_case("delete") {
            return Err(format!(
                "Couldn't set the project's journal mode (got {mode})."
            ));
        }
        // FULL syncs every commit, so an acknowledged edit survives a crash or a power cut. On a Mac, plain fsync
        // leaves the data in the drive's cache; fullfsync flushes it. It does nothing on other systems.
        conn.pragma_update(None, "synchronous", "FULL")
            .map_err(text)?;
        conn.pragma_update(None, "fullfsync", "ON").map_err(text)?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(text)?;
        Ok(Self {
            conn,
            path: path.to_path_buf(),
        })
    }

    /// Runs every statement in one transaction: all of them land, or none do.
    pub fn tx(&mut self, statements: &[Statement]) -> Result<Vec<usize>, String> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(text)?;
        let mut changes = Vec::with_capacity(statements.len());
        for statement in statements {
            let params = to_sql(&statement.params)?;
            changes.push(
                tx.execute(&statement.sql, params_from_iter(params.iter()))
                    .map_err(text)?,
            );
        }
        // Dropping an uncommitted transaction rolls it back, which is what an early return above relies on.
        tx.commit().map_err(text)?;
        Ok(changes)
    }

    pub fn query(&self, sql: &str, params: &[Json]) -> Result<Vec<Row>, String> {
        let params = to_sql(params)?;
        let mut statement = self.conn.prepare(sql).map_err(text)?;
        let names: Vec<String> = statement
            .column_names()
            .iter()
            .map(|name| name.to_string())
            .collect();
        let mut rows = statement
            .query(params_from_iter(params.iter()))
            .map_err(text)?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(text)? {
            let mut map = Map::new();
            for (i, name) in names.iter().enumerate() {
                map.insert(name.clone(), to_json(row.get_ref(i).map_err(text)?)?);
            }
            out.push(map);
        }
        Ok(out)
    }

    /// Writes a consistent copy of the open project with VACUUM INTO, which is safe while the project is in use; a
    /// raw file copy isn't. Only the file name comes from the caller, and it must be one of this project's own
    /// backup names, so a copy can never land anywhere else or overwrite anything.
    pub fn backup(&self, kind: BackupKind, file_name: &str) -> Result<PathBuf, String> {
        let dest = match kind {
            BackupKind::Scheduled => {
                if !is_backup_name(self.stem()?, file_name) {
                    return Err(format!(
                        "\"{file_name}\" isn't a backup name for this project."
                    ));
                }
                let dir = self.backups_dir()?;
                fs::create_dir_all(&dir).map_err(text)?;
                dir.join(file_name)
            }
            BackupKind::Migration => {
                if !is_migration_backup_name(self.file_name()?, file_name) {
                    return Err(format!(
                        "\"{file_name}\" isn't a migration backup name for this project."
                    ));
                }
                self.dir()?.join(file_name)
            }
        };
        if dest.exists() {
            return Err(format!("A backup named \"{file_name}\" already exists."));
        }
        let dest_text = dest.to_str().ok_or("The backup path isn't valid text.")?;
        self.conn
            .execute("VACUUM INTO ?1", [dest_text])
            .map_err(text)?;
        Ok(dest)
    }

    /// This project's scheduled backups, by file name. Other files in the folder are left out.
    pub fn backups(&self) -> Result<Vec<String>, String> {
        let dir = self.backups_dir()?;
        if !dir.is_dir() {
            return Ok(Vec::new());
        }
        let stem = self.stem()?;
        let mut names: Vec<String> = fs::read_dir(&dir)
            .map_err(text)?
            .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
            .filter(|name| is_backup_name(stem, name))
            .collect();
        names.sort();
        Ok(names)
    }

    /// Pruning goes through here, so it can only ever delete this project's own scheduled backups.
    pub fn delete_backup(&self, file_name: &str) -> Result<(), String> {
        if !is_backup_name(self.stem()?, file_name) {
            return Err(format!(
                "\"{file_name}\" isn't a backup name for this project."
            ));
        }
        fs::remove_file(self.backups_dir()?.join(file_name)).map_err(text)
    }

    fn dir(&self) -> Result<&Path, String> {
        self.path
            .parent()
            .ok_or_else(|| "The project has no folder.".to_string())
    }

    fn backups_dir(&self) -> Result<PathBuf, String> {
        Ok(self.dir()?.join("Backups"))
    }

    fn file_name(&self) -> Result<&str, String> {
        self.path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "The project's file name isn't valid text.".to_string())
    }

    fn stem(&self) -> Result<&str, String> {
        self.path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .ok_or_else(|| "The project's file name isn't valid text.".to_string())
    }
}

fn check_extension(path: &Path) -> Result<(), String> {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("sbd") => Ok(()),
        _ => Err("A Storiiboard project file ends in .sbd.".into()),
    }
}

/// `<Project> YYYY-MM-DD HH-mm.sbd`, where `<Project>` is the .sbd's name without the extension. src/core/storage/
/// backups.ts makes these names; this check is the guard that keeps a bug there from touching other files.
pub fn is_backup_name(stem: &str, name: &str) -> bool {
    name.strip_prefix(stem)
        .and_then(|rest| rest.strip_prefix(' '))
        .and_then(|rest| rest.strip_suffix(".sbd"))
        .is_some_and(is_stamp)
}

/// `<name>.sbd.bak-v<from>-YYYY-MM-DD HH-mm`, made before a migration.
pub fn is_migration_backup_name(file_name: &str, name: &str) -> bool {
    let Some(rest) = name
        .strip_prefix(file_name)
        .and_then(|rest| rest.strip_prefix(".bak-v"))
    else {
        return false;
    };
    let Some((version, stamp)) = rest.split_once('-') else {
        return false;
    };
    !version.is_empty() && version.bytes().all(|b| b.is_ascii_digit()) && is_stamp(stamp)
}

/// `YYYY-MM-DD HH-mm`
fn is_stamp(stamp: &str) -> bool {
    stamp.len() == 16
        && stamp.bytes().enumerate().all(|(i, b)| match i {
            4 | 7 | 13 => b == b'-',
            10 => b == b' ',
            _ => b.is_ascii_digit(),
        })
}

fn to_sql(params: &[Json]) -> Result<Vec<Value>, String> {
    params
        .iter()
        .map(|param| match param {
            Json::Null => Ok(Value::Null),
            Json::Bool(b) => Ok(Value::Integer(i64::from(*b))),
            Json::Number(n) => n
                .as_i64()
                .map(Value::Integer)
                .or_else(|| n.as_f64().map(Value::Real))
                .ok_or_else(|| format!("{n} doesn't fit in a SQLite number.")),
            Json::String(s) => Ok(Value::Text(s.clone())),
            Json::Array(_) | Json::Object(_) => Err("Pass objects and arrays as JSON text.".into()),
        })
        .collect()
}

fn to_json(value: ValueRef<'_>) -> Result<Json, String> {
    match value {
        ValueRef::Null => Ok(Json::Null),
        ValueRef::Integer(i) => Ok(Json::from(i)),
        ValueRef::Real(f) => Number::from_f64(f)
            .map(Json::Number)
            .ok_or_else(|| "A stored number isn't finite.".to_string()),
        ValueRef::Text(bytes) => String::from_utf8(bytes.to_vec())
            .map(Json::String)
            .map_err(|_| "Stored text isn't valid UTF-8.".to_string()),
        // Schema v1 stores no images; raw bytes get their own path with the media tables (schema 2).
        ValueRef::Blob(_) => Err("Binary values aren't supported yet.".into()),
    }
}

fn text(error: impl std::fmt::Display) -> String {
    error.to_string()
}

/// The open projects, by a handle the UI holds. A handle is a plain number, so the UI never sees a connection.
#[derive(Default)]
pub struct OpenFiles(Mutex<Files>);

#[derive(Default)]
struct Files {
    next: u32,
    open: HashMap<u32, SbdFile>,
}

impl OpenFiles {
    fn add(&self, file: SbdFile) -> Result<u32, String> {
        let mut files = self
            .0
            .lock()
            .map_err(|_| "Project storage is unavailable.")?;
        files.next += 1;
        let handle = files.next;
        files.open.insert(handle, file);
        Ok(handle)
    }

    fn with<T>(
        &self,
        handle: u32,
        run: impl FnOnce(&mut SbdFile) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut files = self
            .0
            .lock()
            .map_err(|_| "Project storage is unavailable.")?;
        let file = files
            .open
            .get_mut(&handle)
            .ok_or("That project isn't open.")?;
        run(file)
    }
}

// The commands are async so a slow disk or a large backup never blocks the window's main thread.

#[tauri::command]
pub async fn sbd_create(files: State<'_, OpenFiles>, path: String) -> Result<u32, String> {
    files.add(SbdFile::create(Path::new(&path))?)
}

#[tauri::command]
pub async fn sbd_open(files: State<'_, OpenFiles>, path: String) -> Result<u32, String> {
    files.add(SbdFile::open(Path::new(&path))?)
}

#[tauri::command]
pub async fn sbd_close(files: State<'_, OpenFiles>, handle: u32) -> Result<(), String> {
    let mut files = files
        .0
        .lock()
        .map_err(|_| "Project storage is unavailable.")?;
    // Dropping the connection closes the file.
    files.open.remove(&handle);
    Ok(())
}

#[tauri::command]
pub async fn sbd_tx(
    files: State<'_, OpenFiles>,
    handle: u32,
    statements: Vec<Statement>,
) -> Result<Vec<usize>, String> {
    files.with(handle, |file| file.tx(&statements))
}

#[tauri::command]
pub async fn sbd_query(
    files: State<'_, OpenFiles>,
    handle: u32,
    sql: String,
    params: Vec<Json>,
) -> Result<Vec<Row>, String> {
    files.with(handle, |file| file.query(&sql, &params))
}

#[tauri::command]
pub async fn sbd_backup(
    files: State<'_, OpenFiles>,
    handle: u32,
    kind: BackupKind,
    file_name: String,
) -> Result<(), String> {
    files.with(handle, |file| file.backup(kind, &file_name).map(|_| ()))
}

#[tauri::command]
pub async fn sbd_backups(files: State<'_, OpenFiles>, handle: u32) -> Result<Vec<String>, String> {
    files.with(handle, |file| file.backups())
}

#[tauri::command]
pub async fn sbd_delete_backup(
    files: State<'_, OpenFiles>,
    handle: u32,
    file_name: String,
) -> Result<(), String> {
    files.with(handle, |file| file.delete_backup(&file_name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::process::{Command, Stdio};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("sbd-{tag}-{}-{nanos}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn statement(sql: &str, params: Vec<Json>) -> Statement {
        Statement {
            sql: sql.into(),
            params,
        }
    }

    fn new_file(dir: &Path, name: &str) -> SbdFile {
        let mut file = SbdFile::create(&dir.join(name)).unwrap();
        file.tx(&[statement(
            "CREATE TABLE shots (id TEXT PRIMARY KEY, lens INTEGER)",
            vec![],
        )])
        .unwrap();
        file
    }

    #[test]
    fn create_refuses_an_existing_file_and_open_a_missing_one() {
        let dir = temp_dir("create");
        let path = dir.join("Bey County.sbd");
        drop(SbdFile::create(&path).unwrap());
        assert!(SbdFile::create(&path).is_err());
        assert!(SbdFile::open(&dir.join("Missing.sbd")).is_err());
        assert!(SbdFile::create(&dir.join("notes.txt")).is_err());
    }

    #[test]
    fn open_refuses_a_file_that_isnt_sqlite() {
        let dir = temp_dir("not-db");
        let path = dir.join("Fake.sbd");
        fs::write(
            &path,
            "this is not a database, just some text that is long enough",
        )
        .unwrap();
        let error = SbdFile::open(&path).err().unwrap();
        assert_eq!(error, "This file isn't a Storiiboard project.");
    }

    #[test]
    fn sets_the_journal_and_sync_modes() {
        let dir = temp_dir("pragmas");
        let file = new_file(&dir, "Pragmas.sbd");
        let row = |sql: &str| file.query(sql, &[]).unwrap().remove(0);
        assert_eq!(row("PRAGMA journal_mode")["journal_mode"], "delete");
        assert_eq!(row("PRAGMA synchronous")["synchronous"], 2);
        assert_eq!(row("PRAGMA foreign_keys")["foreign_keys"], 1);
    }

    #[test]
    fn a_batch_lands_whole_or_not_at_all() {
        let dir = temp_dir("tx");
        let mut file = new_file(&dir, "Tx.sbd");
        let insert = "INSERT INTO shots (id, lens) VALUES (?, ?)";
        file.tx(&[statement(insert, vec!["1A".into(), 35.into()])])
            .unwrap();
        let failed = file.tx(&[
            statement(insert, vec!["1B".into(), 50.into()]),
            statement(insert, vec!["1A".into(), 85.into()]),
        ]);
        assert!(failed.is_err(), "the duplicate id fails the batch");
        let rows = file
            .query("SELECT id, lens FROM shots ORDER BY id", &[])
            .unwrap();
        assert_eq!(rows.len(), 1, "1B rolled back with the failed batch");
        assert_eq!(rows[0]["id"], "1A");
        assert_eq!(rows[0]["lens"], 35);
    }

    #[test]
    fn maps_values_both_ways() {
        let dir = temp_dir("values");
        let file = new_file(&dir, "Values.sbd");
        let rows = file
            .query(
                "SELECT ? AS n, ? AS f, ? AS t, ? AS z, ? AS b",
                &[
                    42.into(),
                    2.8.into(),
                    "T2.8".into(),
                    Json::Null,
                    true.into(),
                ],
            )
            .unwrap();
        assert_eq!(
            Json::Object(rows[0].clone()),
            serde_json::json!({"n": 42, "f": 2.8, "t": "T2.8", "z": null, "b": 1})
        );
        assert!(file
            .query("SELECT ?", &[serde_json::json!({"lens": 35})])
            .is_err());
        assert!(
            file.query("SELECT x'00'", &[]).is_err(),
            "no raw bytes until schema 2"
        );
    }

    #[test]
    fn backs_up_only_under_this_projects_own_names() {
        let dir = temp_dir("backup");
        let mut file = new_file(&dir, "Bey County.sbd");
        file.tx(&[statement("INSERT INTO shots VALUES ('1A', 35)", vec![])])
            .unwrap();

        let dest = file
            .backup(BackupKind::Scheduled, "Bey County 2026-11-02 14-05.sbd")
            .unwrap();
        assert_eq!(
            dest,
            dir.join("Backups").join("Bey County 2026-11-02 14-05.sbd")
        );
        let copy = SbdFile::open(&dest).unwrap();
        assert_eq!(
            copy.query("SELECT lens FROM shots", &[]).unwrap()[0]["lens"],
            35
        );
        assert!(
            file.backup(BackupKind::Scheduled, "Bey County 2026-11-02 14-05.sbd")
                .is_err(),
            "no overwrite"
        );

        for bad in [
            "Other 2026-11-02 14-05.sbd",
            "Bey County 2026-11-02.sbd",
            "../Bey County 2026-11-02 14-05.sbd",
        ] {
            assert!(file.backup(BackupKind::Scheduled, bad).is_err(), "{bad}");
        }
        let migration = file
            .backup(
                BackupKind::Migration,
                "Bey County.sbd.bak-v1-2026-11-02 14-05",
            )
            .unwrap();
        assert_eq!(
            migration,
            dir.join("Bey County.sbd.bak-v1-2026-11-02 14-05")
        );
        assert!(file
            .backup(BackupKind::Migration, "Bey County.sbd.bak-2026-11-02 14-05")
            .is_err());
    }

    #[test]
    fn lists_and_deletes_only_this_projects_backups() {
        let dir = temp_dir("prune");
        let file = new_file(&dir, "Bey.sbd");
        file.backup(BackupKind::Scheduled, "Bey 2026-11-01 09-00.sbd")
            .unwrap();
        file.backup(BackupKind::Scheduled, "Bey 2026-11-02 09-00.sbd")
            .unwrap();
        // Another project's backup and an unrelated file in the same folder.
        fs::write(
            dir.join("Backups").join("Bey County 2026-11-01 09-00.sbd"),
            "",
        )
        .unwrap();
        fs::write(dir.join("Backups").join("notes.txt"), "").unwrap();

        assert_eq!(
            file.backups().unwrap(),
            ["Bey 2026-11-01 09-00.sbd", "Bey 2026-11-02 09-00.sbd"]
        );
        file.delete_backup("Bey 2026-11-01 09-00.sbd").unwrap();
        assert!(file.delete_backup("notes.txt").is_err());
        assert!(file
            .delete_backup("Bey County 2026-11-01 09-00.sbd")
            .is_err());
        assert!(dir.join("Backups").join("notes.txt").exists());
        assert_eq!(file.backups().unwrap(), ["Bey 2026-11-02 09-00.sbd"]);
    }

    #[test]
    fn checks_backup_names() {
        assert!(is_backup_name(
            "Bey County",
            "Bey County 2026-11-02 14-05.sbd"
        ));
        assert!(!is_backup_name("Bey", "Bey County 2026-11-02 14-05.sbd"));
        assert!(!is_backup_name(
            "Bey County",
            "Bey County 2026-11-02 14-05.sbd.tmp"
        ));
        assert!(!is_backup_name(
            "Bey County",
            "Bey County 2026-11-02 14:05.sbd"
        ));
        assert!(is_migration_backup_name(
            "Bey.sbd",
            "Bey.sbd.bak-v12-2026-11-02 14-05"
        ));
        assert!(!is_migration_backup_name(
            "Bey.sbd",
            "Bey.sbd.bak-v-2026-11-02 14-05"
        ));
    }

    /// Run by `survives_a_kill_mid_write` as a separate process; it does nothing in a normal test run.
    #[test]
    fn crash_writer_child() {
        let Ok(path) = std::env::var("SBD_CRASH_CHILD") else {
            return;
        };
        let mut file = SbdFile::open(Path::new(&path)).unwrap();
        let payload = "x".repeat(4096);
        let mut out = std::io::stdout();
        // Writes until the parent kills it.
        let mut seq = 0_i64;
        loop {
            seq += 1;
            file.tx(&[statement(
                "INSERT INTO ops (seq, payload) VALUES (?, ?)",
                vec![seq.into(), payload.clone().into()],
            )])
            .unwrap();
            // Printed only once the commit has returned: every acknowledged op must survive the kill.
            writeln!(out, "ack {seq}").unwrap();
            out.flush().unwrap();
        }
    }

    #[test]
    fn survives_a_kill_mid_write() {
        let dir = temp_dir("crash");
        let path = dir.join("Crash.sbd");
        SbdFile::create(&path)
            .unwrap()
            .tx(&[statement(
                "CREATE TABLE ops (seq INTEGER PRIMARY KEY, payload TEXT NOT NULL)",
                vec![],
            )])
            .unwrap();

        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "sbd::tests::crash_writer_child",
                "--nocapture",
                "--test-threads=1",
            ])
            .env("SBD_CRASH_CHILD", &path)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let mut acked = 0_i64;
        for line in BufReader::new(child.stdout.take().unwrap()).lines() {
            if let Some(seq) = line.unwrap().strip_prefix("ack ") {
                acked = seq.parse().unwrap();
                if acked >= 200 {
                    break;
                }
            }
        }
        // SIGKILL on Mac and Linux, TerminateProcess on Windows: no chance to finish the write in progress.
        child.kill().unwrap();
        child.wait().unwrap();
        assert!(acked >= 200, "the writer stopped early, at op {acked}");

        let file = SbdFile::open(&path).unwrap();
        let check = file.query("PRAGMA integrity_check", &[]).unwrap();
        assert_eq!(check[0]["integrity_check"], "ok");
        let rows = file
            .query("SELECT count(*) AS n, max(seq) AS top FROM ops", &[])
            .unwrap();
        let (count, top) = (
            rows[0]["n"].as_i64().unwrap(),
            rows[0]["top"].as_i64().unwrap(),
        );
        assert!(
            top >= acked,
            "op {acked} was acknowledged but the file stops at {top}"
        );
        assert_eq!(count, top, "every op up to the last is there, with no gaps");
    }
}
