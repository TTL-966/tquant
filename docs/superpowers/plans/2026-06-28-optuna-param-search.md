# 策略参数优化 — Optuna 智能搜索 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在策略构建器中新增 Optuna 参数优化功能，自动搜索最优参数组合并实时展示进度

**Architecture:** 新增 `backend/optimization/` 模块（OptunaWorker QThread + objective 函数），复用 BacktestExecutor 跑每次 trial。Bridge 新增 4 个 Slot 对接前端轮询。前端 `strategyBuilder.js` 新增优化面板 + 按钮 + ECharts 进度图。

**Tech Stack:** optuna>=3.0, 现有 PySide6/QtWebChannel/ECharts

---

## File Structure

| 文件 | 职责 |
|------|------|
| `backend/optimization/__init__.py` | 模块入口，导出 OptunaWorker |
| `backend/optimization/opt_worker.py` | OptunaWorker(QThread): 外层循环 → 逐次 trial → objective → BacktestExecutor |
| `backend/optimization/opt_objective.py` | objective(trial): 采样参数 → 注入代码 → 跑回测 → 返回目标值 |
| `app/web_bridge.py` | 新增 4 个 Slot: start_optimization / get_optimization_progress / get_optimization_result / cancel_optimization |
| `js/strategyUtils.js` | 新增 extractParamsFromCards() 从卡片提取可搜索参数列表 |
| `js/strategyBuilder.js` | 新增优化面板渲染、按钮绑定、轮询逻辑、结果展示、参数回填 |
| `Tquant.html` | 新增优化面板 CSS（状态卡片、参数列表、图表容器） |
| `requirements.txt` | 新增 optuna>=3.0 |

---

### Task 1: 安装依赖 + 创建模块骨架

**Files:**
- Modify: `requirements.txt`
- Create: `backend/optimization/__init__.py`

- [ ] **Step 1: 添加 optuna 依赖**

```bash
pip install optuna>=3.0
```

文件 `requirements.txt`，在末尾追加：
```
optuna>=3.0
```

- [ ] **Step 2: 创建模块目录和 __init__.py**

```bash
mkdir -p backend/optimization
```

`backend/optimization/__init__.py`:
```python
"""策略参数优化模块 — Optuna TPE 智能搜索"""

from .opt_worker import OptunaWorker  # noqa: F401
```

- [ ] **Step 3: 验证导入**

```bash
cd E:/Tquant1 && python -c "import optuna; print('optuna', optuna.__version__); from backend.optimization import OptunaWorker; print('OptunaWorker imported OK')"
```

Expected: prints optuna version + "OptunaWorker imported OK" (name defined later in Task 2)

- [ ] **Step 4: Commit**

```bash
git add requirements.txt backend/optimization/__init__.py
git commit -m "chore: add optuna dependency and optimization module skeleton"
```

---

### Task 2: 实现 objective 函数 + 参数注入

**Files:**
- Create: `backend/optimization/opt_objective.py`

- [ ] **Step 1: 编写 opt_objective.py**

`backend/optimization/opt_objective.py`:
```python
"""Optuna objective 函数 — 参数注入、回测执行、目标值计算"""

import json
import sys

from backend.data_feed import DataFeed
from backend.backtest_executor import BacktestExecutor


def suggest_for_param(trial, param_def):
    """根据参数定义调用合适的 Optuna suggest 方法。

    Args:
        trial: optuna.Trial
        param_def: {name, type: "int"|"float", low, high, step?}

    Returns:
        sampled value
    """
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
    """将采样参数值注入策略代码。

    策略代码中 `context.xxx = <原值>` 的行会被替换为 `context.xxx = <新值>`。
    参数注入依赖 strategyUtils.js 生成的代码中 initialize() 使用 `context.paramName = value` 模式。

    Args:
        strategy_code: 原始 Python 策略代码字符串
        sampled_params: {param_name: sampled_value}

    Returns:
        注入参数后的代码字符串
    """
    code = strategy_code
    for name, value in sampled_params.items():
        # 替换 context.<name> = <原值> → context.<name> = <新值>
        import re
        pattern = rf'(context\.{name}\s*=\s*)([\d.]+)'
        code = re.sub(pattern, rf'\g<1>{value}', code)
    return code


def compute_objective(metrics, objective_type):
    """从回测指标计算目标值。

    Args:
        metrics: BacktestExecutor.run() 返回的 metrics dict
        objective_type: "sharpe_drawdown" | "sharpe" | "return"

    Returns:
        float 目标值（越大越好）

    Raises:
        optuna.TrialPruned: 剪枝信号（回撤超标）
    """
    import optuna

    if objective_type == "sharpe_drawdown":
        drawdown = metrics.get("max_drawdown", 0)
        if drawdown < -15:
            raise optuna.TrialPruned(
                f"回撤 {drawdown:.1f}% 超过 15% 约束"
            )
        sharpe = metrics.get("sharpe_ratio", 0)
        total_ret = metrics.get("total_return", 0)
        return sharpe * 0.7 + total_ret * 0.3

    elif objective_type == "sharpe":
        return metrics.get("sharpe_ratio", 0)

    else:  # "return"
        return metrics.get("total_return", 0)


def run_objective(trial, params_to_search, fixed_params, strategy_code,
                  stock_code, start, end, cash, slippage,
                  commission_rate, stamp_tax_rate, slippage_cost_type,
                  slippage_cost_value, benchmark_code, objective_type):
    """Optuna objective 函数。

    每被 Optuna 调用一次，就跑一次完整回测。

    Returns:
        float 目标值
    """
    # 1. 从试验中采样参数
    sampled = {}
    for p in params_to_search:
        sampled[p["name"]] = suggest_for_param(trial, p)

    # 2. 合并固定参数
    all_params = {**fixed_params, **sampled}

    # 3. 注入参数到策略代码
    code = inject_params(strategy_code, all_params)

    # 4. 运行回测
    data_feed = DataFeed()
    executor = BacktestExecutor(data_feed)
    result = executor.run(
        user_code=code,
        stock_code=stock_code,
        start_date=start,
        end_date=end,
        initial_cash=cash,
        slippage=slippage,
        commission_rate=commission_rate,
        stamp_tax_rate=stamp_tax_rate,
        slippage_cost_type=slippage_cost_type,
        slippage_cost_value=slippage_cost_value,
        benchmark_code=benchmark_code,
    )

    # 5. 错误处理 → 返回 NaN（Optuna 自动跳过）
    if result.get("status") == "error":
        return float("nan")

    metrics = result.get("metrics", {})

    # 6. 计算目标值
    return compute_objective(metrics, objective_type)
```

