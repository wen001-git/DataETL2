# DataETL2 — AI Handover Document

> **Purpose**: Read this first. It gives any AI coding tool (Claude Code, Codex, Gemini, etc.) or new developer enough context to continue development immediately without asking the user to re-explain the project.
>
> **Keep this file current**: Update it whenever a Day milestone is completed. Add to "Bugs Fixed / Gotchas" whenever you discover and fix a non-obvious issue.

---

## 1. Project in One Paragraph

DataETL2 is a **general-purpose data ETL web platform** built for a non-technical user who cannot code. It ingests CSV/Excel files (manual upload or SFTP pull) into a raw MySQL layer, then lets the user configure field mappings, filter rules, and aggregations to transform data through four warehouse layers: `etl_raw → etl_dwd → etl_dws → etl_ads`. All table names, field names, and transformation logic are **user-configured — nothing is hardcoded**. The user accesses the system through a React web UI at `http://localhost:8080`.

---

## 2. Quick Start

```bash
cd /Users/Zhuanz/Claude/DataETL2

# Start all 5 containers
docker compose up -d

# Verify
curl --noproxy localhost http://localhost:8000/health   # → {"status":"ok"}
open http://localhost:8080                              # → login page
```

**Login**: username `admin`, password `admin123`

**Stop**:
```bash
docker compose down        # keep data
docker compose down -v     # wipe everything (volumes too)
```

**Rebuild after code changes**:
```bash
# Backend (Python): just touch the file to trigger hot-reload
docker compose exec api touch routers/<changed_file>.py

# Frontend (React): must rebuild image
docker compose build frontend && docker compose up -d frontend
```

> **Mac gotcha**: curl on this machine has `http_proxy=http://127.0.0.1:7897` set system-wide. Always use `--noproxy localhost` when hitting local endpoints, or all requests will 502.

---

## 3. Architecture

```
Browser → Nginx :8080 → /api/* → FastAPI :8000
                       → /*    → React frontend :80

FastAPI → SQLAlchemy → MySQL (etl_meta schema — system config tables)
FastAPI → DuckDB (in-memory) → MySQL (etl_raw / etl_dwd / etl_dws / etl_ads)
FastAPI → paramiko → SFTP server
```

**5 Docker services**: `mysql`, `api`, `frontend`, `nginx`, `sftp`  
**5 MySQL schemas**: `etl_meta` (system), `etl_raw`, `etl_dwd`, `etl_dws`, `etl_ads`  
**Ports**: `:8080` nginx, `:8000` api (direct), `:3306` mysql, `:2222` sftp test server

### Data flow
```
CSV/Excel file
    ↓ DuckDB read_csv_auto(all_varchar=True) / pandas read_excel
etl_raw.<user_table>          ← all columns TEXT; +_src_file, _ingested_at, _run_id
    ↓ DuckDB SQL (field mappings + filter rules)
etl_dwd.<user_table>          ← renamed fields, typed, filtered
    ↓ DuckDB SQL (agg_rules GROUP BY)
etl_dws.<user_table>          ← aggregated
    ↓ DuckDB SQL (ads_rules field select/sort)
etl_ads.<user_table>          ← final output, exportable as CSV/Excel
```

---

## 4. Repository Layout (implemented files only)

