//! The address search (3.4): a location's address looked up on OpenStreetMap's Nominatim, only when the person
//! presses Search (never as they type), at most one request a second for the whole app, through net.rs (the host
//! list, the app's User-Agent). The page caches every answer in the project (`lookups`, schema 11) and asks again only
//! when the person presses Search again, so this side keeps nothing.

use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use reqwest::Url;
use serde::Serialize;

use tauri::AppHandle;

use crate::{net, services};

/// The service's id in services.rs, whose switch can turn the search off or move it to another listed server.
const SERVICE: &str = "nominatim";
/// Nominatim's usage policy: an absolute maximum of one request a second.
const GAP: Duration = Duration::from_secs(1);
const MAX_RESULTS: usize = 5;
/// The longest search sent, in characters: an address is never longer.
const MAX_QUERY: usize = 300;
/// The longest a search waits its turn: a few searches in a row, never a backlog.
const MAX_QUEUE: Duration = Duration::from_secs(5);

pub(crate) const NO_QUERY: &str = "Type an address or a place name to search for.";

/// One place the search found: its name as the map service writes it, and where it is.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    pub name: String,
    pub latitude: f64,
    pub longitude: f64,
}

/// The search as typed, spaces run together and cut to `MAX_QUERY` characters; an error for nothing to search for.
fn cleaned(query: &str) -> Result<String, String> {
    let joined = query.split_whitespace().collect::<Vec<_>>().join(" ");
    if joined.is_empty() {
        return Err(NO_QUERY.to_owned());
    }
    Ok(joined.chars().take(MAX_QUERY).collect())
}

/// The search address on `server`, one of the servers listed in services.rs.
fn search_url(server: &str, query: &str) -> Url {
    let limit = MAX_RESULTS.to_string();
    Url::parse_with_params(
        &format!("{server}/search"),
        [
            ("q", query),
            ("format", "jsonv2"),
            ("limit", limit.as_str()),
        ],
    )
    .expect("the search address is a URL")
}

/// A coordinate from Nominatim's answer, which writes them as text; none outside `range`.
fn coordinate(value: Option<&serde_json::Value>, range: f64) -> Option<f64> {
    let number = match value? {
        serde_json::Value::String(text) => text.trim().parse::<f64>().ok()?,
        serde_json::Value::Number(number) => number.as_f64()?,
        _ => return None,
    };
    (number.is_finite() && number.abs() <= range).then_some(number)
}

/// The places in a search's answer, in its order; an entry without a name or a place on Earth is left out.
fn places(answer: &serde_json::Value) -> Result<Vec<Place>, String> {
    let list = answer
        .as_array()
        .ok_or_else(|| net::ODD_ANSWER.to_owned())?;
    Ok(list
        .iter()
        .filter_map(|entry| {
            let name = entry.get("display_name")?.as_str()?.trim();
            if name.is_empty() {
                return None;
            }
            Some(Place {
                name: name.chars().take(MAX_QUERY * 2).collect(),
                latitude: coordinate(entry.get("lat"), 90.0)?,
                longitude: coordinate(entry.get("lon"), 180.0)?,
            })
        })
        .take(MAX_RESULTS)
        .collect())
}

/// How long a request asked for `now` waits so the last one is at least `GAP` behind it, and books its own place:
/// two searches pressed together go a second apart, in order.
fn book(next_free: &mut Option<Instant>, now: Instant) -> Duration {
    let at = next_free.map_or(now, |free| free.max(now));
    *next_free = Some(at + GAP);
    at - now
}

static NEXT_FREE: Mutex<Option<Instant>> = Mutex::new(None);

/// Books this search's place in the queue, and says how long it waits; an error when the queue is a backlog.
fn reserve() -> Result<Duration, String> {
    {
        let mut next_free = NEXT_FREE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let now = Instant::now();
        // A queue longer than a few searches is something pressing far faster than a person: refused, not queued, so
        // no more than a few wait (each on a thread of its own).
        if next_free.is_some_and(|free| free.saturating_duration_since(now) > MAX_QUEUE) {
            return Err(net::BUSY.to_owned());
        }
        Ok(book(&mut next_free, now))
    }
}

