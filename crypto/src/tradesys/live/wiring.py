"""Assembling a live Binance session from credentials and a mode.

Kept separate from the runner so the runner has no opinion about where keys
come from, and separate from ``demo`` so the demo cannot accidentally reach a
real venue. The rules encoded here are the ones that are easy to state and
easy to skip at 2am:

* **Credentials come from the environment, never from an argument.** A secret
  passed on a command line is in the shell history, in ``ps`` output, and in
  any process listing a colleague runs. There is no flag to supply one.
* **Testnet is the default and production must be named.** The cost of running
  on testnet by mistake is a wasted afternoon; the other way round it is money.
* **Live mode requires the mode to be spelled out** *and* a second
  acknowledgement, because SPEC section 17.5 puts three steps before it and
  every one of them exists because something was discovered during it.
* **Keys go through the signing service**, which refuses withdrawal endpoints
  regardless of what the key permits and refuses to hold a key that claims
  withdrawal permission at all.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

from ..adapters.binance import BinanceAdapter, BinanceEndpoints, HmacSigner
from ..adapters.sim import SimAdapter
from ..core.types import Decimal as Dec, dec
from ..layers.l3_strategy.base import StrategyState
from ..layers.l3_strategy.funding_carry import FundingCarry, FundingCarryParams
from ..layers.l5_risk.service import RiskService
from ..layers.l5_risk.state import PortfolioState
from ..layers.l6_execution.executor import Executor
from ..pipeline import Pipeline
from ..security.signer import SigningService
from ..session import SessionConfig, TradingSession
from .binance_live import BinanceFeed, StreamSpec
from .runner import LiveConfig, LiveRunner, Mode
from .streams import WebsocketSource

__all__ = ["LiveCredentials", "credentials_from_env", "build_binance_live",
           "SPOT", "PERP"]

SPOT = "spot"
PERP = "perp"

_KEY_VAR = "BINANCE_API_KEY"
_SECRET_VAR = "BINANCE_API_SECRET"


class MissingCredentials(RuntimeError):
    """Raised rather than falling back to an unauthenticated adapter.

    An unauthenticated adapter reads market data happily and fails only when
    it tries to trade, which is the worst possible moment to discover the
    configuration is wrong.
    """


@dataclass(frozen=True)
class LiveCredentials:
    api_key: str
    secret: str

    def __repr__(self) -> str:                    # pragma: no cover - trivial
        return "LiveCredentials(api_key=<redacted>, secret=<redacted>)"


def credentials_from_env(required: bool = True) -> Optional[LiveCredentials]:
    """Read credentials from the environment. Never from a file in the repo.

    Returns ``None`` when they are absent and ``required`` is false, which is
    the read-only market-data case: public streams need no key at all, and
    running that path without one is a genuine safety improvement rather than a
    degraded mode.
    """
    key, secret = os.environ.get(_KEY_VAR, ""), os.environ.get(_SECRET_VAR, "")
    if key and secret:
        return LiveCredentials(key, secret)
    if required:
        raise MissingCredentials(
            f"set {_KEY_VAR} and {_SECRET_VAR} in the environment. They are read "
            "from there and nowhere else: a secret passed as an argument is in "
            "the shell history and in every process listing on the box. The key "
            "must have trading enabled and withdrawals DISABLED, and must be "
            "IP-allowlisted (SPEC section 13.2)."
        )
    return None


def build_binance_live(
    symbols: Sequence[str] = ("BTCUSDT",),
    *,
    mode: str = Mode.SHADOW,
    testnet: bool = True,
    futures: bool = False,
    equity: str = "10000",
    base_notional: str = "200",
    confirm_live: bool = False,
    credentials: Optional[LiveCredentials] = None,
    archive_root: Optional[str] = None,
    liquidations: bool = False,
) -> Tuple[TradingSession, BinanceFeed, LiveRunner]:
    """Wire adapter, feed, pipeline, session and runner for one venue.

    Returns all three because a caller wants the session for its status, the
    feed for its statistics, and the runner to drive it. Handing back only the
    runner would force every caller to reach through it.
    """
    if mode not in Mode.ALL:
        raise ValueError(f"unknown mode {mode!r}; one of {Mode.ALL}")
    if mode == Mode.LIVE and not testnet and not confirm_live:
        raise PermissionError(
            "refusing to place real orders on production without an explicit "
            "acknowledgement. SPEC section 17.5 puts testnet, production "
            "read-only and shadow ahead of this, each for several weeks, and "
            "neither strategy in this repository has passed validation "
            "(`tradesys validate` exits 1). Pass confirm_live=True only if you "
            "have actually done those steps."
        )

    endpoints = (BinanceEndpoints.futures_testnet() if (futures and testnet) else
                 BinanceEndpoints.futures_production() if futures else
                 BinanceEndpoints.spot_testnet() if testnet else
                 BinanceEndpoints.spot_production())

    creds = credentials
    if creds is None:
        creds = credentials_from_env(required=mode != Mode.READ_ONLY)

    signer = None
    if creds is not None:
        service = SigningService()
        environment = "testnet" if testnet else "production"
        # The signing service is the thing that refuses to move funds. Handing
        # the raw secret straight to the adapter would work and would remove
        # the only control between a compromised process and a withdrawal.
        service.add_key("live", "tradesys", environment, creds.secret,
                        permissions=("spot", "trade"))
        signer = service.as_signer("tradesys", environment, "/api/v3/order")

    adapter = BinanceAdapter(endpoints, api_key=creds.api_key if creds else "",
                             signer=signer)
    venue = adapter.name
    feed = BinanceFeed(venue, adapter)

    trading_adapter = _trading_adapter(adapter, mode, venue)
    # Positions, fills and reconcilers are all keyed by venue name. An adapter
    # whose name disagrees with its key silently splits the books in two and
    # reconciliation then compares two empty halves and passes.
    assert trading_adapter.name == venue, (
        f"trading adapter is named {trading_adapter.name!r} but keyed as {venue!r}"
    )
    adapters = {venue: trading_adapter}

    state = PortfolioState(cash=dec(equity))
    state.median_order_notional = dec(base_notional)
    state.mark()
    from ..demo import default_limits

    risk = RiskService(default_limits(), state)
    executor = Executor(adapters)

    # One strategy, unhedged-by-configuration is refused by the strategy
    # itself, so a single-venue live run gets the carry strategy only when a
    # spot venue is present. On one venue it will decline every signal, which
    # is the correct behaviour and worth seeing rather than working around.
    strategy = FundingCarry(params=FundingCarryParams(
        base_notional=dec(base_notional), perp_venue=venue,
        spot_venue=venue if futures else "",
    ))
    strategy.health.state = StrategyState.PAPER

    pipeline = Pipeline([strategy], risk, executor)
    session = TradingSession(pipeline, adapters,
                             config=SessionConfig(reconcile_interval_ns=5_000_000_000))

    specs = [StreamSpec(s, mark=futures, liquidations=liquidations and futures)
             for s in symbols]
    from .binance_live import market_stream_url, user_stream_url

    def market_source() -> WebsocketSource:
        return WebsocketSource(lambda: market_stream_url(endpoints.ws, specs),
                               name=f"{venue}-market")

    user_source = None
    keys = None
    if mode in (Mode.LIVE,) and creds is not None:
        keys = adapter

        def user_source(token: str) -> WebsocketSource:      # noqa: F811
            return WebsocketSource(lambda: user_stream_url(endpoints.ws, token),
                                   name=f"{venue}-user")

    writer = None
    if archive_root:
        from .capture import ArchiveWriter, CaptureConfig

        writer = ArchiveWriter(venue, CaptureConfig(root=Path(archive_root)))

    runner = LiveRunner(session, feed, market_source, user_source=user_source,
                        keys=keys, config=LiveConfig(mode=mode), writer=writer)
    return session, feed, runner


def _trading_adapter(adapter: BinanceAdapter, mode: str, venue: str):
    """Pick what receives the orders. The only place mode changes behaviour.

    Deliberately one function: if mode were consulted in three places, the
    fourth place that forgot to consult it would be the one that sent a real
    order during a shadow run.
    """
    if mode == Mode.LIVE:
        return adapter
    if mode == Mode.PAPER:
        # Filters come from the real venue at startup (the session's gate
        # caches them), so the simulator rounds the way Binance rounds.
        sim = SimAdapter(order_latency_ns=25_000_000, fill_latency_ns=15_000_000)
        sim.name = venue
        return sim
    from .shadow import ShadowVenue

    return ShadowVenue(adapter)
