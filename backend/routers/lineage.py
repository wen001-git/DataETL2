# Config lineage: shows how fields flow through all 4 ETL layers for a datasource.
# /config      → current state assembled from FieldMapping + AggRule + AdsRule
# /config/history → past mapping snapshots (written by mappings.py PUT on each save)
# /config/diff → field-level diff between two historical snapshots
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from models import DataSource, FieldMapping
from models.agg_rule import AggRule
from models.ads_rule import AdsRule
from models.mapping_version import MappingVersion
from routers.auth import get_current_user

router = APIRouter(prefix="/api/v1/datasources", tags=["lineage"])


def _get_ds(ds_id: int, db: Session) -> DataSource:
    ds = db.get(DataSource, ds_id)
    if not ds:
        raise HTTPException(status_code=404, detail="数据源不存在")
    return ds


@router.get("/{ds_id}/lineage/config")
def get_config_lineage(
    ds_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)
):
    _get_ds(ds_id, db)

    mappings = (
        db.query(FieldMapping)
        .filter(FieldMapping.data_source_id == ds_id)
        .order_by(FieldMapping.sort_order, FieldMapping.id)
        .all()
    )
    agg_rule = db.query(AggRule).filter(AggRule.data_source_id == ds_id).first()
    ads_rule = db.query(AdsRule).filter(AdsRule.data_source_id == ds_id).first()

    return {
        "data_source_id": ds_id,
        "raw_to_dwd": [
            {
                "src_field": m.src_field,
                "dst_field": m.dst_field,
                "dst_type": m.dst_type.value,
                "skip": m.skip,
                "default_value": m.default_value,
            }
            for m in mappings
        ] if mappings else None,
        "dwd_to_dws": {
            "src_table": agg_rule.src_dwd_table,
            "target_table": agg_rule.target_dws_table,
            "group_by": agg_rule.group_by_fields,
            "agg_functions": agg_rule.agg_functions,
        } if agg_rule else None,
        "dws_to_ads": {
            "src_table": ads_rule.src_dws_table,
            "target_table": ads_rule.target_ads_table,
            "selected_fields": ads_rule.selected_fields,
            "order_by": ads_rule.order_by,
            "limit_rows": ads_rule.limit_rows,
        } if ads_rule else None,
    }


@router.get("/{ds_id}/lineage/config/history")
def get_config_history(
    ds_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)
):
    _get_ds(ds_id, db)
    versions = (
        db.query(MappingVersion)
        .filter(MappingVersion.data_source_id == ds_id)
        .order_by(MappingVersion.saved_at.desc())
        .limit(50)
        .all()
    )
    return [
        {"id": v.id, "saved_at": v.saved_at.isoformat(), "saved_by": v.saved_by}
        for v in versions
    ]


@router.get("/{ds_id}/lineage/config/diff")
def get_config_diff(
    ds_id: int,
    v1: int = Query(..., description="旧版本 ID"),
    v2: int = Query(..., description="新版本 ID"),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    _get_ds(ds_id, db)
    ver1 = db.get(MappingVersion, v1)
    ver2 = db.get(MappingVersion, v2)
    if not ver1 or ver1.data_source_id != ds_id:
        raise HTTPException(status_code=404, detail=f"版本 {v1} 不存在")
    if not ver2 or ver2.data_source_id != ds_id:
        raise HTTPException(status_code=404, detail=f"版本 {v2} 不存在")

    m1 = {m["src_field"]: m for m in (ver1.snapshot_json.get("mappings") or [])}
    m2 = {m["src_field"]: m for m in (ver2.snapshot_json.get("mappings") or [])}

    added = [m2[k] for k in m2 if k not in m1]
    removed = [m1[k] for k in m1 if k not in m2]
    modified = []
    for k in m1:
        if k in m2:
            changes = {}
            for field in ("dst_field", "dst_type", "skip", "default_value"):
                old_val = m1[k].get(field)
                new_val = m2[k].get(field)
                if old_val != new_val:
                    changes[field] = {"from": old_val, "to": new_val}
            if changes:
                modified.append({"src_field": k, "changes": changes})

    return {
        "v1": {"id": v1, "saved_at": ver1.saved_at.isoformat()},
        "v2": {"id": v2, "saved_at": ver2.saved_at.isoformat()},
        "added": added,
        "removed": removed,
        "modified": modified,
        "target_dwd_table_changed": (
            ver1.snapshot_json.get("target_dwd_table")
            != ver2.snapshot_json.get("target_dwd_table")
        ),
    }
