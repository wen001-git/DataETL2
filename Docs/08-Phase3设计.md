# DataETL2 — Phase 3 设计文档：运营智能（已归档）

> **注意**：本文档已合并至 `07-后续规划路线图.md`（按执行依赖顺序组织）。请以路线图为准。

**版本**: v0.1  
**日期**: 2026-05-05  
**状态**: 已归档

---

## 1. 背景与目标

Phase 1 打通了手动 ETL 全链路，Phase 2 引入了调度自动化、数据质量检查和权限隔离。

Phase 2 结束后，系统仍存在两个关键缺口：

| 缺口 | 影响 |
|------|------|
| 数据必须导出为 Excel/CSV 才能查看趋势 | 非技术用户无法在系统内直接理解数据含义 |
| 无法追溯"这行数据从哪来、经过哪些变换" | 出现数据异常时排查困难，变更配置时不知道影响范围 |

Phase 3 目标：让系统从"数据管道工具"升级为"运营智能平台"——数据不仅能流动，还能在系统内被理解和追溯。

---

## 2. 功能范围

### 2.1 仪表盘（Dashboard）

**目标**：用户无需导出文件，在 Web UI 内直接以图表形式查看 ADS 层数据。

#### 核心设计

- 每个 DataSource 可配置多张图表（Chart），多张图表可组合为一个仪表盘（Dashboard）
- 图表数据源 = ADS 层已有数据（`etl_ads.<user_table>`），无需新建数据存储
- 图表配置（轴字段、聚合方式、过滤条件、样式）存入新表 `etl_meta.chart_configs`
- 仪表盘支持手动刷新和"上次执行时间"显示

#### 支持的图表类型

| 类型 | 适用场景 |
|------|---------|
| 折线图（Line） | 时间序列趋势（如月度销售额）|
| 柱状图（Bar） | 分类对比（如各产品线收入）|
| 饼图/环形图（Pie/Donut） | 占比分析（如各渠道占比）|
| 数字卡片（KPI Card） | 单一核心指标（如本月总金额）|
| 数据表格（Table） | 明细数据展示（不需要图形化的场景）|

#### 图表配置参数

```
chart_type        折线/柱状/饼图/KPI卡片/表格
x_field           X 轴字段（时间轴或分类轴）
y_field           Y 轴字段（数值字段）
agg_func          聚合函数（SUM/AVG/COUNT/MAX/MIN，KPI 卡片用）
color_field       分组着色字段（可选，用于堆叠图）
filter_expr       附加过滤条件（DuckDB SQL WHERE 子句，可选）
sort_order        排序（ASC/DESC by x_field）
title             图表标题
```

#### 新增数据模型

```sql
CREATE TABLE etl_meta.dashboards (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  workspace_id  INT NOT NULL DEFAULT 1,
  name          VARCHAR(200) NOT NULL,
  description   TEXT,
  created_by    INT NOT NULL,
  created_at    DATETIME DEFAULT NOW(),
  updated_at    DATETIME DEFAULT NOW() ON UPDATE NOW()
);

CREATE TABLE etl_meta.chart_configs (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  dashboard_id  INT NOT NULL,
  data_source_id INT NOT NULL,
  chart_type    ENUM('line','bar','pie','kpi','table') NOT NULL,
  config_json   JSON NOT NULL,   -- x_field, y_field, agg_func, filter_expr, title, etc.
  sort_order    INT DEFAULT 0,
  created_at    DATETIME DEFAULT NOW()
);
```

