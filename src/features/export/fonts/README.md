Static weights of the bundled fonts for the PDF export (1.25, 5.10). pdf-lib embeds fixed-weight fonts only, so a deck's,
a storyboard's and a call sheet's PDF take their fonts from here; the canvas draws from the variable fonts in
src/ui/fonts and is not touched by these. The files load only when a PDF is exported, and pdf-lib embeds just the
characters used.

Every file is the font publisher's own static TTF, byte for byte (checked against the downloads; only the Jost files
are renamed, below), under the SIL Open Font License 1.1 (the OFL-*.txt beside them). Each
family has every weight its board range offers (`BUNDLED` in src/features/moodboards/fonts.ts), upright, and italic
where the family has one (Outfit has none: its slant is made when a PDF is written). Names are `<Family>-<Style>.ttf`,
the 400 weight being `Regular` and `Italic`.

- **Padded or generated: none.** Every publisher's file already has even-length glyphs, which pdf-lib's subsetter
  needs (every glyph padded to 4 bytes; the table test in src/features/export/deckFontFiles.test.ts holds it), and every weight is published, so
  nothing was padded or made with fontTools. `scripts/static-fonts.py` (fontTools 4.68.0 when this was written) does
  both when a file needs it, lists what it did, and changes nothing in a file that is right; its `NOT_PUBLISHED` list
  is empty. A file it makes or pads must be named here with why.
- Bodoni Moda has an optical-size axis (6 to 96, default 11). The publisher ships one static optical size, the
  default, 11: these files are that one. The canvas follows the text's size (checked in Chromium: the width of a line
  per point of size shrinks as the text grows), so large Bodoni Moda text prints in the PDF at the optical size of 11
  where the canvas drew it at a larger one: slightly wider, with less contrast. The publisher has no other size to
  take.
- Archivo is the normal width (wdth 100) only, as the canvas draws it.
- Every file is checked by a test (src/features/export/deckFontFiles.test.ts): its exact family name (name ID 16, else
  ID 1; Jost's own is spelled `Jost*`), normal width (OS/2 usWidthClass 5), weight, no `fvar`, even glyphs, embedding
  allowed, its advance widths against the variable font the canvas draws, and the SHA-256 below, so a file can't
  change unnoticed. A file added here is listed here.
- The licence texts. Outfit's, Archivo's and Inter Tight's are byte for byte the ones in src/ui/fonts/<family>/OFL.txt.
  The copyright holder and year are the same for all six. Three differ in wording only: Jost's (the publisher's own file
  is kept) has `(https://github.com/indestructible-type/Jost)` in its copyright line where the variable fonts' has
  `(https://github.com/indestructible-type)`, and a shorter introduction ("This license is available with a FAQ at:
  https://scripts.sil.org/OFL") and the licence headed "SIL OPEN FONT LICENSE" with "Version 1.1 - 26 February 2007" under it; Bodoni
  Moda's (the publisher's is kept) gives the FAQ address as scripts.sil.org/OFL where the variable fonts' gives
  openfontlicense.org; JetBrains Mono's differs from the publisher's v2.304 file in line breaks and a trailing space (the
  one already here is kept).

## Sources

Each is fetched from the publisher's repository at the commit or tag named (at least two weeks old on Nov 13, 2026).
The file is at `<path>/<publisher's name>` in that repository.

| Family | Repository | Commit or tag (date) | Path | Licence |
| --- | --- | --- | --- | --- |
| Outfit 1.100 | github.com/Outfitio/Outfit-Fonts | 902773808eb372f70fb34e8946dd1ffe604efc79 (2023-03-26) | fonts/ttf | OFL-Outfit.txt |
| Archivo 2.001 | github.com/Omnibus-Type/Archivo | 211127690e8ff106c36c935f7e5e697114cff103 (2026-09-02) | fonts/ttf | OFL-Archivo.txt |
| Jost 3.7 | github.com/indestructible-type/Jost | 35f141c970538f1ed0f235789c19156b3ce2a762 (2021-02-20) | fonts/ttf | OFL-Jost.txt |
| Bodoni Moda 2.005 | github.com/indestructible-type/Bodoni | 30ce6cdc354ef179a3b72ba0f0e71826e599348c (2024-02-18) | fonts/ttf | OFL-BodoniModa.txt |
| Inter Tight 3.004 | github.com/rsms/inter-gf-tight | c194f94c60b569b47876811321f5ef1f0c2614a2 (2022-12-08) | fonts/ttf | OFL-InterTight.txt |
| JetBrains Mono 2.304 | github.com/JetBrains/JetBrainsMono | tag v2.304 (2023-01-26) | fonts/ttf | OFL-JetBrainsMono.txt |