- [ ] **Step 2: 编写 smoke test（无 Optuna trial，直接测 compute_objective + inject_params）**

`tests/test_opt_objective.py`:
```python
"""Smoke tests for optimization objective helpers."""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from backend.optimization.opt_objective import (
    inject_params,
    compute_objective,
)


def test_inject_params_replaces_context_values():
    code = """def initialize(context):
    context.fastPeriod = 5
    context.slowPeriod = 20
"""
    result = inject_params(code, {"fastPeriod": 10, "slowPeriod": 40})
    assert "context.fastPeriod = 10" in result
    assert "context.slowPeriod = 40" in result


def test_inject_params_does_not_change_unmatched():
    code = """def initialize(context):
    context.fastPeriod = 5
    context.other = 99
"""
    result = inject_params(code, {"fastPeriod": 8})
    assert "context.fastPeriod = 8" in result
    assert "context.other = 99" in result


def test_compute_objective_sharpe_drawdown_ok():
    metrics = {"max_drawdown": -8.5, "sharpe_ratio": 1.5, "total_return": 20.0}
    val = compute_objective(metrics, "sharpe_drawdown")
    assert val == 1.5 * 0.7 + 20.0 * 0.3


def test_compute_objective_sharpe_drawdown_prunes():
    import optuna
    metrics = {"max_drawdown": -20.0, "sharpe_ratio": 1.0, "total_return": 10.0}
    try:
        compute_objective(metrics, "sharpe_drawdown")
        assert False, "should have raised TrialPruned"
    except optuna.TrialPruned:
        pass


def test_compute_objective_sharpe():
    metrics = {"sharpe_ratio": 2.1, "total_return": 15.0}
    assert compute_objective(metrics, "sharpe") == 2.1


def test_compute_objective_return():
    metrics = {"total_return": 35.0}
    assert compute_objective(metrics, "return") == 35.0
```

- [ ] **Step 3: 运行测试**

```bash
cd E:/Tquant1 && python -m pytest tests/test_opt_objective.py -v
```

Expected: 6 passed

- [ ] **Step 4: Commit**

```bash
git add backend/optimization/opt_objective.py tests/test_opt_objective.py
git commit -m "feat: add optuna objective function with param injection and objective computation"
```

---

### Task 3: 实现 OptunaWorker QThread

**Files:**
- Create: `backend/optimization/opt_worker.py`

- [ ] **Step 1: 编写 opt_worker.py**

