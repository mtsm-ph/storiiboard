//! The launch check (6.27l, Kevin Nov 20; docs/briefs/launch-check.md): a self-check mode of the real app, switched on
//! only by the environment variable `STORIIBOARD_LAUNCH_CHECK=1`, run by scripts/launchCheck.sh in both installer jobs
//! of the checkpoint on the app just built. Nothing automated started the built app before it, so a window that never
//! opened would have passed every other check.
//!
//! The app makes its main window as always, then the page runs its part (src/app/launchCheck) and reports each step
//! here. Eight steps in a fixed order; the first failure ends the process at once with that step's code, and all eight
//! passed quits the app its own way with 0. A time limit, kept on a thread of its own and never by the page, ends a
//! check that stalls. The mode does nothing else: no project, no clean-up, no files from outside, and net.rs refuses
//! every request while it runs.
//!
//! Its strings are lines for a CI log, not words for people: lower case, no full stop, never translated.

use std::{
    io::Write,
    sync::{Arc, Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};

use tauri::{AppHandle, Manager, Runtime};

/// The variable that switches the mode on, only with the value `1`.
pub(crate) const VARIABLE: &str = "STORIIBOARD_LAUNCH_CHECK";

/// The steps, in order. A step's number is its place here, from 1. scripts/launchCheck.sh holds the same list, to
/// name an exit code (tested below).
pub(crate) const STEPS: [&str; 8] = [
    "window",
    "loaded",
    "page",
    "policy-watch",
    "pdf-text",
    "accents",
    "worker-policy",
    "no-violation",
];

/// The steps only Rust reports; the page's report of one is refused.
const RUST_STEPS: [&str; 2] = ["window", "loaded"];

/// How long the whole check may take, from the start of run().
pub(crate) const TIME_LIMIT: Duration = Duration::from_secs(90);

/// The app was asked to quit (its window closed) before the check ended.
pub(crate) const EXIT_QUIT_EARLY: i32 = 3;
/// Every step passed, but the app had not quit when the time limit ended.
pub(crate) const EXIT_NOT_QUIT: i32 = 39;

/// The most a page's reason may be, in characters.
const MAX_DETAIL: usize = 300;

/// Whether a value of the variable switches the mode on: exactly `1`, nothing else.
pub(crate) fn switches_on(value: Option<&str>) -> bool {
    value == Some("1")
}

/// Whether this process runs the launch check: read once, in run(); false until then and in every test.
static RUNNING: OnceLock<bool> = OnceLock::new();

/// Reads the variable, once. run() alone calls it.
pub(crate) fn read_switch() -> bool {
    *RUNNING.get_or_init(|| switches_on(std::env::var(VARIABLE).ok().as_deref()))
}

/// Whether the launch check is running (net.rs refuses every request then).
pub(crate) fn running() -> bool {
    RUNNING.get().copied().unwrap_or(false)
}

/// The exit code for step `index` (from 0) failing: 10 + its number.
pub(crate) fn failure_code(index: usize) -> i32 {
    11 + index as i32
}

/// The exit code for the time limit ending while waiting for step `index` (from 0): 30 + its number.
pub(crate) fn time_limit_code(index: usize) -> i32 {
    31 + index as i32
}

/// A page's reason as one line of at most 300 characters, control characters replaced by spaces.
pub(crate) fn clean_detail(detail: &str) -> String {
    detail
        .chars()
        // The line and paragraph separators aren't control characters, but a log may break a line at them.
        .map(|c| {
            if c.is_control() || c == '\u{2028}' || c == '\u{2029}' {
                ' '
            } else {
                c
            }
        })
        .take(MAX_DETAIL)
        .collect::<String>()
        .trim()
        .to_owned()
}

/// Who reports a step.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Reporter {
    Rust,
    Page,
}

/// How the check ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Verdict {
    Passed,
    Failed {
        step: &'static str,
        code: i32,
        why: String,
    },
}

impl Verdict {
    /// The process's exit code for it.
    pub(crate) fn code(&self) -> i32 {
        match self {
            Verdict::Passed => 0,
            Verdict::Failed { code, .. } => *code,
        }
    }

