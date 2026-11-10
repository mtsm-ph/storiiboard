//! The one way out to the network (3.4; Kevin, Nov 9). Every request the app makes goes through here: one HTTP client
//! (reqwest, with rustls and ring as Tauri's updater plugin uses them, and the OS's own certificate store), only to the
//! hosts on `HOSTS`, only over HTTPS, with a generic app name as the User-Agent (never a person's name or email). A
//! host is added to the list in code, with the rule it follows, or the request is refused before it leaves.
//! Everything except lookups, cloud links and publishing works offline (CLAUDE.md), so callers treat a failure here
//! as "not now", never as lost work.

use std::{
    sync::{Mutex, OnceLock},
    time::Duration,
};

use reqwest::{redirect, Client, StatusCode, Url};

/// Who's asking, as services such as Nominatim require: the app and where it lives, nothing about the person.
pub(crate) const USER_AGENT: &str = concat!(
    "Storiiboard/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/mtsm-ph/storiiboard)"
);

/// Every host the app may reach, and the rule each follows:
/// - `nominatim.openstreetmap.org`: the address search (3.4), only when the person presses Search, and the nearest
///   hospital (4.5, hospital.rs), only when the person presses Find nearest hospital; at most one request a second
///   for both together (geocode.rs), every answer cached in the project (`lookups`).
/// - `api.met.no`: the weather (4.4, weather.rs), MET Norway's Locationforecast, only when a call sheet is opened on a
///   day or its Refresh is pressed, coordinates cut to 4 decimals, never again for a place before the answer's
///   `Expires` (the page keeps the answer in the project, `lookups`); a 403 or 429 means stop, never retried. Credit
///   "Data from MET Norway" (CC BY 4.0) on the sheet.
/// - `raw.githubusercontent.com`: the service switch file (4.0, services.rs), `services.json` on this repo's `main`,
///   read at most once a day and only just before an online service is used; it can turn a service off or move it
///   to another server on the code's list, never add a host.
/// - `tile.openstreetmap.org`: the map's tiles (4.9, tiles.rs), under OpenStreetMap's tile policy: this app's
///   User-Agent, only the tiles of the map being viewed (no prefetching, no bulk or offline download), at most 2
///   requests at a time, zoom 0 to 19, cache headers honoured (7 days with none, validators sent when renewing), and
///   the credit "© OpenStreetMap contributors" always visible on the map. A tile server of the person's own, set in
///   Settings, is one more host for tiles only (`get_bytes`' `extra_host`), never for anything else.
const HOSTS: &[&str] = &[
    "nominatim.openstreetmap.org",
    "api.met.no",
    "raw.githubusercontent.com",
    "tile.openstreetmap.org",
];

/// Whether `host` is one the app already reaches for its own services (a tile server of one's own may not be).
pub(crate) fn is_listed(host: &str) -> bool {
    HOSTS.contains(&host)
}

/// Whether a request may go to `url`: HTTPS, to a host on the list, on the default port, with no name or password.
pub(crate) fn allowed(url: &Url) -> bool {
    allowed_with(url, None)
}

/// As `allowed`, with one more host (the person's own tile server, for tiles only).
pub(crate) fn allowed_with(url: &Url, extra_host: Option<&str>) -> bool {
    url.scheme() == "https"
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url
            .host_str()
            .is_some_and(|host| HOSTS.contains(&host) || extra_host == Some(host))
}

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const TIMEOUT: Duration = Duration::from_secs(20);
/// The most an answer may be: a search's few results are a few kilobytes.
const MAX_ANSWER: usize = 2 * 1024 * 1024;

pub(crate) const NO_CONNECTION: &str =
    "Storiiboard couldn't reach the service. Check the connection and try again.";
pub(crate) const BUSY: &str = "The service is busy. Try again in a minute.";
pub(crate) const ODD_ANSWER: &str = "The service sent an answer Storiiboard can't read.";
const NOT_ALLOWED: &str = "Storiiboard doesn't connect to that address.";

