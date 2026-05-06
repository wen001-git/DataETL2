# FastAPI application entry point.
# All routers share the /api/v1 prefix defined inside each router file.
# Router responsibility map:
#   auth          → /auth/*            login, register, JWT /me
#   datasources   → /datasources/*     CRUD for data_source config
#   upload        → /upload/*          CSV/Excel file upload → etl_raw
#   sftp          → /sftp/*            SFTP browse + pull → etl_raw
#   mappings      → /datasources/*/    field mappings + column-name helpers
#   filter_rules  → /datasources/*/    row filter rules (applied during raw→dwd)
#   executions    → /datasources/*/    trigger executions + history
#   agg_rules     → /datasources/*/    DWS aggregation config
#   ads_rules     → /datasources/*/    ADS output config + CSV/Excel export
#   dashboards    → /dashboards/*      dashboard + chart CRUD + data query (W1-A)
#   lineage       → /datasources/*/lineage/*  config lineage + version history (W1-B)
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import models  # noqa: F401 — ensures all models are registered on Base.metadata before create_all
from database import Base, engine
from routers import (
    ads_rules, agg_rules, auth, dashboards, datasources,
    executions, filter_rules, lineage, mappings, sftp, upload,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # create_all is safe on existing tables (uses IF NOT EXISTS); only creates new ones
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="DataETL2 API",
    description="通用数据 ETL 平台 REST API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(datasources.router)
app.include_router(upload.router)
app.include_router(sftp.router)
app.include_router(mappings.router)
app.include_router(filter_rules.router)
app.include_router(executions.router)
app.include_router(agg_rules.router)
app.include_router(ads_rules.router)
app.include_router(dashboards.router)
app.include_router(lineage.router)


@app.get("/health")
def health():
    return {"status": "ok"}
