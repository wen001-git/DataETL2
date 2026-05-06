# Execution triggers and history.
# Each POST endpoint delegates to the matching service function and returns its dict
# directly — success or failure is encoded in the response body (not HTTP status)
# so the frontend can display detailed error messages without catching exceptions.
# Execution records in etl_meta.executions transition: running → success | failed.
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import DataSource
from models.execution import Execution, ExecStatus, LayerName
from routers.auth import get_current_user
from services.etl_service import run_raw_to_dwd
from services.dws_service import run_dwd_to_dws
from services.ads_service import run_dws_to_ads

router = APIRouter(prefix="/api/v1/datasources", tags=["executions"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class ExecutionOut(BaseModel):
    id: int
    data_source_id: int
    layer_from: LayerName
    layer_to: LayerName
    status: ExecStatus
    rows_success: int
    rows_failed: int
    error_message: Optional[str]
    started_at: Optional[str]
    finished_at: Optional[str]

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm_custom(cls, obj):
        return cls(
            id=obj.id,
            data_source_id=obj.data_source_id,
            layer_from=obj.layer_from,
            layer_to=obj.layer_to,
            status=obj.status,
            rows_success=obj.rows_success or 0,
            rows_failed=obj.rows_failed or 0,
            error_message=obj.error_message,
            started_at=obj.started_at.isoformat() if obj.started_at else None,
            finished_at=obj.finished_at.isoformat() if obj.finished_at else None,
        )


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_ds(ds_id: int, db: Session) -> DataSource:
    ds = db.get(DataSource, ds_id)
    if not ds:
        raise HTTPException(status_code=404, detail="数据源不存在")
    return ds


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/{ds_id}/execute/raw-to-dwd")
def execute_raw_to_dwd(
    ds_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    _get_ds(ds_id, db)
    return run_raw_to_dwd(ds_id, db, created_by=current_user.id)


@router.post("/{ds_id}/execute/dwd-to-dws")
def execute_dwd_to_dws(
    ds_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    _get_ds(ds_id, db)
    return run_dwd_to_dws(ds_id, db, created_by=current_user.id)


@router.post("/{ds_id}/execute/dws-to-ads")
def execute_dws_to_ads(
    ds_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    _get_ds(ds_id, db)
    return run_dws_to_ads(ds_id, db, created_by=current_user.id)


@router.get("/{ds_id}/executions")
def list_executions(
    ds_id: int,
    layer_from: Optional[str] = None,
    layer_to: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    _get_ds(ds_id, db)
    q = db.query(Execution).filter(Execution.data_source_id == ds_id)
    if layer_from:
        q = q.filter(Execution.layer_from == layer_from)
    if layer_to:
        q = q.filter(Execution.layer_to == layer_to)
    if status:
        q = q.filter(Execution.status == status)
    records = q.order_by(Execution.started_at.desc()).limit(100).all()
    return [ExecutionOut.from_orm_custom(r) for r in records]
