# DWS aggregation rule configuration (one record per datasource).
# PUT is an upsert: update if a record exists, insert otherwise.
# agg_functions is a plain JSON list so there is no Enum name/value issue here.
# The rule is consumed by services/dws_service.py during DWD→DWS execution.
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import DataSource
from models.agg_rule import AggRule
from routers.auth import get_current_user

router = APIRouter(prefix="/api/v1/datasources", tags=["agg_rules"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class AggFuncItem(BaseModel):
    field: str
    func: str   # SUM | COUNT | AVG | MAX | MIN | COUNT_DISTINCT
    alias: str


class AggRuleIn(BaseModel):
    src_dwd_table: str
    target_dws_table: str
    group_by_fields: list[str] = []
    agg_functions: list[AggFuncItem] = []


class AggRuleOut(BaseModel):
    id: int
    data_source_id: int
    src_dwd_table: str
    target_dws_table: str
    group_by_fields: list
    agg_functions: list

    model_config = {"from_attributes": True}


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/{ds_id}/agg-rules")
def get_agg_rule(
    ds_id: int,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    ds = db.get(DataSource, ds_id)
    if not ds:
        raise HTTPException(status_code=404, detail="数据源不存在")
    rule = db.query(AggRule).filter(AggRule.data_source_id == ds_id).first()
    if not rule:
        return None
    return AggRuleOut.model_validate(rule)


@router.put("/{ds_id}/agg-rules", response_model=AggRuleOut)
def upsert_agg_rule(
    ds_id: int,
    body: AggRuleIn,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    ds = db.get(DataSource, ds_id)
    if not ds:
        raise HTTPException(status_code=404, detail="数据源不存在")

    rule = db.query(AggRule).filter(AggRule.data_source_id == ds_id).first()
    agg_funcs = [item.model_dump() for item in body.agg_functions]

    if rule:
        rule.src_dwd_table = body.src_dwd_table
        rule.target_dws_table = body.target_dws_table
        rule.group_by_fields = body.group_by_fields
        rule.agg_functions = agg_funcs
    else:
        rule = AggRule(
            data_source_id=ds_id,
            src_dwd_table=body.src_dwd_table,
            target_dws_table=body.target_dws_table,
            group_by_fields=body.group_by_fields,
            agg_functions=agg_funcs,
        )
        db.add(rule)

    db.commit()
    db.refresh(rule)
    return AggRuleOut.model_validate(rule)
