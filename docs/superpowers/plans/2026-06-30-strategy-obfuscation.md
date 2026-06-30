# Strategy Logic Obfuscation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 14 proprietary strategy/backtest/screening files with simplified public stubs while keeping full implementations local-only via `*_full.*` files in .gitignore.

**Architecture:** Each sensitive file renamed to `*_full.*`, then replaced with a same-name stub that preserves exact class/function signatures but uses minimal demo logic. Web bridge calls remain valid, imports don't break, app launches but core algorithms are neutered.

**Tech Stack:** Python 3.12+ (stubs), JavaScript ES6 modules (stubs), Git

---

### Task 1: Update .gitignore rules

**Files:**
- Modify: `.gitignore:34`

- [ ] **Step 1: Add `*_full.*` rules to .gitignore**

Add these lines to `.gitignore`:

```
# Private full implementations (local only)
*_full.py
*_full.js
```

- [ ] **Step 2: Verify `.gitignore` is syntactically valid**

Run: `git -C "E:\Tquant1" check-ignore backend/strategy_engine_full.py`
Expected: prints the path (rule matched)

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: add *_full.* rules to .gitignore for private implementations"
```

---

### Task 2: Stub `backend/strategy_engine.py`

**Files:**
- Rename: `backend/strategy_engine.py` → `backend/strategy_engine_full.py`
- Create: `backend/strategy_engine.py` (stub)

- [ ] **Step 1: Rename original to _full**

```bash
cd "E:\Tquant1" && git mv backend/strategy_engine.py backend/strategy_engine_full.py
```

- [ ] **Step 2: Create stub `backend/strategy_engine.py`**

```python
# stub: simplified public version — full implementation is local only
from backend.data_feed import DataFeed
import pandas as pd
import numpy as np
import json

class StrategyEngine:
    def __init__(self):
        self.data_feed = DataFeed()
        self.signals = []

    def run_backtest(self, code, start_date="2010-01-01", end_date="2026-12-31",
                     initial_cash=1000000, shares_per_trade=100):
        """Demo: MA5/MA20 crossover strategy. Simplified public version."""
        kline_json = self.data_feed.get_kline_json(code, start_date, end_date)
        kline_data = json.loads(kline_json)
        if "error" in kline_data:
            return [], {}

        dates = kline_data["dates"]
        values = kline_data["values"]

        df = pd.DataFrame({
            "trade_date": pd.to_datetime(dates),
            "open": [v[0] for v in values],
            "close": [v[1] for v in values],
            "low": [v[2] for v in values],
            "high": [v[3] for v in values]
        })

        df['ma5'] = df['close'].rolling(window=5).mean()
        df['ma10'] = df['close'].rolling(window=10).mean()
        df['ma20'] = df['close'].rolling(window=20).mean()
        df['ma30'] = df['close'].rolling(window=30).mean()

        ma_data = {
            "dates": dates,
            "ma5": df['ma5'].fillna(0).round(2).tolist(),
            "ma10": df['ma10'].fillna(0).round(2).tolist(),
            "ma20": df['ma20'].fillna(0).round(2).tolist(),
            "ma30": df['ma30'].fillna(0).round(2).tolist()
        }

        signals = []
        cash = initial_cash
        holdings = 0

        for i in range(20, len(df)):
            if (df['ma5'].iloc[i-1] <= df['ma20'].iloc[i-1] and
                df['ma5'].iloc[i] > df['ma20'].iloc[i]):
                price = df['close'].iloc[i]
                shares = min(shares_per_trade, int(cash / price))
                if shares > 0:
                    cost = round(price * shares, 2)
                    if cost <= cash:
                        signals.append({
                            "date": df['trade_date'].iloc[i].strftime('%Y-%m-%d'),
                            "code": code,
                            "type": "buy",
                            "price": round(price, 2),
                            "shares": shares
                        })
                        cash -= cost
                        holdings += shares

            elif (df['ma5'].iloc[i-1] >= df['ma20'].iloc[i-1] and
                  df['ma5'].iloc[i] < df['ma20'].iloc[i] and holdings > 0):
                price = df['close'].iloc[i]
                shares = min(holdings, shares_per_trade)
                if shares > 0:
                    signals.append({
                        "date": df['trade_date'].iloc[i].strftime('%Y-%m-%d'),
                        "code": code,
                        "type": "sell",
                        "price": round(price, 2),
                        "shares": shares
                    })
                    cash += round(price * shares, 2)
                    holdings -= shares

        self.signals = signals
        return signals, ma_data

    def get_signals(self, code=None):
        if code is None:
            return self.signals
        return [sig for sig in self.signals if sig['code'] == code]
```

- [ ] **Step 3: Remove `backend/strategy_engine_full.py` from git tracking (keep local)**

```bash
cd "E:\Tquant1" && git rm --cached backend/strategy_engine_full.py
```
Note: the file stays on disk but is no longer tracked.

Wait — correction. The git mv already staged the rename. We need to undo the staging for `_full`:

```bash
cd "E:\Tquant1" && git reset HEAD backend/strategy_engine_full.py
```
Now the `_full` file is untracked (ignored by .gitignore).

- [ ] **Step 4: Verify stub imports work**

```bash
cd "E:\Tquant1" && python -c "from backend.strategy_engine import StrategyEngine; e = StrategyEngine(); print('OK')"
```
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add backend/strategy_engine.py
git commit -m "feat: replace strategy_engine with stub, move full to local-only

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Stub `backend/trade_simulation.py`

**Files:**
- Rename: `backend/trade_simulation.py` → `backend/trade_simulation_full.py`
- Create: `backend/trade_simulation.py` (stub)

- [ ] **Step 1: Rename original and unstage _full**

```bash
cd "E:\Tquant1" && cp backend/trade_simulation.py backend/trade_simulation_full.py && git rm backend/trade_simulation.py
```

- [ ] **Step 2: Create stub `backend/trade_simulation.py`**

```python
# stub: simplified public version — full implementation is local only
import threading
import json
import os

