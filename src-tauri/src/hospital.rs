//! The nearest hospital (4.5): hospitals around a location's place on OpenStreetMap's Nominatim, only when the person
//! presses Find nearest hospital. The same service as the address search (the switch's `nominatim`, the same one
//! request a second for the whole app, through net.rs), and never Google or Overpass. This side asks and reads; the
//! page sorts (emergency department first, then distance), keeps the best five and caches them in the project.

use std::future::Future;

use reqwest::Url;
use serde::Serialize;
use tauri::AppHandle;

use crate::{geocode, net, services};

const SERVICE: &str = "nominatim";
/// How many Nominatim is asked for, its largest: it returns them by importance, not distance, so in a dense city
/// the most it allows is asked and the page keeps the nearest five after sorting.
const ASKED: usize = 40;
/// How far around the place the first try looks, and the one wider try after it finds no hospital. No more tries.
const NEAR_KM: f64 = 10.0;
const FAR_KM: f64 = 50.0;
/// Kilometres to a degree of latitude.
const KM_PER_DEGREE: f64 = 111.32;
/// Without address details, an address is the first parts of Nominatim's `display_name`: the street and town, not the
/// country's whole chain.
const ADDRESS_PARTS: usize = 3;
const MAX_TEXT: usize = 200;

/// One hospital found. `emergency` is true only when OpenStreetMap says it has an emergency department
/// (`emergency=yes`); false is "unknown", never "none".
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hospital {
    pub name: String,
    pub address: String,
    pub latitude: f64,
    pub longitude: f64,
    pub emergency: bool,
    pub phone: Option<String>,
    /// ISO 3166-1 alpha-2, upper case.
    pub country_code: Option<String>,
}

/// The box `km` around a point as Nominatim's `viewbox` writes it: left, top, right, bottom (longitude, latitude).
/// It is cut at the poles and at ±180°, never wrapped round the antimeridian (Nominatim can't take a wrapped box), so
/// a place within a box's width of it searches only the side it is on.
fn viewbox(latitude: f64, longitude: f64, km: f64) -> String {
    let dlat = km / KM_PER_DEGREE;
    // A degree of longitude shrinks towards the poles; kept from dividing by nothing at them.
    let dlon = km / (KM_PER_DEGREE * latitude.to_radians().cos().max(0.01));
    let (south, north) = ((latitude - dlat).max(-90.0), (latitude + dlat).min(90.0));
    let (west, east) = (
        (longitude - dlon).max(-180.0),
        (longitude + dlon).min(180.0),
    );
    format!("{west:.5},{north:.5},{east:.5},{south:.5}")
}

/// The search address on `server`, one of the servers listed in services.rs.
fn search_url(server: &str, latitude: f64, longitude: f64, km: f64) -> Url {
    let limit = ASKED.to_string();
    let view = viewbox(latitude, longitude, km);
    Url::parse_with_params(
        &format!("{server}/search"),
        [
            ("amenity", "hospital"),
            ("format", "jsonv2"),
            ("extratags", "1"),
            ("addressdetails", "1"),
            ("limit", limit.as_str()),
            ("viewbox", view.as_str()),
            ("bounded", "1"),
        ],
    )
    .expect("the search address is a URL")
}

fn text(value: Option<&serde_json::Value>) -> Option<String> {
    let found = value?.as_str()?.trim();
    (!found.is_empty()).then(|| found.chars().take(MAX_TEXT).collect())
}

/// Nominatim writes coordinates as text.
fn coordinate(value: Option<&serde_json::Value>, range: f64) -> Option<f64> {
    let number = match value? {
        serde_json::Value::String(text) => text.trim().parse::<f64>().ok()?,
        serde_json::Value::Number(number) => number.as_f64()?,
        _ => return None,
    };
    (number.is_finite() && number.abs() <= range).then_some(number)
}

/// Countries that write the house number before the road ("845 Main Street"); elsewhere it follows ("Calle Real 845").
const NUMBER_FIRST: &[&str] = &[
    "US", "CA", "GB", "IE", "AU", "NZ", "PH", "IN", "FR", "LU", "SG", "MY", "HK", "ZA",
];

