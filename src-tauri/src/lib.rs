use std::{
    path::Path,
    thread,
    time::{Duration, Instant},
};

use launch_check::{LaunchCheck, Reporter};
use tauri::{webview::PageLoadEvent, Manager};

mod app_data;
mod backup;
#[cfg(test)]
mod command_tests;
mod exif;
mod export;
mod fonts;
mod geocode;
mod heic;
mod hospital;
mod launch_check;
mod licences;
mod lock;
mod net;
mod open;
mod opened;
mod originals;
mod os;
mod picture_door;
mod pictures;
mod playback;
mod region;
mod sbd;
mod services;
mod synced;
mod tiles;
mod timezone;
mod video;
mod weather;
mod worker_csp;

/// The commands the page may call, the plugins they use and the state they share. run() builds the app on it, and the
/// command tests (command_tests.rs) build Tauri's mock runtime on it, so a command missing here is missing from both.
pub(crate) fn with_commands<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        .plugin(tauri_plugin_dialog::init())
        // Used only from src/open.rs: the page is given none of its permissions (capabilities/default.json), and its
        // script that sends link clicks to it is left out, since those calls could only be refused.
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .manage(sbd::OpenFiles::default())
        .manage(opened::OpenedFiles::default())
        .manage(pictures::Offered::default())
        .manage(export::Chosen::default())
        .invoke_handler(tauri::generate_handler![
            sbd::sbd_create,
            sbd::sbd_open,
            sbd::sbd_close,
            sbd::sbd_copy,
            sbd::sbd_save_copy,
            sbd::sbd_keep_copy,
            sbd::sbd_drop_copy,
            sbd::sbd_lock_holder,
            sbd::sbd_lock_refresh,
            sbd::sbd_place_backups,
            sbd::sbd_backups_folder,
            sbd::sbd_show_backups,
            sbd::sbd_tx,
            sbd::sbd_tx_raw,
            sbd::sbd_import_tx_raw,
            sbd::sbd_read_blob,
            sbd::sbd_query,
            sbd::sbd_backup,
            sbd::sbd_compact,
            sbd::sbd_backups,
            sbd::sbd_delete_backup,
            app_data::app_data_read,
            app_data::app_data_write,
            opened::opened_files_take,
            synced::sync_service,
            synced::projects_folder_for_new,
            pictures::pictures_choose,
            pictures::pictures_read,
            originals::picture_original,
            video::video_probe,
            video::video_still,
            video::video_status,
            video::video_choose,
            video::known_videos_count,
            video::known_videos_forget,
            playback::playback_make,
            playback::playback_find,
            playback::playback_cancel,
            playback::playback_info,
            playback::playback_clear,
            playback::playback_set_cap,
            playback::playback_set_floor,
            playback::playback_move,
            playback::playback_move_back,
            licences::licence_text,
            pictures::script_choose,
            pictures::lut_choose,
            pictures::project_json_choose,
            pictures::pdf_choose,
            video::clip_save,
            video::clip_cancel,
            export::export_choose_file,
            export::export_choose_folder,
            export::export_write,
            geocode::address_search,
            hospital::nearest_hospitals,
            weather::weather_forecast,
            services::services_status,
            open::open_link,
            open::open_pdf,
            open::original_shown,
            open::reveal_original,
            region::region_week,
            fonts::fonts_list,
            fonts::font_bytes,
            timezone::time_zone_at,
            exif::photo_exif,
            heic::heic_picture,
            tiles::map_tile,
            tiles::map_tiles_info,
            tiles::map_tiles_clear,
            tiles::map_tile_provider,
            tiles::map_tile_provider_set,
            launch_check::launch_check_step,
        ])
}

/// The state made from this computer's folders as the app starts (setup in run(), and the command tests).
pub(crate) fn manage_at_start<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    // This computer's id and name, for the lock files next to open projects (lock.rs).
    let data_dir = app.path().app_data_dir().unwrap_or_default();
    app.manage(lock::Machine::load(&data_dir));
    // Videos the person has handed over, so a reopened project reads its footage (video.rs).
    app.manage(video::KnownVideos::load(&data_dir));
    // Playback copies (playback.rs): in the app's cache folder unless the person moved them.
    let cache_dir = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| data_dir.join("cache"));
    app.manage(playback::PlaybackCache::load(&data_dir, &cache_dir));
}

/// The main window, from its entry in tauri.conf.json (every setting as written there: hidden at start, its size and
/// background), plus the worker policy on the app's scripts (worker_csp.rs). The config marks it `"create": false`
/// because Tauri builds a config window with no way to add `on_web_resource_request`, so setup builds it here.
pub(crate) fn main_window<R: tauri::Runtime, M: Manager<R>>(
    manager: &M,
) -> tauri::Result<tauri::WebviewWindowBuilder<'_, R, M>> {
    let config = manager
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .cloned()
        .ok_or_else(|| tauri::Error::WindowNotFound)?;
    Ok(
        tauri::WebviewWindowBuilder::from_config(manager, &config)?.on_web_resource_request(
            |request, response| worker_csp::add_worker_policy(&request, response),
        ),
    )
}

