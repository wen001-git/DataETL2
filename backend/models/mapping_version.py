# MappingVersion stores a point-in-time snapshot of field mappings for a datasource.
# Written every time mappings are saved (PUT /datasources/{id}/mappings).
# Used by the config lineage API to show history and compute diffs between versions.
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, JSON
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class MappingVersion(Base):
    __tablename__ = "mapping_versions"
    __table_args__ = {"schema": "etl_meta"}

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    data_source_id: Mapped[int] = mapped_column(
        ForeignKey("etl_meta.data_sources.id", ondelete="CASCADE"), nullable=False
    )
    # snapshot_json: {"target_dwd_table": str, "mappings": [{src_field, dst_field, dst_type, skip, default_value, sort_order}]}
    snapshot_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    saved_by: Mapped[int] = mapped_column(Integer, nullable=False)
    saved_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
