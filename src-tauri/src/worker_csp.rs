//! The content security policy of every worker the app starts (Kevin, Nov 19). Tauri puts the page's policy
//! (tauri.conf.json, `app.security.csp`) only on assets whose path ends in `.html` (tauri 2.12.5, `get_asset`'s
//! `is_html`), and a worker started from a URL takes its policy from its own script's response, never from the page:
//! so without this a worker's script came with no header and the worker ran with no policy at all (both engines let
//! it eval and fetch, e2e/workerCsp.spec.ts). The policy is in src-tauri/worker-csp.txt, which the end-to-end test
//! server reads too (scripts/e2eCsp.ts), and goes on every JavaScript response: a browser ignores it on a page's own
//! script, and on a worker's script it is that worker's policy.
//!
//! Decided by the response's Content-Type, never by the address: Tauri drops a trailing `/` and percent-decodes the
//! path before it looks the asset up, so `x.js/` and `x%2Ejs` are the same script as `x.js`, and the type it has set
//! from the decoded path by the time the handler runs (`get_response` in tauri's protocol/tauri.rs) is what the
//! webview runs the answer as.

use std::borrow::Cow;
use std::sync::LazyLock;

use tauri::http::{
    header::{CONTENT_SECURITY_POLICY, CONTENT_TYPE},
    HeaderValue, Request, Response,
};

/// The file as written: comments (#) and the policy.
const FILE: &str = include_str!("../worker-csp.txt");

/// The policy: every line of the file that isn't a comment or empty, joined, as scripts/e2eCsp.ts reads it.
pub(crate) static POLICY: LazyLock<String> = LazyLock::new(|| {
    FILE.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .collect::<Vec<_>>()
        .join(" ")
});

/// The JavaScript types, as their essence (no parameters), lower case. The same set as `isJavaScript` in
/// scripts/e2eCsp.ts (text or application, `x-` or not, javascript or ecmascript): keep the two matching.
const JAVASCRIPT_TYPES: [&str; 8] = [
    "text/javascript",
    "application/javascript",
    "text/x-javascript",
    "application/x-javascript",
    "text/ecmascript",
    "application/ecmascript",
    "text/x-ecmascript",
    "application/x-ecmascript",
];

/// Whether a Content-Type is JavaScript: its essence (before any `;` parameter, spaces trimmed, any case) is one of
/// JAVASCRIPT_TYPES.
pub(crate) fn is_javascript(content_type: &str) -> bool {
    let essence = content_type.split(';').next().unwrap_or_default().trim();
    JAVASCRIPT_TYPES
        .iter()
        .any(|known| known.eq_ignore_ascii_case(essence))
}

/// Whether an asset's response gets the worker policy: its Content-Type is JavaScript, and it has no policy already.
/// A missing script is answered with index.html and the page's policy (Tauri's fallback), and that one is never
/// replaced.
pub(crate) fn gets_worker_policy(content_type: Option<&str>, has_policy: bool) -> bool {
    !has_policy && content_type.is_some_and(is_javascript)
}

