//! What a stored picture may carry (6.27b, Kevin Nov 18): only what a reader needs to show it, plus its colour profile.
//! The page cleans every picture it encodes (src/core/media/cleanPicture.ts); this is the door's own check, written
//! apart from the page's clean with the same keep-list (docs/SBD_FORMAT.md, "What a stored picture carries"), so a
//! picture that would carry anything else (an Exif block, XMP, IPTC, a comment, a text chunk, whatever a later webview
//! adds) is refused before it reaches the file (sbd.rs, `refuse_unclean_pictures`).
//!
//! Kept, JPEG: SOI; APP0 JFIF without a thumbnail (segment length 16), once; APP2 ICC_PROFILE; APP14 Adobe at its fixed
//! size (segment length 14), once; DQT, DHT, DRI, every SOFn, each SOS and its entropy-coded
//! data (restart markers inside it); EOI, and nothing after it. Kept, PNG: IHDR, PLTE, tRNS, IDAT, IEND (last, nothing
//! after it), and the colour chunks iCCP, sRGB, cICP, gAMA, cHRM. Anything else, fill bytes between JPEG segments
//! included (the page's clean drops them), and blocks that can't be read through to EOI or IEND, is refused. The door
//! asks only what the bytes carry, not whether they make a whole picture (a frame and a scan, IHDR first, an IDAT):
//! that is the page's clean's own refusal. The check reads only within the bytes, and every step moves forward.

const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

/// The PNG chunks a stored picture keeps.
const PNG_KEPT: [&[u8; 4]; 10] = [
    b"IHDR", b"PLTE", b"tRNS", b"IDAT", b"IEND", b"iCCP", b"sRGB", b"cICP", b"gAMA", b"cHRM",
];

/// The most a colour profile may hold as stored (Kevin, Nov 18, night 2), the one kept block the page doesn't write
/// itself: 64 KiB, a JPEG's ICC_PROFILE chunks' data together (after each chunk's 14-byte header), a PNG's iCCP chunk
/// data as it sits in the file. Nothing is inflated, here or on the page; cleanPicture.ts has the same number.
const MAX_PROFILE_BYTES: usize = 64 * 1024;
/// An APP2 ICC_PROFILE chunk's own header: `ICC_PROFILE\0`, its number and the count.
const ICC_HEADER: usize = 14;

/// A JPEG by its first bytes: SOI, then a marker.
fn is_jpeg(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0xff, 0xd8, 0xff])
}

/// A PNG by its whole signature.
fn is_png(bytes: &[u8]) -> bool {
    bytes.starts_with(&PNG_SIGNATURE)
}

/// Whether bytes are refused as a stored picture: a JPEG or PNG by its first bytes that carries anything outside the
/// keep-list, or that can't be read through. Anything else (a PDF) isn't a picture, and isn't this check's.
pub fn refuses(bytes: &[u8]) -> bool {
    if is_jpeg(bytes) {
        !jpeg_is_clean(bytes)
    } else if is_png(bytes) {
        !png_is_clean(bytes)
    } else {
        false
    }
}

/// A start-of-frame marker: C0 to CF but DHT (C4), JPG (C8) and DAC (CC).
fn is_sof(marker: u8) -> bool {
    (0xc0..=0xcf).contains(&marker) && marker != 0xc4 && marker != 0xc8 && marker != 0xcc
}

/// An APP0 JFIF segment's length with no thumbnail (Kevin, Nov 19): the length field, `JFIF\0`, the version, the
/// units, the two densities and a 0 × 0 thumbnail. A longer one carries a thumbnail, a picture of its own.
const JFIF_LENGTH: usize = 16;
/// An APP14 Adobe segment's one length: the length field, `Adobe`, the version, two flag words and the transform.
const ADOBE_LENGTH: usize = 14;

