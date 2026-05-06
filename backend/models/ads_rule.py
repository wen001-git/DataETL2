from sqlalchemy import String, Integer, DateTime, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime, timezone
from database import Base


class AdsRule(Base):
    """DWS -> ADS output rule."""
    __tablename__ = "ads_rules"
    __table_args__ = {"schema": "etl_meta"}

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    data_source_id: Mapped[int] = mapped_column(
        ForeignKey("etl_meta.data_sources.id", ondelete="CASCADE"), nullable=False
    )
    src_dws_table: Mapped[str] = mapped_column(String(100), nullable=False)
    target_ads_table: Mapped[str] = mapped_column(String(100), nullable=False)
    # JSON list of field names to include (empty = all)
    selected_fields: Mapped[list] = mapped_column(JSON, default=list)
    # JSON list of {"field": "date", "direction": "DESC"}
    order_by: Mapped[list] = mapped_column(JSON, default=list)
    limit_rows: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