/// The app's context (tauri.conf.json, capabilities, icons, assets), for run() and the command tests alike. The macro
/// is expanded here and nowhere else: on a Mac each expansion embeds the Info.plist under one fixed symbol
/// (`_EMBED_INFO_PLIST`), so a second one in the crate fails to compile the tests there (6.16's checkpoint).
pub(crate) fn app_context<R: tauri::Runtime>() -> tauri::Context<R> {
    tauri::generate_context!()
}

// Windows (MSVC): the lib's test program links Tauri's window and dialog code, which imports `TaskDialogIndirect`
// from Common Controls 6. The app's exe asks for version 6 in the manifest tauri-build compiles into its resources
// (`resource.lib`, linked into bins only); a test program has no manifest, so Windows loads version 5, which lacks
// that entry point, and the program can't start (STATUS_ENTRYPOINT_NOT_FOUND). Cargo has no link argument that
// reaches a lib's unit tests without the bin, so the test program links the same resources here, under cfg(test),
// which the app's build never sees; build.rs adds their folder to the search path.
#[cfg(all(test, windows, target_env = "msvc"))]
#[link(name = "resource", kind = "static")]
extern "C" {}

/// The 3-second safety net: macOS reports no event for a page that fails to load (for example `cargo run` with the
/// dev server stopped), so a window still hidden after a few seconds is shown anyway.
fn show_if_still_hidden(window: tauri::WebviewWindow) {
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(3));
        if !window.is_visible().unwrap_or(false) {
            let _ = window.show();
        }
    });
}

/// Setup in the launch check: the main window exactly as always, plus the script that watches for policy violations
/// from the document's first moment, and nothing else (no state from this computer's folders, no clean-up, no files
/// from outside). Step 1, `window`; a failure ends the process with its code rather than the setup's panic.
fn launch_check_setup(app: &tauri::App) {
    let check = app.state::<LaunchCheck<tauri::Wry>>();
    let made = main_window(app.handle()).and_then(|builder| {
        builder
            .initialization_script(launch_check::WATCH_SCRIPT)
            .build()
    });
    let reported = match made {
        Ok(window) => {
            show_if_still_hidden(window);
            check.report(app.handle(), Reporter::Rust, "window", true, "")
        }
        Err(error) => check.report(
            app.handle(),
            Reporter::Rust,
            "window",
            false,
            &error.to_string(),
        ),
    };
    if let Err(error) = reported {
        eprintln!("launch check: {error}");
    }
}

