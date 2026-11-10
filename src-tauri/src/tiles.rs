//! Map tiles (4.9; Kevin, Nov 9 and 10): the pictures the Locations tile's map is drawn from, fetched here and kept on
//! disk, under OpenStreetMap's tile policy. The page asks for one tile at a time (`map_tile`) and only for those in
//! view, so nothing here ever fetches a neighbour, another zoom or a region ahead of time, and nothing downloads for
//! offline use. What the policy asks, and where it is kept:
//! - this app's User-Agent (net.rs), never a browser's; HTTPS only; zoom 0 to 19 (`check_range`);
//! - at most 2 requests at a time (`GATE`);
//! - cache headers honoured: `Cache-Control: max-age`, else `Expires`, else 7 days (`stay`); a stale tile is renewed
//!   with `If-None-Match` and `If-Modified-Since`, and a 304 keeps it (`tile_with`);
//! - the credit is the page's (LocationMap.tsx), always on the map.
//!
//! The cache lives in the app's cache folder, never in a project, capped at 200 MB with the oldest-read tile deleted
//! first (`prune`). A tile server of the person's own (Settings → Online services) replaces OpenStreetMap's: it is one
//! more host for tiles only, kept in `tile-provider.json` in the app's data folder, which only this file reads and
//! writes, so the page can't change it per request. Its tiles are cached apart from OpenStreetMap's.

use std::{
    collections::VecDeque,
    fs,
    future::Future,
    path::{Path, PathBuf},
    pin::Pin,
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Mutex,
    },
    task::{Context, Poll, Waker},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use reqwest::Url;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

use crate::{net, services, weather};

/// The service switch's id for OpenStreetMap's tiles (services.rs `REGISTRY`).
const SERVICE: &str = "osm-tiles";
/// OpenStreetMap's tile policy: 2 connections at most.
const MAX_IN_FLIGHT: usize = 2;
const MAX_ZOOM: u8 = 19;
/// How long a tile stands when the server says nothing about it: OpenStreetMap's policy asks for at least 7 days.
const DEFAULT_STAY: i64 = 7 * 24 * 60 * 60;
/// No server's word keeps a tile longer than this.
const LONGEST_STAY: i64 = 365 * 24 * 60 * 60;
/// The most the tile cache may take on disk.
const CAP: u64 = 200 * 1_000_000;
/// The cache is measured again after this many writes, not after each: it is a walk of every tile.
const PRUNE_EVERY: u32 = 200;
const PROVIDER_FILE: &str = "tile-provider.json";
const BAD_TILE: &str = "That tile is outside the map.";
const NOT_A_PICTURE: &str = "The tile server sent something that isn't a picture.";
const MAX_ATTRIBUTION: usize = 200;
const MAX_TEMPLATE: usize = 300;

// --- At most 2 at a time --------------------------------------------------------------------------------------

/// A counting gate: `acquire` waits while `MAX_IN_FLIGHT` requests are out. Written here because the async runtime's
/// own semaphore isn't something this crate depends on directly.
struct Gate {
    state: Mutex<(usize, VecDeque<Waker>)>,
    limit: usize,
}

struct Permit<'a>(&'a Gate);

struct Acquire<'a>(&'a Gate);

impl Gate {
    const fn new(limit: usize) -> Self {
        Self {
            state: Mutex::new((0, VecDeque::new())),
            limit,
        }
    }

    fn acquire(&self) -> Acquire<'_> {
        Acquire(self)
    }
}

impl<'a> Future for Acquire<'a> {
    type Output = Permit<'a>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Permit<'a>> {
        let gate = self.0;
        let mut state = gate.state.lock().unwrap_or_else(|e| e.into_inner());
        if state.0 < gate.limit {
            state.0 += 1;
            Poll::Ready(Permit(gate))
        } else {
            state.1.push_back(cx.waker().clone());
            Poll::Pending
        }
    }
}

impl Drop for Permit<'_> {
    fn drop(&mut self) {
        let mut state = self.0.state.lock().unwrap_or_else(|e| e.into_inner());
        state.0 -= 1;
        // All of them, not one: a waiter that gave up leaves a waker that would swallow a single wake.
        let waiting: Vec<Waker> = state.1.drain(..).collect();
        drop(state);
        for waker in waiting {
            waker.wake();
        }
    }
}

static GATE: Gate = Gate::new(MAX_IN_FLIGHT);

// --- Which tiles --------------------------------------------------------------------------------------------

/// Zoom 0 to 19, and x and y inside the 2^z by 2^z grid; anything else is refused before any file or request.
fn check_range(z: u8, x: u32, y: u32) -> Result<(), String> {
    if z > MAX_ZOOM {
        return Err(BAD_TILE.to_owned());
    }
    let side = 1u32 << z;
    if x >= side || y >= side {
        return Err(BAD_TILE.to_owned());
    }
    Ok(())
}

/// OpenStreetMap's address for a tile, from the service switch's server (`https://tile.openstreetmap.org`).
fn osm_url(server: &str, z: u8, x: u32, y: u32) -> Result<Url, String> {
    Url::parse(&format!("{}/{z}/{x}/{y}.png", server.trim_end_matches('/')))
        .map_err(|_| net::ODD_ANSWER.to_owned())
}

// --- A tile server of one's own ---------------------------------------------------------------------------

/// The person's own tile server: an address with {z}, {x} and {y} once each, over HTTPS, and a host name.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Provider {
    pub template: String,
    /// The credit its terms ask for, printed with "Map tiles: <host>".
    pub attribution: String,
    pub host: String,
}

const QUERY_REFUSED: &str = "A tile address with a key isn't supported yet.";
/// A leftover temporary file older than this is from a crash or a quit mid-write, and goes at the next prune.
const LEFTOVER_AGE: Duration = Duration::from_secs(10 * 60);

const BAD_TEMPLATE: &str =
    "The address must be https://, a host name, and contain {z}, {x} and {y} once each.";