/// A client. `own_host` is a tile server of the person's own: its redirects may stay on that host and nowhere else
/// (not on another host of the list); with none, a redirect is followed only to a host on the list.
fn build_client(own_host: Option<String>) -> Result<Client, String> {
    // rustls needs one crypto provider for the process; ring, as the updater plugin installs it. Whichever
    // installs first wins, so a second install failing is fine.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    Client::builder()
        .user_agent(USER_AGENT)
        .https_only(true)
        // A redirect is followed only a few times.
        .redirect(redirect::Policy::custom(move |attempt| {
            let stays = match &own_host {
                Some(host) => {
                    attempt.url().host_str() == Some(host.as_str())
                        && allowed_with(attempt.url(), Some(host))
                }
                None => allowed(attempt.url()),
            };
            if attempt.previous().len() < 3 && stays {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(TIMEOUT)
        .build()
        .map_err(|_| NO_CONNECTION.to_owned())
}

fn client() -> Result<&'static Client, String> {
    static CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| build_client(None))
        .as_ref()
        .map_err(Clone::clone)
}

/// The client for a tile server of the person's own: kept while the same host is asked for again.
fn own_client(host: &str) -> Result<Client, String> {
    static OWN: Mutex<Option<(String, Client)>> = Mutex::new(None);
    let mut kept = OWN.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((kept_host, client)) = kept.as_ref() {
        if kept_host == host {
            return Ok(client.clone());
        }
    }
    let client = build_client(Some(host.to_owned()))?;
    *kept = Some((host.to_owned(), client.clone()));
    Ok(client)
}

/// The words for a status that isn't success.
fn status_error(status: StatusCode) -> String {
    if status == StatusCode::TOO_MANY_REQUESTS || status == StatusCode::SERVICE_UNAVAILABLE {
        BUSY.to_owned()
    } else {
        ODD_ANSWER.to_owned()
    }
}

/// GETs `url` and reads its JSON answer, asking for `language` first (an `Accept-Language` value such as `es`).
pub(crate) async fn get_json(url: Url, language: &str) -> Result<serde_json::Value, String> {
    get_json_within(url, language, TIMEOUT).await
}

/// As `get_json`, with `limit` as the most the whole request may take (connecting and reading the answer), for a
/// caller that mustn't make a person wait as long as the usual limit.
pub(crate) async fn get_json_within(
    url: Url,
    language: &str,
    limit: Duration,
) -> Result<serde_json::Value, String> {
    Ok(get_answer(url, language, limit, None, status_error)
        .await?
        .json)
}

/// A JSON answer with the headers a caching caller needs (weather.rs: `Expires`, `Date`), as the server wrote them.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Answer {
    pub json: serde_json::Value,
    pub expires: Option<String>,
    pub last_modified: Option<String>,
    /// The server's own clock when it answered, so an expiry can be counted from it rather than the local clock.
    pub date: Option<String>,
    /// A 304 to a request sent with `If-Modified-Since`: nothing changed, `json` is null.
    pub not_modified: bool,
}

/// As `get_json`, with the `Expires` and `Last-Modified` headers, and `words` choosing the error for a status that
/// isn't success (a caller whose service says "stop asking" with 403 or 429 words that its own way).
/// `modified_since` is an HTTP date sent as `If-Modified-Since`, for a caller renewing what it already holds.
pub(crate) async fn get_json_with_headers(
    url: Url,
    modified_since: Option<String>,
    words: fn(StatusCode) -> String,
) -> Result<Answer, String> {
    get_answer(url, "", TIMEOUT, modified_since, words).await
}

async fn get_answer(
    url: Url,
    language: &str,
    limit: Duration,
    modified_since: Option<String>,
    words: fn(StatusCode) -> String,
) -> Result<Answer, String> {
    if !allowed(&url) {
        return Err(NOT_ALLOWED.to_owned());
    }
    let mut request = client()?.get(url).timeout(limit.min(TIMEOUT));
    if !language.is_empty()
        && language.len() <= 35
        && language
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        request = request.header(reqwest::header::ACCEPT_LANGUAGE, language);
    }
    let asked_if_modified = modified_since.is_some();
    if let Some(date) = modified_since {
        request = request.header(reqwest::header::IF_MODIFIED_SINCE, date);
    }
    let response = request.send().await.map_err(|_| NO_CONNECTION.to_owned())?;
    if !allowed(response.url()) {
        return Err(NOT_ALLOWED.to_owned());
    }
    let header = |name: reqwest::header::HeaderName| {
        response
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned)
    };
    let expires = header(reqwest::header::EXPIRES);
    let last_modified = header(reqwest::header::LAST_MODIFIED);
    let date = header(reqwest::header::DATE);
    if asked_if_modified && response.status() == StatusCode::NOT_MODIFIED {
        return Ok(Answer {
            json: serde_json::Value::Null,
            expires,
            last_modified,
            date,
            not_modified: true,
        });
    }
    if !response.status().is_success() {
        return Err(words(response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_ANSWER as u64)
    {
        return Err(ODD_ANSWER.to_owned());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| NO_CONNECTION.to_owned())?;
    if bytes.len() > MAX_ANSWER {
        return Err(ODD_ANSWER.to_owned());
    }
    Ok(Answer {
        json: serde_json::from_slice(&bytes).map_err(|_| ODD_ANSWER.to_owned())?,
        expires,
        last_modified,
        date,
        not_modified: false,
    })
}

/// The most a map tile may be.
const MAX_TILE: usize = 1024 * 1024;

/// What a renewing caller already holds, sent back as `If-None-Match` and `If-Modified-Since`.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct Validators {
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

/// A binary answer (a map tile) with the headers a cache needs, as the server wrote them.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct Bytes {
    pub bytes: Vec<u8>,
    pub cache_control: Option<String>,
    pub expires: Option<String>,
    pub date: Option<String>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    /// A 304 to a request sent with validators: nothing changed, `bytes` is empty.
    pub not_modified: bool,
}