/// Step 2, `loaded`: the main window's page finished loading, the app's own show() worked and the window is visible.
/// `shown_before`: it was visible already, the 3-second net having got there first; still ok, and the line says so.
fn launch_check_loaded(webview: &tauri::Webview, shown: tauri::Result<()>, shown_before: bool) {
    let Some(check) = webview.try_state::<LaunchCheck<tauri::Wry>>() else {
        return;
    };
    let visible = webview.window().is_visible().unwrap_or(false);
    let (ok, detail) = match shown {
        Err(error) => (false, format!("show() failed: {error}")),
        Ok(()) if !visible => (
            false,
            "show() worked but the window is not visible".to_owned(),
        ),
        Ok(()) => (true, String::new()),
    };
    let note = shown_before.then_some(launch_check::SHOWN_BY_NET);
    if let Err(error) = check.report_noted(
        webview.app_handle(),
        Reporter::Rust,
        "loaded",
        ok,
        &detail,
        note,
    ) {
        eprintln!("launch check: {error}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let started = Instant::now();
    // The launch check (launch_check.rs, 6.27l): read once, here, from the environment and nothing else.
    let launch = launch_check::read_switch();
    let builder = tauri::Builder::default();
    let builder = if launch {
        let check = LaunchCheck::<tauri::Wry>::new(
            Box::new(launch_check::say_on_stdout),
            Box::new(launch_check::finish_in_app),
        );
        check.arm_time_limit(started + launch_check::TIME_LIMIT);
        builder.manage(check)
    } else {
        builder
    };
    // Registered first, as the plugin asks, so a second launch exits before it sets anything else up. Not in the
    // launch check: a second launch would hand over to a running copy and exit with 0, which would read as a pass.
    #[cfg(desktop)]
    let builder = if launch {
        builder
    } else {
        builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            opened::queue(
                app,
                opened::sbd_paths(args.into_iter().skip(1), Path::new(&cwd)),
            );
        }))
    };
    with_commands(builder)
        // The Player reads playback copies, and nothing else, through a scheme of its own, a slice at a time
        // (playback.rs, 2.4); each answer is read on a thread of its own, so a slow drive never holds the window up.
        .register_asynchronous_uri_scheme_protocol(
            playback::COPY_SCHEME,
            |ctx, request, responder| {
                let app = ctx.app_handle().clone();
                let path = request.uri().path().to_owned();
                let range = request
                    .headers()
                    .get("range")
                    .and_then(|value| value.to_str().ok())
                    .map(str::to_owned);
                thread::spawn(move || {
                    let answer = playback::serve_copy(
                        &app.state::<playback::PlaybackCache>(),
                        &path,
                        range.as_deref(),
                    );
                    let mut response = tauri::http::Response::builder().status(answer.status);
                    for (name, value) in answer.headers {
                        response = response.header(name, value);
                    }
                    let response = response.body(answer.body).unwrap_or_else(|_| {
                        tauri::http::Response::builder()
                            .status(500)
                            .body(Vec::new())
                            .unwrap_or_default()
                    });
                    responder.respond(response);
                });
            },
        )
        // Files dragged over the window, and dropped as pictures the page may read (pictures.rs).
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(drag) = event {
                pictures::dragged(window, drag);
            }
        })
        // The main window, and the safety net that shows it should no load event come (show_if_still_hidden).
        .setup(move |app| {
            if launch {
                launch_check_setup(app);
                return Ok(());
            }
            // The main window, built here rather than from the config (main_window, above), and first, as Tauri built
            // a config window before setup: everything below that looks up "main" (opened::queue brings it to the
            // front on a double-click launch) finds it. The drag-drop event and the show on load below reach it as
            // they reach every window.
            let window = main_window(app.handle())?.build()?;
            show_if_still_hidden(window);
            manage_at_start(app.handle());
            // Copies cut off by a crash or a quit, on a thread of its own: a drive slow to wake (or a share that
            // doesn't answer) never holds up the window, and it waits its turn behind a copy started meanwhile.
            let handle = app.handle().clone();
            thread::spawn(move || handle.state::<playback::PlaybackCache>().clean_up());
            // PDF copies opened more than a day ago (open.rs), on a thread of its own too.
            let handle = app.handle().clone();
            thread::spawn(move || open::tidy_at_start(&handle));
            // A double-click on Windows launches the app with the file as an argument.
            let cwd = std::env::current_dir().unwrap_or_default();
            opened::queue(
                app.handle(),
                opened::sbd_paths(std::env::args().skip(1), &cwd),
            );
            Ok(())
        })
        // The window starts hidden (tauri.conf.json) and appears once the page has loaded, after theme-boot.js has
        // set the theme. Shown any earlier, a Mac in dark mode flashes the paper window background at launch.
        .on_page_load(move |webview, payload| {
            if payload.event() == PageLoadEvent::Finished {
                // In the launch check only: whether the 3-second net showed the window before this did.
                let checked = launch && webview.label() == "main";
                let shown_before = checked && webview.window().is_visible().unwrap_or(false);
                let shown = webview.window().show();
                if let Err(error) = &shown {
                    eprintln!("could not show the main window: {error}");
                }
                if checked {
                    launch_check_loaded(webview, shown, shown_before);
                }
            }
        })
        .build(app_context())
        .expect("error while building Storiiboard")
        .run(move |app, event| {
            if launch {
                // A quit nobody asked the check for (its window closed) would end the app with 0.
                if let tauri::RunEvent::ExitRequested { .. } = event {
                    if let Some(check) = app.try_state::<LaunchCheck<tauri::Wry>>() {
                        if !check.decided() {
                            check.say(launch_check::QUIT_EARLY_LINE);
                            launch_check::end_process(launch_check::EXIT_QUIT_EARLY);
                        }
                    }
                }
                // Nothing else: the clean-ups on Exit read state the mode never made (app.state panics on it), and on
                // a Mac a file opened from outside is not the check's.
                return;
            }
            if let tauri::RunEvent::Exit = event {
                app.state::<sbd::OpenFiles>().close_all();
                // A playback copy being made stops with the app, rather than going on alone (playback.rs).
                app.state::<playback::PlaybackCache>().cancel_all();
                // And a clip being saved (video.rs): its ffmpeg ends, and its unfinished file goes, before the app does.
                video::stop_clip_for_exit();
            }
            // On a Mac a double-click arrives as an Apple Event, whether or not the app was running.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .filter_map(|path| path.to_str().map(str::to_owned))
                    .collect();
                let cwd = std::env::current_dir().unwrap_or_default();
                opened::queue(app, opened::sbd_paths(paths, &cwd));
            }
        });
}
