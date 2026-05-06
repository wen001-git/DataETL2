# ADS output rule configuration + CSV/Excel export endpoint (one record per datasource).
# PUT is an upsert (same pattern as agg_rules).
# selected_fields=[] means "output all columns"; non-empty list restricts to those fields.
# Export reads directly from etl_ads.<target_ads_table> — run DWS→ADS first.
# CSV uses UTF-8 BOM (utf-8-sig) so Excel opens it correctly without a manual import step.
import io
from typing import Optional

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import engine, get_db
from models import DataSource
from models.ads_rule import AdsRule
from routers.auth import get_current_user

router = APIRouter(prefix="/api/v1/datasources", tags=["ads_rules"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class OrderByItem(BaseModel):
    field: str
    direction: str = "ASC"   # ASC | DESC


class AdsRuleIn(BaseModel):
    src_dws_table: str
    target_ads_table: str
    selected_fields: list[str] = []
    order_by: list[OrderByItem] = []
    limit_rows: Optional[int] = None


class AdsRuleOut(BaseModel):
    id: int
    data_source_id: int
    src_dws_table: str
    target_ads_table: str
    selected_fields: list
    order_by: list
    limit_rows: Optional[int]

    model_config = {"from_attributes": True}


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/{ds_id}/ads-rules")
def get_ads_rule(
    ds_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    ds = db.get(DataSource, ds_id)
    if not ds:
        raise HTTPException(status_code=404, detail="数据源不存在")
    rule = db.query(AdsRule).filter(AdsRule.data_source_id == ds_id).first()
    if not rule:
        return None
    return AdsRuleOut.model_validate(rule)


@router.put("/{ds_id}/ads-rules", response_model=AdsRuleOut)
def upsert_ads_rule(
    ds_id: int,
    body: AdsRuleIn,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    ds = db.get(DataSource, ds_id)
    if not ds:
        raise HTTPException(status_code=404, detail="数据源不存在")

    rule = db.query(AdsRule).filter(AdsRule.data_source_id == ds_id).first()
    order_list = [item.model_dump() for item in body.order_by]

    if rule:
        rule.src_dws_table = body.src_dws_table
        rule.target_ads_table = body.target_ads_table
        rule.selected_fields = body.selected_fields
        rule.order_by = order_list
        rule.limit_rows = body.limit_rows
    else:
        rule = AdsRule(
            data_source_id=ds_id,
            src_dws_table=body.src_dws_table,
            target_ads_table=body.target_ads_table,
            selected_fields=body.selected_fields,
            order_by=order_list,
            limit_rows=body.limit_rows,
        )
        db.add(rule)

    db.commit()
    db.refresh(rule)
    return AdsRuleOut.model_validate(rule)


@router.get("/{ds_id}/export")
def export_ads(
    ds_id: int,
    format: str = Query(default="csv", pattern="^(csv|excel)$"),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    if not db.get(DataSource, ds_id):
        raise HTTPException(status_code=404, detail="数据源不存在")
    rule = db.query(AdsRule).filter(AdsRule.data_source_id == ds_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="没有配置 ADS 输出规则，请先保存规则")

    try:
        with engine.connect() as conn:
            df = pd.read_sql(
                f"SELECT * FROM `etl_ads`.`{rule.target_ads_table}`", conn
            )
    except Exception:
        raise HTTPException(
            status_code=404,
            detail=f"ADS 表 '{rule.target_ads_table}' 不存在，请先执行 DWS→ADS",
        )

    fname_base = rule.target_ads_table

    if format == "excel":
        buf = io.BytesIO()
        df.to_excel(buf, index=False, engine="openpyxl")
        buf.seek(0)
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{fname_base}.xlsx"'},
        )
    else:
        csv_bytes = df.to_csv(index=False).encode("utf-8-sig")
        return StreamingResponse(
            io.BytesIO(csv_bytes),
            media_type="text/csv; charset=utf-8-sig",
            headers={"Content-Disposition": f'attachment; filename="{fname_base}.csv"'},
        )
