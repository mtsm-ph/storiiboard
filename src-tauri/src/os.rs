//! What the app asks of the operating system directly (D2): how much a drive has free, and keeping the sidecars from
//! outliving the app. On Windows a Job Object does that, crash or not; on a Mac (and Linux, for the tests) the encodes'
//! process ids are kept in a file, and the next start stops any a crash left running (playback.rs).

use std::path::Path;
use std::process::Child;

/// The bytes free for this app on the drive that holds `folder`, as the system counts them (on Windows, after any disk
/// quota; on a Mac, without the space macOS could purge on its own, so a little less than Finder shows). None when it
/// can't be told; on Linux, which builds only for the tests, always.
pub fn free_bytes(folder: &Path) -> Option<u64> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        let mut wide: Vec<u16> = folder.as_os_str().encode_wide().collect();
        // A network share's name needs its closing backslash (\\server\share\); any folder takes one.
        if !matches!(wide.last(), Some(&c) if c == u16::from(b'\\') || c == u16::from(b'/')) {
            wide.push(u16::from(b'\\'));
        }
        wide.push(0);
        let mut free = 0u64;
        // SAFETY: `wide` is a NUL-terminated UTF-16 path that outlives the call; the two totals not asked for are null,
        // which the call allows.
        let ok = unsafe {
            GetDiskFreeSpaceExW(
                wide.as_ptr(),
                &mut free,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        (ok != 0).then_some(free)
    }
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::ffi::OsStrExt;
        let path = std::ffi::CString::new(folder.as_os_str().as_bytes()).ok()?;
        // SAFETY: statvfs fills the struct it's given, which is plain data, from a NUL-terminated path.
        let mut stats: libc::statvfs = unsafe { std::mem::zeroed() };
        let ok = unsafe { libc::statvfs(path.as_ptr(), &mut stats) } == 0;
        ok.then(|| u64::from(stats.f_bavail).saturating_mul(stats.f_frsize as u64))
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = folder;
        None
    }
}

/// Puts a sidecar just started in the app's Job Object on Windows, which the system closes when the app ends however
/// it ends, ending the sidecar with it. Elsewhere nothing: see `Running` in playback.rs. If the Job Object can't be
/// made, or the sidecar can't join it, it runs as before, stopped when the app quits normally.
pub fn keep_with_app(child: &Child) {
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        if let Some(job) = job::get() {
            // SAFETY: both handles are open: the job's for as long as the app runs, the child's while `child` lives.
            unsafe {
                windows_sys::Win32::System::JobObjects::AssignProcessToJobObject(
                    job,
                    child.as_raw_handle(),
                );
            }
        }
    }
    #[cfg(not(windows))]
    let _ = child;
}

#[cfg(windows)]
mod job {
    use std::sync::OnceLock;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    /// The job's handle, kept open for as long as the app runs and never closed by it: the system closes it when the
    /// app ends, and the job's kill-on-close limit then ends every process in it.
    pub struct Job(pub HANDLE);
    // SAFETY: a job handle may be used from any thread.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    static JOB: OnceLock<Option<Job>> = OnceLock::new();

    pub fn get() -> Option<HANDLE> {
        JOB.get_or_init(make).as_ref().map(|job| job.0)
    }

    /// A job with no name and no other limit, so nothing else can find it.
    pub fn make() -> Option<Job> {
        // SAFETY: null attributes and name are allowed; the limit struct is plain data, passed with its own size.
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return None;
            }
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let set = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                std::ptr::from_ref(&limits).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if set == 0 {
                CloseHandle(job);
                return None;
            }
            Some(Job(job))
        }
    }
}

/// When process `pid` started, as the system says it each time it's asked (on a Mac in microseconds since 1970, on
/// Linux in clock ticks since boot): with the id, it names one process, never another that took the id since. None for
/// a process that has ended (one waiting to be reaped included) or was never there.
#[cfg(unix)]
pub fn started(pid: u32) -> Option<u64> {
    facts(pid).map(|(started, _)| started)
}

/// Whether process `pid` is still the one that started at `started`, and still runs ffmpeg (a sidecar's name starts
/// with it, as built or as bundled), so a process id kept from an earlier run is stopped only while it names that same
/// process, wherever the app ran from.
#[cfg(unix)]
pub fn is_same(pid: u32, started: u64) -> bool {
    facts(pid).is_some_and(|(at, name)| at == started && name.starts_with("ffmpeg"))
}

