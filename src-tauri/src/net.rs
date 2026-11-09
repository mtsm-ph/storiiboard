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
const HOSTS: &[&str] = &["nominatim.openstreetmap.org"];

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
    if !allowed(&url) {
        return Err(NOT_ALLOWED.to_owned());
    }
    let mut request = client()?.get(url);
    if !language.is_empty()
        && language.len() <= 35
        && language
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        request = request.header(reqwest::header::ACCEPT_LANGUAGE, language);
    }
    let response = request.send().await.map_err(|_| NO_CONNECTION.to_owned())?;
    if !allowed(response.url()) {
        return Err(NOT_ALLOWED.to_owned());
    }
    if !response.status().is_success() {
        return Err(status_error(response.status()));
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
    serde_json::from_slice(&bytes).map_err(|_| ODD_ANSWER.to_owned())
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