class TradeSimulation:
    def __init__(self, data_file="simulation_data.json"):
        self._data_file = data_file
        self._lock = threading.Lock()
        self.initial_capital = 1000000.0
        self.cash = 1000000.0
        self.holdings = {}
        self.history = []

    def reset(self, initial_cash=1000000.0):
        with self._lock:
            self.initial_capital = initial_cash
            self.cash = initial_cash
            self.holdings = {}
            self.history = []

    def execute_trade(self, code, action, shares, price, trade_date=None):
        with self._lock:
            record_date = trade_date if trade_date else __import__('datetime').datetime.now().strftime('%Y-%m-%d')
            if action == 'buy':
                cost = round(price * shares, 2)
                if cost > self.cash:
                    return {'success': False, 'message': '资金不足'}
                if code in self.holdings:
                    old = self.holdings[code]
                    new_shares = old['shares'] + shares
                    new_cost = round((old['cost'] * old['shares'] + cost) / new_shares, 2)
                    self.holdings[code] = {'shares': new_shares, 'cost': new_cost}
                else:
                    self.holdings[code] = {'shares': shares, 'cost': price}
                self.cash = round(self.cash - cost, 2)
                self.history.append({'date': record_date, 'type': '买入', 'code': code, 'price': price, 'shares': shares})
                return {'success': True, 'message': f'买入{shares}股{code}成功'}
            elif action == 'sell':
                if code not in self.holdings or self.holdings[code]['shares'] < shares:
                    return {'success': False, 'message': '持仓不足'}
                self.holdings[code]['shares'] -= shares
                if self.holdings[code]['shares'] == 0:
                    del self.holdings[code]
                self.cash = round(self.cash + price * shares, 2)
                self.history.append({'date': record_date, 'type': '卖出', 'code': code, 'price': price, 'shares': shares})
                return {'success': True, 'message': f'卖出{shares}股{code}成功'}
            return {'success': False, 'message': '无效操作'}

    def get_portfolio(self):
        with self._lock:
            holdings_list = []
            total_market = self.cash
            for code, item in self.holdings.items():
                current_price = item['cost']
                market_value = round(current_price * item['shares'], 2)
                profit = round(market_value - item['cost'] * item['shares'], 2)
                holdings_list.append({'code': code, 'shares': item['shares'], 'cost': item['cost'], 'price': current_price, 'profit': profit})
                total_market += market_value
            return {'cash': self.cash, 'initial_capital': self.initial_capital, 'total_assets': round(total_market, 2), 'holdings': holdings_list, 'history': list(self.history)}
```

- [ ] **Step 3: Verify import**

```bash
cd "E:\Tquant1" && python -c "from backend.trade_simulation import TradeSimulation; t = TradeSimulation(); print('OK')"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/trade_simulation.py
git commit -m "feat: replace trade_simulation with stub, move full to local-only

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Stub `backend/backtest_executor.py`

**Files:**
- Rename: `backend/backtest_executor.py` → `backend/backtest_executor_full.py`
- Create: `backend/backtest_executor.py` (stub)

**Dependencies:** Used by `web_bridge.py`, `backtest_worker.py`, `multi_backtest_executor.py`, `optimization/opt_objective.py`

- [ ] **Step 1: Rename original**

```bash
cd "E:\Tquant1" && cp backend/backtest_executor.py backend/backtest_executor_full.py && git rm backend/backtest_executor.py
```

- [ ] **Step 2: Create stub `backend/backtest_executor.py`**

```python
# stub: simplified public version — full implementation is local only
import json
import numpy as np
import pandas as pd
import traceback


def calculate_benchmark_metrics(strategy_nav_series, benchmark_close_series, risk_free_rate=0.03):
    """Calculate benchmark-relative metrics. Simplified public version."""
    try:
        if benchmark_close_series.empty or len(benchmark_close_series) < 2:
            return {}
        bm_nav = benchmark_close_series / benchmark_close_series.iloc[0]
        aligned = pd.DataFrame({'strategy_nav': strategy_nav_series, 'bm_nav': bm_nav}).dropna()
        if len(aligned) < 2:
            return {}
        strategy_total_ret = (aligned['strategy_nav'].iloc[-1] / aligned['strategy_nav'].iloc[0] - 1) * 100
        bm_total_ret = (aligned['bm_nav'].iloc[-1] / aligned['bm_nav'].iloc[0] - 1) * 100
        excess_return = strategy_total_ret - bm_total_ret
        return {
            'benchmark_return': round(bm_total_ret, 2),
            'excess_return': round(excess_return, 2),
            'outperform': bool(excess_return > 0),
        }
    except Exception as e:
        print(f"[Benchmark] calc error: {e}")
        return {}


class Logger:
    """Simple logger — compatible interface with full version."""
    def __init__(self, on_log=None):
        self.on_log = on_log

    def __call__(self, msg):
        print(f"[Backtest] {msg}")
        if self.on_log:
            self.on_log(str(msg))

    def info(self, msg):
        self.__call__(f"[INFO] {msg}")

    def warn(self, msg):
        self.__call__(f"[WARN] {msg}")

    def error(self, msg):
        self.__call__(f"[ERROR] {msg}")


class BacktestExecutor:
    """Single-stock backtest executor. Simplified public version."""

    def __init__(self, data_feed):
        self.data_feed = data_feed

    def run(self, user_code, stock_code, start_date, end_date, initial_cash=1000000,
            slippage='close', commission_rate=0.0003, stamp_tax_rate=0.001,
            slippage_cost_type='percent', slippage_cost_value=0.1,
            benchmark_code=None, on_log=None):
        """Run a single-stock backtest. Returns mock/demo result."""
        logger = Logger(on_log)
        logger("Demo backtest mode — install full version for actual results")

        try:
            # Execute user strategy code in sandbox
            from backend.data_feed import DataFeed
            import types

            code = compile(user_code, '<strategy>', 'exec')
            ns = {'np': np, 'pd': pd, '__builtins__': __builtins__}
            exec(code, ns)

            # Run strategy user function if present
            metrics = {
                'total_return': 0.0,
                'annual_return': 0.0,
                'sharpe_ratio': 0.0,
                'max_drawdown': 0.0,
                'win_rate': 0.0,
                'total_trades': 0,
                'benchmark_return': 0.0,
                'excess_return': 0.0,
            }

            return {
                'status': 'success',
                'metrics': metrics,
                'signals': [],
                'nav_series': [],
                'benchmark_nav': [],
            }
        except Exception as e:
            traceback.print_exc()
            return {'status': 'error', 'message': str(e)}
```

