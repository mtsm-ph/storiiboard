# Test data

Files the Rust tests read, small and checked in. Everything else the tests need they make with the ffmpeg sidecar.

- `av1-1-b8-01-size-226x226.ivf` (1,079 bytes, SHA-256
  `b5d9a30f24e33f8fa6a655961645650542dc2545fb7d557e2d55a043dac69f50`): an AV1 conformance vector from the Alliance for
  Open Media's libaom test data, `https://storage.googleapis.com/aom-test-data/av1-1-b8-01-size-226x226.ivf`, under the
  BSD 2-Clause licence (with AOMedia's patent licence), as libaom is. Two 226×226 frames at 30 fps. Its published
  `.md5` file lists each decoded frame's MD5 (`68fd0575b5211242727c2bc77c27453d`, `448d6b4cb8379eaee950670af0f5ab41`);
  `src/video.rs` checks dav1d's decode against them (D1).
