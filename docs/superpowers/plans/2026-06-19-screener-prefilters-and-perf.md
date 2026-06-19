# Stock Screener Pre-filters + Performance Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add industry/concept/market-cap/float-shares pre-filters to the Stock Screener (matching Strategy Factory's pool selector), and fix page-load lag via Python caching + DB index + non-blocking frontend render.

**Architecture:** Frontend resolves index pool (existing), passes pre-filters to Python alongside stock_pool. Python applies DB-sourced filters (industry, concept, market_cap, float_shares) sequentially in `_apply_pre_filters()` inside `screen_stocks_batch`. Python bridge slots for concept/industry/trade_date are cached in memory on first access. DB index added for `MAX(trade_date)`.

**Tech Stack:** Python (PySide6 Qt slots, pandas, SQLAlchemy), JavaScript (vanilla ES modules, QWebChannel bridge), SQLite

---

### Task 1: Create DB index on trade_date

**Files:**
- Create: `scripts/add_trade_date_index.py` (one-off migration script)
- Modify: `app/web_bridge.py` (add startup index check)

- [ ] **Step 1: Write migration script**

```python
# scripts/add_trade_date_index.py
"""Add index on stock_daily_qfq_with_name.trade_date for fast MAX lookup."""
import sys
sys.path.insert(0, '.')
from backend.db import Database
from sqlalchemy import text

db = Database()
with db.engine.connect() as conn:
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_sd_trade_date "
        "ON stock_daily_qfq_with_name(trade_date)"
    ))
    conn.commit()
print("Index idx_sd_trade_date created (or already exists).")
```

- [ ] **Step 2: Run the migration**

```bash
cd E:/Tquant1 && python scripts/add_trade_date_index.py
```

Expected output: `Index idx_sd_trade_date created (or already exists).`

- [ ] **Step 3: Add index-ensure to WebBridge.__init__**

Read `app/web_bridge.py:89-123` (the `__init__` method). After the existing init code (line 123 `df = DataFeed()`), add index creation. Insert after line 123:

```python
        # Ensure trade_date index exists for fast MAX lookup
        try:
            with self.db.engine.connect() as conn:
                conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS idx_sd_trade_date "
                    "ON stock_daily_qfq_with_name(trade_date)"
                ))
                conn.commit()
        except Exception:
            pass  # non-critical, best-effort
```

- [ ] **Step 4: Commit**

```bash
git add scripts/add_trade_date_index.py app/web_bridge.py
git commit -m "feat: add DB index on trade_date for fast MAX lookup

Creates idx_sd_trade_date on stock_daily_qfq_with_name(trade_date) at
migration time and on every app startup (best-effort)."

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

### Task 2: Add Python in-memory caches to WebBridge

**Files:**
- Modify: `app/web_bridge.py:89-123` (__init__)
- Modify: `app/web_bridge.py:838-858` (get_concept_list)
- Modify: `app/web_bridge.py:847-858` (get_industry_list)
- Modify: `app/web_bridge.py:276-286` (get_latest_trading_date)

- [ ] **Step 1: Add cache fields to __init__**

Read `app/web_bridge.py:86-123`. In `__init__`, after the `db` line (line 94), add:

```python
        # In-memory caches for fast page-load (avoid DB queries on every nav click)
        self._concept_list_cache = None
        self._industry_list_cache = None
        self._latest_trade_date_cache = None
```

- [ ] **Step 2: Update get_concept_list to use cache**

Read `app/web_bridge.py:838-844`. Replace the method body:

```python
    @Slot(result=str)
    def get_concept_list(self):
        """返回所有概念名称列表，用于前端下拉框（带缓存）"""
        if self._concept_list_cache is not None:
            return self._concept_list_cache
        try:
            df = pd.read_sql("SELECT concept_name FROM concept ORDER BY concept_name", self.db.engine)
            self._concept_list_cache = json.dumps(df['concept_name'].tolist(), ensure_ascii=False)
        except Exception as e:
            self._concept_list_cache = json.dumps([])
        return self._concept_list_cache
```

- [ ] **Step 3: Update get_industry_list to use cache**

Read `app/web_bridge.py:847-858`. Replace the method body:

```python
    @Slot(result=str)
    def get_industry_list(self):
        """返回所有一级行业列表（带缓存）"""
        if self._industry_list_cache is not None:
            return self._industry_list_cache
        try:
            df = pd.read_sql(
                "SELECT DISTINCT industry_level1 FROM stock_industry_detail "
                "WHERE industry_level1 IS NOT NULL AND industry_level1 != '' "
                "ORDER BY industry_level1",
                self.db.engine
            )
            self._industry_list_cache = json.dumps(df['industry_level1'].tolist(), ensure_ascii=False)
        except Exception as e:
            self._industry_list_cache = json.dumps([])
        return self._industry_list_cache
```

- [ ] **Step 4: Update get_latest_trading_date to use cache**

Read `app/web_bridge.py:276-286`. Replace the method body:

```python
    @Slot(result=str)
    def get_latest_trading_date(self):
        """返回数据库中全局最新交易日期（带缓存，索引加速）"""
        if self._latest_trade_date_cache is not None:
            return self._latest_trade_date_cache
        try:
            with self.db.engine.connect() as conn:
                row = conn.execute(
                    text("SELECT MAX(trade_date) FROM stock_daily_qfq_with_name")
                ).scalar()
            self._latest_trade_date_cache = json.dumps(
                {"success": True, "date": str(row) if row else None}
            )
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            self._latest_trade_date_cache = json.dumps({"success": False, "error": str(e)})
        return self._latest_trade_date_cache
```

- [ ] **Step 5: Commit**

```bash
git add app/web_bridge.py
git commit -m "perf: add in-memory cache for concept/industry/trade_date bridge slots

Avoids repeated DB queries when navigating to Stock Screener page.
Caches populate on first access and persist for app lifetime."

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