- [ ] **Step 3: Verify import**

```bash
cd "E:\Tquant1" && python -c "from backend.backtest_executor import BacktestExecutor, Logger, calculate_benchmark_metrics; print('OK')"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/backtest_executor.py
git commit -m "feat: replace backtest_executor with stub, move full to local-only

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Stub `backend/multi_backtest_executor.py`

**Files:**
- Rename: `backend/multi_backtest_executor.py` → `backend/multi_backtest_executor_full.py`
- Create: `backend/multi_backtest_executor.py` (stub)

**Dependencies:** imports from `backend.backtest_executor` (Logger, BacktestExecutor, calculate_benchmark_metrics)

- [ ] **Step 1: Rename original**

```bash
cd "E:\Tquant1" && cp backend/multi_backtest_executor.py backend/multi_backtest_executor_full.py && git rm backend/multi_backtest_executor.py
```

- [ ] **Step 2: Create stub `backend/multi_backtest_executor.py`**

```python
# stub: simplified public version — full implementation is local only
import traceback
import numpy as np
import pandas as pd
from backend.backtest_executor import Logger, BacktestExecutor, calculate_benchmark_metrics


class MultiBacktestExecutor:
    """Multi-stock shared-pool backtest executor. Simplified public version."""

    def __init__(self, data_feed):
        self.data_feed = data_feed

    def run(self, user_code, stock_codes, start_date, end_date, initial_cash=1000000,
            slippage='close', commission_rate=0.0003, stamp_tax_rate=0.001,
            slippage_cost_type='percent', slippage_cost_value=0.1,
            benchmark_code=None, on_log=None):
        """Run multi-stock backtest. Returns demo result."""
        logger = Logger(on_log)
        logger("Demo multi-backtest mode — install full version for actual results")

        try:
            code = compile(user_code, '<multi_strategy>', 'exec')
            ns = {'np': np, 'pd': pd, '__builtins__': __builtins__}
            exec(code, ns)

            metrics = {
                'total_return': 0.0, 'annual_return': 0.0,
                'sharpe_ratio': 0.0, 'max_drawdown': 0.0,
                'win_rate': 0.0, 'total_trades': 0,
                'benchmark_return': 0.0, 'excess_return': 0.0,
            }

            return {
                'success': True,
                'metrics': metrics,
                'signals': [],
                'nav_series': [],
                'benchmark_nav': [],
            }
        except Exception as e:
            traceback.print_exc()
            return {'success': False, 'error': str(e)}
```

- [ ] **Step 3: Verify import**

```bash
cd "E:\Tquant1" && python -c "from backend.multi_backtest_executor import MultiBacktestExecutor; print('OK')"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/multi_backtest_executor.py
git commit -m "feat: replace multi_backtest_executor with stub, move full to local-only

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: Stub `backend/stock_screener.py`

**Files:**
- Rename: `backend/stock_screener.py` → `backend/stock_screener_full.py`
- Create: `backend/stock_screener.py` (stub)

**Dependencies:** Used by `web_bridge.py` via `StockScreener.evaluate_stock_with_reason()` and `StockScreener.screen_stocks_batch()`

- [ ] **Step 1: Rename original**

```bash
cd "E:\Tquant1" && cp backend/stock_screener.py backend/stock_screener_full.py && git rm backend/stock_screener.py
```

- [ ] **Step 2: Create stub `backend/stock_screener.py`**

```python
# stub: simplified public version — full implementation is local only
# ponytail: this stub keeps only MA cross evaluator; full version has 20+ indicators
import json
import time
import numpy as np
import pandas as pd
from datetime import timedelta
from backend.data_feed import DataFeed
from backend.db import Database


class StockScreener:
    """Stock screening engine. Simplified public version — only MA cross demo."""

    _realtime_cache = {}
    _CACHE_TTL = 10

    def __init__(self, data_feed: DataFeed):
        self.data_feed = data_feed
        self.db = Database()

        self._evaluators = {
            'ma_cross': self._eval_ma_cross,
        }

        self._batch_evaluators = {
            'ma_cross': self._batch_ma_cross,
        }

    def _eval_ma_cross(self, row, condition, code):
        """Single-stock MA cross evaluation."""
        try:
            kline = self.data_feed.get_kline_df(
                code, end_date=row.get('trade_date', ''),
                days=condition.get('slow_period', 20) + 5
            )
            if kline is None or len(kline) < condition.get('slow_period', 20):
                return False
            fast = condition.get('fast_period', 5)
            slow = condition.get('slow_period', 20)
            ma_fast = kline['close'].rolling(fast).mean().iloc[-2:].values
            ma_slow = kline['close'].rolling(slow).mean().iloc[-2:].values
            direction = condition.get('direction', 'golden')
            if direction == 'golden':
                return ma_fast[0] <= ma_slow[0] and ma_fast[1] > ma_slow[1]
            else:
                return ma_fast[0] >= ma_slow[0] and ma_fast[1] < ma_slow[1]
        except Exception:
            return False

    def _batch_ma_cross(self, df, condition):
        """Batch MA cross screening."""
        results = pd.Series(False, index=df.index)
        fast_p = condition.get('fast_period', 5)
        slow_p = condition.get('slow_period', 20)
        direction = condition.get('direction', 'golden')
        for i in df.index:
            try:
                code = df.at[i, 'code'] if 'code' in df.columns else df.at[i, 'stock_code']
                row = df.loc[i].to_dict()
                row['trade_date'] = str(df.at[i, 'trade_date'])[:10] if 'trade_date' in df.columns else ''
                results[i] = self._eval_ma_cross(row, condition, code)
            except Exception:
                results[i] = False
        return results

    def evaluate_stock_with_reason(self, code, card):
        """Evaluate single card condition against a stock. Returns (ok, reason)."""
        cond_type = card.get('type', '')
        if cond_type not in self._evaluators:
            return False, f"条件类型 '{cond_type}' 不支持（公开版仅支持 ma_cross）"
        ok = self._evaluators[cond_type]({'trade_date': ''}, card.get('params', {}), code)
        reason = '符合条件' if ok else '不符合条件'
        return ok, reason

    def screen_stocks_batch(self, conditions, pool=None, start_date=None, end_date=None,
                            industry_filter='', concept_filter=None, concept_match_mode='any',
                            market_cap_min='', market_cap_max='',
                            float_shares_min='', float_shares_max=''):
        """Batch screen stocks. Returns simplified result."""
        return {
            'success': True,
            'matches': [],
            'total_checked': 0,
            'message': '公开版仅支持 ma_cross 选股，完整版支持 20+ 指标'
        }
```

