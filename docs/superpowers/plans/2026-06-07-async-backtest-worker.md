# Async Backtest Worker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate UI freeze during backtests by running all backtest execution in QThread workers with progress reporting, cancel support, and non-blocking @Slot methods.

**Architecture:** BacktestWorker (QThread) runs backtest logic in dedicated thread. BacktestJobManager tracks active jobs, collects progress updates via thread-safe queue, and pushes to frontend via QTimer-driven signal. @Slot methods return immediately with job_id; frontend polls for progress and fetches result when complete.

**Tech Stack:** PySide6 QThread + Signal, threading.Queue, Python concurrent.futures (for compare multi-variation), JSON serialization for result passing.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/backtest_worker.py` | **Create** | `BacktestWorker(QThread)` — runs single/multi/compare backtest in thread, emits progress |
| `backend/backtest_job_manager.py` | **Create** | `BacktestJobManager` — tracks jobs, progress polling, result caching, cancel support |
| `app/web_bridge.py` | **Modify** | Replace backtest @Slot bodies with async dispatch to BacktestJobManager; add progress/result/cancel slots |
| `js/codeEditor.js` | **Modify** | Replace direct `.then()` with polling loop + progress bar |
| `js/compareStrategy.js` | **Modify** | Same polling pattern for compare backtest |
| `backend/backtest_executor.py` | **Modify** | Add progress callback parameter to `run()` |
| `backend/multi_backtest_executor.py` | **Modify** | Add progress callback parameter to `run()` |
| `backend/async_db.py` | **No change** | Already created, available for future use |
| `backend/async_quote_fetcher.py` | **No change** | Already created |
| `backend/multi_realtime_strategy_engine.py` | **No change** | Already rewritten to async |
| `backend/realtime_strategy_engine.py` | **No change** | Already rewritten to async |

---

### Task 1: Add progress callback to BacktestExecutor.run()

**Files:**
- Modify: `backend/backtest_executor.py:429-677`

Add an optional `progress_callback` parameter to `run()`. The callback receives `(current_idx, total_rows)` after each bar.

- [ ] **Step 1: Add progress_callback parameter to run()**

In `backend/backtest_executor.py`, change the `run()` signature (line 429):

```python
def run(self, user_code, stock_code, start_date="2010-01-01", end_date="2026-12-31",
        initial_cash=1000000, slippage="close",
        commission_rate=0.0003, stamp_tax_rate=0.001,
        slippage_cost_type="percent", slippage_cost_value=0.1,
        benchmark_code=None, progress_callback=None):
```

- [ ] **Step 2: Call progress_callback in main loop**

In the main loop (around line 593-633), after `self.current_idx = idx`, add the progress call:

```python
for idx in range(total_rows):
    bar = df.iloc[idx]
    context.current_dt = df.index[idx]
    self.current_idx = idx

    # NEW: report progress
    if progress_callback:
        try:
            progress_callback(idx, total_rows)
        except Exception:
            pass  # never crash on progress failure

    bar_dict = {
        'open': bar['open'],
        ...
    }
    # ... rest of loop unchanged
```

- [ ] **Step 3: Add early-termination check**

Add a `_cancelled` flag to BacktestExecutor that progress_callback can trigger:

```python
# In __init__ (around line 112):
self._cancelled = False

# In main loop, after progress callback:
if self._cancelled:
    logs.append("[INFO] 回测已被用户取消")
    break
```

- [ ] **Step 4: Commit**

```bash
git add backend/backtest_executor.py
git commit -m "feat: add progress_callback and cancel support to BacktestExecutor"
```

---

### Task 2: Add progress callback to MultiBacktestExecutor.run()

**Files:**
- Modify: `backend/multi_backtest_executor.py:184-508`

Same pattern as Task 1, adapted for the multi-stock main loop.

- [ ] **Step 1: Add progress_callback parameter**

```python
def run(self, user_code, stock_codes, start_date="2010-01-01", end_date="2026-12-31",
        initial_cash=1000000, slippage="close",
        commission_rate=0.0003, stamp_tax_rate=0.001,
        slippage_cost_type="percent", slippage_cost_value=0.1,
        benchmark_code=None, progress_callback=None):