### Task 3: Add _apply_pre_filters to StockScreener backend

**Files:**
- Modify: `backend/stock_screener.py` (add method after line ~87, inside class body)

- [ ] **Step 1: Add _apply_pre_filters method**

Read `backend/stock_screener.py:11-17` for the class definition and imports. Add this method after the `_batch_evaluators` dict (after line 85) and before the `print("StockScreener 初始化成功")` (line 87). Insert at line 86:

```python
    @staticmethod
    def _apply_pre_filters(input_codes, db_engine, pre_filters):
        """Apply pre-filters sequentially to narrow the stock pool.

        Args:
            input_codes: list of pure-digit codes, or None for full market
            db_engine: SQLAlchemy engine
            pre_filters: dict with keys: industry, concepts, concept_match,
                         market_cap_min, market_cap_max,
                         float_shares_min, float_shares_max

        Returns: narrowed list of pure-digit codes, or empty list
        """
        if not pre_filters:
            return input_codes

        codes = list(input_codes) if input_codes else None

        # 1. Industry filter
        industry = pre_filters.get('industry')
        if industry and industry.strip():
            try:
                sql = text(
                    "SELECT ts_code FROM stock_industry_detail "
                    "WHERE industry_level1 = :ind"
                )
                with db_engine.connect() as conn:
                    rows = conn.execute(sql, {"ind": industry}).fetchall()
                ind_codes = {r[0].replace('.SZ', '').replace('.SH', '').replace('.BJ', '')
                             for r in rows}
                if codes is None:
                    codes = list(ind_codes)
                else:
                    codes = [c for c in codes if c in ind_codes]
                print(f"[PreFilter] 行业={industry}: {len(codes)} 只")
                if not codes:
                    return []
            except Exception as e:
                print(f"[PreFilter] 行业筛选失败: {e}")

        # 2. Concept filter
        concepts = pre_filters.get('concepts')
        if concepts and len(concepts) > 0:
            concept_match = pre_filters.get('concept_match', 'any')
            try:
                placeholders = ','.join([f"'{c}'" for c in concepts])
                sql = text(f"""
                    SELECT sc.ts_code
                    FROM stock_concept sc
                    JOIN concept c ON sc.concept_id = c.concept_id
                    WHERE c.concept_name IN ({placeholders})
                """)
                with db_engine.connect() as conn:
                    rows = conn.execute(sql).fetchall()
                # code -> set of matched concepts
                code_concepts = {}
                for r in rows:
                    pure = r[0].replace('.SZ', '').replace('.SH', '').replace('.BJ', '')
                    code_concepts.setdefault(pure, set()).add(r[0])  # use ts_code as proxy for concept name... 
                # Actually, we need concept name. Re-query properly:
                pass
            except Exception as e:
                print(f"[PreFilter] 概念筛选失败: {e}")

        # ...continues below
        return codes if codes else []
```

Wait — the concept filter needs concept names per code. Let me rewrite this properly. The approach needs to be: for each code, what concepts does it have? Then check if the required concepts are a subset (match=all) or intersect (match=any).

Let me rewrite the method properly. The key insight: we need to do a join that returns (code, concept_name), group by code, then filter.

Here's the corrected full method:

```python
    @staticmethod
    def _apply_pre_filters(input_codes, db_engine, pre_filters):
        """Apply DB-sourced pre-filters sequentially.

        Args:
            input_codes: list of pure-digit codes (e.g. ['000001', '600519']),
                         or None for full market
            db_engine: SQLAlchemy engine
            pre_filters: dict, see spec

        Returns: narrowed list of pure-digit codes
        """
        if not pre_filters:
            return input_codes

        codes = list(input_codes) if input_codes else None

        # 1. Industry filter
        industry = (pre_filters.get('industry') or '').strip()
        if industry:
            try:
                sql = text(
                    "SELECT ts_code FROM stock_industry_detail "
                    "WHERE industry_level1 = :ind"
                )
                with db_engine.connect() as conn:
                    rows = conn.execute(sql, {"ind": industry}).fetchall()
                ind_codes = {r[0].replace('.SZ', '').replace('.SH', '').replace('.BJ', '')
                             for r in rows}
                if codes is None:
                    codes = list(ind_codes)
                else:
                    codes = [c for c in codes if c in ind_codes]
                print(f"[PreFilter] 行业={industry}: {len(codes)} 只")
                if not codes:
                    return []
            except Exception as e:
                print(f"[PreFilter] 行业筛选失败: {e}")

        # 2. Concept filter
        concepts = pre_filters.get('concepts')
        if concepts and len(concepts) > 0:
            concept_match = pre_filters.get('concept_match', 'any')
            concept_set = set(concepts)
            try:
                placeholders = ','.join([f"'{c}'" for c in concepts])
                sql = text(f"""
                    SELECT sc.ts_code, c.concept_name
                    FROM stock_concept sc
                    JOIN concept c ON sc.concept_id = c.concept_id
                    WHERE c.concept_name IN ({placeholders})
                """)
                with db_engine.connect() as conn:
                    rows = conn.execute(sql).fetchall()
                # Group matched concept names per pure code
                code_matches = {}
                for r in rows:
                    pure = r[0].replace('.SZ', '').replace('.SH', '').replace('.BJ', '')
                    code_matches.setdefault(pure, set()).add(r[1])
                if concept_match == 'all':
                    valid = {c for c, m in code_matches.items()
                             if concept_set.issubset(m)}
                else:
                    valid = {c for c, m in code_matches.items()
                             if concept_set & m}
                if codes is None:
                    codes = list(valid)
                else:
                    codes = [c for c in codes if c in valid]
                print(f"[PreFilter] 概念={concepts} match={concept_match}: {len(codes)} 只")
                if not codes:
                    return []
            except Exception as e:
                print(f"[PreFilter] 概念筛选失败: {e}")

        # 3. Market cap filter
        mc_min = pre_filters.get('market_cap_min')
        mc_max = pre_filters.get('market_cap_max')
        if mc_min is not None or mc_max is not None:
            try:
                fin_df = pd.read_sql("SELECT ts_code, total_mv FROM stock_financial", db_engine)
                fin_df['code'] = fin_df['ts_code'].str.replace(
                    r'\.(SZ|SH|BJ)$', '', regex=True
                )
                valid_codes = set()
                for _, row in fin_df.iterrows():
                    mv = row['total_mv']
                    if mv is None:
                        continue
                    ok = True
                    if mc_min is not None and mv < mc_min:
                        ok = False
                    if mc_max is not None and mv > mc_max:
                        ok = False
                    if ok:
                        valid_codes.add(row['code'])
                if codes is None:
                    codes = list(valid_codes)
                else:
                    codes = [c for c in codes if c in valid_codes]
                print(f"[PreFilter] 市值 {mc_min}~{mc_max}亿: {len(codes)} 只")
                if not codes:
                    return []
            except Exception as e:
                print(f"[PreFilter] 市值筛选失败: {e}")

        # 4. Float shares filter
        fs_min = pre_filters.get('float_shares_min')
        fs_max = pre_filters.get('float_shares_max')
        if fs_min is not None or fs_max is not None:
            try:
                fin_df = pd.read_sql("SELECT ts_code, float_shares FROM stock_financial", db_engine)
                fin_df['code'] = fin_df['ts_code'].str.replace(
                    r'\.(SZ|SH|BJ)$', '', regex=True
                )
                valid_codes = set()
                for _, row in fin_df.iterrows():
                    fs = row['float_shares']
                    if fs is None:
                        continue
                    ok = True
                    if fs_min is not None and fs < fs_min:
                        ok = False
                    if fs_max is not None and fs > fs_max:
                        ok = False
                    if ok:
                        valid_codes.add(row['code'])
                if codes is None:
                    codes = list(valid_codes)
                else:
                    codes = [c for c in codes if c in valid_codes]
                print(f"[PreFilter] 股本 {fs_min}~{fs_max}亿股: {len(codes)} 只")
                if not codes:
                    return []
            except Exception as e:
                print(f"[PreFilter] 股本筛选失败: {e}")

        return codes if codes else []
```