- Inter Tight: the publisher's own repository for Google Fonts' release (the repository the Google Fonts copy in
  ofl/intertight is built from); google/fonts holds only its variable files.
- Renamed files: only Jost's. The other five families' files keep the publisher's names exactly (Bodoni Moda's repository
  has one optical size, with no size in its names). The publisher names Jost's weights 100 Hairline, 200 Thin, 400 Book,
  600 Semi and 800 Heavy; the files are renamed to the CSS weights' usual names, with nothing else changed. Each file's
  own weight (OS/2 usWeightClass) is what the test reads. The path is `fonts/ttf/` in the repository above.

| Our file | Publisher's file |
| --- | --- |
| Jost-Thin.ttf, Jost-ThinItalic.ttf | Jost-100-Hairline.ttf, Jost-100-HairlineItalic.ttf |
| Jost-ExtraLight.ttf, Jost-ExtraLightItalic.ttf | Jost-200-Thin.ttf, Jost-200-ThinItalic.ttf |
| Jost-Light.ttf, Jost-LightItalic.ttf | Jost-300-Light.ttf, Jost-300-LightItalic.ttf |
| Jost-Regular.ttf, Jost-Italic.ttf | Jost-400-Book.ttf, Jost-400-BookItalic.ttf |
| Jost-Medium.ttf, Jost-MediumItalic.ttf | Jost-500-Medium.ttf, Jost-500-MediumItalic.ttf |
| Jost-SemiBold.ttf, Jost-SemiBoldItalic.ttf | Jost-600-Semi.ttf, Jost-600-SemiItalic.ttf |
| Jost-Bold.ttf, Jost-BoldItalic.ttf | Jost-700-Bold.ttf, Jost-700-BoldItalic.ttf |
| Jost-ExtraBold.ttf, Jost-ExtraBoldItalic.ttf | Jost-800-Heavy.ttf, Jost-800-HeavyItalic.ttf |
| Jost-Black.ttf, Jost-BlackItalic.ttf | Jost-900-Black.ttf, Jost-900-BlackItalic.ttf |

- Inter Tight and JetBrains Mono replace the five instances made from the variable fonts in 1.25 (Inter Tight 400, 600,
  700; JetBrains Mono 400, 700) with the publisher's files of the same weights.

## SHA-256

### Outfit

| File | SHA-256 |
| --- | --- |
| Outfit-Black.ttf | 1c033aa4d2ed288e5a9fb6e379bbe52e2c5b8ce0fd06bcee928c14f9bccbca4c |
| Outfit-Bold.ttf | f620b69582e06d7e1b3bbde74ed8c5876eadabb038390780db2a3414a1490197 |
| Outfit-ExtraBold.ttf | 0f028cbdc61a588bc44fef911e8d2bcfc0bc05b241a9b797686024d269d964b6 |
| Outfit-ExtraLight.ttf | d7024212daae2cdbe59b8a33dc1f4bb9a3c4399cb88739531b381f71dfb33e76 |
| Outfit-Light.ttf | 181c6867345960e0fbd807131624d092accb5f87185910f9496ba8b188aa2730 |
| Outfit-Medium.ttf | dc8d9212fc57556a55d01e863071f727cd6264b748e28885d853807aeb186142 |
| Outfit-Regular.ttf | 3b64ac4f6ab6a8eebddd4b0bc03c811c43602e11e176382ab0ee6be615ab861b |
| Outfit-SemiBold.ttf | bf2e1d2a6ec2a67952e8b36edd2b2bb9f340c0cdd10b0ad5145b4dbbc1339608 |
| Outfit-Thin.ttf | 927116fc2adf773f9b4f4062ce59d629db254e52f12474e7d72eedf1c9460cda |

### Archivo

