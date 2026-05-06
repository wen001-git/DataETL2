from sqlalchemy import String, DateTime, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime, timezone
from database import Base


class AggRule(Base):
    """DWD -> DWS aggregation rule."""
    __tablename__ = "agg_rules"
    __table_args__ = {"schema": "etl_meta"}

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    data_source_id: Mapped[int] = mapped_column(
        ForeignKey("etl_meta.data_sources.id", ondelete="CASCADE"), nullable=False
    )
    src_dwd_table: Mapped[str] = mapped_column(String(100), nullable=False)
    target_dws_table: Mapped[str] = mapped_column(String(100), nullable=False)
    # JSON list of field names for GROUP BY
    group_by_fields: Mapped[list] = mapped_column(JSON, default=list)
    # JSON list of {"field": "amount", "func": "SUM", "alias": "total_amount"}
    agg_functions: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