    /// Its line in the log.
    pub(crate) fn line(&self) -> String {
        match self {
            Verdict::Passed => "launch check: passed".to_owned(),
            Verdict::Failed { step, why, .. } => format!("launch check: FAILED at {step}: {why}"),
        }
    }
}

/// What a report did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Outcome {
    /// A second report of a step, or any report after the verdict: nothing changed.
    Ignored,
    /// The step passed; the check goes on.
    StepOk,
    /// The report decided the check.
    Decided(Verdict),
}

/// The steps reported so far and the verdict, with no environment and no exit: the rules alone.
#[derive(Debug, Default)]
pub(crate) struct Record {
    reported: [bool; 8],
    ok: [bool; 8],
    verdict: Option<Verdict>,
}

impl Record {
    /// Records one report. An unknown step is refused, and so are `window` and `loaded` from the page.
    pub(crate) fn report(
        &mut self,
        from: Reporter,
        step: &str,
        ok: bool,
        detail: &str,
    ) -> Result<Outcome, String> {
        let index = STEPS
            .iter()
            .position(|known| *known == step)
            .ok_or_else(|| "the launch check has no such step".to_owned())?;
        if from == Reporter::Page && RUST_STEPS.contains(&step) {
            return Err("only the app reports that step".to_owned());
        }
        if self.verdict.is_some() || self.reported[index] {
            return Ok(Outcome::Ignored);
        }
        self.reported[index] = true;
        if !ok {
            let why = clean_detail(detail);
            let verdict = Verdict::Failed {
                step: STEPS[index],
                code: failure_code(index),
                why: if why.is_empty() {
                    "no reason given".to_owned()
                } else {
                    why
                },
            };
            self.verdict = Some(verdict.clone());
            return Ok(Outcome::Decided(verdict));
        }
        self.ok[index] = true;
        if self.ok.iter().all(|done| *done) {
            self.verdict = Some(Verdict::Passed);
            return Ok(Outcome::Decided(Verdict::Passed));
        }
        Ok(Outcome::StepOk)
    }

    pub(crate) fn verdict(&self) -> Option<&Verdict> {
        self.verdict.as_ref()
    }

    /// The step the check is waiting for: the first not yet ok, in order; None when all are.
    pub(crate) fn waiting_for(&self) -> Option<usize> {
        self.ok.iter().position(|done| !done)
    }

    /// What the time limit ending means now: its line and exit code.
    pub(crate) fn at_time_limit(&self) -> (String, i32) {
        match (self.verdict.as_ref(), self.waiting_for()) {
            // A failure ended the process already; should it still be here, its own code.
            (Some(failed @ Verdict::Failed { .. }), _) => (failed.line(), failed.code()),
            (_, Some(index)) => (
                format!(
                    "launch check: FAILED: time limit ({} s) while waiting for {}",
                    TIME_LIMIT.as_secs(),
                    STEPS[index]
                ),
                time_limit_code(index),
            ),
            (_, None) => (
                "launch check: FAILED: every step passed but the app had not quit when the time limit ended"
                    .to_owned(),
                EXIT_NOT_QUIT,
            ),
        }
    }
}

/// Where the check's lines go: stdout in the app, a list in a test.
pub(crate) type Say = Box<dyn Fn(&str) + Send + Sync>;
/// The time since the check started: `Instant`'s, which never goes backwards, in the app (`since`); a fake in a test.
pub(crate) type Elapsed = Box<dyn Fn() -> Duration + Send + Sync>;

/// The app's clock for the check: the time since `started`, run()'s first moment, measured here in Rust and never by
/// the page, so Rust's own steps and the time limit's line are on the same clock as the page's.
pub(crate) fn since(started: Instant) -> Elapsed {
    Box::new(move || started.elapsed())
}

/// A step's line, a failure's and the time limit's, with the time since the check started (Nov 21): tenths of a
/// second, so a run that ends at the limit tells where its time went. scripts/launchCheck.sh takes it off a note.
pub(crate) fn timed(line: &str, at: Duration) -> String {
    format!("{line} (at {:.1} s)", at.as_secs_f64())
}
/// What a verdict does: in the app, end the process or quit; in a test, note it.
pub(crate) type Finish<R> = Box<dyn Fn(&AppHandle<R>, &Verdict) + Send + Sync>;

