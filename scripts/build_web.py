"""Embed a data pack into web/template.html and write web/index.html.

    python scripts/build_web.py                      # embeds the synthetic sample pack
    python scripts/build_web.py --pack web/data-pack.json
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "web" / "template.html"
OUT = ROOT / "web" / "index.html"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack", help="JSON data pack (default: generate the sample pack)")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()
    if args.pack:
        pack = json.loads(Path(args.pack).read_text(encoding="utf-8"))
    else:
        from stockselector.data import load_market_data
        from stockselector.webdata import to_web_pack

        pack = to_web_pack(load_market_data(mode="sample"))
    blob = json.dumps(pack, separators=(",", ":")).replace("</", "<\\/")
    html = TEMPLATE.read_text(encoding="utf-8").replace("__DATA_PACK__", blob)
    Path(args.out).write_text(html, encoding="utf-8")
    # A few bytes the page can poll cheaply to notice that newer prices exist,
    # even when the browser is serving it a cached copy of this HTML.
    version = {"fetched_at": pack.get("meta", {}).get("fetched_at", ""),
               "stocks": len(pack.get("stocks", [])), "board": len(pack.get("board", []))}
    Path(args.out).with_name("version.json").write_text(json.dumps(version), encoding="utf-8")
    print(f"wrote {args.out} ({len(html) / 1024:.0f} KB, {len(pack['stocks'])} stocks, {len(pack['dates'])} days)")


if __name__ == "__main__":
    main()