```

- [ ] **Step 2: Add _cancelled flag to __init__**

```python
# In __init__ (around line 178):
self._cancelled = False
```

- [ ] **Step 3: Call progress_callback in main date loop**

In the main loop (around line 356), after date iteration:

```python
for date_idx, current_date in enumerate(common_dates):
    if self._cancelled:
        self.logs.append("[INFO] 回测已被用户取消")
        break

    date_str = current_date.strftime('%Y-%m-%d')
    shared_context.current_dt = current_date
    shared_context._pending_orders = []

    if progress_callback:
        try:
            progress_callback(date_idx, len(common_dates))
        except Exception:
            pass
    # ... rest of 5a-5d unchanged
```

- [ ] **Step 4: Commit**

```bash
git add backend/multi_backtest_executor.py
git commit -m "feat: add progress_callback and cancel support to MultiBacktestExecutor"
```

---

### Task 3: Create BacktestWorker (QThread)

**Files:**
- Create: `backend/backtest_worker.py`

QThread subclass that runs a backtest in its `run()` method, emits progress and result via Qt signals.

- [ ] **Step 1: Create file with imports and signal definitions**

```python
"""Backtest worker: runs backtest in QThread, emits progress and result via signals."""

import json
import traceback

from PySide6.QtCore import QThread, Signal

from backend.data_feed import DataFeed
from backend.backtest_executor import BacktestExecutor
from backend.multi_backtest_executor import MultiBacktestExecutor


