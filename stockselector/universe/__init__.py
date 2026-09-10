"""Stock universes: which symbols are screened on each exchange."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml

_HERE = Path(__file__).parent


@dataclass(frozen=True)
class Listing:
    symbol: str
    name: str
    sector: str
    exchange: str
    currency: str
    #: Alternative codes other data sources may use for the same stock.
    aliases: tuple[str, ...] = ()

    @property
    def codes(self) -> tuple[str, ...]:
        return (self.symbol, *self.aliases)


def load_universe(exchange: str, path: str | Path | None = None) -> list[Listing]:
    """Load the listing table for ``exchange`` ("NGX" or "NYSE").

    ``path`` overrides the bundled YAML so users can screen their own list.
    """
    exchange = exchange.upper()
    file = Path(path) if path else _HERE / f"{exchange.lower()}.yaml"
    with open(file, "r", encoding="utf-8") as fh:
        doc = yaml.safe_load(fh)
    ex = str(doc.get("exchange", exchange)).upper()
    ccy = str(doc.get("currency", "USD" if ex == "NYSE" else "NGN")).upper()
    out: list[Listing] = []
    seen: set[str] = set()
    for row in doc.get("stocks", []):
        sym = str(row["symbol"]).upper().strip()
        if sym in seen:
            continue
        seen.add(sym)
        aliases = tuple(str(a).upper().strip() for a in (row.get("aliases") or []))
        out.append(Listing(sym, str(row.get("name", sym)), str(row.get("sector", "Unknown")), ex, ccy, aliases))
    return out