| File | SHA-256 |
| --- | --- |
| Archivo-Black.ttf | 37bafecd27daf830ceee55a55e6e2b8b4178159a8b7cab982a83fd51197e7f07 |
| Archivo-BlackItalic.ttf | 2d112402e3768d8cc92895b0aa01c33883bf285ca1b526b89879d3e41a67ecc7 |
| Archivo-Bold.ttf | 951a0ebab63b1bb0d90a26c27625bda803d570dace3851fa2f1eea65852d8983 |
| Archivo-BoldItalic.ttf | 2a6a93a878804257237ce188ab31245fa4b8a0fb1c29a4b34588e8e1ed642b1d |
| Archivo-ExtraBold.ttf | 9fff67922ae2bc376a9e5c6d644eebf8c5b17f62a0f38e5f016e4b7e3903662f |
| Archivo-ExtraBoldItalic.ttf | 242839722f6642459dc5f3af1cbaaaa4732289e925035b62d1a6da8db672b5b2 |
| Archivo-ExtraLight.ttf | e9da78a3dcfb6463001ffc4da8af7c24913db50c43a94ab09d02059041de367f |
| Archivo-ExtraLightItalic.ttf | 07f576b03ac1626e3b7a6611ba9f297f150b1e7f42bd82820cdbb9c80d6dc47c |
| Archivo-Italic.ttf | 344ac62b73990a6e7f18d28af41c9e952098faf58dbe46048b02aca7128c0974 |
| Archivo-Light.ttf | 950fc47e639af87cf403aa6617bffd72bd9cbfdfdacdc14141b374e059586892 |
| Archivo-LightItalic.ttf | 1cd2e59510f36ba11015e6efc6e5f08e0506dfea7a59056f0a495e673992f39f |
| Archivo-Medium.ttf | 6d42123d7954e72600b2e29284a9c8c95cddb4372b21cd3d2a5e8cd4f231f36b |
| Archivo-MediumItalic.ttf | 75a787e434bdcb2121a3ffea4dd876bccb18035c36dadfc0d42c639171677375 |
| Archivo-Regular.ttf | 59fbfd8a9bb41301bfe950e7b097fd42d52af224a07761e2c1b2c959a4c9cf9a |
| Archivo-SemiBold.ttf | 6598b6ed816158767a7633bdfb01d78daf54cab4cd4d9d3cc0cfd995f4723083 |
| Archivo-SemiBoldItalic.ttf | 77eee24151e8e6f6f4d8b91a1219efb8cf6f46f4a8f591afbdc6a50becd16ef5 |
| Archivo-Thin.ttf | 1c978a04b40728bf9afac3575fbcd483342c3d7809967949471a87b76cb93d6a |
| Archivo-ThinItalic.ttf | 438017a801caa66600217e130927df120d5c4a413ead0961c77a7f2983d58c94 |

### Jost

| File | SHA-256 |
| --- | --- |
| Jost-Black.ttf | a0c8721c9ded5ea822cbcfa2f567ebcdefd068e8e016e345bb47817b6e8d88dc |
| Jost-BlackItalic.ttf | 2872e71ca4c28da9b322e1b265ba9c11ccb2fdf9c65f6afce128b4bd7cca9497 |
| Jost-Bold.ttf | 95f16d07698549232a121443d9fdef129de15b209d70c8804f28df49bf594838 |
| Jost-BoldItalic.ttf | 5430d1114cc0267f56908eae988196f4a1ed4d55adce02931be4181de0ae25ca |
| Jost-ExtraBold.ttf | da008091c2c6d50d48997df2e792383302f710c103ace8b81e2fb17140b49663 |
| Jost-ExtraBoldItalic.ttf | a5e9a1ef93051573f70ca26850f4fd87936a8f18b981ca3670f10b9b61fbf431 |
| Jost-ExtraLight.ttf | c572d29e95c13e141cdcde680ed737ed0ebf2ee361b6710a38ccc74a1773c6c0 |
| Jost-ExtraLightItalic.ttf | 574dc52f011d7d7fe026146263894e2b101037035ae109f75a245907f2b47e44 |
| Jost-Italic.ttf | 295fdb0fe7d66e10480813b619499d14516af20878aaff0246dc28377713cefa |
| Jost-Light.ttf | 375b65a5425cd2b4c986f89b86c59c39965557cf0d424707224e98185849849d |
| Jost-LightItalic.ttf | 20ae670692313728ea1d022fa0af9205f7594f04f6418538ae76e83a951ec78b |
| Jost-Medium.ttf | 4f96c348370bb0b49534ed3da233ffc2f5a47dcc8ec642f175cc9b009d859926 |
| Jost-MediumItalic.ttf | 627f3c7a8f2ff8a89d2efc716364d623b68765ae958d273d2fc5f26641e079c4 |
| Jost-Regular.ttf | 3fda07bcb2fe66667798f45dd2fc3834586a15fc6b6df7da36422b459b5a117c |
| Jost-SemiBold.ttf | 45136d63fdbe5d304d2c23487918fe6bb84d0de40e0c3bc18e2fe75f8a8d1686 |
| Jost-SemiBoldItalic.ttf | 71761236c6aad95e331dab7357e1ad99273e5d609f003affd647b4993bb0c57a |
| Jost-Thin.ttf | 1ab00ff041d8b998658aa1a109c344a02c0e450c4feab2a1a6adbdcae59425d8 |
| Jost-ThinItalic.ttf | b2fe914799f0367dac08d9b8716b29acebbe6ce1f83f9bba3534daee11103a7f |