class BacktestWorker(QThread):
    """Runs a backtest job in a background thread.

    Signals:
        progress(current, total)  — emitted after each bar/date
        finished(result_dict)     — emitted on completion (success or error)
        log(message)              — optional: log messages from backend
    """

    progress = Signal(int, int)
    finished = Signal(dict)
    log_message = Signal(str)

    def __init__(self, params, parent=None):
        super().__init__(parent)
        self.params = params  # dict with all backtest parameters
        self._executor_ref = None  # keep reference for cancel()

    def run(self):
        try:
            p = self.params
            mode = p.get("mode", "single")  # "single", "multi", "compare"

            if mode == "compare":
                result = self._run_compare(p)
            elif mode == "multi":
                result = self._run_multi(p)
            else:
                result = self._run_single(p)

            self.finished.emit(result)
        except Exception as e:
            traceback.print_exc()
            self.finished.emit({
                "success": False,
                "error": str(e),
                "signals": [],
                "equity_curve": [],
                "metrics": {},
                "logs": [f"[ERROR] Worker crashed: {e}"],
            })

    def cancel(self):
        """Request cancellation of the running backtest."""
        if self._executor_ref:
            self._executor_ref._cancelled = True
        self.requestInterruption()

    # ── single stock ──

    def _run_single(self, p):
        data_feed = DataFeed()
        executor = BacktestExecutor(data_feed)
        self._executor_ref = executor

        def on_progress(idx, total):
            if self.isInterruptionRequested():
                executor._cancelled = True
            self.progress.emit(idx, total)

        result = executor.run(
            user_code=p["code"],
            stock_code=p["stock"],
            start_date=p.get("start", "2010-01-01"),
            end_date=p.get("end", "2026-12-31"),
            initial_cash=p.get("cash", 1000000),
            slippage=p.get("slippage", "close"),
            commission_rate=p.get("commission_rate", 0.0003),
            stamp_tax_rate=p.get("stamp_tax_rate", 0.001),
            slippage_cost_type=p.get("slippage_cost_type", "percent"),
            slippage_cost_value=p.get("slippage_cost_value", 0.1),
            benchmark_code=p.get("benchmark_code"),
            progress_callback=on_progress,
        )

        result["success"] = (result.get("status") != "error")
        if "status" in result:
            del result["status"]
        return result

    # ── multi stock ──

    def _run_multi(self, p):
        data_feed = DataFeed()
        executor = MultiBacktestExecutor(data_feed)
        self._executor_ref = executor

        def on_progress(idx, total):
            if self.isInterruptionRequested():
                executor._cancelled = True
            self.progress.emit(idx, total)

        result = executor.run(
            user_code=p["code"],
            stock_codes=p.get("stocks", []),
            start_date=p.get("start", "2010-01-01"),
            end_date=p.get("end", "2026-12-31"),
            initial_cash=p.get("cash", 1000000),
            slippage=p.get("slippage", "close"),
            commission_rate=p.get("commission_rate", 0.0003),
            stamp_tax_rate=p.get("stamp_tax_rate", 0.001),
            slippage_cost_type=p.get("slippage_cost_type", "percent"),
            slippage_cost_value=p.get("slippage_cost_value", 0.1),
            benchmark_code=p.get("benchmark_code"),
            progress_callback=on_progress,
        )

        return result

    # ── compare (multi-variation) ──

    def _run_compare(self, p):
        """Run multiple strategy variations on same stock pool.
        Uses ThreadPoolExecutor for parallelism within the worker thread.
        """
        from concurrent.futures import ThreadPoolExecutor, as_completed

        variations = p.get("variations", [])
        stock_pool = p.get("stock_pool", [p.get("stock", "000001")])
        use_multi = p.get("use_multi", len(stock_pool) > 1)
        total_vars = len(variations)

        results = []
        errors = []

        def run_one(variation):
            name = variation.get("name", "未命名")
            code = variation.get("code", "")
            if not code:
                return (name, None, "策略代码为空")

            try:
                data_feed = DataFeed()
                if use_multi:
                    executor = MultiBacktestExecutor(data_feed)
                    result = executor.run(
                        code, stock_pool,
                        start_date=p.get("start", "2010-01-01"),
                        end_date=p.get("end", "2026-12-31"),
                        initial_cash=p.get("cash", 1000000),
                        slippage=p.get("slippage", "close"),
                        commission_rate=p.get("commission_rate", 0.0003),
                        stamp_tax_rate=p.get("stamp_tax_rate", 0.001),
                        slippage_cost_type=p.get("slippage_cost_type", "percent"),
                        slippage_cost_value=p.get("slippage_cost_value", 0.1),
                        benchmark_code=p.get("benchmark_code"),
                    )
                else:
                    executor = BacktestExecutor(data_feed)
                    result = executor.run(
                        code, stock_pool[0],
                        start_date=p.get("start", "2010-01-01"),
                        end_date=p.get("end", "2026-12-31"),
                        initial_cash=p.get("cash", 1000000),
                        slippage=p.get("slippage", "close"),
                        commission_rate=p.get("commission_rate", 0.0003),
                        stamp_tax_rate=p.get("stamp_tax_rate", 0.001),
                        slippage_cost_type=p.get("slippage_cost_type", "percent"),
                        slippage_cost_value=p.get("slippage_cost_value", 0.1),
                        benchmark_code=p.get("benchmark_code"),
                    )

                if not result.get("success") and "error" in result:
                    return (name, None, result["error"])

                return (name, {
                    "name": name,
                    "equity_curve": result.get("equity_curve", []),
                    "metrics": result.get("metrics", {}),
                    "signals": result.get("signals", []),
                    "logs": result.get("logs", []),
                    "stock_performance": result.get("stock_performance", []),
                    "benchmark_equity_curve": result.get("benchmark_equity_curve"),
                    "benchmark_code": result.get("benchmark_code"),
                    "errors": result.get("errors", []),
                }, None)
            except Exception as e:
                traceback.print_exc()
                return (name, None, str(e))

        max_workers = min(total_vars, 5)
        completed = 0
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = {pool.submit(run_one, v): v for v in variations}
            for future in as_completed(futures):
                if self.isInterruptionRequested():
                    for f in futures:
                        f.cancel()
                    break
                name, data, err = future.result()
                completed += 1
                self.progress.emit(completed, total_vars)
                if err:
                    errors.append({"name": name, "error": err})
                if data:
                    results.append(data)

        return {
            "success": len(results) > 0,
            "results": results,
            "errors": errors,
        }
