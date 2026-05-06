# Dashboard and ChartConfig models.
# A Dashboard groups one or more ChartConfigs; each chart reads from a datasource's
# ADS layer at query time (no cached copy — always reflects latest execution result).
# chart_type drives the DuckDB aggregation query built in routers/dashboards.py.
import enum
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class ChartType(str, enum.Enum):
    line = "line"
    bar = "bar"
    kpi = "kpi"
    table = "table"


class Dashboard(Base):
    __tablename__ = "dashboards"
    __table_args__ = {"schema": "etl_meta"}

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    charts: Mapped[list["ChartConfig"]] = relationship(
        "ChartConfig", cascade="all, delete-orphan", order_by="ChartConfig.sort_order"
    )


class ChartConfig(Base):
    __tablename__ = "chart_configs"
    __table_args__ = {"schema": "etl_meta"}

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    dashboard_id: Mapped[int] = mapped_column(
        ForeignKey("etl_meta.dashboards.id", ondelete="CASCADE"), nullable=False
    )
    data_source_id: Mapped[int] = mapped_column(
        ForeignKey("etl_meta.data_sources.id", ondelete="CASCADE"), nullable=False
    )
    chart_type: Mapped[ChartType] = mapped_column(
        Enum(ChartType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    # config_json keys: title, x_field, y_field, agg_func, filter_expr (optional)
    config_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