- [ ] **Step 3: Verify import**

```bash
cd "E:\Tquant1" && python -c "from backend.stock_screener import StockScreener; print('OK')"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/stock_screener.py
git commit -m "feat: replace stock_screener with stub, move full to local-only

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: Stub `backend/realtime_strategy_engine.py`

**Files:**
- Rename: `backend/realtime_strategy_engine.py` → `backend/realtime_strategy_engine_full.py`
- Create: `backend/realtime_strategy_engine.py` (stub)

- [ ] **Step 1: Rename original**

```bash
cd "E:\Tquant1" && cp backend/realtime_strategy_engine.py backend/realtime_strategy_engine_full.py && git rm backend/realtime_strategy_engine.py
```

- [ ] **Step 2: Create stub `backend/realtime_strategy_engine.py`**

```python
# stub: simplified public version — full implementation is local only
import asyncio
import threading
import time
from datetime import datetime


class _RealtimeLogger:
    def __init__(self, engine):
        self._engine = engine

    def info(self, msg):
        self._emit('INFO', msg)

    def warn(self, msg):
        self._emit('WARN', msg)

    def error(self, msg):
        self._emit('ERROR', msg)

    def debug(self, msg):
        self._emit('DEBUG', msg)

    def __call__(self, msg):
        self.info(msg)

    def _emit(self, level, msg):
        text = f"[{level}] {msg}"
        with self._engine._state_lock:
            self._engine.logs.append(text)
        print(f"[RealtimeEngine] {text}")
        if self._engine.on_log:
            try:
                self._engine.on_log(text)
            except Exception:
                pass


class RealtimeStrategyEngine:
    """Single-stock async realtime strategy engine. Simplified public version."""

    def __init__(self, stock_code, user_code, trade_sim,
                 initial_cash=100000.0, quote_interval=3.0,
                 on_signal=None, on_log=None, auto_trader=None):
        self.stock_code = stock_code.split('.')[0]
        self.user_code = user_code
        self.trade_sim = trade_sim
        self.initial_cash = initial_cash
        self.quote_interval = max(quote_interval, 1.0)
        self.on_signal = on_signal
        self.on_log = on_log
        self.auto_trader = auto_trader
        self.logs = []
        self._state_lock = threading.Lock()
        self._running = False
        self._thread = None
        self.log = _RealtimeLogger(self)

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        self.log.info(f"Demo realtime engine started for {self.stock_code}")

    def stop(self):
        self._running = False
        self.log.info("Demo realtime engine stopped")

    def _run_loop(self):
        while self._running:
            time.sleep(self.quote_interval)
            # Demo mode: no real signals generated

    def get_status(self):
        return {
            'running': self._running,
            'stock_code': self.stock_code,
            'mode': 'demo',
            'logs': list(self.logs[-50:]),
        }
```

- [ ] **Step 3: Verify import**

```bash
cd "E:\Tquant1" && python -c "from backend.realtime_strategy_engine import RealtimeStrategyEngine; print('OK')"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/realtime_strategy_engine.py
git commit -m "feat: replace realtime_strategy_engine with stub, move full to local-only

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 8: Stub `backend/multi_realtime_strategy_engine.py`

**Files:**
- Rename: `backend/multi_realtime_strategy_engine.py` → `backend/multi_realtime_strategy_engine_full.py`
- Create: `backend/multi_realtime_strategy_engine.py` (stub)

- [ ] **Step 1: Rename original**

```bash
cd "E:\Tquant1" && cp backend/multi_realtime_strategy_engine.py backend/multi_realtime_strategy_engine_full.py && git rm backend/multi_realtime_strategy_engine.py
```

- [ ] **Step 2: Create stub `backend/multi_realtime_strategy_engine.py`**

```python
# stub: simplified public version — full implementation is local only
import asyncio
import threading
import time
from datetime import datetime


class MultiRealtimeStrategyEngine:
    """Multi-stock async realtime strategy engine. Simplified public version."""

    def __init__(self, stock_codes, user_code, trade_sim,
                 initial_cash=100000.0, quote_interval=3.0,
                 on_signal=None, on_log=None, auto_trader=None):
        self.stock_codes = [c.split('.')[0] for c in stock_codes]
        self.user_code = user_code
        self.trade_sim = trade_sim
        self.initial_cash = initial_cash
        self.quote_interval = max(quote_interval, 1.0)
        self.on_signal = on_signal
        self.on_log = on_log
        self.auto_trader = auto_trader
        self.logs = []
        self._state_lock = threading.Lock()
        self._running = False
        self._thread = None

    def _log(self, level, msg):
        text = f"[{level}] {msg}"
        with self._state_lock:
            self.logs.append(text)
        print(f"[MultiRealtimeEngine] {text}")
        if self.on_log:
            try:
                self.on_log(text)
            except Exception:
                pass

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        self._log('INFO', f"Demo multi-realtime engine started for {len(self.stock_codes)} stocks")

    def stop(self):
        self._running = False
        self._log('INFO', "Demo multi-realtime engine stopped")

    def _run_loop(self):
        while self._running:
            time.sleep(self.quote_interval)

    def get_status(self):
        return {
            'running': self._running,
            'stock_codes': self.stock_codes,
            'mode': 'demo',
            'logs': list(self.logs[-50:]),
        }
```

