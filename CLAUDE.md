# DataETL2 Project Rules

## Documentation update (mandatory)

After completing any development work — finishing a Day milestone, fixing bugs, adding features, or completing a system test — you MUST update the relevant docs BEFORE reporting the work as done. Do not wait for the user to ask.

**Which docs to check each time:**

| Doc | When to update |
|-----|---------------|
| `Docs/00-开发进度.md` | Every task: mark completed items ✅, update the date at the top |
| `Docs/04-系统架构.md` | When new files, services, ports, or APIs are added |
| `Docs/06-手动测试用例.md` | When a new Day milestone is complete: add test cases for the new features and update the smoke test checklist |
| `Docs/01-功能列表.md` | Only if the feature scope changes |
| `Docs/02-软件需求说明书.md` | Only if requirements change |
| `HANDOVER.md` | Every Day milestone: update §7 status table, §8 next steps, §6 if a new bug was fixed |

**Rule**: Update docs as part of the same session as the code change — not as a separate step.

## Changelog in every output document (mandatory)

Every output document (`HANDOVER.md` and all files under `Docs/`) must contain a `## 变更日志` section. The format is:

```markdown
## 变更日志

| 日期 | 变更内容 |
|------|---------|
| YYYY-MM-DD | 描述本次变更 |
```

**Rules**:
- Every time you modify a document, prepend a new row to its `## 变更日志` table (newest entry at the top).
- When creating a new document, add the `## 变更日志` section at the end with an "初始创建" entry.
- The entry should describe *what* changed and *why*, not just "updated".

## Code readability for AI tools (mandatory)

When creating any new Python file, add a module-level comment block (before the imports) that explains:
1. What this file does and its role in the pipeline
2. Any non-obvious design decisions (e.g. why `TRY_CAST` not `CAST`, why `if_exists="append"` not `"replace"`)
3. Relationship to other files it depends on or that depend on it

For non-obvious individual lines, add a short inline comment explaining **why** (not what).

**Timing**: write these comments at the same time as the code — not as a separate pass afterward. Intent is clearest when the code is fresh.

**Do not write**: comments that just restate what the variable name or function name already says; multi-line docstring blocks; references to the current task or issue number.

## Test account

- Username: `admin`  Password: `admin123`
- The password is stored in `etl_meta.users` (not `dataetl2.users`)

## Known gotchas

- `DstType` enum: member names are `float_` / `datetime_` but DB values are `float` / `datetime`. The `values_callable` fix is already in `models/field_mapping.py`.
- curl on this Mac has `http_proxy` set — always use `--noproxy localhost` when testing local endpoints.
- uvicorn `--reload` on Mac needs a file touch inside the container to pick up host-side changes: `docker compose exec api touch <file>`.
- The `etl_meta` schema holds all system tables. Do NOT use the `dataetl2` database for user/metadata queries.
