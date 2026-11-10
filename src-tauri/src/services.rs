//! The service switch (4.0; Kevin, Nov 9 and 10). The operators of the online services Storiiboard uses can stop or
//! move what the app asks of them without an update: a small JSON file in this repo (`services.json`, on `main`) can
//! turn a service off, with a reason code the page turns into translated words, or move it to another server that is
//! already on `REGISTRY` below. It can never add a host, never say a word people see, and anything it says that this
//! code doesn't know (a field, a service, a server off the list) is ignored, so a service is never off by mistake.
//!
//! It's read through net.rs, at most once a day (a failed try counts, so an offline computer doesn't ask before every
//! search), and only just before a service is used (`service_server`), never at startup or in the background. The copy
//! last read, with when it was fetched and last tried, is kept in the app's data folder, beside what app_data.rs
//! keeps but not one of the files the page may read or write. With no readable file the last copy applies (but a file
//! in a format newer than this app's clears it, see `refreshed`), and with no copy the defaults here: every service
//! on, on its first server.
//!
//! Adding a service (4.4 MET Norway, 4.9 map tiles): one line in `REGISTRY`, its hosts in net.rs's `HOSTS`, and the
//! translated words in the locales; then its code asks `service_server` for the server to use.

use std::{
    collections::HashMap,
    fs,
    future::Future,
    path::{Path, PathBuf},
    time::Duration,
    time::{SystemTime, UNIX_EPOCH},
};

use reqwest::Url;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::net;

/// One online service the app may contact.
struct Service {
    id: &'static str,
    /// Its servers, as base addresses, the first being the default. Each one's host is on net.rs's `HOSTS`.
    servers: &'static [&'static str],
}

/// Every service, and the only servers the switch may point it at. A new service also needs its words and its browser
/// entry in src/app/servicesStatus.ts (`SERVICE_WORDS`, `BROWSER_SERVICES`); a test below checks the id is there.
const REGISTRY: &[Service] = &[Service {
    id: "nominatim",
    servers: &["https://nominatim.openstreetmap.org"],
}];

/// Where the switch file is: this repo's `main`. The host is on net.rs's `HOSTS`.
const SWITCH_URL: &str = "https://raw.githubusercontent.com/mtsm-ph/storiiboard/main/services.json";
/// The one format this app reads; a file saying any other is ignored as a whole.
const VERSION: u64 = 1;
/// How long a try (a failed one too) stands before the next.
const DAY: u64 = 24 * 60 * 60;
/// The file in the app's data folder. Not in app_data.rs's `FILES`: only Rust reads and writes it.
const KEPT_FILE: &str = "service-switch.json";
/// What an error starts with when a service is off; the reason code follows. The page tells it apart by this.
pub(crate) const OFF_PREFIX: &str = "service-off:";
const NO_SERVICE: &str = "Storiiboard doesn't know that service.";

/// What the switch says about one service.
#[derive(Debug, Clone, PartialEq)]
enum Setting {
    On { server: Option<String> },
    Off { reason: String },
}

type Switch = HashMap<String, Setting>;

fn service(id: &str) -> Option<&'static Service> {
    REGISTRY.iter().find(|service| service.id == id)
}

/// A reason code is a short word the page maps to words; anything else is "unknown" (shown as "Turned off for now").
fn clean_reason(reason: Option<&str>) -> String {
    match reason {
        Some(code)
            if !code.is_empty()
                && code.len() <= 40
                && code
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') =>
        {
            code.to_owned()
        }
        _ => "unknown".to_owned(),
    }
}

/// The switch as the file says it, or nothing when it isn't JSON or its `version` isn't one this app knows. Inside it,
/// a service or state this code doesn't know, and a `server` off the list, are left out (the defaults stand).
fn parse(text: &str) -> Option<Switch> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    if value.get("version")?.as_u64()? != VERSION {
        return None;
    }
    let mut switch = Switch::new();
    for (id, entry) in value.get("services")?.as_object()? {
        let Some(known) = service(id) else { continue };
        let setting = match entry.get("state").and_then(serde_json::Value::as_str) {
            Some("on") => Setting::On {
                server: entry
                    .get("server")
                    .and_then(serde_json::Value::as_str)
                    .filter(|server| known.servers.contains(server))
                    .map(str::to_owned),
            },
            Some("off") => Setting::Off {
                reason: clean_reason(entry.get("reason").and_then(serde_json::Value::as_str)),
            },
            _ => continue,
        };
        switch.insert(id.clone(), setting);
    }
    Some(switch)
}

