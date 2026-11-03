//! How a backup copy is made (docs/SBD_FORMAT.md, Backups). On a Mac it's an APFS clone: instant, and it shares every
//! block the project hasn't changed since, so it takes almost no space. Where a clone isn't possible (Windows, exFAT,
//! a backups folder on another volume), it's a full copy made with SQLite's online backup a few pages at a time, so an
//! edit waits for one step at most, never the whole copy (Kevin, Nov 3: no edit held up more than about 100 ms).

use std::ffi::CStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::ptr::NonNull;
use std::time::{Duration, Instant};

use rusqlite::{ffi, Connection};

/// Pages a full copy takes per step at most: 4 MB at SQLite's 4 KB pages, a few milliseconds on an SSD. The
/// measurement in sbd.rs (measures_how_long_a_backup_holds_up_an_edit) checks the longest wait an edit sees.
pub const STEP_PAGES: i32 = 1024;
/// The fewest pages a step takes, on a slow drive.
const MIN_STEP_PAGES: i32 = 32;
/// A step that takes longer than this halves the next one, so a slow external drive still lets edits in quickly.
const SLOW_STEP: Duration = Duration::from_millis(20);
/// How many steps in a row can find the project busy (another program writing to it) before the copy gives up,
/// rather than waiting for ever: about ten seconds with the pause between steps.
const MAX_BUSY_STEPS: u32 = 5000;

/// The pause between steps, so an edit waiting for the project gets it before the next step does.
pub const STEP_PAUSE: Duration = Duration::from_millis(2);

/// Clones `source` to `dest`. Only APFS can, and only within one volume; any other case fails, as does a `dest` that
/// already exists. Taken between transactions, the clone is as consistent as the file: nothing is half-written.
#[cfg(target_os = "macos")]
pub fn clone_file(source: &Path, dest: &Path) -> std::io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let source = CString::new(source.as_os_str().as_bytes())?;
    let dest = CString::new(dest.as_os_str().as_bytes())?;
    // SAFETY: both paths are NUL-terminated and outlive the call.
    if unsafe { libc::clonefile(source.as_ptr(), dest.as_ptr(), 0) } == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(not(target_os = "macos"))]
pub fn clone_file(_source: &Path, _dest: &Path) -> std::io::Result<()> {
    Err(std::io::ErrorKind::Unsupported.into())
}

/// The space only this file takes: what deleting it alone would free. A full copy's is its size. An APFS clone's is
/// the blocks no other file shares, which starts at nothing and grows with what the project changes after it. This is
/// what the 5 GB cap on a project's backups counts (backups.ts). For clones the sum is a lower bound: a block two old
/// clones still share, and the project no longer has, belongs to neither alone.
pub fn own_bytes(path: &Path) -> std::io::Result<u64> {
    let len = fs::metadata(path)?.len();
    Ok(private_size(path).map_or(len, |size| size.min(len)))
}

#[cfg(target_os = "macos")]
fn private_size(path: &Path) -> Option<u64> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let path = CString::new(path.as_os_str().as_bytes()).ok()?;
    let mut request = libc::attrlist {
        bitmapcount: libc::ATTR_BIT_MAP_COUNT,
        reserved: 0,
        // Asked for so the reply says whether the volume keeps a private size at all: exFAT, HFS+ and network shares
        // don't, and would otherwise read as zero.
        commonattr: libc::ATTR_CMN_RETURNED_ATTRS,
        volattr: 0,
        dirattr: 0,
        fileattr: 0,
        forkattr: libc::ATTR_CMNEXT_PRIVATESIZE,
    };
    // The reply: its own length (u32), the attributes that came back (five u32s, the extended ones last), then the
    // private size (off_t).
    let mut reply = [0u8; 40];
    // SAFETY: the path is NUL-terminated, and the reply buffer is as long as the length passed with it.
    let read = unsafe {
        libc::getattrlist(
            path.as_ptr(),
            (&raw mut request).cast(),
            reply.as_mut_ptr().cast(),
            reply.len(),
            libc::FSOPT_ATTR_CMN_EXTENDED,
        )
    };
    if read != 0 {
        return None;
    }
    let length = u32::from_ne_bytes(reply[0..4].try_into().ok()?) as usize;
    let returned = u32::from_ne_bytes(reply[20..24].try_into().ok()?);
    if returned & libc::ATTR_CMNEXT_PRIVATESIZE == 0 || length < 32 {
        return None;
    }
    let size = i64::from_ne_bytes(reply[24..32].try_into().ok()?);
    u64::try_from(size).ok()
}

