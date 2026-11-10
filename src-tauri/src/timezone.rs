//! A place's time zone from its coordinates (4.3; Kevin, Nov 10), offline: the boundary data is in the binary (tzf-rs,
//! built from timezone-boundary-builder, which is OpenStreetMap data under the ODbL). Nothing is requested, nothing is
//! written. The call sheet works out a location's sun times in the zone this gives.

use std::sync::OnceLock;

use tzf_rs::DefaultFinder;

/// Built on first use, never at startup: reading the boundaries takes a while and some memory.
static FINDER: OnceLock<DefaultFinder> = OnceLock::new();

/// The IANA zone id at a point ("America/New_York"), or None for coordinates that aren't numbers, are out of range or
/// that the data can't place.
pub fn zone_at(latitude: f64, longitude: f64) -> Option<String> {
    if !latitude.is_finite()
        || !longitude.is_finite()
        || !(-90.0..=90.0).contains(&latitude)
        || !(-180.0..=180.0).contains(&longitude)
    {
        return None;
    }
    let name = FINDER
        .get_or_init(DefaultFinder::new)
        .get_tz_name(longitude, latitude);
    (!name.is_empty()).then(|| name.to_string())
}

/// Asked from the page when a location has a place on the map. Run on a thread of its own so building the finder
/// the first time never holds the window up.
#[tauri::command]
pub async fn time_zone_at(latitude: f64, longitude: f64) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || zone_at(latitude, longitude))
        .await
        .ok()
        .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn places_cities() {
        assert_eq!(
            zone_at(40.7128, -74.0060).as_deref(),
            Some("America/New_York")
        );
        assert_eq!(zone_at(40.4168, -3.7038).as_deref(), Some("Europe/Madrid"));
        assert_eq!(
            zone_at(19.4326, -99.1332).as_deref(),
            Some("America/Mexico_City")
        );
    }

    #[test]
    fn a_point_at_sea_gets_an_ocean_zone() {
        // Mid-Atlantic: tzf gives "Etc/GMT+2" (the ocean's 15-degree bands), measured with tzf-rs 2.1.3.
        assert_eq!(zone_at(0.0, -30.0).as_deref(), Some("Etc/GMT+2"));
    }

    #[test]
    fn refuses_what_is_not_a_place() {
        assert_eq!(zone_at(f64::NAN, 0.0), None);
        assert_eq!(zone_at(0.0, f64::NAN), None);
        assert_eq!(zone_at(f64::INFINITY, 0.0), None);
        assert_eq!(zone_at(91.0, 0.0), None);
        assert_eq!(zone_at(0.0, 181.0), None);
        assert_eq!(zone_at(-90.5, 0.0), None);
    }
}
