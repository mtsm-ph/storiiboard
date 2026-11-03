//! The .sbd project file: one SQLite database per project. This module is the only code that opens one. The UI sends
//! SQL with parameters and gets rows back; the schema and migrations live in TypeScript (src/core/storage), so the
//! MCP server can run the same ones through Node's own SQLite.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use rusqlite::types::{Value, ValueRef};
use rusqlite::{params_from_iter, Connection, OpenFlags, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value as Json};
use tauri::State;

use crate::backup::{self, Copying, Partial};
use crate::lock::{self, Holder, Lock, Machine};

/// The refusal when a sync replaced or rewrote the file while it was open. src/core/storage/driver.ts has the same
/// text, so the page can tell this apart from any other failure and reopen the new version.
pub const CHANGED_ON_DISK: &str =
    "The project file changed on disk since Storiiboard last saved it.";

/// What the file on disk looked like after this app's last write. If any of it changes, someone else wrote the file:
/// usually a sync service putting a newer version from another computer in its place.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Fingerprint {
    len: u64,
    modified: Option<SystemTime>,
    /// Device and inode, which change when a file is replaced by a rename. Windows has no stable equivalent in std,
    /// and its sync services can't rename over a file SQLite has open, so size and time cover it there.
    id: Option<(u64, u64)>,
}

fn fingerprint(path: &Path) -> Result<Fingerprint, String> {
    // A file that's gone was replaced or deleted under us: the same refusal.
    let meta = fs::metadata(path).map_err(|_| CHANGED_ON_DISK.to_string())?;
    #[cfg(unix)]
    let id = {
        use std::os::unix::fs::MetadataExt;
        Some((meta.dev(), meta.ino()))
    };
    #[cfg(not(unix))]
    let id = None;
    Ok(Fingerprint {
        len: meta.len(),
        modified: meta.modified().ok(),
        id,
    })
}

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

/// One of a project's scheduled backups, as Settings → Backups and pruning see it.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct BackupFile {
    pub name: String,
    /// The space only this backup takes (backup::own_bytes): all of a full copy, next to nothing for a fresh clone.
    pub bytes: u64,
}

/// A statement with its values bound: SQL and parameters, bytes included.
pub type Bound = (String, Vec<Value>);

pub struct SbdFile {
    /// A full backup copy being made a step at a time. Declared before `conn` so it's dropped first: SQLite's backup
    /// must end before the connection it reads from closes.
    copying: Option<Copying>,
    conn: Connection,
    path: PathBuf,
    fingerprint: Fingerprint,
    /// Held while the project is open; dropping the file drops the lock, which removes it.
    lock: Option<Lock>,
    /// Where scheduled backups go when it isn't `Backups/` beside the file: a folder on this computer, for a project
    /// in a synced folder (place_backups).
    local_backups: Option<PathBuf>,
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