- [ ] **Step 2: Commit**

```bash
git add backend/stock_screener.py
git commit -m "feat: add _apply_pre_filters to StockScreener for multi-layer pool narrowing

Supports industry, concept (any/all match), market cap range, and float
shares range filters. Each step logs count and exits early on empty pool."

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

### Task 4: Update screen_stocks_batch to accept and apply pre_filters

**Files:**
- Modify: `backend/stock_screener.py:117-283` (screen_stocks_batch method)

- [ ] **Step 1: Update method signature and add pre-filter application**

Read `backend/stock_screener.py:117-133`. Change the signature:

```python
    def screen_stocks_batch(self, cards: list, stock_pool: list = None,
                            start_date: str = None, end_date: str = None,
                            logic: str = "AND",
                            pre_filters: dict = None) -> list:
```

Then after the existing docstring (line 132), before `print(f"[Screener] 股票池: ...")` (line 133), add:

```python
        # Apply pre-filters to narrow stock pool before data loading
        if pre_filters and any(pre_filters.values()):
            print(f"[Screener] 预筛选参数: {pre_filters}")
            filtered = self._apply_pre_filters(stock_pool, self.db.engine, pre_filters)
            print(f"[Screener] 预筛选后股票池: {len(filtered) if filtered else 0} 只")
            if filtered is not None and len(filtered) == 0:
                print("[Screener] 预筛选后股票池为空，直接返回")
                return []
            stock_pool = filtered
```

- [ ] **Step 2: Commit**

```bash
git add backend/stock_screener.py
git commit -m "feat: wire pre_filters into screen_stocks_batch pipeline

Applies _apply_pre_filters before data loading. Returns empty if pool
narrowed to zero. Backward compatible: pre_filters=None skips filtering."

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

### Task 5: Update WebBridge screen_stocks slot to pass pre_filters

**Files:**
- Modify: `app/web_bridge.py:247-273` (screen_stocks method)

- [ ] **Step 1: Update slot signature and body**

Read `app/web_bridge.py:247-273`. Replace the entire method:

```python
    @Slot(str, str, str, str, str, result=str)
    def screen_stocks(self, cards_json, stock_pool_json, start_date, end_date, pre_filters_json=""):
        """批量选股接口：接收卡片列表JSON、股票池JSON、起止日期、预筛选JSON，返回筛选结果"""
        try:
            cards = json.loads(cards_json) if isinstance(cards_json, str) else cards_json
            stock_pool = json.loads(stock_pool_json) if isinstance(stock_pool_json, str) and stock_pool_json else None
            pre_filters = json.loads(pre_filters_json) if isinstance(pre_filters_json, str) and pre_filters_json else None
            if not start_date or start_date.strip() == '':
                start_date = None
            if not end_date or end_date.strip() == '':
                end_date = None

            stocks = self.stock_screener.screen_stocks_batch(
                cards=cards,
                stock_pool=stock_pool if stock_pool else None,
                start_date=start_date,
                end_date=end_date,
                logic="AND",
                pre_filters=pre_filters
            )

            return json.dumps({
                "success": True,
                "total": len(stocks),
                "stocks": stocks
            }, ensure_ascii=False)
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "total": 0, "stocks": [], "error": str(e)},
                              ensure_ascii=False)
```

Note: The `@Slot` decorator adds `pre_filters_json` as the 5th string parameter with default `""`.

- [ ] **Step 2: Commit**

