"""Crypto trading system.

Built to ``crypto/SPEC.md``. The layer packages under :mod:`tradesys.layers`
map one-to-one onto the seven layers of SPEC section 3.1, and the import rules
of SPEC section 3.5 are enforced by ``tests/test_import_graph.py``:

* ``l3_strategy`` may not import ``adapters``  - strategies cannot reach a venue.
* ``l5_risk`` may not import ``l3_strategy``   - risk cannot depend on what a
  strategy wants.

Nothing here is investment advice.
"""

__version__ = "0.1.0"
