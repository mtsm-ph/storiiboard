//! The lock file: a small hidden file next to an open .sbd that says which computer has it open (docs/SBD_FORMAT.md,
//! Files next to a project). Sync services don't carry SQLite's own locks between computers, but they do sync this
//! file, so a second computer can warn before opening a project that's already open elsewhere.
//!
//! It's advice, not enforcement: a person can still choose Open anyway. A crashed app leaves its lock behind, so a
//! lock that hasn't been refreshed for a few minutes counts as stale, and this computer's own leftovers never block it.

use std::collections::hash_map::RandomState;
use std::fs;
use std::hash::{BuildHasher, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// A lock this old belongs to a computer that crashed or lost power; it no longer means the project is open. The app
/// rewrites its lock every minute while a project is open (src/core/storage/project.ts), so five leaves room for a
/// slow sync.
pub const STALE: Duration = Duration::from_secs(5 * 60);

/// This computer, as the lock file names it.
#[derive(Debug, Clone)]
pub struct Machine {
    /// Random and kept in the app's data folder, so two computers with the same name still tell themselves apart.
    pub id: String,
    /// The name people gave the computer, such as "Kevin's MacBook Pro", shown on the other computer's warning.
    pub name: String,
}

impl Machine {
    /// Reads this install's id from the app data folder, making one the first time.
    pub fn load(data_dir: &Path) -> Self {
        let file = data_dir.join("machine-id");
        let id = fs::read_to_string(&file)
            .ok()
            .map(|text| text.trim().to_string())
            .filter(|text| !text.is_empty())
            .unwrap_or_else(|| {
                let id = random_id();
                let _ = fs::create_dir_all(data_dir);
                let _ = fs::write(&file, &id);
                id
            });
        Self {
            id,
            name: computer_name(),
        }
    }
}

/// A hard-to-guess id without a random-number crate: std's hasher is seeded randomly per process.
pub fn random_id() -> String {
    let mut hasher = RandomState::new().build_hasher();
    hasher.write_u128(now_ms() as u128);
    hasher.write_u32(std::process::id());
    let first = hasher.finish();
    let mut hasher = RandomState::new().build_hasher();
    hasher.write_u64(first);
    format!("{first:016x}{:016x}", hasher.finish())
}

#[cfg(target_os = "macos")]
fn computer_name() -> String {
    // The name in System Settings → General → Sharing, with spaces and apostrophes, rather than the network name.
    std::process::Command::new("/usr/sbin/scutil")
        .args(["--get", "ComputerName"])
        .output()
        .ok()
        .filter(|out| out.status.success())
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "another computer".into())
}

#[cfg(not(target_os = "macos"))]
fn computer_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "another computer".into())
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// What the lock file holds.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LockInfo {
    pub app: String,
    pub computer: String,
    pub machine: String,
    pub session: String,
    pub opened_at: u64,
    pub refreshed_at: u64,
}

/// Who has a project open elsewhere, for the warning. Sent to the page as `{ computer, openedAt }`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Holder {
    pub computer: String,
    pub opened_at: u64,
}

/// `Bey County.sbd` → `.Bey County.sbd.lock` beside it. The leading dot hides it on a Mac; Windows gets the hidden
/// attribute when it's written.
pub fn lock_path(project: &Path) -> Option<PathBuf> {
    let name = project.file_name()?.to_str()?;
    Some(project.with_file_name(format!(".{name}.lock")))
}

fn read(path: &Path) -> Option<LockInfo> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

/// Another computer that has this project open now: its lock is fresh and isn't this computer's.
pub fn holder(project: &Path, machine: &Machine, now: u64) -> Option<Holder> {
    let info = read(&lock_path(project)?)?;
    let age = now.saturating_sub(info.refreshed_at);
    if info.machine == machine.id || age > STALE.as_millis() as u64 {
        return None;
    }
    Some(Holder {
        computer: info.computer,
        opened_at: info.opened_at,
    })
}

#[cfg(windows)]
fn create(path: &Path) -> std::io::Result<fs::File> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
    // Windows refuses to overwrite a hidden file unless the open asks for the same attribute.
    fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .attributes(FILE_ATTRIBUTE_HIDDEN)
        .open(path)
}

#[cfg(not(windows))]
fn create(path: &Path) -> std::io::Result<fs::File> {
    fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(path)
}

/// This app's lock on one open project. Dropping it removes the file, if it's still ours.
#[derive(Debug)]
pub struct Lock {
    path: PathBuf,
    info: LockInfo,
}

impl Lock {
    /// Writes the lock, taking over any older one. A folder that can't be written to (a read-only volume) simply
    /// gets no lock: the project still opens.
    pub fn take(project: &Path, machine: &Machine, now: u64) -> Option<Self> {
        let lock = Self {
            path: lock_path(project)?,
            info: LockInfo {
                app: "Storiiboard".into(),
                computer: machine.name.clone(),
                machine: machine.id.clone(),
                session: random_id(),
                opened_at: now,
                refreshed_at: now,
            },
        };
        lock.write().ok()?;
        Some(lock)
    }

    pub fn refresh(&mut self, now: u64) -> Result<(), String> {
        self.info.refreshed_at = now;
        self.write().map_err(|error| error.to_string())
    }

    fn write(&self) -> std::io::Result<()> {
        write_info(&self.path, &self.info)
    }