/// The host of a valid template, or why it isn't one.
fn validate_template(template: &str) -> Result<String, String> {
    let bad = || BAD_TEMPLATE.to_owned();
    if template.len() > MAX_TEMPLATE
        || !template.starts_with("https://")
        || template
            .chars()
            .any(|c| c.is_whitespace() || c.is_control())
    {
        return Err(bad());
    }
    // A key in the address would sit in plain text in the settings; keys belong in the keychain, which is not built yet.
    if template.contains('?') {
        return Err(QUERY_REFUSED.to_owned());
    }
    for slot in ["{z}", "{x}", "{y}"] {
        if template.matches(slot).count() != 1 {
            return Err(bad());
        }
    }
    let with = |z: &str, x: &str, y: &str| {
        template
            .replace("{z}", z)
            .replace("{x}", x)
            .replace("{y}", y)
    };
    // Any other brace left over is a placeholder this app doesn't know ({s}, {r}).
    let numbers = with("1", "2", "3");
    if numbers.contains(['{', '}']) {
        return Err(bad());
    }
    let url = Url::parse(&numbers).map_err(|_| bad())?;
    let other = Url::parse(&with("a", "b", "c")).map_err(|_| bad())?;
    // A slot inside the host name would change it from tile to tile.
    let host = url.domain().ok_or_else(bad)?;
    // A name that points back at this computer or has one label is no tile server on the internet; IP literals never
    // reach here (`domain()` is none for them).
    let lower = host.to_ascii_lowercase();
    if other.domain() != Some(host)
        || !host.contains('.')
        || lower.ends_with('.')
        || lower.ends_with("localhost")
        || net::is_listed(&lower)
        || url.query().is_some()
        || url.scheme() != "https"
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(bad());
    }
    Ok(host.to_ascii_lowercase())
}

/// An attribution as kept: no control characters, trimmed, at most `MAX_ATTRIBUTION` characters.
fn clean_attribution(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_control())
        .collect::<String>()
        .trim()
        .chars()
        .take(MAX_ATTRIBUTION)
        .collect()
}

impl Provider {
    fn new(template: &str, attribution: &str) -> Result<Self, String> {
        let template = template.trim();
        let host = validate_template(template)?;
        Ok(Self {
            template: template.to_owned(),
            attribution: clean_attribution(attribution),
            host,
        })
    }

    fn url(&self, z: u8, x: u32, y: u32) -> Result<Url, String> {
        Url::parse(
            &self
                .template
                .replace("{z}", &z.to_string())
                .replace("{x}", &x.to_string())
                .replace("{y}", &y.to_string()),
        )
        .map_err(|_| net::ODD_ANSWER.to_owned())
    }

    /// The cache folder for its tiles, apart from OpenStreetMap's and from another server's.
    fn folder(&self) -> String {
        let safe: String = self
            .host
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '.' || c == '-' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        format!("own-{safe}")
    }
}

fn provider_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(PROVIDER_FILE))
}

/// What the file holds, checked again as a person's edit of it could break the rules; nothing is OpenStreetMap.
fn load_provider(path: &Path) -> Option<Provider> {
    let text = fs::read_to_string(path).ok()?;
    let saved: Provider = serde_json::from_str(&text).ok()?;
    Provider::new(&saved.template, &saved.attribution).ok()
}

fn save_provider(path: &Path, provider: Option<&Provider>) -> Result<(), String> {
    match provider {
        None => match fs::remove_file(path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        },
        Some(provider) => {
            if let Some(dir) = path.parent() {
                fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            }
            let temp = path.with_extension("json.tmp");
            fs::write(
                &temp,
                serde_json::to_string(provider).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            fs::rename(&temp, path).map_err(|e| e.to_string())
        }
    }
}

// --- The cache ---------------------------------------------------------------------------------------------

/// Written beside each tile (`y.json`): when it stands until, and what to send back when renewing it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
struct Sidecar {
    /// Unix seconds.
    expires: i64,
    etag: Option<String>,
    last_modified: Option<String>,
}

/// How long a tile stands, from the server's headers, as the moment (unix seconds) it goes stale.
fn stay(answer: &net::Bytes, now: i64) -> i64 {
    let mut max_age = None;
    for part in answer
        .cache_control
        .as_deref()
        .unwrap_or("")
        .to_ascii_lowercase()
        .split(',')
    {
        let part = part.trim();
        // Asked to keep nothing: it stands for no time (kept only to be renewed with validators).
        if part == "no-store" || part == "no-cache" {
            return now;
        }
        if let Some(seconds) = part.strip_prefix("max-age=") {
            max_age = seconds.trim_matches('"').parse::<i64>().ok();
        }
    }
    let seconds = match (max_age, answer.expires.as_deref()) {
        (Some(seconds), _) => seconds,
        (None, Some(expires)) => match weather::http_date(expires) {
            // The server's own clock when it gave one, so a computer's wrong clock doesn't defeat it.
            Some(at) => match answer.date.as_deref().and_then(weather::http_date) {
                Some(date) => at - date,
                None => at - now,
            },
            // "0" or any other date it can't read means already out of date, as HTTP says.
            None => 0,
        },
        (None, None) => DEFAULT_STAY,
    };
    now + seconds.clamp(0, LONGEST_STAY)
}

fn now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| i64::try_from(since.as_secs()).unwrap_or(0))
}

/// PNG, JPEG or WebP, by the first bytes: a server's error page never reaches the map as a picture.
fn is_picture(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0x89, b'P', b'N', b'G'])
        || bytes.starts_with(&[0xFF, 0xD8, 0xFF])
        || (bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP")
}

fn tile_paths(root: &Path, folder: &str, z: u8, x: u32, y: u32) -> (PathBuf, PathBuf) {
    let dir = root.join(folder).join(z.to_string()).join(x.to_string());
    (dir.join(format!("{y}.png")), dir.join(format!("{y}.json")))
}

