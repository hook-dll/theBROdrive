# Third-party font licences

What lives in `public/fonts` is the only third-party material in the game whose
licence obliges us to do anything: the SIL Open Font License must travel with the
binaries, which is why this file exists. The game's own code is MIT (`LICENSE`),
and the other third-party assets have their own catalogue — the CC0 textures and
models under `public/look` are documented in `public/look/LICENSES.md`. Both font
families are licensed under the SIL Open Font License 1.1, which allows bundling
and embedding them in software, forbids selling them on their own, and requires
that the copyright notice and licence text below are kept.

The WOFF2 files here are the unmodified, per-subset output of the Google Fonts
css2 API, one file per Unicode subset per family. They are loaded through the
`@font-face` rules in `src/ui/fonts.css`, which is where the command that
re-downloads them lives.

Fetched: 2026-09-26.

## The request that produced these files

One request returned the CSS for both families and every subset at once:

```text
https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@100..800&family=Rubik:wght@300..900&display=swap
```

Note the `wght@` ranges: asking for a range instead of a list of weights is what
makes the API serve variable fonts. The same request without a browser
User-Agent answers with fifteen static TrueType blocks and not a single
`unicode-range` line, so the regeneration command carries one.

## JetBrains Mono

| | |
|---|---|
| Family | JetBrains Mono (variable) |
| Copyright | Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono) |
| Licence | SIL Open Font License 1.1 |
| Source page | https://fonts.google.com/specimen/JetBrains+Mono |
| Upstream project | https://github.com/JetBrains/JetBrainsMono |
| Weight axis in the shipped files | `wght 100..800, default 400 (7 named instances)` |
| Fetched | 2026-09-26 |

Files, one per Unicode subset. Sizes are the bytes as shipped; each
`unicode-range` is copied verbatim into `src/ui/fonts.css`.

| File | Subset | Bytes | unicode-range |
|---|---|---|---|
| `jetbrains-mono-cyrillic-ext.woff2` | cyrillic-ext | 2020 | `U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F` |
| `jetbrains-mono-cyrillic.woff2` | cyrillic | 12064 | `U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116` |
| `jetbrains-mono-greek.woff2` | greek | 9084 | `U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF` |
| `jetbrains-mono-vietnamese.woff2` | vietnamese | 7468 | `U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB` |
| `jetbrains-mono-latin-ext.woff2` | latin-ext | 15204 | `U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF` |
| `jetbrains-mono-latin.woff2` | latin | 40480 | `U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD` |

Exact download URLs (`fonts.gstatic.com`, one per file above):

```text
https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbV2o-flEEny0FZhsfKu5WU4xD2OwGtT0rU3BE.woff2
  -> jetbrains-mono-cyrillic-ext.woff2
https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbV2o-flEEny0FZhsfKu5WU4xD_OwGtT0rU3BE.woff2
  -> jetbrains-mono-cyrillic.woff2
https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbV2o-flEEny0FZhsfKu5WU4xD4OwGtT0rU3BE.woff2
  -> jetbrains-mono-greek.woff2
https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbV2o-flEEny0FZhsfKu5WU4xD0OwGtT0rU3BE.woff2
  -> jetbrains-mono-vietnamese.woff2
https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbV2o-flEEny0FZhsfKu5WU4xD1OwGtT0rU3BE.woff2
  -> jetbrains-mono-latin-ext.woff2
https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbV2o-flEEny0FZhsfKu5WU4xD7OwGtT0rU.woff2
  -> jetbrains-mono-latin.woff2
```

### JetBrains Mono — SIL Open Font License 1.1

```text
Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)

This Font Software is licensed under the SIL Open Font License, Version 1.1.

This license is copied below, and is also available with a FAQ at: https://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

## Rubik

| | |
|---|---|
| Family | Rubik (variable) |
| Copyright | Copyright 2015 The Rubik Project Authors (https://github.com/googlefonts/rubik) |
| Licence | SIL Open Font License 1.1 |
| Source page | https://fonts.google.com/specimen/Rubik |
| Upstream project | https://github.com/googlefonts/rubik |
| Weight axis in the shipped files | `wght 300..900, default 300 (7 named instances)` |
| Fetched | 2026-09-26 |

Files, one per Unicode subset. Sizes are the bytes as shipped; each
`unicode-range` is copied verbatim into `src/ui/fonts.css`.

| File | Subset | Bytes | unicode-range |
|---|---|---|---|
| `rubik-arabic.woff2` | arabic | 32480 | `U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0897-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC, U+102E0-102FB, U+10E60-10E7E, U+10EC2-10EC4, U+10EFC-10EFF, U+1EE00-1EE03, U+1EE05-1EE1F, U+1EE21-1EE22, U+1EE24, U+1EE27, U+1EE29-1EE32, U+1EE34-1EE37, U+1EE39, U+1EE3B, U+1EE42, U+1EE47, U+1EE49, U+1EE4B, U+1EE4D-1EE4F, U+1EE51-1EE52, U+1EE54, U+1EE57, U+1EE59, U+1EE5B, U+1EE5D, U+1EE5F, U+1EE61-1EE62, U+1EE64, U+1EE67-1EE6A, U+1EE6C-1EE72, U+1EE74-1EE77, U+1EE79-1EE7C, U+1EE7E, U+1EE80-1EE89, U+1EE8B-1EE9B, U+1EEA1-1EEA3, U+1EEA5-1EEA9, U+1EEAB-1EEBB, U+1EEF0-1EEF1` |
| `rubik-cyrillic-ext.woff2` | cyrillic-ext | 12288 | `U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F` |
| `rubik-cyrillic.woff2` | cyrillic | 15108 | `U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116` |
| `rubik-hebrew.woff2` | hebrew | 9352 | `U+0307-0308, U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F` |
| `rubik-latin-ext.woff2` | latin-ext | 19288 | `U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF` |
| `rubik-latin.woff2` | latin | 35324 | `U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD` |

Exact download URLs (`fonts.gstatic.com`, one per file above):

```text
https://fonts.gstatic.com/s/rubik/v31/iJWKBXyIfDnIV7nErXyw023e1Ik.woff2
  -> rubik-arabic.woff2
https://fonts.gstatic.com/s/rubik/v31/iJWKBXyIfDnIV7nMrXyw023e1Ik.woff2
  -> rubik-cyrillic-ext.woff2
https://fonts.gstatic.com/s/rubik/v31/iJWKBXyIfDnIV7nFrXyw023e1Ik.woff2
  -> rubik-cyrillic.woff2
https://fonts.gstatic.com/s/rubik/v31/iJWKBXyIfDnIV7nDrXyw023e1Ik.woff2
  -> rubik-hebrew.woff2
https://fonts.gstatic.com/s/rubik/v31/iJWKBXyIfDnIV7nPrXyw023e1Ik.woff2
  -> rubik-latin-ext.woff2
https://fonts.gstatic.com/s/rubik/v31/iJWKBXyIfDnIV7nBrXyw023e.woff2
  -> rubik-latin.woff2
```

### Rubik — SIL Open Font License 1.1

```text
Copyright 2015 The Rubik Project Authors (https://github.com/googlefonts/rubik)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded, 
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```
