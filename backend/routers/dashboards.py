# Dashboard CRUD + chart data query.
# Charts are rendered client-side from data fetched here; no chart images are stored.
# Data query flow: MySQL etl_ads → pandas DataFrame → DuckDB in-memory → {columns, rows}.
# This matches the pattern used by ads_service.py to keep DuckDB usage consistent.
from typing import Optional

import duckdb
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import engine, get_db
from models.ads_rule import AdsRule
from models.dashboard import ChartConfig, ChartType, Dashboard
from routers.auth import get_current_user

router = APIRouter(prefix="/api/v1/dashboards", tags=["dashboards"])

_ALLOWED_AGG = {"SUM", "AVG", "COUNT", "MAX", "MIN"}


# ── Schemas ───────────────────────────────────────────────────────────────────

class DashboardBody(BaseModel):
    name: str
    description: Optional[str] = None


class ChartConfigIn(BaseModel):
    data_source_id: int
    chart_type: ChartType
    config_json: dict  # title, x_field, y_field, agg_func, filter_expr
    sort_order: int = 0


# ── Dashboard CRUD ────────────────────────────────────────────────────────────

@router.get("")
def list_dashboards(db: Session = Depends(get_db), _=Depends(get_current_user)):
    dashboards = db.query(Dashboard).order_by(Dashboard.created_at.desc()).all()
    return [
        {
            "id": d.id,
            "name": d.name,
            "description": d.description,
            "chart_count": len(d.charts),
        }
        for d in dashboards
    ]


@router.post("", status_code=201)
def create_dashboard(
    body: DashboardBody,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    d = Dashboard(name=body.name, description=body.description, created_by=current_user.id)
    db.add(d)
    db.commit()
    db.refresh(d)
    return {"id": d.id, "name": d.name, "description": d.description, "chart_count": 0}


@router.get("/{dashboard_id}")
def get_dashboard(dashboard_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    d = db.get(Dashboard, dashboard_id)
    if not d:
        raise HTTPException(status_code=404, detail="仪表盘不存在")
    return {
        "id": d.id,
        "name": d.name,
        "description": d.description,
        "charts": [
            {
                "id": c.id,
                "data_source_id": c.data_source_id,
                "chart_type": c.chart_type,
                "config_json": c.config_json,
                "sort_order": c.sort_order,
            }
            for c in d.charts
        ],
    }


@router.put("/{dashboard_id}")
def update_dashboard(
    dashboard_id: int,
    body: DashboardBody,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    d = db.get(Dashboard, dashboard_id)
    if not d:
        raise HTTPException(status_code=404, detail="仪表盘不存在")
    d.name = body.name
    d.description = body.description
    db.commit()
    db.refresh(d)
    return {"id": d.id, "name": d.name, "description": d.description}


@router.delete("/{dashboard_id}", status_code=204)
def delete_dashboard(
    dashboard_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)
):
    d = db.get(Dashboard, dashboard_id)
    if not d:
        raise HTTPException(status_code=404, detail="仪表盘不存在")
    db.delete(d)
    db.commit()


# ── Chart CRUD ────────────────────────────────────────────────────────────────

@router.post("/{dashboard_id}/charts", status_code=201)
def add_chart(
    dashboard_id: int,
    body: ChartConfigIn,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    if not db.get(Dashboard, dashboard_id):
        raise HTTPException(status_code=404, detail="仪表盘不存在")
    c = ChartConfig(
        dashboard_id=dashboard_id,
        data_source_id=body.data_source_id,
        chart_type=body.chart_type,
        config_json=body.config_json,
        sort_order=body.sort_order,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return {
        "id": c.id,
        "dashboard_id": c.dashboard_id,
        "data_source_id": c.data_source_id,
        "chart_type": c.chart_type,
        "config_json": c.config_json,
        "sort_order": c.sort_order,
    }


@router.put("/{dashboard_id}/charts/{chart_id}")
def update_chart(
    dashboard_id: int,
    chart_id: int,
    body: ChartConfigIn,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    c = db.get(ChartConfig, chart_id)
    if not c or c.dashboard_id != dashboard_id:
        raise HTTPException(status_code=404, detail="图表不存在")
    c.data_source_id = body.data_source_id
    c.chart_type = body.chart_type
    c.config_json = body.config_json
    c.sort_order = body.sort_order
    db.commit()
    db.refresh(c)
    return {
        "id": c.id,
        "data_source_id": c.data_source_id,
        "chart_type": c.chart_type,
        "config_json": c.config_json,
        "sort_order": c.sort_order,
    }


@router.delete("/{dashboard_id}/charts/{chart_id}", status_code=204)
def delete_chart(
    dashboard_id: int,
    chart_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    c = db.get(ChartConfig, chart_id)
    if not c or c.dashboard_id != dashboard_id:
        raise HTTPException(status_code=404, detail="图表不存在")
    db.delete(c)
    db.commit()


# ── Chart data query ──────────────────────────────────────────────────────────

@router.get("/{dashboard_id}/charts/{chart_id}/data")
def get_chart_data(
    dashboard_id: int,
    chart_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    c = db.get(ChartConfig, chart_id)
    if not c or c.dashboard_id != dashboard_id:
        raise HTTPException(status_code=404, detail="图表不存在")

    ads_rule = db.query(AdsRule).filter(AdsRule.data_source_id == c.data_source_id).first()
    if not ads_rule or not ads_rule.target_ads_table:
        raise HTTPException(
            status_code=404,
            detail="该数据源尚未配置 ADS 输出规则，请先在「ADS 输出规则」页配置并执行 DWS→ADS",
        )

    cfg = c.config_json
    chart_type = c.chart_type.value
    x_field = cfg.get("x_field") or ""
    y_field = cfg.get("y_field") or ""
    agg_func = (cfg.get("agg_func") or "SUM").upper()
    filter_expr = cfg.get("filter_expr") or ""

    if agg_func not in _ALLOWED_AGG:
        raise HTTPException(status_code=400, detail=f"不支持的聚合函数: {agg_func}")

    try:
        with engine.connect() as conn:
            df = pd.read_sql(
                f"SELECT * FROM `etl_ads`.`{ads_rule.target_ads_table}`", conn
            )
    except Exception as e:
        raise HTTPException(
            status_code=404, detail=f"ADS 表读取失败（请先执行 DWS→ADS）: {e}"
        )

    if df.empty:
        return {"chart_type": chart_type, "columns": [], "rows": []}

    where_clause = f"WHERE {filter_expr}" if filter_expr else ""

    try:
        con = duckdb.connect()
        con.register("ads", df)

        if chart_type == "kpi":
            if not y_field:
                raise HTTPException(status_code=400, detail="KPI 图表需要指定 y_field")
            sql = f'SELECT {agg_func}(TRY_CAST("{y_field}" AS DOUBLE)) AS value FROM ads {where_clause}'
        elif chart_type == "table":
            sql = f"SELECT * FROM ads {where_clause} LIMIT 500"
        else:
            if not x_field or not y_field:
                raise HTTPException(status_code=400, detail="折线/柱状图需要指定 x_field 和 y_field")
            sql = (
                f'SELECT "{x_field}", {agg_func}(TRY_CAST("{y_field}" AS DOUBLE)) AS value '
                f'FROM ads {where_clause} GROUP BY "{x_field}" ORDER BY "{x_field}"'
            )

        result = con.execute(sql).df()
        con.close()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"图表数据查询失败: {e}")

    return {
        "chart_type": chart_type,
        "columns": list(result.columns),
        "rows": result.to_dict(orient="records"),
    }