`backend/optimization/opt_worker.py`:
```python
"""OptunaWorker — 在 QThread 中运行 Optuna Study，逐步发射进度信号"""

import traceback
import json

import optuna
from optuna.samplers import TPESampler
from optuna.pruners import MedianPruner
from PySide6.QtCore import QThread, Signal

from .opt_objective import run_objective


class OptunaWorker(QThread):
    """后台线程：运行 Optuna 超参搜索。

    Signals:
        progress(dict)         — 每完成一个 trial 发射
        finished(dict)         — 搜索完成时发射
    """

    progress = Signal(dict)
    finished = Signal(dict)

    def __init__(self, params, parent=None):
        super().__init__(parent)
        self.params = params
        self._study = None

    def run(self):
        try:
            p = self.params

            # 创建 study
            study = optuna.create_study(
                sampler=TPESampler(seed=42),
                pruner=MedianPruner(n_startup_trials=5, n_warmup_steps=5),
                direction="maximize",
            )
            self._study = study

            results = []  # 存储每次 trial 结果

            def callback(study, trial):
                """每次 trial 完成时调用（从 Optuna 线程）"""
                val = trial.value if trial.value is not None else float("nan")
                state = "COMPLETE"
                if trial.state == optuna.trial.TrialState.PRUNED:
                    state = "PRUNED"
                elif trial.state == optuna.trial.TrialState.FAIL:
                    state = "FAIL"

                results.append({
                    "number": trial.number,
                    "params": trial.params,
                    "value": val if val == val else None,  # NaN → None
                    "state": state,
                })

                self.progress.emit({
                    "current": len(results),
                    "total": p.get("n_trials", 100),
                    "best_value": study.best_value if study.best_trial else None,
                    "last_trial": {
                        "number": trial.number,
                        "value": val if val == val else None,
                        "state": state,
                        "params": trial.params,
                    },
                })

            # 包装 objective，传入 class 的参数
            def objective(trial):
                return run_objective(
                    trial=trial,
                    params_to_search=p["params_to_search"],
                    fixed_params=p.get("fixed_params", {}),
                    strategy_code=p["strategy_code"],
                    stock_code=p["stock"],
                    start=p.get("start", "2010-01-01"),
                    end=p.get("end", "2026-12-31"),
                    cash=p.get("cash", 1000000),
                    slippage=p.get("slippage", "close"),
                    commission_rate=p.get("commission_rate", 0.0003),
                    stamp_tax_rate=p.get("stamp_tax_rate", 0.001),
                    slippage_cost_type=p.get("slippage_cost_type", "percent"),
                    slippage_cost_value=p.get("slippage_cost_value", 0.1),
                    benchmark_code=p.get("benchmark_code"),
                    objective_type=p.get("objective", "sharpe_drawdown"),
                )

            study.optimize(
                objective,
                n_trials=p.get("n_trials", 100),
                callbacks=[callback],
                n_jobs=1,  # 单线程，避免 DataFeed 共享状态冲突
            )

            # 计算参数重要性
            importance = {}
            if len(results) >= 10:
                try:
                    importance = optuna.importance.get_param_importances(study)
                except Exception:
                    pass

            result = {
                "success": True,
                "best_params": study.best_params if study.best_trial else {},
                "best_value": study.best_value if study.best_trial else None,
                "n_trials_completed": len(
                    [r for r in results if r["state"] in ("COMPLETE", "PRUNED")]
                ),
                "trials": results,
                "param_importance": importance,
            }

            self.finished.emit(result)

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
        """停止 Optuna Study。"""
        if self._study:
            self._study.stop()
        self.requestInterruption()
```

- [ ] **Step 2: 更新 __init__.py（导入已到位，验证）**

```bash
cd E:/Tquant1 && python -c "from backend.optimization import OptunaWorker; print('OptunaWorker imported OK')"
```

Expected: "OptunaWorker imported OK"

- [ ] **Step 3: Commit**

```bash
git add backend/optimization/opt_worker.py
git commit -m "feat: add OptunaWorker QThread with TPE sampler and progress signals"
```

---

### Task 4: Bridge 新增 4 个 Slot

**Files:**
- Modify: `app/web_bridge.py`

- [ ] **Step 1: 在 import 区域添加 optuna 导入**

在 `app/web_bridge.py` 顶部（`from backend.config_manager import ...` 之后）添加：

```python
from backend.optimization import OptunaWorker
```

- [ ] **Step 2: 在 __init__ 添加 optimization job 追踪字段**

在 `self._fin_update_thread = None` 附近添加：

```python
self._optimization_jobs = {}  # job_id -> {worker, progress, result, status}
```

- [ ] **Step 3: 添加 4 个 Slot 方法**

在 `app/web_bridge.py` 的类末尾（`cancel_auto_trade` 方法区域之后，`_on_auto_trade_notification` 之前）添加以下 4 个方法：

