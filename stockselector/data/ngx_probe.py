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