/// The street and town from an entry's address details: road and house number, then city, town, village (else
/// municipality, suburb or hamlet), then postcode, whichever are there. A postcode alone is no address: empty then,
/// and the caller falls back to `display_name`.
fn detailed_address(entry: &serde_json::Value) -> String {
    let Some(details) = entry.get("address") else {
        return String::new();
    };
    let part = |key: &str| text(details.get(key));
    let number_first = part("country_code")
        .is_some_and(|c| NUMBER_FIRST.contains(&c.to_ascii_uppercase().as_str()));
    let street = match (part("house_number"), part("road")) {
        (Some(number), Some(road)) if number_first => Some(format!("{number} {road}")),
        (Some(number), Some(road)) => Some(format!("{road} {number}")),
        (None, Some(road)) => Some(road),
        _ => None,
    };
    let town = [
        "city",
        "town",
        "village",
        "municipality",
        "suburb",
        "hamlet",
    ]
    .iter()
    .find_map(|key| part(key));
    if street.is_none() && town.is_none() {
        return String::new();
    }
    [street, town, part("postcode")]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(", ")
}

/// The hospitals in an answer, in its order. Only what OpenStreetMap tags as a hospital counts (jsonv2 `category`
/// amenity and `type` hospital): `amenity=hospital` also finds a bus stop, a road or a vet that has "hospital" in its
/// name. An entry without a place on Earth is left out; one without a name keeps an empty one, which the page words.
fn hospitals(answer: &serde_json::Value) -> Result<Vec<Hospital>, String> {
    let list = answer
        .as_array()
        .ok_or_else(|| net::ODD_ANSWER.to_owned())?;
    Ok(list
        .iter()
        .filter_map(|entry| {
            if entry.get("category").and_then(|c| c.as_str()) != Some("amenity")
                || entry.get("type").and_then(|c| c.as_str()) != Some("hospital")
            {
                return None;
            }
            let name = text(entry.get("name")).unwrap_or_default();
            let mut address = detailed_address(entry);
            if address.is_empty() {
                // The name is the first part of `display_name` already; the next few say where.
                let display = text(entry.get("display_name")).unwrap_or_default();
                let parts: Vec<&str> = display.split(", ").collect();
                address = parts
                    .iter()
                    .skip(usize::from(parts.first().is_some_and(|p| *p == name)))
                    .take(ADDRESS_PARTS)
                    .copied()
                    .collect::<Vec<_>>()
                    .join(", ");
            }
            let tags = entry.get("extratags");
            let phone = text(tags.and_then(|t| t.get("phone")))
                .or_else(|| text(tags.and_then(|t| t.get("contact:phone"))));
            let country_code = text(entry.get("address").and_then(|a| a.get("country_code")))
                .filter(|c| c.len() == 2 && c.is_ascii())
                .map(|c| c.to_ascii_uppercase());
            Some(Hospital {
                name,
                address,
                latitude: coordinate(entry.get("lat"), 90.0)?,
                longitude: coordinate(entry.get("lon"), 180.0)?,
                emergency: text(tags.and_then(|t| t.get("emergency"))).as_deref() == Some("yes"),
                phone,
                country_code,
            })
        })
        .take(ASKED)
        .collect())
}

/// The hospitals around a place: within about 10 km, else one wider try at about 50 km (only real hospitals count
/// towards "found something": a box of bus stops still earns the wider try). `server` is the switch's
/// answer (an error when the service is off: then `fetch` is never called, so nothing is sent); `fetch` makes one
/// request, and is the real one's queue and network in the command, a recorded one in the tests.
async fn find_with<F, Fut>(
    server: Result<String, String>,
    latitude: f64,
    longitude: f64,
    fetch: F,
) -> Result<Vec<Hospital>, String>
where
    F: Fn(Url) -> Fut,
    Fut: Future<Output = Result<serde_json::Value, String>>,
{
    let server = server?;
    if !(latitude.is_finite()
        && latitude.abs() <= 90.0
        && longitude.is_finite()
        && longitude.abs() <= 180.0)
    {
        return Err(net::ODD_ANSWER.to_owned());
    }
    for km in [NEAR_KM, FAR_KM] {
        let found = hospitals(&fetch(search_url(&server, latitude, longitude, km)).await?)?;
        if !found.is_empty() {
            return Ok(found);
        }
    }
    Ok(Vec::new())
}

