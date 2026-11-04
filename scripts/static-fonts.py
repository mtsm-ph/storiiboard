# Run from the repo root with fontTools installed (pip install fonttools): python3 scripts/static-fonts.py
# Static instances of the bundled variable fonts for the PDF export (1.25): pdf-lib embeds fixed-weight fonts only.
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

FONTS = [
    ('src/ui/fonts/intertight/InterTight[wght].ttf', 'InterTight', [(400, 'Regular'), (600, 'SemiBold'), (700, 'Bold')]),
    ('src/ui/fonts/jetbrainsmono/JetBrainsMono[wght].ttf', 'JetBrainsMono', [(400, 'Regular'), (700, 'Bold')]),
]
for source, base, weights in FONTS:
    for weight, name in weights:
        font = TTFont(source)
        static = instantiateVariableFont(font, {'wght': weight}, updateFontNames=True)
        out = f'src/features/export/fonts/{base}-{name}.ttf'
        static.save(out)
        print(out, static['OS/2'].usWeightClass, 'fvar' in static)
