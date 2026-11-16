fn main() {
    // The target triple, for finding the ffmpeg and ffprobe sidecars by their built names (src/video.rs).
    println!(
        "cargo:rustc-env=SBD_TARGET_TRIPLE={}",
        std::env::var("TARGET").expect("cargo sets TARGET for build scripts")
    );
    // Windows (MSVC): tauri-build compiles the app's resources, its Common Controls 6 manifest included, into
    // `resource.lib` here and links it into bins only. The lib's test program links the same file by name, under
    // cfg(test) (lib.rs), so it starts; a search path alone changes nothing in the app's exe, which names no library
    // in this folder.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        println!(
            "cargo:rustc-link-search=native={}",
            std::env::var("OUT_DIR").expect("cargo sets OUT_DIR for build scripts")
        );
    }
    tauri_build::build()
}
