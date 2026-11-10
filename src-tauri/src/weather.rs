//! The forecast for a call sheet (4.4; Kevin, Nov 9 and 10): MET Norway's Locationforecast 2.0 (api.met.no), free for any
//! use, credit "Data from MET Norway" (CC BY 4.0) on the sheet. Its terms, kept here: coordinates cut to 4 decimals,
//! the app's identifying User-Agent (net.rs), and no new request for a place before the answer's `Expires`, which the
//! page enforces from its cache in the project (`lookups`, kind `weather`). A 403 or 429 means stop asking: it's an
//! error the page words, with no retry and nothing cached. The answer is reduced here to what the sheet needs, so the
//! page and the project never hold the whole of it.

use std::{
    future::Future,
    time::{SystemTime, UNIX_EPOCH},
};

use reqwest::{StatusCode, Url};
use serde::Serialize;
use tauri::AppHandle;

use crate::{net, services};

/// The service's id in services.rs, whose switch can turn the forecast off or move it to another listed server.
const SERVICE: &str = "met-norway";
/// Without a readable `Expires`, an answer stands for an hour.
const DEFAULT_STAY: i64 = 60 * 60;
/// The most entries kept: ten days of hourly and then six-hourly entries is about 130.
const MAX_ENTRIES: usize = 400;

/// What a 403 or 429 starts with, the status following (`weather-refused:429`): the page words it
/// (`error.weatherRefused`), remembers it for a while, and doesn't ask again meanwhile. Like services.rs's `OFF_PREFIX`.
pub(crate) const REFUSED_PREFIX: &str = "weather-refused:";
const BAD_PLACE: &str = "That place isn't on Earth.";

/// One moment of the forecast, reduced.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// UTC, as MET writes it (`2026-11-17T12:00:00Z`).
    pub time: String,
    /// °C.
    pub temperature: Option<f64>,
    /// m/s.
    pub wind: Option<f64>,
    /// mm over the hour after `time`, when MET gives it (hourly entries, the first days).
    #[serde(rename = "rain1h")]
    pub rain_1h: Option<f64>,
    /// mm over the six hours after `time`, when MET gives it.
    #[serde(rename = "rain6h")]
    pub rain_6h: Option<f64>,
    /// MET's symbol code (`lightrain`, `partlycloudy_day`) for the hour after `time`; the page makes words of it.
    #[serde(rename = "symbol1h")]
    pub symbol_1h: Option<String>,
    /// The same for the six hours after `time`.
    #[serde(rename = "symbol6h")]
    pub symbol_6h: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Forecast {
    /// ISO 8601 UTC: the page asks again only after this.
    pub expires: String,
    pub last_modified: Option<String>,
    pub fetched_at: String,
    /// The answer to a renewal that said nothing changed (304): `forecast` is empty and the page keeps what it holds.
    pub not_modified: bool,
    pub forecast: Vec<Entry>,
}

/// A coordinate cut to 4 decimals (about 11 m), as MET's terms ask; none for NaN or outside `range`.
fn rounded(value: f64, range: f64) -> Option<f64> {
    // Half away from zero, as the page rounds too, so its cache key is the place that was asked.
    (value.is_finite() && value.abs() <= range).then(|| (value * 10_000.0).round() / 10_000.0 + 0.0)
}

/// The compact forecast's address on `server`, one of the servers listed in services.rs.
fn forecast_url(server: &str, latitude: f64, longitude: f64) -> Url {
    Url::parse_with_params(
        &format!("{server}/compact"),
        [
            ("lat", format!("{latitude:.4}")),
            ("lon", format!("{longitude:.4}")),
        ],
    )
    .expect("the forecast address is a URL")
}

fn number(value: Option<&serde_json::Value>) -> Option<f64> {
    value?.as_f64().filter(|n| n.is_finite())
}

/// `2026-11-17T12:00:00Z` and nothing else: the one shape MET writes, checked so a stranger's text is never kept.
fn is_moment(text: &str) -> bool {
    let b = text.as_bytes();
    b.len() == 20
        && b[19] == b'Z'
        && b[4] == b'-'
        && b[7] == b'-'
        && b[10] == b'T'
        && b[13] == b':'
        && b[16] == b':'
        && [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18]
            .iter()
            .all(|&i| b[i].is_ascii_digit())
}