#[cfg(not(target_os = "macos"))]
fn private_size(_path: &Path) -> Option<u64> {
    None
}

/// Pushes what a copy has written so far out to the disk, between steps and with the project let go. Every edit's
/// commit flushes the disk's own write cache, and with a copy's writes left to pile up there, that flush held one commit
/// past 100 ms in the 1000-frame measurement. On a Mac a plain fsync sends the data to the disk without flushing its
/// cache, which save() does once, at the end; elsewhere this is the system's usual sync.
pub fn flush(file: &fs::File) {
    #[cfg(target_os = "macos")]
    {
        use std::os::fd::AsRawFd;
        // SAFETY: the descriptor belongs to a file that's open for the length of the call. A failed flush only means
        // the final sync has more to do.
        unsafe { libc::fsync(file.as_raw_fd()) };
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = file.sync_data();
    }
}

/// Where a full copy is written until it's complete.
pub fn partial_path(dest: &Path) -> PathBuf {
    let mut name = dest.file_name().unwrap_or_default().to_os_string();
    name.push(".partial");
    dest.with_file_name(name)
}

/// A full copy being made. It's written to `<backup>.partial` and takes the backup's name only once it's complete and
/// on disk, so a copy cut off by a crash or a quit never passes for a backup. Edits made through the project's own
/// connection while it runs reach the copy as they're made (SQLite does this for a backup read through the same
/// connection), so it never has to start over and ends as the project stood at its last step.
pub struct Copying {
    /// None once finished.
    backup: Option<NonNull<ffi::sqlite3_backup>>,
    /// None once handed on by end().
    partial: Option<Partial>,
    /// Pages the next step takes; fewer on a slow drive.
    pages: i32,
    /// Steps in a row that found the project busy.
    busy: u32,
}

// SAFETY: the bundled SQLite is built thread-safe, and SbdFile only touches a copy while OpenFiles' mutex is held, so
// the backup handle is never used from two threads at once.
unsafe impl Send for Copying {}

impl Copying {
    /// Starts copying `source` to `dest_path`.
    ///
    /// # Safety
    ///
    /// The copy keeps SQLite's handle on `source` without borrowing it, so `source` must stay open until the copy has
    /// ended or been dropped, and must only be used from one thread at a time meanwhile. SbdFile keeps both behind
    /// OpenFiles' mutex and declares its copy before its connection, so the copy drops first.
    pub unsafe fn start(source: &Connection, dest_path: &Path) -> Result<Self, String> {
        let path = partial_path(dest_path);
        // Left by a copy that was cut off; it was never a backup.
        let _ = fs::remove_file(&path);
        let partial = Partial {
            dest: Some(Connection::open(&path).map_err(text)?),
            path,
            backup_path: dest_path.to_path_buf(),
        };
        let dest = partial.dest.as_ref().ok_or("The copy isn't open.")?;
        // Nothing reads the copy until it's renamed, so it needs no journal and no syncs on the way; save() syncs it
        // once, whole.
        dest.pragma_update_and_check(None, "journal_mode", "OFF", |row| row.get::<_, String>(0))
            .map_err(text)?;
        dest.pragma_update(None, "synchronous", "OFF")
            .map_err(text)?;
        // SAFETY: both connections are open and the names are NUL-terminated. The handle is finished before either
        // connection closes: in end() or drop here, and SbdFile drops its copy before its connection.
        let backup = unsafe {
            ffi::sqlite3_backup_init(
                dest.handle(),
                c"main".as_ptr(),
                source.handle(),
                c"main".as_ptr(),
            )
        };
        let Some(backup) = NonNull::new(backup) else {
            // SAFETY: the connection is open; SQLite owns the message, which is copied before it closes.
            return Err(
                unsafe { CStr::from_ptr(ffi::sqlite3_errmsg(dest.handle())) }
                    .to_string_lossy()
                    .into_owned(),
            );
        };
        Ok(Self {
            backup: Some(backup),
            partial: Some(partial),
            pages: STEP_PAGES,
            busy: 0,
        })
    }

    /// The file the copy is being written to.
    pub fn path(&self) -> Option<&Path> {
        self.partial.as_ref().map(|partial| partial.path.as_path())
    }

