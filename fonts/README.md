# Offline reading font

Only `QiaomuReadingFangsong.woff2` is bundled. It is a reading subset derived from
Zhuque Fangsong v0.212 (technical preview), containing 7,554 Unicode codepoints:
GB2312 characters plus supported Latin, punctuation and full-width characters.
Glyph outlines and layout features are retained. Characters outside the subset
fall back to the device's system serif font. Users can also select device fonts.
No font network request or installation is performed.

Upstream: https://github.com/TrionesType/zhuque
Original `ZhuqueFangsong-Regular.ttf` SHA-256:
`558c62730844fe54ba220146ed62f859d4e2880188d92d985f8921c6e3743bc4`.

License: SIL Open Font License 1.1, Copyright (c) 2023 Zhejiang JadeFoci
Techonology Co. LTD. The upstream license is in `OFL.txt` and embedded in the
release banner. This subset is maintained by 向阳乔木 and is not an upstream release.

To reproduce using Python with fonttools 4.64.0 and brotli 1.2.0:

    python scripts/build-reading-font.py /path/to/ZhuqueFangsong-Regular.ttf

The generated WOFF2 is committed, so ordinary plugin builds need only npm ci
and npm run build. The build enforces a 5,000,000-byte budget on each release asset.
