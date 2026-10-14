"""Build the two local variable WOFF2 subsets from pinned Google Fonts sources.

Requires Python 3.12+, fonttools==4.66.1 and brotli. Keep the source TTF files
outside this repository; see docs/assets/local-fonts.md for exact downloads.
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
# The source Noto fonts have no U+2304 (⌄); this UI symbol uses system fallback.
SYSTEM_FALLBACK = {0x2304}
SOURCES = {
    "NotoSansSC.ttf": ("NotoSansSC-variable.woff2", "fb0637bafbcd804fe32152370a1225990745b4bc"),
    "NotoSerifSC.ttf": ("NotoSerifSC-variable.woff2", "eab063faf229160a52d3760f5555150e4eb9e5bf"),
}


def git_blob_sha1(data: bytes) -> str:
    return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()


def web_characters() -> set[int]:
    # UI literals, punctuation and ASCII. Missing characters still use CSS fallback;
    # this set ensures that characters shipped by the current UI are covered.
    chars = set(range(0x20, 0x7F))
    for path in WEB.rglob("*"):
        if path.suffix not in {".ts", ".tsx", ".css", ".html", ".json"}:
            continue
        if any(part in {"dist", "node_modules", "assets"} for part in path.parts):
            continue
        if ".test." in path.name:
            continue
        chars.update(ord(char) for char in path.read_text(encoding="utf-8") if char.isprintable())

    # GB2312 level-one Chinese characters (3,755) cover common user-provided text.
    for lead in range(0xB0, 0xD8):
        for trail in range(0xA1, 0xFF):
            try:
                chars.add(ord(bytes((lead, trail)).decode("gb2312")))
            except UnicodeDecodeError:
                continue
    return chars - SYSTEM_FALLBACK


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_dir", type=Path, help="Directory with the two pinned source TTFs")
    args = parser.parse_args()
    chars = web_characters()
    OUTPUT.mkdir(parents=True, exist_ok=True)

    for source, (output, source_hash) in SOURCES.items():
        data = (args.source_dir / source).read_bytes()
        actual_hash = git_blob_sha1(data)
        if actual_hash != source_hash:
            raise ValueError(f"{source}: expected Git blob {source_hash}, got {actual_hash}")
        font = TTFont(args.source_dir / source, recalcTimestamp=False)
        available = set(font.getBestCmap())
        missing = {codepoint for codepoint in chars if codepoint not in available}
        # Emoji are intentionally rendered by the system emoji fallback.
        missing = {codepoint for codepoint in missing if codepoint < 0x1F000}
        if missing:
            sample = " ".join(f"U+{codepoint:04X}" for codepoint in sorted(missing)[:20])
            raise ValueError(f"{source}: missing requested characters: {sample}")

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
        font.flavor = "woff2"
        dest = OUTPUT / output
        font.save(dest, reorderTables=True)
        print(f"{output}: {dest.stat().st_size:,} bytes, {len(font.getBestCmap())} cmap entries")


if __name__ == "__main__":
    main()