fn jpeg_is_clean(bytes: &[u8]) -> bool {
    let mut at = 2;
    let mut profile = 0;
    // JFIF and Adobe are kept once each: a second one is refused.
    let (mut jfif, mut adobe) = (false, false);
    loop {
        if bytes.get(at) != Some(&0xff) {
            return false;
        }
        let Some(&marker) = bytes.get(at + 1) else {
            return false;
        };
        match marker {
            0xd9 => return at + 2 == bytes.len(),
            // Fill (FF FF), a second SOI, a restart outside a scan, TEM, or a stuffed zero: none belongs here.
            0xff | 0x00 | 0x01 | 0xd0..=0xd8 => return false,
            _ => {}
        }
        let Some(length) = bytes
            .get(at + 2..at + 4)
            .map(|b| usize::from(u16::from_be_bytes([b[0], b[1]])))
        else {
            return false;
        };
        if length < 2 {
            return false;
        }
        let end = at + 2 + length;
        let Some(body) = bytes.get(at + 4..end) else {
            return false;
        };
        let kept = match marker {
            0xda | 0xdb | 0xc4 | 0xdd => true,
            0xe0 => {
                !std::mem::replace(&mut jfif, true)
                    && length == JFIF_LENGTH
                    && body.starts_with(b"JFIF\0")
            }
            0xe2 => body.starts_with(b"ICC_PROFILE\0"),
            0xee => {
                !std::mem::replace(&mut adobe, true)
                    && length == ADOBE_LENGTH
                    && body.starts_with(b"Adobe")
            }
            marker => is_sof(marker),
        };
        if !kept {
            return false;
        }
        if marker == 0xe2 {
            profile += body.len().saturating_sub(ICC_HEADER);
            if profile > MAX_PROFILE_BYTES {
                return false;
            }
        }
        at = end;
        if marker == 0xda {
            // The entropy-coded data, to the next marker that isn't a stuffed byte (FF 00) or a restart (FF D0 to D7).
            loop {
                match (bytes.get(at), bytes.get(at + 1)) {
                    (Some(0xff), Some(&next)) if next == 0x00 || (0xd0..=0xd7).contains(&next) => {
                        at += 2;
                    }
                    (Some(0xff), Some(_)) => break,
                    (Some(_), Some(_)) => at += 1,
                    _ => return false,
                }
            }
        }
    }
}

/// Whether an iCCP chunk's data is one: the profile's name (1 to 79 bytes), its NUL and the compression method (0).
fn iccp_is_one(data: &[u8]) -> bool {
    let Some(nul) = data.iter().take(80).position(|&b| b == 0) else {
        return false;
    };
    nul >= 1 && data.get(nul + 1) == Some(&0)
}