- [ ] **Step 3: Verify import**

```bash
cd "E:\Tquant1" && python -c "from backend.multi_realtime_strategy_engine import MultiRealtimeStrategyEngine; print('OK')"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/multi_realtime_strategy_engine.py
git commit -m "feat: replace multi_realtime_strategy_engine with stub, move full to local-only

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 9: Stub `backend/optimization/opt_objective.py`

**Files:**
- Rename: `backend/optimization/opt_objective.py` → `backend/optimization/opt_objective_full.py`
- Create: `backend/optimization/opt_objective.py` (stub)

- [ ] **Step 1: Rename original**

```bash
cd "E:\Tquant1" && cp backend/optimization/opt_objective.py backend/optimization/opt_objective_full.py && git rm backend/optimization/opt_objective.py
```

- [ ] **Step 2: Create stub `backend/optimization/opt_objective.py`**

```python
# stub: simplified public version — full implementation is local only
import json
import sys
import re

from backend.data_feed import DataFeed
from backend.backtest_executor import BacktestExecutor


def suggest_for_param(trial, param_def):
    """Suggest a parameter value for an Optuna trial. Simplified."""
    name = param_def["name"]
    low = param_def["low"]
    high = param_def["high"]
    if param_def.get("type") == "int":
        step = param_def.get("step", 1)
        return trial.suggest_int(name, low, high, step=step)
    else:
        step = param_def.get("step")
        return trial.suggest_float(name, low, high, step=step)


def inject_params(strategy_code, sampled_params):
    """Inject sampled params into strategy code. Simplified."""
    code = strategy_code
    for name, value in sampled_params.items():
        pat1 = rf'(context\.c\d+_{name}\s*=\s*)(-?[\d.]+)'
        if re.search(pat1, code):
            code = re.sub(pat1, rf'\g<1>{value}', code)
        else:
            pat2 = rf'(\b{name}\s*=\s*)(-?[\d.]+)'
            code = re.sub(pat2, rf'\g<1>{value}', code)
    return code


def compute_objective(metrics, objective_type, min_trades=5):
    """Compute objective value from backtest metrics. Simplified."""
    total_trades = metrics.get("total_trades", 0)
    if total_trades < min_trades:
        return float(-200 * (min_trades - total_trades))
    if objective_type == "sharpe_drawdown":
        sharpe = metrics.get("sharpe_ratio", 0)
        total_ret = metrics.get("total_return", 0)
        return float(sharpe * 0.7 + total_ret * 0.3)
    elif objective_type == "sharpe":
        return float(metrics.get("sharpe_ratio", 0))
    else:
        return float(metrics.get("total_return", 0))


def run_objective(trial, params_to_search, fixed_params, strategy_code,
                  stock_code, start, end, cash, slippage,
                  commission_rate, stamp_tax_rate, slippage_cost_type,
                  slippage_cost_value, benchmark_code, objective_type,
                  data_feed=None, stock_codes=None):
    """Run one Optuna trial. Simplified — returns mock value for demo."""
    sampled = {}
    for p in params_to_search:
        sampled[p["name"]] = suggest_for_param(trial, p)
    all_params = {**fixed_params, **sampled}

    try:
        code = inject_params(strategy_code, all_params)
        return 0.0  # Demo: no actual backtest
    except Exception:
        return float("nan")
```

- [ ] **Step 3: Verify import**

```bash
cd "E:\Tquant1" && python -c "from backend.optimization.opt_objective import run_objective, compute_objective, suggest_for_param, inject_params; print('OK')"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/optimization/opt_objective.py
git commit -m "feat: replace opt_objective with stub, move full to local-only

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 10: Stub `backend/optimization/opt_worker.py`

**Files:**
- Rename: `backend/optimization/opt_worker.py` → `backend/optimization/opt_worker_full.py`
- Create: `backend/optimization/opt_worker.py` (stub)

- [ ] **Step 1: Rename original**

```bash
cd "E:\Tquant1" && cp backend/optimization/opt_worker.py backend/optimization/opt_worker_full.py && git rm backend/optimization/opt_worker.py
```

- [ ] **Step 2: Create stub `backend/optimization/opt_worker.py`**

```python
# stub: simplified public version — full implementation is local only
import traceback
import os

os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")

from PySide6.QtCore import QThread, Signal

from .opt_objective import run_objective


class OptunaWorker(QThread):
    """Background Optuna hyperparameter search worker. Simplified public version."""

    progress = Signal(dict)
    finished = Signal(dict)

    def __init__(self, params, parent=None):
        super().__init__(parent)
        self.params = params
        self._study = None

    def run(self):
        try:
            p = self.params
            # Demo: emit one mock trial and finish
            self.progress.emit({
                "current": 1,
                "total": 1,
                "best_value": 0.0,
                "mode": "single",
                "stock_count": 1,
                "last_trial": {
                    "number": 0,
                    "value": 0.0,
                    "state": "COMPLETE",
                    "params": {},
                },
            })

            self.finished.emit({
                "success": True,
                "best_params": {},
                "best_value": 0.0,
                "n_trials_completed": 1,
                "trials": [],
                "param_importance": {},
                "mode": "single",
                "stock_count": 1,
                "message": "公开版演示 — 完整版支持 Optuna TPE 超参搜索"
            })
        except Exception as e:
            traceback.print_exc()
            self.finished.emit({
                "success": False,
                "error": str(e),
                "best_params": {},
                "best_value": None,
                "trials": [],
                "param_importance": {},
            })

    def cancel(self):
        self.requestInterruption()
```

- [ ] **Step 3: Verify `backend/optimization/__init__.py` still works**

