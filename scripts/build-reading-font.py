"""Build the offline GB2312 reading subset. Requires fonttools==4.64.0, brotli==1.2.0.
Usage: python scripts/build-reading-font.py /path/to/upstream/ZhuqueFangsong-Regular.ttf
"""
import hashlib
import sys
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont
source = Path(sys.argv[1])
assert hashlib.sha256(source.read_bytes()).hexdigest() == '558c62730844fe54ba220146ed62f859d4e2880188d92d985f8921c6e3743bc4'
characters = set(range(0x20, 0x250)) | set(range(0x2000, 0x2070)) | set(range(0x3000, 0x3040)) | set(range(0xff00, 0xfff0))
for first in range(0xa1, 0xf8):
    for second in range(0xa1, 0xff):
        try:
            characters.update(map(ord, bytes([first, second]).decode('gb2312')))
        except UnicodeDecodeError:
            pass
font = TTFont(source, recalcTimestamp=False)
options = subset.Options()
options.layout_features = ['*']
options.name_IDs = ['*']
options.name_legacy = True
options.name_languages = ['*']
subsetter = subset.Subsetter(options=options)
subsetter.populate(unicodes=characters)
subsetter.subset(font)
font.flavor = 'woff2'
font.save('fonts/QiaomuReadingFangsong.woff2')
print(f'{len(font.getBestCmap())} codepoints, {Path("fonts/QiaomuReadingFangsong.woff2").stat().st_size} bytes')