/// A temporary file renamed over the old one, so a crash mid-write leaves the old tile.
fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    // `y.png.tmp` and `y.json.tmp`: a tile and its sidecar never share a temporary name.
    let mut name = path.file_name().unwrap_or_default().to_owned();
    name.push(".tmp");
    let temp = path.with_file_name(name);
    fs::write(&temp, bytes)?;
    fs::rename(&temp, path)
}

/// Marks a tile as read now: what `prune` deletes last. A drive that won't take it only costs the order.
fn touch(path: &Path) {
    if let Ok(file) = fs::OpenOptions::new().write(true).open(path) {
        let _ = file.set_modified(SystemTime::now());
    }
}

static WRITES: AtomicU32 = AtomicU32::new(0);
/// Whether this launch has measured the cache yet: the first write does, so a cache already over its cap is cut down
/// even by a short session.
static MEASURED: AtomicBool = AtomicBool::new(false);

/// Whether the server asked that the tile not be stored (`Cache-Control: no-store`): it is shown and not written.
fn no_store(answer: &net::Bytes) -> bool {
    answer.cache_control.as_deref().is_some_and(|value| {
        value
            .to_ascii_lowercase()
            .split(',')
            .any(|p| p.trim() == "no-store")
    })
}

/// A tile: from disk when it still stands, else fetched with `fetch` (the network in the app, a stand-in in tests; it
/// works out the address, so the service switch is asked only when a request is really about to go out), renewed with the validators it holds when stale, and kept. A stale tile is shown when the renewal fails
/// (offline, refused), since an old picture of the street beats a grey square.
async fn tile_with<F, Fut>(
    root: &Path,
    folder: &str,
    (z, x, y): (u8, u32, u32),
    now: i64,
    fetch: F,
) -> Result<Vec<u8>, String>
where
    F: FnOnce(net::Validators) -> Fut,
    Fut: Future<Output = Result<net::Bytes, String>>,
{
    check_range(z, x, y)?;
    let (png, side) = tile_paths(root, folder, z, x, y);
    let held_bytes = fs::read(&png).ok().filter(|bytes| is_picture(bytes));
    let held: Option<Sidecar> = held_bytes.as_ref().and_then(|_| {
        fs::read_to_string(&side)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
    });
    if let (Some(bytes), Some(held)) = (&held_bytes, &held) {
        if held.expires > now {
            touch(&png);
            return Ok(bytes.clone());
        }
    }
    let validators = held
        .as_ref()
        .map_or_else(net::Validators::default, |h| net::Validators {
            etag: h.etag.clone(),
            last_modified: h.last_modified.clone(),
        });
    let reply = {
        let _permit = GATE.acquire().await;
        fetch(validators).await
    };
    match reply {
        Ok(answer) if answer.not_modified => match (held_bytes, held) {
            (Some(bytes), Some(held)) => {
                let keep = !no_store(&answer);
                let renewed = Sidecar {
                    expires: stay(&answer, now),
                    etag: answer.etag.or(held.etag),
                    last_modified: answer.last_modified.or(held.last_modified),
                };
                if keep {
                    if let Ok(text) = serde_json::to_string(&renewed) {
                        let _ = write_atomic(&side, text.as_bytes());
                    }
                }
                touch(&png);
                Ok(bytes)
            }
            _ => Err(net::ODD_ANSWER.to_owned()),
        },
        Ok(answer) => {
            if !is_picture(&answer.bytes) {
                return held_bytes.ok_or_else(|| NOT_A_PICTURE.to_owned());
            }
            let sidecar = Sidecar {
                expires: stay(&answer, now),
                etag: answer.etag.clone(),
                last_modified: answer.last_modified.clone(),
            };
            // A disk that won't take the tile costs only the next fetch, never the map. `no-store` is not written.
            if !no_store(&answer) && write_atomic(&png, &answer.bytes).is_ok() {
                if let Ok(text) = serde_json::to_string(&sidecar) {
                    let _ = write_atomic(&side, text.as_bytes());
                }
                if !MEASURED.swap(true, Ordering::Relaxed)
                    || WRITES.fetch_add(1, Ordering::Relaxed) >= PRUNE_EVERY
                {
                    WRITES.store(0, Ordering::Relaxed);
                    // A walk of every tile: off the thread that answers the map.
                    let root = root.to_path_buf();
                    drop(tauri::async_runtime::spawn_blocking(move || {
                        prune(&root, CAP)
                    }));
                }
            }
            Ok(answer.bytes)
        }
        Err(error) => held_bytes.ok_or(error),
    }
}

type Found = Vec<(PathBuf, u64, SystemTime)>;

/// Every tile under `root` with its size (picture and sidecar) and when it was last read.
fn tiles_under(root: &Path) -> Found {
    scan(root).0
}

/// The tiles under `root`, and the temporary files a crash or a quit left half-written (they take space too).
fn scan(root: &Path) -> (Found, Found) {
    let mut found = Vec::new();
    let mut leftovers = Vec::new();
    let mut folders = vec![root.to_path_buf()];
    while let Some(folder) = folders.pop() {
        let Ok(entries) = fs::read_dir(&folder) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                folders.push(path);
            } else if path.extension().is_some_and(|e| e == "tmp") {
                if let Ok(meta) = entry.metadata() {
                    leftovers.push((path, meta.len(), meta.modified().unwrap_or(UNIX_EPOCH)));
                }
            } else if path.extension().is_some_and(|e| e == "png") {
                let Ok(meta) = entry.metadata() else { continue };
                let side = fs::metadata(path.with_extension("json")).map_or(0, |m| m.len());
                found.push((
                    path,
                    meta.len() + side,
                    meta.modified().unwrap_or(UNIX_EPOCH),
                ));
            }
        }
    }
    (found, leftovers)
}

