# Multi-Stock Strategy Optimization Design

**Date:** 2026-06-28
**Status:** approved

## Summary

Extend Optuna parameter optimization from single stock to multi-stock. Each trial runs `MultiBacktestExecutor` (shared capital pool) across all stocks in the pool, producing a combined objective value. Supports dual mode: single-stock (existing, quick test) and multi-stock (pool-based).

## Architecture

```
Frontend optimization panel
  ├─ Mode toggle: 单股 / 多股
  ├─ Single: <input> stock code (existing)
  └─ Multi:  shows pool name + stock count (read-only, from currentStockPool)
       │
       ▼ start_optimization(params)
web_bridge.py
  │  params.stock_codes = [...]  // multi mode: list
  │  params.stock = "000001"     // single mode: string (backward compat)
  ▼
OptunaWorker.run()
  │  chooses executor based on whether stock_codes is present
  ▼
objective(trial)
  ├─ Single: BacktestExecutor.run(stock_code)
  └─ Multi:  MultiBacktestExecutor.run(stock_codes)  // shared capital pool
       │
       ▼ compute_objective(metrics) → float
```

Single-stock path untouched. Multi-stock path: `run_objective` gains optional `stock_codes` parameter.

## Trial Count Auto-Scaling

Multi-stock trials are slower. Trial count scales down with stock count:

```
adjusted = max(30, floor(base_trials / sqrt(stock_count)))
```

| Stocks | base=100 | base=200 |
|--------|----------|----------|
| 1      | 100      | 200      |
| 3      | 57       | 115      |
| 5      | 44       | 89       |
| 10     | 31       | 63       |

- User inputs base trial count (same input box)
- Backend computes adjusted count when `stock_codes` present
- Frontend shows adjusted count as read-only hint in multi mode
- Switching back to single restores original value

## Frontend UI

```
┌─────────────────────────────────────────────┐
│ 🔍 参数优化 — Optuna TPE 智能搜索            │
│                                              │
│ 📈 模式:  [单股 ●] [多股 ○]                  │
│                                              │
│ 单股: [000001]  stock input                  │
│ 多股: 📊 当前股票池: 沪深300成分股 (18只)     │
│       ⚠ trial数已调整为 42 (基础100)         │
│                                              │
│ 🎯 目标: [稳健▼]  🔢 试验次数: [100]         │
│ ...                                          │
└─────────────────────────────────────────────┘
```

- Mode toggle: two mutually exclusive buttons, default single
- Multi mode: stock input hidden, pool name + count shown (read-only)
- Multi button disabled when `currentStockPool` empty or ≤1 stock
- Adjusted trial hint shown only in multi mode

## Backend Changes

### `opt_objective.py`

- `run_objective()`: add `stock_codes=None` parameter
- When `stock_codes` provided with len > 1: use `MultiBacktestExecutor` instead of `BacktestExecutor`
- Strategy code STOCK_CODE_PLACEHOLDER replacement: use first stock for single mode (unchanged), use multi-stock path for list

### `opt_worker.py`

- `objective()` closure: pass `stock_codes` from params to `run_objective`
- Compute adjusted `n_trials` when `stock_codes` present
- Progress callback: include `mode` and `stock_count` in progress dict

### `web_bridge.py`

- `start_optimization()`: accept `stock_codes` in params (optional list)
- Pass through to OptunaWorker unchanged (already JSON-serializable)

## Frontend Changes

### `strategyBuilder.js`

- `renderOptimizationPanel()`: add mode toggle UI
- On mode switch: show/hide stock input vs pool info
- Read `currentStockPool` for pool display
- Build params with `stock_codes` list in multi mode, `stock` string in single mode
- `startOptimization()`: send `stock_codes` when in multi mode
- Trial hint: read-only display of adjusted count

## Shared DataFeed

MultiBacktestExecutor also reuses a single `DataFeed` instance across trials (same pattern as current single-stock optimization) to prevent SQLite connection accumulation.

## Edge Cases

- **Empty pool**: multi button disabled, cannot start
- **Pool = 1 stock**: treated as single mode (no point running multi-backtest for one stock)
- **Trial cap**: minimum 30 trials regardless of stock count
- **Cancel**: works same as single mode — `requestInterruption()` + `study.stop()`

## Not in Scope

- Per-stock weighting in objective
- Random stock subset sampling per trial
- Optimization history page (existing pending item)
- min_trades frontend configuration (existing pending item)
