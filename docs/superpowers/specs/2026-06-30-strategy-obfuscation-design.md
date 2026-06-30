# Strategy Logic Obfuscation — Design

**Date:** 2026-06-30
**Type:** Code obfuscation — hide proprietary strategy logic from public repo

## Goal

Keep full strategy/backtest/screening implementations locally while pushing simplified stub versions to the public GitHub repo. Public repo stays functional (no import errors) but core algorithms are replaced with demo/mock logic.

## Scope

### Files to obfuscate (14 files)

**Backend — Core Strategy (8 files):**

| File | Size | Stub strategy |
|------|------|---------------|
| `backend/backtest_executor.py` | 34KB | Keep interface, replace metrics calc with minimal formulas |
| `backend/multi_backtest_executor.py` | 35KB | Keep interface, simplify multi-stock logic |
| `backend/stock_screener.py` | 109KB | Keep 1-2 simple indicators (MA cross), stubs for rest |
| `backend/realtime_strategy_engine.py` | 15KB | Mock signal generation, keep async interface |
| `backend/multi_realtime_strategy_engine.py` | 21KB | Simplified multi-stock realtime |
| `backend/trade_simulation.py` | 5.6KB | Basic buy/sell tracking, remove advanced logic |
| `backend/strategy_engine.py` | 3.9KB | Already simple MA-cross demo — keep as-is |
| `backend/optimization/opt_objective.py` | — | Replace Optuna objective with placeholder |
| `backend/optimization/opt_worker.py` | — | Simplified optimization loop |

**Frontend — Strategy UI (4 files):**

| File | Stub strategy |
|------|---------------|
| `js/indicators.js` | Keep 1-2 basic indicators, remove advanced calculations |
| `js/strategyBuilder.js` | Keep UI skeleton, remove complex strategy assembly |
| `js/strategyTemplates.js` | Keep 1-2 demo templates |
| `js/strategyUtils.js` | Keep utility functions that don't expose algorithms |

### Files NOT touched

- `app/web_bridge.py`, `app/main_window.py`, `main.py` — UI framework
- `backend/db.py`, `backend/data_feed.py` — data infrastructure
- `backend/data_updater/*` — data pipelines
- `backend/auto_trader.py` — already public
- `backend/config_manager.py` — configuration
- All HTML/CSS, `js/main.js`, `js/navigation.js`, `js/chartRenderer.js` — UI rendering

## Implementation Plan

### File naming convention

1. Rename original file → `xxx_full.py` (or `xxx_full.js`)
2. Create stub → `xxx.py` (or `xxx.js`) — same name, simplified content
3. Add `*_full.py` and `*_full.js` to `.gitignore`

### Stub construction rules

- **Same imports, same class/function signatures** — `web_bridge.py` must not break
- **Same return types** — frontend JavaScript must not crash
- **Minimal logic** — just enough to demo the feature exists
- **Comment header** in every stub: `# stub: simplified public version — full implementation is local only`
- **No hardcoded secrets** — no tokens, no API keys, no real thresholds

### .gitignore additions

```
# Private full implementations (local only)
*_full.py
*_full.js
```

### Local development

- Local machine keeps `_full.py` files with real implementations
- No import changes needed — stubs and full versions share same module names from git perspective
- Developer manually copies `_full.py` over `xxx.py` when working locally (or uses a script)

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Accidental commit of `_full` file | `.gitignore` rule, pre-commit hook check |
| Stub returns wrong type, crashes UI | Per-file testing after stub creation |
| New contributor confused by stubs | README section explaining public vs private versions |
| Git history still contains old full code | Accept — squashing history is destructive and not worth it |

## Verification

After implementation:
1. Run `python main.py` — app launches without import errors
2. Navigate to backtest page — UI loads, stub returns mock results
3. Navigate to screener page — basic filters work
4. Run `git status` — no `_full` files staged
5. Check `git ls-files` — only stub files tracked