/// A symbol code as MET writes it: lowercase words, digits and underscores.
fn is_symbol(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= 40
        && text
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

/// One of MET's spans (`next_1_hours`, `next_6_hours`) as its precipitation and symbol.
fn span(data: &serde_json::Value, name: &str) -> (Option<f64>, Option<String>) {
    let span = data.get(name);
    (
        number(
            span.and_then(|s| s.get("details"))
                .and_then(|d| d.get("precipitation_amount")),
        ),
        span.and_then(|s| s.get("summary"))
            .and_then(|s| s.get("symbol_code"))
            .and_then(serde_json::Value::as_str)
            .filter(|s| is_symbol(s))
            .map(str::to_owned),
    )
}

/// The forecast's entries from MET's answer: each time with its temperature and wind, and the precipitation and symbol
/// of the hour and of the six hours that follow, both kept: the page works out what each entry covers from the gap to
/// the next. An entry without a time is left out; an answer without a timeseries, or with nothing left, is one the app
/// can't read.
fn reduce(answer: &serde_json::Value) -> Result<Vec<Entry>, String> {
    let series = answer
        .get("properties")
        .and_then(|p| p.get("timeseries"))
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| net::ODD_ANSWER.to_owned())?;
    let entries: Vec<Entry> = series
        .iter()
        .filter_map(|item| {
            let time = item.get("time")?.as_str().filter(|t| is_moment(t))?;
            let data = item.get("data")?;
            let details = data.get("instant").and_then(|i| i.get("details"));
            let (rain_1h, symbol_1h) = span(data, "next_1_hours");
            let (rain_6h, symbol_6h) = span(data, "next_6_hours");
            Some(Entry {
                time: time.to_owned(),
                temperature: number(details.and_then(|d| d.get("air_temperature"))),
                wind: number(details.and_then(|d| d.get("wind_speed"))),
                rain_1h,
                rain_6h,
                symbol_1h,
                symbol_6h,
            })
        })
        .take(MAX_ENTRIES)
        .collect();
    if entries.is_empty() {
        return Err(net::ODD_ANSWER.to_owned());
    }
    Ok(entries)
}

/// Days since 1970-01-01 of a calendar date (Howard Hinnant's civil-days algorithm), proleptic Gregorian.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The calendar date of a day count (the inverse of `days_from_civil`).
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(month <= 2), month, day)
}

/// Unix seconds as `2026-11-17T12:00:00Z`.
fn iso(seconds: i64) -> String {
    let (year, month, day) = civil_from_days(seconds.div_euclid(86_400));
    let rest = seconds.rem_euclid(86_400);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rest / 3_600,
        rest % 3_600 / 60,
        rest % 60
    )
}

/// An HTTP date (`Tue, 17 Nov 2026 12:30:00 GMT`, the one form HTTP/1.1 requires) as unix seconds; none for any other.
fn http_date(text: &str) -> Option<i64> {
    let words: Vec<&str> = text.split_whitespace().collect();
    let [_, day, month, year, time, "GMT"] = words.as_slice() else {
        return None;
    };
    let month = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]
    .iter()
    .position(|name| name == month)? as i64
        + 1;
    let mut clock = time.split(':');
    let (hour, minute, second): (i64, i64, i64) = (
        clock.next()?.parse().ok()?,
        clock.next()?.parse().ok()?,
        clock.next()?.parse().ok()?,
    );
    let (day, year): (i64, i64) = (day.parse().ok()?, year.parse().ok()?);
    if clock.next().is_some()
        || !(1..=31).contains(&day)
        || !(1970..=9999).contains(&year)
        || hour > 23
        || minute > 59
        || second > 60
    {
        return None;
    }
    Some(days_from_civil(year, month, day) * 86_400 + hour * 3_600 + minute * 60 + second)
}

/// An ISO moment as written by `iso` (and MET: `2026-11-16T11:42:10Z`) as unix seconds.
fn from_iso(text: &str) -> Option<i64> {
    if !is_moment(text) {
        return None;
    }
    let n = |from: usize, to: usize| text[from..to].parse::<i64>().ok();
    let (month, day, hour, minute, second) =
        (n(5, 7)?, n(8, 10)?, n(11, 13)?, n(14, 16)?, n(17, 19)?);
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || minute > 59
        || second > 60
    {
        return None;
    }
    Some(days_from_civil(n(0, 4)?, month, day) * 86_400 + hour * 3_600 + minute * 60 + second)
}