```bash
cd "E:\Tquant1" && python -c "from backend.optimization import OptunaWorker; print('OK')"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/optimization/opt_worker.py
git commit -m "feat: replace opt_worker with stub, move full to local-only

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 11: Stub `js/indicators.js`

**Files:**
- Rename: `js/indicators.js` → `js/indicators_full.js`
- Create: `js/indicators.js` (stub)

**Dependencies:** Imported by `chartRenderer.js` and `SubChartManager.js` as `import * as indicators from './indicators.js'`

- [ ] **Step 1: Rename original**

```bash
cd "E:\Tquant1" && cp js/indicators.js js/indicators_full.js && git rm js/indicators.js
```

- [ ] **Step 2: Create stub `js/indicators.js`**

```javascript
// stub: simplified public version — full implementation is local only
// ponytail: only EMA/SMA/MACD kept; full version has RSI/KDJ/Bollinger/CCI/OBV/etc.

function ema(data, period) {
    const k = 2 / (period + 1);
    const result = new Array(data.length).fill(null);
    if (data.length === 0) return result;
    let prev = data[0];
    result[0] = prev;
    for (let i = 1; i < data.length; i++) {
        const cur = data[i] * k + prev * (1 - k);
        result[i] = cur;
        prev = cur;
    }
    return result;
}

function sma(data, period) {
    const result = new Array(data.length).fill(null);
    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) sum += data[i - j];
        result[i] = parseFloat((sum / period).toFixed(2));
    }
    return result;
}

export function calculateMACD(closes, fast = 12, slow = 26, signal = 9) {
    const n = closes.length;
    const dif = new Array(n).fill(null);
    const dea = new Array(n).fill(null);
    const histogram = new Array(n).fill(null);
    if (n < slow) return { dif, dea, histogram };
    const emaFast = ema(closes, fast);
    const emaSlow = ema(closes, slow);
    for (let i = 0; i < n; i++) {
        if (emaFast[i] !== null && emaSlow[i] !== null) {
            dif[i] = parseFloat((emaFast[i] - emaSlow[i]).toFixed(4));
        }
    }
    let difStart = 0;
    while (difStart < n && dif[difStart] === null) difStart++;
    if (difStart < n) {
        const difSlice = dif.slice(difStart);
        const deaSlice = ema(difSlice, signal);
        for (let j = 0; j < deaSlice.length; j++) {
            dea[difStart + j] = parseFloat(deaSlice[j].toFixed(4));
        }
        for (let i = difStart + signal - 1; i < n; i++) {
            if (dif[i] !== null && dea[i] !== null) {
                histogram[i] = parseFloat(((dif[i] - dea[i]) * 2).toFixed(4));
            }
        }
    }
    return { dif, dea, histogram };
}

// Stub: other indicators return empty arrays. Full version has RSI, KDJ, Bollinger, etc.
export function calculateRSI(closes, period = 14) {
    return new Array(closes.length).fill(null);
}

export function calculateKDJ(highs, lows, closes, n = 9, m1 = 3, m2 = 3) {
    const nLen = closes.length;
    return { k: new Array(nLen).fill(null), d: new Array(nLen).fill(null), j: new Array(nLen).fill(null) };
}

export function calculateBollinger(closes, period = 20, multiplier = 2) {
    const n = closes.length;
    return { upper: new Array(n).fill(null), middle: new Array(n).fill(null), lower: new Array(n).fill(null) };
}

export function calculateCCI(highs, lows, closes, period = 14) {
    return new Array(closes.length).fill(null);
}

export function calculateOBV(closes, volumes) {
    return new Array(closes.length).fill(null);
}

export function calculateROC(closes, period = 12) {
    return new Array(closes.length).fill(null);
}

export function calculateWR(highs, lows, closes, period = 14) {
    return new Array(closes.length).fill(null);
}

export function calculatePSY(closes, period = 12) {
    return new Array(closes.length).fill(null);
}

export function calculateATR(highs, lows, closes, period = 14) {
    return new Array(closes.length).fill(null);
}
```

- [ ] **Step 3: Verify the stub exports match what `chartRenderer.js` imports**

No runtime verification for JS (browser-dependent). Confirm all exports listed:
- `calculateMACD`, `calculateRSI`, `calculateKDJ`, `calculateBollinger`
- `calculateCCI`, `calculateOBV`, `calculateROC`, `calculateWR`, `calculatePSY`, `calculateATR`

- [ ] **Step 4: Commit**

```bash
git add js/indicators.js
git commit -m "feat: replace indicators.js with stub, move full to local-only

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 12: Stub `js/strategyBuilder.js`

**Files:**
- Rename: `js/strategyBuilder.js` → `js/strategyBuilder_full.js`
- Create: `js/strategyBuilder.js` (stub)

**Dependencies:** Imported by `navigation.js` as `renderStrategyPage`. Imports from `strategyTemplates.js`, `strategyUtils.js`, `bridge.js`, `stockData.js`, `logger.js`.

- [ ] **Step 1: Rename original**

```bash
cd "E:\Tquant1" && cp js/strategyBuilder.js js/strategyBuilder_full.js && git rm js/strategyBuilder.js
```

- [ ] **Step 2: Create stub `js/strategyBuilder.js`**

```javascript
// stub: simplified public version — full implementation is local only
// ponytail: keeps renderStrategyPage shell; full version has full card builder UI

import { bridge } from './bridge.js';
import { Logger } from './logger.js';

var strategyLogger = new Logger('Strategy');

export function renderStrategyPage(container) {
    if (!container) return;
    container.innerHTML = `
        <div style="padding: 40px; text-align: center; color: #888;">
            <h2>策略工厂</h2>
            <p>公开版仅展示策略框架界面，完整版支持：</p>
            <ul style="list-style: none; padding: 0; line-height: 2;">
                <li>可视化卡片式策略构建</li>
                <li>拖拽组合技术指标 (MA/RSI/MACD/KDJ 等 12+ 指标)</li>
                <li>Optuna TPE 智能超参搜索</li>
                <li>单股/多股组合回测</li>
                <li>策略变体对比</li>
            </ul>
            <p style="margin-top: 20px; font-size: 12px; color: #555;">
                策略配置文件保存在 <code>strategies/</code> 目录
            </p>
        </div>
    `;

    // Set up bridge callback for when strategy page is fully loaded
    if (bridge && bridge.onStrategyPageReady) {
        bridge.onStrategyPageReady();
    }
}

// Export stub functions referenced by other modules
export function getCurrentStockPool() { return []; }
export function reloadStockPool() {}
```

