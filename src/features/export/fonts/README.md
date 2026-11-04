Static weights of the app's two typefaces for the PDF export (1.25). pdf-lib embeds fixed-weight fonts only, so these
are instances of the variable fonts bundled in src/ui/fonts, made with fontTools by `scripts/static-fonts.py`, under
the same SIL Open Font License (OFL-InterTight.txt, OFL-JetBrainsMono.txt). They load only when a PDF is exported, and
pdf-lib embeds just the characters used.