/// What the app keeps between runs.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
struct Kept {
    /// Unix seconds the file was last read successfully.
    fetched_at: Option<u64>,
    /// Unix seconds of the last try, whether it worked or not.
    tried_at: Option<u64>,
    /// The file as last read (re-parsed each time, so a newer app's rules apply to an older copy).
    copy: Option<String>,
}

impl Kept {
    fn switch(&self) -> Option<Switch> {
        self.copy.as_deref().and_then(parse)
    }

    /// Whether the file is to be read now: never tried, or the last try is a day old (or in the future, a clock set
    /// back, which would otherwise hold the next try off).
    fn due(&self, now: u64) -> bool {
        self.tried_at
            .is_none_or(|tried| tried > now || now - tried >= DAY)
    }
}

/// Whether a fetched file says a `version` this app doesn't know (a newer format): a whole number other than ours. A
/// version that isn't a whole number ("1", 1.0) is a typo in the file, not a newer format, so it keeps the last copy
/// rather than dropping an "off" that's in force.
fn unknown_version(answer: &serde_json::Value) -> bool {
    answer
        .get("version")
        .and_then(serde_json::Value::as_u64)
        .is_some_and(|version| version != VERSION)
}

/// Reads the file if a day has passed since the last try; `fetch` is how (the network in the app, a fixture in tests).
/// A file that can't be fetched, or comes back as something this app can't read (malformed, or without the shape),
/// leaves the last copy as it was. A file that is readable JSON but says a version this app doesn't know clears the
/// copy, so the defaults apply: an old "off" can't outlive the repo moving on to a newer format.
async fn refreshed<F, Fut>(mut kept: Kept, now: u64, fetch: F) -> Kept
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<serde_json::Value, String>>,
{
    if !kept.due(now) {
        return kept;
    }
    kept.tried_at = Some(now);
    if let Ok(answer) = fetch().await {
        let text = answer.to_string();
        if parse(&text).is_some() {
            kept.fetched_at = Some(now);
            kept.copy = Some(text);
        } else if unknown_version(&answer) {
            kept.fetched_at = Some(now);
            kept.copy = None;
        }
    }
    kept
}

/// The server to use for `id`, or the off reason as an error starting with `OFF_PREFIX`.
fn decide(switch: Option<&Switch>, id: &str) -> Result<String, String> {
    let known = service(id).ok_or_else(|| NO_SERVICE.to_owned())?;
    match switch.and_then(|switch| switch.get(id)) {
        Some(Setting::Off { reason }) => Err(format!("{OFF_PREFIX}{reason}")),
        Some(Setting::On {
            server: Some(server),
        }) => Ok(server.clone()),
        _ => Ok(known.servers[0].to_owned()),
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_secs())
}

/// Where the copy is kept; none when the app's data folder can't be found, and then the switch goes on without a disk.
fn kept_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(KEPT_FILE))
}

