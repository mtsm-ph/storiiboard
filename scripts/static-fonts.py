# Run from the repo root with fontTools installed (pip install fonttools; 5.10 used 4.68.0): python scripts/static-fonts.py
# The static weights of the bundled fonts for the PDF export (1.25, 5.10), in src/features/export/fonts. pdf-lib embeds
# fixed-weight fonts only. The files are the font publishers' own statics (see that folder's README.md for each source and
# SHA-256); this script does the two things the publishers' files may need, and nothing else:
#   1. pad a publisher's file in place when a glyph has an odd length (it prints what it padded);
#   2. generate the instances listed in NOT_PUBLISHED from the variable fonts in src/ui/fonts, for a weight the
#      publisher doesn't ship (none today).
# It can be run again: a file that is already right is left alone, byte for byte.
import glob
import hashlib
import os
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

FOLDER = 'src/features/export/fonts'

# (variable font, file base name, [(wght, style name)]): an instance for each weight the publisher doesn't ship, as
# `<base>-<style>.ttf`. Empty: every weight the app offers is published. Add a row only with a note in the README.
NOT_PUBLISHED = []


def odd_glyphs(font):
    """How many glyphs have an odd length in glyf (the offsets are read from loca as they are stored)."""
    offsets = font['loca'].locations
    return sum(1 for a, b in zip(offsets, offsets[1:]) if (b - a) % 2)


def pad(font):
    # Every glyph padded to 4 bytes: fontkit's subsetter (pdf-lib) copies glyphs as they are, then writes short loca
    # offsets (halved) when the subset is small. An odd-length glyph shifted every glyph after it, and most of Inter
    # Tight printed as blanks or other letters. The table test in src/features/export/deckFontFiles.test.ts holds this.
    font['glyf'].padding = 4


for source, base, instances in NOT_PUBLISHED:
    for weight, style in instances:
        out = f'{FOLDER}/{base}-{style}.ttf'
        if os.path.exists(out):
            have = TTFont(out, recalcTimestamp=False, recalcBBoxes=False)
            if have['OS/2'].usWeightClass == weight and 'fvar' not in have:
                print('kept', out)
                continue
        static = instantiateVariableFont(TTFont(source, recalcTimestamp=False, recalcBBoxes=False), {'wght': weight}, updateFontNames=True)
        pad(static)
        static.save(out)
        print('generated', out, static['OS/2'].usWeightClass, 'fvar' in static)

for path in sorted(glob.glob(f'{FOLDER}/*.ttf')):
    # No timestamp or box recalculated on save: padding is the only change a file gets.
    font = TTFont(path, recalcTimestamp=False, recalcBBoxes=False)
    odd = odd_glyphs(font)
    if odd == 0:
        status = 'ok'
    else:
        pad(font)
        font.save(path)
        status = f'padded {odd} glyphs'
    with open(path, 'rb') as handle:
        digest = hashlib.sha256(handle.read()).hexdigest()
    print(os.path.basename(path), status, digest)
sys.exit(0)