    /// Copies a .sbd that isn't open here, such as a backup, to a new file, for Open backup: the person edits the
    /// copy, never the backup, which pruning may delete later. The source is opened read-only and copied with
    /// VACUUM INTO, so a copy is consistent even if another program has the source open. Refuses to overwrite.
    pub fn copy(source: &Path, dest: &Path) -> Result<(), String> {
        check_extension(source)?;
        check_extension(dest)?;
        if !source.is_file() {
            return Err("There's no project file at that path.".into());
        }
        if dest.exists() {
            return Err("A file already exists at that path.".into());
        }
        let conn =
            Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(text)?;
        let dest_text = dest.to_str().ok_or("The copy's path isn't valid text.")?;
        conn.execute("VACUUM INTO ?1", [dest_text])
            .map_err(|error| match error.sqlite_error_code() {
                Some(rusqlite::ErrorCode::NotADatabase) => {
                    "This file isn't a Storiiboard project.".into()
                }
                _ => text(error),
            })?;
        Ok(())
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
            copying: None,
            fingerprint: fingerprint(path)?,
            conn,
            path: path.to_path_buf(),
            lock: None,
            local_backups: None,
        })
    }

    /// Puts scheduled backups in `local_root/<Project> <key>/` instead of beside the project, or back beside it with
    /// None. The key comes from the file's id (meta `file_id`) and its path, so two copies of a project, even with the
    /// same name, never share a folder, and pruning never reaches the other's backups.
    pub fn place_backups(&mut self, local_root: Option<&Path>) -> Result<PathBuf, String> {
        self.local_backups = match local_root {
            None => None,
            Some(root) => {
                // A file without the id (or, in tests, without a meta table) is keyed by its path alone.
                let rows = self
                    .query("SELECT value FROM meta WHERE key = 'file_id'", &[])
                    .unwrap_or_default();
                let file_id = rows
                    .first()
                    .and_then(|row| row.get("value"))
                    .and_then(|value| value.as_str())
                    .unwrap_or_default()
                    .to_owned();
                let path = self
                    .path
                    .canonicalize()
                    .unwrap_or_else(|_| self.path.clone());
                let key = fnv1a(format!("{file_id}\n{}", path.display()).as_bytes());
                Some(root.join(format!("{} {:08x}", self.stem()?, key as u32)))
            }
        };
        self.backups_dir()
    }

    /// Writes this computer's lock next to the project (see lock.rs). Best effort: a read-only folder gets none.
    pub fn take_lock(&mut self, machine: &Machine) {
        self.lock = Lock::take(&self.path, machine, lock::now_ms());
    }

    pub fn refresh_lock(&mut self) -> Result<(), String> {
        match &mut self.lock {
            Some(lock) => lock.refresh(lock::now_ms()),
            None => Ok(()),
        }
    }

    /// Refuses to go on if the file isn't the one this app last wrote: writing to it would either land in a file a
    /// sync has already replaced (and vanish on close) or mix two computers' edits in one database.
    fn check_unchanged(&self) -> Result<(), String> {
        if fingerprint(&self.path)? == self.fingerprint {
            Ok(())
        } else {
            Err(CHANGED_ON_DISK.into())
        }
    }

    /// Runs every statement in one transaction: all of them land, or none do. First it checks that the file is still
    /// the one this app last wrote; afterwards it records the file as this write left it, even after a rollback, since
    /// SQLite may have touched the file either way.
    pub fn tx(&mut self, statements: &[Statement]) -> Result<Vec<usize>, String> {
        let bound = statements
            .iter()
            .map(|statement| Ok((statement.sql.clone(), to_sql(&statement.params)?)))
            .collect::<Result<Vec<_>, String>>()?;
        self.tx_values(&bound)
    }

    /// The same transaction, with values already bound, as `sbd_tx_raw` sends them with image bytes among them.
    pub fn tx_values(&mut self, statements: &[Bound]) -> Result<Vec<usize>, String> {
        self.check_unchanged()?;
        let result = self.run_tx(statements);
        self.fingerprint = fingerprint(&self.path)?;
        result
    }

    fn run_tx(&mut self, statements: &[Bound]) -> Result<Vec<usize>, String> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(text)?;
        let mut changes = Vec::with_capacity(statements.len());
        for (sql, params) in statements {
            changes.push(
                tx.execute(sql, params_from_iter(params.iter()))
                    .map_err(text)?,
            );
        }
        // Dropping an uncommitted transaction rolls it back, which is what an early return above relies on.
        tx.commit().map_err(text)?;
        Ok(changes)
    }

    /// The bytes in the first column of the first row, for an image or thumbnail; None when there's no such row.
    /// Kept apart from `query`, whose rows travel as JSON, which has no bytes.
    pub fn read_blob(&self, sql: &str, params: &[Json]) -> Result<Option<Vec<u8>>, String> {
        let params = to_sql(params)?;
        let mut statement = self.conn.prepare(sql).map_err(text)?;
        let mut rows = statement
            .query(params_from_iter(params.iter()))
            .map_err(text)?;
        match rows.next().map_err(text)? {
            None => Ok(None),
            Some(row) => match row.get_ref(0).map_err(text)? {
                ValueRef::Blob(bytes) => Ok(Some(bytes.to_vec())),
                ValueRef::Null => Ok(None),
                _ => Err("That column doesn't hold bytes.".into()),
            },
        }
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

    /// Starts a consistent copy of the open project. Where it can (APFS, on a Mac) it's a clone, done at once and
    /// returned; otherwise a full copy that step_backup makes a few pages at a time. A raw file copy isn't safe while
    /// SQLite has the file open, but a clone is: it's taken here, between transactions, with nothing half-written. Only
    /// the file name comes from the caller, and it must be one of this project's own backup names, so a copy can never
    /// land anywhere else or overwrite anything.
    pub fn start_backup(
        &mut self,
        kind: BackupKind,
        file_name: &str,
        clone: bool,
    ) -> Result<Option<PathBuf>, String> {
        if self.copying.is_some() {
            return Err("A backup of this project is already being made.".into());
        }
        // A copy of a file a sync has replaced would back up the old version as if it were current.
        self.check_unchanged()?;
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
        // Any failure (Windows, exFAT, another volume) falls back to a full copy.
        if clone && backup::clone_file(&self.path, &dest).is_ok() {
            return Ok(Some(dest));
        }
        self.copying = Some(Copying::start(&self.conn, &dest)?);
        Ok(None)
    }

    /// The file a full copy in progress is being written to.
    pub fn copying_path(&self) -> Option<PathBuf> {
        self.copying.as_ref()?.path().map(Path::to_path_buf)
    }

    /// Takes the next step of the full copy start_backup began. Once the copy is complete it's handed back, to be
    /// saved after letting go of the file.
    pub fn step_backup(&mut self) -> Result<Option<Partial>, String> {
        if self.copying.is_none() {
            return Err("No backup of this project is being made.".into());
        }
        // The rest of a copy would come from a file a sync has since replaced. Dropping the copy deletes it.
        let step = self.check_unchanged().and_then(|()| {
            self.copying
                .as_mut()
                .map_or(Ok(false), |copying| copying.step(backup::STEP_PAGES))
        });
        match step {
            Ok(false) => Ok(None),
            Ok(true) => self.copying.take().map(Copying::end).transpose(),
            Err(error) => {
                self.copying = None;
                Err(error)
            }
        }
    }

    /// A whole backup in one go, holding the file throughout, for tests. The app goes through back_up, which lets go
    /// of the file between steps.
    #[cfg(test)]
    pub fn backup(&mut self, kind: BackupKind, file_name: &str) -> Result<PathBuf, String> {
        if let Some(dest) = self.start_backup(kind, file_name, true)? {
            return Ok(dest);
        }
        loop {
            if let Some(partial) = self.step_backup()? {
                return partial.save();
            }
        }
    }

    /// This project's scheduled backups, by file name, with the space each takes. Other files in the folder, and
    /// copies still being made, are left out.
    pub fn backups(&self) -> Result<Vec<BackupFile>, String> {
        let dir = self.backups_dir()?;
        if !dir.is_dir() {
            return Ok(Vec::new());
        }
        let stem = self.stem()?;
        let mut found: Vec<BackupFile> = fs::read_dir(&dir)
            .map_err(text)?
            .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
            .filter(|name| is_backup_name(stem, name))
            .filter_map(|name| {
                // A backup deleted between the listing and here is simply not there.
                let bytes = backup::own_bytes(&dir.join(&name)).ok()?;
                Some(BackupFile { name, bytes })
            })
            .collect();
        found.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(found)
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

    pub fn backups_dir(&self) -> Result<PathBuf, String> {
        match &self.local_backups {
            Some(dir) => Ok(dir.clone()),
            None => Ok(self.dir()?.join("Backups")),
        }
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

/// FNV-1a, spelled out here because the folder names it makes must never change; std's hasher may between releases.
fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x0000_0100_0000_01b3)
    })
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
        // Query rows travel as JSON, which would make an image four times its size; bytes come back through
        // sbd_read_blob as a raw response instead.
        ValueRef::Blob(_) => Err("A query can't return bytes; read them with readBlob.".into()),
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
    /// Closes every open project, which removes their lock files. Quitting ends the process without running the
    /// page's close, so the app calls this on exit; otherwise another computer would see the project as still open.
    pub fn close_all(&self) {
        if let Ok(mut files) = self.0.lock() {
            files.open.clear();
        }
    }

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
pub async fn sbd_create(
    files: State<'_, OpenFiles>,
    machine: State<'_, Machine>,
    path: String,
) -> Result<u32, String> {
    let mut file = SbdFile::create(Path::new(&path))?;
    file.take_lock(&machine);
    files.add(file)
}