/// What was kept; a missing or unreadable file is nothing kept.
fn load(path: &Path) -> Kept {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// A temporary file renamed over the old one, so a crash mid-write leaves the old copy. A write that fails costs only
/// an earlier next try, so it isn't an error to the caller.
fn save(path: &Path, kept: &Kept) {
    let Ok(text) = serde_json::to_string(kept) else {
        return;
    };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let temp = path.with_extension("json.tmp");
    if fs::write(&temp, text).is_ok() {
        let _ = fs::rename(&temp, path);
    }
}

/// One read at a time, so two searches pressed together don't both ask GitHub; and what was last kept, in memory too,
/// so a disk that can't be written costs one fetch a launch, not one a search.
static READING: tauri::async_runtime::Mutex<Option<Kept>> =
    tauri::async_runtime::Mutex::const_new(None);

/// The longest the switch file may take, all told: a hung server costs a search this much once, and counts as a failed
/// try.
const FETCH_TIMEOUT: Duration = Duration::from_secs(5);

async fn fetch_switch() -> Result<serde_json::Value, String> {
    net::get_json_within(
        Url::parse(SWITCH_URL).expect("the switch address is a URL"),
        "",
        FETCH_TIMEOUT,
    )
    .await
}

/// Of what the disk and the memory kept, the one tried later. A disk try in the future (the clock set back while saves
/// fail) loses to memory's, or every search would fetch again until the clock passed it.
fn newer(disk: Kept, memory: Option<&Kept>, now: u64) -> Kept {
    match memory {
        Some(memory)
            if memory.tried_at.is_some()
                && (memory.tried_at > disk.tried_at
                    || disk.tried_at.is_some_and(|tried| tried > now)) =>
        {
            memory.clone()
        }
        _ => disk,
    }
}

/// The copy to go by: read the file if a day has passed since the last try, and keep the result in memory and (if there
/// is a disk) on disk. A write that fails costs only a repeated fetch in the next launch.
async fn consulted<F, Fut>(
    path: Option<&Path>,
    memory: &mut Option<Kept>,
    now: u64,
    fetch: F,
) -> Kept
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<serde_json::Value, String>>,
{
    let disk = path.map(load).unwrap_or_default();
    let before = newer(disk, memory.as_ref(), now);
    let kept = refreshed(before.clone(), now, fetch).await;
    if kept != before {
        if let Some(path) = path {
            save(path, &kept);
        }
    }
    *memory = Some(kept.clone());
    kept
}

/// The server a service's code is to use now, reading the switch file first if a day has passed. Err starting with
/// `OFF_PREFIX` is "turned off, for this reason": the caller makes no request and says why.
pub(crate) async fn service_server(app: &AppHandle, id: &str) -> Result<String, String> {
    service(id).ok_or_else(|| NO_SERVICE.to_owned())?;
    let path = kept_path(app);
    let mut memory = READING.lock().await;
    let kept = consulted(path.as_deref(), &mut memory, now(), fetch_switch).await;
    decide(kept.switch().as_ref(), id)
}

/// One service as Settings shows it.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatus {
    id: &'static str,
    /// The server in use now (the default, or the one the switch moved it to).
    server: String,
    /// "on", "off" or "unchecked" (no copy of the file has ever been read).
    state: &'static str,
    /// The reason code when off.
    reason: Option<String>,
}

fn statuses(kept: &Kept) -> Vec<ServiceStatus> {
    let switch = kept.switch();
    // "Not checked yet" means the file has never been read: no copy, even if a try (offline) was made.
    let unchecked = kept.copy.is_none();
    REGISTRY
        .iter()
        .map(|service| {
            let (server, state, reason) = match decide(switch.as_ref(), service.id) {
                Ok(server) => (server, "on", None),
                Err(off) => (
                    service.servers[0].to_owned(),
                    "off",
                    Some(off.trim_start_matches(OFF_PREFIX).to_owned()),
                ),
            };
            ServiceStatus {
                id: service.id,
                server,
                state: if unchecked { "unchecked" } else { state },
                reason: if unchecked { None } else { reason },
            }
        })
        .collect()
}

