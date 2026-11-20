# Test data

Files the Rust tests read, small and checked in. Everything else the tests need they make with the ffmpeg sidecar.

- `av1-1-b8-01-size-226x226.ivf` (1,079 bytes, SHA-256
  `b5d9a30f24e33f8fa6a655961645650542dc2545fb7d557e2d55a043dac69f50`): an AV1 conformance vector from the Alliance for
  Open Media's libaom test data, `https://storage.googleapis.com/aom-test-data/av1-1-b8-01-size-226x226.ivf`, under the
  BSD 2-Clause licence (with AOMedia's patent licence), as libaom is. Two 226×226 frames at 30 fps. Its published
  `.md5` file lists each decoded frame's MD5 (`68fd0575b5211242727c2bc77c27453d`, `448d6b4cb8379eaee950670af0f5ab41`);
  `src/video.rs` checks dav1d's decode against them (D1). Its licence, with the copyright notice and conditions it
  asks to keep with it, is `av1-1-b8-01-size-226x226.LICENSE.txt`.
- `pictures/webkit-encoded-1.jpg` and `pictures/webkit-encoded-2.jpg` (640×345 and 640×346): generated gradients, no
  person and no text, encoded as baseline JPEGs, carrying byte for byte and in the same place the segments WebKit wrote
  into the JPEGs a Mac stored in checkpoint nov17-627: its JFIF, an Exif block with the picture's size, an empty
  Photoshop/IPTC record and the Display P3 colour profile. The door (`src/picture_door.rs`, `src/sbd.rs`) refuses them;
  the page's clean (src/core/media/cleanPicture.test.ts) reads the same files.
- `pictures/webkit-encoded-1.clean.jpg` and `pictures/webkit-encoded-2.clean.jpg`: each of the two as the page's clean
  (src/core/media/cleanPicture.ts) leaves it, only the picture's own data and its colour profile; the door lets them
  through, and a Vitest checks the clean still makes exactly these bytes.
- `heic/`: our own drawing as a HEIC made by a Mac's `sips`, its source PNG, where to measure it, and the PNG
  `heic_picture` makes from it (`src/heic.rs`, 6.27n); its own README says what each is and its hash.
