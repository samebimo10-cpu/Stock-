"""The seven layers of SPEC section 3.1.

Import rules enforced by ``tests/test_import_graph.py`` (SPEC section 3.5):

* ``l3_strategy`` may not import ``adapters``
* ``l5_risk`` may not import ``l3_strategy``
"""
