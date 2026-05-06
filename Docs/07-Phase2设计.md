# DataETL2 — Phase 2 设计文档（已归档）

> **注意**：本文档已合并至 `07-后续规划路线图.md`（按执行依赖顺序组织）。请以路线图为准。

**版本**: v0.1  
**日期**: 2026-05-05  
**状态**: 已归档

---

## 1. 背景与目标

Phase 1 实现了完整的 5 层手动 ETL 流程（Raw→DWD→DWS→ADS），用户可通过 Web UI 配置映射规则、过滤规则、聚合规则，并手动触发各层执行。

Phase 1 的核心局限：

| 限制 | 影响 |
|------|------|
| 所有执行均需手动点击触发 | 无法支持定时/自动化数据更新 |
| 配置以表单形式呈现 | 多数据源/多层依赖关系不直观 |
| SFTP 需手动浏览并逐文件拉取 | 无法实现无人值守的数据接入 |
| 单一管理员账号，无权限隔离 | 无法支持多团队/多租户使用 |
| 无数据质量检查 | 坏数据静默写入下游层 |

Phase 2 目标：在不破坏 Phase 1 已有配置的前提下，逐步引入调度自动化、可视化配置和数据质量能力。

---

## 2. 功能范围

### 2.1 Prefect 调度引擎

**目标**：让每个 ETL 链路（Raw→DWD→DWS→ADS）可以按 Cron 表达式自动执行，失败时自动重试并触发告警。

**核心设计**：
- 每个 DataSource 可配置一条调度规则（Cron 表达式 + 最大重试次数）
- Prefect Flow = 单个 DataSource 的完整链路（SFTP/Upload → Raw → DWD → DWS → ADS）
- 各层之间保持依赖顺序：上一层执行失败则中止，不继续下游层
- 调度状态写入 `etl_meta.schedule_runs`（新表），可在 UI 上查看历史

**新增数据模型**：
```sql
CREATE TABLE etl_meta.schedules (
  id           INT PRIMARY KEY AUTO_INCREMENT,
  data_source_id INT NOT NULL,
  cron_expr    VARCHAR(100) NOT NULL,   -- e.g. "0 2 * * *" = 每天凌晨2点
  enabled      BOOLEAN DEFAULT TRUE,
  max_retries  INT DEFAULT 1,
  created_at   DATETIME DEFAULT NOW()
);
```

**技术选型**：`prefect==3.x`（已在 Phase 1 requirements 中预留）；Prefect Server 作为第 6 个 Docker 服务加入 compose。

---

### 2.2 React Flow 可视化画布

**目标**：用拖拽式 DAG 画布替代当前的表单式配置页，让数据流关系一目了然。

**节点类型**：

| 节点 | 对应 Phase 1 概念 |
|------|-----------------|
| 源节点（SourceNode） | DataSource（upload / sftp） |
| 映射节点（MappingNode） | FieldMapping + FilterRule → etl_dwd |
| 聚合节点（AggNode） | AggRule → etl_dws |
| 输出节点（AdsNode） | AdsRule → etl_ads |
| 导出节点（ExportNode） | Export CSV/Excel |

**实现策略**：
- Phase 1 所有配置（FieldMapping、FilterRule 等）保持原有数据模型不变
- 画布节点配置仍保存到现有表，只是通过拖拽 UI 编辑而非表单
- 两种 UI 并存过渡期：表单页保留，画布页新增；用户可选择使用哪种

**技术选型**：`@xyflow/react`（React Flow v12，MIT 协议，活跃维护）

---

### 2.3 SFTP 自动定时拉取

**目标**：SFTP 数据源无需手动浏览和点击，由调度引擎按时间或文件变更自动拉取。

**设计**：
- 调度触发时，SFTP 数据源自动执行：列目录 → 按 `sftp_file_pattern` 过滤 → 与上次拉取的文件列表对比 → 只拉取新文件
- 已拉取文件记录写入 `etl_meta.sftp_pull_log`（filename + pulled_at + run_id），避免重复入库

**新增数据模型**：
```sql
CREATE TABLE etl_meta.sftp_pull_log (
  id           INT PRIMARY KEY AUTO_INCREMENT,
  data_source_id INT NOT NULL,
  filename     VARCHAR(500) NOT NULL,
  pulled_at    DATETIME NOT NULL,
  run_id       VARCHAR(36) NOT NULL,
  rows_ingested INT DEFAULT 0
);
```

---

### 2.4 工作空间隔离 + 角色权限

**目标**：支持多个团队各自管理独立的数据源和 ETL 配置，互不可见。

