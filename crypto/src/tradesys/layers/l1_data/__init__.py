"""L1 - ingestion, normalisation, storage.

Data quality is the highest-leverage investment in the system. A brilliant
strategy on bad data is a losing strategy, and it looks like a winning one
right up until it trades.
"""

from .book import LocalBook
from .quality import QualityMonitor, QualityGrade, DailyQualityReport, THRESHOLDS

__all__ = ["LocalBook", "QualityMonitor", "QualityGrade", "DailyQualityReport", "THRESHOLDS"]