### BodoniModa

| File | SHA-256 |
| --- | --- |
| BodoniModa-Black.ttf | ce8eb168dc99268303509566f0628426d402c677ac06f205da851fb914395f24 |
| BodoniModa-BlackItalic.ttf | f678182f99285a1026ef22adb9f1ddc2b7efb8fb519beb87d4f090e2393f8eb0 |
| BodoniModa-Bold.ttf | 915d87098e28ead5b935b055dcd0bb27d022c0727d0ccbbdb45ade0b9c11c8e6 |
| BodoniModa-BoldItalic.ttf | bad8e40ec0d0c429b3df3adcdca7b46fc196ae28e97cd9d0acef56851d69b330 |
| BodoniModa-ExtraBold.ttf | 1157ac53453753f3ef4438804645806172f4606035d573a58de64de7660b555c |
| BodoniModa-ExtraBoldItalic.ttf | da8e7b91184a72eaf6d04d8af91de58c7e8e0745c87d6dc17a3565eabb4cac87 |
| BodoniModa-Italic.ttf | 6f4fef5efa84e0b168c7befd1423964caf9151c409b62bf5259f7fc71690a777 |
| BodoniModa-Medium.ttf | cd655bb0861acf6bd1b995a868920870ae0c8758196dd95f0164d24aaea1119e |
| BodoniModa-MediumItalic.ttf | 7343b49edeec5901a52c46258e8b444af2d91902d8e6b7e7ea7c2174c7e3c8eb |
| BodoniModa-Regular.ttf | dd9660ca406734a3b64f5b6c3a7a823c624f17479235761e82862e61ecdbaf57 |
| BodoniModa-SemiBold.ttf | ac11ea53df1e5d784fe9c4f2acf4333f768439d0ae7d92565280c374a41847c6 |
| BodoniModa-SemiBoldItalic.ttf | 3cc3effad9a040aef57e203ad7d02d6c5068c635a35dd3ca616a5e42f42d6b06 |

### InterTight