    /// Keeps the lock fresh from another thread, every `every`, until the heartbeat is dropped: for work that holds
    /// this thread longer than STALE, such as Compact project on a large file (1.27's low). Otherwise another computer
    /// would read the lock as stale and could open the project while it's half rewritten.
    pub fn heartbeat(&self, every: Duration) -> Heartbeat {
        let (stop, stopped) = mpsc::channel::<()>();
        let path = self.path.clone();
        let mut info = self.info.clone();
        let thread = thread::spawn(move || {
            while let Err(mpsc::RecvTimeoutError::Timeout) = stopped.recv_timeout(every) {
                info.refreshed_at = now_ms();
                let _ = write_info(&path, &info);
            }
        });
        Heartbeat {
            stop: Some(stop),
            thread: Some(thread),
        }
    }
}

fn write_info(path: &Path, info: &LockInfo) -> std::io::Result<()> {
    let json = serde_json::to_string(info).map_err(std::io::Error::other)?;
    create(path)?.write_all(json.as_bytes())
}

/// A lock being kept fresh in the background; dropping it stops the refreshing and waits for the thread.
pub struct Heartbeat {
    stop: Option<mpsc::Sender<()>>,
    thread: Option<thread::JoinHandle<()>>,
}

impl Drop for Heartbeat {
    fn drop(&mut self) {
        // Dropping the sender wakes the thread at once (the channel disconnects), whatever the interval.
        drop(self.stop.take());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for Lock {
    fn drop(&mut self) {
        // Another computer may have taken the lock over with Open anyway; its lock isn't ours to remove.
        if read(&self.path).is_some_and(|info| info.session == self.info.session) {
            let _ = fs::remove_file(&self.path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sbd-lock-{tag}-{}", random_id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn machine(id: &str, name: &str) -> Machine {
        Machine {
            id: id.into(),
            name: name.into(),
        }
    }

    #[test]
    fn a_heartbeat_keeps_the_lock_fresh_until_it_is_dropped() {
        let dir = temp_dir("heartbeat");
        let project = dir.join("Bey County.sbd");
        let lock = Lock::take(&project, &machine("mine", "Studio Mac"), 1_000).unwrap();
        let beat = lock.heartbeat(Duration::from_millis(20));
        std::thread::sleep(Duration::from_millis(200));
        drop(beat);
        let refreshed = read(&lock_path(&project).unwrap()).unwrap().refreshed_at;
        assert!(refreshed > 1_000, "the lock was refreshed while the heartbeat ran");
        // Stopped: nothing writes after the drop.
        std::thread::sleep(Duration::from_millis(80));
        assert_eq!(read(&lock_path(&project).unwrap()).unwrap().refreshed_at, refreshed);
        // Seen from another computer, still held.
        assert!(holder(&project, &machine("other", "Laptop"), now_ms()).is_some());
        drop(lock);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn names_the_lock_after_the_project_and_hides_it() {
        assert_eq!(
            lock_path(Path::new("/Films/Bey County.sbd")).unwrap(),
            PathBuf::from("/Films/.Bey County.sbd.lock")
        );
    }

    #[test]
    fn warns_about_another_computer_only_while_its_lock_is_fresh() {
        let dir = temp_dir("holder");
        let project = dir.join("Bey County.sbd");
        let studio = machine("studio", "Studio iMac");
        let laptop = machine("laptop", "Kevin's MacBook Pro");
        let lock = Lock::take(&project, &studio, 1_000_000).unwrap();

        assert_eq!(
            holder(&project, &laptop, 1_000_000 + 60_000),
            Some(Holder {
                computer: "Studio iMac".into(),
                opened_at: 1_000_000
            })
        );
        // This computer's own lock, or one left from a crash long ago, never blocks.
        assert_eq!(holder(&project, &studio, 1_000_000), None);
        let stale = 1_000_000 + STALE.as_millis() as u64 + 1;
        assert_eq!(holder(&project, &laptop, stale), None);
        drop(lock);
        assert!(!lock_path(&project).unwrap().exists());
    }

    #[test]
    fn refreshing_keeps_the_lock_fresh() {
        let dir = temp_dir("refresh");
        let project = dir.join("Pilot.sbd");
        let mut lock = Lock::take(&project, &machine("studio", "Studio"), 0).unwrap();
        let later = STALE.as_millis() as u64 * 2;
        lock.refresh(later).unwrap();
        assert!(holder(&project, &machine("laptop", "Laptop"), later + 1000).is_some());
    }

    #[test]
    fn leaves_a_lock_another_computer_took_over() {
        let dir = temp_dir("takeover");
        let project = dir.join("Pilot.sbd");
        let ours = Lock::take(&project, &machine("studio", "Studio"), 0).unwrap();
        let theirs = Lock::take(&project, &machine("laptop", "Laptop"), 10).unwrap();
        drop(ours);
        assert!(lock_path(&project).unwrap().exists());
        drop(theirs);
        assert!(!lock_path(&project).unwrap().exists());
    }

    #[test]
    fn keeps_one_id_per_install() {
        let dir = temp_dir("machine");
        let first = Machine::load(&dir);
        assert_eq!(Machine::load(&dir).id, first.id);
        assert_eq!(first.id.len(), 32);
        assert!(!first.name.is_empty());
    }
}
