# Execution engine for the DWS → ADS layer transformation.
# Steps: read etl_dws → DuckDB in-memory (field select + ORDER BY + LIMIT) → write etl_ads.
# Config comes from etl_meta.ads_rules (one record per datasource).
# selected_fields=[] means "output all columns" (no field filtering applied).
# if_exists="replace": ADS is always rebuilt from scratch on each execution.
from datetime import datetime, timezone

import duckdb
import pandas as pd
from sqlalchemy.orm import Session

from database import engine
from models.ads_rule import AdsRule
from models.execution import Execution, ExecStatus, LayerName
from services.alert_service import send_failure_alert

ALLOWED_DIRECTIONS = {"ASC", "DESC"}


def run_dws_to_ads(ds_id: int, db: Session, created_by: int | None = None) -> dict:
    started_at = datetime.now(timezone.utc)

    # ── 1. Load config ────────────────────────────────────────────────────────
    ads_rule = db.query(AdsRule).filter(AdsRule.data_source_id == ds_id).first()
    if not ads_rule:
        return {"status": "failed", "error": "没有配置 ADS 输出规则，请先保存规则"}

    # ── 2. Record execution start ─────────────────────────────────────────────
    exec_rec = Execution(
        data_source_id=ds_id,
        layer_from=LayerName.dws,
        layer_to=LayerName.ads,
        status=ExecStatus.running,
        started_at=started_at,
        created_by=created_by,
    )
    db.add(exec_rec)
    db.commit()
    db.refresh(exec_rec)

    try:
        # ── 3. Read from etl_dws ──────────────────────────────────────────────
        with engine.connect() as conn:
            dws_df = pd.read_sql(
                f"SELECT * FROM `etl_dws`.`{ads_rule.src_dws_table}`", conn
            )

        if dws_df.empty:
            raise ValueError(
                f"etl_dws.{ads_rule.src_dws_table} 表中没有数据，请先执行 DWD→DWS"
            )

        # ── 4. DuckDB: field select + ORDER BY + LIMIT ────────────────────────
        con = duckdb.connect()
        con.register("dws", dws_df)

        if ads_rule.selected_fields:
            select = ", ".join(f'"{f}"' for f in ads_rule.selected_fields)
        else:
            select = "*"

        sql = f"SELECT {select} FROM dws"

        if ads_rule.order_by:
            order_parts = []
            for o in ads_rule.order_by:
                direction = o["direction"].upper()
                if direction not in ALLOWED_DIRECTIONS:
                    raise ValueError(f"不支持的排序方向：{direction}")
                field = o["field"].replace('"', '""')
                order_parts.append(f'"{field}" {direction}')
            sql += f" ORDER BY {', '.join(order_parts)}"

        if ads_rule.limit_rows and ads_rule.limit_rows > 0:
            sql += f" LIMIT {int(ads_rule.limit_rows)}"

        result_df = con.execute(sql).df()
        con.close()

        # ── 5. Write to etl_ads ───────────────────────────────────────────────
        with engine.connect() as conn:
            result_df.to_sql(
                name=ads_rule.target_ads_table,
                con=conn,
                schema="etl_ads",
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
            "ads_table": f"etl_ads.{ads_rule.target_ads_table}",
        }

    except Exception as e:
        exec_rec.status = ExecStatus.failed
        exec_rec.error_message = str(e)
        exec_rec.finished_at = datetime.now(timezone.utc)
        db.commit()
        send_failure_alert(exec_rec, f"ds_id={ds_id}")
        return {"run_id": exec_rec.id, "status": "failed", "error": str(e)}