| File | SHA-256 |
| --- | --- |
| InterTight-Black.ttf | 21eae135fbe274225104e4e379522b02c18ddb4793623bd83228186ff50e4185 |
| InterTight-BlackItalic.ttf | 6e7a04f8ad29b783f7d6b99142d28e35e7dc46ba6c2f3a7cc89b3541cac7c48d |
| InterTight-Bold.ttf | 54b8da2868f28324213e89607255c90e1ff8f2ff156b658ed8cf347f39b23843 |
| InterTight-BoldItalic.ttf | 2bb58d0fc6a0601e5ce5980677443d900e82cedad885070ad8e800b8ad1ba89b |
| InterTight-ExtraBold.ttf | 49ab439869f1f713301e683167d180a17b93a2e33343ad2c3d036a91ad21091e |
| InterTight-ExtraBoldItalic.ttf | 6c8e44aa9606c2929c58ff04d9c912b367381b1a33b91e1501a69703e89bbbcc |
| InterTight-ExtraLight.ttf | d27b1e720e29c48373c0b50bf7e2a05044330fe3fda0a00e15461f4802dea64f |
| InterTight-ExtraLightItalic.ttf | b392d611dfc13b6ca38f1b6166b685134fd5cf9c11d59407fad13d9ccbf549ca |
| InterTight-Italic.ttf | 2c4d87bfe92696a781abb56a69f910d376bd5282eb8d3b0c2debbca210f1cfbe |
| InterTight-Light.ttf | c953dd1a3a8e33cb5c3545f3bbb32ae288a6d44d8a2289d03636af1f92a9aa86 |
| InterTight-LightItalic.ttf | e0fbabafaf3957572207c02ff12e64ef717e51cf6df0d534245335d9124b0cac |
| InterTight-Medium.ttf | a930b0f99037dfacab9f1f071b3bdd61dd940f9e87a0a3f3a21345b41c8c72df |
| InterTight-MediumItalic.ttf | 4409920384f55de1abc502a48130678e71cb55fec229988c1439d4668a9dd24e |
| InterTight-Regular.ttf | d85c374020716713e4ff2ff223d602919a1bb38f940205ea75b404859f0313a3 |
| InterTight-SemiBold.ttf | 975a7f22d6e9a45a7989e6d3cbec6ff5b3089cc2272099ac95638b36d4fc948a |
| InterTight-SemiBoldItalic.ttf | 1144ee21f5905d6cfc7e0d0dbb733c6412952565d835c4b88b5191e2dac46b46 |
| InterTight-Thin.ttf | 29abd6e3ce87af3727d5b034eb807f3898e42fce7137c5944b5b9925f2689763 |
| InterTight-ThinItalic.ttf | bb7e57416d9b4352583b1e7f90a78baaa30187b77de49c19c7d7aa7cf58dd88b |

### JetBrainsMono

| File | SHA-256 |
| --- | --- |
| JetBrainsMono-Bold.ttf | 5590990c82e097397517f275f430af4546e1c45cff408bde4255dad142479dcb |
| JetBrainsMono-BoldItalic.ttf | 4039d5ce0ed225bf9c8b2c8c6436290ae2f356b7e90d70fa666227238324aa3b |
| JetBrainsMono-ExtraBold.ttf | 8e501d3a6a883e83ea4f7852804fb0894cebdd67751bb1006b37a476cef34cd6 |
| JetBrainsMono-ExtraBoldItalic.ttf | ec3a860fa87d0a3b1451277d1c2f3072f5ba19d2367aec54f7169d5710872610 |
| JetBrainsMono-ExtraLight.ttf | 8391e7ec13e8ba758c1838f56bccd973228ccf4dc74aa5bffe9525b9147b12f8 |
| JetBrainsMono-ExtraLightItalic.ttf | 3c7fee57538f18b61cc5f0784a8133fe5ee95feb41f633e8f6f7ef609e6207ec |
| JetBrainsMono-Italic.ttf | 9d0a1f7a708e6af183f1193b7e81d40da294f5c67682c085d8401c60aac8ded4 |
| JetBrainsMono-Light.ttf | 60c18d7dd58d81b3bbd12e8ce32744a8771bfe2b5280574082b0eaed46c60d24 |
| JetBrainsMono-LightItalic.ttf | 18ffadb91fa711b45feae027ddfd561e7f97ace805ec4baf9905046cf450befb |
| JetBrainsMono-Medium.ttf | 31c92d01a8a08528b718a43addf0ad3df0af2ca4b7b3290a452f70f358e14d3d |
| JetBrainsMono-MediumItalic.ttf | 4477fda6bd472ef96b11bc1083370f7fc3ff427bdc807e682ced5819e3dee9df |
| JetBrainsMono-Regular.ttf | a0bf60ef0f83c5ed4d7a75d45838548b1f6873372dfac88f71804491898d138f |
| JetBrainsMono-SemiBold.ttf | 1b3bfa1ed5665a4ce3f9feb68d2d4e40e70bf8b4b7d9a3edd418f321b4e166a0 |
| JetBrainsMono-SemiBoldItalic.ttf | 3b3000507a7285872395ddbb4e53a28f07910dbf494fb0d5e1421dd60b5d8436 |
| JetBrainsMono-Thin.ttf | 0756e8e8cf1d65fa7519776764479b3973efb15af4f419d5d7274dc27ae1b702 |
| JetBrainsMono-ThinItalic.ttf | ebcdd13119b6beb7457e2f76b31094cb8cf1108e567030f8402b24dde018e76a |
