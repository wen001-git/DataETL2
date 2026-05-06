from sqlalchemy import String, Integer, Boolean, Text, DateTime, Enum, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime, timezone
import enum
from database import Base


class DstType(str, enum.Enum):
    string = "string"
    integer = "integer"
    float_ = "float"
    date = "date"
    datetime_ = "datetime"
    boolean = "boolean"


class FieldMapping(Base):
    __tablename__ = "field_mappings"
    __table_args__ = {"schema": "etl_meta"}

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    data_source_id: Mapped[int] = mapped_column(
        ForeignKey("etl_meta.data_sources.id", ondelete="CASCADE"), nullable=False
    )
    src_field: Mapped[str] = mapped_column(String(100), nullable=False)
    dst_field: Mapped[str] = mapped_column(String(100), nullable=False)
    dst_type: Mapped[DstType] = mapped_column(
        Enum(DstType, values_callable=lambda x: [e.value for e in x]),
        default=DstType.string,
    )
    default_value: Mapped[str | None] = mapped_column(String(255))
    skip: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    target_dwd_table: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