**设计**：
- 新增 `etl_meta.workspaces` 表（id, name, created_by）
- 所有现有表（data_sources / field_mappings / …）增加 `workspace_id` 外键
- 用户角色：`admin`（全局管理员）、`workspace_admin`（空间管理员）、`viewer`（只读）
- JWT 中携带 `workspace_id`；所有 API 查询自动过滤当前空间数据

**迁移策略**：Phase 1 所有已有数据归入 `workspace_id=1`（默认空间），零停机迁移。

---

### 2.5 数据质量报告层

**目标**：在 Raw→DWD 执行后自动生成数据质量报告，暴露空值率、类型转换失败率、异常值等问题。

**报告维度**：

| 指标 | 计算方式 |
|------|---------|
| 空值率 | `COUNT(NULL) / COUNT(*) per column` |
| 类型转换失败率 | `TRY_CAST` 返回 NULL 但原值非空的行数 / 总行数 |
| 唯一值数 | `COUNT(DISTINCT value) per column` |
| 数值列分布 | min / max / avg / stddev |
| Schema 变更检测 | 与上次执行的列名列表对比，新增/删除列告警 |

**存储**：新增 `etl_meta.dq_reports` 表（execution_id + column_name + metric_name + metric_value）；UI 上在执行历史详情页展示。

---

## 3. 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 调度引擎 | Prefect 3.x | Python 原生，与现有 FastAPI 服务无缝集成；Phase 1 requirements 已预留 |
| 画布组件 | @xyflow/react (React Flow v12) | MIT 协议，社区最活跃的 React DAG 库，文档完善 |
| 权限控制 | 现有 JWT + 扩展 claims | 不引入 Casbin 等重型框架，保持简单 |
| 调度存储 | MySQL（etl_meta） | 不引入 Redis/Celery，保持单数据库架构 |
| 数据质量计算 | DuckDB（已有） | 统计查询直接在 DuckDB 中完成，无需新引擎 |

---

## 4. 架构变化

**Phase 1 架构**（当前）：
```
Browser → Nginx → FastAPI → MySQL (etl_meta)
                           → DuckDB (in-memory) → MySQL (etl_*)
                           → paramiko → SFTP
```

**Phase 2 架构**（新增部分用 ★ 标注）：
```
Browser → Nginx → FastAPI → MySQL (etl_meta)
                           → DuckDB (in-memory) → MySQL (etl_*)
                           → paramiko → SFTP
★ Prefect Server ←→ FastAPI (trigger flows via Prefect API)
★ Prefect Worker  →  runs ETL flows (calls existing service functions)
★ React Flow canvas (frontend only, no new backend endpoints)
```

新增 Docker 服务：`prefect-server`（Prefect 3.x 内置 Server）、`prefect-worker`（执行 Flow 的工作进程）。

---

## 5. 优先级排序

按业务价值 / 实现复杂度排序：

| 优先级 | 功能 | 理由 |
|--------|------|------|
| P1 | SFTP 自动定时拉取 | 用户最痛点；复用现有 SFTP 代码；依赖 Prefect |
| P1 | Prefect 调度引擎基础 | 解锁自动化；P2/P3 都依赖它 |
| P2 | 数据质量报告 | 高频需求；DuckDB 已有；不阻塞其他功能 |
| P2 | 工作空间 + 角色权限 | 多团队使用的前提；需数据库迁移 |
| P3 | React Flow 画布 | 体验提升而非功能缺失；Phase 1 表单 UI 可持续使用 |

---

## 6. Phase 1 → Phase 2 迁移路径

- **数据库**：所有新表通过 Alembic 迁移添加；现有表新增列均设默认值，零停机
- **API**：所有 Phase 1 API 保持向后兼容；新增 API 以新路径暴露（`/api/v2/...`）
- **前端**：表单页保留；画布页作为新路由 `/canvas` 新增，不替换现有页面
- **调度**：Phase 1 手动触发端点（`POST /execute/*`）继续可用；Prefect 触发通过相同 service 函数实现，无代码重复

---

## 7. 估算工期（参考）

| 阶段 | 内容 | 估计工期 |
|------|------|---------|
| Phase 2-A | Prefect 接入 + SFTP 自动拉取 + 调度 UI | 3 天 |
| Phase 2-B | 数据质量报告层 | 2 天 |
| Phase 2-C | 工作空间隔离 + 角色权限 | 3 天 |
| Phase 2-D | React Flow 画布（基础版） | 4 天 |
| **合计** | | **约 12 天** |