/// A running process's start and its program's name.
#[cfg(target_os = "macos")]
fn facts(pid: u32) -> Option<(u64, String)> {
    let pid = libc::c_int::try_from(pid).ok()?;
    // SAFETY: proc_pidinfo fills at most the size it's given of a plain-data struct, and says how much it filled.
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
    let filled = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            std::ptr::from_mut(&mut info).cast(),
            size,
        )
    };
    if filled != size || info.pbi_status == libc::SZOMB {
        return None;
    }
    let name: Vec<u8> = info
        .pbi_comm
        .iter()
        .take_while(|&&c| c != 0)
        .map(|&c| c as u8)
        .collect();
    let started = info
        .pbi_start_tvsec
        .saturating_mul(1_000_000)
        .saturating_add(info.pbi_start_tvusec);
    Some((started, String::from_utf8_lossy(&name).into_owned()))
}

/// Linux (the tests): what /proc says, the name in parentheses, then the state and, 19 fields on, the start.
#[cfg(all(unix, not(target_os = "macos")))]
fn facts(pid: u32) -> Option<(u64, String)> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let (head, rest) = stat.rsplit_once(')')?;
    let name = head.split_once('(')?.1.to_owned();
    let fields: Vec<&str> = rest.split_whitespace().collect();
    if fields.first() == Some(&"Z") {
        return None;
    }
    Some((fields.get(19)?.parse().ok()?, name))
}

/// Ends process `pid` at once.
#[cfg(unix)]
pub fn kill(pid: u32) {
    #[cfg(target_os = "macos")]
    if let Ok(pid) = libc::pid_t::try_from(pid) {
        // SAFETY: a signal to a process id; at worst it fails.
        unsafe {
            libc::kill(pid, libc::SIGKILL);
        }
    }
    // Linux builds only for the tests, where libc isn't a dependency.
    #[cfg(not(target_os = "macos"))]
    let _ = std::process::Command::new("kill")
        .args(["-KILL", &pid.to_string()])
        .status();
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A minute of ffmpeg's, in real time, saying nothing; killed when dropped, so a failed test leaves nothing running.
    struct Sidecar(std::process::Child);

    impl Sidecar {
        fn start() -> Self {
            Self(
                crate::video::command("ffmpeg")
                    .args(["-hide_banner", "-loglevel", "error", "-re", "-f", "lavfi"])
                    .args(["-i", "testsrc2=duration=60", "-f", "null", "-"])
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .spawn()
                    .unwrap(),
            )
        }
    }

    impl Drop for Sidecar {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    #[test]
    fn reads_the_free_space_on_a_mac_and_windows_and_says_it_cant_on_linux() {
        let free = free_bytes(&std::env::temp_dir());
        if cfg!(any(windows, target_os = "macos")) {
            assert!(free.is_some_and(|bytes| bytes > 0), "{free:?}");
            // A folder that isn't there can't be read.
            assert_eq!(
                free_bytes(&std::env::temp_dir().join("no such folder").join("here")),
                None
            );
        } else {
            assert_eq!(free, None);
        }
    }

    #[cfg(windows)]
    #[test]
    fn a_process_in_a_job_ends_when_the_job_closes() {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::JobObjects::AssignProcessToJobObject;
        // A job of its own, so closing it stands in for the app ending without touching the app's.
        let job = job::make().expect("a job");
        let mut ffmpeg = Sidecar::start();
        assert_ne!(
            unsafe { AssignProcessToJobObject(job.0, ffmpeg.0.as_raw_handle()) },
            0
        );
        assert!(matches!(ffmpeg.0.try_wait(), Ok(None)), "running");
        unsafe { CloseHandle(job.0) };
        let started = std::time::Instant::now();
        while matches!(ffmpeg.0.try_wait(), Ok(None)) {
            assert!(
                started.elapsed() < std::time::Duration::from_secs(10),
                "ended with its job"
            );
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }

    #[cfg(unix)]
    #[test]
    fn knows_a_process_by_its_id_and_start_and_only_while_it_runs_ffmpeg() {
        let mut ffmpeg = Sidecar::start();
        let pid = ffmpeg.0.id();
        let at = started(pid).expect("running");
        assert!(is_same(pid, at));
        assert!(!is_same(pid, at + 1), "another start: another process");
        // Another program, at its own start.
        let mut other = std::process::Command::new("sleep")
            .arg("30")
            .spawn()
            .unwrap();
        let other_at = started(other.id()).expect("running");
        assert!(!is_same(other.id(), other_at), "not ffmpeg");
        other.kill().unwrap();
        other.wait().unwrap();
        kill(pid);
        // Ended, but not yet reaped: no longer that process either.
        let waited = std::time::Instant::now();
        while is_same(pid, at) {
            assert!(
                waited.elapsed() < std::time::Duration::from_secs(10),
                "ended"
            );
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert_eq!(started(pid), None);
        ffmpeg.0.wait().unwrap();
        assert!(!is_same(pid, at), "reaped");
        assert_eq!(started(u32::MAX), None, "never there");
    }
}