```bash
git add app/web_bridge.py
git commit -m "feat: add pre_filters_json parameter to screen_stocks bridge slot

Passes pre-filter dict through to screen_stocks_batch. Default empty string
maintains backward compatibility with existing callers."

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

### Task 6: Frontend — add pre-filter state and session persistence

**Files:**
- Modify: `js/stockScreener.js:10-16` (module state)
- Modify: `js/stockScreener.js:62-89` (saveScreenerState / loadScreenerState)

- [ ] **Step 1: Add pre-filter state variables**

Read `js/stockScreener.js:10-16`. After line 16 (`var resultPage = 0;`), add:

```js
// Pre-filter state (mirrors Strategy Factory pool selector)
var poolSource = 'all';
var poolCustomCodes = '';
var poolIndustryFilter = '';
var poolConceptFilter = [];
var poolConceptMatchMode = 'any';
var poolMarketCapMin = '';
var poolMarketCapMax = '';
var poolFloatSharesMin = '';
var poolFloatSharesMax = '';
```

- [ ] **Step 2: Update saveScreenerState to include pre-filter state**

Read `js/stockScreener.js:62-75`. Modify the `state` object to include:

```js
function saveScreenerState() {
    var state = {
        cards: cards,
        selectedPool: selectedPool,
        customCodes: customCodes,
        logicMode: logicMode,
        lastResults: lastResults,
        resultPage: resultPage,
        poolSource: poolSource,
        poolCustomCodes: poolCustomCodes,
        poolIndustryFilter: poolIndustryFilter,
        poolConceptFilter: poolConceptFilter,
        poolConceptMatchMode: poolConceptMatchMode,
        poolMarketCapMin: poolMarketCapMin,
        poolMarketCapMax: poolMarketCapMax,
        poolFloatSharesMin: poolFloatSharesMin,
        poolFloatSharesMax: poolFloatSharesMax
    };
    try {
        sessionStorage.setItem('tquant_screener_state', JSON.stringify(state));
    } catch (e) {}
}
```

- [ ] **Step 3: Update loadScreenerState to restore pre-filter state**

Read `js/stockScreener.js:76-89`. Add restoration after existing fields:

```js
function loadScreenerState() {
    var saved = sessionStorage.getItem('tquant_screener_state');
    if (!saved) return false;
    try {
        var state = JSON.parse(saved);
        cards = state.cards || [];
        selectedPool = state.selectedPool || 'all';
        customCodes = state.customCodes || '';
        logicMode = state.logicMode || 'AND';
        lastResults = state.lastResults || [];
        resultPage = state.resultPage || 0;
        poolSource = state.poolSource || 'all';
        poolCustomCodes = state.poolCustomCodes || '';
        poolIndustryFilter = state.poolIndustryFilter || '';
        poolConceptFilter = state.poolConceptFilter || [];
        poolConceptMatchMode = state.poolConceptMatchMode || 'any';
        poolMarketCapMin = state.poolMarketCapMin || '';
        poolMarketCapMax = state.poolMarketCapMax || '';
        poolFloatSharesMin = state.poolFloatSharesMin || '';
        poolFloatSharesMax = state.poolFloatSharesMax || '';
        return true;
    } catch (e) { return false; }
}
```

- [ ] **Step 4: Commit**

```bash
git add js/stockScreener.js
git commit -m "feat: add pre-filter state to Stock Screener session persistence

Saves/restores poolSource, industry, concept, market cap, and float shares
filters across page navigations."

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

### Task 7: Frontend — add pre-filter UI section to renderScreenerPage

**Files:**
- Modify: `js/stockScreener.js:93-305` (renderScreenerPage HTML template)

- [ ] **Step 1: Insert pre-filter HTML section after the description paragraph**

Read `js/stockScreener.js:116-135`. The pre-filter section HTML goes after line 134 (`</p>`) and before line 136 (`<!-- 股票池 / 日期 / 逻辑 -->`).

Insert this HTML block:

```js
            // ── 股票池预筛选（折叠面板） ──
            '<div class="card" style="margin-bottom:12px;background:#0e1220;border:1px solid #323d5a;border-radius:12px;padding:12px 16px;">' +
            '<div id="screenerPrefilterHeader" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;">' +
            '<span style="color:#fff;font-weight:600;font-size:14px;">📦 股票池预筛选</span>' +
            '<span id="screenerPrefilterToggle" style="color:#9aa9cc;font-size:12px;">▲ 折叠</span>' +
            '</div>' +
            '<div id="screenerPrefilterBody">' +
            // Pool source radio buttons
            '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 8px;">' +
            '<label style="color:#fff;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:3px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;padding:4px 10px;"><input type="radio" name="screenerPoolSource" value="all"' + (poolSource === 'all' ? ' checked' : '') + ' style="accent-color:#4f7eff;"> 全市场</label>' +
            '<label style="color:#fff;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:3px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;padding:4px 10px;"><input type="radio" name="screenerPoolSource" value="hs300"' + (poolSource === 'hs300' ? ' checked' : '') + ' style="accent-color:#4f7eff;"> 沪深300</label>' +
            '<label style="color:#fff;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:3px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;padding:4px 10px;"><input type="radio" name="screenerPoolSource" value="zz500"' + (poolSource === 'zz500' ? ' checked' : '') + ' style="accent-color:#4f7eff;"> 中证500</label>' +
            '<label style="color:#fff;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:3px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;padding:4px 10px;"><input type="radio" name="screenerPoolSource" value="zz1000"' + (poolSource === 'zz1000' ? ' checked' : '') + ' style="accent-color:#4f7eff;"> 中证1000</label>' +
            '<label style="color:#fff;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:3px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;padding:4px 10px;"><input type="radio" name="screenerPoolSource" value="cyb"' + (poolSource === 'cyb' ? ' checked' : '') + ' style="accent-color:#4f7eff;"> 创业板</label>' +
            '<label style="color:#fff;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:3px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;padding:4px 10px;"><input type="radio" name="screenerPoolSource" value="kc50"' + (poolSource === 'kc50' ? ' checked' : '') + ' style="accent-color:#4f7eff;"> 科创50</label>' +
            '<label style="color:#fff;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:3px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;padding:4px 10px;"><input type="radio" name="screenerPoolSource" value="custom"' + (poolSource === 'custom' ? ' checked' : '') + ' style="accent-color:#4f7eff;"> 自定义</label>' +
            '</div>' +
            // Custom codes textarea
            '<textarea id="poolCustomCodes" rows="2" placeholder="输入股票代码，每行一个或用逗号分隔" ' +
            'style="display:' + (poolSource === 'custom' ? 'block' : 'none') + ';width:100%;background:#1e253b;border:1px solid #323d5a;border-radius:12px;color:#fff;padding:6px 10px;font-size:12px;font-family:monospace;resize:vertical;box-sizing:border-box;margin-bottom:8px;">' + escapeHtml(poolCustomCodes) + '</textarea>' +
            // Optional filters row
            '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">' +
            '<span style="color:#9aa9cc;font-size:11px;">筛选:</span>' +
            '<span style="color:#7a8ba8;font-size:10px;">总市值(亿)</span>' +
            '<input id="poolMarketCapMin" type="number" min="0" step="1" placeholder="最小" value="' + escapeHtml(poolMarketCapMin) + '" ' +
            'style="width:60px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;color:#fff;padding:4px 8px;font-size:11px;">' +
            '<span style="color:#7a8ba8;font-size:10px;">-</span>' +
            '<input id="poolMarketCapMax" type="number" min="0" step="1" placeholder="最大" value="' + escapeHtml(poolMarketCapMax) + '" ' +
            'style="width:60px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;color:#fff;padding:4px 8px;font-size:11px;">' +
            '<span style="color:#7a8ba8;font-size:10px;">股本(亿股)</span>' +
            '<input id="poolFloatSharesMin" type="number" min="0" step="0.1" placeholder="最小" value="' + escapeHtml(poolFloatSharesMin) + '" ' +
            'style="width:60px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;color:#fff;padding:4px 8px;font-size:11px;">' +
            '<span style="color:#7a8ba8;font-size:10px;">-</span>' +
            '<input id="poolFloatSharesMax" type="number" min="0" step="0.1" placeholder="最大" value="' + escapeHtml(poolFloatSharesMax) + '" ' +
            'style="width:60px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;color:#fff;padding:4px 8px;font-size:11px;">' +
            // Industry filter
            '<select id="poolIndustryFilter" style="display:none;">' +
            '<option value="">-- 行业(可选) --</option>' +
            '</select>' +
            '<input id="poolIndustryFilterInput" type="text" readonly placeholder="-- 行业(可选) --" ' +
            'style="background:#1e253b;border:1px solid #323d5a;border-radius:20px;color:#fff;padding:4px 10px;font-size:11px;max-width:160px;cursor:pointer;">' +
            // Concept filter
            '<input id="poolConceptSearch" type="text" placeholder="搜索概念..." ' +
            'style="width:110px;background:#1e253b;border:1px solid #323d5a;border-radius:20px;color:#fff;padding:4px 10px;font-size:11px;">' +
            '<select id="poolConceptFilter" multiple size="3" ' +
            'style="min-width:160px;max-width:240px;background:#1e253b;border:1px solid #323d5a;border-radius:8px;color:#fff;font-size:11px;padding:2px;"></select>' +
            '<select id="poolConceptMatchMode" style="display:none;">' +
            '<option value="any"' + (poolConceptMatchMode === 'any' ? ' selected' : '') + '>任一</option>' +
            '<option value="all"' + (poolConceptMatchMode === 'all' ? ' selected' : '') + '>全部</option>' +
            '</select>' +
            '<input id="poolConceptMatchModeInput" type="text" readonly ' +
            'value="' + (poolConceptMatchMode === 'all' ? '全部' : '任一') + '" ' +
            'style="background:#1e253b;border:1px solid #323d5a;border-radius:20px;color:#fff;padding:4px 8px;font-size:11px;cursor:pointer;">' +
            '<span id="poolConceptCount" style="color:#9aa9cc;font-size:11px;"></span>' +
            '<button id="poolResetFiltersBtn" style="background:transparent;border:1px solid #323d5a;color:#9aa9cc;padding:3px 10px;border-radius:20px;font-size:11px;cursor:pointer;">重置</button>' +
            '</div>' +
            // Preview
            '<div style="margin-top:4px;color:#9aa9cc;font-size:11px;">' +
            '<span id="poolPreviewText" style="color:#7a8ba8;">--</span>' +
            '</div>' +
            '</div>' +
            '</div>' +
```

- [ ] **Step 2: Remove the old stock pool selector (selectedPool/customCodes)**

The old selector at lines 139-157 (`screenerPool` / `screenerCustomArea`) is now redundant. Remove the old pool selector HTML block (lines 139-157) and the old pool input + custom area. Keep the date range and logic toggle sections.

Read `js/stockScreener.js:136-183`. Replace the old pool/date/logic section (after the new pre-filter block, remove old pool UI):

Remove lines 139-157 (the old `screenerPool` select + `screenerPoolInput` + `screenerCustomArea`).

- [ ] **Step 3: Update bindScreenerEvents — remove old pool events, add stubs for new ones**

Remove the old pool event bindings (lines 311-358 in bindScreenerEvents) — the `screenerPool`/`screenerPoolInput`/`screenerCustomCodes` event handlers. Replace with the new pre-filter event bindings (see Task 8).

- [ ] **Step 4: Commit**