fn png_is_clean(bytes: &[u8]) -> bool {
    let mut at = PNG_SIGNATURE.len();
    let mut profile = 0;
    loop {
        let Some(head) = bytes.get(at..at + 8) else {
            return false;
        };
        let length = u32::from_be_bytes([head[0], head[1], head[2], head[3]]);
        if length > 0x7fff_ffff {
            return false;
        }
        let kind = &head[4..8];
        if !kind.iter().all(u8::is_ascii_alphabetic) {
            return false;
        }
        let end = at + 12 + length as usize;
        if end > bytes.len() {
            return false;
        }
        if !PNG_KEPT.iter().any(|kept| kept.as_slice() == kind) {
            return false;
        }
        if kind == b"iCCP" {
            // Bounded by its data as it sits in the file (Kevin, Nov 18, night 2); never inflated.
            if !iccp_is_one(&bytes[at + 8..end - 4]) {
                return false;
            }
            profile += length as usize;
            if profile > MAX_PROFILE_BYTES {
                return false;
            }
        }
        at = end;
        if kind == b"IEND" {
            return at == bytes.len();
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::path::PathBuf;

    /// The fixtures the page's clean reads too (src/core/media/cleanPicture.test.ts): two generated gradients (640×345
    /// and 640×346, no person, no text) carrying, byte for byte and in the same place, the blocks WebKit wrote into the
    /// JPEGs a Mac stored in checkpoint nov17-627 (its JFIF, an Exif block, a Photoshop/IPTC block, the P3 profile),
    /// and each as the page's clean leaves it.
    pub(crate) fn fixture(name: &str) -> Vec<u8> {
        let path: PathBuf = [env!("CARGO_MANIFEST_DIR"), "testdata", "pictures", name]
            .iter()
            .collect();
        std::fs::read(path).expect("the fixture is checked in")
    }

    pub(crate) const RAW: [&str; 2] = ["webkit-encoded-1.jpg", "webkit-encoded-2.jpg"];
    pub(crate) const CLEAN: [&str; 2] =
        ["webkit-encoded-1.clean.jpg", "webkit-encoded-2.clean.jpg"];

    fn segment(marker: u8, body: &[u8]) -> Vec<u8> {
        let mut out = vec![0xff, marker];
        out.extend_from_slice(&u16::try_from(body.len() + 2).unwrap().to_be_bytes());
        out.extend_from_slice(body);
        out
    }

    /// A small JPEG's shape: what a reader needs, with `extra` segments after the JFIF one.
    fn jpeg(extra: &[Vec<u8>]) -> Vec<u8> {
        let mut out = vec![0xff, 0xd8];
        out.extend(segment(0xe0, b"JFIF\0\x01\x01\0\0\x01\0\x01\0\0"));
        for part in extra {
            out.extend_from_slice(part);
        }
        out.extend(segment(0xe2, b"ICC_PROFILE\0\x01\x01profile"));
        out.extend(segment(0xdb, &[0; 65]));
        out.extend(segment(0xc0, &[8, 0, 1, 0, 1, 1, 1, 0x11, 0]));
        out.extend(segment(0xc4, &[0; 17]));
        out.extend(segment(0xdd, &[0, 4]));
        out.extend(segment(0xda, &[1, 1, 0, 0, 0x3f, 0]));
        // Entropy-coded data with a stuffed FF and a restart marker inside it.
        out.extend_from_slice(&[0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]);
        out.extend_from_slice(&[0xff, 0xd9]);
        out
    }

    fn chunk(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut out = u32::try_from(body.len()).unwrap().to_be_bytes().to_vec();
        out.extend_from_slice(kind);
        out.extend_from_slice(body);
        // The CRC isn't checked here: four bytes of its place.
        out.extend_from_slice(&[0, 0, 0, 0]);
        out
    }

    fn png(extra: &[Vec<u8>]) -> Vec<u8> {
        let mut out = PNG_SIGNATURE.to_vec();
        out.extend(chunk(b"IHDR", &[0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]));
        for part in extra {
            out.extend_from_slice(part);
        }
        out.extend(chunk(b"IDAT", &[0x78, 0x9c, 0x63, 0, 0, 0, 0, 1]));
        out.extend(chunk(b"IEND", &[]));
        out
    }

    #[test]
    fn refuses_each_webkit_jpeg_as_it_was_stored_and_lets_its_clean_copy_through() {
        for (raw, clean) in RAW.iter().zip(CLEAN) {
            assert!(
                refuses(&fixture(raw)),
                "{raw} carries an Exif and a Photoshop block"
            );
            assert!(
                !refuses(&fixture(clean)),
                "{clean} carries only the picture and its profile"
            );
        }
    }

    #[test]
    fn lets_through_only_the_kept_jpeg_blocks() {
        assert!(!refuses(&jpeg(&[])));
        assert!(!refuses(&jpeg(&[segment(
            0xee,
            b"Adobe\0\x64\0\0\0\0\x01"
        )])));
        for extra in [
            segment(0xe1, b"Exif\0\0MM\0*"),
            segment(0xe1, b"http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>"),
            segment(0xed, b"Photoshop 3.0\0"),
            segment(0xfe, b"a comment"),
            segment(0xe9, b"anything"),
            // An APP0 that isn't JFIF (a JFXX thumbnail) and an APP2 that isn't a profile (MPF).
            segment(0xe0, b"JFXX\0\x10"),
            segment(0xe2, b"MPF\0"),
        ] {
            assert!(refuses(&jpeg(&[extra])));
        }
        // Anything after EOI, fill bytes between segments: refused.
        let mut after = jpeg(&[]);
        after.extend_from_slice(b"more");
        assert!(refuses(&after));
        let mut filled = jpeg(&[]);
        filled.splice(2..2, [0xff]);
        assert!(refuses(&filled));
        // The door asks what the bytes carry, not whether they make a whole picture: SOI and EOI alone, or tables with
        // no scan, carry nothing else (the page's clean refuses them for itself).
        assert!(!refuses(&[0xff, 0xd8, 0xff, 0xd9]));
        let no_scan = [vec![0xff, 0xd8], segment(0xdb, &[0; 65]), vec![0xff, 0xd9]].concat();
        assert!(!refuses(&no_scan));
        let exif_no_scan = [
            vec![0xff, 0xd8],
            segment(0xe1, b"Exif\0\0"),
            vec![0xff, 0xd9],
        ]
        .concat();
        assert!(refuses(&exif_no_scan));
    }

    /// Kevin, Nov 19: JFIF only without a thumbnail (segment length 16), Adobe only at its fixed size (14), once each.
    /// The same cases as the page's clean test (cleanPicture.test.ts, "keeps JFIF only without a thumbnail…").
    #[test]
    fn keeps_jfif_and_adobe_only_at_their_fixed_sizes_once_each() {
        let adobe = segment(0xee, b"Adobe\0\x64\0\0\0\0\x01");
        assert_eq!(adobe[2..4], [0, 14]);
        assert_eq!(jpeg(&[])[4..6], [0, 16]);
        assert!(!refuses(&jpeg(std::slice::from_ref(&adobe))));
        // A JFIF with a 1 × 1 thumbnail in place of the plain one: refused; with no JFIF at all, let through.
        let plain = jpeg(&[]);
        let thumbnail = segment(0xe0, b"JFIF\0\x01\x01\0\0\x01\0\x01\x01\x01\x09\x09\x09");
        let with_thumbnail = [vec![0xff, 0xd8], thumbnail, plain[20..].to_vec()].concat();
        assert!(refuses(&with_thumbnail));
        assert!(!refuses(&[vec![0xff, 0xd8], plain[20..].to_vec()].concat()));
        let second_jfif = segment(0xe0, b"JFIF\0\x01\x01\0\0\x01\0\x01\0\0");
        let long_adobe = segment(0xee, b"Adobe\0\x64\0\0\0\0\x01\x07");
        let short_adobe = segment(0xee, b"Adobe\0\x64\0\0\0\0");
        for extra in [
            vec![second_jfif],
            vec![adobe.clone(), adobe.clone()],
            vec![long_adobe.clone()],
            vec![short_adobe],
            vec![long_adobe, adobe],
        ] {
            assert!(refuses(&jpeg(&extra)));
        }
    }

    #[test]
    fn lets_through_only_the_kept_png_chunks() {
        assert!(!refuses(&png(&[])));
        assert!(!refuses(&png(&[
            chunk(b"iCCP", b"P3\0\0x"),
            chunk(b"gAMA", &[0, 0, 0xb1, 0x8f])
        ])));
        assert!(!refuses(&png(&[
            chunk(b"sRGB", &[0]),
            chunk(b"cHRM", &[0; 32]),
            chunk(b"cICP", &[1, 13, 0, 1])
        ])));
        for extra in [
            chunk(b"tEXt", b"Comment\0hi"),
            chunk(b"eXIf", b"MM\0*"),
            chunk(b"iTXt", b"XML:com.adobe.xmp\0\0\0\0\0x"),
            chunk(b"tIME", &[7, 234, 11, 18, 12, 0, 0]),
            chunk(b"pHYs", &[0; 9]),
            chunk(b"zzZz", b"unknown"),
        ] {
            assert!(refuses(&png(&[extra])));
        }
        let mut after = png(&[]);
        after.extend_from_slice(b"more");
        assert!(refuses(&after));
    }

    /// ICC_PROFILE chunks with `payload` bytes of profile in all (after each chunk's 14-byte header), as big as a
    /// segment holds.
    fn profile_chunks(payload: usize) -> Vec<Vec<u8>> {
        let mut left = payload;
        let mut chunks = Vec::new();
        while left > 0 {
            let n = left.min(65533 - ICC_HEADER);
            let mut body = b"ICC_PROFILE\0\x01\x01".to_vec();
            body.resize(ICC_HEADER + n, 7);
            chunks.push(segment(0xe2, &body));
            left -= n;
        }
        chunks
    }

    #[test]
    fn bounds_the_colour_profile_at_64_kib_as_stored() {
        assert_eq!(MAX_PROFILE_BYTES, 65_536);
        // jpeg() carries a 7-byte profile of its own: 64 KiB in all, over two ICC_PROFILE chunks, goes in; a byte more
        // is refused.
        assert_eq!(profile_chunks(MAX_PROFILE_BYTES - 7).len(), 2);
        assert!(!refuses(&jpeg(&profile_chunks(MAX_PROFILE_BYTES - 7))));
        assert!(refuses(&jpeg(&profile_chunks(MAX_PROFILE_BYTES - 6))));
        // A PNG's iCCP by its chunk data as stored (name, NUL, method and the compressed profile): 64 KiB goes in.
        let iccp = |data: usize| {
            let mut body = b"P3\0\0".to_vec();
            body.resize(data, 0x78);
            chunk(b"iCCP", &body)
        };
        assert!(!refuses(&png(&[iccp(MAX_PROFILE_BYTES)])));
        assert!(refuses(&png(&[iccp(MAX_PROFILE_BYTES + 1)])));
        // An iCCP with no name, or no NUL in its first 80 bytes, isn't one.
        assert!(refuses(&png(&[chunk(b"iCCP", b"\0\0x")])));
        assert!(refuses(&png(&[chunk(b"iCCP", &[b'a'; 100])])));
    }

    #[test]
    fn holds_the_keep_list_between_scans_and_refuses_bytes_after_the_end() {
        // Two scans with tables between them: kept. A comment or an Exif block between them: refused.
        let scan = [
            segment(0xda, &[1, 1, 0, 0, 0x3f, 0]),
            vec![0x12, 0xff, 0x00, 0x34],
        ]
        .concat();
        let mut two = jpeg(&[]);
        let eoi = two.len() - 2;
        two.splice(eoi..eoi, [segment(0xc4, &[0; 17]), scan.clone()].concat());
        assert!(!refuses(&two));
        for between in [segment(0xfe, b"note"), segment(0xe1, b"Exif\0\0")] {
            let mut bad = jpeg(&[]);
            let eoi = bad.len() - 2;
            bad.splice(eoi..eoi, [between, scan.clone()].concat());
            assert!(refuses(&bad));
        }
        // One byte after EOI or IEND: refused.
        let mut jpeg_after = jpeg(&[]);
        jpeg_after.push(0);
        assert!(refuses(&jpeg_after));
        let mut png_after = png(&[]);
        png_after.push(0);
        assert!(refuses(&png_after));
    }

    #[test]
    fn refuses_truncated_and_garbage_pictures_and_leaves_other_bytes_alone() {
        let whole = jpeg(&[]);
        for cut in 3..whole.len() {
            assert!(refuses(&whole[..cut]), "a JPEG cut at {cut}");
        }
        let whole = png(&[]);
        for cut in 8..whole.len() {
            assert!(refuses(&whole[..cut]), "a PNG cut at {cut}");
        }
        let mut long = png(&[]);
        long[8..12].copy_from_slice(&u32::MAX.to_be_bytes());
        assert!(refuses(&long));
        assert!(refuses(&[0xff, 0xd8, 0xff, 0xff, 0xff]));
        // Not a JPEG or PNG by its first bytes: a PDF, a test's own bytes, nothing at all.
        assert!(!refuses(b"%PDF-1.7\n"));
        assert!(!refuses(&[0x89, b'P', b'N', b'G', 0, 1, 2, 3]));
        assert!(!refuses(&[]));
    }
}