#[tauri::command]
pub async fn sbd_open(
    files: State<'_, OpenFiles>,
    machine: State<'_, Machine>,
    path: String,
) -> Result<u32, String> {
    let mut file = SbdFile::open(Path::new(&path))?;
    file.take_lock(&machine);
    files.add(file)
}

/// Another computer that has this project open now, asked before opening it (null when none does).
#[tauri::command]
pub async fn sbd_lock_holder(
    machine: State<'_, Machine>,
    path: String,
) -> Result<Option<Holder>, String> {
    Ok(lock::holder(Path::new(&path), &machine, lock::now_ms()))
}

/// Decides where this project's scheduled backups go and returns the folder. A project in a synced folder keeps them
/// in the app's data folder on this computer, unless the person's setting keeps them next to the project
/// (docs/PLAN.md, F). Only the yes or no comes from the page; the folder is worked out here.
#[tauri::command]
pub async fn sbd_place_backups(
    app: tauri::AppHandle,
    files: State<'_, OpenFiles>,
    handle: u32,
    next_to_project: bool,
) -> Result<String, String> {
    use tauri::Manager;
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    let local_root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("Backups");
    files.with(handle, |file| {
        let synced = crate::synced::service(&file.path, &home).is_some();
        let root = (synced && !next_to_project).then_some(local_root.as_path());
        let dir = file.place_backups(root)?;
        dir.to_str()
            .map(str::to_owned)
            .ok_or_else(|| "The backups folder's path isn't valid text.".into())
    })
}

