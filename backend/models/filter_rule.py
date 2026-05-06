from sqlalchemy import String, Integer, DateTime, Enum, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime, timezone
import enum
from database import Base


class FilterOperator(str, enum.Enum):
    eq = "eq"
    ne = "ne"
    gt = "gt"
    lt = "lt"
    gte = "gte"
    lte = "lte"
    contains = "contains"
    not_contains = "not_contains"
    is_null = "is_null"
    is_not_null = "is_not_null"


class FilterLogic(str, enum.Enum):
    AND = "AND"
    OR = "OR"


class FilterRule(Base):
    __tablename__ = "filter_rules"
    __table_args__ = {"schema": "etl_meta"}

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    data_source_id: Mapped[int] = mapped_column(
        ForeignKey("etl_meta.data_sources.id", ondelete="CASCADE"), nullable=False
    )
    field_name: Mapped[str] = mapped_column(String(100), nullable=False)
    operator: Mapped[FilterOperator] = mapped_column(
        Enum(FilterOperator, values_callable=lambda x: [e.value for e in x]), nullable=False
    )
    value: Mapped[str | None] = mapped_column(String(500))
    logic: Mapped[FilterLogic] = mapped_column(
        Enum(FilterLogic, values_callable=lambda x: [e.value for e in x]),
        default=FilterLogic.AND,
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