```bash
git add js/stockScreener.js
git commit -m "feat: add stock pool pre-filter UI to Stock Screener page

Replaces old simple pool selector with layered filter: index source,
custom codes, industry, concept, market cap range, float shares range.
Collapsible panel with real-time pool preview."

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

### Task 8: Frontend — bind pre-filter events

**Files:**
- Modify: `js/stockScreener.js:309-499` (bindScreenerEvents function)

- [ ] **Step 1: Add pre-filter event bindings after bindScreenerEvents start**

Read `js/stockScreener.js:309-311` (start of bindScreenerEvents). After the function opening, add the pre-filter event bindings:

```js
    // ── Pre-filter events ──

    // Pool source radio buttons
    var poolSourceRadios = document.querySelectorAll('input[name="screenerPoolSource"]');
    poolSourceRadios.forEach(function(radio) {
        radio.addEventListener('change', function() {
            if (this.checked) {
                poolSource = this.value;
                var customArea = document.getElementById('poolCustomCodes');
                if (customArea) customArea.style.display = (poolSource === 'custom') ? 'block' : 'none';
                saveScreenerState();
            }
        });
    });

    var poolCustomCodesEl = document.getElementById('poolCustomCodes');
    if (poolCustomCodesEl) {
        poolCustomCodesEl.addEventListener('input', function() {
            poolCustomCodes = this.value;
            saveScreenerState();
        });
    }

    // Industry filter
    var poolIndustryFilterEl = document.getElementById('poolIndustryFilter');
    if (poolIndustryFilterEl) {
        poolIndustryFilterEl.addEventListener('change', function() {
            poolIndustryFilter = this.value;
            var inp = document.getElementById('poolIndustryFilterInput');
            if (inp) {
                var found = (industryListCache || []).find(function(o) { return o.value === poolIndustryFilter; });
                inp.value = found ? found.label : (poolIndustryFilter || '');
                if (!poolIndustryFilter) inp.placeholder = '-- 行业(可选) --';
            }
            saveScreenerState();
        });
    }
    var poolIndustryInput = document.getElementById('poolIndustryFilterInput');
    if (poolIndustryInput) {
        poolIndustryInput.addEventListener('click', function(e) {
            e.stopPropagation();
            var sel = document.getElementById('poolIndustryFilter');
            if (!sel) return;
            var opts = [];
            for (var k = 0; k < sel.options.length; k++) {
                opts.push({ value: sel.options[k].value, label: sel.options[k].textContent });
            }
            showCustomSelect(this, opts, function(val) {
                if (sel) { sel.value = val; sel.dispatchEvent(new Event('change')); }
            });
        });
    }

    // Market cap inputs
    var mcMinEl = document.getElementById('poolMarketCapMin');
    if (mcMinEl) {
        mcMinEl.addEventListener('input', function() {
            poolMarketCapMin = this.value;
            saveScreenerState();
        });
    }
    var mcMaxEl = document.getElementById('poolMarketCapMax');
    if (mcMaxEl) {
        mcMaxEl.addEventListener('input', function() {
            poolMarketCapMax = this.value;
            saveScreenerState();
        });
    }

    // Float shares inputs
    var fsMinEl = document.getElementById('poolFloatSharesMin');
    if (fsMinEl) {
        fsMinEl.addEventListener('input', function() {
            poolFloatSharesMin = this.value;
            saveScreenerState();
        });
    }
    var fsMaxEl = document.getElementById('poolFloatSharesMax');
    if (fsMaxEl) {
        fsMaxEl.addEventListener('input', function() {
            poolFloatSharesMax = this.value;
            saveScreenerState();
        });
    }

    // Concept search
    var poolConceptSearchEl = document.getElementById('poolConceptSearch');
    if (poolConceptSearchEl) {
        poolConceptSearchEl.addEventListener('input', function() {
            populatePoolConceptSelect(this.value);
        });
    }

    // Concept multi-select
    var poolConceptFilterEl = document.getElementById('poolConceptFilter');
    if (poolConceptFilterEl) {
        poolConceptFilterEl.addEventListener('change', function() {
            poolConceptFilter = Array.from(this.selectedOptions).map(function(o) { return o.value; });
            updatePoolConceptCount();
            saveScreenerState();
        });
    }

    // Concept match mode
    var poolConceptMatchModeEl = document.getElementById('poolConceptMatchMode');
    if (poolConceptMatchModeEl) {
        poolConceptMatchModeEl.addEventListener('change', function() {
            poolConceptMatchMode = this.value;
            var inp = document.getElementById('poolConceptMatchModeInput');
            if (inp) inp.value = poolConceptMatchMode === 'all' ? '全部' : '任一';
            saveScreenerState();
        });
    }
    var poolConceptMatchModeInput = document.getElementById('poolConceptMatchModeInput');
    if (poolConceptMatchModeInput) {
        poolConceptMatchModeInput.addEventListener('click', function(e) {
            e.stopPropagation();
            showCustomSelect(this, [
                { value: 'any', label: '任一' },
                { value: 'all', label: '全部' }
            ], function(val) {
                var sel = document.getElementById('poolConceptMatchMode');
                if (sel) { sel.value = val; sel.dispatchEvent(new Event('change')); }
            });
        });
    }

    // Reset filters button
    var resetFiltersBtn = document.getElementById('poolResetFiltersBtn');
    if (resetFiltersBtn) {
        resetFiltersBtn.addEventListener('click', function() {
            poolMarketCapMin = '';
            poolMarketCapMax = '';
            poolFloatSharesMin = '';
            poolFloatSharesMax = '';
            poolIndustryFilter = '';
            poolConceptFilter = [];
            poolConceptMatchMode = 'any';
            document.getElementById('poolMarketCapMin').value = '';
            document.getElementById('poolMarketCapMax').value = '';
            document.getElementById('poolFloatSharesMin').value = '';
            document.getElementById('poolFloatSharesMax').value = '';
            var indSel = document.getElementById('poolIndustryFilter');
            if (indSel) indSel.value = '';
            var indInp = document.getElementById('poolIndustryFilterInput');
            if (indInp) { indInp.value = ''; indInp.placeholder = '-- 行业(可选) --'; }
            var conSel = document.getElementById('poolConceptFilter');
            if (conSel) conSel.querySelectorAll('option').forEach(function(o) { o.selected = false; });
            var mmInp = document.getElementById('poolConceptMatchModeInput');
            if (mmInp) mmInp.value = '任一';
            updatePoolConceptCount();
            saveScreenerState();
        });
    }

    // Collapse/expand toggle
    var prefilterHeader = document.getElementById('screenerPrefilterHeader');
    if (prefilterHeader) {
        prefilterHeader.addEventListener('click', function() {
            var body = document.getElementById('screenerPrefilterBody');
            var toggle = document.getElementById('screenerPrefilterToggle');
            if (body) {
                var hidden = body.style.display === 'none';
                body.style.display = hidden ? '' : 'none';
                if (toggle) toggle.textContent = hidden ? '▲ 折叠' : '▼ 展开';
            }
        });
    }
