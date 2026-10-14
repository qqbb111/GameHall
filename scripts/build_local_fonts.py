"""Build local variable WOFF2 subsets from pinned Google Fonts source TTFs.

Requires Python 3.12, fonttools==4.66.1 and brotli==1.2.0. Keep source TTFs
outside the repository; see docs/assets/local-fonts.md for exact downloads.
"""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "apps" / "web"
OUTPUT = WEB / "src" / "assets" / "fonts"
CSS = WEB / "src" / "font-faces.css"
# Neither source Noto font has U+2304 (⌄); it uses the system fallback.
SYSTEM_FALLBACK = {0x2304}
SOURCES = {
    "NotoSansSC.ttf": ("Noto Sans SC", "NotoSansSC", 100, 900, "fb0637bafbcd804fe32152370a1225990745b4bc"),
    "NotoSerifSC.ttf": ("Noto Serif SC", "NotoSerifSC", 200, 900, "eab063faf229160a52d3760f5555150e4eb9e5bf"),
}


def git_blob_sha1(data: bytes) -> str:
    return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()


def static_web_characters() -> set[int]:
    """Current UI source text, CSS literals, punctuation and printable ASCII."""
    chars = set(range(0x20, 0x7F))
    for path in WEB.rglob("*"):
        if path.suffix not in {".ts", ".tsx", ".css", ".html", ".json"}:
            continue
        if any(part in {"dist", "node_modules", "assets"} for part in path.parts):
            continue
        if ".test." in path.name or path == CSS:
            continue
        chars.update(ord(char) for char in path.read_text(encoding="utf-8") if char.isprintable())
    # Emoji are rendered by the system emoji font; do not claim them in CSS.
    return {cp for cp in chars - SYSTEM_FALLBACK if cp < 0x1F000}


def common_chinese_characters() -> set[int]:
    """The 3,755 characters in GB2312 level one."""
    chars = set()
    for lead in range(0xB0, 0xD8):
        for trail in range(0xA1, 0xFF):
            try:
                chars.add(ord(bytes((lead, trail)).decode("gb2312")))
            except UnicodeDecodeError:
                continue
    assert len(chars) == 3755
    return chars


def web_characters() -> set[int]:
    return static_web_characters() | common_chinese_characters()


def unicode_ranges(chars: set[int]) -> str:
    """Losslessly group consecutive cmap codepoints into CSS ranges."""
    values = sorted(chars)
    assert values
    ranges = []
    start = end = values[0]
    for cp in values[1:]:
        if cp == end + 1:
            end = cp
            continue
        ranges.append(f"U+{start:X}" if start == end else f"U+{start:X}-{end:X}")
        start = end = cp
    ranges.append(f"U+{start:X}" if start == end else f"U+{start:X}-{end:X}")
    lines = []
    line = ""
    for token in ranges:
        if line and len(line) + len(token) + 1 > 100:
            lines.append(line)
            line = token
        else:
            line = f"{line},{token}" if line else token
    lines.append(line)
    return ",\n    ".join(lines)


def font_face(family: str, filename: str, minimum: int, maximum: int, chars: set[int]) -> str:
    return "\n".join((
        "@font-face {",
        f"  font-family: '{family}';",
        f"  src: url('./assets/fonts/{filename}') format('woff2');",
        "  font-style: normal;",
        f"  font-weight: {minimum} {maximum};",
        "  font-display: swap;",
        f"  unicode-range: {unicode_ranges(chars)};",
        "}",
    ))


def build_subset(source: Path, destination: Path, chars: set[int]) -> None:
    font = TTFont(source, recalcTimestamp=False)
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.name_legacy = True
    options.recalc_timestamp = False
    sub = subset.Subsetter(options=options)
    sub.populate(unicodes=chars)
    sub.subset(font)
    if set(font.getBestCmap()) != chars:
        raise ValueError(f"{source.name}: subset cmap differs from requested Unicode set")
    font.flavor = "woff2"
    font.save(destination, reorderTables=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_dir", type=Path, help="Directory with the pinned source TTFs")
    args = parser.parse_args()
    core = static_web_characters()
    common = common_chinese_characters() - core
    assert core.isdisjoint(common)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    faces = []

    for source_name, (family, stem, minimum, maximum, source_hash) in SOURCES.items():
        source = args.source_dir / source_name
        data = source.read_bytes()
        actual_hash = git_blob_sha1(data)
        if actual_hash != source_hash:
            raise ValueError(f"{source_name}: expected Git blob {source_hash}, got {actual_hash}")
        available = set(TTFont(source, recalcTimestamp=False).getBestCmap())
        missing = (core | common) - available
        if missing:
            sample = " ".join(f"U+{cp:04X}" for cp in sorted(missing)[:20])
            raise ValueError(f"{source_name}: source font lacks requested characters: {sample}")

        for group, chars in (("core", core), ("common", common)):
            filename = f"{stem}-{group}.woff2"
            destination = OUTPUT / filename
            build_subset(source, destination, chars)
            faces.append(font_face(family, filename, minimum, maximum, chars))
            print(f"{filename}: {destination.stat().st_size:,} bytes, {len(chars)} chars")

    CSS.write_text("/* Generated by scripts/build_local_fonts.py; edit the generator instead. */\n\n" + "\n\n".join(faces) + "\n", encoding="utf-8", newline="\n")
    print(f"Core {len(core)} + common {len(common)} = {len(core | common)} disjoint characters")


if __name__ == "__main__":
    main()
