from sqlalchemy import String, Integer, DateTime, Enum, ForeignKey, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime, timezone
import enum
from database import Base


class ExecStatus(str, enum.Enum):
    running = "running"
    success = "success"
    failed = "failed"


class LayerName(str, enum.Enum):
    raw = "raw"
    dwd = "dwd"
    dws = "dws"
    ads = "ads"


class Execution(Base):
    __tablename__ = "executions"
    __table_args__ = {"schema": "etl_meta"}

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    data_source_id: Mapped[int] = mapped_column(
        ForeignKey("etl_meta.data_sources.id", ondelete="CASCADE"), nullable=False
    )
    layer_from: Mapped[LayerName] = mapped_column(Enum(LayerName), nullable=False)
    layer_to: Mapped[LayerName] = mapped_column(Enum(LayerName), nullable=False)
    status: Mapped[ExecStatus] = mapped_column(
        Enum(ExecStatus), default=ExecStatus.running
    )
    src_file: Mapped[str | None] = mapped_column(String(500))
    rows_success: Mapped[int] = mapped_column(Integer, default=0)
    rows_failed: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text)
    error_sample: Mapped[list | None] = mapped_column(JSON)
    started_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("etl_meta.users.id"))