```

- [ ] **Step 2: Add helper functions for concept select**

Add after the `loadDynamicOptions` function (after line 58):

```js
function populatePoolConceptSelect(filterText) {
    var sel = document.getElementById('poolConceptFilter');
    if (!sel) return;
    var lowerFilter = (filterText || '').toLowerCase();
    var currentSelected = poolConceptFilter.slice();
    sel.innerHTML = '';
    (conceptListCache || []).forEach(function(opt) {
        if (!filterText || opt.label.toLowerCase().indexOf(lowerFilter) !== -1) {
            var option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            if (currentSelected.indexOf(opt.value) !== -1) option.selected = true;
            sel.appendChild(option);
        }
    });
}

function updatePoolConceptCount() {
    var countEl = document.getElementById('poolConceptCount');
    if (countEl) {
        var n = poolConceptFilter.length;
        countEl.textContent = n > 0 ? '(' + n + '个)' : '';
    }
}
```

- [ ] **Step 3: Populate industry select when cache loads**

In `loadDynamicOptions`, after the industry list is loaded, populate the new `poolIndustryFilter` select:

Read `js/stockScreener.js:26-58`. After the `get_industry_list` `.then()` handler, add code to populate the industry select:

```js
    if (bridge && typeof bridge.get_industry_list === 'function') {
        bridge.get_industry_list().then(function (jsonStr) {
            try {
                var list = JSON.parse(jsonStr);
                if (Array.isArray(list)) {
                    industryListCache = list.map(function (i) { return { value: i, label: i }; });
                    if (CARD_TYPE_META.industry_contains) {
                        CARD_TYPE_META.industry_contains.paramFields[0].options = industryListCache;
                    }
                    // Populate screener industry select
                    var indSel = document.getElementById('poolIndustryFilter');
                    if (indSel) {
                        indSel.innerHTML = '<option value="">-- 行业(可选) --</option>';
                        list.forEach(function(v) {
                            indSel.innerHTML += '<option value="' + v + '">' + v + '</option>';
                        });
                        // Restore saved selection
                        if (poolIndustryFilter) indSel.value = poolIndustryFilter;
                    }
                }
            } catch (e) { console.warn('[Screener] 加载行业列表失败', e); }
        }).catch(function (e) { console.warn('[Screener] 加载行业列表失败', e); });
    }
```

- [ ] **Step 4: Commit**

```bash
git add js/stockScreener.js
git commit -m "feat: bind pre-filter events in Stock Screener

Wires pool source radios, industry/concept selects, market cap/float shares
inputs, and collapsible panel toggle. Concept select supports search filter."

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

⚠️ **CRITICAL**: This task requires verifying the changes are syntactically correct and don't break the existing page. After editing, check: no duplicate function names, no undefined variable references. The `showCustomSelect` function already exists in the file (line ~1418). The `conceptListCache`, `industryListCache` variables are already loaded by `loadDynamicOptions`.

---

### Task 9: Frontend — update runScreening to build and pass pre_filters

**Files:**
- Modify: `js/stockScreener.js:1475-1564` (runScreening function)

- [ ] **Step 1: Build pre_filters object and pass to bridge**

Read `js/stockScreener.js:1546-1565` (doRunScreening function). Replace the existing `doRunScreening`:

```js
function doRunScreening(startDate, endDate, stockPool) {
    console.log("[Screener] 发送卡片:", cards);
    console.log("[Screener] 股票池:", stockPool);
    console.log("[Screener] 筛选区间:", startDate, "~", endDate);

    // Build pre_filters from UI state
    var preFilters = {};
    var ind = poolIndustryFilter || '';
    if (ind) preFilters.industry = ind;
    if (poolConceptFilter.length > 0) {
        preFilters.concepts = poolConceptFilter.slice();
        preFilters.concept_match = poolConceptMatchMode || 'any';
    }
    var mcMin = parseFloat(poolMarketCapMin);
    var mcMax = parseFloat(poolMarketCapMax);
    if (!isNaN(mcMin)) preFilters.market_cap_min = mcMin;
    if (!isNaN(mcMax)) preFilters.market_cap_max = mcMax;
    var fsMin = parseFloat(poolFloatSharesMin);
    var fsMax = parseFloat(poolFloatSharesMax);
    if (!isNaN(fsMin)) preFilters.float_shares_min = fsMin;
    if (!isNaN(fsMax)) preFilters.float_shares_max = fsMax;
    var hasPrefilters = Object.keys(preFilters).length > 0;
    console.log("[Screener] 预筛选:", hasPrefilters ? preFilters : '无');

    var startBtn = document.getElementById('screenerStartBtn');

    if (bridge && typeof bridge.screen_stocks === 'function') {
        var cardsJson = JSON.stringify(cards);
        var poolJson = stockPool ? JSON.stringify(stockPool) : '';
        var preFiltersJson = hasPrefilters ? JSON.stringify(preFilters) : '';
        bridge.screen_stocks(cardsJson, poolJson, startDate, endDate, preFiltersJson).then(function (jsonStr) {
            onScreeningDone(JSON.parse(jsonStr));
        }).catch(function (err) {
            console.error('[Screener] Bridge call failed, using mock:', err);
            onScreeningDone(mockScreening());
        });
    } else {
        setTimeout(function () { onScreeningDone(mockScreening()); }, 600);
    }
}
```

