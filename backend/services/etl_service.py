# Execution engine for the Raw → DWD layer transformation.
# Steps: read etl_raw → DuckDB in-memory (field rename + type cast + filter) → write etl_dwd.
# Key decisions:
#   - TRY_CAST instead of CAST for numeric types: raw data is all-text and may contain
#     bad values; TRY_CAST returns NULL rather than crashing the whole execution
#   - CAST(COALESCE(NULLIF(TRIM(field), ''), default)) when a default_value is configured:
#     replaces blank/empty-string source values before casting
#   - is_null / is_not_null operators check both SQL NULL and empty string because the raw
#     layer stores empty spreadsheet cells as '' rather than NULL
#   - if_exists="replace": DWD is always rebuilt from scratch on each execution
from datetime import datetime, timezone

import duckdb
import pandas as pd
from sqlalchemy.orm import Session

from database import engine
from models import DataSource, FieldMapping, FilterRule
from models.execution import Execution, ExecStatus, LayerName
from services.alert_service import send_failure_alert

DUCK_TYPE = {
    "string": "VARCHAR",
    "integer": "INTEGER",
    "float": "DOUBLE",
    "date": "DATE",
    "datetime": "TIMESTAMP",
    "boolean": "BOOLEAN",
}

# Maps FilterOperator value → SQL fragment template (f=field, v=value)
_OP_SQL = {
    "eq":          lambda f, v: f'"{f}" = \'{v}\'',
    "ne":          lambda f, v: f'"{f}" != \'{v}\'',
    "gt":          lambda f, v: f'TRY_CAST("{f}" AS DOUBLE) > {v}',
    "lt":          lambda f, v: f'TRY_CAST("{f}" AS DOUBLE) < {v}',
    "gte":         lambda f, v: f'TRY_CAST("{f}" AS DOUBLE) >= {v}',
    "lte":         lambda f, v: f'TRY_CAST("{f}" AS DOUBLE) <= {v}',
    "contains":    lambda f, v: f'"{f}" LIKE \'%{v}%\'',
    "not_contains":lambda f, v: f'"{f}" NOT LIKE \'%{v}%\'',
    "is_null":     lambda f, v: f'("{f}" IS NULL OR TRIM("{f}") = \'\')',
    "is_not_null": lambda f, v: f'("{f}" IS NOT NULL AND TRIM("{f}") != \'\')',
}


def _build_where(filters: list) -> str:
    if not filters:
        return ""
    parts = []
    for i, rule in enumerate(filters):
        op_fn = _OP_SQL.get(rule.operator.value)
        if not op_fn:
            continue
        clause = op_fn(rule.field_name, rule.value or "")
        if i == 0:
            parts.append(clause)
        else:
            parts.append(f"{rule.logic.value} {clause}")
    return " ".join(parts)


def run_raw_to_dwd(ds_id: int, db: Session, created_by: int | None = None) -> dict:
    started_at = datetime.now(timezone.utc)

    # ── 1. Load config ────────────────────────────────────────────────────────
    ds = db.get(DataSource, ds_id)
    if not ds:
        return {"status": "failed", "error": "数据源不存在"}

    mappings = (
        db.query(FieldMapping)
        .filter(FieldMapping.data_source_id == ds_id, FieldMapping.skip == False)
        .order_by(FieldMapping.sort_order)
        .all()
    )
    if not mappings:
        return {"status": "failed", "error": "没有有效的字段映射规则，请先配置并保存映射"}

    filters = (
        db.query(FilterRule)
        .filter(FilterRule.data_source_id == ds_id)
        .order_by(FilterRule.sort_order)
        .all()
    )

    dwd_table = mappings[0].target_dwd_table

    exec_rec = Execution(
        data_source_id=ds_id,
        layer_from=LayerName.raw,
        layer_to=LayerName.dwd,
        status=ExecStatus.running,
        started_at=started_at,
        created_by=created_by,
    )
    db.add(exec_rec)
    db.commit()
    db.refresh(exec_rec)

    try:
        # ── 2. Read from etl_raw ──────────────────────────────────────────────
        with engine.connect() as conn:
            raw_df = pd.read_sql(
                f"SELECT * FROM `etl_raw`.`{ds.target_raw_table}`", conn
            )

        if raw_df.empty:
            raise ValueError(f"etl_raw.{ds.target_raw_table} 表中没有数据")

        # ── 3. DuckDB transform ───────────────────────────────────────────────
        con = duckdb.connect()
        con.register("raw", raw_df)

        select_exprs = []
        for m in mappings:
            dtype = DUCK_TYPE.get(m.dst_type.value, "VARCHAR")
            field = m.src_field.replace('"', '""')
            alias = m.dst_field.replace('"', '""')
            if m.default_value:
                safe_default = m.default_value.replace("'", "''")
                expr = (
                    f"CAST(COALESCE(NULLIF(TRIM(\"{field}\"), ''), '{safe_default}') "
                    f"AS {dtype}) AS \"{alias}\""
                )
            else:
                expr = f"TRY_CAST(\"{field}\" AS {dtype}) AS \"{alias}\""
            select_exprs.append(expr)

        where = _build_where(filters)
        sql = "SELECT " + ", ".join(select_exprs) + " FROM raw"
        if where:
            sql += " WHERE " + where

        result_df = con.execute(sql).df()
        con.close()

        # ── 4. Write to etl_dwd ───────────────────────────────────────────────
        with engine.connect() as conn:
            result_df.to_sql(
                name=dwd_table,
                con=conn,
                schema="etl_dwd",
                if_exists="replace",
                index=False,
                chunksize=500,
            )
            conn.commit()

        # ── 5. Record success ─────────────────────────────────────────────────
        exec_rec.status = ExecStatus.success
        exec_rec.rows_success = len(result_df)
        exec_rec.rows_failed = 0
        exec_rec.finished_at = datetime.now(timezone.utc)
        db.commit()

        return {
            "run_id": exec_rec.id,
            "status": "success",
            "rows_written": len(result_df),
            "dwd_table": f"etl_dwd.{dwd_table}",
        }

    except Exception as e:
        exec_rec.status = ExecStatus.failed
        exec_rec.error_message = str(e)
        exec_rec.finished_at = datetime.now(timezone.utc)
        db.commit()
        send_failure_alert(exec_rec, ds.name if ds else f"ds_id={ds_id}")
        return {"run_id": exec_rec.id, "status": "failed", "error": str(e)}
