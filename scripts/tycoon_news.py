#!/usr/bin/env python3
"""Build Tycoon Rush's weekly real-news pack.

Fetches public RSS headlines for each of the game's regions and writes
tycoon/news/weekly.json. The game shows these only in place of its "noise"
headlines, so real news never changes the market or the Daily Market's
fairness. Offline, or if this file is missing, the game uses its own
generated headlines.

Standard library only, so it runs anywhere:  python3 scripts/tycoon_news.py
"""
import datetime as dt
import html
import json
import pathlib
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET

BBC = "https://feeds.bbci.co.uk/news/"
FEEDS = {
    "world": [BBC + "business/rss.xml"],
    "westafrica": [BBC + "world/africa/rss.xml"],
    "eastafrica": [BBC + "world/africa/rss.xml"],
    "southasia": [BBC + "world/asia/india/rss.xml", BBC + "world/asia/rss.xml"],
    "eastasia": [BBC + "world/asia/rss.xml", BBC + "world/asia/china/rss.xml"],
    "latam": [BBC + "world/latin_america/rss.xml"],
    "caribbean": [BBC + "world/latin_america/rss.xml"],
    "europe_na": [BBC + "business/rss.xml", BBC + "world/us_and_canada/rss.xml", BBC + "world/europe/rss.xml"],
    "middleeast": [BBC + "world/middle_east/rss.xml"],
}
# Words that make a headline a poor fit for a game played by children too.
SKIP = re.compile(r"\b(kill|killed|dead|death|dies|murder|rape|sex|abuse|attack|bomb|shoot|shot|war|terror|suicide|massacre)", re.I)
PER_REGION = 10
OUT = pathlib.Path(__file__).resolve().parent.parent / "tycoon" / "news" / "weekly.json"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "TycoonRushNews/1.0 (+https://github.com/samebimo10-cpu/Stock-)"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def titles(url):
    try:
        root = ET.fromstring(fetch(url))
    except Exception as e:  # a feed being down must not stop the others
        print(f"warning: {url}: {e}", file=sys.stderr)
        return []
    out = []
    for item in root.iter("item"):
        t = html.unescape((item.findtext("title") or "").strip())
        if 12 <= len(t) <= 110 and not SKIP.search(t):
            out.append(t)
    return out


def main():
    regions = {}
    cache = {}
    for region, urls in FEEDS.items():
        seen, picks = set(), []
        for u in urls:
            if u not in cache:
                cache[u] = titles(u)
            for t in cache[u]:
                if t not in seen:
                    seen.add(t)
                    picks.append({"title": t, "source": "BBC News"})
        regions[region] = picks[:PER_REGION]
    if not any(regions.values()):
        print("No headlines fetched; keeping the previous pack.", file=sys.stderr)
        return 0
    iso = dt.date.today().isocalendar()
    pack = {"week": f"{iso[0]}-W{iso[1]:02d}", "made": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), "regions": regions}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(pack, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {OUT} ({sum(len(v) for v in regions.values())} headlines)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