/// Unix seconds as an HTTP date (`Tue, 17 Nov 2026 12:30:00 GMT`), for `If-Modified-Since`.
fn to_http_date(seconds: i64) -> String {
    const DAYS: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let days = seconds.div_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let rest = seconds.rem_euclid(86_400);
    format!(
        "{}, {day:02} {} {year:04} {:02}:{:02}:{:02} GMT",
        DAYS[usize::try_from((days + 4).rem_euclid(7)).unwrap_or(0)],
        MONTHS[usize::try_from(month - 1).unwrap_or(0)],
        rest / 3_600,
        rest % 3_600 / 60,
        rest % 60
    )
}

/// When the answer is out of date, as ISO. With `Expires` and the server's own `Date`, it is how long the server meant
/// it to stand, counted from `now`, so a local clock that is fast or slow doesn't defeat it; with `Expires` alone, that;
/// with neither readable, an hour from `now`.
fn expiry(expires: Option<&str>, date: Option<&str>, now: i64) -> String {
    let expires = expires.and_then(http_date);
    let at = match (expires, date.and_then(http_date)) {
        (Some(expires), Some(date)) => Some(now + (expires - date).max(0)),
        (expires, _) => expires,
    };
    iso(at.unwrap_or(now + DEFAULT_STAY))
}

/// The words for a status that isn't success: a 403 or 429 is MET saying stop (its status follows `REFUSED_PREFIX`).
fn status_words(status: StatusCode) -> String {
    if status == StatusCode::FORBIDDEN || status == StatusCode::TOO_MANY_REQUESTS {
        format!("{REFUSED_PREFIX}{}", status.as_u16())
    } else if status == StatusCode::SERVICE_UNAVAILABLE {
        net::BUSY.to_owned()
    } else {
        net::ODD_ANSWER.to_owned()
    }
}

fn now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| i64::try_from(since.as_secs()).unwrap_or(0))
}

/// The forecast for a place. `server` is the switch's answer (services::service_server), so a service turned off is
/// an error here and `fetch` is never called; `fetch` is the network in the app and a recorded answer in tests.
/// `modified_since` is the `last_modified` of a forecast the page holds and is renewing (ISO): it goes as
/// `If-Modified-Since`, and a 304 answers `not_modified` with the new expiry and no entries.
async fn forecast_with<F, Fut>(
    server: Result<String, String>,
    latitude: f64,
    longitude: f64,
    modified_since: Option<&str>,
    clock: impl Fn() -> i64,
    fetch: F,
) -> Result<Forecast, String>
where
    F: FnOnce(Url, Option<String>) -> Fut,
    Fut: Future<Output = Result<net::Answer, String>>,
{
    let server = server?;
    let (Some(latitude), Some(longitude)) = (rounded(latitude, 90.0), rounded(longitude, 180.0))
    else {
        return Err(BAD_PLACE.to_owned());
    };
    let since = modified_since.and_then(from_iso).map(to_http_date);
    let answer = fetch(forecast_url(&server, latitude, longitude), since).await?;
    // Read once the answer has arrived: the expiry counts from then, not from when the request started.
    let now = clock();
    Ok(Forecast {
        expires: expiry(answer.expires.as_deref(), answer.date.as_deref(), now),
        last_modified: answer.last_modified.as_deref().and_then(http_date).map(iso),
        fetched_at: iso(now),
        not_modified: answer.not_modified,
        forecast: if answer.not_modified {
            Vec::new()
        } else {
            reduce(&answer.json)?
        },
    })
}