#### API 设计

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/v1/dashboards` | 列出所有仪表盘 |
| POST | `/api/v1/dashboards` | 创建仪表盘 |
| GET | `/api/v1/dashboards/{id}` | 获取仪表盘（含所有图表配置）|
| PUT | `/api/v1/dashboards/{id}` | 更新仪表盘基本信息 |
| DELETE | `/api/v1/dashboards/{id}` | 删除仪表盘 |
| POST | `/api/v1/dashboards/{id}/charts` | 添加图表到仪表盘 |
| PUT | `/api/v1/dashboards/{id}/charts/{chart_id}` | 更新图表配置 |
| DELETE | `/api/v1/dashboards/{id}/charts/{chart_id}` | 删除图表 |
| GET | `/api/v1/dashboards/{id}/charts/{chart_id}/data` | 查询图表数据（DuckDB 执行）|

图表数据查询在后端由 DuckDB 执行，前端只接收 `{columns, rows}` 格式数据，与现有 preview 端点一致。

#### 前端实现

- 新增页面「仪表盘」（`/dashboard`），侧边栏新增菜单项
- 仪表盘列表页 → 点击进入单个仪表盘编辑/查看页
- 图表渲染库：**Apache ECharts**（via `echarts-for-react`）
  - 比 recharts 支持更多图表类型，大数据量渲染性能更好
  - MIT 协议，活跃维护
- 图表配置使用侧边抽屉（Drawer）表单，实时预览效果
- KPI 卡片使用 Ant Design `Statistic` 组件

---

### 2.2 数据血缘（Data Lineage）

**目标**：在 UI 上可视化展示"某条 ADS 数据来自哪些原始文件，经过哪些执行步骤变换而来"，以及"如果修改某个字段映射，哪些下游表会受影响"。

血缘分两个维度：

#### 维度 A：执行血缘（Run Lineage）——追溯某次数据从哪来

回答问题：「本周 ADS 结果从哪些上传文件生成的？中间经过几次执行？」

数据已基本具备（`etl_meta.executions` + `etl_raw._run_id` + `etl_raw._src_file`），需要：

1. **新增 `execution_lineage` 表**——记录每次执行消费了哪些 run_id 的 Raw 数据：

```sql
CREATE TABLE etl_meta.execution_lineage (
  id              INT PRIMARY KEY AUTO_INCREMENT,
  execution_id    INT NOT NULL,                  -- 指向 executions.id
  source_run_ids  JSON NOT NULL,                 -- Raw 层中消费的 _run_id 列表
  source_files    JSON NOT NULL,                 -- 对应的 _src_file 列表
  recorded_at     DATETIME DEFAULT NOW()
);
```

2. **在 etl_service.py 执行完 Raw→DWD 后**，查询本次写入 DWD 的行所对应的 `_run_id` / `_src_file`，写入 `execution_lineage`

3. **血缘查询 API**：

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/v1/datasources/{ds_id}/lineage/runs` | 查询执行链路血缘图数据 |
| GET | `/api/v1/datasources/{ds_id}/lineage/files` | 列出所有贡献过数据的源文件 |

#### 维度 B：配置血缘（Config Lineage）——追溯字段如何被变换

回答问题：「`amount` 字段在 DWD 中叫什么？经过哪个聚合函数变成了 DWS 的 `total_amount`？」

需要新增：

1. **`mapping_versions` 表**——每次保存字段映射时记录快照：

```sql
CREATE TABLE etl_meta.mapping_versions (
  id              INT PRIMARY KEY AUTO_INCREMENT,
  data_source_id  INT NOT NULL,
  snapshot_json   JSON NOT NULL,   -- 当时完整的 field_mappings 配置
  saved_by        INT NOT NULL,
  saved_at        DATETIME DEFAULT NOW()
);
```

2. **`mappings.py` PUT 端点**在原子替换映射后，同步写入一条 `mapping_versions` 快照