```python
    # ---------- 参数优化 Slot ----------

    @Slot(str, result=str)
    def start_optimization(self, params_json):
        """启动 Optuna 参数优化搜索。

        params_json: {
            strategy_code, stock, start, end, cash,
            objective, n_trials,
            params_to_search: [{name, type, low, high, step?}],
            fixed_params: {name: value},
            slippage, commission_rate, stamp_tax_rate,
            slippage_cost_type, slippage_cost_value,
            benchmark_code
        }
        返回 {success, job_id}
        """
        try:
            params = json.loads(params_json) if isinstance(params_json, str) else params_json
        except Exception:
            return json.dumps({"success": False, "error": "参数 JSON 解析失败"})

        if not params.get("params_to_search"):
            return json.dumps({"success": False, "error": "没有选择要搜索的参数"})

        import secrets
        job_id = secrets.token_hex(6)

        worker = OptunaWorker(params)

        # 捕获进度
        def on_progress(prog):
            if job_id in self._optimization_jobs:
                self._optimization_jobs[job_id]["progress"] = prog

        # 捕获结果
        def on_finished(result):
            if job_id in self._optimization_jobs:
                self._optimization_jobs[job_id]["result"] = result
                self._optimization_jobs[job_id]["status"] = "finished"

        worker.progress.connect(on_progress)
        worker.finished.connect(on_finished)

        self._optimization_jobs[job_id] = {
            "worker": worker,
            "progress": {"current": 0, "total": params.get("n_trials", 100), "best_value": None},
            "result": None,
            "status": "running",
        }

        worker.start()
        return json.dumps({"success": True, "job_id": job_id})

    @Slot(str, result=str)
    def get_optimization_progress(self, job_id):
        """轮询优化进度。

        返回 {status, progress: {current, total, best_value, last_trial?}}
        """
        job = self._optimization_jobs.get(job_id)
        if not job:
            return json.dumps({"status": "not_found"})
        return json.dumps({
            "status": job["status"],
            "progress": job["progress"],
        })

    @Slot(str, result=str)
    def get_optimization_result(self, job_id):
        """获取优化完成结果。

        返回 {ready: bool, result: {best_params, best_value, trials, param_importance}}
        """
        job = self._optimization_jobs.get(job_id)
        if not job:
            return json.dumps({"ready": False, "error": "job not found"})
        if job["status"] == "finished":
            result = job["result"]
            # 转为 JSON 安全格式
            safe = WebBridge._to_json_safe(result)
            # 清理 job
            del self._optimization_jobs[job_id]
            return json.dumps({"ready": True, "result": safe})
        return json.dumps({"ready": False})

    @Slot(str, result=str)
    def cancel_optimization(self, job_id):
        """取消正在运行的优化。"""
        job = self._optimization_jobs.get(job_id)
        if not job:
            return json.dumps({"success": False, "error": "job not found"})
        if job["worker"]:
            job["worker"].cancel()
        job["status"] = "cancelled"
        return json.dumps({"success": True})
```

- [ ] **Step 4: Commit**

```bash
git add app/web_bridge.py
git commit -m "feat: add optimization bridge slots (start/progress/result/cancel)"
```

---

### Task 5: 前端 extractParamsFromCards 辅助函数

**Files:**
- Modify: `js/strategyUtils.js`

- [ ] **Step 1: 在 strategyUtils.js 末尾添加 extractParamsFromCards()**

在 `js/strategyUtils.js` 末尾（最后一个 `export` 之后）添加：

```javascript
/**
 * 从策略卡片数组中提取所有可搜索的数值参数。
 * 参数范围基于 CARD_TYPE_META.paramFields.min/max/default 自动推断。
 *
 * @param {Array} cards - 策略卡片数组 [{type, params}]
 * @returns {Array} [{name, type, low, high, step?, label, cardType}]
 */
export function extractParamsFromCards(cards) {
    var result = [];
    var seen = {};

    cards.forEach(function(card) {
        var meta = CARD_TYPE_META[card.type];
        if (!meta || !meta.paramFields) return;

        meta.paramFields.forEach(function(field) {
            // 只支持 number 类型（整数或浮点），跳过 select
            if (field.type !== 'number') return;

            var name = field.key;
            // 同名参数去重（多张卡可能共用参数名）
            var dedupKey = card.type + '.' + name;
            if (seen[dedupKey]) return;
            seen[dedupKey] = true;

            var currentVal = (card.params && card.params[name] !== undefined)
                ? card.params[name]
                : field.default;

            // 自动推断范围
            var isInt = !field.step || (field.step === 1 && Number.isInteger(field.default));
            var low, high;

            if (isInt) {
                low = Math.max(field.min || 2, Math.floor(currentVal / 3));
                high = Math.min(field.max || 200, Math.ceil(currentVal * 3));
            } else {
                // 浮点参数
                var step = field.step || 0.01;
                low = Math.max(field.min || 0.001, Math.floor((currentVal / 5) / step) * step);
                high = Math.min(field.max || 0.5, Math.ceil((currentVal * 3) / step) * step);
                // 修正精度
                low = parseFloat(low.toFixed(4));
                high = parseFloat(high.toFixed(4));
            }

            result.push({
                name: name,
                label: field.label || name,
                type: isInt ? 'int' : 'float',
                low: low,
                high: high,
                step: field.step || (isInt ? 1 : 0.01),
                default: currentVal,
                cardType: card.type,
            });
        });
    });

    return result;
}
```

- [ ] **Step 2: Commit**

```bash
git add js/strategyUtils.js
git commit -m "feat: add extractParamsFromCards helper for optuna param extraction"
```

---

### Task 6: 前端优化面板 UI（strategyBuilder.js）

**Files:**
- Modify: `js/strategyBuilder.js`
- Modify: `Tquant.html`

- [ ] **Step 1: 在顶部导入区添加新依赖导入**

在 `js/strategyBuilder.js` 顶部 import 区添加：

```javascript
import { extractParamsFromCards } from './strategyUtils.js';
```

- [ ] **Step 2: 在 renderStrategyPage 中添加"参数优化"按钮**