/// The forecast at a place. The page calls this only when its cached answer is missing or out of date.
#[tauri::command]
pub async fn weather_forecast(
    app: AppHandle,
    latitude: f64,
    longitude: f64,
    modified_since: Option<String>,
) -> Result<Forecast, String> {
    let server = services::service_server(&app, SERVICE).await;
    forecast_with(
        server,
        latitude,
        longitude,
        modified_since.as_deref(),
        now_seconds,
        |url, since| net::get_json_with_headers(url, since, status_words),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    /// A forecast written by hand in the shape of Locationforecast 2.0 compact (Cusco), shared with the page's tests;
    /// no test asks MET Norway itself.
    const RECORDED: &str = include_str!("../../src/core/net/recorded/met-norway-cusco.json");
    const SERVER: &str = "https://api.met.no/weatherapi/locationforecast/2.0";

    fn recorded() -> serde_json::Value {
        serde_json::from_str(RECORDED).expect("recorded JSON")
    }

    fn answer(expires: Option<&str>) -> net::Answer {
        net::Answer {
            json: recorded(),
            expires: expires.map(str::to_owned),
            last_modified: Some("Mon, 16 Nov 2026 11:42:10 GMT".to_owned()),
            date: None,
            not_modified: false,
        }
    }

    fn ask(
        modified_since: Option<&str>,
        now: i64,
        reply: net::Answer,
    ) -> (Result<Forecast, String>, Option<Url>, Option<String>) {
        let seen = RefCell::new((None, None));
        let result = tauri::async_runtime::block_on(forecast_with(
            Ok(SERVER.to_owned()),
            -13.516_767_4,
            -71.978_749_9,
            modified_since,
            || now,
            |url, since| {
                *seen.borrow_mut() = (Some(url), since);
                async { Ok(reply) }
            },
        ));
        let (url, since) = seen.into_inner();
        (result, url, since)
    }

    #[test]
    fn reduces_a_recorded_answer() {
        let entries = reduce(&recorded()).expect("entries");
        assert_eq!(entries.len(), 19);
        // An hourly entry keeps both its hour and its six hours.
        assert_eq!(
            entries[0],
            Entry {
                time: "2026-11-16T12:00:00Z".to_owned(),
                temperature: Some(16.1),
                wind: Some(3.2),
                rain_1h: Some(0.0),
                rain_6h: Some(1.6),
                symbol_1h: Some("partlycloudy_day".to_owned()),
                symbol_6h: Some("cloudy".to_owned()),
            }
        );
        // From 18Z the entries are six-hourly and carry only the six hours.
        assert_eq!(entries[6].time, "2026-11-16T18:00:00Z");
        assert_eq!((entries[6].rain_1h, entries[6].rain_6h), (None, Some(1.4)));
        assert_eq!(entries[6].symbol_1h, None);
        assert_eq!(entries[6].symbol_6h.as_deref(), Some("lightrain"));
        // The last entry has only its instant.
        let last = &entries[18];
        assert_eq!(last.time, "2026-11-19T18:00:00Z");
        assert_eq!(last.temperature, Some(18.1));
        assert_eq!(
            (last.rain_1h, last.rain_6h, &last.symbol_1h, &last.symbol_6h),
            (None, None, &None, &None)
        );
    }

    #[test]
    fn leaves_out_what_is_not_a_forecast() {
        let odd = serde_json::json!({ "properties": { "timeseries": [
            { "time": "tomorrow", "data": { "instant": { "details": { "air_temperature": 1.0 } } } },
            { "time": "2026-11-17T12:00:00Z", "data": { "instant": { "details": { "air_temperature": "warm" } },
              "next_1_hours": { "summary": { "symbol_code": "<b>Rain</b>" }, "details": { "precipitation_amount": 0.2 } } } }
        ] } });
        let entries = reduce(&odd).expect("one entry");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].temperature, None);
        assert_eq!(entries[0].symbol_1h, None);
        assert_eq!(entries[0].rain_1h, Some(0.2));
        assert_eq!(
            reduce(&serde_json::json!({})),
            Err(net::ODD_ANSWER.to_owned())
        );
        assert_eq!(
            reduce(&serde_json::json!({ "properties": { "timeseries": [] } })),
            Err(net::ODD_ANSWER.to_owned())
        );
    }

    #[test]
    fn cuts_coordinates_to_four_decimals_and_refuses_the_impossible() {
        assert_eq!(rounded(-13.516_767_4, 90.0), Some(-13.5168));
        assert_eq!(rounded(-71.978_749_9, 180.0), Some(-71.9787));
        // Half away from zero.
        assert_eq!(rounded(0.000_05, 90.0), Some(0.0001));
        assert_eq!(rounded(-0.000_05, 90.0), Some(-0.0001));
        assert_eq!(
            rounded(-0.000_01, 90.0).map(f64::is_sign_negative),
            Some(false)
        );
        for bad in [f64::NAN, f64::INFINITY, 90.1, -90.1] {
            assert_eq!(rounded(bad, 90.0), None);
        }
        assert_eq!(rounded(180.5, 180.0), None);
        let url = forecast_url(SERVER, -13.5168, -71.9788);
        assert!(net::allowed(&url));
        assert_eq!(
            url.as_str(),
            "https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=-13.5168&lon=-71.9788"
        );
        let asked = Cell::new(0);
        let refused = tauri::async_runtime::block_on(forecast_with(
            Ok(SERVER.to_owned()),
            f64::NAN,
            0.0,
            None,
            || 0,
            |_, _| {
                asked.set(asked.get() + 1);
                async { Ok(answer(None)) }
            },
        ));
        assert_eq!(refused, Err(BAD_PLACE.to_owned()));
        assert_eq!(asked.get(), 0);
    }

    #[test]
    fn reads_the_expires_header_and_defaults_to_an_hour() {
        assert_eq!(http_date("Thu, 01 Jan 1970 00:00:00 GMT"), Some(0));
        assert_eq!(
            iso(http_date("Tue, 17 Nov 2026 12:30:00 GMT").expect("a date")),
            "2026-11-17T12:30:00Z"
        );
        // 2028 is a leap year.
        assert_eq!(
            iso(http_date("Wed, 01 Mar 2028 00:00:00 GMT").expect("a date") - 1),
            "2028-02-29T23:59:59Z"
        );
        let now = http_date("Tue, 17 Nov 2026 12:00:00 GMT").expect("a date");
        assert_eq!(
            expiry(Some("Tue, 17 Nov 2026 12:30:00 GMT"), None, now),
            "2026-11-17T12:30:00Z"
        );
        for unreadable in [
            None,
            Some(""),
            Some("soon"),
            Some("2026-11-17T12:30:00Z"),
            Some("Tue, 32 Nov 2026 12:30:00 GMT"),
        ] {
            assert_eq!(
                expiry(unreadable, None, now),
                "2026-11-17T13:00:00Z",
                "{unreadable:?}"
            );
        }
    }

    #[test]
    fn counts_the_expiry_from_the_servers_clock_when_it_gives_one() {
        // The server says 12:00:00 and the answer good until 12:30: thirty minutes from whenever this computer thinks
        // it is, fast or slow.
        let server_date = Some("Tue, 17 Nov 2026 12:00:00 GMT");
        let expires = Some("Tue, 17 Nov 2026 12:30:00 GMT");
        let slow = http_date("Tue, 17 Nov 2026 11:00:00 GMT").expect("a date");
        let fast = http_date("Tue, 17 Nov 2026 14:00:00 GMT").expect("a date");
        assert_eq!(expiry(expires, server_date, slow), "2026-11-17T11:30:00Z");
        assert_eq!(expiry(expires, server_date, fast), "2026-11-17T14:30:00Z");
        // An Expires already behind the Date is out of date now, never in the past of it.
        assert_eq!(
            expiry(Some("Tue, 17 Nov 2026 11:00:00 GMT"), server_date, fast),
            "2026-11-17T14:00:00Z"
        );
        // An unreadable Date leaves Expires as it is.
        assert_eq!(
            expiry(expires, Some("yesterday"), slow),
            "2026-11-17T12:30:00Z"
        );
    }

    #[test]
    fn writes_and_reads_the_dates_if_modified_since_needs() {
        let at = from_iso("2026-11-16T11:42:10Z").expect("a moment");
        assert_eq!(to_http_date(at), "Mon, 16 Nov 2026 11:42:10 GMT");
        assert_eq!(to_http_date(0), "Thu, 01 Jan 1970 00:00:00 GMT");
        assert_eq!(
            to_http_date(http_date("Wed, 01 Mar 2028 00:00:00 GMT").expect("a date")),
            "Wed, 01 Mar 2028 00:00:00 GMT"
        );
        assert_eq!(from_iso("2026-13-16T11:42:10Z"), None);
        assert_eq!(from_iso("Mon, 16 Nov 2026 11:42:10 GMT"), None);
    }

    #[test]
    fn answers_with_when_it_expires_and_when_it_was_fetched() {
        let now = http_date("Mon, 16 Nov 2026 11:50:00 GMT").expect("a date");
        let (forecast, url, since) = ask(None, now, answer(Some("Mon, 16 Nov 2026 12:20:00 GMT")));
        let forecast = forecast.expect("a forecast");
        assert_eq!(forecast.expires, "2026-11-16T12:20:00Z");
        assert_eq!(forecast.fetched_at, "2026-11-16T11:50:00Z");
        assert_eq!(
            forecast.last_modified.as_deref(),
            Some("2026-11-16T11:42:10Z")
        );
        assert!(!forecast.not_modified);
        assert_eq!(forecast.forecast.len(), 19);
        assert_eq!(
            url.expect("asked").query(),
            Some("lat=-13.5168&lon=-71.9787")
        );
        assert_eq!(since, None);
        let json = serde_json::to_value(&forecast).expect("JSON");
        assert!(json.get("fetchedAt").is_some() && json.get("lastModified").is_some());
        let first = &json["forecast"][0];
        assert_eq!(first["rain1h"], 0.0);
        assert_eq!(first["rain6h"], 1.6);
        assert_eq!(first["symbol6h"], "cloudy");
    }

    #[test]
    fn renewing_sends_if_modified_since_and_a_304_keeps_what_is_held() {
        let now = http_date("Mon, 16 Nov 2026 12:50:00 GMT").expect("a date");
        let unchanged = net::Answer {
            json: serde_json::Value::Null,
            expires: Some("Mon, 16 Nov 2026 13:20:00 GMT".to_owned()),
            last_modified: None,
            date: None,
            not_modified: true,
        };
        let (forecast, _, since) = ask(Some("2026-11-16T11:42:10Z"), now, unchanged);
        assert_eq!(since.as_deref(), Some("Mon, 16 Nov 2026 11:42:10 GMT"));
        let forecast = forecast.expect("a forecast");
        assert!(forecast.not_modified);
        assert!(forecast.forecast.is_empty());
        assert_eq!(forecast.expires, "2026-11-16T13:20:00Z");
        assert_eq!(forecast.fetched_at, "2026-11-16T12:50:00Z");
        // Something that isn't a moment is not sent.
        let (_, _, odd) = ask(Some("yesterday"), now, answer(None));
        assert_eq!(odd, None);
    }

    #[test]
    fn the_expiry_counts_from_when_the_answer_arrives() {
        // The clock is read after the fetch: a slow answer doesn't start its life before it came.
        let clock = Cell::new(1_000);
        let forecast = tauri::async_runtime::block_on(forecast_with(
            Ok(SERVER.to_owned()),
            -13.5,
            -71.9,
            None,
            || clock.get(),
            |_, _| {
                clock.set(1_020);
                async { Ok(answer(None)) }
            },
        ))
        .expect("a forecast");
        assert_eq!(forecast.fetched_at, iso(1_020));
        assert_eq!(forecast.expires, iso(1_020 + DEFAULT_STAY));
    }

    #[test]
    fn a_service_turned_off_makes_no_request() {
        let asked = Cell::new(0);
        let off = tauri::async_runtime::block_on(forecast_with(
            Err(format!("{}maintenance", services::OFF_PREFIX)),
            -13.5,
            -71.9,
            None,
            || 0,
            |_, _| {
                asked.set(asked.get() + 1);
                async { Ok(answer(None)) }
            },
        ));
        assert_eq!(off, Err("service-off:maintenance".to_owned()));
        assert_eq!(asked.get(), 0);
    }

    #[test]
    fn the_host_is_the_listed_one_over_https_only() {
        assert!(net::allowed(&forecast_url(SERVER, 1.0, 2.0)));
        assert!(!net::allowed(&forecast_url(
            "http://api.met.no/weatherapi/locationforecast/2.0",
            1.0,
            2.0
        )));
        assert!(!net::allowed(&forecast_url(
            "https://example.com/2.0",
            1.0,
            2.0
        )));
    }

    #[test]
    fn a_refusal_names_its_status_and_is_not_retried() {
        assert_eq!(status_words(StatusCode::FORBIDDEN), "weather-refused:403");
        assert_eq!(
            status_words(StatusCode::TOO_MANY_REQUESTS),
            "weather-refused:429"
        );
        assert_eq!(status_words(StatusCode::SERVICE_UNAVAILABLE), net::BUSY);
        assert_eq!(status_words(StatusCode::NOT_FOUND), net::ODD_ANSWER);
        // One try, one error: the fetch is asked once and its refusal comes straight back.
        let asked = Cell::new(0);
        let refused = tauri::async_runtime::block_on(forecast_with(
            Ok(SERVER.to_owned()),
            -13.5,
            -71.9,
            None,
            || 0,
            |_, _| {
                asked.set(asked.get() + 1);
                async { Err(status_words(StatusCode::TOO_MANY_REQUESTS)) }
            },
        ));
        assert_eq!(refused, Err("weather-refused:429".to_owned()));
        assert_eq!(asked.get(), 1);
    }
}