/// Searches for `query`, the place names in `language` where the map has them. Asks the service switch first: a
/// service turned off answers with why (services::OFF_PREFIX) and nothing is sent.
#[tauri::command]
pub async fn address_search(
    app: AppHandle,
    query: String,
    language: String,
) -> Result<Vec<Place>, String> {
    let query = cleaned(&query)?;
    let server = services::service_server(&app, SERVICE).await?;
    let wait = reserve()?;
    if !wait.is_zero() {
        let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(wait)).await;
    }
    places(&net::get_json(search_url(&server, &query), &language).await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A real answer, recorded once (Nov 9, 2026) and shared with the page's tests; no test asks Nominatim itself.
    const RECORDED: &str =
        include_str!("../../src/core/net/recorded/nominatim-plaza-de-armas-cusco.json");

    #[test]
    fn reads_a_recorded_answer() {
        let answer: serde_json::Value = serde_json::from_str(RECORDED).expect("recorded JSON");
        let found = places(&answer).expect("places");
        assert_eq!(found.len(), 5);
        assert!(found[0].name.starts_with("Plaza de Armas, Hauqaypata"));
        assert!((found[0].latitude - -13.5167674).abs() < 1e-9);
        assert!((found[0].longitude - -71.9787787).abs() < 1e-9);
    }

    #[test]
    fn leaves_out_what_isnt_a_place() {
        let answer = serde_json::json!([
            { "display_name": "Nowhere", "lat": "91", "lon": "0" },
            { "display_name": "", "lat": "1", "lon": "1" },
            { "display_name": "No coordinates" },
            { "display_name": "Lima", "lat": "-12.0464", "lon": "-77.0428" },
            { "display_name": "Numbers", "lat": 1.5, "lon": 2.5 }
        ]);
        let found = places(&answer).expect("places");
        assert_eq!(
            found.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(),
            ["Lima", "Numbers"]
        );
        assert_eq!(
            places(&serde_json::json!({ "error": "x" })),
            Err(net::ODD_ANSWER.to_owned())
        );
    }

    #[test]
    fn sends_the_search_as_typed_and_no_more() {
        assert_eq!(
            cleaned("  Plaza  de\tArmas \n"),
            Ok("Plaza de Armas".to_owned())
        );
        assert_eq!(cleaned("   "), Err(NO_QUERY.to_owned()));
        assert_eq!(cleaned(&"a".repeat(1000)).map(|q| q.len()), Ok(MAX_QUERY));
        let url = search_url("https://nominatim.openstreetmap.org", "Calle 5 & 6, Cusco");
        assert!(net::allowed(&url));
        assert_eq!(
            url.query(),
            Some("q=Calle+5+%26+6%2C+Cusco&format=jsonv2&limit=5")
        );
    }

    #[test]
    fn refuses_a_backlog_before_it_asks() {
        // Searches booked well ahead (something pressing far faster than a person): the next is refused, unsent.
        *NEXT_FREE.lock().expect("lock") = Some(Instant::now() + MAX_QUEUE * 2);
        let answer = reserve();
        *NEXT_FREE.lock().expect("lock") = None;
        assert_eq!(answer, Err(net::BUSY.to_owned()));
    }

    #[test]
    fn keeps_a_second_between_requests() {
        let start = Instant::now();
        let mut next_free = None;
        assert_eq!(book(&mut next_free, start), Duration::ZERO);
        // Two more pressed straight after go one and two seconds later.
        assert_eq!(book(&mut next_free, start), GAP);
        assert_eq!(book(&mut next_free, start), GAP * 2);
        // Long after, none waits.
        assert_eq!(book(&mut next_free, start + GAP * 10), Duration::ZERO);
    }
}