/// Deletes the oldest-read tiles until what is left takes at most `cap` bytes. Only this folder's tiles.
fn prune(root: &Path, cap: u64) {
    let (mut tiles, leftovers) = scan(root);
    let mut total: u64 = tiles.iter().map(|t| t.1).sum();
    // A half-written file that has been there a while is nobody's work in progress.
    for (path, size, modified) in leftovers {
        if modified.elapsed().is_ok_and(|age| age > LEFTOVER_AGE) && fs::remove_file(&path).is_ok()
        {
            total = total.saturating_sub(size);
        } else {
            total += size;
        }
    }
    if total <= cap {
        return;
    }
    tiles.sort_by_key(|t| t.2);
    for (path, size, _) in tiles {
        if total <= cap {
            break;
        }
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(path.with_extension("json"));
        total = total.saturating_sub(size);
    }
}

// --- The commands ------------------------------------------------------------------------------------------

fn cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map(|dir| dir.join("tiles"))
        .map_err(|e| e.to_string())
}

/// The tile for the map in view, from the cache or, when one must go out, from the server. `server` asks the service
/// switch (OpenStreetMap's tiles only) and is called only when a request is about to be made; `fetch` is the network
/// in the app and a stand-in in tests.
async fn tile_for<S, SFut, F, Fut>(
    root: &Path,
    own: Option<Provider>,
    tile: (u8, u32, u32),
    now: i64,
    server: S,
    fetch: F,
) -> Result<Vec<u8>, String>
where
    S: FnOnce() -> SFut,
    SFut: Future<Output = Result<String, String>>,
    F: FnOnce(Url, Option<String>, net::Validators) -> Fut,
    Fut: Future<Output = Result<net::Bytes, String>>,
{
    let (z, x, y) = tile;
    check_range(z, x, y)?;
    let folder = own
        .as_ref()
        .map_or_else(|| "osm".to_owned(), Provider::folder);
    tile_with(root, &folder, tile, now, |held| async move {
        let (url, extra) = match own {
            // The service switch is OpenStreetMap's: it says nothing about a server of the person's own.
            Some(own) => (own.url(z, x, y)?, Some(own.host)),
            None => (osm_url(&server().await?, z, x, y)?, None),
        };
        fetch(url, extra, held).await
    })
    .await
}

/// One map tile as a picture, for the map in view. The page asks for nothing but the tiles it is drawing.
#[tauri::command]
pub async fn map_tile(
    app: AppHandle,
    z: u8,
    x: u32,
    y: u32,
) -> Result<tauri::ipc::Response, String> {
    let own = provider_path(&app).and_then(|path| load_provider(&path));
    let root = cache_root(&app)?;
    let handle = app.clone();
    let bytes = tile_for(
        &root,
        own,
        (z, x, y),
        now_seconds(),
        || async move { services::service_server(&handle, SERVICE).await },
        |url, extra, held| async move { net::get_bytes(url, extra.as_deref(), &held).await },
    )
    .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// What the cache holds, for Settings → Storage.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TilesInfo {
    tiles: usize,
    bytes: u64,
    cap_bytes: u64,
}

fn info_of(root: &Path) -> TilesInfo {
    let (tiles, leftovers) = scan(root);
    TilesInfo {
        tiles: tiles.len(),
        bytes: tiles.iter().chain(leftovers.iter()).map(|t| t.1).sum(),
        cap_bytes: CAP,
    }
}

#[tauri::command]
pub async fn map_tiles_info(app: AppHandle) -> Result<TilesInfo, String> {
    let root = cache_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || info_of(&root))
        .await
        .map_err(|e| e.to_string())
}

