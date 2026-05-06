#!/usr/bin/env bash
# Comprehensive system test for DataETL2.
# Covers: auth, datasource CRUD, file upload (CSV), SFTP pull, field mapping,
#         filter rules, Raw→DWD, DWS agg rules, DWD→DWS, ADS rules, DWS→ADS,
#         export (CSV/Excel), execution history (with filters), data preview
#         (all 4 layers), failure-alert wiring, and edge cases.
# Run from the DataETL2 project root:
#   bash test_system.sh
set -euo pipefail
BASE="http://localhost:8000/api/v1"
CURL="curl --noproxy localhost -s"

PASS=0; FAIL=0; SKIP=0
DS_ID=""
TOKEN=""

# ── helpers ───────────────────────────────────────────────────────────────────

ok()   { echo "  ✅ $1"; ((PASS++)); }
fail() { echo "  ❌ $1"; ((FAIL++)); }
skip() { echo "  ⚠️  $1 (skipped)"; ((SKIP++)); }
hdr()  { echo ""; echo "━━━ $1 ━━━"; }

assert_field() {
  local label="$1" json="$2" field="$3" expected="$4"
  local actual
  actual=$(echo "$json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d$field)" 2>/dev/null || echo "__ERR__")
  if [[ "$actual" == "$expected" ]]; then ok "$label"; else fail "$label (got '$actual', want '$expected')"; fi
}

assert_contains() {
  local label="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -q "$needle"; then ok "$label"; else fail "$label (missing '$needle')"; fi
}

assert_ge() {
  local label="$1" val="$2" min="$3"
  if python3 -c "exit(0 if $val >= $min else 1)" 2>/dev/null; then ok "$label"; else fail "$label ($val < $min)"; fi
}

assert_http() {
  # usage: assert_http "label" <response_body> <expected_key_or_word>
  local label="$1" body="$2" key="$3"
  if echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); assert '$key' in d" 2>/dev/null; then
    ok "$label"
  else
    fail "$label (key '$key' not in response: ${body:0:120})"
  fi
}

# ── pre-test cleanup ──────────────────────────────────────────────────────────

hdr "Pre-test cleanup"
docker compose exec mysql mysql -uroot -prootpassword -e "
  DROP TABLE IF EXISTS etl_raw.raw_sys_test;
  DROP TABLE IF EXISTS etl_dwd.dwd_sys_test;
  DROP TABLE IF EXISTS etl_dws.dws_sys_test;
  DROP TABLE IF EXISTS etl_ads.ads_sys_test;
" 2>/dev/null && ok "Dropped stale test tables" || ok "No stale tables to drop"

# ── CSV test fixture ──────────────────────────────────────────────────────────

CSV_FILE=$(mktemp /tmp/systest_XXXXXX)
mv "$CSV_FILE" "${CSV_FILE}.csv"
CSV_FILE="${CSV_FILE}.csv"
cat > "$CSV_FILE" <<'CSV'
region,product,revenue,units
North,Widget A,1200.50,10
North,Widget B,800.00,8
South,Widget A,950.75,9
South,Widget C,300.00,3
East,Widget B,1100.25,11
East,Widget A,750.00,7
West,Widget C,620.50,6
CSV
ok "Created CSV fixture (7 rows)"

# ═══════════════════════════════════════════════════════════════════════════════
hdr "1. Container health"
# ═══════════════════════════════════════════════════════════════════════════════

STATUS=$(docker compose ps 2>/dev/null)
for svc in api frontend mysql nginx; do
  if echo "$STATUS" | grep -q "$svc" | grep -v "Exit" 2>/dev/null || docker compose ps "$svc" 2>/dev/null | grep -q "Up"; then
    ok "$svc container Up"
  else
    fail "$svc container not running"
  fi
done

