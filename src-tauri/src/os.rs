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

/// Whether process `pid` is running `exe` (the ffmpeg sidecar), so a process id kept from an earlier run is stopped
/// only while it still names that program, never another one that took the id since.
#[cfg(unix)]
pub fn is_running(pid: u32, exe: &Path) -> bool {
    let Ok(exe) = exe.canonicalize() else {
        return false;
    };
    running_path(pid).is_some_and(|path| path == exe)
}

/// The program a process runs, as the system knows it; none for a process that has ended (or was never there).
#[cfg(target_os = "macos")]
fn running_path(pid: u32) -> Option<std::path::PathBuf> {
    use std::os::unix::ffi::OsStrExt;
    let pid = libc::c_int::try_from(pid).ok()?;
    let mut buffer = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    // SAFETY: proc_pidpath writes at most the buffer's length into it, and returns how much it wrote.
    let length =
        unsafe { libc::proc_pidpath(pid, buffer.as_mut_ptr().cast(), buffer.len() as u32) };
    let length = usize::try_from(length).ok().filter(|&n| n > 0)?;
    let path = Path::new(std::ffi::OsStr::from_bytes(&buffer[..length]));
    path.canonicalize().ok()
}

/// Linux (the tests): what /proc says. An ended process waiting to be reaped has no program any more.
#[cfg(all(unix, not(target_os = "macos")))]
fn running_path(pid: u32) -> Option<std::path::PathBuf> {
    std::fs::read_link(format!("/proc/{pid}/exe")).ok()
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
        let mut child = crate::video::command("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error", "-re", "-f", "lavfi"])
            .args(["-i", "testsrc2=duration=600", "-f", "null", "-"])
            .spawn()
            .unwrap();
        assert_ne!(
            unsafe { AssignProcessToJobObject(job.0, child.as_raw_handle()) },
            0
        );
        assert!(matches!(child.try_wait(), Ok(None)), "running");
        unsafe { CloseHandle(job.0) };
        let started = std::time::Instant::now();
        while matches!(child.try_wait(), Ok(None)) {
            assert!(
                started.elapsed() < std::time::Duration::from_secs(10),
                "ended with its job"
            );
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }

    #[cfg(unix)]
    #[test]
    fn tells_a_running_sidecar_from_a_process_that_ended_or_runs_something_else() {
        let ffmpeg = crate::video::tool("ffmpeg");
        let mut child = crate::video::command("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error", "-re", "-f", "lavfi"])
            .args(["-i", "testsrc2=duration=600", "-f", "null", "-"])
            .spawn()
            .unwrap();
        assert!(is_running(child.id(), &ffmpeg));
        assert!(!is_running(child.id(), &crate::video::tool("ffprobe")));
        kill(child.id());
        child.wait().unwrap();
        assert!(!is_running(child.id(), &ffmpeg), "ended");
        assert!(!is_running(u32::MAX, &ffmpeg), "never there");
    }
}
