# Ingests a CSV or Excel file into etl_raw.<target_raw_table>.
# Raw layer design principles carried here:
#   - all_varchar=True: every column is stored as TEXT; type casting is deferred to DWD
#   - if_exists="append": raw data accumulates across runs (never overwritten)
#   - three metadata columns (_src_file, _ingested_at, _run_id) are prepended to every row
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import pandas as pd
from sqlalchemy import text

from database import engine


def _read_file(file_path: str) -> pd.DataFrame:
    ext = Path(file_path).suffix.lower()
    if ext == ".csv":
        con = duckdb.connect()
        df = con.execute(
            # all_varchar=true: store every column as text; type inference is deferred to DWD
            f"SELECT * FROM read_csv_auto('{file_path}', all_varchar=true)"
        ).df()
        con.close()
    elif ext in (".xlsx", ".xls"):
        df = pd.read_excel(file_path, dtype=str)
    else:
        raise ValueError(f"不支持的文件类型: {ext}")
    return df


def preview_file(file_path: str) -> dict:
    df = _read_file(file_path)
    columns = [{"name": col, "dtype": str(df[col].dtype)} for col in df.columns]
    sample = df.head(10).fillna("").to_dict(orient="records")
    return {"columns": columns, "total_rows": len(df), "sample": sample}


def ingest_file(file_path: str, src_filename: str, target_raw_table: str) -> dict:
    run_id = str(uuid.uuid4())
    ingested_at = datetime.now(timezone.utc)

    df = _read_file(file_path)

    for col in df.columns:
        df[col] = df[col].astype(str).fillna("")

    df.insert(0, "_run_id", run_id)
    df.insert(0, "_ingested_at", ingested_at)
    df.insert(0, "_src_file", src_filename)

    with engine.connect() as conn:
        df.to_sql(
            name=target_raw_table,
            con=conn,
            schema="etl_raw",
            if_exists="append",  # raw data accumulates; each upload adds rows, never replaces
            index=False,
            chunksize=500,
        )
        conn.commit()

    data_cols = [c for c in df.columns if not c.startswith("_")]
    return {
        "run_id": run_id,
        "rows_ingested": len(df),
        "columns": data_cols,
        "sample": df.head(5).fillna("").to_dict(orient="records"),
    }