/// The main window's `on_web_resource_request` (lib.rs): the worker policy on the app's own scripts.
pub(crate) fn add_worker_policy(
    _request: &Request<Vec<u8>>,
    response: &mut Response<Cow<'static, [u8]>>,
) {
    let has_policy = response.headers().contains_key(CONTENT_SECURITY_POLICY);
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok());
    if !gets_worker_policy(content_type, has_policy) {
        return;
    }
    match HeaderValue::from_str(&POLICY) {
        Ok(value) => {
            response
                .headers_mut()
                .insert(CONTENT_SECURITY_POLICY, value);
        }
        // Never happens with the file as written (tested below); the page's own policy still holds.
        Err(error) => eprintln!("the worker policy is not a valid header: {error}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::utils::mime_type::MimeType;

    fn request(uri: &str) -> Request<Vec<u8>> {
        Request::builder().uri(uri).body(Vec::new()).unwrap()
    }

    fn response(content_type: Option<&str>, policy: Option<&str>) -> Response<Cow<'static, [u8]>> {
        let mut builder = Response::builder();
        if let Some(content_type) = content_type {
            builder = builder.header(CONTENT_TYPE, content_type);
        }
        if let Some(policy) = policy {
            builder = builder.header(CONTENT_SECURITY_POLICY, policy);
        }
        builder.body(Cow::Borrowed(&b""[..])).unwrap()
    }

    /// The Content-Type Tauri 2.12.5 gives an address, as its protocol does before the handler runs: the query and
    /// fragment left out, a trailing `/` dropped, the path percent-decoded, then its own `MimeType::parse` of the
    /// decoded path (an empty body, so nothing is sniffed from the content).
    fn served_type(uri: &str) -> String {
        let mut path = uri.split(['?', '#']).next().unwrap_or_default().to_owned();
        if path.ends_with('/') {
            path.pop();
        }
        MimeType::parse(&[], &percent_decoded(&path))
    }

    fn percent_decoded(path: &str) -> String {
        let bytes = path.as_bytes();
        let mut out = Vec::with_capacity(bytes.len());
        let mut i = 0;
        while i < bytes.len() {
            let hex = bytes
                .get(i + 1..i + 3)
                .and_then(|pair| std::str::from_utf8(pair).ok())
                .and_then(|pair| u8::from_str_radix(pair, 16).ok());
            match (bytes[i], hex) {
                (b'%', Some(byte)) => {
                    out.push(byte);
                    i += 3;
                }
                (byte, _) => {
                    out.push(byte);
                    i += 1;
                }
            }
        }
        String::from_utf8_lossy(&out).into_owned()
    }

    /// What the handler does to the response Tauri makes for an address with no policy of its own.
    fn policy_for(uri: &str) -> Option<String> {
        let mut answer = response(Some(&served_type(uri)), None);
        add_worker_policy(&request(uri), &mut answer);
        answer
            .headers()
            .get(CONTENT_SECURITY_POLICY)
            .map(|value| value.to_str().unwrap().to_owned())
    }

    #[test]
    fn the_policy_is_the_strict_one_in_the_file() {
        assert_eq!(
            POLICY.as_str(),
            "default-src 'none'; script-src 'self'; worker-src 'self'; base-uri 'none'"
        );
        assert!(HeaderValue::from_str(&POLICY).is_ok());
    }

    #[test]
    fn javascript_is_known_by_its_type_with_or_without_parameters_in_any_case() {
        for content_type in [
            "text/javascript",
            "application/javascript",
            "text/javascript; charset=utf-8",
            "application/javascript;charset=UTF-8",
            "TEXT/JAVASCRIPT",
            " Text/JavaScript ; charset=utf-8",
            "application/x-javascript",
            "text/ecmascript",
        ] {
            assert!(
                gets_worker_policy(Some(content_type), false),
                "{content_type}"
            );
        }
        for content_type in [
            "text/html",
            "text/html; charset=utf-8",
            "text/css",
            "application/json",
            "image/png",
            "font/woff2",
            "application/wasm",
            "text/javascriptx",
            "text/plain; x=text/javascript",
            "",
        ] {
            assert!(
                !gets_worker_policy(Some(content_type), false),
                "{content_type}"
            );
        }
        assert!(!gets_worker_policy(None, false));
    }

    #[test]
    fn scripts_get_it_whatever_their_query_or_address() {
        for uri in [
            "tauri://localhost/assets/worker-pwfgZlae.js",
            "http://tauri.localhost/assets/pdf.worker.min-Dr1KORA9.mjs",
            "tauri://localhost/assets/worker.js?v=2",
            "tauri://localhost/assets/worker.mjs#top",
            // Tauri drops the trailing / and decodes %2E before the lookup: the same script, served as one.
            "tauri://localhost/assets/x.js/",
            "tauri://localhost/assets/x%2Ejs",
            "tauri://localhost/assets/x%2emjs",
        ] {
            assert_eq!(policy_for(uri).as_deref(), Some(POLICY.as_str()), "{uri}");
        }
    }

    #[test]
    fn nothing_else_gets_it() {
        for uri in [
            "tauri://localhost/",
            "tauri://localhost/index.html",
            "tauri://localhost/assets/index.css",
            "tauri://localhost/assets/es.json",
            "tauri://localhost/assets/logo.png",
            "tauri://localhost/assets/font.woff2",
            "tauri://localhost/assets/worker.js.map",
            "tauri://localhost/assets/page.html?x=.js",
            "tauri://localhost/assets/jsx",
            // Tauri types an upper-case extension as text/html (its MimeType is case-sensitive), and its lookup,
            // case-sensitive too, falls back to index.html with the page's policy: no webview runs it as a script.
            "http://tauri.localhost/ASSETS/WORKER.JS",
            "/assets/Index.MJS?x=1.html",
        ] {
            assert_eq!(policy_for(uri), None, "{uri}");
        }
    }

    #[test]
    fn an_existing_policy_is_never_replaced() {
        // A missing script falls back to index.html, which carries the page's policy (and its type from the address).
        assert!(!gets_worker_policy(Some("text/javascript"), true));
        let page = "default-src 'self'";
        let mut answer = response(Some("text/javascript"), Some(page));
        add_worker_policy(&request("tauri://localhost/assets/gone.js"), &mut answer);
        assert_eq!(answer.headers()[CONTENT_SECURITY_POLICY], page);
        // A page keeps its own policy.
        let mut html = response(Some("text/html"), Some(page));
        add_worker_policy(&request("tauri://localhost/index.html"), &mut html);
        assert_eq!(html.headers()[CONTENT_SECURITY_POLICY], page);
    }

    #[test]
    fn the_handler_puts_it_on_a_script_and_leaves_the_rest() {
        let mut script = response(Some("text/javascript"), None);
        add_worker_policy(
            &request("tauri://localhost/assets/worker-pwfgZlae.js"),
            &mut script,
        );
        assert_eq!(script.headers()[CONTENT_SECURITY_POLICY], POLICY.as_str());
        let mut charset = response(Some("application/javascript; charset=utf-8"), None);
        add_worker_policy(&request("tauri://localhost/assets/w.js"), &mut charset);
        assert_eq!(charset.headers()[CONTENT_SECURITY_POLICY], POLICY.as_str());
        for (uri, content_type) in [
            ("tauri://localhost/assets/index.css", "text/css"),
            ("tauri://localhost/assets/es.json", "application/json"),
        ] {
            let mut other = response(Some(content_type), None);
            add_worker_policy(&request(uri), &mut other);
            assert!(
                !other.headers().contains_key(CONTENT_SECURITY_POLICY),
                "{uri}"
            );
        }
        // No type at all: never a script.
        let mut untyped = response(None, None);
        add_worker_policy(&request("tauri://localhost/assets/x.js"), &mut untyped);
        assert!(!untyped.headers().contains_key(CONTENT_SECURITY_POLICY));
    }

    /// The test's own folder, deleted when the test ends, passed or failed, as command_tests.rs's Harness does.
    struct TempFolder(std::path::PathBuf);

    impl Drop for TempFolder {
        fn drop(&mut self) {
            let mut tries = 0;
            loop {
                match std::fs::remove_dir_all(&self.0) {
                    Ok(()) => break,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
                    // Windows can take a moment to let go of a file just closed.
                    Err(_) if tries < 10 => {
                        tries += 1;
                        std::thread::sleep(std::time::Duration::from_millis(50));
                    }
                    Err(error) => {
                        eprintln!(
                            "the test's folder {} couldn't be deleted: {error}",
                            self.0.display()
                        );
                        break;
                    }
                }
            }
        }
    }

    /// The main window is built in setup now (lib.rs's `main_window`), from its config entry with every setting kept.
    /// Tauri's mock runtime never serves an asset (it has no webview and no protocol handler), so the header itself
    /// is checked through the handler above, not through the mock.
    #[test]
    fn the_main_window_is_built_from_its_config_with_its_settings() {
        use tauri::test::{mock_builder, MockRuntime};
        use tauri::utils::config::{AppDirectoriesOverride, Color};
        use tauri::Manager;

        let mut context = crate::app_context::<MockRuntime>();
        let main = context
            .config()
            .app
            .windows
            .iter()
            .find(|window| window.label == "main")
            .expect("tauri.conf.json has the main window")
            .clone();
        // Not made by Tauri from the config (it would come without the worker policy), but by setup.
        assert!(!main.create);
        // Hidden until the page has loaded (on_page_load, and the 3-second safety net, show it).
        assert!(!main.visible);
        assert_eq!(main.title, "Storiiboard");
        assert_eq!((main.width, main.height), (1280.0, 800.0));
        assert_eq!(
            (main.min_width, main.min_height),
            (Some(960.0), Some(600.0))
        );
        assert_eq!(main.background_color, Some(Color(0xEE, 0xE9, 0xDF, 255)));
        // The pictures dropped from the system (pictures.rs) need Tauri's file drop.
        assert!(main.drag_drop_enabled);
        // Never this computer's own folders, should anything ask for them; deleted when the test ends.
        let folder =
            TempFolder(std::env::temp_dir().join(format!("sbd-window-{}", std::process::id())));
        context.config_mut().app.app_directories_override =
            Some(AppDirectoriesOverride::Root(folder.0.clone()));
        let app = crate::with_commands(mock_builder())
            .build(context)
            .expect("the app builds on the mock runtime");
        assert!(app.get_webview_window("main").is_none());
        let window = crate::main_window(app.handle())
            .expect("the main window's builder")
            .build()
            .expect("the main window opens on the mock runtime");
        assert_eq!(window.label(), "main");
        assert!(app.get_webview_window("main").is_some());
        // The app before its folder, so nothing it holds is still open when the folder goes.
        drop(window);
        drop(app);
        drop(folder);
    }

    /// The real built files, where `npm run build` has made them: each file in dist/assets typed as Tauri types it
    /// (its own `MimeType::parse` of the file's bytes and name), and the rule must pick exactly the .js and .mjs
    /// files. It checks the rule against the built files' names and types, not the header in a running app (a release
    /// build has no web inspector; docs/ALPHA_TEST.md has the by-hand check in a debug build). Ignored by default,
    /// since the tests' build embeds no dist (it never passes where there is none): run it after a build with
    /// `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored every_built_script_gets_it`.
    #[test]
    #[ignore = "needs a built dist/ (npm run build)"]
    fn every_built_script_gets_it() {
        let dist = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../dist/assets");
        let entries =
            std::fs::read_dir(&dist).expect("dist/assets exists: run npm run build first");
        let mut scripts = 0;
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let bytes = std::fs::read(entry.path()).expect("a built file reads");
            let content_type = MimeType::parse(&bytes, &format!("/assets/{name}"));
            let script = name.ends_with(".js") || name.ends_with(".mjs");
            assert_eq!(
                gets_worker_policy(Some(&content_type), false),
                script,
                "{name} ({content_type})"
            );
            scripts += usize::from(script);
        }
        assert!(scripts > 0, "dist/assets holds no script");
    }
}