找到 `renderStrategyPage` 中回测运行按钮的位置（`showBacktestModal` 附近），在按钮行添加优化按钮。查找：

```javascript
<button id="runBacktestBtn"
```

在其旁边的按钮组中添加：

```javascript
<button id="openOptPanelBtn" style="background:#2d3a5e;border:none;padding:6px 16px;border-radius:30px;color:#fff;cursor:pointer;font-size:13px;">🔍 参数优化</button>
```

- [ ] **Step 3: 在渲染末尾绑定优化面板按钮**

找到 `renderStrategyPage` 底部 setTimeout 中绑定 `runBacktestBtn` click 事件的位置，在旁边添加：

```javascript
var optBtn = document.getElementById('openOptPanelBtn');
if (optBtn) {
    optBtn.addEventListener('click', function() {
        renderOptimizationPanel();
    });
}
```

- [ ] **Step 4: 在 strategyBuilder.js 末尾添加 renderOptimizationPanel()**

添加完整的优化面板渲染函数：

```javascript
var _optJobId = null;
var _optPollTimer = null;
var _optChartInstance = null;
var _optParams = [];

function renderOptimizationPanel() {
    var container = document.getElementById('dynamicContent');
    if (!container) return;

    // 自动提取参数
    _optParams = extractParamsFromCards(window.__currentCards || cards);
    if (_optParams.length === 0) {
        showToast('当前策略没有可优化的数值参数', true);
        return;
    }

    var defaultStock = (window.currentStockPool && window.currentStockPool.length > 0)
        ? window.currentStockPool[0] : '000001';

    var paramsHtml = _optParams.map(function(p, i) {
        return '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;padding:6px 8px;background:#151c2c;border-radius:6px;">' +
            '<span style="color:#fff;font-size:12px;min-width:100px;">' + escapeHtml(p.label) + '</span>' +
            '<span style="color:#6a7a9a;font-size:10px;min-width:30px;">' + p.type + '</span>' +
            '<span style="display:flex;align-items:center;gap:4px;">' +
            '<input type="number" id="optLow_' + i + '" value="' + p.low + '" step="' + (p.step || 1) + '" style="width:65px;background:#1e253b;border:1px solid #323d5a;border-radius:4px;color:#fff;padding:3px 6px;font-size:12px;text-align:center;">' +
            '<span style="color:#9aa9cc;">~</span>' +
            '<input type="number" id="optHigh_' + i + '" value="' + p.high + '" step="' + (p.step || 1) + '" style="width:65px;background:#1e253b;border:1px solid #323d5a;border-radius:4px;color:#fff;padding:3px 6px;font-size:12px;text-align:center;">' +
            '</span>' +
            '<label style="font-size:11px;color:#9aa9cc;display:flex;align-items:center;gap:4px;margin-left:8px;">' +
            '<input type="checkbox" id="optEnable_' + i + '" checked style="accent-color:#4f7eff;"> 搜索' +
            '</label>' +
            '</div>';
    }).join('');

    container.innerHTML = '<div class="card" id="optimizationCard">' +
        '<div class="card-title">🔍 参数优化 <span style="font-size:12px;color:#9aa9cc;">— 基于 Optuna TPE 智能搜索</span></div>' +
        '<div class="opt-panel-layout">' +
        // 左侧设置
        '<div class="opt-settings">' +
        '<div style="display:flex;gap:12px;margin-bottom:10px;flex-wrap:wrap;">' +
        '<div><span style="color:#9aa9cc;font-size:12px;">📈 股票</span><br><input type="text" id="optStockCode" value="' + defaultStock + '" style="width:100px;background:#1e253b;border:1px solid #323d5a;border-radius:4px;color:#fff;padding:4px 8px;font-size:12px;"></div>' +
        '<div><span style="color:#9aa9cc;font-size:12px;">🎯 目标</span><br><select id="optObjective" style="background:#1e253b;border:1px solid #323d5a;color:#fff;padding:4px 8px;border-radius:4px;font-size:12px;"><option value="sharpe_drawdown">稳健（回撤≤15%）</option><option value="sharpe">夏普优先</option><option value="return">纯收益率</option></select></div>' +
        '<div><span style="color:#9aa9cc;font-size:12px;">🔢 试验次数</span><br><input type="number" id="optNTrials" value="100" min="20" max="500" style="width:70px;background:#1e253b;border:1px solid #323d5a;border-radius:4px;color:#fff;padding:4px 8px;font-size:12px;"></div>' +
        '</div>' +
        '<div style="background:#0e1220;border:1px solid #2a3145;border-radius:8px;padding:10px;margin-bottom:10px;">' +
        '<div style="color:#4f7eff;font-weight:600;margin-bottom:8px;font-size:13px;">🔧 搜索参数（可修改范围、取消勾选）</div>' +
        paramsHtml +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-bottom:10px;">' +
        '<button id="startOptBtn" class="mock-button" style="background:#4f7eff;border:none;padding:6px 18px;border-radius:30px;color:#fff;font-weight:600;cursor:pointer;">🚀 开始优化搜索</button>' +
        '<button id="stopOptBtn" class="mock-button" style="background:#e74c3c;border:none;padding:6px 18px;border-radius:30px;color:#fff;font-weight:600;cursor:pointer;display:none;">⏹ 停止</button>' +
        '</div>' +
        '</div>' +
        // 右侧结果
        '<div class="opt-results">' +
        '<div class="opt-status-row" style="display:flex;gap:8px;margin-bottom:10px;">' +
        '<div class="opt-status-card"><div class="opt-stat-label">状态</div><div class="opt-stat-value" id="optStatus" style="color:#9aa9cc;">等待开始</div></div>' +
        '<div class="opt-status-card"><div class="opt-stat-label">已完成</div><div class="opt-stat-value" id="optProgress" style="color:#fff;">0 / 100</div></div>' +
        '<div class="opt-status-card"><div class="opt-stat-label">当前最优</div><div class="opt-stat-value" id="optBestValue" style="color:#27ae60;">--</div></div>' +
        '</div>' +
        '<div id="optHistoryChart" style="height:180px;background:#0e1220;border-radius:8px;margin-bottom:8px;"></div>' +
        '<div id="optImportanceChart" style="height:120px;background:#0e1220;border-radius:8px;margin-bottom:8px;"></div>' +
        '<div id="optBestParamsTable" style="background:#0e1220;border-radius:8px;padding:10px;font-size:12px;"></div>' +
        '</div>' +
        '</div></div>';

    bindOptimizationEvents();
}
```