/// The folder this project's backups go to.
#[tauri::command]
pub async fn sbd_backups_folder(
    files: State<'_, OpenFiles>,
    handle: u32,
) -> Result<String, String> {
    files.with(handle, |file| {
        file.backups_dir()?
            .to_str()
            .map(str::to_owned)
            .ok_or_else(|| "The backups folder's path isn't valid text.".into())
    })
}

/// Show backups: opens the backups folder in Finder or Explorer, making it first if no backup has been made yet.
#[tauri::command]
pub async fn sbd_show_backups(files: State<'_, OpenFiles>, handle: u32) -> Result<(), String> {
    let dir = files.with(handle, |file| file.backups_dir())?;
    fs::create_dir_all(&dir).map_err(text)?;
    let opener = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(windows) {
        "explorer"
    } else {
        "xdg-open"
    };
    std::process::Command::new(opener)
        .arg(&dir)
        .spawn()
        .map(|_| ())
        .map_err(text)
}

#[tauri::command]
pub async fn sbd_lock_refresh(files: State<'_, OpenFiles>, handle: u32) -> Result<(), String> {
    files.with(handle, |file| file.refresh_lock())
}

#[tauri::command]
pub async fn sbd_copy(source: String, dest: String) -> Result<(), String> {
    SbdFile::copy(Path::new(&source), Path::new(&dest))
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

/// One transaction whose parameters can include bytes (images, thumbnails), sent raw rather than as JSON.
/// The body is a 4-byte big-endian length, then that many bytes of JSON header, then every blob back to back:
/// `{ "handle": 3, "statements": [{ "sql": "…", "params": [1, "a", { "$blob": [0, 51234] }] }] }`, where
/// `[offset, length]` locate a blob after the header.
#[tauri::command]
pub async fn sbd_tx_raw(
    files: State<'_, OpenFiles>,
    request: tauri::ipc::Request<'_>,
) -> Result<Vec<usize>, String> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err("Expected the transaction as raw bytes.".into());
    };
    let (handle, statements) = parse_raw_tx(body)?;
    files.with(handle, |file| file.tx_values(&statements))
}

#[derive(Deserialize)]
struct RawTx {
    handle: u32,
    statements: Vec<Statement>,
}

