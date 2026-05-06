# DataSource CRUD + per-datasource data preview across all 4 ETL layers.
# Preview endpoint resolves the table name from the datasource config (no user-supplied table names),
# so it always reflects what was actually written by the last ETL execution.
from datetime import datetime
from typing import Optional

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from crypto import encrypt
from database import engine as db_engine, get_db
from models import DataSource
from models.ads_rule import AdsRule
from models.agg_rule import AggRule
from models.data_source import SourceType
from models.field_mapping import FieldMapping
from routers.auth import get_current_user

router = APIRouter(prefix="/api/v1/datasources", tags=["datasources"])


class DataSourceCreate(BaseModel):
    name: str
    description: Optional[str] = None
    source_type: SourceType
    sftp_host: Optional[str] = None
    sftp_port: int = 22
    sftp_user: Optional[str] = None
    sftp_password: Optional[str] = None
    sftp_remote_path: Optional[str] = None
    sftp_file_pattern: str = "*.csv"
    target_raw_table: str


class DataSourceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    sftp_host: Optional[str] = None
    sftp_port: Optional[int] = None
    sftp_user: Optional[str] = None
    sftp_password: Optional[str] = None
    sftp_remote_path: Optional[str] = None
    sftp_file_pattern: Optional[str] = None
    target_raw_table: Optional[str] = None


class DataSourceOut(BaseModel):
    id: int
    name: str
    description: Optional[str]
    source_type: SourceType
    sftp_host: Optional[str]
    sftp_port: Optional[int]
    sftp_user: Optional[str]
    sftp_remote_path: Optional[str]
    sftp_file_pattern: Optional[str]
    target_raw_table: str
    created_at: datetime

    model_config = {"from_attributes": True}


@router.get("", response_model=list[DataSourceOut])
def list_datasources(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(DataSource).order_by(DataSource.id).all()


@router.post("", response_model=DataSourceOut, status_code=201)
def create_datasource(
    body: DataSourceCreate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    ds = DataSource(
        name=body.name,
        description=body.description,
        source_type=body.source_type,
        sftp_host=body.sftp_host,
        sftp_port=body.sftp_port,
        sftp_user=body.sftp_user,
        sftp_password_enc=encrypt(body.sftp_password or ""),
        sftp_remote_path=body.sftp_remote_path,
        sftp_file_pattern=body.sftp_file_pattern,
        target_raw_table=body.target_raw_table,
        created_by=user.id,
    )
    db.add(ds)
    db.commit()
    db.refresh(ds)
    return ds


@router.get("/{ds_id}", response_model=DataSourceOut)
def get_datasource(ds_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    ds = db.get(DataSource, ds_id)
    if not ds:
        raise HTTPException(status_code=404, detail="数据源不存在")
    return ds


@router.put("/{ds_id}", response_model=DataSourceOut)
def update_datasource(
    ds_id: int,
    body: DataSourceUpdate,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    ds = db.get(DataSource, ds_id)
    if not ds:
        raise HTTPException(status_code=404, detail="数据源不存在")
    for field, value in body.model_dump(exclude_none=True).items():
        if field == "sftp_password":
            ds.sftp_password_enc = encrypt(value)
        else:
            setattr(ds, field, value)
    db.commit()
    db.refresh(ds)
    return ds


@router.delete("/{ds_id}", status_code=204)
def delete_datasource(ds_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    ds = db.get(DataSource, ds_id)
    if not ds:
        raise HTTPException(status_code=404, detail="数据源不存在")
    db.delete(ds)
    db.commit()


# ── Data Preview ───────────────────────────────────────────────────────────────

_LAYER_SCHEMA = {"raw": "etl_raw", "dwd": "etl_dwd", "dws": "etl_dws", "ads": "etl_ads"}


@router.get("/{ds_id}/preview/{layer}")
def preview_layer(
    ds_id: int,
    layer: str,
    page: int = 1,
    page_size: int = 50,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    if layer not in _LAYER_SCHEMA:
        raise HTTPException(status_code=400, detail="layer 必须是 raw|dwd|dws|ads")
    page_size = min(page_size, 200)

    ds = db.get(DataSource, ds_id)
    if not ds:
        raise HTTPException(status_code=404, detail="数据源不存在")

    # Resolve table name from stored config — never trust user input for table names
    if layer == "raw":
        table = ds.target_raw_table
    elif layer == "dwd":
        m = db.query(FieldMapping).filter(
            FieldMapping.data_source_id == ds_id, FieldMapping.skip == False
        ).first()
        if not m:
            raise HTTPException(status_code=404, detail="无字段映射，请先配置映射")
        table = m.target_dwd_table
    elif layer == "dws":
        rule = db.query(AggRule).filter(AggRule.data_source_id == ds_id).first()
        if not rule:
            raise HTTPException(status_code=404, detail="无聚合规则，请先配置 DWS 规则")
        table = rule.target_dws_table
    else:  # ads
        rule = db.query(AdsRule).filter(AdsRule.data_source_id == ds_id).first()
        if not rule:
            raise HTTPException(status_code=404, detail="无 ADS 规则，请先配置 ADS 规则")
        table = rule.target_ads_table

    schema = _LAYER_SCHEMA[layer]
    offset = (page - 1) * page_size

    try:
        with db_engine.connect() as conn:
            total = conn.execute(
                text(f"SELECT COUNT(*) FROM `{schema}`.`{table}`")
            ).scalar()
            df = pd.read_sql(
                text(f"SELECT * FROM `{schema}`.`{table}` LIMIT :ps OFFSET :off"),
                conn,
                params={"ps": page_size, "off": offset},
            )
    except Exception:
        raise HTTPException(
            status_code=404,
            detail=f"{schema}.{table} 表不存在，请先执行对应的 ETL 步骤",
        )

    return {
        "layer": layer,
        "table_name": f"{schema}.{table}",
        "total": total,
        "page": page,
        "page_size": page_size,
        "columns": list(df.columns),
        "rows": df.fillna("").to_dict(orient="records"),
    }
