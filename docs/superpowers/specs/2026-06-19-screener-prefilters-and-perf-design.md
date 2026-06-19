# Stock Screener: Pre-filters + Performance Fix

Date: 2026-06-19 | Status: Design Approved

## Summary

Two changes to the Stock Screener (条件选股):
1. Add a stock pool pre-filter layer (same as Strategy Factory's pool selector) that runs before technical indicator cards
2. Fix page-load lag caused by blocking bridge DB queries on the Qt main thread

## Architecture

### Data Flow

```
User clicks "开始选股"
  │
  ▼
Stage 0: Index Resolution (FRONTEND — existing logic, unchanged)
  Input:  pool_source (all/hs300/zz500/...), custom_codes
  Process: bridge.get_index_stocks() → resolved stock code list
  Output:  resolved_stock_pool (list of pure-digit codes, or null for full market)
  │
  ▼
Stage 1: Pool Pre-filtering (BACKEND — NEW)
  Input:  resolved_stock_pool + industry, concepts, concept_match,
          market_cap_min/max, float_shares_min/max
  Process: Sequential narrowing on resolved pool (or full market if null)
    1. Industry filter (stock_industry_detail lookup)
    2. Concept filter (stock_concept + concept join lookup)
    3. Market cap filter (stock_financial.total_mv)
    4. Float shares filter (stock_financial.float_shares)
  Output:  Reduced stock code list
  Early exit: If pool empty after any step, return "无符合条件" immediately
  │
  ▼
Stage 2: Technical Indicator Screening (EXISTING)
  Input:  Stage 1 stock pool + condition cards + date range + logic
  Process: Existing screen_stocks_batch logic (unchanged)
  Output:  Matched stocks with details
```

### Component Changes

| File | Change |
|------|--------|
| `js/stockScreener.js` | Add pool pre-filter UI + state; refactor render to non-blocking |
| `backend/stock_screener.py` | Add `_apply_pre_filters()` method; new `screen_stocks_batch` accepts `pre_filters` dict |
| `app/web_bridge.py` | Add in-memory cache for concept/industry/trade_date; update `screen_stocks` slot signature |
| `app/main_window.py` | Pre-warm caches on app startup (optional, can lazy-load) |

### Backward Compatibility

- `pre_filters=None` → behaves exactly as before (full market scan)
- Old saved templates without pre-filters → pre-filters default to "全市场 / no filters"
- Bridge `screen_stocks` slot accepts new `pre_filters_json` parameter with default `""`

## UI Layout

Pre-filter section inserted above the condition card list, collapsible:

```
┌─ 🔎 条件选股 ──────────────────────────────────────────────┐
│  📦 股票池预筛选                        [折叠/展开]        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 来源: ○全市场 ○沪深300 ○中证500 ○中证1000            │  │
│  │       ○创业板 ○科创50 ○自定义                        │  │
│  │ 自定义代码: [________] (仅"自定义"时显示)             │  │
│  │ 行业: [下拉]  概念: [多选搜索]  匹配: ○任一 ○全部    │  │
│  │ 市值范围: [____] ~ [____] 亿元                        │  │
│  │ 流通股本: [____] ~ [____] 亿股                        │  │
│  │ 📊 当前股票池: {n} 只                                 │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                           │
│  (existing: date range, logic toggle, condition cards...)  │
└───────────────────────────────────────────────────────────┘
```

- Default: expanded
- Pool count updates on any filter change (debounced 300ms)
- Concept multi-select reuses the search+checkbox pattern from strategyBuilder.js

## Python API

### `screen_stocks_batch` signature change

```python
def screen_stocks_batch(self, cards: list, stock_pool: list = None,
                        start_date: str = None, end_date: str = None,
                        logic: str = "AND",
                        pre_filters: dict = None) -> list:
```

### `pre_filters` schema

`pool_source` and `custom_codes` are resolved by frontend (Stage 0) into `stock_pool` (same as existing parameter). Python only handles DB-based filters:

```python
{
    "industry": "银行",              # str or None
    "concepts": ["新能源", "人工智能"], # list or None
    "concept_match": "any" | "all",  # default "any"
    "market_cap_min": 50,      # float (亿元), None = no limit
    "market_cap_max": 500,     # float (亿元), None = no limit
    "float_shares_min": 1.0,   # float (亿股), None = no limit
    "float_shares_max": 10.0,  # float (亿股), None = no limit
}
```

The incoming `stock_pool` (already resolved from index/custom codes by frontend) is further narrowed by these filters. If `stock_pool` is null (full market), all filters are applied against the full stock universe.

### `_apply_pre_filters(input_codes, db_engine, pre_filters)` new method

Takes a list of pure-digit stock codes (or None for full market) and narrows by DB-based filters. Returns narrowed list. Applies filters sequentially. Each step logs count to console.

- Industry: `stock_industry_detail.industry_level1` lookup
- Concepts: `stock_concept JOIN concept ON concept_id` for `concept_name` match
- Market cap: `stock_financial.total_mv` in range
- Float shares: `stock_financial.float_shares` in range

If any step reduces pool to zero, returns empty list immediately.

## Performance Fix

### Root Cause

Three synchronous `@Slot` DB queries block the Qt event loop on page load each time:

| Call | SQL | Issue |
|------|-----|-------|
| `get_concept_list` | `SELECT concept_name FROM concept` | Returns 100s of rows |
| `get_industry_list` | `SELECT DISTINCT industry_level1 FROM stock_industry_detail` | Moderate |
| `get_latest_trading_date` | `SELECT MAX(trade_date) FROM stock_daily_qfq_with_name` | Full table scan on 2.7GB |

### Fix 1: Python in-memory cache

Add to `WebBridge.__init__`:

```python
self._concept_list_cache = None       # loaded on first access
self._industry_list_cache = None
self._latest_trade_date_cache = None
```

Each slot method checks cache first, returns instantly if hit. Cache populated on first access (or pre-warmed at startup).

### Fix 2: Database index

```sql
CREATE INDEX IF NOT EXISTS idx_sd_trade_date 
ON stock_daily_qfq_with_name(trade_date);
```

Changes `MAX(trade_date)` from O(n) table scan to O(log n) index lookup.

### Fix 3: Non-blocking frontend render

`renderScreenerPage` renders the full HTML skeleton immediately. All bridge calls (`get_latest_trading_date`, `get_concept_list`, etc.) are already async (`bridge.xxx().then(...)`) — ensure they do not block initial DOM insertion. Date inputs show sensible defaults before async data arrives.

## Session Storage

Pre-filter state is persisted alongside existing screener state in `saveScreenerState()` / `loadScreenerState()`:

```
tquant_screener_state: {
    ...existing,
    poolSource, customCodes,
    industryFilter, conceptFilter, conceptMatchMode,
    marketCapMin, marketCapMax,
    floatSharesMin, floatSharesMax
}
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Concept/industry list load fails | Dropdown shows "加载失败", filter skipped, rest proceeds |
| Index constituent fetch fails | Falls back to full market, toast warning |
| Pre-filter result is empty pool | "无符合条件股票，请调整预筛选", no stage 2 |
| DB index creation fails | Silent ignore, logs warning |
| `pre_filters` key missing | Treated as no filter (same as `None`) |

## Testing

- [ ] Each pre-filter layer produces correct narrowing independently
- [ ] Combined pre-filters intersect correctly (industry AND concept AND market_cap)
- [ ] Empty post-filter pool returns early without running indicators
- [ ] Page load < 500ms after first visit (cache warm)
- [ ] Old templates without pre_filters backward compatible
- [ ] Custom codes + pre-filters intersect correctly
- [ ] Session state saves and restores pre-filter values