- [ ] **Step 5: 添加 bindOptimizationEvents() 函数**

在 `renderOptimizationPanel` 后面添加：

```javascript
function bindOptimizationEvents() {
    var startBtn = document.getElementById('startOptBtn');
    var stopBtn = document.getElementById('stopOptBtn');

    if (startBtn) {
        startBtn.addEventListener('click', function() {
            startOptimization();
        });
    }

    if (stopBtn) {
        stopBtn.addEventListener('click', function() {
            if (_optJobId && bridge && typeof bridge.cancel_optimization === 'function') {
                bridge.cancel_optimization(_optJobId);
                stopOptimizationPolling();
                document.getElementById('optStatus').textContent = '已停止';
                document.getElementById('optStatus').style.color = '#f2c94c';
                startBtn.style.display = '';
                stopBtn.style.display = 'none';
            }
        });
    }
}

function startOptimization() {
    if (!bridge || typeof bridge.start_optimization !== 'function') {
        showToast('Bridge 未连接或接口不可用', true);
        return;
    }

    // 收集勾选的参数
    var paramsToSearch = [];
    var fixedParams = {};
    _optParams.forEach(function(p, i) {
        var enabled = document.getElementById('optEnable_' + i);
        if (enabled && enabled.checked) {
            var low = parseFloat(document.getElementById('optLow_' + i).value) || p.low;
            var high = parseFloat(document.getElementById('optHigh_' + i).value) || p.high;
            paramsToSearch.push({
                name: p.name,
                type: p.type,
                low: low,
                high: high,
                step: p.step || undefined,
            });
        } else {
            fixedParams[p.name] = p.default;
        }
    });

    if (paramsToSearch.length === 0) {
        showToast('请至少勾选一个参数进行搜索', true);
        return;
    }

    var code = window.currentStrategyCode || generateCode(cards);
    var stock = document.getElementById('optStockCode').value.trim() || '000001';
    var objective = document.getElementById('optObjective').value;
    var nTrials = parseInt(document.getElementById('optNTrials').value) || 100;

    var pageStartInput = document.getElementById('strategyStartDate');
    var pageEndInput = document.getElementById('strategyEndDate');
    var startDt = pageStartInput ? pageStartInput.value : '2010-01-01';
    var endDt = pageEndInput ? pageEndInput.value : new Date().toISOString().slice(0, 10);

    var params = {
        strategy_code: code,
        stock: stock,
        start: startDt,
        end: endDt,
        cash: window.initialCapital || 1000000,
        objective: objective,
        n_trials: nTrials,
        params_to_search: paramsToSearch,
        fixed_params: fixedParams,
    };

    bridge.start_optimization(JSON.stringify(params)).then(function(jsonStr) {
        var res = JSON.parse(jsonStr);
        if (res.success) {
            _optJobId = res.job_id;
            document.getElementById('optStatus').textContent = '⏳ 搜索中...';
            document.getElementById('optStatus').style.color = '#f2c94c';
            document.getElementById('startOptBtn').style.display = 'none';
            document.getElementById('stopOptBtn').style.display = '';
            startOptimizationPolling();
        } else {
            showToast('启动失败: ' + (res.error || '未知错误'), true);
        }
    }).catch(function(err) {
        showToast('启动失败: ' + err.message, true);
    });
}

function startOptimizationPolling() {
    if (_optPollTimer) clearInterval(_optPollTimer);
    _optPollTimer = setInterval(function() {
        if (!_optJobId || !bridge) return;
        bridge.get_optimization_progress(_optJobId).then(function(jsonStr) {
            var data = JSON.parse(jsonStr);
            if (data.status === 'finished' || data.status === 'cancelled') {
                stopOptimizationPolling();
                loadOptimizationResult();
                return;
            }
            if (data.status === 'not_found') {
                stopOptimizationPolling();
                return;
            }
            updateOptimizationProgress(data);
        }).catch(function() {});
    }, 800);
}

function stopOptimizationPolling() {
    if (_optPollTimer) {
        clearInterval(_optPollTimer);
        _optPollTimer = null;
    }
}

var _optHistoryData = [];
function updateOptimizationProgress(data) {
    var prog = data.progress;
    if (!prog) return;

    document.getElementById('optProgress').textContent = prog.current + ' / ' + prog.total;
    if (prog.best_value != null) {
        document.getElementById('optBestValue').textContent = (prog.best_value >= 0 ? '+' : '') + prog.best_value.toFixed(2);
    }

    // 更新历史曲线
    if (prog.last_trial) {
        _optHistoryData.push({
            number: prog.last_trial.number,
            value: prog.last_trial.value,
            state: prog.last_trial.state,
        });
        drawOptHistoryChart();
    }
}

function drawOptHistoryChart() {
    var dom = document.getElementById('optHistoryChart');
    if (!dom || typeof echarts === 'undefined') return;

    if (!_optChartInstance) {
        _optChartInstance = echarts.init(dom);
    }

    var completed = _optHistoryData.filter(function(d) { return d.state !== 'FAIL'; });
    var pruned = _optHistoryData.filter(function(d) { return d.state === 'PRUNED'; });

    // 计算最优值曲线
    var bestLine = [];
    var bestSoFar = -Infinity;
    completed.forEach(function(d) {
        if (d.value != null && d.value > bestSoFar) {
            bestSoFar = d.value;
        }
        bestLine.push(bestSoFar > -Infinity ? bestSoFar : null);
    });

    _optChartInstance.setOption({
        grid: { top: 12, right: 16, bottom: 24, left: 50 },
        tooltip: { trigger: 'axis', appendToBody: true },
        xAxis: { type: 'value', name: '试验序号', nameTextStyle: { color: '#9aa9cc' }, axisLabel: { color: '#9aa9cc' } },
        yAxis: { type: 'value', axisLabel: { color: '#9aa9cc' }, splitLine: { lineStyle: { color: '#242a40' } } },
        series: [
            { name: '最优值', type: 'line', data: bestLine, lineStyle: { color: '#4f7eff', width: 2 }, showSymbol: false, smooth: true },
            { name: '已完成', type: 'scatter', data: completed.map(function(d) { return [d.number, d.value]; }), symbolSize: 6, itemStyle: { color: '#27ae60' } },
            { name: '已剪枝', type: 'scatter', data: pruned.map(function(d) { return [d.number, d.value]; }), symbolSize: 4, itemStyle: { color: '#6a7a9a' } },
        ],
        legend: { data: ['最优值', '已完成', '已剪枝'], textStyle: { color: '#ffffff' }, top: 0 },
    }, true);
}

function loadOptimizationResult() {
    if (!_optJobId || !bridge) return;

    bridge.get_optimization_result(_optJobId).then(function(jsonStr) {
        var data = JSON.parse(jsonStr);
        if (!data.ready) return;

        document.getElementById('optStatus').textContent = '✅ 完成';
        document.getElementById('optStatus').style.color = '#27ae60';
        document.getElementById('startOptBtn').style.display = '';
        document.getElementById('stopOptBtn').style.display = 'none';

        var result = data.result;
        if (!result.success) {
            showToast('优化失败: ' + (result.error || '未知错误'), true);
            return;
        }

        // 参数重要性图
        drawOptImportanceChart(result.param_importance);

        // 最优参数表
        var tableHtml = '<div style="color:#4f7eff;font-weight:600;margin-bottom:6px;font-size:13px;">📋 最优参数</div>' +
            '<table style="width:100%;border-collapse:collapse;font-size:12px;">' +
            '<tr style="color:#9aa9cc;"><th style="text-align:left;padding:4px 8px;">参数</th><th style="text-align:left;padding:4px 8px;">最优值</th><th style="text-align:left;padding:4px 8px;">原值</th></tr>';

        var bestParams = result.best_params || {};
        _optParams.forEach(function(p) {
            var bestVal = bestParams[p.name];
            tableHtml += '<tr>' +
                '<td style="padding:4px 8px;color:#fff;">' + escapeHtml(p.label) + '</td>' +
                '<td style="padding:4px 8px;color:#27ae60;font-weight:600;">' + (bestVal != null ? bestVal : '--') + '</td>' +
                '<td style="padding:4px 8px;color:#9aa9cc;">' + p.default + '</td>' +
                '</tr>';
        });
        tableHtml += '</table>';
        tableHtml += '<button id="applyOptParamsBtn" style="margin-top:8px;background:#27ae60;border:none;padding:6px 18px;border-radius:30px;color:#fff;font-weight:600;cursor:pointer;font-size:13px;">✅ 应用最优参数</button>';
        tableHtml += '<span id="applyOptStatus" style="margin-left:10px;color:#27ae60;font-size:11px;"></span>';

        document.getElementById('optBestParamsTable').innerHTML = tableHtml;

        // 绑定应用按钮
        var applyBtn = document.getElementById('applyOptParamsBtn');
        if (applyBtn) {
            applyBtn.addEventListener('click', function() {
                var best = result.best_params || {};
                var changed = 0;
                (window.__currentCards || cards).forEach(function(card) {
                    if (!card.params) return;
                    Object.keys(best).forEach(function(key) {
                        if (card.params.hasOwnProperty(key)) {
                            card.params[key] = best[key];
                            changed++;
                        }
                    });
                });
                document.getElementById('applyOptStatus').textContent = '已应用 ' + changed + ' 个参数';
                // 刷新策略页
                renderStrategyPage(document.getElementById('dynamicContent'));
            });
        }

        _optJobId = null;
    }).catch(function() {});
}

function drawOptImportanceChart(importance) {
    var dom = document.getElementById('optImportanceChart');
    if (!dom || typeof echarts === 'undefined' || !importance) return;

    var chart = echarts.getInstanceByDom(dom) || echarts.init(dom);
    var keys = Object.keys(importance);
    var values = keys.map(function(k) { return importance[k]; });

    if (keys.length === 0) {
        dom.innerHTML = '<div style="color:#9aa9cc;text-align:center;padding:40px;">参数重要性分析需要更多数据</div>';
        return;
    }

    chart.setOption({
        grid: { top: 8, right: 16, bottom: 24, left: 40 },
        tooltip: { trigger: 'axis', appendToBody: true },
        xAxis: { type: 'category', data: keys, axisLabel: { color: '#9aa9cc', fontSize: 11 } },
        yAxis: { type: 'value', name: '重要性', nameTextStyle: { color: '#9aa9cc' }, axisLabel: { color: '#9aa9cc' } },
        series: [{
            type: 'bar', data: values,
            itemStyle: { color: '#4f7eff', borderRadius: [4, 4, 0, 0] },
            label: { show: true, position: 'top', color: '#fff', fontSize: 11, formatter: function(p) { return p.value.toFixed(2); } },
        }],
    }, true);
}
```

