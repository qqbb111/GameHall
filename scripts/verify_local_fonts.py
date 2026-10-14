"""Check the shipped font subsets and the UI's nonblocking local font wiring.

Requires fonttools==4.66.1 and brotli; see docs/assets/local-fonts.md.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

from fontTools.ttLib import TTFont

sys.dont_write_bytecode = True
from build_local_fonts import web_characters  # type: ignore[import-not-found]


ROOT = Path(__file__).resolve().parents[1]
FONT_DIR = ROOT / "apps" / "web" / "src" / "assets" / "fonts"
STYLES = (ROOT / "apps" / "web" / "src" / "styles.css").read_text(encoding="utf-8")
FONTS = {
    "NotoSansSC-variable.woff2": ("Noto Sans SC", 100, 900, "OFL-NotoSansSC.txt"),
    "NotoSerifSC-variable.woff2": ("Noto Serif SC", 200, 900, "OFL-NotoSerifSC.txt"),
}


def main() -> None:
    assert "@import" not in STYLES, "Font CSS must not block initial rendering"
    assert "fonts.googleapis.com" not in STYLES
    assert "font-display: swap" in STYLES
    assert "system-ui, sans-serif" in STYLES
    chars = {cp for cp in web_characters() if cp < 0x1F000}
    for filename, (family, minimum, maximum, license_name) in FONTS.items():
        data = (FONT_DIR / filename).read_bytes()
        assert data[:4] == b"wOF2", f"{filename}: invalid WOFF2 header"
        assert filename in STYLES, f"{filename}: missing CSS reference"
        assert f"font-family: '{family}'" in STYLES
        assert f"font-weight: {minimum} {maximum}" in STYLES
        license_text = (FONT_DIR / license_name).read_text(encoding="utf-8")
        assert "SIL OPEN FONT LICENSE Version 1.1" in license_text
        font = TTFont(FONT_DIR / filename)
        axis = next(axis for axis in font["fvar"].axes if axis.axisTag == "wght")
        assert (axis.minValue, axis.maxValue) == (minimum, maximum)
        cmap = set(font.getBestCmap())
        missing = chars - cmap
        assert not missing, f"{filename}: missing UI/common characters: {sorted(missing)[:20]}"
        assert "name" in font and "OS/2" in font
        names = {record.nameID: record.toUnicode() for record in font["name"].names}
        assert "Adobe" in names[0], f"{filename}: lost copyright notice"
        assert "SIL Open Font License" in names[13], f"{filename}: lost license metadata"
        print(f"{filename}: {len(data):,} bytes; {len(cmap)} chars; SHA-256 {hashlib.sha256(data).hexdigest()}")


if __name__ == "__main__":
    main()