    /// Copies the next few pages, and says whether that was the last of them. A step that ran slow makes the next one
    /// smaller, and a quick one lets it grow back.
    pub fn step(&mut self) -> Result<bool, String> {
        let backup = self.backup.ok_or("The backup copy has already ended.")?;
        let started = Instant::now();
        // SAFETY: the handle is live until finish_handle() takes it.
        let code = unsafe { ffi::sqlite3_backup_step(backup.as_ptr(), self.pages) };
        self.pages = if started.elapsed() > SLOW_STEP {
            (self.pages / 2).max(MIN_STEP_PAGES)
        } else if started.elapsed() < SLOW_STEP / 4 {
            (self.pages * 2).min(STEP_PAGES)
        } else {
            self.pages
        };
        match code {
            ffi::SQLITE_DONE => Ok(true),
            ffi::SQLITE_OK => {
                self.busy = 0;
                Ok(false)
            }
            // Busy or locked: something held the project for a moment, and the next step tries again.
            ffi::SQLITE_BUSY | ffi::SQLITE_LOCKED => {
                self.busy += 1;
                if self.busy > MAX_BUSY_STEPS {
                    Err("Another program is using the project file, so the backup stopped.".into())
                } else {
                    Ok(false)
                }
            }
            code => Err(error_text(code)),
        }
    }

    /// Ends a complete copy and lets go of the project's connection. The copy still has to be saved.
    pub fn end(mut self) -> Result<Partial, String> {
        self.finish_handle()?;
        self.partial
            .take()
            .ok_or_else(|| "The copy isn't open.".into())
    }

    fn finish_handle(&mut self) -> Result<(), String> {
        let Some(backup) = self.backup.take() else {
            return Ok(());
        };
        // SAFETY: taken out above, so it's finished exactly once. Finishing reports any error a step met.
        match unsafe { ffi::sqlite3_backup_finish(backup.as_ptr()) } {
            ffi::SQLITE_OK => Ok(()),
            code => Err(error_text(code)),
        }
    }
}

impl Drop for Copying {
    fn drop(&mut self) {
        // Before `partial` drops and closes the copy's connection.
        let _ = self.finish_handle();
    }
}

/// A complete copy, not yet on disk under its backup's name. Dropped unsaved, it's deleted.
pub struct Partial {
    /// None once closed.
    dest: Option<Connection>,
    path: PathBuf,
    backup_path: PathBuf,
}

impl Partial {
    /// Writes the copy to disk and gives it the backup's name. Syncing hundreds of MB takes a while, so it's called
    /// after letting go of the project, and edits go on meanwhile.
    pub fn save(mut self) -> Result<PathBuf, String> {
        if let Some(dest) = self.dest.take() {
            dest.close().map_err(|(_, error)| text(error))?;
        }
        // Opened for writing, as Windows needs to flush a file.
        fs::OpenOptions::new()
            .write(true)
            .open(&self.path)
            .and_then(|file| file.sync_all())
            .map_err(text)?;
        rename_new(&self.path, &self.backup_path)?;
        Ok(self.backup_path.clone())
    }
}

impl Drop for Partial {
    fn drop(&mut self) {
        drop(self.dest.take());
        // A copy cut off before it was saved. Once saved, the file has its backup name and there's nothing here.
        let _ = fs::remove_file(&self.path);
    }
}

/// Renames `from` to `to`, refusing if `to` exists, without the gap between checking and renaming a plain rename
/// would leave (rename replaces whatever is there, on every system).
#[cfg(target_os = "macos")]
fn rename_new(from: &Path, to: &Path) -> Result<(), String> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let source = CString::new(from.as_os_str().as_bytes()).map_err(text)?;
    let dest = CString::new(to.as_os_str().as_bytes()).map_err(text)?;
    // SAFETY: both paths are NUL-terminated and outlive the call.
    if unsafe { libc::renamex_np(source.as_ptr(), dest.as_ptr(), libc::RENAME_EXCL) } == 0 {
        return Ok(());
    }
    let error = std::io::Error::last_os_error();
    Err(if error.kind() == std::io::ErrorKind::AlreadyExists {
        "A backup with that name already exists.".into()
    } else {
        text(error)
    })
}

