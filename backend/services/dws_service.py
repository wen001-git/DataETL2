# Execution engine for the DWD → DWS layer transformation.
# Steps: read etl_dwd → DuckDB in-memory (GROUP BY + aggregation) → write etl_dws.
# Aggregation config comes from etl_meta.agg_rules (one record per datasource).
# if_exists="replace": DWS is always rebuilt from scratch on each execution.
# COUNT_DISTINCT is stored as a func name but maps to COUNT(DISTINCT field) in SQL.
from datetime import datetime, timezone

import duckdb
import pandas as pd
from sqlalchemy.orm import Session

from database import engine
from models.agg_rule import AggRule
from models.execution import Execution, ExecStatus, LayerName
from services.alert_service import send_failure_alert

ALLOWED_FUNCS = {"SUM", "COUNT", "AVG", "MAX", "MIN", "COUNT_DISTINCT"}


def run_dwd_to_dws(ds_id: int, db: Session, created_by: int | None = None) -> dict:
    started_at = datetime.now(timezone.utc)

    # ── 1. Load config ────────────────────────────────────────────────────────
    agg_rule = db.query(AggRule).filter(AggRule.data_source_id == ds_id).first()
    if not agg_rule:
        return {"status": "failed", "error": "没有配置聚合规则，请先保存 DWS 聚合规则"}
    if not agg_rule.group_by_fields and not agg_rule.agg_functions:
        return {"status": "failed", "error": "聚合规则为空（无 GROUP BY 字段也无聚合函数）"}

    # ── 2. Record execution start ─────────────────────────────────────────────
    exec_rec = Execution(
        data_source_id=ds_id,
        layer_from=LayerName.dwd,
        layer_to=LayerName.dws,
        status=ExecStatus.running,
        started_at=started_at,
        created_by=created_by,
    )
    db.add(exec_rec)
    db.commit()
    db.refresh(exec_rec)

    try:
        # ── 3. Read from etl_dwd ──────────────────────────────────────────────
        with engine.connect() as conn:
            dwd_df = pd.read_sql(
                f"SELECT * FROM `etl_dwd`.`{agg_rule.src_dwd_table}`", conn
            )

        if dwd_df.empty:
            raise ValueError(
                f"etl_dwd.{agg_rule.src_dwd_table} 表中没有数据，请先执行 Raw→DWD"
            )

        # ── 4. DuckDB GROUP BY ────────────────────────────────────────────────
        con = duckdb.connect()
        con.register("dwd", dwd_df)

        group_exprs = [f'"{f}"' for f in agg_rule.group_by_fields]
        agg_exprs = []
        for agg in agg_rule.agg_functions:
            func = agg["func"].upper()
            if func not in ALLOWED_FUNCS:
                raise ValueError(f"不支持的聚合函数：{func}")
            field = agg["field"].replace('"', '""')
            alias = agg["alias"].replace('"', '""')
            if func == "COUNT_DISTINCT":
                agg_exprs.append(f'COUNT(DISTINCT "{field}") AS "{alias}"')
            else:
                agg_exprs.append(f'{func}("{field}") AS "{alias}"')

        select_parts = group_exprs + agg_exprs
        if not select_parts:
            raise ValueError("没有有效的 SELECT 表达式（GROUP BY 和聚合函数均为空）")

        sql = f"SELECT {', '.join(select_parts)} FROM dwd"
        if group_exprs:
            sql += f" GROUP BY {', '.join(group_exprs)}"

        result_df = con.execute(sql).df()
        con.close()

        # ── 5. Write to etl_dws ───────────────────────────────────────────────
        with engine.connect() as conn:
            result_df.to_sql(
                name=agg_rule.target_dws_table,
                con=conn,
                schema="etl_dws",
                if_exists="replace",
                index=False,
                chunksize=500,
            )
            conn.commit()

        # ── 6. Record success ─────────────────────────────────────────────────
        exec_rec.status = ExecStatus.success
        exec_rec.rows_success = len(result_df)
        exec_rec.rows_failed = 0
        exec_rec.finished_at = datetime.now(timezone.utc)
        db.commit()

        return {
            "run_id": exec_rec.id,
            "status": "success",
            "rows_written": len(result_df),
            "dws_table": f"etl_dws.{agg_rule.target_dws_table}",
        }

    except Exception as e:
        exec_rec.status = ExecStatus.failed
        exec_rec.error_message = str(e)
        exec_rec.finished_at = datetime.now(timezone.utc)
        db.commit()
        send_failure_alert(exec_rec, f"ds_id={ds_id}")
        return {"run_id": exec_rec.id, "status": "failed", "error": str(e)}
