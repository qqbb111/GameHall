"""Validate shipped WOFF2 glyphs, CSS ranges, source coverage and licenses.

Requires fonttools==4.66.1 and brotli==1.2.0; see docs/assets/local-fonts.md.
"""

from __future__ import annotations

import hashlib
import re
import sys
from pathlib import Path

from fontTools.ttLib import TTFont

sys.dont_write_bytecode = True
from build_local_fonts import common_chinese_characters, static_web_characters  # type: ignore[import-not-found]


ROOT = Path(__file__).resolve().parents[1]
WEB_SRC = ROOT / "apps" / "web" / "src"
FONT_DIR = WEB_SRC / "assets" / "fonts"
CSS = (WEB_SRC / "font-faces.css").read_text(encoding="utf-8")
STYLES = (WEB_SRC / "styles.css").read_text(encoding="utf-8")
MAIN = (WEB_SRC / "main.tsx").read_text(encoding="utf-8")
FAMILIES = {
    "Noto Sans SC": ("NotoSansSC", 100, 900, "OFL-NotoSansSC.txt"),
    "Noto Serif SC": ("NotoSerifSC", 200, 900, "OFL-NotoSerifSC.txt"),
}


def decode_range(value: str) -> set[int]:
    """Reject CSS wildcards, malformed tokens and overlapping intervals."""
    chars: set[int] = set()
    for token in value.split(","):
        match = re.fullmatch(r"U\+([0-9A-F]+)(?:-([0-9A-F]+))?", token.strip())
        assert match, f"Malformed unicode-range: {token}"
        start = int(match[1], 16)
        end = int(match[2], 16) if match[2] else start
        assert start <= end <= 0x10FFFF
        section = set(range(start, end + 1))
        assert chars.isdisjoint(section), f"Overlapping intervals: {token}"
        chars.update(section)
    return chars


def css_faces() -> dict[tuple[str, str], tuple[str, set[int]]]:
    blocks = re.findall(r"@font-face\s*\{([^}]*)\}", CSS, re.DOTALL)
    assert len(blocks) == 4, f"Expected four @font-face rules, found {len(blocks)}"
    faces = {}
    for block in blocks:
        declarations = dict(re.findall(r"([\w-]+):\s*([^;]+);", block))
        family = declarations["font-family"].strip("'\"")
        src = declarations["src"]
        match = re.fullmatch(r"url\('\./assets/fonts/([^']+)'\) format\('woff2'\)", src)
        assert match, f"Unexpected font URL: {src}"
        filename = match[1]
        group = filename.removeprefix("NotoSansSC-").removeprefix("NotoSerifSC-").removesuffix(".woff2")
        assert group in {"core", "common"}
        assert declarations["font-display"] == "swap"
        assert declarations["font-style"] == "normal"
        minimum, maximum = FAMILIES[family][1:3]
        assert declarations["font-weight"] == f"{minimum} {maximum}"
        key = (family, group)
        assert key not in faces, f"Duplicate font face: {key}"
        faces[key] = filename, decode_range(declarations["unicode-range"])
    return faces


def main() -> None:
    assert "@import" not in CSS + STYLES, "External CSS imports may block first paint"
    assert "fonts.googleapis.com" not in CSS + STYLES
    assert "fonts.gstatic.com" not in CSS + STYLES
    assert "import './font-faces.css';" in MAIN
    assert "system-ui, sans-serif" in STYLES
    core = static_web_characters()
    common = common_chinese_characters() - core
    assert core.isdisjoint(common)
    expected = {"core": core, "common": common}
    faces = css_faces()
    assert len(faces) == len(FAMILIES) * 2

    for family, (stem, minimum, maximum, license_name) in FAMILIES.items():
        license_text = (FONT_DIR / license_name).read_text(encoding="utf-8")
        assert "SIL OPEN FONT LICENSE Version 1.1" in license_text
        family_cmaps = {}
        for group in ("core", "common"):
            filename, css_chars = faces[(family, group)]
            assert filename == f"{stem}-{group}.woff2"
            data = (FONT_DIR / filename).read_bytes()
            assert data[:4] == b"wOF2", f"{filename}: invalid WOFF2 header"
            font = TTFont(FONT_DIR / filename)
            axis = next(axis for axis in font["fvar"].axes if axis.axisTag == "wght")
            assert (axis.minValue, axis.maxValue) == (minimum, maximum)
            cmap = set(font.getBestCmap())
            assert cmap == css_chars == expected[group], f"{filename}: cmap/CSS/source mismatch"
            assert "name" in font and "OS/2" in font
            names = {record.nameID: record.toUnicode() for record in font["name"].names}
            assert "Adobe" in names[0], f"{filename}: lost copyright notice"
            assert "SIL Open Font License" in names[13], f"{filename}: lost license metadata"
            family_cmaps[group] = cmap
            print(f"{filename}: {len(data):,} bytes; {len(cmap)} chars; SHA-256 {hashlib.sha256(data).hexdigest()}")
        assert family_cmaps["core"].isdisjoint(family_cmaps["common"])
        assert family_cmaps["core"] | family_cmaps["common"] == core | common
    print(f"Core {len(core)} + common {len(common)} = {len(core | common)} disjoint characters per family")


if __name__ == "__main__":
    main()