- [ ] **Step 2: Update runScreening to use new pool source resolution**

Read `js/stockScreener.js:1475-1544` (runScreening). The old `selectedPool` logic needs to be replaced with the new `poolSource` logic from pre-filters. Replace the `proceedWithScreening` function logic:

```js
    function proceedWithScreening() {
        var indexMap = {
            hs300: '000300.XSHG', zz500: '000905.XSHG',
            zz1000: '000852.XSHG', cyb: '399006.XSHE', kc50: '000688.XSHG'
        };
        var indexCode = indexMap[poolSource];

        if (poolSource === 'custom') {
            var raw = poolCustomCodes || '';
            var pool = raw.split(/[,，\s]+/).filter(function (s) { return s.length > 0; });
            if (pool.length === 0) { showToast('请输入自定义股票代码', true); return; }
            console.log("[Screener] 自定义股票池:", pool.length + " 只");
            doRunScreening(startDate, endDate, pool);
        } else if (indexCode && bridge && typeof bridge.get_index_stocks === 'function') {
            bridge.get_index_stocks(indexCode).then(function (jsonStr) {
                var pool = JSON.parse(jsonStr);
                if (!Array.isArray(pool) || pool.length === 0) {
                    showToast('获取 ' + poolSource + ' 成分股失败', true);
                    if (startBtn) { startBtn.disabled = false; startBtn.textContent = '🔍 开始选股'; }
                    return;
                }
                console.log("[Screener] " + poolSource + " 成分股:", pool.length + " 只");
                doRunScreening(startDate, endDate, pool);
            }).catch(function (err) {
                console.error('[Screener] 获取成分股失败:', err);
                showToast('获取成分股失败，使用模拟数据', true);
                onScreeningDone(mockScreening());
            });
        } else {
            // 'all' or unknown: full market
            console.log("[Screener] 股票池: 全市场");
            doRunScreening(startDate, endDate, null);
        }
    }
```

- [ ] **Step 3: Commit**

```bash
git add js/stockScreener.js
git commit -m "feat: wire pre_filters into Stock Screener screening pipeline

Builds pre_filters JSON from UI state, passes to bridge screen_stocks slot.
Updates pool resolution to use new poolSource (with zz1000/cyb/kc50 support)."

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

### Task 10: Frontend — remove blocking render pattern

**Files:**
- Modify: `js/stockScreener.js:93-305` (renderScreenerPage)

- [ ] **Step 1: Ensure bridge calls are fully non-blocking**

The bridge calls in `renderScreenerPage` are already async (`bridge.xxx().then(...)`), but the `loadDynamicOptions()` call and `get_latest_trading_date` call should not delay the initial DOM render.

Current flow (line ~247-304): `renderScreenerPage` → inserts `container.innerHTML` → calls `bindScreenerEvents()` → calls `refreshTemplateDropdown()` → calls `loadDynamicOptions()` → calls bindDatePicker → restores saved state.

The HTML insert (`container.innerHTML = ...`) happens first, so the DOM renders immediately. The bridge calls follow. The issue is that these calls all happen synchronously before `renderScreenerPage` returns, and while the Qt bridge calls themselves are async from JS perspective, they still might cause event loop blocking on Python side.

With the Python caches (Task 2), the bridge calls should now be near-instant on subsequent visits. For the first visit (cache cold), they'll take some time but won't block the JS execution because they're async.

The main improvement: make `loadDynamicOptions` return immediately. It already does this — each bridge call inside it is async. No change needed to the JS side structurally.

However, the date inputs should show defaults immediately (they do, via computed `startDateStr`/`endDateStr` at lines 105-113). The bridge `get_latest_trading_date` call will update them asynchronously.

No additional code changes needed — the Python caching (Task 2) is the primary fix. The frontend already renders non-blocking.

- [ ] **Step 2: Commit (skip — no code change needed)**

---

### Self-Review Checklist

**1. Spec coverage:**
- [x] Pre-filter UI (industry, concept, market cap, float shares) → Tasks 6, 7, 8
- [x] Pool source radio buttons → Task 7
- [x] Backend `_apply_pre_filters` → Task 3
- [x] `screen_stocks_batch` accepts `pre_filters` → Task 4
- [x] Bridge slot passes `pre_filters_json` → Task 5
- [x] Python caches (concept/industry/trade_date) → Task 2
- [x] DB index → Task 1
- [x] Non-blocking frontend render → Task 10
- [x] Session persistence of pre-filter state → Task 6
- [x] Backward compatibility (`pre_filters=None`) → Task 4, 5
- [x] Early exit on empty pool → Task 3, 4
- [x] Error handling (try/catch per filter step) → Task 3

**2. Placeholder scan:** No TBD/TODO/fill-in-later patterns. All code shown inline.

**3. Type consistency:**
- `pre_filters` dict keys match between Task 3 (`_apply_pre_filters`), Task 5 (bridge slot), and Task 9 (frontend)
- `poolSource` values match between Task 7 (HTML radio values) and Task 9 (indexMap keys)
- New state variables declared in Task 6, used in Tasks 7, 8, 9
- `showCustomSelect` already exists in stockScreener.js (line ~1418), reused in Task 8
- `conceptListCache`, `industryListCache` already loaded by existing `loadDynamicOptions`