```
DataETL2/
├── CLAUDE.md                        ← project rules (auto-loaded by Claude Code)
├── HANDOVER.md                      ← this file
├── docker-compose.yml
├── .env                             ← secrets (MySQL, JWT, Fernet key, SFTP creds)
├── mysql/init.sql                   ← creates 5 schemas + grants on first boot
├── sftp-data/                       ← bind-mounted into sftp container for testing
│
├── backend/
│   ├── main.py                      ← FastAPI app, registers all routers
│   ├── config.py                    ← pydantic-settings (reads .env)
│   ├── database.py                  ← SQLAlchemy engine (etl_meta schema)
│   ├── crypto.py                    ← Fernet encrypt/decrypt (SFTP passwords)
│   ├── models/
│   │   ├── user.py                  ← etl_meta.users
│   │   ├── data_source.py           ← etl_meta.data_sources
│   │   ├── field_mapping.py         ← etl_meta.field_mappings  ← DstType enum fix here
│   │   ├── filter_rule.py           ← etl_meta.filter_rules (model exists, no router yet)
│   │   ├── agg_rule.py              ← etl_meta.agg_rules (model exists, no router yet)
│   │   ├── ads_rule.py              ← etl_meta.ads_rules (model exists, no router yet)
│   │   └── execution.py             ← etl_meta.executions (model exists, no router yet)
│   ├── routers/
│   │   ├── auth.py                  ← POST /login, POST /register, GET /me
│   │   ├── datasources.py           ← CRUD for data_sources + GET /{ds_id}/preview/{layer}
│   │   ├── upload.py                ← POST /upload (CSV/Excel → etl_raw) + GET /preview
│   │   ├── sftp.py                  ← GET /list, POST /pull (SFTP → etl_raw)
│   │   ├── mappings.py              ← GET/PUT mappings, dwd-columns, template, Excel import
│   │   ├── filter_rules.py          ← GET/PUT filter rules (bulk replace)
│   │   ├── agg_rules.py             ← GET/PUT agg rule (upsert, one per datasource)
│   │   ├── ads_rules.py             ← GET/PUT ads rule + GET export (CSV/Excel download)
│   │   └── executions.py            ← POST execute/raw-to-dwd, dwd-to-dws, dws-to-ads + GET executions
│   └── services/
│       ├── ingest_service.py        ← DuckDB → pandas → MySQL etl_raw writer
│       ├── sftp_service.py          ← paramiko wrapper
│       ├── etl_service.py           ← run_raw_to_dwd: mappings + filters → etl_dwd
│       ├── dws_service.py           ← run_dwd_to_dws: GROUP BY → etl_dws
│       ├── ads_service.py           ← run_dws_to_ads: field select + ORDER BY + LIMIT → etl_ads
│       └── alert_service.py         ← send_failure_alert: smtplib email on exec failure (disabled by default)
│
└── frontend/src/
    ├── App.tsx                      ← router, layout, RequireAuth guard
    ├── api/client.ts                ← axios instance with JWT auto-attach
    └── pages/
        ├── Login.tsx
        ├── DataSources.tsx          ← datasource CRUD UI
        ├── Upload.tsx               ← file upload + preview UI
        ├── SftpBrowser.tsx          ← SFTP browse + pull UI
        ├── Mappings.tsx             ← field mapping editor + execute Raw→DWD button
        ├── FilterRules.tsx          ← filter rules config UI
        ├── AggRules.tsx             ← DWS agg rules config + execute DWD→DWS button
        ├── AdsRules.tsx             ← ADS output rules (field select, sort, limit) + execute + export
        ├── History.tsx              ← execution history table (filter by layer/status, color-coded tags)
        └── DataPreview.tsx          ← browse all 4 layers (tab per layer, server-side pagination)
```

---

## 5. Key Design Decisions (the non-obvious ones)

| Decision | What was chosen | Why |
|----------|----------------|-----|
| Raw layer types | All columns stored as TEXT/VARCHAR | DuckDB `all_varchar=True`; type casting deferred to DWD mapping |
| Mapping save strategy | Atomic delete-all + re-insert on PUT | Simpler than diff/patch; mappings are always saved as a complete set |
| DstType enum names | `float_` / `datetime_` in Python, but DB value = `"float"` / `"datetime"` | Python can't use `float` as an enum member name (it's a built-in) |
| SFTP password storage | Fernet symmetric encryption; key in `.env` | Key must be persistent — if it changes, all stored passwords are unreadable |
| MySQL vs DuckDB persistence | MySQL is the only persistent store; DuckDB is in-memory only | DuckDB used purely as a transform engine, not for storage |
| 5 MySQL schemas | `etl_meta`, `etl_raw`, `etl_dwd`, `etl_dws`, `etl_ads` | Clean separation; `etl_meta` has fixed structure, others are user-defined |
| etl_raw metadata columns | `_src_file`, `_ingested_at`, `_run_id` | Added to every raw row; excluded from field mapping column list |
| DWD table name suggestion | `dwd_<raw_table_name with raw_ prefix stripped>` | Auto-populated when no mapping exists yet |

---

## 6. Bugs Fixed — Do Not Reintroduce

| Bug | Root cause | Fix location |
|-----|-----------|-------------|
| `DstType.float_` stored as `"float_"` in MySQL (Data truncated) | SQLAlchemy `Enum` uses member **name** not **value** by default | `models/field_mapping.py` — added `values_callable=lambda x: [e.value for e in x]` to the Enum column |
| bcrypt incompatibility with passlib | bcrypt >= 4.0.0 breaks passlib 1.7.4 | `requirements.txt` pins `bcrypt==3.2.2` |
| Nginx showing default page instead of app | nginx proxied `/` to static files but there were none in the container | `nginx.conf` — proxies `/*` to the `frontend` container via `upstream frontend` |
| Fernet key regenerated on restart | `FERNET_KEY=` was empty in `.env` | `.env` now has a permanent key; never delete it or all SFTP passwords become unreadable |
| SFTP pull error swallowed DB ingestion error | Single try/except for both SFTP download + DB write | `routers/sftp.py` — split into two separate try/except blocks |
| `etl_meta.users` vs `dataetl2.users` | Auth model uses `etl_meta` schema; there is also a `dataetl2` database | Always query `etl_meta.users`; `dataetl2` is the alembic default DB (not used for user data) |

---

## 7. Current Status

**Phase 1 progress (9-day MVP plan):**