/// Deletes every cached tile (this app's own cache folder only) and says how many there were.
#[tauri::command]
pub async fn map_tiles_clear(app: AppHandle) -> Result<usize, String> {
    let root = cache_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let count = tiles_under(&root).len();
        match fs::remove_dir_all(&root) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(count),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The tile server of one's own, or none (OpenStreetMap).
#[tauri::command]
pub async fn map_tile_provider(app: AppHandle) -> Option<Provider> {
    provider_path(&app).and_then(|path| load_provider(&path))
}

/// The words of the question put to the person before a tile server is saved, in their language (`en` or `es`, English
/// for any other): title, text with the host in it, and the two buttons. Said here, not by the page, so the host named
/// is the one that will be contacted.
fn question(language: &str, host: &str) -> (String, String, String, String) {
    let (title, text, ok, cancel) = if language.starts_with("es") {
        (
            "Servidor de mosaicos del mapa",
            "¿Obtener los mosaicos del mapa de {host}? Storiiboard contactará a ese servidor para los mosaicos del mapa que veas.",
            "Usar este servidor",
            "Cancelar",
        )
    } else {
        (
            "Map tile server",
            "Get map tiles from {host}? Storiiboard will contact that server for the map tiles you view.",
            "Use this server",
            "Cancel",
        )
    };
    (
        title.to_owned(),
        text.replace("{host}", host),
        ok.to_owned(),
        cancel.to_owned(),
    )
}

/// What `map_tile_provider_set` did, for the page: `set` (with the provider), `cleared` (back to OpenStreetMap) or
/// `cancelled` (the person said no; nothing was saved).
#[derive(Debug, Serialize, PartialEq)]
pub struct ProviderOutcome {
    status: &'static str,
    provider: Option<Provider>,
}

/// Sets the tile server of one's own, or with no template goes back to OpenStreetMap. Checked here, not by the page,
/// and a host not already saved is asked about first, in a window of the system's, naming it; Cancel saves nothing.
#[tauri::command]
pub async fn map_tile_provider_set(
    app: AppHandle,
    template: String,
    attribution: String,
    language: String,
) -> Result<ProviderOutcome, String> {
    let path =
        provider_path(&app).ok_or_else(|| "Storiiboard can't find its data folder.".to_owned())?;
    if template.trim().is_empty() {
        save_provider(&path, None)?;
        return Ok(ProviderOutcome {
            status: "cleared",
            provider: None,
        });
    }
    let provider = Provider::new(&template, &attribution)?;
    let known = load_provider(&path).is_some_and(|saved| saved.host == provider.host);
    if !known {
        let (title, text, ok, cancel) = question(&language, &provider.host);
        let handle = app.clone();
        let agreed = tauri::async_runtime::spawn_blocking(move || {
            let mut builder = handle
                .dialog()
                .message(text)
                .title(title)
                .buttons(MessageDialogButtons::OkCancelCustom(ok, cancel));
            // Attached to the window, so it's a sheet on a Mac and modal on Windows.
            if let Some(window) = handle.get_webview_window("main") {
                builder = builder.parent(&window);
            }
            builder.blocking_show()
        })
        .await
        .map_err(|e| e.to_string())?;
        if !agreed {
            return Ok(ProviderOutcome {
                status: "cancelled",
                provider: None,
            });
        }
    }
    save_provider(&path, Some(&provider))?;
    Ok(ProviderOutcome {
        status: "set",
        provider: Some(provider),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        cell::Cell,
        sync::atomic::{AtomicUsize, Ordering as O},
        sync::Arc,
        time::Duration,
    };

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 1, 2, 3, 4, 5];
    const OSM: &str = "https://tile.openstreetmap.org";

    fn temp_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("tiles-{name}-{}-{nanos}", std::process::id()))
    }

    fn url() -> Url {
        osm_url(OSM, 16, 20, 30).expect("URL")
    }

    fn reply(cache_control: Option<&str>) -> net::Bytes {
        net::Bytes {
            bytes: PNG.to_vec(),
            cache_control: cache_control.map(str::to_owned),
            etag: Some("\"abc\"".to_owned()),
            last_modified: Some("Mon, 16 Nov 2026 11:42:10 GMT".to_owned()),
            ..net::Bytes::default()
        }
    }

    /// What `get` saw asked of the network: the address and the validators sent.
    type Seen = Option<(Url, net::Validators)>;

    fn get(
        root: &Path,
        now: i64,
        answer: Result<net::Bytes, String>,
    ) -> (Result<Vec<u8>, String>, Seen) {
        let seen = std::cell::RefCell::new(None);
        let result =
            tauri::async_runtime::block_on(tile_with(root, "osm", (16, 20, 30), now, |held| {
                *seen.borrow_mut() = Some((url(), held));
                async { answer }
            }));
        (result, seen.into_inner())
    }

    #[test]
    fn the_address_is_the_hosts_z_x_y() {
        assert_eq!(
            url().as_str(),
            "https://tile.openstreetmap.org/16/20/30.png"
        );
        assert!(net::allowed(&url()));
    }

    #[test]
    fn only_zoom_0_to_19_inside_the_grid() {
        assert!(check_range(0, 0, 0).is_ok());
        assert!(check_range(19, 524_287, 524_287).is_ok());
        assert!(check_range(20, 0, 0).is_err());
        assert!(check_range(0, 1, 0).is_err());
        assert!(check_range(0, 0, 1).is_err());
        assert!(check_range(3, 8, 0).is_err());
        assert!(check_range(3, 0, 8).is_err());
        assert!(check_range(19, 524_288, 0).is_err());
        // Refused before a file or a request: the fetch is never called.
        let asked = Cell::new(0);
        let refused = tauri::async_runtime::block_on(tile_for(
            &temp_dir("range"),
            None,
            (20, 0, 0),
            0,
            || async {
                asked.set(asked.get() + 1);
                Ok(OSM.to_owned())
            },
            |_, _, _| {
                asked.set(asked.get() + 1);
                async { Ok(reply(None)) }
            },
        ));
        assert!(refused.is_err());
        assert_eq!(asked.get(), 0);
    }

    #[test]
    fn a_fresh_tile_is_read_without_a_fetch() {
        let root = temp_dir("fresh");
        let (first, seen) = get(&root, 1_000, Ok(reply(Some("max-age=600"))));
        assert_eq!(first.as_deref(), Ok(PNG));
        // The first fetch held nothing to renew.
        assert_eq!(seen.expect("fetched").1, net::Validators::default());
        let (second, seen) = get(&root, 1_599, Err("no network".to_owned()));
        assert_eq!(second.as_deref(), Ok(PNG));
        assert!(seen.is_none(), "a fresh tile makes no request");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_stale_tile_is_renewed_with_its_validators_and_a_304_keeps_it() {
        let root = temp_dir("stale");
        let _ = get(&root, 1_000, Ok(reply(Some("max-age=600"))));
        let not_modified = net::Bytes {
            not_modified: true,
            cache_control: Some("max-age=100".to_owned()),
            ..net::Bytes::default()
        };
        let (kept, seen) = get(&root, 1_600, Ok(not_modified));
        assert_eq!(kept.as_deref(), Ok(PNG));
        let (requested, held) = seen.expect("renewed");
        assert_eq!(requested, url());
        assert_eq!(held.etag.as_deref(), Some("\"abc\""));
        assert_eq!(
            held.last_modified.as_deref(),
            Some("Mon, 16 Nov 2026 11:42:10 GMT")
        );
        // The 304's own word on how long it stands counts, and the validators are still held.
        let (again, seen) = get(&root, 1_699, Err("no network".to_owned()));
        assert_eq!(again.as_deref(), Ok(PNG));
        assert!(seen.is_none());
        let (_, seen) = get(&root, 1_701, Ok(reply(None)));
        assert_eq!(
            seen.expect("stale again").1.etag.as_deref(),
            Some("\"abc\"")
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_stale_tile_is_replaced_by_a_new_one() {
        let root = temp_dir("replaced");
        let _ = get(&root, 1_000, Ok(reply(Some("max-age=1"))));
        let newer = net::Bytes {
            bytes: [PNG, &[9, 9]].concat(),
            ..reply(Some("max-age=600"))
        };
        let (got, _) = get(&root, 2_000, Ok(newer.clone()));
        assert_eq!(got.as_deref(), Ok(newer.bytes.as_slice()));
        let (again, seen) = get(&root, 2_001, Err("x".to_owned()));
        assert_eq!(again.as_deref(), Ok(newer.bytes.as_slice()));
        assert!(seen.is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_stale_tile_shows_when_the_renewal_fails() {
        let root = temp_dir("offline");
        let _ = get(&root, 1_000, Ok(reply(Some("max-age=1"))));
        let (got, _) = get(&root, 9_000, Err(net::NO_CONNECTION.to_owned()));
        assert_eq!(got.as_deref(), Ok(PNG));
        // No tile at all: the error is the answer.
        let (none, _) = get(&temp_dir("nothing"), 0, Err(net::NO_CONNECTION.to_owned()));
        assert_eq!(none, Err(net::NO_CONNECTION.to_owned()));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn something_that_is_not_a_picture_is_never_kept() {
        let root = temp_dir("page");
        let page = net::Bytes {
            bytes: b"<html>busy</html>".to_vec(),
            ..net::Bytes::default()
        };
        let (got, _) = get(&root, 0, Ok(page));
        assert_eq!(got, Err(NOT_A_PICTURE.to_owned()));
        assert!(tiles_under(&root).is_empty());
    }

    #[test]
    fn with_no_headers_a_tile_stands_7_days() {
        let none = net::Bytes::default();
        assert_eq!(stay(&none, 1_000), 1_000 + 7 * 86_400);
        let root = temp_dir("seven");
        let _ = get(&root, 1_000, Ok(reply(None)));
        let (_, seen) = get(&root, 1_000 + 7 * 86_400 - 1, Err("x".to_owned()));
        assert!(seen.is_none());
        let (_, seen) = get(&root, 1_000 + 7 * 86_400 + 1, Err("x".to_owned()));
        assert!(seen.is_some());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_servers_headers_set_how_long_it_stands() {
        let with = |cc: Option<&str>, expires: Option<&str>, date: Option<&str>| {
            stay(
                &net::Bytes {
                    cache_control: cc.map(str::to_owned),
                    expires: expires.map(str::to_owned),
                    date: date.map(str::to_owned),
                    ..net::Bytes::default()
                },
                1_000,
            )
        };
        assert_eq!(with(Some("public, max-age=3600"), None, None), 4_600);
        // max-age beats Expires.
        assert_eq!(
            with(
                Some("max-age=60"),
                Some("Tue, 17 Nov 2026 12:30:00 GMT"),
                None
            ),
            1_060
        );
        // Expires counts from the server's own Date.
        assert_eq!(
            with(
                None,
                Some("Tue, 17 Nov 2026 12:30:00 GMT"),
                Some("Tue, 17 Nov 2026 12:00:00 GMT")
            ),
            1_000 + 1_800
        );
        // No-store, no-cache and an Expires that can't be read mean no time at all.
        assert_eq!(with(Some("no-store"), None, None), 1_000);
        assert_eq!(with(Some("max-age=600, no-cache"), None, None), 1_000);
        assert_eq!(with(None, Some("0"), None), 1_000);
        // A negative or enormous max-age is kept in range.
        assert_eq!(with(Some("max-age=-5"), None, None), 1_000);
        assert_eq!(
            with(Some("max-age=99999999999"), None, None),
            1_000 + LONGEST_STAY
        );
    }

    #[test]
    fn the_cap_deletes_the_oldest_read_first() {
        let root = temp_dir("cap");
        for (y, age) in [(1u32, 300u64), (2, 100), (3, 200)] {
            let (png, side) = tile_paths(&root, "osm", 10, 5, y);
            write_atomic(&png, &[0x89, b'P', b'N', b'G', 0, 0, 0, 0, 0, 0]).unwrap();
            write_atomic(&side, b"{}").unwrap();
            let file = fs::OpenOptions::new().write(true).open(&png).unwrap();
            file.set_modified(SystemTime::now() - Duration::from_secs(age))
                .unwrap();
        }
        // Each tile takes 12 bytes: a cap of 30 keeps two, the two read most recently (y 2 and 3).
        prune(&root, 30);
        let mut left: Vec<String> = tiles_under(&root)
            .iter()
            .map(|t| t.0.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        left.sort();
        assert_eq!(left, ["2.png", "3.png"]);
        assert!(!tile_paths(&root, "osm", 10, 5, 1).1.exists());
        // Under the cap, nothing goes.
        prune(&root, 1_000);
        assert_eq!(tiles_under(&root).len(), 2);
        assert_eq!(info_of(&root).tiles, 2);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_read_counts_as_use_so_it_outlives_older_unread_tiles() {
        let root = temp_dir("read");
        for y in [1u32, 2] {
            let (png, side) = tile_paths(&root, "osm", 10, 5, y);
            write_atomic(&png, PNG).unwrap();
            write_atomic(&side, b"{}").unwrap();
            let file = fs::OpenOptions::new().write(true).open(&png).unwrap();
            file.set_modified(SystemTime::now() - Duration::from_secs(1_000 * u64::from(y)))
                .unwrap();
        }
        // Tile 2 is the older; reading it makes it the newer.
        touch(&tile_paths(&root, "osm", 10, 5, 2).0);
        prune(&root, 12);
        let left: Vec<_> = tiles_under(&root).iter().map(|t| t.0.clone()).collect();
        assert_eq!(left, [tile_paths(&root, "osm", 10, 5, 2).0]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_service_turned_off_sends_nothing_and_the_error_says_why() {
        // The map_tile path itself, with the switch saying off: no fetch, and the reason code comes back.
        let asked = Cell::new(0);
        let root = temp_dir("off");
        let off = tauri::async_runtime::block_on(tile_for(
            &root,
            None,
            (1, 0, 0),
            0,
            || async { Err(format!("{}maintenance", services::OFF_PREFIX)) },
            |_, _, _| {
                asked.set(asked.get() + 1);
                async { Ok(reply(None)) }
            },
        ));
        assert_eq!(off, Err("service-off:maintenance".to_owned()));
        assert_eq!(asked.get(), 0);
        assert!(tiles_under(&root).is_empty());
    }

    #[test]
    fn the_cache_is_read_before_the_switch_is_asked() {
        let root = temp_dir("switch-last");
        let tile = (16, 20, 30);
        let switched = Cell::new(0);
        let first = tauri::async_runtime::block_on(tile_for(
            &root,
            None,
            tile,
            1_000,
            || async {
                switched.set(switched.get() + 1);
                Ok(OSM.to_owned())
            },
            |address, extra, _| {
                assert_eq!(address, url());
                assert_eq!(extra, None);
                async { Ok(reply(Some("max-age=600"))) }
            },
        ));
        assert_eq!(first.as_deref(), Ok(PNG));
        assert_eq!(switched.get(), 1);
        // Fresh in the cache: the switch is not asked and nothing is fetched, even if it would now say off.
        let second = tauri::async_runtime::block_on(tile_for(
            &root,
            None,
            tile,
            1_100,
            || async {
                switched.set(switched.get() + 1);
                Err(format!("{}maintenance", services::OFF_PREFIX))
            },
            |_, _, _| async { Err("no network".to_owned()) },
        ));
        assert_eq!(second.as_deref(), Ok(PNG));
        assert_eq!(switched.get(), 1);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn an_own_server_skips_the_switch_and_names_its_host_as_the_extra_one() {
        let own = Provider::new("https://tiles.example.org/{z}/{x}/{y}.png", "").expect("provider");
        let root = temp_dir("own-path");
        let got = tauri::async_runtime::block_on(tile_for(
            &root,
            Some(own),
            (3, 1, 2),
            0,
            || async { Err("the switch must not be asked".to_owned()) },
            |address, extra, _| {
                assert_eq!(address.as_str(), "https://tiles.example.org/3/1/2.png");
                assert_eq!(extra.as_deref(), Some("tiles.example.org"));
                async { Ok(reply(None)) }
            },
        ));
        assert_eq!(got.as_deref(), Ok(PNG));
        assert!(root.join("own-tiles.example.org").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn at_most_two_requests_are_out_at_a_time_and_two_do_overlap() {
        let now_out = Arc::new(AtomicUsize::new(0));
        let most = Arc::new(AtomicUsize::new(0));
        let handles: Vec<_> = (0..8u32)
            .map(|y| {
                let (now_out, most) = (now_out.clone(), most.clone());
                let root = temp_dir(&format!("flight{y}"));
                tauri::async_runtime::spawn(async move {
                    let got = tile_with(&root, "osm", (16, 20, y), 0, |_| async move {
                        let out = now_out.fetch_add(1, O::SeqCst) + 1;
                        most.fetch_max(out, O::SeqCst);
                        // Stay out until a second request is out too (bounded), so overlap is proved, not hoped for.
                        for _ in 0..2_000_000 {
                            if now_out.load(O::SeqCst) >= 2 {
                                break;
                            }
                            yield_once().await;
                        }
                        // And a while longer, so a third would have had every chance to join.
                        for _ in 0..200 {
                            yield_once().await;
                        }
                        now_out.fetch_sub(1, O::SeqCst);
                        Ok(reply(None))
                    })
                    .await;
                    let _ = fs::remove_dir_all(&root);
                    got.is_ok()
                })
            })
            .collect();
        for handle in handles {
            assert!(tauri::async_runtime::block_on(handle).expect("task"));
        }
        assert_eq!(most.load(O::SeqCst), MAX_IN_FLIGHT);
    }

    /// Gives the runtime a turn, with no timer needed.
    async fn yield_once() {
        struct Yield(bool);
        impl Future for Yield {
            type Output = ();
            fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
                if self.0 {
                    Poll::Ready(())
                } else {
                    self.0 = true;
                    cx.waker().wake_by_ref();
                    Poll::Pending
                }
            }
        }
        Yield(false).await;
    }

    #[test]
    fn no_store_is_shown_and_not_written() {
        let root = temp_dir("nostore");
        let (got, _) = get(&root, 0, Ok(reply(Some("no-store"))));
        assert_eq!(got.as_deref(), Ok(PNG));
        assert!(tiles_under(&root).is_empty());
        assert!(!root.join("osm").exists());
        // no-cache is written, and renewed at once.
        let (got, _) = get(&root, 0, Ok(reply(Some("no-cache"))));
        assert_eq!(got.as_deref(), Ok(PNG));
        assert_eq!(tiles_under(&root).len(), 1);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_tile_and_its_sidecar_have_their_own_temporary_names_and_leftovers_are_counted_and_pruned()
    {
        let root = temp_dir("leftover");
        let (png, side) = tile_paths(&root, "osm", 10, 5, 1);
        write_atomic(&png, PNG).unwrap();
        write_atomic(&side, b"{}").unwrap();
        // Nothing is left behind by a clean write.
        assert!(scan(&root).1.is_empty());
        let old = png.with_file_name("1.png.tmp");
        let new = side.with_file_name("1.json.tmp");
        assert_ne!(old, new);
        fs::write(&old, vec![0u8; 100]).unwrap();
        fs::write(&new, vec![0u8; 50]).unwrap();
        fs::OpenOptions::new()
            .write(true)
            .open(&old)
            .unwrap()
            .set_modified(SystemTime::now() - Duration::from_secs(3_600))
            .unwrap();
        let before = info_of(&root);
        assert_eq!(before.tiles, 1);
        assert_eq!(before.bytes, PNG.len() as u64 + 2 + 150);
        prune(&root, 1_000_000);
        // The old leftover goes; the recent one may be work in progress.
        assert!(!old.exists());
        assert!(new.exists());
        assert!(png.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_question_names_the_host_in_the_persons_language() {
        let (title, text, ok, cancel) = question("en", "tiles.example.com");
        assert!(text.starts_with("Get map tiles from tiles.example.com?"));
        assert!(!title.is_empty() && !ok.is_empty() && !cancel.is_empty());
        let (_, text, ok, _) = question("es", "tiles.example.com");
        assert!(text.contains("tiles.example.com") && text.starts_with("\u{bf}Obtener"));
        assert_eq!(ok, "Usar este servidor");
        // A language the app doesn't have reads in English.
        assert!(question("fr", "a.example.com")
            .1
            .starts_with("Get map tiles"));
    }

    #[test]
    fn a_tile_servers_address_is_checked() {
        let good = "https://tiles.example.org/{z}/{x}/{y}.png";
        assert_eq!(validate_template(good), Ok("tiles.example.org".to_owned()));
        assert_eq!(
            validate_template("https://Tiles.Example.org/styles/a/{z}/{x}/{y}.png"),
            Ok("tiles.example.org".to_owned())
        );
        // A key in the address would sit in plain text: refused, with its own words.
        for keyed in [
            "https://tiles.example.org/{z}/{x}/{y}.png?key=k1",
            "https://tiles.example.org/{z}/{x}/{y}?",
            "https://tiles.example.org/?z={z}&x={x}&y={y}",
        ] {
            assert_eq!(
                validate_template(keyed),
                Err(QUERY_REFUSED.to_owned()),
                "{keyed}"
            );
        }
        for host in [
            "https://localhost/{z}/{x}/{y}.png",
            "https://tiles.localhost/{z}/{x}/{y}.png",
            "https://tiles.example.localhost./{z}/{x}/{y}.png",
            "https://notlocalhost/{z}/{x}/{y}.png",
            "https://tiles.example.org./{z}/{x}/{y}.png",
            "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            "https://nominatim.openstreetmap.org/{z}/{x}/{y}.png",
            "https://api.met.no/{z}/{x}/{y}.png",
            "https://raw.githubusercontent.com/{z}/{x}/{y}.png",
            "https://tiles/{z}/{x}/{y}.png",
            "https://10.0.0.1/{z}/{x}/{y}.png",
            "https://[::ffff:127.0.0.1]/{z}/{x}/{y}.png",
            "https://[fe80::1]/{z}/{x}/{y}.png",
            "https://2130706433/{z}/{x}/{y}.png",
        ] {
            assert!(validate_template(host).is_err(), "{host}");
        }
        for bad in [
            "http://tiles.example.org/{z}/{x}/{y}.png",
            "tiles.example.org/{z}/{x}/{y}.png",
            "https://tiles.example.org/{z}/{x}.png",
            "https://tiles.example.org/{z}/{z}/{x}/{y}.png",
            "https://tiles.example.org/{z}/{x}/{y}/{y}.png",
            "https://{z}.example.org/{x}/{y}.png",
            "https://tiles.example.org/{s}/{z}/{x}/{y}.png",
            "https://tiles.example.org:8443/{z}/{x}/{y}.png",
            "https://user:pw@tiles.example.org/{z}/{x}/{y}.png",
            "https://127.0.0.1/{z}/{x}/{y}.png",
            "https://[::1]/{z}/{x}/{y}.png",
            "https://localhost/{z}/{x}/{y}.png",
            "https://tiles.example.org/{z}/{x}/{y}.png #x",
            "https://tiles.example.org/{z}/{x}/{y}.png#frag",
            "",
        ] {
            assert!(validate_template(bad).is_err(), "{bad}");
        }
        let long = format!(
            "https://tiles.example.org/{}/{{z}}/{{x}}/{{y}}",
            "a".repeat(400)
        );
        assert!(validate_template(&long).is_err());
    }

    #[test]
    fn an_own_server_is_its_one_host_and_its_tiles_cache_apart() {
        let own = Provider::new(
            "https://tiles.example.org/{z}/{x}/{y}.png",
            "  © Example\u{7} Maps  ",
        )
        .expect("a provider");
        assert_eq!(own.attribution, "© Example Maps");
        let tile = own.url(16, 20, 30).expect("URL");
        assert_eq!(tile.as_str(), "https://tiles.example.org/16/20/30.png");
        // Allowed as the extra host for tiles, and for no other request.
        assert!(net::allowed_with(&tile, Some(&own.host)));
        assert!(!net::allowed(&tile));
        assert_eq!(own.folder(), "own-tiles.example.org");
        assert_ne!(own.folder(), "osm");
    }

    #[test]
    fn the_own_servers_choice_is_kept_and_a_hand_edited_file_is_checked_again() {
        let dir = temp_dir("provider");
        let path = dir.join(PROVIDER_FILE);
        assert_eq!(load_provider(&path), None);
        let own = Provider::new("https://tiles.example.org/{z}/{x}/{y}.png", "© X").unwrap();
        save_provider(&path, Some(&own)).unwrap();
        assert_eq!(load_provider(&path), Some(own));
        // A file edited to something that breaks the rules is no provider: back to OpenStreetMap.
        fs::write(
            &path,
            r#"{"template":"http://evil.example/{z}/{x}/{y}","attribution":"","host":"evil.example"}"#,
        )
        .unwrap();
        assert_eq!(load_provider(&path), None);
        save_provider(&path, None).unwrap();
        save_provider(&path, None).unwrap();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_switchs_registry_lists_the_tiles_service_on_the_tile_host() {
        let server = "https://tile.openstreetmap.org";
        assert!(net::allowed(&osm_url(server, 0, 0, 0).expect("URL")));
        // Whatever the switch moves it to is still checked against the list when the request goes.
        let moved = osm_url("https://elsewhere.example", 0, 0, 0).expect("URL");
        assert!(!net::allowed(&moved));
    }
}
