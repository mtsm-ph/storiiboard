//! The week's first day as this computer's regional settings say (3.17; Kevin, Nov 9). A webview knows the app's
//! language, not the region's formats (an English Windows set to Mexico's formats starts the week on Sunday; a Mac in
//! English set to Spain starts it on Monday), so it's read here: on Windows the regional "first day of week", on a Mac
//! the one set in Language & Region, else the region itself, which the page turns into a first day. Nothing is
//! written, nothing leaves the computer.

use serde::Serialize;

/// What the computer says: the first day where it's set (0 Sunday … 6 Saturday), and the region's locale (`es-MX`).
#[derive(Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RegionWeek {
    pub first_day: Option<u8>,
    pub locale: Option<String>,
}

/// Windows counts from Monday (0 Monday … 6 Sunday); the app from Sunday.
#[cfg_attr(not(windows), allow(dead_code))]
fn from_monday(day: u8) -> Option<u8> {
    (day <= 6).then_some((day + 1) % 7)
}

/// macOS writes the first day as `{ gregorian = 2; }`, counting 1 Sunday … 7 Saturday.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn from_mac_defaults(text: &str) -> Option<u8> {
    let after = text.split("gregorian").nth(1)?;
    let digits: String = after
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(char::is_ascii_digit)
        .collect();
    let day: u8 = digits.parse().ok()?;
    (1..=7).contains(&day).then_some(day - 1)
}

/// A locale as a page reads one, with the region the person picked: a Mac in British English set to the US region
/// writes `en_GB@rg=uszzzz`, which is `en-US` here (the week starts where the region does). `C` and `POSIX` name no
/// region: none.
#[cfg_attr(windows, allow(dead_code))]
fn page_locale(text: &str) -> Option<String> {
    let text = text.trim();
    let (head, keywords) = text.split_once('@').unwrap_or((text, ""));
    let base = head.split('.').next()?.replace('_', "-");
    if base.is_empty() || base.eq_ignore_ascii_case("c") || base.eq_ignore_ascii_case("posix") {
        return None;
    }
    if base.len() > 35 || !base.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return None;
    }
    let region = keywords.split(';').find_map(|keyword| {
        let value = keyword.trim().strip_prefix("rg=")?;
        let code: String = value.chars().take(2).collect();
        (code.len() == 2 && code.chars().all(|c| c.is_ascii_alphabetic()))
            .then(|| code.to_ascii_uppercase())
    });
    let language = base.split('-').next().unwrap_or(&base);
    Some(match region {
        Some(region) => format!("{language}-{region}"),
        None => base,
    })
}

#[cfg(windows)]
fn read() -> RegionWeek {
    use windows_sys::Win32::Globalization::{
        GetLocaleInfoEx, LOCALE_IFIRSTDAYOFWEEK, LOCALE_SNAME,
    };
    let info = |kind: u32| -> Option<String> {
        let mut buffer = [0u16; 86];
        // A null locale name is the user's default: the region's formats, as Settings → Time & language sets them.
        // SAFETY: the buffer is ours and its length is passed; the call writes at most that many units.
        let written = unsafe {
            GetLocaleInfoEx(
                std::ptr::null(),
                kind,
                buffer.as_mut_ptr(),
                buffer.len() as i32,
            )
        };
        let length = usize::try_from(written).ok()?.checked_sub(1)?;
        String::from_utf16(&buffer[..length]).ok()
    };
    RegionWeek {
        first_day: info(LOCALE_IFIRSTDAYOFWEEK)
            .and_then(|text| text.trim().parse().ok())
            .and_then(from_monday),
        locale: info(LOCALE_SNAME).filter(|name| !name.is_empty()),
    }
}

#[cfg(target_os = "macos")]
fn read() -> RegionWeek {
    let defaults = |key: &str| -> Option<String> {
        let output = std::process::Command::new("/usr/bin/defaults")
            .args(["read", "-g", key])
            .output()
            .ok()?;
        output
            .status
            .success()
            .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
    };
    RegionWeek {
        first_day: defaults("AppleFirstWeekday")
            .as_deref()
            .and_then(from_mac_defaults),
        locale: defaults("AppleLocale").as_deref().and_then(page_locale),
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
fn read() -> RegionWeek {
    let locale = ["LC_ALL", "LC_TIME", "LANG"]
        .iter()
        .find_map(|key| std::env::var(key).ok().filter(|v| !v.is_empty()));
    RegionWeek {
        first_day: None,
        locale: locale.as_deref().and_then(page_locale),
    }
}

/// The week's first day and region as this computer has them.
#[tauri::command]
pub async fn region_week() -> RegionWeek {
    tauri::async_runtime::spawn_blocking(read)
        .await
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_from_sunday() {
        assert_eq!(from_monday(0), Some(1));
        assert_eq!(from_monday(6), Some(0));
        assert_eq!(from_monday(5), Some(6));
        assert_eq!(from_monday(7), None);
        assert_eq!(from_mac_defaults("{\n    gregorian = 2;\n}"), Some(1));
        assert_eq!(from_mac_defaults("{ gregorian = 1; }"), Some(0));
        assert_eq!(from_mac_defaults("{ gregorian = 9; }"), None);
        assert_eq!(
            from_mac_defaults("The domain/default pair does not exist"),
            None
        );
    }

    #[test]
    fn reads_a_locale_as_a_page_does() {
        // The region picked over the language's own: Spanish (Spain) set to Mexico starts the week on Sunday.
        assert_eq!(page_locale("es_ES@rg=mxzzzz"), Some("es-MX".to_owned()));
        assert_eq!(
            page_locale("en_GB@rg=uszzzz;calendar=gregorian"),
            Some("en-US".to_owned())
        );
        assert_eq!(page_locale("en_GB"), Some("en-GB".to_owned()));
        assert_eq!(page_locale("es_MX.UTF-8"), Some("es-MX".to_owned()));
        assert_eq!(page_locale("C.UTF-8"), None);
        assert_eq!(page_locale("POSIX"), None);
        assert_eq!(page_locale(" \n"), None);
        assert_eq!(page_locale("en_US; rm -rf"), None);
    }

    #[test]
    fn reads_this_computer_without_failing() {
        let week = tauri::async_runtime::block_on(region_week());
        assert!(week.first_day.is_none_or(|day| day <= 6));
    }
}
