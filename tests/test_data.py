import numpy as np
import pandas as pd

from stockselector.data.base import FUNDAMENTAL_COLUMNS
from stockselector.data.cache import DiskCache
from stockselector.data.ngx import import_history_csv
from stockselector.universe import load_universe


def test_universes_load():
    ngx, nyse = load_universe("NGX"), load_universe("NYSE")
    assert len(ngx) > 30 and len(nyse) > 50
    assert all(l.currency == "NGN" for l in ngx)
    assert all(l.currency == "USD" for l in nyse)
    assert len({l.symbol for l in ngx}) == len(ngx)


def test_sample_data_shape(md):
    assert md.is_sample
    assert list(md.fundamentals.columns) == FUNDAMENTAL_COLUMNS
    assert set(md.prices.columns) == set(md.fundamentals.index)
    assert md.prices.shape[0] > 400
    assert (md.fundamentals["price"] > 0).all()
    assert md.latest_fx() > 0


def test_sample_data_is_deterministic():
    from stockselector.data.sample import sample_market_data
    a, b = sample_market_data(), sample_market_data()
    pd.testing.assert_frame_equal(a.prices, b.prices)


def test_currency_conversion(md):
    ngn = md.prices_in("NGN")
    usd = md.prices_in("USD")
    fx = md.fx_usdngn.reindex(md.prices.index).ffill()
    nyse_sym = md.symbols("NYSE")[0]
    ngx_sym = md.symbols("NGX")[0]
    assert np.allclose(ngn[nyse_sym], md.prices[nyse_sym] * fx)
    assert np.allclose(usd[ngx_sym], md.prices[ngx_sym] / fx)
    assert np.allclose(ngn[ngx_sym], md.prices[ngx_sym])


def test_history_store_accumulates(tmp_path):
    cache = DiskCache(tmp_path)
    day1 = pd.DataFrame({"date": ["2026-01-05"] * 2, "symbol": ["A", "B"], "close": [1.0, 2.0]})
    day2 = pd.DataFrame({"date": ["2026-01-06"] * 2, "symbol": ["A", "B"], "close": [1.1, 2.2]})
    cache.append_history("h", day1)
    panel = cache.append_history("h", day2)
    assert panel.shape == (2, 2)
    # re-appending the same day overwrites instead of duplicating
    panel = cache.append_history("h", day2.assign(close=[1.2, 2.3]))
    assert panel.shape == (2, 2) and panel.loc["2026-01-06", "A"] == 1.2


def test_import_history_wide_and_long(tmp_path):
    wide = tmp_path / "w.csv"
    wide.write_text("Date,DANGCEM,MTNN\n2026-01-05,400,250\n2026-01-06,401,251\n")
    long = import_history_csv(str(wide))
    assert set(long["symbol"]) == {"DANGCEM", "MTNN"} and len(long) == 4
    lng = tmp_path / "l.csv"
    lng.write_text("date,symbol,close\n2026-01-05,gtco,50\n")
    out = import_history_csv(str(lng))
    assert out.iloc[0]["symbol"] == "GTCO" and out.iloc[0]["close"] == 50
