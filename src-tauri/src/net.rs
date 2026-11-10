//! The one way out to the network (3.4; Kevin, Nov 9). Every request the app makes goes through here: one HTTP client
//! (reqwest, with rustls and ring as Tauri's updater plugin uses them, and the OS's own certificate store), only to the
//! hosts on `HOSTS`, only over HTTPS, with a generic app name as the User-Agent (never a person's name or email). A
//! host is added to the list in code, with the rule it follows, or the request is refused before it leaves.
//! Everything except lookups, cloud links and publishing works offline (CLAUDE.md), so callers treat a failure here
//! as "not now", never as lost work.

use std::{sync::OnceLock, time::Duration};

use reqwest::{redirect, Client, StatusCode, Url};

/// Who's asking, as services such as Nominatim require: the app and where it lives, nothing about the person.
pub(crate) const USER_AGENT: &str = concat!(
    "Storiiboard/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/mtsm-ph/storiiboard)"
);

/// Every host the app may reach, and the rule each follows:
/// - `nominatim.openstreetmap.org`: the address search (3.4), only when the person presses Search, at most one request
///   a second (geocode.rs), every answer cached in the project (`lookups`).
/// - `api.met.no`: the weather (4.4, weather.rs), MET Norway's Locationforecast, only when a call sheet is opened on a
///   day or its Refresh is pressed, coordinates cut to 4 decimals, never again for a place before the answer's
///   `Expires` (the page keeps the answer in the project, `lookups`); a 403 or 429 means stop, never retried. Credit
///   "Data from MET Norway" (CC BY 4.0) on the sheet.
/// - `raw.githubusercontent.com`: the service switch file (4.0, services.rs), `services.json` on this repo's `main`,
///   read at most once a day and only just before an online service is used; it can turn a service off or move it
///   to another server on the code's list, never add a host.
const HOSTS: &[&str] = &[
    "nominatim.openstreetmap.org",
    "api.met.no",
    "raw.githubusercontent.com",
];

/// Whether a request may go to `url`: HTTPS, to a host on the list, on the default port, with no name or password.
pub(crate) fn allowed(url: &Url) -> bool {
    url.scheme() == "https"
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().is_some_and(|host| HOSTS.contains(&host))
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

fn client() -> Result<&'static Client, String> {
    static CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            // rustls needs one crypto provider for the process; ring, as the updater plugin installs it. Whichever
            // installs first wins, so a second install failing is fine.
            if rustls::crypto::CryptoProvider::get_default().is_none() {
                let _ = rustls::crypto::ring::default_provider().install_default();
            }
            Client::builder()
                .user_agent(USER_AGENT)
                .https_only(true)
                // A redirect is followed only to a host on the list too, and only a few times.
                .redirect(redirect::Policy::custom(|attempt| {
                    if attempt.previous().len() < 3 && allowed(attempt.url()) {
                        attempt.follow()
                    } else {
                        attempt.stop()
                    }
                }))
                .connect_timeout(CONNECT_TIMEOUT)
                .timeout(TIMEOUT)
                .build()
                .map_err(|_| NO_CONNECTION.to_owned())
        })
        .as_ref()
        .map_err(Clone::clone)
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