/// Hospitals around a place, the names in `language` where the map has them. Asks the service switch first: a service
/// turned off answers with why (services::OFF_PREFIX) and nothing is sent.
#[tauri::command]
pub async fn nearest_hospitals(
    app: AppHandle,
    latitude: f64,
    longitude: f64,
    language: String,
) -> Result<Vec<Hospital>, String> {
    let server = services::service_server(&app, SERVICE).await;
    let language = language.as_str();
    find_with(server, latitude, longitude, |url| async move {
        // Each request takes its turn in the address search's queue: one a second for the whole app.
        geocode::wait_turn().await?;
        net::get_json(url, language).await
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::Mutex, time::Duration};

    /// A hand-written answer in Nominatim's jsonv2 shape (with `extratags` and `address.country_code`), shared with the
    /// page's tests; no test asks Nominatim itself.
    const RECORDED: &str =
        include_str!("../../src/core/net/recorded/nominatim-hospitals-cusco.json");

    fn recorded() -> serde_json::Value {
        serde_json::from_str(RECORDED).expect("recorded JSON")
    }

    #[test]
    fn asks_for_hospitals_in_a_box_around_the_place() {
        let url = search_url(
            "https://nominatim.openstreetmap.org",
            -13.5167674,
            -71.9787787,
            NEAR_KM,
        );
        assert!(net::allowed(&url));
        let query: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(query["amenity"], "hospital");
        assert_eq!(query["format"], "jsonv2");
        assert_eq!(query["extratags"], "1");
        assert_eq!(query["addressdetails"], "1");
        assert_eq!(query["limit"], "40");
        assert_eq!(query["bounded"], "1");
        // left, top, right, bottom.
        let parts: Vec<f64> = query["viewbox"]
            .split(',')
            .map(|p| p.parse().expect("number"))
            .collect();
        assert!(parts[0] < -71.9787787 && parts[2] > -71.9787787);
        assert!(parts[1] > -13.5167674 && parts[3] < -13.5167674);
        assert!((parts[1] - parts[3] - 2.0 * NEAR_KM / KM_PER_DEGREE).abs() < 1e-3);
        // The box never leaves the Earth.
        assert!(viewbox(89.9, 179.9, FAR_KM).split(',').all(|p| p
            .parse::<f64>()
            .expect("number")
            .abs()
            <= 180.0));
    }

    #[test]
    fn reads_a_recorded_answer() {
        let found = hospitals(&recorded()).expect("hospitals");
        assert_eq!(found.len(), 6);
        let first = &found[0];
        assert_eq!(first.name, "Hospital Regional del Cusco");
        // From the address details: road, town, postcode.
        assert_eq!(first.address, "Avenida de la Cultura, Cusco, 08002");
        assert!(first.emergency);
        assert_eq!(first.phone.as_deref(), Some("+51 84 233 331"));
        assert_eq!(first.country_code.as_deref(), Some("PE"));
        assert!((first.latitude - -13.5236).abs() < 1e-9);
        // No emergency tag, or one that says no, is unknown; a missing phone is none.
        assert!(!found[1].emergency);
        assert!(!found[2].emergency);
        assert_eq!(found[1].phone, None);
        // Without details, the first parts of display_name after the name; with a house number, it leads the road.
        assert_eq!(
            found[1].address,
            "Avenida de la Cultura, San Sebastián, Cusco"
        );
        assert_eq!(found[4].address, "Avenida Collasuyo 845, Cusco");
        // A phone under contact:phone counts too.
        assert_eq!(found[2].phone.as_deref(), Some("+51 84 111 222"));
        // An entry with no usable place is left out, and so are a vet and a bus stop with "hospital" in the name: only
        // amenity=hospital counts. So is an answer that isn't a list.
        assert!(found.iter().all(|h| h.name != "Nowhere"));
        assert!(found
            .iter()
            .all(|h| !h.name.contains("VCA") && !h.name.contains("parada")));
        assert_eq!(
            hospitals(&serde_json::json!({ "error": "x" })),
            Err(net::ODD_ANSWER.to_owned())
        );
    }

    #[test]
    fn tries_the_wider_box_once_when_the_near_one_is_empty() {
        let urls = Mutex::new(Vec::new());
        let found = tauri::async_runtime::block_on(find_with(
            Ok("https://nominatim.openstreetmap.org".to_owned()),
            -13.5,
            -71.9,
            |url| {
                let mut seen = urls.lock().expect("lock");
                seen.push(url.to_string());
                let answer = if seen.len() == 1 {
                    serde_json::json!([])
                } else {
                    recorded()
                };
                async move { Ok(answer) }
            },
        ))
        .expect("found");
        assert_eq!(found.len(), 6);
        assert_eq!(urls.lock().expect("lock").len(), 2);
        // The first box 10 km, the second 50 km: the second's box is the wider.
        let seen = urls.lock().expect("lock").clone();
        let width = |url: &str| {
            let url = Url::parse(url).expect("url");
            let view = url
                .query_pairs()
                .find(|(k, _)| k == "viewbox")
                .expect("viewbox")
                .1
                .into_owned();
            let p: Vec<f64> = view
                .split(',')
                .map(|v| v.parse().expect("number"))
                .collect();
            p[2] - p[0]
        };
        assert!(width(&seen[1]) > width(&seen[0]) * 4.9);

        // A near box of a bus stop and a vet is no hospital found: the wider try still follows.
        let only_others = serde_json::json!([
            { "category": "highway", "type": "bus_stop", "name": "Hospital", "lat": "1", "lon": "1" },
            { "category": "amenity", "type": "veterinary", "name": "Animal Hospital", "lat": "1", "lon": "1" }
        ]);
        let asks_made = Mutex::new(0);
        let wider = tauri::async_runtime::block_on(find_with(
            Ok("https://nominatim.openstreetmap.org".to_owned()),
            -13.5,
            -71.9,
            |_| {
                let mut asks = asks_made.lock().expect("lock");
                *asks += 1;
                let answer = if *asks == 1 {
                    only_others.clone()
                } else {
                    recorded()
                };
                async move { Ok(answer) }
            },
        ))
        .expect("found");
        assert_eq!(*asks_made.lock().expect("lock"), 2);
        assert_eq!(wider.len(), 6);

        // Nothing at either: two asks and no third.
        let asks = Mutex::new(0);
        let none = tauri::async_runtime::block_on(find_with(
            Ok("https://nominatim.openstreetmap.org".to_owned()),
            -13.5,
            -71.9,
            |_| {
                *asks.lock().expect("lock") += 1;
                async { Ok(serde_json::json!([])) }
            },
        ));
        assert_eq!(none, Ok(Vec::new()));
        assert_eq!(*asks.lock().expect("lock"), 2);
    }

    #[test]
    fn an_unnamed_hospital_keeps_an_empty_name_for_the_page_to_word() {
        let answer = serde_json::json!([{
            "category": "amenity", "type": "hospital", "lat": "-13.5", "lon": "-71.9",
            "display_name": "Calle Real, Cusco, Peru",
            "address": { "road": "Calle Real", "country_code": "pe" }
        }]);
        let found = hospitals(&answer).expect("hospitals");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "");
        assert_eq!(found[0].address, "Calle Real");
    }

    #[test]
    fn writes_the_address_in_the_countrys_order() {
        let of = |details: serde_json::Value| {
            detailed_address(&serde_json::json!({ "address": details }))
        };
        // House number first where that is the custom, after the road elsewhere.
        assert_eq!(
            of(
                serde_json::json!({ "house_number": "845", "road": "Main Street", "city": "Austin", "postcode": "78701", "country_code": "us" })
            ),
            "845 Main Street, Austin, 78701"
        );
        assert_eq!(
            of(
                serde_json::json!({ "house_number": "12", "road": "Calle Real", "town": "Ica", "country_code": "pe" })
            ),
            "Calle Real 12, Ica"
        );
        assert_eq!(
            of(
                serde_json::json!({ "house_number": "12", "road": "Rue de Rivoli", "city": "Paris", "country_code": "fr" })
            ),
            "12 Rue de Rivoli, Paris"
        );
        // No city, town or village: a municipality, suburb or hamlet.
        assert_eq!(
            of(
                serde_json::json!({ "road": "Calle Real", "suburb": "Wanchaq", "country_code": "pe" })
            ),
            "Calle Real, Wanchaq"
        );
        // A postcode alone is no address.
        assert_eq!(
            of(serde_json::json!({ "postcode": "08002", "country_code": "pe" })),
            ""
        );
    }

    #[test]
    fn shares_one_queue_with_the_address_search() {
        // Both commands take their turn through geocode::wait_turn (one static queue): after the address search has
        // booked its turn, the hospital search's is a second behind it.
        let _alone = geocode::QUEUE_TEST
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        geocode::forget_queue();
        assert_eq!(geocode::reserve(), Ok(Duration::ZERO));
        let started = std::time::Instant::now();
        tauri::async_runtime::block_on(geocode::wait_turn()).expect("turn");
        let waited = started.elapsed();
        geocode::forget_queue();
        assert!(waited >= Duration::from_millis(900), "waited {waited:?}");
    }

    #[test]
    fn a_service_turned_off_sends_nothing() {
        let asks = Mutex::new(0);
        let answer = tauri::async_runtime::block_on(find_with(
            Err(format!("{}operator-request", services::OFF_PREFIX)),
            -13.5,
            -71.9,
            |_| {
                *asks.lock().expect("lock") += 1;
                async { Ok(recorded()) }
            },
        ));
        assert_eq!(answer, Err("service-off:operator-request".to_owned()));
        assert_eq!(*asks.lock().expect("lock"), 0);
        // A place off the Earth is refused unsent too.
        let odd = tauri::async_runtime::block_on(find_with(
            Ok("https://nominatim.openstreetmap.org".to_owned()),
            95.0,
            0.0,
            |_| {
                *asks.lock().expect("lock") += 1;
                async { Ok(recorded()) }
            },
        ));
        assert!(odd.is_err());
        assert_eq!(*asks.lock().expect("lock"), 0);
    }
}