- [ ] **Step 3: Verify `navigation.js` import compatibility**

Check: `navigation.js` imports `{ renderStrategyPage }` — stub exports this function.

- [ ] **Step 4: Commit**

```bash
git add js/strategyBuilder.js
git commit -m "feat: replace strategyBuilder.js with stub, move full to local-only

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 13: Stub `js/strategyTemplates.js`

**Files:**
- Rename: `js/strategyTemplates.js` → `js/strategyTemplates_full.js`
- Create: `js/strategyTemplates.js` (stub)

**Dependencies:** Imported by `strategyBuilder.js`, `strategyUtils.js`, `compareStrategy.js`, `stockScreener.js`, `navigation.js`

- [ ] **Step 1: Rename original**

```bash
cd "E:\Tquant1" && cp js/strategyTemplates.js js/strategyTemplates_full.js && git rm js/strategyTemplates.js
```

- [ ] **Step 2: Create stub `js/strategyTemplates.js`**

```javascript
// stub: simplified public version — full implementation is local only
// ponytail: keeps 2 demo card types; full version has 12+ card types + templates

export function generateCardId() {
    return 'card_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
}

export var CARD_TYPE_META = {
    ma_cross: {
        type: 'ma_cross',
        label: '均线交叉',
        icon: '📊',
        description: '快慢均线金叉/死叉信号',
        defaultAction: 'buy',
        defaultParams: { fastPeriod: 5, slowPeriod: 20, direction: 'golden' },
        paramFields: [
            { key: 'fastPeriod', label: '快线周期', type: 'number', min: 2, max: 250, default: 5 },
            { key: 'slowPeriod', label: '慢线周期', type: 'number', min: 3, max: 500, default: 20 },
            { key: 'direction', label: '交叉方向', type: 'select', options: [
                { value: 'golden', label: '金叉（快线上穿慢线）' },
                { value: 'death', label: '死叉（快线下穿慢线）' }
            ], default: 'golden' }
        ]
    },
    rsi: {
        type: 'rsi',
        label: 'RSI 超买超卖',
        icon: '📈',
        description: '相对强弱指标超买超卖信号',
        defaultAction: 'buy',
        defaultParams: { period: 14, oversold: 30, overbought: 70, direction: 'oversold_buy' },
        paramFields: [
            { key: 'period', label: '计算周期', type: 'number', min: 2, max: 100, default: 14 },
            { key: 'oversold', label: '超卖阈值', type: 'number', min: 5, max: 50, default: 30 },
            { key: 'overbought', label: '超买阈值', type: 'number', min: 50, max: 95, default: 70 },
            { key: 'direction', label: '信号方向', type: 'select', options: [
                { value: 'oversold_buy', label: '超卖买入' },
                { value: 'overbought_sell', label: '超买卖出' }
            ], default: 'oversold_buy' }
        ]
    }
};

export var STRATEGY_TEMPLATES = [
    {
        name: '均线交叉策略（示例）',
        description: 'MA5/MA20 金叉买入，死叉卖出',
        cards: [
            { id: 'demo_1', type: 'ma_cross', action: 'buy', params: { fastPeriod: 5, slowPeriod: 20, direction: 'golden' } },
            { id: 'demo_2', type: 'ma_cross', action: 'sell', params: { fastPeriod: 5, slowPeriod: 20, direction: 'death' } }
        ]
    }
];

export function createDefaultCard(type) {
    var meta = CARD_TYPE_META[type];
    if (!meta) return null;
    return {
        id: generateCardId(),
        type: type,
        action: meta.defaultAction || 'buy',
        params: JSON.parse(JSON.stringify(meta.defaultParams || {}))
    };
}
```

- [ ] **Step 3: Commit**

```bash
git add js/strategyTemplates.js
git commit -m "feat: replace strategyTemplates.js with stub, move full to local-only

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 14: Stub `js/strategyUtils.js`

**Files:**
- Rename: `js/strategyUtils.js` → `js/strategyUtils_full.js`
- Create: `js/strategyUtils.js` (stub)

**Dependencies:** Imported by `strategyBuilder.js`, `compareStrategy.js`. Imports from `strategyTemplates.js`.

- [ ] **Step 1: Rename original**

```bash
cd "E:\Tquant1" && cp js/strategyUtils.js js/strategyUtils_full.js && git rm js/strategyUtils.js
```

- [ ] **Step 2: Create stub `js/strategyUtils.js`**