/// For Settings → Online services: what the switch says now, from what was last kept. Never reads the file itself: the
/// switch is read only just before a service is used.
#[tauri::command]
pub async fn services_status(app: AppHandle) -> Result<Vec<ServiceStatus>, String> {
    let memory = READING.lock().await;
    let disk = kept_path(&app).map(|path| load(&path)).unwrap_or_default();
    Ok(statuses(&newer(disk, memory.as_ref(), now())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    const NOMINATIM: &str = "https://nominatim.openstreetmap.org";

    fn on() -> String {
        r#"{ "version": 1, "services": { "nominatim": { "state": "on" } } }"#.to_owned()
    }

    fn off(reason: &str) -> String {
        format!(
            r#"{{ "version": 1, "services": {{ "nominatim": {{ "state": "off", "reason": "{reason}" }} }} }}"#
        )
    }

    fn json(text: &str) -> serde_json::Value {
        serde_json::from_str(text).expect("JSON")
    }

    fn nominatim(text: &str) -> Result<String, String> {
        decide(parse(text).as_ref(), "nominatim")
    }

    #[test]
    fn every_server_is_on_the_hosts_list() {
        for service in REGISTRY {
            for server in service.servers {
                assert!(net::allowed(&Url::parse(server).expect("URL")), "{server}");
            }
        }
        assert!(net::allowed(&Url::parse(SWITCH_URL).expect("URL")));
    }

    #[test]
    fn reads_the_shape() {
        assert_eq!(
            parse(&on()).expect("switch").get("nominatim"),
            Some(&Setting::On { server: None })
        );
        assert_eq!(nominatim(&on()), Ok(NOMINATIM.to_owned()));
    }

    #[test]
    fn off_says_why() {
        for reason in ["operator-request", "maintenance", "something-else"] {
            assert_eq!(
                nominatim(&off(reason)),
                Err(format!("{OFF_PREFIX}{reason}"))
            );
        }
        // No reason, or one that isn't a short code, is "unknown", still off.
        let bare = r#"{ "version": 1, "services": { "nominatim": { "state": "off" } } }"#;
        assert_eq!(nominatim(bare), Err(format!("{OFF_PREFIX}unknown")));
        assert_eq!(
            nominatim(&off("Words People See")),
            Err(format!("{OFF_PREFIX}unknown"))
        );
    }

    #[test]
    fn a_server_on_the_list_is_used_and_one_off_it_is_ignored() {
        let listed = format!(
            r#"{{ "version": 1, "services": {{ "nominatim": {{ "state": "on", "server": "{NOMINATIM}" }} }} }}"#
        );
        assert_eq!(nominatim(&listed), Ok(NOMINATIM.to_owned()));
        let elsewhere = r#"{ "version": 1, "services": { "nominatim": { "state": "on", "server": "https://evil.example" } } }"#;
        assert_eq!(nominatim(elsewhere), Ok(NOMINATIM.to_owned()));
    }

    #[test]
    fn what_it_does_not_know_is_ignored() {
        // A version this app doesn't know: the whole file.
        assert_eq!(
            parse(r#"{ "version": 2, "services": { "nominatim": { "state": "off" } } }"#),
            None
        );
        assert_eq!(parse(r#"{ "services": {} }"#), None);
        // Malformed.
        assert_eq!(parse("{ not json"), None);
        assert_eq!(parse(""), None);
        // An unknown service, field or state: the service stays as the defaults say.
        let odd = r#"{ "version": 1, "extra": 1, "services": {
            "tiles": { "state": "off" },
            "nominatim": { "state": "paused", "colour": "red" } } }"#;
        let switch = parse(odd).expect("switch");
        assert!(!switch.contains_key("tiles"));
        assert_eq!(decide(Some(&switch), "nominatim"), Ok(NOMINATIM.to_owned()));
        assert!(decide(Some(&switch), "tiles").is_err());
    }

    #[test]
    fn defaults_with_nothing_read() {
        assert_eq!(decide(None, "nominatim"), Ok(NOMINATIM.to_owned()));
    }

    #[test]
    fn a_fresh_copy_is_not_fetched_again_for_a_day() {
        let calls = Cell::new(0);
        let fetch = || {
            calls.set(calls.get() + 1);
            async { Ok(json(&on())) }
        };
        let first = tauri::async_runtime::block_on(refreshed(Kept::default(), 1000, fetch));
        assert_eq!(calls.get(), 1);
        assert_eq!(first.fetched_at, Some(1000));
        assert!(first.copy.is_some());
        let soon = tauri::async_runtime::block_on(refreshed(first.clone(), 1000 + DAY - 1, fetch));
        assert_eq!(calls.get(), 1);
        assert_eq!(soon, first);
        tauri::async_runtime::block_on(refreshed(first, 1000 + DAY, fetch));
        assert_eq!(calls.get(), 2);
    }

    #[test]
    fn a_failed_try_counts_and_the_last_copy_applies() {
        let calls = Cell::new(0);
        let fail = || {
            calls.set(calls.get() + 1);
            async { Err::<serde_json::Value, _>(net::NO_CONNECTION.to_owned()) }
        };
        let kept = Kept {
            fetched_at: Some(10),
            tried_at: Some(10),
            copy: Some(off("maintenance")),
        };
        let after = tauri::async_runtime::block_on(refreshed(kept.clone(), 10 + DAY, fail));
        assert_eq!(calls.get(), 1);
        assert_eq!(after.fetched_at, Some(10));
        assert_eq!(after.tried_at, Some(10 + DAY));
        assert_eq!(after.copy, kept.copy);
        // The failed try stands for a day: no second ask.
        let again = tauri::async_runtime::block_on(refreshed(after.clone(), 10 + DAY + 60, fail));
        assert_eq!(calls.get(), 1);
        assert_eq!(again, after);
        // And the last copy still decides.
        assert_eq!(
            decide(after.switch().as_ref(), "nominatim"),
            Err(format!("{OFF_PREFIX}maintenance"))
        );
    }

    #[test]
    fn no_copy_and_no_file_means_the_defaults() {
        let fail = || async { Err::<serde_json::Value, _>(net::NO_CONNECTION.to_owned()) };
        let kept = tauri::async_runtime::block_on(refreshed(Kept::default(), 5, fail));
        assert_eq!(kept.tried_at, Some(5));
        assert_eq!(kept.copy, None);
        assert_eq!(
            decide(kept.switch().as_ref(), "nominatim"),
            Ok(NOMINATIM.to_owned())
        );
    }

    #[test]
    fn a_file_that_cannot_be_read_does_not_replace_the_copy() {
        let kept = Kept {
            fetched_at: Some(1),
            tried_at: Some(1),
            copy: Some(off("operator-request")),
        };
        // Readable JSON without the shape: the last copy stays.
        let shapeless = || async { Ok(json(r#"{ "nope": 1 }"#)) };
        let after = tauri::async_runtime::block_on(refreshed(kept.clone(), 1 + DAY, shapeless));
        assert_eq!(after.copy, kept.copy);
        assert_eq!(after.fetched_at, Some(1));
        // A failed fetch (which is also what malformed JSON comes back as from net.rs): the same.
        let failed = || async { Err::<serde_json::Value, _>(net::ODD_ANSWER.to_owned()) };
        let after = tauri::async_runtime::block_on(refreshed(kept.clone(), 1 + DAY, failed));
        assert_eq!(after.copy, kept.copy);
    }

    #[test]
    fn a_version_this_app_does_not_know_clears_the_copy_so_the_defaults_apply() {
        let kept = Kept {
            fetched_at: Some(1),
            tried_at: Some(1),
            copy: Some(off("operator-request")),
        };
        let newer_format = || async { Ok(json(r#"{ "version": 2, "services": {} }"#)) };
        let after = tauri::async_runtime::block_on(refreshed(kept, 1 + DAY, newer_format));
        assert_eq!(after.copy, None);
        assert_eq!(after.tried_at, Some(1 + DAY));
        assert_eq!(
            decide(after.switch().as_ref(), "nominatim"),
            Ok(NOMINATIM.to_owned())
        );
    }

    #[test]
    fn a_version_that_is_not_a_whole_number_keeps_the_copy() {
        // A typo in the repo's file ("1", 1.0) isn't a newer format: an "off" in force stays.
        for typo in [
            r#"{ "version": "1", "services": {} }"#,
            r#"{ "version": 1.0, "services": {} }"#,
        ] {
            let kept = Kept {
                fetched_at: Some(1),
                tried_at: Some(1),
                copy: Some(off("operator-request")),
            };
            let answer = json(typo);
            let after =
                tauri::async_runtime::block_on(refreshed(kept, 1 + DAY, move || async move {
                    Ok(answer)
                }));
            assert_eq!(after.copy, Some(off("operator-request")), "{typo}");
            assert_eq!(after.tried_at, Some(1 + DAY));
        }
    }

    #[test]
    fn a_disk_try_in_the_future_loses_to_memory_while_saves_fail() {
        // The disk was last written at 5000; saves fail since, and the clock is set back to 1000.
        let disk = Kept {
            tried_at: Some(5000),
            ..Kept::default()
        };
        let memory = Kept {
            tried_at: Some(1000),
            ..Kept::default()
        };
        assert_eq!(newer(disk.clone(), Some(&memory), 1060), memory);
        // With the clock right, the disk's later try wins as before.
        assert_eq!(newer(disk.clone(), Some(&memory), 6000), disk);
        // Memory that was never tried never wins.
        assert_eq!(newer(disk.clone(), Some(&Kept::default()), 1060), disk);
    }

    #[test]
    fn a_save_that_fails_still_holds_the_next_fetch_off_for_a_day() {
        // A "folder" that is a file can't be written into: every save fails.
        let blocker = std::env::temp_dir().join(format!("switch-blocker-{}", std::process::id()));
        fs::write(&blocker, "x").expect("a file");
        let path = blocker.join(KEPT_FILE);
        let calls = Cell::new(0);
        let fetch = || {
            calls.set(calls.get() + 1);
            async { Ok(json(&on())) }
        };
        let mut memory = None;
        tauri::async_runtime::block_on(consulted(Some(&path), &mut memory, 1000, fetch));
        assert!(!path.exists());
        tauri::async_runtime::block_on(consulted(Some(&path), &mut memory, 1060, fetch));
        assert_eq!(calls.get(), 1);
        // No disk at all (the data folder not found) goes the same way.
        let mut memory = None;
        tauri::async_runtime::block_on(consulted(None, &mut memory, 1000, fetch));
        tauri::async_runtime::block_on(consulted(None, &mut memory, 1060, fetch));
        assert_eq!(calls.get(), 2);
        let _ = fs::remove_file(&blocker);
    }

    #[test]
    fn every_service_has_its_words_and_browser_entry() {
        let page = include_str!("../../src/app/servicesStatus.ts");
        for service in REGISTRY {
            assert!(
                page.contains(&format!("id: '{}'", service.id))
                    && page.contains(&format!("{}: {{ name", service.id)),
                "{} needs SERVICE_WORDS and BROWSER_SERVICES in src/app/servicesStatus.ts",
                service.id
            );
        }
    }

    #[test]
    fn a_clock_set_back_does_not_hold_the_next_try_off() {
        let kept = Kept {
            tried_at: Some(1_000_000),
            ..Kept::default()
        };
        assert!(kept.due(10));
    }

    #[test]
    fn status_is_unchecked_until_a_copy_of_the_file_has_been_read() {
        let never = statuses(&Kept::default());
        assert_eq!(never[0].state, "unchecked");
        // Tried offline, nothing read: still not checked.
        let offline = statuses(&Kept {
            tried_at: Some(1),
            ..Kept::default()
        });
        assert_eq!(offline[0].state, "unchecked");
        let off_now = statuses(&Kept {
            fetched_at: Some(1),
            tried_at: Some(1),
            copy: Some(off("operator-request")),
        });
        assert_eq!(off_now[0].state, "off");
        assert_eq!(off_now[0].reason.as_deref(), Some("operator-request"));
        let on_now = statuses(&Kept {
            fetched_at: Some(1),
            tried_at: Some(1),
            copy: Some(on()),
        });
        assert_eq!(on_now[0].state, "on");
        assert_eq!(on_now[0].server, NOMINATIM);
    }

    #[test]
    fn the_kept_copy_survives_a_restart() {
        let dir = std::env::temp_dir().join(format!("switch-{}-{}", std::process::id(), now()));
        let path = dir.join(KEPT_FILE);
        assert_eq!(load(&path), Kept::default());
        let kept = Kept {
            fetched_at: Some(3),
            tried_at: Some(4),
            copy: Some(on()),
        };
        save(&path, &kept);
        assert_eq!(load(&path), kept);
        // A kept file that isn't JSON reads as nothing kept.
        fs::write(&path, "{ not json").expect("write");
        assert_eq!(load(&path), Kept::default());
        // Only the folder this test made.
        let _ = fs::remove_dir_all(&dir);
    }
}