/// The record and its lines, shared with the time limit's thread.
pub(crate) struct Shared {
    record: Mutex<Record>,
    say: Say,
    elapsed: Elapsed,
}

impl Shared {
    fn record(&self) -> std::sync::MutexGuard<'_, Record> {
        self.record.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// The check's state, managed by the app only in the mode (run()); the command is refused without it.
pub(crate) struct LaunchCheck<R: Runtime> {
    shared: Arc<Shared>,
    finish: Finish<R>,
}

impl<R: Runtime> LaunchCheck<R> {
    pub(crate) fn new(say: Say, finish: Finish<R>, elapsed: Elapsed) -> Self {
        Self {
            shared: Arc::new(Shared {
                record: Mutex::new(Record::default()),
                say,
                elapsed,
            }),
            finish,
        }
    }

    /// Records a report, says its line, and hands a verdict to the finisher, outside the lock: a pass quits the app,
    /// whose quit asks the record again (RunEvent::ExitRequested).
    pub(crate) fn report(
        &self,
        app: &AppHandle<R>,
        from: Reporter,
        step: &str,
        ok: bool,
        detail: &str,
    ) -> Result<(), String> {
        let note = page_note(from, ok, detail);
        self.report_noted(app, from, step, ok, detail, note.as_deref())
    }

    /// As `report`, with a note on the step's ok line (`loaded` shown first by the 3-second net).
    pub(crate) fn report_noted(
        &self,
        app: &AppHandle<R>,
        from: Reporter,
        step: &str,
        ok: bool,
        detail: &str,
        note: Option<&str>,
    ) -> Result<(), String> {
        // The clock is read and the line said while the record is still locked, as the time limit's thread does: two
        // reports (Rust's `loaded` and a page step, from different threads) then print in the order of their times,
        // never a later line with an earlier time. Only for a line that is said; the finisher runs after the lock is
        // dropped, as a pass quits the app, whose quit asks the record again.
        let verdict = {
            let mut record = self.shared.record();
            match record.report(from, step, ok, detail)? {
                Outcome::Ignored => None,
                Outcome::StepOk => {
                    let at = (self.shared.elapsed)();
                    (self.shared.say)(&timed(&ok_line(step, note), at));
                    None
                }
                Outcome::Decided(verdict) => {
                    let at = (self.shared.elapsed)();
                    // `launch check: passed` stays as it is: scripts/launchCheck.sh matches the whole line.
                    if verdict == Verdict::Passed {
                        (self.shared.say)(&timed(&ok_line(step, note), at));
                        (self.shared.say)(&verdict.line());
                    } else {
                        (self.shared.say)(&timed(&verdict.line(), at));
                    }
                    Some(verdict)
                }
            }
        };
        if let Some(verdict) = verdict {
            (self.finish)(app, &verdict);
        }
        Ok(())
    }

    /// Whether the check has a verdict yet.
    pub(crate) fn decided(&self) -> bool {
        self.shared.record().verdict().is_some()
    }

    /// Says a line (the app asked to quit early).
    pub(crate) fn say(&self, line: &str) {
        (self.shared.say)(line);
    }