/// The same elsewhere: a hard link refuses an existing name, and the partial name then goes. A drive without hard
/// links (exFAT) falls back to checking first.
#[cfg(not(target_os = "macos"))]
fn rename_new(from: &Path, to: &Path) -> Result<(), String> {
    match fs::hard_link(from, to) {
        Ok(()) => fs::remove_file(from).map_err(text),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            Err("A backup with that name already exists.".into())
        }
        Err(_) if to.exists() => Err("A backup with that name already exists.".into()),
        Err(_) => fs::rename(from, to).map_err(text),
    }
}

fn error_text(code: i32) -> String {
    // SAFETY: SQLite returns a static, NUL-terminated message for every code.
    let message = unsafe { CStr::from_ptr(ffi::sqlite3_errstr(code)) };
    format!("The backup copy failed: {}.", message.to_string_lossy())
}

fn text(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_the_partial_copy_after_its_backup() {
        assert_eq!(
            partial_path(Path::new("/p/Backups/Bey 2026-11-03 09-00.sbd")),
            Path::new("/p/Backups/Bey 2026-11-03 09-00.sbd.partial")
        );
    }

    #[test]
    fn renames_without_ever_replacing() {
        let dir = std::env::temp_dir().join(format!("sbd-rename-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let (from, to) = (dir.join("a.partial"), dir.join("a.sbd"));
        fs::write(&from, "new").unwrap();
        fs::write(&to, "old").unwrap();
        assert!(rename_new(&from, &to).is_err());
        assert_eq!(fs::read_to_string(&to).unwrap(), "old");
        fs::remove_file(&to).unwrap();
        rename_new(&from, &to).unwrap();
        assert_eq!(fs::read_to_string(&to).unwrap(), "new");
        assert!(!from.exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    /// A full copy on a drive that keeps no private sizes (HFS+ here; exFAT and network shares are the same) counts in
    /// full toward the cap, rather than as nothing. Runs on a disk image, so it needs hdiutil; it's skipped without.
    #[cfg(target_os = "macos")]
    #[test]
    fn counts_a_whole_file_on_a_drive_without_private_sizes() {
        use std::process::Command;
        let dir = std::env::temp_dir().join(format!("sbd-hfs-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let image = dir.join("plain.dmg");
        let mount = dir.join("mount");
        let made = Command::new("hdiutil")
            .args([
                "create", "-size", "8m", "-fs", "HFS+", "-volname", "sbdtest", "-quiet",
            ])
            .arg(&image)
            .status();
        let attached = made.is_ok_and(|status| status.success())
            && Command::new("hdiutil")
                .args(["attach", "-nobrowse", "-quiet", "-mountpoint"])
                .arg(&mount)
                .arg(&image)
                .status()
                .is_ok_and(|status| status.success());
        if !attached {
            eprintln!("hdiutil couldn't make a disk image here; skipped");
            let _ = fs::remove_dir_all(&dir);
            return;
        }
        let file = mount.join("copy.sbd");
        fs::write(&file, vec![1u8; 1_000_000]).unwrap();
        let own = own_bytes(&file);
        let _ = Command::new("hdiutil")
            .args(["detach", "-quiet"])
            .arg(&mount)
            .status();
        let _ = fs::remove_dir_all(&dir);
        assert_eq!(own.unwrap(), 1_000_000);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_clone_takes_no_space_until_the_original_changes() {
        use std::io::{Seek, SeekFrom, Write};
        let dir = std::env::temp_dir().join(format!("sbd-clone-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let (original, clone) = (dir.join("a.sbd"), dir.join("b.sbd"));
        let _ = fs::remove_file(&original);
        let _ = fs::remove_file(&clone);
        let block: Vec<u8> = (0..4_000_000_u32).map(|i| (i % 251) as u8).collect();
        fs::write(&original, &block).unwrap();
        // The temp folder is on the startup volume, which is APFS on every Mac this app supports.
        clone_file(&original, &clone).unwrap();
        assert!(
            clone_file(&original, &clone).is_err(),
            "never over an existing file"
        );
        assert_eq!(own_bytes(&clone).unwrap(), 0);

        let mut file = fs::OpenOptions::new().write(true).open(&original).unwrap();
        file.seek(SeekFrom::Start(0)).unwrap();
        file.write_all(&[7; 1_000_000]).unwrap();
        file.sync_all().unwrap();
        // The clone alone now holds the old first megabyte.
        let own = own_bytes(&clone).unwrap();
        assert!((1_000_000..1_100_000).contains(&own), "{own}");
        fs::remove_dir_all(&dir).unwrap();
    }
}
