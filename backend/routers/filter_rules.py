# Row-level filter rules applied during Raw→DWD execution.
# Rules are stored in etl_meta.filter_rules and read by etl_service._build_where().
# PUT replaces all rules for a datasource atomically (delete-all + re-insert).
# Operator and logic enums use values_callable so the DB stores "eq"/"and" (the .value),
# not "eq"/"AND" (the .name) — see models/filter_rule.py for the fix.
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import DataSource, FilterRule
from models.filter_rule import FilterLogic, FilterOperator
from routers.auth import get_current_user

router = APIRouter(prefix="/api/v1/datasources", tags=["filter-rules"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class FilterRuleItem(BaseModel):
    field_name: str
    operator: FilterOperator
    value: Optional[str] = None
    logic: FilterLogic = FilterLogic.AND
    sort_order: int = 0


class FilterRuleOut(BaseModel):
    id: int
    data_source_id: int
    field_name: str
    operator: FilterOperator
    value: Optional[str]
    logic: FilterLogic
    sort_order: int

    model_config = {"from_attributes": True}


class BulkFilterRequest(BaseModel):
    rules: list[FilterRuleItem]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_ds(ds_id: int, db: Session) -> DataSource:
    ds = db.get(DataSource, ds_id)
    if not ds:
        raise HTTPException(status_code=404, detail="数据源不存在")
    return ds


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/{ds_id}/filter-rules", response_model=list[FilterRuleOut])
def list_filter_rules(
    ds_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)
):
    _get_ds(ds_id, db)
    return (
        db.query(FilterRule)
        .filter(FilterRule.data_source_id == ds_id)
        .order_by(FilterRule.sort_order, FilterRule.id)
        .all()
    )


@router.put("/{ds_id}/filter-rules", response_model=list[FilterRuleOut])
def bulk_save_filter_rules(
    ds_id: int,
    body: BulkFilterRequest,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    _get_ds(ds_id, db)
    db.query(FilterRule).filter(FilterRule.data_source_id == ds_id).delete()
    saved = []
    for i, item in enumerate(body.rules):
        r = FilterRule(
            data_source_id=ds_id,
            field_name=item.field_name,
            operator=item.operator,
            value=item.value or None,
            logic=item.logic,
            sort_order=item.sort_order if item.sort_order else i,
        )
        db.add(r)
        saved.append(r)
    db.commit()
    for r in saved:
        db.refresh(r)
    return saved
