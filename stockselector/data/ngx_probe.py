"""Diagnostics: show what the public NGX endpoints actually return.

Run ``stockselector probe-ngx`` from a machine with internet access (for
example a GitHub Actions runner) and paste the output into an issue when the
NGX provider stops finding prices. It prints, for each candidate URL, the HTTP
status, the content type and either the JSON keys of the first row or the
first few hundred characters of the body.
"""
from __future__ import annotations

import json
import socket

import requests

from .ngx import USER_AGENT

CANDIDATES = [
    "https://doclib.ngxgroup.com/REST/api/statistics/ticker/?$top=3&$skip=0&$orderby=SYMBOL",
    "https://doclib.ngxgroup.com/REST/api/statistics/equities/?$top=3&$skip=0&$orderby=SYMBOL",
    "https://doclib.ngxgroup.com/REST/api/statistics/equities?$top=3&$skip=0&$orderby=SYMBOL",
    "https://doclib.ngxgroup.com/REST/api/statistics/equity/?$top=3&$skip=0&$orderby=SYMBOL",
    "https://doclib.ngxgroup.com/REST/api/statistics/pricelist/?$top=3&$skip=0",
    "https://doclib.ngxgroup.com/REST/api/statistics/equities-price-list/?$top=3&$skip=0",
    "https://doclib.ngxgroup.com/REST/api/statistics/topgainers/?$top=3&$skip=0",
    "https://doclib.ngxgroup.com/REST/api/statistics/mostactive/?$top=3&$skip=0",
    "https://doclib.ngxgroup.com/REST/api/statistics/indices/?$top=3&$skip=0",
    "https://doclib.ngxgroup.com/REST/api/statistics/ticker/?$top=3&$skip=0&$orderby=SYMBOL&$filter=SYMBOL%20eq%20%27DANGCEM%27",
    "https://ngxgroup.com/exchange/data/equities-price-list/",
    "https://afx.kwayisi.org/ngx/",
    "http://afx.kwayisi.org/ngx/",
    "https://afx.kwayisi.org/ngx/dangcem.html",
    "https://african-markets.com/en/stock-markets/ngse/listed-companies",
    "https://www.african-markets.com/en/stock-markets/ngse/listed-companies",
]
HOSTS = ["doclib.ngxgroup.com", "ngxgroup.com", "afx.kwayisi.org", "african-markets.com", "www.african-markets.com"]


def _dns(host: str) -> str:
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
        return ", ".join(sorted({i[4][0] for i in infos}))
    except Exception as exc:
        return f"DNS failed: {exc}"


def _rows_text(html: str, max_rows: int = 40, needle: str | None = None) -> list[str]:
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    out = []
    for tr in soup.find_all("tr"):
        cells = [c.get_text(" ", strip=True) for c in tr.find_all(["td", "th"])]
        links = [a.get("href") for a in tr.find_all("a", href=True)]
        text = " | ".join(cells)
        if needle is None or needle.lower() in text.lower():
            out.append(text[:300] + (f"   -> {links[0]}" if links else ""))
        if len(out) >= max_rows:
            break
    return out