| Day | Topic | Status |
|-----|-------|--------|
| Day 1 | Backend skeleton, auth, DB, Docker | ✅ Done |
| Day 2 | Datasources, file upload, SFTP, raw ingestion | ✅ Done |
| Day 3 | Field mapping editor (Raw → DWD config) | ✅ Done |
| Day 4 | Filter rules + Raw→DWD execution engine | ✅ Done |
| Day 5 | DWS aggregation rules + DWD→DWS execution | ✅ Done |
| Day 6 | ADS output rules + DWS→ADS + CSV/Excel export | ✅ Done |
| Day 7 | Execution history page + data preview pages | ✅ Done |
| Day 8 | Email failure alerts + SFTP test + 72-test suite | ✅ Done |
| Day 9 | QA bug fixes + TypeScript build check + Phase 2 design | ✅ Done |

---

## 8. Phase 1 完成 — 下一步是 Phase 2

**Phase 1 全部 9 天任务已完成。** 系统测试 72/72 通过。

**后续功能路线图见** `Docs/07-后续规划路线图.md`（按执行依赖顺序 Wave 1-5 组织）。

**Wave 1（已实现，无外部依赖）**：

| 功能 | 工期 | 状态 |
|------|------|------|
| W1-A 仪表盘基础（KPI/折线/柱状/表格）| 3 天 | ✅ Done |
| W1-B 配置血缘（字段变换链 + 版本历史）| 2 天 | ✅ Done |

**原 Phase 2 / Phase 3 文档已归档**（见 `Docs/07-Phase2设计.md`、`Docs/08-Phase3设计.md`）。

**原 Phase 2 功能规划**（旧，供参考）：

| 优先级 | 功能 | 估计工期 |
|--------|------|---------|
| P1 | Prefect 调度引擎 + SFTP 自动拉取 | 3 天 |
| P2 | 数据质量报告层 | 2 天 |
| P2 | 工作空间隔离 + 角色权限 | 3 天 |
| P3 | React Flow 可视化画布 | 4 天 |

**Phase 3 功能规划见** `Docs/08-Phase3设计.md`（运营智能），优先级排序：

| 优先级 | 功能 | 估计工期 |
|--------|------|---------|
| P1 | 仪表盘（KPI 卡片 + 折线/柱状图）| 3 天 |
| P1 | 配置血缘（字段变换链可视化）| 2 天 |
| P2 | 仪表盘扩展（饼图 + 自动刷新）| 2 天 |
| P2 | 执行血缘（源文件追溯 DAG）| 3 天 |
| P3 | 映射版本历史 + diff 对比 | 2 天 |

**启动 Phase 2 前的准备**：
- 确认 Phase 2 优先级顺序（P1 先做调度，还是先做权限？）
- 确认 Prefect Server 的部署方式（加入现有 compose，还是独立部署？）

**Email 告警配置**（生产环境）：
```
ALERT_EMAIL_ENABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASSWORD=your-app-password
ALERT_TO_EMAIL=ops@yourcompany.com
```

---

## 9. Environment Reference

```bash
# .env key values
DATABASE_URL=mysql+pymysql://etluser:etlpassword@mysql:3306/dataetl2
SECRET_KEY=dev-secret-key-change-in-production-32chars
FERNET_KEY=sUcYhipaUGOOQsxFWqwzBHt4maDGeRsv2qm9wQF78jc=   # DO NOT change
SFTP_USER=etltest
SFTP_PASSWORD=etltest123
```

```
# Test SFTP datasource settings (use in UI)
Host: sftp   Port: 22   User: etltest   Password: etltest123   Path: /upload
# Drop test files into: ./sftp-data/ on the host Mac
```

```bash
# Useful debug commands
docker compose logs api --tail=50          # API logs
docker compose logs api -f                 # follow logs
docker compose exec api python3            # Python REPL inside container
docker compose exec mysql mysql -uroot -prootpassword etl_meta   # MySQL shell
```

---

## 10. Documentation to Keep Updated

After every completed task, update:

| File | What to update |
|------|---------------|
| `Docs/00-开发进度.md` | Mark tasks ✅, update date, add changelog row |
| `Docs/04-系统架构.md` | New files, new services, new ports |
| `Docs/06-手动测试用例.md` | Add test cases for new Day, update smoke checklist |
| `HANDOVER.md` (this file) | Update §3 layout, §6 bugs, §7 status, §8 next steps |

---

## 变更日志

| 日期 | 变更内容 |
|------|---------|
| 2026-05-06 | W1-A/W1-B 完成：§8 更新路线图引用，新增 Wave 1 状态表；旧 Phase2/3 文档标记为已归档 |
| 2026-05-05 | Day 9 完成，Phase 1 收尾；§7 全部标记 ✅；§8 更新为 Phase 2 规划 |
| 2026-05-05 | Day 8 完成：告警服务、SFTP 全链路测试、72/72 系统测试 |
| 2026-05-05 | 初始创建（Day 1–7 完成时随版本更新） |