HEALTH=$($CURL http://localhost:8000/health)
assert_field "API /health" "$HEALTH" "['status']" "ok"

NGINX=$($CURL -o /dev/null -w "%{http_code}" http://localhost:8080/api/v1/auth/me)
if [[ "$NGINX" == "401" || "$NGINX" == "403" || "$NGINX" == "422" ]]; then
  ok "Nginx proxying API (got $NGINX for unauthenticated /me)"
else
  fail "Nginx proxy check (got HTTP $NGINX)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
hdr "2. Auth"
# ═══════════════════════════════════════════════════════════════════════════════

LOGIN=$($CURL -X POST "$BASE/auth/login" -d "username=admin&password=admin123")
TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])" 2>/dev/null || echo "")
if [[ -n "$TOKEN" ]]; then ok "Login → JWT received"; else fail "Login failed: $LOGIN"; exit 1; fi

ME=$($CURL -H "Authorization: Bearer $TOKEN" "$BASE/auth/me")
assert_field "GET /me returns username" "$ME" "['username']" "admin"

BAD=$($CURL -X POST "$BASE/auth/login" -d "username=admin&password=wrong" -o /dev/null -w "%{http_code}")
if [[ "$BAD" == "401" ]]; then ok "Wrong password → 401"; else fail "Wrong password returned HTTP $BAD"; fi

# ═══════════════════════════════════════════════════════════════════════════════
hdr "3. Datasource CRUD"
# ═══════════════════════════════════════════════════════════════════════════════

AUTH="-H \"Authorization: Bearer $TOKEN\""

CREATE=$($CURL -X POST "$BASE/datasources" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"SysTest DS","source_type":"upload","target_raw_table":"raw_sys_test"}')
DS_ID=$(echo "$CREATE" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo "")
if [[ -n "$DS_ID" ]]; then ok "Create datasource → id=$DS_ID"; else fail "Create datasource failed: $CREATE"; exit 1; fi

GET=$($CURL -H "Authorization: Bearer $TOKEN" "$BASE/datasources/$DS_ID")
assert_field "GET datasource by id" "$GET" "['name']" "SysTest DS"