/// GETs `url` as bytes (4.9, a map tile): the same client, HTTPS and host list as every request, plus `extra_host`
/// when given. `held` is sent as the conditional headers when it has any.
pub(crate) async fn get_bytes(
    url: Url,
    extra_host: Option<&str>,
    held: &Validators,
) -> Result<Bytes, String> {
    if !allowed_with(&url, extra_host) {
        return Err(NOT_ALLOWED.to_owned());
    }
    let client = match extra_host {
        Some(host) => own_client(host)?,
        None => client()?.clone(),
    };
    let mut request = client.get(url);
    let mut conditional = false;
    // Header values that aren't plain text are not sent (reqwest would refuse them), never an error.
    if let Some(etag) = held.etag.as_deref().filter(|v| v.is_ascii()) {
        request = request.header(reqwest::header::IF_NONE_MATCH, etag);
        conditional = true;
    }
    if let Some(date) = held.last_modified.as_deref().filter(|v| v.is_ascii()) {
        request = request.header(reqwest::header::IF_MODIFIED_SINCE, date);
        conditional = true;
    }
    let response = request.send().await.map_err(|_| NO_CONNECTION.to_owned())?;
    if !allowed_with(response.url(), extra_host) {
        return Err(NOT_ALLOWED.to_owned());
    }
    let header = |name: reqwest::header::HeaderName| {
        response
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned)
    };
    let mut answer = Bytes {
        cache_control: header(reqwest::header::CACHE_CONTROL),
        expires: header(reqwest::header::EXPIRES),
        date: header(reqwest::header::DATE),
        etag: header(reqwest::header::ETAG),
        last_modified: header(reqwest::header::LAST_MODIFIED),
        ..Bytes::default()
    };
    if conditional && response.status() == StatusCode::NOT_MODIFIED {
        answer.not_modified = true;
        return Ok(answer);
    }
    if !response.status().is_success() {
        return Err(status_error(response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_TILE as u64)
    {
        return Err(ODD_ANSWER.to_owned());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| NO_CONNECTION.to_owned())?;
    if bytes.len() > MAX_TILE {
        return Err(ODD_ANSWER.to_owned());
    }
    answer.bytes = bytes.to_vec();
    Ok(answer)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(text: &str) -> Url {
        Url::parse(text).expect("a URL")
    }

    #[test]
    fn only_the_listed_hosts_over_https() {
        assert!(allowed(&url(
            "https://nominatim.openstreetmap.org/search?q=x"
        )));
        assert!(!allowed(&url("http://nominatim.openstreetmap.org/search")));
        assert!(!allowed(&url(
            "https://nominatim.openstreetmap.org:8443/search"
        )));
        assert!(!allowed(&url("https://user@nominatim.openstreetmap.org/")));
        assert!(!allowed(&url(
            "https://evil.example/nominatim.openstreetmap.org"
        )));
        assert!(!allowed(&url(
            "https://nominatim.openstreetmap.org.evil.example/"
        )));
        assert!(!allowed(&url("https://openstreetmap.org/")));
    }

    #[test]
    fn the_switch_file_host_is_allowed_only_over_https() {
        assert!(allowed(&url(
            "https://raw.githubusercontent.com/mtsm-ph/storiiboard/main/services.json"
        )));
        assert!(!allowed(&url(
            "http://raw.githubusercontent.com/mtsm-ph/storiiboard/main/services.json"
        )));
        assert!(!allowed(&url("https://githubusercontent.com/")));
        assert!(!allowed(&url("https://github.com/mtsm-ph/storiiboard")));
    }

    #[test]
    fn the_weather_host_is_allowed_only_over_https() {
        assert!(allowed(&url(
            "https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=1&lon=2"
        )));
        assert!(!allowed(&url("http://api.met.no/weatherapi/")));
        assert!(!allowed(&url("https://met.no/")));
        assert!(!allowed(&url("https://api.met.no.evil.example/")));
    }

    #[test]
    fn the_tile_host_is_allowed_only_over_https() {
        assert!(allowed(&url("https://tile.openstreetmap.org/16/1/2.png")));
        assert!(!allowed(&url("http://tile.openstreetmap.org/16/1/2.png")));
        assert!(!allowed(&url(
            "https://a.tile.openstreetmap.org/16/1/2.png"
        )));
        assert!(!allowed(&url(
            "https://tile.openstreetmap.org.evil.example/"
        )));
    }

    #[test]
    fn an_extra_host_is_that_one_host_over_https_only() {
        let own = Some("tiles.example.org");
        assert!(allowed_with(
            &url("https://tiles.example.org/1/2/3.png"),
            own
        ));
        assert!(!allowed_with(
            &url("https://tiles.example.org/1/2/3.png"),
            None
        ));
        assert!(!allowed_with(
            &url("http://tiles.example.org/1/2/3.png"),
            own
        ));
        assert!(!allowed_with(
            &url("https://other.example.org/1/2/3.png"),
            own
        ));
        assert!(!allowed_with(
            &url("https://tiles.example.org:8443/1/2/3.png"),
            own
        ));
        // The listed hosts stay allowed.
        assert!(allowed_with(&url("https://api.met.no/x"), own));
    }

    #[test]
    fn a_tile_host_off_the_list_is_refused_before_anything_is_sent() {
        let answer = tauri::async_runtime::block_on(get_bytes(
            url("https://example.com/1/2/3.png"),
            None,
            &Validators::default(),
        ));
        assert_eq!(answer, Err(NOT_ALLOWED.to_owned()));
    }

    #[test]
    fn the_user_agent_names_the_app_and_nobody() {
        assert!(USER_AGENT.starts_with("Storiiboard/"));
        assert!(!USER_AGENT.contains('@'));
    }

    #[test]
    fn a_busy_service_says_so() {
        assert_eq!(status_error(StatusCode::TOO_MANY_REQUESTS), BUSY);
        assert_eq!(status_error(StatusCode::SERVICE_UNAVAILABLE), BUSY);
        assert_eq!(status_error(StatusCode::NOT_FOUND), ODD_ANSWER);
    }

    #[test]
    fn a_host_off_the_list_is_refused_before_anything_is_sent() {
        let answer = tauri::async_runtime::block_on(get_json(url("https://example.com/"), "en"));
        assert_eq!(answer, Err(NOT_ALLOWED.to_owned()));
    }
}
