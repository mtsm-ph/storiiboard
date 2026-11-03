use std::{path::Path, thread, time::Duration};

use tauri::{webview::PageLoadEvent, Manager};

mod app_data;
mod opened;
mod sbd;

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
    builder
        .plugin(tauri_plugin_dialog::init())
        .manage(sbd::OpenFiles::default())
        .manage(opened::OpenedFiles::default())
        .invoke_handler(tauri::generate_handler![
            sbd::sbd_create,
            sbd::sbd_open,
            sbd::sbd_close,
            sbd::sbd_tx,
            sbd::sbd_query,
            sbd::sbd_backup,
            sbd::sbd_backups,
            sbd::sbd_delete_backup,
            app_data::app_data_read,
            app_data::app_data_write,
            opened::opened_files_take,
        ])
        // Safety net: macOS reports no event for a page that fails to load (for example `cargo run` with the dev
        // server stopped), so a window still hidden after a few seconds is shown anyway.
        .setup(|app| {
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
        .build(tauri::generate_context!())
        .expect("error while building Storiiboard")
        .run(|_app, _event| {
            // On a Mac a double-click arrives as an Apple Event, whether or not the app was running.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .filter_map(|path| path.to_str().map(str::to_owned))
                    .collect();
                let cwd = std::env::current_dir().unwrap_or_default();
                opened::queue(_app, opened::sbd_paths(paths, &cwd));
            }
        });
}
