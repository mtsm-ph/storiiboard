fn main() {
    // The target triple, for finding the ffmpeg and ffprobe sidecars by their built names (src/video.rs).
    println!(
        "cargo:rustc-env=SBD_TARGET_TRIPLE={}",
        std::env::var("TARGET").expect("cargo sets TARGET for build scripts")
    );
    tauri_build::build()
}