3. **配置血缘 API**：

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/v1/datasources/{ds_id}/lineage/config` | 返回该数据源完整的字段变换链（raw→dwd→dws→ads）|
| GET | `/api/v1/datasources/{ds_id}/lineage/config/history` | 返回历史映射版本列表 |
| GET | `/api/v1/datasources/{ds_id}/lineage/config/diff?v1=&v2=` | 对比两个版本的映射差异 |

#### 血缘可视化

- 新增页面「数据血缘」（`/lineage`）
- 使用 **React Flow**（Phase 2 已引入）渲染有向无环图（DAG）
- **执行血缘视图**：源文件节点 → Raw 节点 → DWD 节点 → DWS 节点 → ADS 节点，边上显示执行时间和行数
- **配置血缘视图**：纵向字段列表，横向显示 Raw → DWD → DWS → ADS 的字段变换路径；点击字段高亮其完整变换链
- 点击任意节点可展开查看详情（执行 ID、时间、行数、源文件名）

---

## 3. 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 图表渲染 | `echarts-for-react` (Apache ECharts) | 支持折线/柱状/饼图/散点/热力图；大数据量 canvas 渲染性能优于 SVG-based 库；MIT 协议 |
| 血缘图可视化 | React Flow（Phase 2 已引入） | 复用已有依赖；Phase 2 画布与 Phase 3 血缘图共享节点组件 |
| 图表数据查询 | DuckDB（已有） | 直接对 `etl_ads` 执行 SQL；支持 GROUP BY / ORDER BY / LIMIT，无需新引擎 |
| 血缘数据存储 | MySQL（etl_meta） | 不引入图数据库；血缘关系通过 JSON 字段存储（数据量小，无需专用图存储）|

---

## 4. 架构变化

Phase 2 架构不变，Phase 3 仅新增：

```
★ GET /dashboards/{id}/charts/{chart_id}/data
    → DuckDB 查询 etl_ads.<table>
    → 返回 {columns, rows}（与 preview 端点格式一致，复用前端表格组件）

★ etl_service.py（Raw→DWD 执行后）
    → 写入 execution_lineage（source_run_ids, source_files）

★ mappings.py PUT
    → 写入 mapping_versions 快照

★ GET /datasources/{ds_id}/lineage/*
    → 查询 execution_lineage + mapping_versions + executions
    → 组装 DAG 节点/边数据返回前端
```

**无新增 Docker 服务**。所有新功能在现有 `api` 容器内实现。

---

## 5. 优先级排序

| 优先级 | 功能 | 理由 |
|--------|------|------|
| P1 | 仪表盘 — KPI 卡片 + 折线/柱状图 | 最高频需求；复用现有 ADS 数据；无需新存储 |
| P1 | 配置血缘视图（当前版本） | 对非技术用户帮助最大；字段变换链一目了然 |
| P2 | 仪表盘 — 饼图 + 数据表格 | 补全图表类型 |
| P2 | 执行血缘视图 | 需要新写 execution_lineage 记录逻辑；调试价值高 |
| P3 | 映射版本历史 + diff 对比 | 配置审计能力；配置错误时可回滚查看 |
| P3 | 仪表盘自动刷新 + 定时截图邮件 | 配合 Phase 2 调度引擎；定时发送仪表盘快照到邮箱 |

---

## 6. 与 Phase 2 的依赖关系

| Phase 3 功能 | 依赖 Phase 2 功能 | 说明 |
|-------------|-----------------|------|
| 仪表盘 | 工作空间隔离（P2-C） | dashboard 需要 workspace_id 隔离 |
| 仪表盘自动刷新 | Prefect 调度（P2-A） | 定时重新查询 ADS 数据 |
| 血缘图可视化 | React Flow 画布（P2-D） | 共享节点/边组件 |
| 配置血缘 | 无强依赖 | 可在 Phase 2 启动前单独实现 |

仪表盘的 P1 部分（KPI 卡片 + 图表渲染）和配置血缘（当前版本）可在 Phase 2-C/D 完成前独立开发，不存在硬依赖。

---

## 7. 估算工期（参考）

| 阶段 | 内容 | 估计工期 |
|------|------|---------|
| Phase 3-A | 仪表盘基础（KPI 卡片 + 折线/柱状图 + 数据表格）| 3 天 |
| Phase 3-B | 仪表盘扩展（饼图 + 自动刷新 + 定时邮件）| 2 天 |
| Phase 3-C | 配置血缘（字段变换链 + 版本历史 + diff）| 2 天 |
| Phase 3-D | 执行血缘（运行追溯 DAG + 源文件追溯）| 3 天 |
| **合计** | | **约 10 天** |

---

## 8. 非目标（Phase 3 不做）

- **实时数据推送**（WebSocket / SSE）：仪表盘数据按需查询，不做实时流式更新
- **BI 工具集成**（Grafana / Superset）：保持自包含，不依赖外部 BI 平台
- **跨数据源 JOIN**：仪表盘数据源固定为单一 ADS 表，不支持多表联合查询
- **像素级图表定制**：使用 ECharts 标准主题，不做深度样式定制