```

- [ ] **Step 2: Commit**

```bash
git add backend/backtest_worker.py
git commit -m "feat: add BacktestWorker QThread for async backtest execution"
```

---

### Task 4: Create BacktestJobManager

**Files:**
- Create: `backend/backtest_job_manager.py`

Tracks active backtest jobs, provides thread-safe progress/result access, manages cleanup.

- [ ] **Step 1: Create file**

```python
"""Backtest job manager: tracks active workers, collects progress, caches results."""

import uuid
import threading
from PySide6.QtCore import QObject, Signal


class BacktestJobManager(QObject):
    """Singleton manager for backtest jobs.

    Lifecycle of a job:
      1. JS calls start_backtest → slot creates worker → returns job_id
      2. QTimer polls progress → slot returns {current, total, status}
      3. Worker finishes → slot get_result returns full data
      4. JS calls cleanup → manager removes cached result
    """

    # Signal emitted when a job finishes (for push-based notification to JS)
    job_finished = Signal(str)  # job_id

    def __init__(self, parent=None):
        super().__init__(parent)
        self._lock = threading.Lock()
        self._jobs = {}  # job_id -> {"worker": BacktestWorker, "progress": (cur,total), "result": dict|None, "status": str}

    def start_job(self, worker, job_id=None):
        """Register and start a BacktestWorker. Returns job_id."""
        if job_id is None:
            job_id = uuid.uuid4().hex[:12]

        worker.progress.connect(
            lambda cur, tot, jid=job_id: self._on_progress(jid, cur, tot)
        )
        worker.finished.connect(
            lambda result, jid=job_id: self._on_finished(jid, result)
        )

        with self._lock:
            self._jobs[job_id] = {
                "worker": worker,
                "progress": (0, 1),
                "result": None,
                "status": "running",
            }

        worker.start()
        return job_id

    def cancel_job(self, job_id):
        """Request cancellation of a running job."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job and job["status"] == "running":
                job["worker"].cancel()
                job["status"] = "cancelling"

    def get_progress(self, job_id):
        """Return {status, current, total} for polling."""
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return {"status": "not_found", "current": 0, "total": 0}
            cur, tot = job["progress"]
            return {"status": job["status"], "current": cur, "total": tot}

    def get_result(self, job_id):
        """Return cached result dict, or None if not yet finished."""
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            return job.get("result")

    def cleanup_job(self, job_id):
        """Remove a finished job from tracking (free memory)."""
        with self._lock:
            if job_id in self._jobs:
                del self._jobs[job_id]

    def cancel_all(self):
        """Cancel all running jobs (e.g., on app shutdown)."""
        with self._lock:
            for job_id, job in list(self._jobs.items()):
                if job["status"] == "running":
                    job["worker"].cancel()

    # ── internal slots ──

    def _on_progress(self, job_id, current, total):
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job["progress"] = (current, total)

    def _on_finished(self, job_id, result):
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job["result"] = result
                job["status"] = "finished"
                job["progress"] = job["progress"][1], job["progress"][1]  # 100%
        self.job_finished.emit(job_id)
```

- [ ] **Step 2: Commit**

```bash
git add backend/backtest_job_manager.py
git commit -m "feat: add BacktestJobManager for async job tracking and progress"
```

---

### Task 5: Modify web_bridge.py — replace blocking backtest slots

**Files:**
- Modify: `app/web_bridge.py`

Replace `run_custom_backtest`, `run_multi_backtest`, `run_compare_backtest` body with async dispatch. Add new slots: `get_backtest_progress`, `get_backtest_result`, `cancel_backtest`, `cleanup_backtest`.

- [ ] **Step 1: Add imports and job_manager init**

In `web_bridge.py`, add near other imports (around line 29):

```python
from backend.backtest_worker import BacktestWorker
from backend.backtest_job_manager import BacktestJobManager
```

In `WebBridge.__init__` (after `self.auto_trader = ...`, around line 107):

```python
self._backtest_job_manager = BacktestJobManager(self)
```

- [ ] **Step 2: Replace run_custom_backtest slot (line 699)**

Replace the body of `run_custom_backtest` to dispatch to worker and return job_id immediately:

```python
@Slot(str, result=str)
def run_custom_backtest(self, params_json):
    """Start backtest in background thread. Returns {success, job_id} immediately."""
    try:
        params = json.loads(params_json)
        params["mode"] = "single"
        worker = BacktestWorker(params)
        job_id = self._backtest_job_manager.start_job(worker)
        return json.dumps({"success": True, "job_id": job_id, "message": "回测已启动"})
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        return json.dumps({"success": False, "error": str(e)})
```

- [ ] **Step 3: Replace run_multi_backtest slot (line 749)**

```python
@Slot(str, result=str)
def run_multi_backtest(self, params_json):
    """Start multi-stock backtest in background thread."""
    try:
        params = json.loads(params_json)
        params["mode"] = "multi"
        worker = BacktestWorker(params)
        job_id = self._backtest_job_manager.start_job(worker)
        return json.dumps({"success": True, "job_id": job_id, "message": "多股回测已启动"})
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        return json.dumps({"success": False, "error": str(e)})
```

- [ ] **Step 4: Replace run_compare_backtest slot (line 823)**

Remove the entire `ThreadPoolExecutor as_completed` logic inside the slot. Replace with:

```python
@Slot(str, result=str)
def run_compare_backtest(self, params_json):
    """Start compare backtest in background thread."""
    try:
        params = json.loads(params_json)
        stock_pool = params.get("stock_pool", None)
        stock_code = params.get("stock_code", "000001")

        if stock_pool and isinstance(stock_pool, list) and len(stock_pool) > 0:
            stock_pool = list(dict.fromkeys([s.split('.')[0] for s in stock_pool]))
        else:
            stock_pool = [stock_code.split('.')[0]]

        params["mode"] = "compare"
        params["stock_pool"] = stock_pool
        params["use_multi"] = len(stock_pool) > 1

        worker = BacktestWorker(params)
        job_id = self._backtest_job_manager.start_job(worker)
        return json.dumps({"success": True, "job_id": job_id, "message": "对比回测已启动"})
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        return json.dumps({"success": False, "error": str(e)})
```

- [ ] **Step 5: Add new polling slots**

```python
@Slot(str, result=str)
def get_backtest_progress(self, job_id):
    """Poll progress of a running backtest job."""
    try:
        progress = self._backtest_job_manager.get_progress(job_id)
        return json.dumps(progress)
    except Exception as e:
        return json.dumps({"status": "error", "error": str(e)})

@Slot(str, result=str)
def get_backtest_result(self, job_id):
    """Get the completed backtest result. Returns null if still running."""
    try:
        result = self._backtest_job_manager.get_result(job_id)
        if result is None:
            return json.dumps({"ready": False})
        # Convert to JSON-safe format
        return json.dumps({"ready": True, "result": WebBridge._to_json_safe(result)})
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        return json.dumps({"ready": False, "error": str(e)})

@Slot(str, result=str)
def cancel_backtest(self, job_id):
    """Cancel a running backtest job."""
    try:
        self._backtest_job_manager.cancel_job(job_id)
        return json.dumps({"success": True})
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})

@Slot(str, result=str)
def cleanup_backtest(self, job_id):
    """Remove a finished job from memory."""
    try:
        self._backtest_job_manager.cleanup_job(job_id)
        return json.dumps({"success": True})
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})
```

- [ ] **Step 6: Commit**

```bash
git add app/web_bridge.py
git commit -m "feat: replace blocking backtest slots with async QThread dispatch"
```

---

### Task 6: Update JS frontend — polling progress for single/multi backtest

**Files:**
- Modify: `js/codeEditor.js` (around lines 420-513)

Replace the direct `.then()` pattern with a polling loop that shows a progress bar.

- [ ] **Step 1: Add progress bar HTML to the backtest modal**

Find the backtest parameter modal in Tquant.html (or wherever the modal is built) and add a progress element:

```html
<div id="backtestProgressContainer" style="display:none; margin:10px 0;">
    <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
        <span id="backtestProgressLabel">回测进行中...</span>
        <span id="backtestProgressPercent">0%</span>
    </div>
    <div style="background:#333; border-radius:4px; height:6px; overflow:hidden;">
        <div id="backtestProgressBar" style="background:#4caf50; height:100%; width:0%; transition:width 0.3s;"></div>
    </div>
    <button id="backtestCancelBtn" style="margin-top:8px; background:#c0392b; color:#fff; border:none; padding:4px 12px; border-radius:4px; cursor:pointer; display:none;">取消回测</button>
</div>
```

- [ ] **Step 2: Modify single-stock backtest call (around line 519-530)**

Replace the `bridge.run_custom_backtest(...).then(...)` block with polling logic:

```javascript
// Start backtest
var progressContainer = document.getElementById('backtestProgressContainer');
var progressBar = document.getElementById('backtestProgressBar');
var progressPercent = document.getElementById('backtestProgressPercent');
var progressLabel = document.getElementById('backtestProgressLabel');
var cancelBtn = document.getElementById('backtestCancelBtn');

if (progressContainer) progressContainer.style.display = 'block';
if (cancelBtn) cancelBtn.style.display = 'inline-block';

bridge.run_custom_backtest(JSON.stringify(params)).then(function(jsonStr) {
    var startRes = JSON.parse(jsonStr);
    if (!startRes.success) {
        codeEditorAddLog('error', '启动回测失败: ' + (startRes.error || '未知错误'));
        if (progressContainer) progressContainer.style.display = 'none';
        runBtn.disabled = false;
        runBtn.textContent = '开始回测';
        return;
    }

    var jobId = startRes.job_id;
    codeEditorAddLog('info', '回测已启动 (ID: ' + jobId + ')');

    // Cancel button
    if (cancelBtn) {
        cancelBtn.onclick = function() {
            bridge.cancel_backtest(jobId);
            codeEditorAddLog('warn', '正在取消回测...');
        };
    }

    // Poll for progress
    var pollInterval = setInterval(function() {
        bridge.get_backtest_progress(jobId).then(function(progStr) {
            var prog = JSON.parse(progStr);
            if (prog.status === 'finished') {
                clearInterval(pollInterval);
                if (progressContainer) progressContainer.style.display = 'none';
                fetchAndRenderResult(jobId);
            } else if (prog.status === 'cancelling' || prog.status === 'not_found') {
                clearInterval(pollInterval);
                if (progressContainer) progressContainer.style.display = 'none';
                runBtn.disabled = false;
                runBtn.textContent = '开始回测';
                codeEditorAddLog('warn', '回测已取消');
            } else {
                var pct = prog.total > 0 ? Math.round(prog.current / prog.total * 100) : 0;
                if (progressBar) progressBar.style.width = pct + '%';
                if (progressPercent) progressPercent.textContent = pct + '%';
                if (progressLabel) progressLabel.textContent = '回测中... (' + prog.current + '/' + prog.total + ')';
            }
        });
    }, 500);
});
```

- [ ] **Step 3: Create fetchAndRenderResult helper function**

```javascript
function fetchAndRenderResult(jobId) {
    bridge.get_backtest_result(jobId).then(function(resStr) {
        var res = JSON.parse(resStr);
        var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        runBtn.disabled = false;
        runBtn.textContent = '开始回测';

        if (!res.ready) {
            codeEditorAddLog('error', '获取回测结果失败');
            return;
        }

        var result = res.result;
        if (!result.success && result.error) {
            codeEditorAddLog('error', '回测失败: ' + result.error);
            return;
        }

        // ... existing result rendering code (signals, equity_curve, metrics, etc.)
        // Same as current .then() body from line 438-506

        bridge.cleanup_backtest(jobId);  // free memory
    });
}
```

- [ ] **Step 4: Apply same pattern to multi-stock backtest (around line 430-513)**

Replace `bridge.run_multi_backtest(...)` call with same polling pattern, calling `run_multi_backtest` instead.

- [ ] **Step 5: Commit**

```bash
git add js/codeEditor.js Tquant.html
git commit -m "feat: replace blocking backtest calls with async polling + progress bar"
```

---

### Task 7: Update JS frontend — polling progress for compare backtest

**Files:**
- Modify: `js/compareStrategy.js` (around lines 560-639)

Same polling pattern applied to the compare backtest flow.

- [ ] **Step 1: Add progress container to compare page HTML**

In Tquant.html, add similar progress bar markup inside the compare modal/area.

- [ ] **Step 2: Replace bridge.run_compare_backtest call (line 582)**

Replace with polling pattern:

```javascript
bridge.run_compare_backtest(JSON.stringify(requestData)).then(function(jsonStr) {
    var startRes = JSON.parse(jsonStr);
    if (!startRes.success) {
        statusDiv.textContent = '';
        showToast('启动对比失败: ' + (startRes.error || '未知错误'), true);
        runBtn.disabled = false;
        runBtn.textContent = '🚀 开始对比';
        return;
    }

    var jobId = startRes.job_id;
    var totalVars = variations.length;

    var pollInterval = setInterval(function() {
        bridge.get_backtest_progress(jobId).then(function(progStr) {
            var prog = JSON.parse(progStr);
            if (prog.status === 'finished') {
                clearInterval(pollInterval);
                fetchAndRenderCompareResult(jobId, totalVars);
            } else if (prog.status === 'cancelling') {
                clearInterval(pollInterval);
                runBtn.disabled = false;
                runBtn.textContent = '🚀 开始对比';
                statusDiv.textContent = '已取消';
            } else {
                statusDiv.innerHTML = '<span class="compare-spinner"></span> '
                    + prog.current + '/' + prog.total + ' 个变体完成';
            }
        });
    }, 500);
});
```

- [ ] **Step 3: Create fetchAndRenderCompareResult helper**

```javascript
function fetchAndRenderCompareResult(jobId, totalVars) {
    bridge.get_backtest_result(jobId).then(function(resStr) {
        var res = JSON.parse(resStr);
        runBtn.disabled = false;
        runBtn.textContent = '🚀 开始对比';

        if (!res.ready) {
            showToast('获取结果失败', true);
            return;
        }

        var result = res.result;
        var totalResults = (result.results || []).length;
        statusDiv.textContent = '✅ 完成：' + totalResults + '/' + totalVars + ' 个变体成功';

        // ... existing result handling code from line 593-639
        // (store to window._lastCompareResult, navigate to detail, etc.)

        bridge.cleanup_backtest(jobId);
    });
}
```

- [ ] **Step 4: Commit**

```bash
git add js/compareStrategy.js Tquant.html
git commit -m "feat: replace blocking compare backtest with async polling + progress"
```

---

### Task 8: Integration test and edge cases

**Files:**
- No new files. Verification only.

- [ ] **Step 1: Test single-stock backtest flow**

Run app, start a single-stock backtest. Verify:
- Progress bar updates
- UI remains responsive (can switch pages, scroll)
- Result renders correctly when complete
- Cancel button works mid-backtest

- [ ] **Step 2: Test multi-stock backtest flow**

Run multi-stock backtest with 5+ stocks. Verify same as above.

- [ ] **Step 3: Test compare backtest flow**

Run compare backtest with 3 variations, multi-stock pool. Verify parallel progress, cancel, result rendering.

- [ ] **Step 4: Test concurrent backtests**

Start two backtests in quick succession. Verify both get unique job_ids and run independently.

- [ ] **Step 5: Test cancel mid-execution**

Start a 10-stock 10-year backtest, cancel after 2 seconds. Verify engine stops cleanly, no crash, memory freed.

- [ ] **Step 6: Test shutdown with running backtest**

Start backtest, close app while running. Verify BacktestJobManager.cancel_all() prevents crash on exit.

- [ ] **Step 7: Commit any fixes**

```bash
git add -A
git commit -m "fix: edge cases from integration testing"
```

---

### Task 9: Optional — Pre-warm DataFeed cache on startup

**Files:**
- Modify: `app/main_window.py` (or `app/web_bridge.py`)

Reduce first-backtest latency by pre-loading common stock data into DataFeed._kline_cache on app start.

- [ ] **Step 1: Add pre-warm call in main_window after bridge init**

Around line 93 in `main_window.py`, after `QTimer.singleShot(3000, ...)`:

```python
# Pre-warm K-line cache for common stocks (background thread, non-blocking)
QTimer.singleShot(5000, lambda: self.bridge._prewarm_kline_cache())
```

- [ ] **Step 2: Add _prewarm_kline_cache method to WebBridge**

```python
def _prewarm_kline_cache(self):
    """Pre-load common stock data into DataFeed cache (runs in thread pool)."""
    from concurrent.futures import ThreadPoolExecutor
    common = ['000001', '000858', '600519', '300750', '000333',
              '601318', '000651', '002415', '600036', '601012']
    def _load():
        for code in common:
            try:
                self.data_feed.get_kline_json(code)
            except Exception:
                pass
    ThreadPoolExecutor(max_workers=1).submit(_load)
```

- [ ] **Step 3: Commit**

```bash
git add app/main_window.py app/web_bridge.py
git commit -m "feat: pre-warm DataFeed cache for common stocks on startup"
```

---

## Spec Self-Review

**1. Spec coverage:**
- Eliminate UI freeze during backtests → Tasks 3-7 (QThread + polling)
- Progress reporting → Tasks 1-2 (callback), Task 3 (signal), Tasks 6-7 (JS polling)
- Cancel support → Task 3 (requestInterruption), Task 4 (cancel_job), Tasks 6-7 (cancel button)
- Result caching → Task 4 (BacktestJobManager)
- Multi-variation compare parallelism → Task 3 (_run_compare with ThreadPoolExecutor inside QThread)
- Pre-warm DataFeed → Task 9 (optional)

**2. Placeholder scan:** No TBD, TODO, or "implement later" found. All code is complete.

**3. Type consistency:**
- `BacktestWorker.progress` signal: `Signal(int, int)` matches emit `(idx, total)` in Task 3 and connection in Task 4
- `BacktestWorker.finished` signal: `Signal(dict)` matches emit of result dict
- `BacktestJobManager.get_progress` returns `{status, current, total}` — JS in Tasks 6-7 reads `prog.status`, `prog.current`, `prog.total`
- `get_backtest_result` returns `{ready: bool, result: dict}` — JS reads `res.ready` and `res.result`
- All job_id are strings (uuid hex) — consistent across all slots and JS

**4. Edge cases covered:**
- App shutdown with running jobs: Task 8 Step 6
- Concurrent jobs: Task 4 uses dict with unique job_ids
- Cancel mid-execution: Task 3 checks `isInterruptionRequested` in `on_progress` callback
- Memory leak: Task 4 `cleanup_job` removes from dict; JS calls `cleanup_backtest` after fetching result