    /// The time limit, on a thread of its own: at `deadline` it says what it was waiting for and ends the process. It
    /// stays armed until the process is gone, a pass included (39).
    pub(crate) fn arm_time_limit(&self, deadline: Instant) {
        let shared = Arc::clone(&self.shared);
        thread::spawn(move || {
            thread::sleep(deadline.saturating_duration_since(Instant::now()));
            // Under the record's lock, as a report's line: no report's line can come after this one with a later
            // time, nor before it with an earlier one. The process ends with the lock held; nothing waits on it then.
            let record = shared.record();
            let (line, code) = record.at_time_limit();
            (shared.say)(&timed(&line, (shared.elapsed)()));
            end_process(code);
        });
    }
}

/// The note on a page step's ok line: its detail, cleaned and bounded as a failure's reason is, when it gave one
/// (6.27r: `accents` passed by the page says so). The verdict never reads it: the app reports, scripts/launchCheck.sh
/// judges. None for an empty detail, a failure, or a step of Rust's own.
pub(crate) fn page_note(from: Reporter, ok: bool, detail: &str) -> Option<String> {
    if from != Reporter::Page || !ok {
        return None;
    }
    Some(clean_detail(detail)).filter(|note| !note.is_empty())
}

/// A step's ok line, with its note in brackets when it has one.
pub(crate) fn ok_line(step: &str, note: Option<&str>) -> String {
    match note {
        Some(note) => format!("launch check: {step} ok ({note})"),
        None => format!("launch check: {step} ok"),
    }
}

/// The note on `loaded` when the window was visible before the app's own show(): the 3-second net got there first.
pub(crate) const SHOWN_BY_NET: &str = "already shown by the 3-second net";

/// A line on stdout, flushed; a write that fails is ignored, never a panic.
pub(crate) fn say_on_stdout(line: &str) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{line}");
    let _ = out.flush();
}

/// The app's finisher: a failure ends the process at once with its code (nothing was started in the mode, so nothing
/// needs a graceful quit); a pass quits the app its own way.
pub(crate) fn finish_in_app<R: Runtime>(app: &AppHandle<R>, verdict: &Verdict) {
    match verdict {
        Verdict::Passed => app.exit(0),
        Verdict::Failed { code, .. } => end_process(*code),
    }
}

/// Ends the process at once with `code`, its line already said and flushed. On a Mac with `_exit`, which runs no exit
/// handlers: one could race the webview's threads and turn the code into a crash's. Elsewhere `std::process::exit`.
pub(crate) fn end_process(code: i32) -> ! {
    let _ = std::io::stdout().flush();
    let _ = std::io::stderr().flush();
    #[cfg(target_os = "macos")]
    // SAFETY: _exit takes any int and never returns; nothing in the mode needs a handler to run first.
    unsafe {
        libc::_exit(code)
    }
    #[cfg(not(target_os = "macos"))]
    std::process::exit(code)
}

/// The line said when the app is asked to quit before the check ended.
pub(crate) const QUIT_EARLY_LINE: &str =
    "launch check: FAILED: the app was asked to quit before the check ended";

/// Run before any script of the page, in the mode only (lib.rs adds it to the main window): every policy violation
/// the document reports from its first moment, kept where the page's check reads it and nothing can replace it.
pub(crate) const WATCH_SCRIPT: &str = r#"(() => {
  const violations = [];
  document.addEventListener('securitypolicyviolation', (event) => {
    violations.push({ directive: event.effectiveDirective, blocked: event.blockedURI, disposition: event.disposition });
  });
  Object.defineProperty(window, '__STORIIBOARD_LAUNCH_CHECK__', {
    value: Object.freeze({ violations }),
    writable: false,
    configurable: false,
    enumerable: false,
  });
})();"#;

