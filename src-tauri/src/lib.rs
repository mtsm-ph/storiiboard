use std::{path::Path, thread, time::Duration};

use tauri::{webview::PageLoadEvent, Manager};

mod app_data;
mod backup;
#[cfg(test)]
mod command_tests;
mod exif;
mod export;
mod fonts;
mod geocode;
mod hospital;
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
            tiles::map_tile,
            tiles::map_tiles_info,
            tiles::map_tiles_clear,
            tiles::map_tile_provider,
            tiles::map_tile_provider_set,
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Registered first, as the plugin asks, so a second launch exits before it sets anything else up.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        opened::queue(
            app,
            opened::sbd_paths(args.into_iter().skip(1), Path::new(&cwd)),
        );
    }));
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
        // Safety net: macOS reports no event for a page that fails to load (for example `cargo run` with the dev
        // server stopped), so a window still hidden after a few seconds is shown anyway.
        .setup(|app| {
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
            if let Some(window) = app.get_webview_window("main") {
                thread::spawn(move || {
                    thread::sleep(Duration::from_secs(3));
                    if !window.is_visible().unwrap_or(false) {
                        let _ = window.show();
                    }
                });
            }
            Ok(())
        })
        // The window starts hidden (tauri.conf.json) and appears once the page has loaded, after theme-boot.js has
        // set the theme. Shown any earlier, a Mac in dark mode flashes the paper window background at launch.
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Finished {
                if let Err(error) = webview.window().show() {
                    eprintln!("could not show the main window: {error}");
                }
            }
        })
        .build(app_context())
        .expect("error while building Storiiboard")
        .run(|app, event| {
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