def deep_probe(timeout: int = 25) -> None:
    """Print table layouts of the reachable HTML sources so a parser can be written."""
    hdr = {"User-Agent": USER_AGENT, "Accept": "*/*", "Accept-Encoding": "gzip, deflate"}
    print("== african-markets listed companies: header rows and Dangote/MTN rows")
    base = "https://www.african-markets.com"
    try:
        r = requests.get(base + "/en/stock-markets/ngse/listed-companies", headers=hdr, timeout=timeout)
        print("status", r.status_code, "bytes", len(r.content))
        for line in _rows_text(r.text, 6):
            print("  ", line)
        hits = _rows_text(r.text, 6, "DANGOTE") + _rows_text(r.text, 4, "MTN")
        for line in hits:
            print("  ", line)
        link = None
        for line in hits:
            if "-> " in line:
                link = line.split("-> ")[-1].strip()
                break
        if link:
            url = link if link.startswith("http") else base + link
            print("\n== company page:", url)
            r2 = requests.get(url, headers=hdr, timeout=timeout)
            print("status", r2.status_code, "bytes", len(r2.content))
            for line in _rows_text(r2.text, 60):
                print("  ", line)
            import re
            txt = " ".join(r2.text.split())
            for key in ("P/E", "Dividend", "52", "Market Cap", "Shares"):
                m = re.search(re.escape(key), txt)
                if m:
                    print(f"  ctx[{key}]:", txt[max(0, m.start() - 150): m.start() + 250].replace("<", "‹"))
    except Exception as exc:
        print("african-markets failed:", exc)

    print("\n== ngxgroup price-list page (brotli aware): doclib links + script hints")
    try:
        r = requests.get("https://ngxgroup.com/exchange/data/equities-price-list/",
                         headers={**hdr, "Accept-Encoding": "gzip, deflate, br"}, timeout=timeout)
        print("status", r.status_code, "encoding", r.headers.get("content-encoding"), "bytes", len(r.content))
        body = r.text
        import re
        for m in sorted(set(re.findall(r"https?://doclib\.ngxgroup\.com[^\"' <>\\]+", body)))[:30]:
            print("  doclib link:", m)
        for m in sorted(set(re.findall(r"statistics/[A-Za-z0-9_\-]+", body)))[:30]:
            print("  statistics path:", m)
        for m in re.findall(r"[A-Za-z0-9_./-]+\.js", body)[:40]:
            if "ngx" in m.lower() or "price" in m.lower() or "stat" in m.lower():
                print("  script:", m)
    except Exception as exc:
        print("ngxgroup page failed:", exc)

    print("\n== NGX ticker feed: full row count and non-equity ticker types")
    try:
        r = requests.get("https://doclib.ngxgroup.com/REST/api/statistics/ticker/?$top=2000&$skip=0&$orderby=SYMBOL",
                         headers=hdr, timeout=timeout)
        data = r.json()
        types = {}
        for row in data:
            types[row.get("TickerType")] = types.get(row.get("TickerType"), 0) + 1
        print("rows", len(data), "types", types)
        print("sample keys:", sorted({k for row in data[:50] for k in row.keys()}))
        for sym in ("DANGCEM", "MTNN", "GTCO", "ZENITHBANK", "SEPLAT", "AIRTELAFRI", "BUAFOODS", "TOTALENERGIES", "FIRSTHOLDCO", "NB"):
            hit = [row for row in data if str(row.get("SYMBOL", "")).strip().upper() == sym]
            print("  ", sym, hit[0] if hit else "NOT FOUND")
    except Exception as exc:
        print("ticker feed failed:", exc)


def probe(extra_urls: list[str] | None = None, timeout: int = 20) -> None:
    print("== DNS")
    for h in HOSTS:
        print(f"{h}: {_dns(h)}")
    print("\n== URLs")
    for url in CANDIDATES + list(extra_urls or []):
        print(f"\n--- {url}")
        try:
            r = requests.get(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"}, timeout=timeout)
            ctype = r.headers.get("content-type", "")
            print(f"status {r.status_code}  content-type {ctype}  bytes {len(r.content)}")
            body = r.text
            if "json" in ctype or body.lstrip().startswith(("[", "{")):
                try:
                    data = r.json()
                    if isinstance(data, dict):
                        print("dict keys:", list(data.keys())[:20])
                        for k in ("value", "data", "items", "d"):
                            if isinstance(data.get(k), list):
                                data = data[k]
                                break
                    if isinstance(data, list):
                        print("rows:", len(data))
                        if data and isinstance(data[0], dict):
                            print("first row:", json.dumps(data[0], default=str)[:900])
                    continue
                except Exception as exc:
                    print("json parse failed:", exc)
            snippet = " ".join(body.split())[:500]
            print("body:", snippet)
            if "ngxgroup.com/exchange" in url:
                import re
                for m in sorted(set(re.findall(r"https?://doclib\.ngxgroup\.com[^\"' <>]+", body)))[:20]:
                    print("  doclib link:", m)
        except Exception as exc:
            print("request failed:", exc)
    print("\n== Yahoo Finance suffix test for NGX symbols")
    try:
        import yfinance as yf
        for sym in ("DANGCEM.LG", "DANGCEM.NG", "MTNN.LG", "GTCO.LG", "DANGCEM.NSE"):
            try:
                h = yf.download(sym, period="5d", progress=False)
                print(sym, "rows", 0 if h is None else len(h))
            except Exception as exc:
                print(sym, "failed", exc)
    except Exception as exc:
        print("yfinance unavailable:", exc)
