"""Dashboards as code, and the metrics they point at (SPEC section 10.3).

A dashboard edited in a web UI drifts from the system within a release, and
nobody notices until the panel they are staring at during an incident measures
something that no longer exists.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
import yaml

from tradesys.demo import build_cycling_events, build_pipeline
from tradesys.session import SessionConfig, TradingSession

ROOT = Path(__file__).resolve().parents[1]
SPEC = yaml.safe_load((ROOT / "ops" / "dashboards" / "dashboards.yaml").read_text())
DASHBOARDS = SPEC["dashboards"]

#: SPEC section 10.3 names these five.
REQUIRED = ("trading", "risk", "execution", "data", "system")


def live_metrics() -> set:
    """Every metric a real session actually publishes."""
    pipeline, adapters, _ = build_pipeline()
    clock = {"now": 1_700_000_000_000_000_000}
    session = TradingSession(
        pipeline, adapters,
        config=SessionConfig(reconcile_interval_ns=8 * 3600 * 10**9,
                             heartbeat_interval_ns=3600 * 10**9, strategy_settle_ns=0),
        clock=lambda: clock["now"],
    )

    async def drive():
        await session.start()
        for event in build_cycling_events()[:400]:
            clock["now"] = event.emitted_at
            for venue in adapters.values():
                venue.apply_market_event(event)
            await session.on_event(event)
            for venue in adapters.values():
                for fill in venue.step():
                    pipeline.on_fill(fill)

    asyncio.run(drive())
    names = set(session.metrics.snapshot())
    names |= set(session.metrics.histograms)      # panels name the base histogram
    return names


@pytest.fixture(scope="module")
def published():
    return live_metrics()


@pytest.mark.parametrize("name", REQUIRED)
def test_every_required_dashboard_exists(name):
    assert any(d["name"] == name for d in DASHBOARDS), f"no {name} dashboard"


def test_every_dashboard_has_panels():
    for dashboard in DASHBOARDS:
        assert dashboard["panels"], f"{dashboard['name']} has no panels"


def test_every_panel_points_at_a_metric_the_system_emits(published):
    """A panel pointing at a metric nobody publishes shows a flat line, and a
    flat line during an incident reads as 'fine'."""
    missing = []
    for dashboard in DASHBOARDS:
        for panel in dashboard["panels"]:
            if panel["metric"] not in published:
                missing.append(f"{dashboard['name']}/{panel['title']} -> {panel['metric']}")
    assert not missing, "panels referencing unpublished metrics:\n" + "\n".join(missing)


def test_the_risk_dashboard_is_the_primary_one():
    """The 3am screen answers one question: is money at risk right now."""
    risk = next(d for d in DASHBOARDS if d["name"] == "risk")
    assert risk.get("primary") is True
    titles = [p["title"] for p in risk["panels"]]
    assert "Kill switch" in titles


def test_the_drawdown_panel_carries_the_ladder():
    risk = next(d for d in DASHBOARDS if d["name"] == "risk")
    panel = next(p for p in risk["panels"] if "Drawdown" in p["title"])
    assert panel["thresholds"] == {"amber": 0.06, "soft": 0.08, "hard": 0.12}


def test_routing_says_what_does_not_page():
    """The discipline is in what does not page."""
    routing = SPEC["routing"]
    assert routing["P1"]["page"] is True
    assert routing["P2"]["page"] is False
    assert routing["P3"]["page"] is False


# --------------------------------------------------- post-mortems and ADRs


def test_the_postmortem_template_requires_a_test():
    """A post-mortem without a test is a story."""
    text = (ROOT / "ops" / "POSTMORTEM.md").read_text()
    assert "Mandatory" in text
    assert "would have caught it" in text
    assert "blameless" in text.lower()


def test_decision_records_exist_and_are_indexed():
    index = (ROOT / "docs" / "adr" / "README.md").read_text()
    records = sorted(p.name for p in (ROOT / "docs" / "adr").glob("0*.md"))
    assert records, "no decision records"
    for record in records:
        assert record in index, f"{record} is not in the index"


@pytest.mark.parametrize("path", sorted((ROOT / "docs" / "adr").glob("0*.md")),
                         ids=lambda p: p.stem)
def test_every_decision_record_has_context_decision_consequences(path):
    text = path.read_text()
    for heading in ("## Context", "## Decision", "## Consequences"):
        assert heading in text, f"{path.name} has no {heading}"
    assert "**Status:**" in text