```javascript
// stub: simplified public version — full implementation is local only
// ponytail: keeps basic code generation for MA cross and RSI; full version has all card types

import { CARD_TYPE_META } from './strategyTemplates.js';

function indent(text, level) {
    var pad = '';
    for (var i = 0; i < level * 4; i++) pad += ' ';
    return text.split('\n').map(function(line) { return pad + line; }).join('\n');
}

function contextName(cardIdx, key) {
    return 'c' + cardIdx + '_' + key;
}

function ctxParam(cardIdx, key) {
    return 'context.' + contextName(cardIdx, key);
}

function genMACross(card, idx) {
    var p = card.params;
    var fast = contextName(idx, 'fast');
    var slow = contextName(idx, 'slow');
    var fastP = ctxParam(idx, 'fastPeriod');
    var slowP = ctxParam(idx, 'slowPeriod');
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var lines = [];
    lines.push('# Card ' + idx + ': 均线交叉');
    lines.push(fast + ' = history_bars(stock, ' + fastP + ' + 1, \'1d\', \'close\')');
    lines.push(slow + ' = history_bars(stock, ' + slowP + ' + 1, \'1d\', \'close\')');
    lines.push('if len(' + fast + ') < ' + fastP + ' + 1 or len(' + slow + ') < ' + slowP + ' + 1:');
    lines.push('    ' + sigVar + '.append(False)');
    lines.push('else:');
    lines.push('    ' + fast + '_ma = ' + fast + '[-' + fastP + ':].mean()');
    lines.push('    ' + slow + '_ma = ' + slow + '[-' + slowP + ':].mean()');
    lines.push('    ' + fast + '_ma_prev = ' + fast + '[:-1][-' + fastP + ':].mean()');
    lines.push('    ' + slow + '_ma_prev = ' + slow + '[:-1][-' + slowP + ':].mean()');
    lines.push('    if ' + fast + '_ma_prev <= ' + slow + '_ma_prev and ' + fast + '_ma > ' + slow + '_ma:');
    lines.push('        ' + sigVar + '.append(True)');
    lines.push('    else:');
    lines.push('        ' + sigVar + '.append(False)');
    return lines.join('\n');
}

function genRSI(card, idx) {
    var p = card.params;
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var lines = [];
    lines.push('# Card ' + idx + ': RSI');
    lines.push('rsi_vals = rsi(history_bars(stock, ' + ctxParam(idx, 'period') + ' + 1, \'1d\', \'close\'), ' + ctxParam(idx, 'period') + ')');
    lines.push('if len(rsi_vals) == 0 or rsi_vals[-1] is None:');
    lines.push('    ' + sigVar + '.append(False)');
    lines.push('else:');
    if (card.params.direction === 'oversold_buy') {
        lines.push('    ' + sigVar + '.append(rsi_vals[-1] < ' + ctxParam(idx, 'oversold') + ')');
    } else {
        lines.push('    ' + sigVar + '.append(rsi_vals[-1] > ' + ctxParam(idx, 'overbought') + ')');
    }
    return lines.join('\n');
}

var _generators = {
    'ma_cross': genMACross,
    'rsi': genRSI,
};

export function generateCode(cards, config) {
    if (!cards || cards.length === 0) return '# 无策略卡片';
    var lines = [
        '# Auto-generated strategy code (public demo version)',
        '# Full version supports 12+ indicator types',
        '',
        'def user(stock, context, history_bars, rsi, macd):',
        '    entry_signals = []',
        '    exit_signals = []',
        ''
    ];
    for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var gen = _generators[card.type];
        if (gen) {
            lines.push(indent(gen(card, i), 1));
            lines.push('');
        } else {
            lines.push(indent('# Card ' + i + ': ' + (card.type || 'unknown') + ' (仅完整版支持)', 1));
            lines.push('');
        }
    }
    lines.push('    return entry_signals, exit_signals');
    return lines.join('\n');
}

export function serializeConfig(cards, name, config) {
    return JSON.stringify({
        name: name || '',
        cards: cards || [],
        config: config || {},
        _version: 'demo'
    }, null, 2);
}

export function deserializeConfig(json) {
    try {
        var obj = JSON.parse(json);
        return obj || { cards: [], name: '', config: {} };
    } catch (e) {
        return { cards: [], name: '', config: {} };
    }
}

export function validateCards(cards) {
    if (!cards || cards.length === 0) return { valid: false, errors: ['至少需要一个策略卡片'] };
    return { valid: true, errors: [] };
}

export function extractParamsFromCards(cards) {
    var params = {};
    for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        if (card.params) {
            for (var key in card.params) {
                params[contextName(i, key)] = card.params[key];
            }
        }
    }
    return params;
}
```

- [ ] **Step 3: Commit**

```bash
git add js/strategyUtils.js
git commit -m "feat: replace strategyUtils.js with stub, move full to local-only

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 15: Final verification — app launch and git state

- [ ] **Step 1: Verify all Python imports chain works**

```bash
cd "E:\Tquant1" && python -c "
from backend.strategy_engine import StrategyEngine
from backend.trade_simulation import TradeSimulation
from backend.backtest_executor import BacktestExecutor, Logger, calculate_benchmark_metrics
from backend.multi_backtest_executor import MultiBacktestExecutor
from backend.stock_screener import StockScreener
from backend.realtime_strategy_engine import RealtimeStrategyEngine
from backend.multi_realtime_strategy_engine import MultiRealtimeStrategyEngine
from backend.optimization import OptunaWorker
from backend.optimization.opt_objective import run_objective, compute_objective, suggest_for_param, inject_params
print('All imports OK')
"
```
Expected: `All imports OK`

- [ ] **Step 2: Verify app launches without import errors**

```bash
cd "E:\Tquant1" && timeout 5 python main.py 2>&1 || true
```
Expected: No `ModuleNotFoundError` or `ImportError` in output

- [ ] **Step 3: Verify no `*_full.*` files are tracked by git**

```bash
cd "E:\Tquant1" && git ls-files | grep "_full\." || echo "No _full files tracked — good"
```
Expected: `No _full files tracked — good`

- [ ] **Step 4: Verify `*_full.*` files are ignored by .gitignore**

```bash
cd "E:\Tquant1" && git status --short | grep "_full\." || echo "No _full files in status — good"
```
Expected: `No _full files in status — good`

- [ ] **Step 5: Verify git status is clean for tracked files**

```bash
cd "E:\Tquant1" && git status
```
Expected: Only untracked files are `*_full.*` and pre-existing untracked files (build/, dist/, etc.)

- [ ] **Step 6: Commit verification**

```bash
git add -A
git commit -m "chore: final verification after strategy obfuscation

All stubs created, full implementations local-only via *_full.* files.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Implementation Order

Tasks 1→14 must run sequentially (each task depends on previous commits being clean).
Task 15 runs last for final verification.

## Rollback

To restore full implementations locally:
```bash
cd "E:\Tquant1"
for f in backend/*_full.py backend/optimization/*_full.py js/*_full.js; do
    base="${f%_full.*}.${f##*.}"
    cp "$f" "$base"
done
```