- [ ] **Step 6: 添加 CSS 样式**

在 `Tquant.html` 的 `<style>` 区域末尾、`</style>` 之前添加：

```css
/* ────── 参数优化面板 ────── */
.opt-panel-layout {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
}
.opt-settings {
    flex: 1;
    min-width: 340px;
}
.opt-results {
    flex: 1.5;
    min-width: 400px;
}
.opt-status-card {
    flex: 1;
    background: #0e1220;
    border-radius: 8px;
    padding: 10px;
    text-align: center;
}
.opt-stat-label {
    color: #9aa9cc;
    font-size: 11px;
    margin-bottom: 4px;
}
.opt-stat-value {
    font-size: 16px;
    font-weight: 700;
}
```

- [ ] **Step 7: Commit**

```bash
git add js/strategyBuilder.js Tquant.html
git commit -m "feat: add optimization panel UI with ECharts progress and param importance charts"
```

---

### Task 7: 集成验证 + 端到端测试

- [ ] **Step 1: 启动应用并验证**

```bash
cd E:/Tquant1 && python main.py
```

手动测试流程：
1. 打开策略页 → 添加策略卡片（如双均线交叉）
2. 点击"🔍 参数优化"
3. 确认参数列表自动提取且范围合理
4. 点击"开始优化搜索"
5. 观察 ECharts 实时更新：绿点（已完成）、灰点（已剪枝）、蓝线（最优值）
6. 等待完成后检查参数重要性图和最优参数表
7. 点击"应用最优参数" → 确认策略卡片参数已更新

- [ ] **Step 2: Commit final adjustments**

```bash
git add -A && git commit -m "chore: final adjustments for optuna optimization integration"
```

---

## Task Dependencies

```
Task 1 ──> Task 2 ──> Task 3 ──> Task 4 ──> Task 7
                                ↘
                          Task 5 ──> Task 6 ──> Task 7
```

Tasks 2-3-4 是后端链（可顺序执行）。Tasks 5-6 是前端链（可并行于后端）。Task 7 是集成验证（需全部完成）。

---

## What Was Skipped

- **数据库持久化** (`optimization_history` 表)：Phase 1 用 in-memory，不落地。内存占用小（100 trials × ~5KB = 500KB）。Phase 2 加。
- **多股票聚合目标**：单股票先用，验证 Optuna 集成稳定性后再扩展。
- **多策略对比优化**：不同策略参数空间不同，先分别搜再横向比较更合理。
- **前端历史优化记录列表**：加一个简单页面约30行，现在不需要，等用户有"我想看之前搜过的结果"需求再加。
- **optuna-dashboard**：有现成的独立 Web UI，直接 `optuna-dashboard sqlite:///study.db` 就能用。不需要自己写。