/// The page reports one of its steps. Refused, and nothing recorded, unless the app runs the launch check: only Rust
/// switches it on, and only from the environment.
#[tauri::command]
pub(crate) fn launch_check_step<R: Runtime>(
    app: AppHandle<R>,
    step: String,
    ok: bool,
    detail: String,
) -> Result<(), String> {
    match app.try_state::<LaunchCheck<R>>() {
        Some(check) => check.report(&app, Reporter::Page, &step, ok, &detail),
        None => Err("the launch check is not running".to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_value_1_switches_it_on() {
        assert!(switches_on(Some("1")));
        for value in [
            None,
            Some(""),
            Some("0"),
            Some("true"),
            Some(" 1"),
            Some("1 "),
            Some("01"),
            Some("yes"),
        ] {
            assert!(!switches_on(value), "{value:?}");
        }
    }

    #[test]
    fn it_is_not_running_in_the_tests() {
        // No test reads or sets the variable: tests share one process.
        assert!(!running());
    }

    #[test]
    fn the_steps_their_order_and_their_codes() {
        assert_eq!(
            STEPS,
            [
                "window",
                "loaded",
                "page",
                "policy-watch",
                "pdf-text",
                "accents",
                "worker-policy",
                "no-violation"
            ]
        );
        assert_eq!(failure_code(0), 11);
        assert_eq!(failure_code(4), 15);
        assert_eq!(failure_code(7), 18);
        assert_eq!(time_limit_code(0), 31);
        assert_eq!(time_limit_code(7), 38);
        assert_eq!(EXIT_QUIT_EARLY, 3);
        assert_eq!(EXIT_NOT_QUIT, 39);
        assert_eq!(TIME_LIMIT, Duration::from_secs(90));
    }

    #[test]
    fn the_script_names_the_same_steps() {
        let script = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../scripts/launchCheck.sh"),
        )
        .expect("scripts/launchCheck.sh reads");
        let line = script
            .lines()
            .find(|line| line.trim_start().starts_with("steps=\""))
            .expect("the script has its steps=\"…\" line");
        let list = line
            .trim()
            .trim_start_matches("steps=\"")
            .trim_end_matches('"');
        assert_eq!(list.split(' ').collect::<Vec<_>>(), STEPS);
        // LF line endings: it runs under bash.
        assert!(!script.contains('\r'));
    }

    fn all_ok(record: &mut Record) -> Vec<Outcome> {
        STEPS
            .iter()
            .map(|step| {
                let from = if RUST_STEPS.contains(step) {
                    Reporter::Rust
                } else {
                    Reporter::Page
                };
                record.report(from, step, true, "").unwrap()
            })
            .collect()
    }

    #[test]
    fn all_eight_ok_is_a_pass() {
        let mut record = Record::default();
        let outcomes = all_ok(&mut record);
        assert_eq!(outcomes[..7], vec![Outcome::StepOk; 7][..]);
        assert_eq!(outcomes[7], Outcome::Decided(Verdict::Passed));
        assert_eq!(record.verdict(), Some(&Verdict::Passed));
        assert_eq!(Verdict::Passed.code(), 0);
        assert_eq!(Verdict::Passed.line(), "launch check: passed");
    }

    #[test]
    fn the_ok_line_says_when_the_net_showed_the_window_first() {
        assert_eq!(ok_line("loaded", None), "launch check: loaded ok");
        assert_eq!(
            ok_line("loaded", Some(SHOWN_BY_NET)),
            "launch check: loaded ok (already shown by the 3-second net)"
        );
    }

    #[test]
    fn a_line_carries_its_time_since_the_start_in_tenths_of_a_second() {
        assert_eq!(
            timed(&ok_line("pdf-text", None), Duration::from_millis(12_400)),
            "launch check: pdf-text ok (at 12.4 s)"
        );
        assert_eq!(
            timed(
                &ok_line("loaded", Some(SHOWN_BY_NET)),
                Duration::from_millis(3_000)
            ),
            "launch check: loaded ok (already shown by the 3-second net) (at 3.0 s)"
        );
        assert_eq!(
            timed(
                "launch check: FAILED at pdf-text: the line is missing",
                Duration::from_millis(61_070)
            ),
            "launch check: FAILED at pdf-text: the line is missing (at 61.1 s)"
        );
        assert_eq!(
            timed("launch check: window ok", Duration::ZERO),
            "launch check: window ok (at 0.0 s)"
        );
        // The time limit's line, as its thread says it.
        let mut record = Record::default();
        record.report(Reporter::Rust, "window", true, "").unwrap();
        let (line, code) = record.at_time_limit();
        assert_eq!(
            timed(&line, Duration::from_millis(90_004)),
            "launch check: FAILED: time limit (90 s) while waiting for loaded (at 90.0 s)"
        );
        assert_eq!(code, 32);
    }

    #[test]
    fn the_apps_clock_counts_from_its_start_and_never_goes_back() {
        // 5 s back where the clock allows it; just after boot (Windows) it may not, and then it counts from now.
        let now = Instant::now();
        let (started, back) = match now.checked_sub(Duration::from_secs(5)) {
            Some(earlier) => (earlier, Duration::from_secs(5)),
            None => (now, Duration::ZERO),
        };
        let elapsed = since(started);
        let first = elapsed();
        assert!(first >= back, "{first:?}");
        assert!(elapsed() >= first);
    }

    #[test]
    fn a_page_steps_ok_detail_is_its_note_cleaned_and_bounded() {
        let note = "by the page: read ok, 16 × 16, 3 accents; the worker: The object is in an invalid state. \
                    (worker: read); the worker asked again: ok, 2 accents";
        assert_eq!(page_note(Reporter::Page, true, note).as_deref(), Some(note));
        assert_eq!(
            ok_line("accents", page_note(Reporter::Page, true, note).as_deref()),
            format!("launch check: accents ok ({note})")
        );
        // Cleaned and bounded as a failure's reason is.
        assert_eq!(
            page_note(Reporter::Page, true, "by the page:\nread\u{1b}ok").as_deref(),
            Some("by the page: read ok")
        );
        let long = page_note(Reporter::Page, true, &"x".repeat(400)).unwrap();
        assert_eq!(long, clean_detail(&"x".repeat(400)));
        assert_eq!(long.chars().count(), 300);
        // No note for an empty or blank detail, a failure, or one of Rust's own steps.
        assert_eq!(page_note(Reporter::Page, true, ""), None);
        assert_eq!(page_note(Reporter::Page, true, " \n "), None);
        assert_eq!(page_note(Reporter::Page, false, "why"), None);
        assert_eq!(page_note(Reporter::Rust, true, "x"), None);
        assert_eq!(
            ok_line("accents", page_note(Reporter::Page, true, "").as_deref()),
            "launch check: accents ok"
        );
        // The verdict doesn't read it: every step ok with a note on accents is still a pass.
        let mut record = Record::default();
        for step in STEPS {
            let from = if RUST_STEPS.contains(&step) {
                Reporter::Rust
            } else {
                Reporter::Page
            };
            record
                .report(from, step, true, if step == "accents" { note } else { "" })
                .unwrap();
        }
        assert_eq!(record.verdict(), Some(&Verdict::Passed));
        assert_eq!(Verdict::Passed.code(), 0);
    }

    #[test]
    fn reports_may_come_in_any_order() {
        // The table's order is the codes' order only: loaded usually comes after the page's first steps.
        let mut record = Record::default();
        for step in ["page", "window", "policy-watch", "pdf-text", "accents"] {
            let from = if RUST_STEPS.contains(&step) {
                Reporter::Rust
            } else {
                Reporter::Page
            };
            assert_eq!(
                record.report(from, step, true, "").unwrap(),
                Outcome::StepOk
            );
        }
        for step in ["worker-policy", "no-violation"] {
            assert_eq!(
                record.report(Reporter::Page, step, true, "").unwrap(),
                Outcome::StepOk
            );
        }
        assert_eq!(
            record.report(Reporter::Rust, "loaded", true, "").unwrap(),
            Outcome::Decided(Verdict::Passed)
        );
    }

    #[test]
    fn a_failed_step_is_the_verdict_at_once_with_its_code() {
        let mut record = Record::default();
        record.report(Reporter::Rust, "window", true, "").unwrap();
        let outcome = record
            .report(Reporter::Page, "pdf-text", false, "the line is missing")
            .unwrap();
        let failed = Verdict::Failed {
            step: "pdf-text",
            code: 15,
            why: "the line is missing".to_owned(),
        };
        assert_eq!(outcome, Outcome::Decided(failed.clone()));
        assert_eq!(
            failed.line(),
            "launch check: FAILED at pdf-text: the line is missing"
        );
        // After the verdict, nothing changes it.
        assert_eq!(
            record.report(Reporter::Page, "page", true, "").unwrap(),
            Outcome::Ignored
        );
        assert_eq!(record.verdict(), Some(&failed));
        // No reason is still a line.
        let mut other = Record::default();
        assert_eq!(
            other
                .report(Reporter::Rust, "window", false, " \n ")
                .unwrap(),
            Outcome::Decided(Verdict::Failed {
                step: "window",
                code: 11,
                why: "no reason given".to_owned()
            })
        );
    }

    #[test]
    fn unknown_steps_and_the_apps_own_steps_from_the_page_are_refused() {
        let mut record = Record::default();
        for step in ["", "Window", "passed", "launch"] {
            assert!(
                record.report(Reporter::Page, step, true, "").is_err(),
                "{step}"
            );
            assert!(
                record.report(Reporter::Rust, step, true, "").is_err(),
                "{step}"
            );
        }
        for step in ["window", "loaded"] {
            assert!(
                record.report(Reporter::Page, step, true, "").is_err(),
                "{step}"
            );
            assert!(
                record.report(Reporter::Page, step, false, "x").is_err(),
                "{step}"
            );
        }
        // Nothing of it was recorded.
        assert_eq!(record.verdict(), None);
        assert_eq!(record.waiting_for(), Some(0));
    }

    #[test]
    fn a_second_report_of_a_step_is_ignored() {
        let mut record = Record::default();
        assert_eq!(
            record.report(Reporter::Page, "page", true, "").unwrap(),
            Outcome::StepOk
        );
        assert_eq!(
            record
                .report(Reporter::Page, "page", false, "late")
                .unwrap(),
            Outcome::Ignored
        );
        assert_eq!(
            record.report(Reporter::Page, "page", true, "").unwrap(),
            Outcome::Ignored
        );
        assert_eq!(record.verdict(), None);
    }

    #[test]
    fn the_time_limit_names_the_first_step_not_yet_ok() {
        let mut record = Record::default();
        assert_eq!(
            record.at_time_limit(),
            (
                "launch check: FAILED: time limit (90 s) while waiting for window".to_owned(),
                31
            )
        );
        record.report(Reporter::Rust, "window", true, "").unwrap();
        // Out of order: the page's steps came, loaded didn't.
        record.report(Reporter::Page, "page", true, "").unwrap();
        record
            .report(Reporter::Page, "policy-watch", true, "")
            .unwrap();
        assert_eq!(
            record.at_time_limit(),
            (
                "launch check: FAILED: time limit (90 s) while waiting for loaded".to_owned(),
                32
            )
        );
        record.report(Reporter::Rust, "loaded", true, "").unwrap();
        record.report(Reporter::Page, "pdf-text", true, "").unwrap();
        assert_eq!(record.at_time_limit().1, 36);
        let mut passed = Record::default();
        all_ok(&mut passed);
        assert_eq!(passed.waiting_for(), None);
        assert_eq!(
            passed.at_time_limit(),
            (
                "launch check: FAILED: every step passed but the app had not quit when the time limit ended"
                    .to_owned(),
                39
            )
        );
    }

    #[test]
    fn the_detail_is_one_clean_line_of_at_most_300_characters() {
        assert_eq!(clean_detail("plain"), "plain");
        assert_eq!(
            clean_detail("one\ntwo\r\nthree\tfour"),
            "one two  three four"
        );
        assert_eq!(
            clean_detail("bell\u{7}esc\u{1b}[31m del\u{7f}"),
            "bell esc [31m del"
        );
        assert_eq!(clean_detail(&"é".repeat(400)).chars().count(), 300);
        assert_eq!(clean_detail(&"x".repeat(301)), "x".repeat(300));
        assert_eq!(clean_detail("a\u{85}b\u{2028}c\u{2029}d"), "a b c d");
    }

    #[test]
    fn the_watch_script_keeps_the_list_where_nothing_replaces_it() {
        assert!(WATCH_SCRIPT.contains("addEventListener('securitypolicyviolation'"));
        for field in ["effectiveDirective", "blockedURI", "disposition"] {
            assert!(WATCH_SCRIPT.contains(field), "{field}");
        }
        assert!(WATCH_SCRIPT.contains("'__STORIIBOARD_LAUNCH_CHECK__'"));
        assert!(WATCH_SCRIPT.contains("writable: false"));
        assert!(WATCH_SCRIPT.contains("configurable: false"));
    }
}