LIST=$($CURL -H "Authorization: Bearer $TOKEN" "$BASE/datasources")
COUNT=$(echo "$LIST" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
assert_ge "List datasources ≥ 1" "$COUNT" "1"

UPDATE=$($CURL -X PUT "$BASE/datasources/$DS_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"SysTest DS (updated)"}')
assert_field "PUT datasource update name" "$UPDATE" "['name']" "SysTest DS (updated)"

NOTFOUND=$($CURL -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "$BASE/datasources/999999")
if [[ "$NOTFOUND" == "404" ]]; then ok "GET nonexistent datasource → 404"; else fail "Expected 404, got $NOTFOUND"; fi

# ═══════════════════════════════════════════════════════════════════════════════
hdr "4. File upload → etl_raw"
# ═══════════════════════════════════════════════════════════════════════════════

UPLOAD=$($CURL -X POST "$BASE/upload/$DS_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@$CSV_FILE")
RUN_ID=$(echo "$UPLOAD" | python3 -c "import sys,json; print(json.load(sys.stdin)['run_id'])" 2>/dev/null || echo "")
ROWS=$(echo "$UPLOAD" | python3 -c "import sys,json; print(json.load(sys.stdin)['rows_ingested'])" 2>/dev/null || echo "0")
if [[ -n "$RUN_ID" ]]; then ok "Upload CSV → run_id=$RUN_ID"; else fail "Upload failed: $UPLOAD"; fi
if [[ "$ROWS" == "7" ]]; then ok "Upload ingested 7 rows"; else fail "Expected 7 rows, got $ROWS"; fi

# Upload again to verify append (raw should accumulate)
$CURL -X POST "$BASE/upload/$DS_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@$CSV_FILE" > /dev/null
RAW_COUNT=$(docker compose exec mysql mysql -uroot -prootpassword -N -e \
  "SELECT COUNT(*) FROM etl_raw.raw_sys_test;" 2>/dev/null | tr -d '[:space:]')
if [[ "$RAW_COUNT" == "14" ]]; then ok "Second upload appended (raw=14 rows total)"; else fail "Expected 14 raw rows, got $RAW_COUNT"; fi

# Raw-columns endpoint
RAWCOLS=$($CURL -H "Authorization: Bearer $TOKEN" "$BASE/datasources/$DS_ID/raw-columns")
assert_contains "raw-columns includes 'revenue'" "$RAWCOLS" "revenue"

# ═══════════════════════════════════════════════════════════════════════════════
hdr "5. Field mappings"
# ═══════════════════════════════════════════════════════════════════════════════

MAPPINGS_PUT=$($CURL -X PUT "$BASE/datasources/$DS_ID/mappings" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "target_dwd_table": "dwd_sys_test",
    "mappings": [
      {"src_field":"region",  "dst_field":"region",  "dst_type":"string",  "skip":false,"sort_order":0},
      {"src_field":"product", "dst_field":"product", "dst_type":"string",  "skip":false,"sort_order":1},
      {"src_field":"revenue", "dst_field":"revenue", "dst_type":"float",   "skip":false,"sort_order":2},
      {"src_field":"units",   "dst_field":"units",   "dst_type":"integer", "skip":false,"sort_order":3}
    ]
  }')
MAP_COUNT=$(echo "$MAPPINGS_PUT" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
if [[ "$MAP_COUNT" == "4" ]]; then ok "PUT mappings → 4 saved"; else fail "Expected 4 mappings, got $MAP_COUNT: $MAPPINGS_PUT"; fi

MAPPINGS_GET=$($CURL -H "Authorization: Bearer $TOKEN" "$BASE/datasources/$DS_ID/mappings")
assert_field "GET mappings target_dwd_table" "$MAPPINGS_GET" "[0]['target_dwd_table']" "dwd_sys_test"

# ═══════════════════════════════════════════════════════════════════════════════
hdr "6. Filter rules"
# ═══════════════════════════════════════════════════════════════════════════════

FILTER_PUT=$($CURL -X PUT "$BASE/datasources/$DS_ID/filter-rules" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rules":[{"field_name":"revenue","operator":"gt","value":"500","logic":"AND","sort_order":0}]}')
# PUT returns a list of saved rule objects
FILTER_PUT_COUNT=$(echo "$FILTER_PUT" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
if [[ "$FILTER_PUT_COUNT" == "1" ]]; then ok "PUT filter rule saved (1 rule)"; else fail "Expected 1 rule saved, got $FILTER_PUT_COUNT: $FILTER_PUT"; fi

FILTER_GET=$($CURL -H "Authorization: Bearer $TOKEN" "$BASE/datasources/$DS_ID/filter-rules")
FRULE_COUNT=$(echo "$FILTER_GET" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d))" 2>/dev/null || echo "0")
if [[ "$FRULE_COUNT" == "1" ]]; then ok "GET filter rules → 1 rule"; else fail "Expected 1 rule, got $FRULE_COUNT"; fi

# ═══════════════════════════════════════════════════════════════════════════════
hdr "7. Execute Raw→DWD"
# ═══════════════════════════════════════════════════════════════════════════════

ETL1=$($CURL -X POST "$BASE/datasources/$DS_ID/execute/raw-to-dwd" \
  -H "Authorization: Bearer $TOKEN")
STATUS1=$(echo "$ETL1" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null || echo "")
if [[ "$STATUS1" == "success" ]]; then ok "Raw→DWD status=success"; else fail "Raw→DWD failed: $ETL1"; fi

ROWS1=$(echo "$ETL1" | python3 -c "import sys,json; print(json.load(sys.stdin).get('rows_written',0))" 2>/dev/null || echo "0")
# filter revenue>500: North/Widget A(1200.5), North/Widget B(800), South/Widget A(950.75), East/Widget B(1100.25), East/Widget A(750), West/Widget C(620.5) → 6 pass × 2 uploads = 12
if [[ "$ROWS1" == "12" ]]; then ok "Raw→DWD wrote 12 rows (filter revenue>500, 2 uploads)"; else fail "Expected 12 DWD rows, got $ROWS1"; fi

DWD_COLS=$($CURL -H "Authorization: Bearer $TOKEN" "$BASE/datasources/$DS_ID/dwd-columns")
assert_contains "dwd-columns includes 'revenue'" "$DWD_COLS" "revenue"

# ═══════════════════════════════════════════════════════════════════════════════
hdr "8. DWS aggregation rules + Execute DWD→DWS"
# ═══════════════════════════════════════════════════════════════════════════════

AGG_PUT=$($CURL -X PUT "$BASE/datasources/$DS_ID/agg-rules" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "src_dwd_table":"dwd_sys_test",
    "target_dws_table":"dws_sys_test",
    "group_by_fields":["region"],
    "agg_functions":[
      {"field":"revenue","func":"SUM","alias":"total_revenue"},
      {"field":"units",  "func":"SUM","alias":"total_units"},
      {"field":"product","func":"COUNT_DISTINCT","alias":"product_count"}
    ]
  }')
assert_http "PUT agg rule saved" "$AGG_PUT" "id"

AGG_GET=$($CURL -H "Authorization: Bearer $TOKEN" "$BASE/datasources/$DS_ID/agg-rules")
assert_field "GET agg rule target_dws_table" "$AGG_GET" "['target_dws_table']" "dws_sys_test"

ETL2=$($CURL -X POST "$BASE/datasources/$DS_ID/execute/dwd-to-dws" \
  -H "Authorization: Bearer $TOKEN")
STATUS2=$(echo "$ETL2" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null || echo "")
if [[ "$STATUS2" == "success" ]]; then ok "DWD→DWS status=success"; else fail "DWD→DWS failed: $ETL2"; fi

# 4 distinct regions in the data
ROWS2=$(echo "$ETL2" | python3 -c "import sys,json; print(json.load(sys.stdin).get('rows_written',0))" 2>/dev/null || echo "0")
if [[ "$ROWS2" == "4" ]]; then ok "DWD→DWS wrote 4 rows (4 regions)"; else fail "Expected 4 DWS rows, got $ROWS2"; fi

DWS_COLS=$($CURL -H "Authorization: Bearer $TOKEN" "$BASE/datasources/$DS_ID/dws-columns")
assert_contains "dws-columns includes 'total_revenue'" "$DWS_COLS" "total_revenue"

# ═══════════════════════════════════════════════════════════════════════════════
hdr "9. ADS rules + Execute DWS→ADS"
# ═══════════════════════════════════════════════════════════════════════════════

ADS_PUT=$($CURL -X PUT "$BASE/datasources/$DS_ID/ads-rules" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "src_dws_table":"dws_sys_test",
    "target_ads_table":"ads_sys_test",
    "selected_fields":[],
    "order_by":[{"field":"total_revenue","direction":"DESC"}],
    "limit_rows":10
  }')
assert_http "PUT ADS rule saved" "$ADS_PUT" "id"

ADS_GET=$($CURL -H "Authorization: Bearer $TOKEN" "$BASE/datasources/$DS_ID/ads-rules")
assert_field "GET ADS rule target_ads_table" "$ADS_GET" "['target_ads_table']" "ads_sys_test"

ETL3=$($CURL -X POST "$BASE/datasources/$DS_ID/execute/dws-to-ads" \
  -H "Authorization: Bearer $TOKEN")
STATUS3=$(echo "$ETL3" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null || echo "")
if [[ "$STATUS3" == "success" ]]; then ok "DWS→ADS status=success"; else fail "DWS→ADS failed: $ETL3"; fi

ROWS3=$(echo "$ETL3" | python3 -c "import sys,json; print(json.load(sys.stdin).get('rows_written',0))" 2>/dev/null || echo "0")
if [[ "$ROWS3" == "4" ]]; then ok "DWS→ADS wrote 4 rows"; else fail "Expected 4 ADS rows, got $ROWS3"; fi

# Verify ORDER BY: highest total_revenue first (North: 1200.5+800 = 2000.5 × 2 uploads)
TOP_REGION=$(docker compose exec mysql mysql -uroot -prootpassword -N -e \
  "SELECT region FROM etl_ads.ads_sys_test ORDER BY total_revenue DESC LIMIT 1;" 2>/dev/null | tr -d '[:space:]')
if [[ "$TOP_REGION" == "North" ]]; then ok "ADS ORDER BY DESC: top region is North"; else fail "Expected North on top, got '$TOP_REGION'"; fi

# ═══════════════════════════════════════════════════════════════════════════════
hdr "10. Data export"
# ═══════════════════════════════════════════════════════════════════════════════

CSV_EXPORT=$(mktemp /tmp/export_XXXXXX.csv)
CSV_STATUS=$($CURL -H "Authorization: Bearer $TOKEN" \
  "$BASE/datasources/$DS_ID/export?format=csv" \
  -o "$CSV_EXPORT" -w "%{http_code}")
if [[ "$CSV_STATUS" == "200" ]]; then ok "Export CSV → HTTP 200"; else fail "Export CSV returned $CSV_STATUS"; fi
CSV_LINES=$(wc -l < "$CSV_EXPORT" | tr -d ' ')
if [[ "$CSV_LINES" -ge "5" ]]; then ok "CSV export has ≥5 lines (header + 4 data rows)"; else fail "CSV only has $CSV_LINES lines"; fi
assert_contains "CSV contains 'total_revenue'" "$(cat "$CSV_EXPORT")" "total_revenue"
rm -f "$CSV_EXPORT"

XLSX_STATUS=$($CURL -H "Authorization: Bearer $TOKEN" \
  "$BASE/datasources/$DS_ID/export?format=excel" \
  -o /dev/null -w "%{http_code}")
if [[ "$XLSX_STATUS" == "200" ]]; then ok "Export Excel → HTTP 200"; else fail "Export Excel returned $XLSX_STATUS"; fi

# ═══════════════════════════════════════════════════════════════════════════════
hdr "11. Execution history"
# ═══════════════════════════════════════════════════════════════════════════════

HIST=$($CURL -H "Authorization: Bearer $TOKEN" "$BASE/datasources/$DS_ID/executions")
HIST_COUNT=$(echo "$HIST" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
if [[ "$HIST_COUNT" -ge "3" ]]; then ok "Execution history has ≥3 records"; else fail "Expected ≥3 records, got $HIST_COUNT"; fi

# Verify descending order by started_at (compare timestamps, not IDs — IDs can be
# non-deterministic when multiple executions finish within the same second)
FIRST_TS=$(echo "$HIST" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['started_at'] or '')" 2>/dev/null || echo "")
LAST_TS=$(echo "$HIST" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[-1]['started_at'] or '')" 2>/dev/null || echo "")
if python3 -c "exit(0 if '$FIRST_TS' >= '$LAST_TS' else 1)" 2>/dev/null; then
  ok "History ordered by started_at DESC (newest first)"
else
  fail "History not in descending order (first=$FIRST_TS, last=$LAST_TS)"
fi

# Filter by status=success
HIST_SUCCESS=$($CURL -H "Authorization: Bearer $TOKEN" "$BASE/datasources/$DS_ID/executions?status=success")
SUCC_COUNT=$(echo "$HIST_SUCCESS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d))" 2>/dev/null || echo "0")
if [[ "$SUCC_COUNT" -ge "3" ]]; then ok "Filter status=success → ≥3 records"; else fail "Expected ≥3 success records, got $SUCC_COUNT"; fi

# Filter by layer_from=dwd
HIST_DWD=$($CURL -H "Authorization: Bearer $TOKEN" "$BASE/datasources/$DS_ID/executions?layer_from=dwd")
DWD_COUNT=$(echo "$HIST_DWD" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
if [[ "$DWD_COUNT" -ge "1" ]]; then ok "Filter layer_from=dwd → ≥1 record"; else fail "Expected ≥1 dwd record, got $DWD_COUNT"; fi

# All returned records should have layer_from=dwd
BAD_LAYER=$(echo "$HIST_DWD" | python3 -c "
import sys,json
d=json.load(sys.stdin)
bad=[r for r in d if r['layer_from']!='dwd']
print(len(bad))
" 2>/dev/null || echo "1")
if [[ "$BAD_LAYER" == "0" ]]; then ok "Filter layer_from=dwd: all records match"; else fail "$BAD_LAYER records have wrong layer_from"; fi

# ═══════════════════════════════════════════════════════════════════════════════
hdr "12. Data preview (all 4 layers)"
# ═══════════════════════════════════════════════════════════════════════════════

for layer in raw dwd dws ads; do
  PREV=$($CURL -H "Authorization: Bearer $TOKEN" \
    "$BASE/datasources/$DS_ID/preview/$layer?page=1&page_size=10")
  PTOTAL=$(echo "$PREV" | python3 -c "import sys,json; print(json.load(sys.stdin)['total'])" 2>/dev/null || echo "-1")
  PCOLS=$(echo "$PREV" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['columns']))" 2>/dev/null || echo "0")
  PROWS=$(echo "$PREV" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['rows']))" 2>/dev/null || echo "0")
  if [[ "$PTOTAL" -ge "1" && "$PCOLS" -ge "1" ]]; then
    ok "Preview $layer: total=$PTOTAL cols=$PCOLS rows_page=$PROWS"
  else
    fail "Preview $layer failed (total=$PTOTAL, cols=$PCOLS): ${PREV:0:120}"
  fi
done

# Verify pagination: request page 1 with page_size=2 on raw (14 rows → 7 pages)
PREV_P=$($CURL -H "Authorization: Bearer $TOKEN" \
  "$BASE/datasources/$DS_ID/preview/raw?page=1&page_size=2")
P_PAGE_ROWS=$(echo "$PREV_P" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['rows']))" 2>/dev/null || echo "0")
P_TOTAL=$(echo "$PREV_P" | python3 -c "import sys,json; print(json.load(sys.stdin)['total'])" 2>/dev/null || echo "0")
if [[ "$P_PAGE_ROWS" == "2" && "$P_TOTAL" == "14" ]]; then
  ok "Preview pagination: page_size=2 returns 2 rows, total=14"
else
  fail "Preview pagination: expected page_rows=2 total=14, got page_rows=$P_PAGE_ROWS total=$P_TOTAL"
fi

# Invalid layer → 400
INVALID_L=$($CURL -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" \
  "$BASE/datasources/$DS_ID/preview/xyz")
if [[ "$INVALID_L" == "400" ]]; then ok "Preview invalid layer → 400"; else fail "Expected 400, got $INVALID_L"; fi

# ═══════════════════════════════════════════════════════════════════════════════
hdr "13. Field mapping helpers (dwd-columns / dws-columns)"
# ═══════════════════════════════════════════════════════════════════════════════

DWD_C=$($CURL -H "Authorization: Bearer $TOKEN" "$BASE/datasources/$DS_ID/dwd-columns")
assert_contains "dwd-columns has 'units'" "$DWD_C" "units"

DWS_C=$($CURL -H "Authorization: Bearer $TOKEN" "$BASE/datasources/$DS_ID/dws-columns")
assert_contains "dws-columns has 'product_count'" "$DWS_C" "product_count"

MISSING_DS_COLS=$($CURL -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" \
  "$BASE/datasources/999999/dwd-columns")
if [[ "$MISSING_DS_COLS" == "404" ]]; then ok "dwd-columns for nonexistent DS → 404"; else fail "Expected 404, got $MISSING_DS_COLS"; fi

# ═══════════════════════════════════════════════════════════════════════════════
hdr "14. Field mapping template download + Excel import"
# ═══════════════════════════════════════════════════════════════════════════════

TMPL_STATUS=$($CURL -H "Authorization: Bearer $TOKEN" \
  "$BASE/datasources/$DS_ID/mappings/template" \
  -o /dev/null -w "%{http_code}")
if [[ "$TMPL_STATUS" == "200" ]]; then ok "Mapping template download → 200"; else fail "Template download returned $TMPL_STATUS"; fi

# ═══════════════════════════════════════════════════════════════════════════════
hdr "15. Edge cases"
# ═══════════════════════════════════════════════════════════════════════════════

# Unauthenticated request → 401/403
UNAUTH=$($CURL -o /dev/null -w "%{http_code}" "$BASE/datasources")
if [[ "$UNAUTH" == "401" || "$UNAUTH" == "403" || "$UNAUTH" == "422" ]]; then
  ok "Unauthenticated request → $UNAUTH"
else
  fail "Expected 401/403/422 for unauth, got $UNAUTH"
fi

# Upload non-CSV → 400
BADFILE=$(mktemp /tmp/bad_XXXXXX.txt)
echo "not a csv" > "$BADFILE"
BAD_UPLOAD_STATUS=$($CURL -X POST "$BASE/upload/$DS_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@$BADFILE" -o /dev/null -w "%{http_code}")
if [[ "$BAD_UPLOAD_STATUS" == "400" ]]; then ok "Upload .txt file → 400"; else fail "Expected 400, got $BAD_UPLOAD_STATUS"; fi
rm -f "$BADFILE"

# Preview datasource with no ADS rule → 404
NEW_DS=$($CURL -X POST "$BASE/datasources" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"EmptyEdge","source_type":"upload","target_raw_table":"raw_edge_never"}')
NEW_DS_ID=$(echo "$NEW_DS" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo "")
if [[ -n "$NEW_DS_ID" ]]; then
  ADS_MISS=$($CURL -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" \
    "$BASE/datasources/$NEW_DS_ID/preview/ads")
  if [[ "$ADS_MISS" == "404" ]]; then ok "Preview ADS with no rule → 404"; else fail "Expected 404, got $ADS_MISS"; fi
  # Cleanup edge DS
  $CURL -X DELETE -H "Authorization: Bearer $TOKEN" "$BASE/datasources/$NEW_DS_ID" > /dev/null
fi

# ═══════════════════════════════════════════════════════════════════════════════
hdr "16. SFTP ingestion path"
# ═══════════════════════════════════════════════════════════════════════════════

# Drop stale SFTP test table
docker compose exec mysql mysql -uroot -prootpassword -e \
  "DROP TABLE IF EXISTS etl_raw.raw_sftp_sys_test;" 2>/dev/null

# Create an SFTP-type datasource
SFTP_DS=$($CURL -X POST "$BASE/datasources" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name":"SysTest SFTP DS",
    "source_type":"sftp",
    "sftp_host":"sftp",
    "sftp_port":22,
    "sftp_user":"etltest",
    "sftp_password":"etltest123",
    "sftp_remote_path":"/upload",
    "sftp_file_pattern":"*.csv",
    "target_raw_table":"raw_sftp_sys_test"
  }')
SFTP_DS_ID=$(echo "$SFTP_DS" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo "")
if [[ -n "$SFTP_DS_ID" ]]; then ok "Create SFTP datasource → id=$SFTP_DS_ID"; else fail "Create SFTP datasource failed: $SFTP_DS"; fi

# Drop a CSV into the bind-mounted sftp-data directory
SFTP_CSV="sftp-data/sftp_sys_test.csv"
cat > "$SFTP_CSV" <<'CSV'
city,sales,qty
Beijing,5000,50
Shanghai,7200,72
Guangzhou,3800,38
CSV
ok "Wrote test CSV to sftp-data/"

# List files via SFTP
if [[ -n "$SFTP_DS_ID" ]]; then
  SFTP_LIST=$($CURL -H "Authorization: Bearer $TOKEN" "$BASE/sftp/$SFTP_DS_ID/list")
  if echo "$SFTP_LIST" | python3 -c "import sys,json; d=json.load(sys.stdin); assert any('sftp_sys_test' in str(f) for f in d)" 2>/dev/null; then
    ok "SFTP list → test CSV visible"
  else
    fail "SFTP list did not show test CSV: ${SFTP_LIST:0:120}"
  fi

  # Pull file via SFTP
  SFTP_PULL=$($CURL -X POST "$BASE/sftp/$SFTP_DS_ID/pull" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"filename":"sftp_sys_test.csv"}')
  SFTP_ROWS=$(echo "$SFTP_PULL" | python3 -c "import sys,json; print(json.load(sys.stdin).get('rows_ingested',0))" 2>/dev/null || echo "0")
  if [[ "$SFTP_ROWS" == "3" ]]; then
    ok "SFTP pull ingested 3 rows into etl_raw"
  else
    fail "SFTP pull: expected 3 rows, got $SFTP_ROWS: $SFTP_PULL"
  fi

  # Verify raw-columns endpoint works for SFTP datasource
  SFTP_RAW_COLS=$($CURL -H "Authorization: Bearer $TOKEN" \
    "$BASE/datasources/$SFTP_DS_ID/raw-columns")
  assert_contains "SFTP raw-columns has 'sales'" "$SFTP_RAW_COLS" "sales"

  # Cleanup
  $CURL -X DELETE -H "Authorization: Bearer $TOKEN" "$BASE/datasources/$SFTP_DS_ID" > /dev/null
  docker compose exec mysql mysql -uroot -prootpassword -e \
    "DROP TABLE IF EXISTS etl_raw.raw_sftp_sys_test;" 2>/dev/null
  ok "Cleaned up SFTP datasource and raw table"
else
  skip "SFTP section skipped (datasource creation failed)"
fi
rm -f "$SFTP_CSV"

# ═══════════════════════════════════════════════════════════════════════════════
hdr "17. Email alert wiring"
# ═══════════════════════════════════════════════════════════════════════════════

# Verify alert is disabled by default (ALERT_EMAIL_ENABLED=false):
# trigger a deliberate failure (no mapping configured on a fresh DS) and confirm
# execution returns {status:failed} without hanging (which would indicate SMTP timeout)
ALERT_DS=$($CURL -X POST "$BASE/datasources" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"AlertTest DS","source_type":"upload","target_raw_table":"raw_alert_never"}')
ALERT_DS_ID=$(echo "$ALERT_DS" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo "")
if [[ -n "$ALERT_DS_ID" ]]; then
  # Execute raw-to-dwd with no mappings — should fail fast, not hang on SMTP
  START_NS=$(date +%s)
  FAIL_EXEC=$($CURL -X POST "$BASE/datasources/$ALERT_DS_ID/execute/raw-to-dwd" \
    -H "Authorization: Bearer $TOKEN")
  END_NS=$(date +%s)
  ELAPSED=$(( END_NS - START_NS ))
  FAIL_STATUS=$(echo "$FAIL_EXEC" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
  if [[ "$FAIL_STATUS" == "failed" ]]; then
    ok "Deliberate failure returns status=failed (alert disabled, no SMTP hang)"
  else
    fail "Expected status=failed, got '$FAIL_STATUS'"
  fi
  if [[ "$ELAPSED" -le "5" ]]; then
    ok "Failure response in ${ELAPSED}s (no SMTP timeout block)"
  else
    fail "Response took ${ELAPSED}s — possible SMTP hang"
  fi
  $CURL -X DELETE -H "Authorization: Bearer $TOKEN" "$BASE/datasources/$ALERT_DS_ID" > /dev/null
  ok "AlertTest datasource cleaned up"
fi

# ═══════════════════════════════════════════════════════════════════════════════
hdr "18. Cleanup test datasource"
# ═══════════════════════════════════════════════════════════════════════════════

DEL_STATUS=$($CURL -X DELETE -H "Authorization: Bearer $TOKEN" \
  "$BASE/datasources/$DS_ID" -o /dev/null -w "%{http_code}")
if [[ "$DEL_STATUS" == "204" ]]; then ok "DELETE datasource → 204"; else fail "DELETE returned $DEL_STATUS"; fi

# Confirm gone
GONE=$($CURL -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "$BASE/datasources/$DS_ID")
if [[ "$GONE" == "404" ]]; then ok "Deleted datasource → 404"; else fail "Expected 404 after delete, got $GONE"; fi

docker compose exec mysql mysql -uroot -prootpassword -e "
  DROP TABLE IF EXISTS etl_raw.raw_sys_test;
  DROP TABLE IF EXISTS etl_dwd.dwd_sys_test;
  DROP TABLE IF EXISTS etl_dws.dws_sys_test;
  DROP TABLE IF EXISTS etl_ads.ads_sys_test;
" 2>/dev/null && ok "Dropped test ETL tables"

rm -f "$CSV_FILE"

# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Results: ✅ $PASS passed  ❌ $FAIL failed  ⚠️  $SKIP skipped"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