/// Unpacks `sbd_tx_raw`'s body (above) into bound statements.
fn parse_raw_tx(body: &[u8]) -> Result<(u32, Vec<Bound>), String> {
    let bad = || "The transaction's bytes are malformed.".to_string();
    let length = u32::from_be_bytes(
        body.get(..4)
            .ok_or_else(bad)?
            .try_into()
            .map_err(|_| bad())?,
    ) as usize;
    let header = body.get(4..4 + length).ok_or_else(bad)?;
    let blobs = &body[4 + length..];
    let raw: RawTx = serde_json::from_slice(header).map_err(text)?;
    let statements = raw
        .statements
        .into_iter()
        .map(|statement| {
            let params = statement
                .params
                .iter()
                .map(
                    |param| match param.get("$blob").and_then(|b| b.as_array()) {
                        Some(range) => {
                            let at = |i: usize| {
                                range.get(i).and_then(|v| v.as_u64()).map(|n| n as usize)
                            };
                            let (offset, size) = (at(0).ok_or_else(bad)?, at(1).ok_or_else(bad)?);
                            let bytes = blobs.get(offset..offset + size).ok_or_else(bad)?;
                            Ok(Value::Blob(bytes.to_vec()))
                        }
                        None => to_sql(std::slice::from_ref(param)).map(|mut v| v.remove(0)),
                    },
                )
                .collect::<Result<Vec<_>, String>>()?;
            Ok((statement.sql, params))
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok((raw.handle, statements))
}

/// An image or thumbnail's bytes, raw (an ArrayBuffer on the page). Empty when there's no such row, which the page
/// reads as "not in this project".
#[tauri::command]
pub async fn sbd_read_blob(
    files: State<'_, OpenFiles>,
    handle: u32,
    sql: String,
    params: Vec<Json>,
) -> Result<tauri::ipc::Response, String> {
    let bytes = files.with(handle, |file| file.read_blob(&sql, &params))?;
    Ok(tauri::ipc::Response::new(bytes.unwrap_or_default()))
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

/// Makes a backup of an open project. A clone is done at once. A full copy takes the files' lock for one step at a time
/// and lets go between steps, so an edit waits for a step, never the whole copy (over a second at 1000 frames).
/// Returns whether it cloned.
fn back_up(
    files: &OpenFiles,
    handle: u32,
    kind: BackupKind,
    file_name: &str,
    clone: bool,
) -> Result<bool, String> {
    if files
        .with(handle, |file| file.start_backup(kind, file_name, clone))?
        .is_some()
    {
        return Ok(true);
    }
    let written = files
        .with(handle, |file| Ok(file.copying_path()))?
        .and_then(|path| fs::OpenOptions::new().write(true).open(path).ok());
    loop {
        // Closing the project mid-copy drops the copy, and this then stops with "That project isn't open."
        if let Some(partial) = files.with(handle, |file| file.step_backup())? {
            // Closed first: Windows won't rename a file that's open.
            drop(written);
            partial.save()?;
            return Ok(false);
        }
        if let Some(written) = &written {
            backup::flush(written);
        }
        std::thread::sleep(backup::STEP_PAUSE);
    }
}

#[tauri::command]
pub async fn sbd_backup(
    app: tauri::AppHandle,
    handle: u32,
    kind: BackupKind,
    file_name: String,
) -> Result<(), String> {
    use tauri::Manager;
    // On a thread of its own, since a full copy sleeps between steps.
    tauri::async_runtime::spawn_blocking(move || {
        back_up(&app.state::<OpenFiles>(), handle, kind, &file_name, true).map(|_| ())
    })
    .await
    .map_err(text)?
}

#[tauri::command]
pub async fn sbd_backups(
    files: State<'_, OpenFiles>,
    handle: u32,
) -> Result<Vec<BackupFile>, String> {
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

    fn names(file: &SbdFile) -> Vec<String> {
        file.backups()
            .unwrap()
            .into_iter()
            .map(|backup| backup.name)
            .collect()
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
    fn stores_and_reads_back_image_bytes_sent_raw() {
        let dir = temp_dir("blobs");
        let mut file = new_file(&dir, "Bey County.sbd");
        file.tx(&[statement(
            "CREATE TABLE media_files (sha256 TEXT PRIMARY KEY, bytes BLOB NOT NULL)",
            vec![],
        )])
        .unwrap();
        // The body the page sends: header length, header, then the bytes.
        let picture: Vec<u8> = (0..=255)
            .cycle()
            .take(70_000)
            .map(|b: u32| b as u8)
            .collect();
        let header = serde_json::json!({
            "handle": 1,
            "statements": [{
                "sql": "INSERT INTO media_files (sha256, bytes) VALUES (?1, ?2)",
                "params": ["abc", { "$blob": [0, picture.len()] }]
            }]
        })
        .to_string();
        let mut body = (header.len() as u32).to_be_bytes().to_vec();
        body.extend_from_slice(header.as_bytes());
        body.extend_from_slice(&picture);

        let (handle, statements) = parse_raw_tx(&body).unwrap();
        assert_eq!(handle, 1);
        file.tx_values(&statements).unwrap();
        let read = file
            .read_blob(
                "SELECT bytes FROM media_files WHERE sha256 = ?1",
                &[Json::from("abc")],
            )
            .unwrap();
        assert_eq!(read, Some(picture));
        assert_eq!(
            file.read_blob(
                "SELECT bytes FROM media_files WHERE sha256 = ?1",
                &[Json::from("none")]
            )
            .unwrap(),
            None
        );
        // A header that points past the bytes is refused, not read out of bounds.
        let mut short = body.clone();
        short.truncate(body.len() - 10);
        assert!(parse_raw_tx(&short).is_err());
    }

    #[test]
    fn keeps_writing_through_its_own_edits() {
        let dir = temp_dir("own-writes");
        let mut file = new_file(&dir, "Bey County.sbd");
        for lens in [24, 35, 50, 85] {
            file.tx(&[statement(
                "INSERT INTO shots VALUES (?1, ?2)",
                vec![Json::from(format!("4-{lens}")), Json::from(lens)],
            )])
            .unwrap();
        }
        // A failed transaction is ours too: the next one still goes through.
        assert!(file
            .tx(&[statement("INSERT INTO nowhere VALUES (1)", vec![])])
            .is_err());
        file.tx(&[statement("DELETE FROM shots WHERE lens = 24", vec![])])
            .unwrap();
    }

    #[test]
    fn stops_writing_when_a_sync_puts_another_file_in_its_place() {
        let dir = temp_dir("replaced");
        let mut file = new_file(&dir, "Bey County.sbd");
        // The way sync services deliver a newer version: write it beside the file, then rename it over.
        drop(new_file(&dir, "incoming.sbd"));
        fs::rename(dir.join("incoming.sbd"), dir.join("Bey County.sbd")).unwrap();

        let error = file
            .tx(&[statement("INSERT INTO shots VALUES ('4A', 35)", vec![])])
            .err()
            .unwrap();
        assert_eq!(error, CHANGED_ON_DISK);
        assert_eq!(
            file.backup(BackupKind::Scheduled, "Bey County 2026-11-03 09-00.sbd")
                .err()
                .unwrap(),
            CHANGED_ON_DISK
        );
    }

    #[test]
    fn stops_writing_when_something_else_rewrites_the_file() {
        let dir = temp_dir("rewritten");
        let mut file = new_file(&dir, "Pilot.sbd");
        let mut other = fs::OpenOptions::new()
            .append(true)
            .open(dir.join("Pilot.sbd"))
            .unwrap();
        other.write_all(&[0; 4096]).unwrap();
        drop(other);
        assert_eq!(
            file.tx(&[statement("INSERT INTO shots VALUES ('1A', 50)", vec![])])
                .err()
                .unwrap(),
            CHANGED_ON_DISK
        );
    }

    #[test]
    fn stops_writing_when_the_file_is_gone() {
        let dir = temp_dir("gone");
        let mut file = new_file(&dir, "Pilot.sbd");
        fs::remove_file(dir.join("Pilot.sbd")).unwrap();
        assert_eq!(
            file.tx(&[statement("INSERT INTO shots VALUES ('1A', 50)", vec![])])
                .err()
                .unwrap(),
            CHANGED_ON_DISK
        );
    }

    #[test]
    fn keeps_backups_of_a_synced_project_in_a_local_folder_of_its_own() {
        let dir = temp_dir("local-backups");
        let local = dir.join("app data").join("Backups");
        fs::create_dir_all(dir.join("Dropbox")).unwrap();
        fs::create_dir_all(dir.join("Desk")).unwrap();
        let mut first = new_file(&dir.join("Dropbox"), "Bey County.sbd");
        let mut copy = new_file(&dir.join("Desk"), "Bey County.sbd");

        let first_dir = first.place_backups(Some(&local)).unwrap();
        let copy_dir = copy.place_backups(Some(&local)).unwrap();
        // Same name, different files: separate folders, so pruning one never deletes the other's backups.
        assert_ne!(first_dir, copy_dir);
        assert!(first_dir.starts_with(&local));
        assert!(first_dir
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .starts_with("Bey County "));
        // The same file always gets the same folder.
        assert_eq!(first.place_backups(Some(&local)).unwrap(), first_dir);

        first
            .backup(BackupKind::Scheduled, "Bey County 2026-11-03 09-00.sbd")
            .unwrap();
        assert!(first_dir.join("Bey County 2026-11-03 09-00.sbd").is_file());
        assert_eq!(names(&first), vec!["Bey County 2026-11-03 09-00.sbd"]);
        assert!(copy.backups().unwrap().is_empty());
        first
            .delete_backup("Bey County 2026-11-03 09-00.sbd")
            .unwrap();

        // Back beside the project when the person's setting asks for it.
        assert_eq!(
            first.place_backups(None).unwrap(),
            dir.join("Dropbox").join("Backups")
        );
    }

    #[test]
    fn names_local_backup_folders_the_same_on_every_build() {
        assert_eq!(fnv1a(b""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(fnv1a(b"a"), 0xaf63_dc4c_8601_ec8c);
    }

    #[test]
    fn locks_the_project_while_it_is_open() {
        let dir = temp_dir("lock");
        let laptop = Machine {
            id: "laptop".into(),
            name: "Kevin's MacBook Pro".into(),
        };
        let studio = Machine {
            id: "studio".into(),
            name: "Studio iMac".into(),
        };
        let path = dir.join("Bey County.sbd");
        let mut file = SbdFile::create(&path).unwrap();
        file.take_lock(&studio);
        let holder = lock::holder(&path, &laptop, lock::now_ms()).unwrap();
        assert_eq!(holder.computer, "Studio iMac");
        drop(file);
        assert_eq!(lock::holder(&path, &laptop, lock::now_ms()), None);
    }

    #[test]
    fn copies_a_closed_project_to_a_new_file_and_never_overwrites() {
        let dir = temp_dir("copy");
        let mut file = new_file(&dir, "Bey County 2026-11-02 14-05.sbd");
        file.tx(&[statement(
            "INSERT INTO shots VALUES (?1, ?2)",
            vec![Json::from("4A"), Json::from(85)],
        )])
        .unwrap();
        drop(file);

        let source = dir.join("Bey County 2026-11-02 14-05.sbd");
        let dest = dir.join("Restored.sbd");
        SbdFile::copy(&source, &dest).unwrap();
        let copy = SbdFile::open(&dest).unwrap();
        assert_eq!(
            copy.query("SELECT lens FROM shots", &[]).unwrap()[0]["lens"],
            85
        );

        assert_eq!(
            SbdFile::copy(&source, &dest).err().unwrap(),
            "A file already exists at that path."
        );
        assert!(SbdFile::copy(&source, &dir.join("notes.txt")).is_err());
        assert!(SbdFile::copy(&dir.join("Missing.sbd"), &dir.join("Other.sbd")).is_err());
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

    /// A file of about `megabytes` MB, so a full copy of it takes more than one step.
    fn large_file(dir: &Path, name: &str, megabytes: usize) -> SbdFile {
        let mut file = new_file(dir, name);
        let picture: Vec<u8> = (0..1_000_000_u32).map(|i| (i % 251) as u8).collect();
        file.tx(&[statement(
            "CREATE TABLE pictures (id INTEGER PRIMARY KEY, bytes BLOB)",
            vec![],
        )])
        .unwrap();
        let rows: Vec<Bound> = (0..megabytes)
            .map(|_| {
                (
                    "INSERT INTO pictures (bytes) VALUES (?)".to_string(),
                    vec![Value::Blob(picture.clone())],
                )
            })
            .collect();
        file.tx_values(&rows).unwrap();
        file
    }

    #[test]
    fn makes_a_full_copy_a_step_at_a_time_and_keeps_edits_made_between_steps() {
        let dir = temp_dir("steps");
        let mut file = large_file(&dir, "Bey.sbd", 12);
        let name = "Bey 2026-11-03 09-00.sbd";
        let dest = dir.join("Backups").join(name);
        assert_eq!(
            file.start_backup(BackupKind::Scheduled, name, false)
                .unwrap(),
            None
        );
        assert!(file
            .start_backup(BackupKind::Scheduled, "Bey 2026-11-03 09-05.sbd", false)
            .is_err());
        assert!(file.step_backup().unwrap().is_none());
        // Mid-copy: written under its partial name, so it isn't a backup yet.
        assert!(backup::partial_path(&dest).exists());
        assert!(names(&file).is_empty());
        file.tx(&[statement("INSERT INTO shots VALUES ('1B', 50)", vec![])])
            .unwrap();
        let done = loop {
            if let Some(partial) = file.step_backup().unwrap() {
                break partial;
            }
        };
        assert!(names(&file).is_empty(), "not a backup until it's saved");
        assert_eq!(done.save().unwrap(), dest);
        assert!(!backup::partial_path(&dest).exists());
        assert_eq!(names(&file), [name]);
        let backup = file.backups().unwrap().remove(0);
        assert!(backup.bytes > 12_000_000, "a full copy counts in full");

        let copy = SbdFile::open(&dest).unwrap();
        assert_eq!(
            copy.query("PRAGMA integrity_check", &[]).unwrap()[0]["integrity_check"],
            "ok"
        );
        assert_eq!(
            copy.query("SELECT lens FROM shots WHERE id = '1B'", &[])
                .unwrap()[0]["lens"],
            50,
            "the edit made between steps is in the copy"
        );
        assert!(file.step_backup().is_err(), "nothing left to step");
    }

    #[test]
    fn deletes_a_copy_cut_off_by_closing_the_project_or_by_a_sync() {
        let dir = temp_dir("cut-off");
        let mut file = large_file(&dir, "Bey.sbd", 6);
        let partial = backup::partial_path(&dir.join("Backups").join("Bey 2026-11-03 09-00.sbd"));
        file.start_backup(BackupKind::Scheduled, "Bey 2026-11-03 09-00.sbd", false)
            .unwrap();
        file.step_backup().unwrap();
        assert!(partial.exists());
        drop(file);
        assert!(!partial.exists(), "closing mid-copy leaves nothing behind");

        let mut file = SbdFile::open(&dir.join("Bey.sbd")).unwrap();
        file.start_backup(BackupKind::Scheduled, "Bey 2026-11-03 09-00.sbd", false)
            .unwrap();
        file.step_backup().unwrap();
        drop(new_file(&dir, "incoming.sbd"));
        fs::rename(dir.join("incoming.sbd"), dir.join("Bey.sbd")).unwrap();
        assert_eq!(file.step_backup().err().unwrap(), CHANGED_ON_DISK);
        assert!(!partial.exists());
        assert!(names(&file).is_empty());
    }

    #[test]
    fn backs_up_through_the_open_files_and_clones_where_it_can() {
        let dir = temp_dir("open-files");
        let files = OpenFiles::default();
        let handle = files.add(large_file(&dir, "Bey.sbd", 6)).unwrap();
        let cloned = back_up(
            &files,
            handle,
            BackupKind::Scheduled,
            "Bey 2026-11-03 09-00.sbd",
            true,
        )
        .unwrap();
        // The temp folder is on APFS on a Mac; nowhere else can clone.
        assert_eq!(cloned, cfg!(target_os = "macos"));
        assert!(!back_up(
            &files,
            handle,
            BackupKind::Scheduled,
            "Bey 2026-11-03 09-05.sbd",
            false
        )
        .unwrap());
        let listed = files.with(handle, |file| file.backups()).unwrap();
        assert_eq!(listed.len(), 2);
        if cloned {
            assert!(
                listed[0].bytes < 1_000_000,
                "a fresh clone takes next to nothing"
            );
        }
        assert!(listed[1].bytes > 6_000_000);
    }

    /// A measurement, not run by default (Kevin, Nov 3: a backup must never hold up an edit more than about 100 ms):
    /// `cargo test --release --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture holds_up`
    /// Builds a 1000-frame project, about 613 KB of picture a frame (docs/PLAN.md, as built in 1.10), and times an edit
    /// made every 5 ms while each kind of backup runs as the app runs it.
    #[test]
    #[ignore = "writes 1.2 GB and takes a minute; run it by hand"]
    fn measures_how_long_a_backup_holds_up_an_edit() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::time::{Duration, Instant};

        let dir = temp_dir("holds-up");
        let mut file = new_file(&dir, "Bey County.sbd");
        file.tx(&[
            statement(
                "CREATE TABLE pictures (id INTEGER PRIMARY KEY, bytes BLOB)",
                vec![],
            ),
            statement("INSERT INTO shots VALUES ('1A', 35)", vec![]),
        ])
        .unwrap();
        // Varied bytes, as a JPEG's are.
        let picture: Vec<u8> = (0..613_000_u32)
            .map(|i| (i.wrapping_mul(2_654_435_761) >> 24) as u8)
            .collect();
        for _ in 0..100 {
            let rows: Vec<Bound> = (0..10)
                .map(|_| {
                    (
                        "INSERT INTO pictures (bytes) VALUES (?)".to_string(),
                        vec![Value::Blob(picture.clone())],
                    )
                })
                .collect();
            file.tx_values(&rows).unwrap();
        }
        let size = fs::metadata(dir.join("Bey County.sbd")).unwrap().len();
        let files = OpenFiles::default();
        let handle = files.add(file).unwrap();
        println!("project: {} MB", size / 1_000_000);

        type Run<'a> = (&'a str, &'a dyn Fn(&str));
        let runs: [Run; 3] = [
            ("clone", &|name| {
                assert!(back_up(&files, handle, BackupKind::Scheduled, name, true).unwrap());
            }),
            ("step-by-step copy", &|name| {
                assert!(!back_up(&files, handle, BackupKind::Scheduled, name, false).unwrap());
            }),
            ("VACUUM INTO (before Nov 3)", &|name| {
                let dest = dir.join("Backups").join(name);
                files
                    .with(handle, |file| {
                        file.conn
                            .execute("VACUUM INTO ?1", [dest.to_str().unwrap()])
                            .map_err(text)
                    })
                    .unwrap();
            }),
        ];
        for (minute, (label, run)) in runs.iter().enumerate() {
            if *label == "clone" && !cfg!(target_os = "macos") {
                continue;
            }
            let stop = AtomicBool::new(false);
            let (took, mut waits) = std::thread::scope(|scope| {
                let editor = scope.spawn(|| {
                    let mut waits = Vec::new();
                    let mut lens = 35_i64;
                    while !stop.load(Ordering::Relaxed) {
                        lens += 1;
                        let asked = Instant::now();
                        files
                            .with(handle, |file| {
                                file.tx(&[statement(
                                    "UPDATE shots SET lens = ?",
                                    vec![lens.into()],
                                )])
                            })
                            .unwrap();
                        waits.push(asked.elapsed());
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    waits
                });
                std::thread::sleep(Duration::from_millis(200));
                let started = Instant::now();
                run(&format!("Bey County 2026-11-03 10-{minute:02}.sbd"));
                let took = started.elapsed();
                std::thread::sleep(Duration::from_millis(200));
                stop.store(true, Ordering::Relaxed);
                (took, editor.join().unwrap())
            });
            waits.sort();
            println!(
                "{label}: backup took {took:.2?}; {} edits, median {:.1?}, longest {:.1?}",
                waits.len(),
                waits[waits.len() / 2],
                waits[waits.len() - 1]
            );
        }
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn lists_and_deletes_only_this_projects_backups() {
        let dir = temp_dir("prune");
        let mut file = new_file(&dir, "Bey.sbd");
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
            names(&file),
            ["Bey 2026-11-01 09-00.sbd", "Bey 2026-11-02 09-00.sbd"]
        );
        file.delete_backup("Bey 2026-11-01 09-00.sbd").unwrap();
        assert!(file.delete_backup("notes.txt").is_err());
        assert!(file
            .delete_backup("Bey County 2026-11-01 09-00.sbd")
            .is_err());
        assert!(dir.join("Backups").join("notes.txt").exists());
        assert_eq!(names(&file), ["Bey 2026-11-02 09-00.sbd"]);
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
