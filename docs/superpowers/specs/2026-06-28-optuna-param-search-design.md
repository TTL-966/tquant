# 策略参数优化 — Optuna 智能搜索

**日期**：2026-06-28
**状态**：设计阶段
**范围**：Phase 1 单股票单策略，Phase 2 扩展多股票

---

## 1. 概述

在策略构建器中新增"参数优化"功能。用户在现有策略卡片基础上，勾选要搜索的参数并指定范围，后端用 Optuna（TPE 采样器）自动搜索最优参数组合，前端用 ECharts 实时展示搜索进度和结果。

## 2. 用户流程

1. 用户在策略页搭建好策略（卡片+参数）
2. 点击新增的"参数优化"按钮 → 进入优化面板
3. 系统自动从当前策略卡片提取所有数值参数，生成默认搜索范围
4. 用户勾选要优化的参数（可调整范围），选择优化目标和试验次数
5. 点击"开始搜索" → 后端启动 Optuna Study，逐次跑回测
6. 前端轮询进度，实时更新优化曲线和当前最优值
7. 搜索完成 → 展示参数重要性图 + 最优参数表
8. 点击"应用最优参数" → 参数回填到策略卡片，用户可保存或直接回测

## 3. 架构

```
┌─ 前端 ─────────────────────────────────────────────────────┐
│  strategyBuilder.js                                        │
│    ├─ renderOptPanel(container)  新增：优化面板渲染          │
│    ├─ startOptimization()        构造 params_json → bridge  │
│    ├─ pollOptProgress()          轮询 → 更新ECharts         │
│    └─ applyOptResult(params)     回填参数到卡片             │
│                                                            │
│  settings.js  / 新独立模块 optPanel.js（待定）               │
│                                                            │
├─ Bridge ───────────────────────────────────────────────────┤
│  web_bridge.py                                             │
│    ├─ start_optimization(params_json)  @Slot 新增           │
│    ├─ get_optimization_progress(job_id) @Slot 新增          │
│    ├─ get_optimization_result(job_id)   @Slot 新增          │
│    └─ cancel_optimization(job_id)       @Slot 新增          │
│                                                            │
├─ 后端 ─────────────────────────────────────────────────────┤
│  backend/optimization/                                     │
│    ├─ __init__.py                                          │
│    ├─ opt_worker.py       OptunaWorker(QThread)             │
│    └─ opt_objective.py    objective() 目标函数              │
│                                                            │
│  依赖：optuna（新增 pip 依赖）                              │
│  复用：BacktestExecutor, DataFeed, 现有策略引擎              │
└────────────────────────────────────────────────────────────┘
```

### 3.1 为什么不放在现有 BacktestWorker 里？

BacktestWorker 跑单次回测。OptunaStudy 跑 N 次回测（N=trial数），需要外层循环。新 OptunaWorker 内部循环调用 BacktestExecutor，复用现有代码不修改。

### 3.2 数据库存储

新增表 `optimization_history`：

```sql
CREATE TABLE IF NOT EXISTS optimization_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_name TEXT,
    stock_code TEXT,
    objective TEXT,
    n_trials INTEGER,
    best_params TEXT,       -- JSON
    best_value REAL,
    study_results TEXT,     -- JSON: [{trial, params, value, state}, ...]
    param_importance TEXT,  -- JSON: {param_name: importance_score}
    created_at TEXT
);
```

前端可查看历史优化记录。

## 4. 数据流

```
用户点击 "开始搜索"
  │
  ├─ 前端: 收集参数
  │   params = {
  │     strategy_code: "<generated Python>",  // 复用 generateCode(cards)
  │     stock: "000001",
  │     start: "2023-01-01",
  │     end: "2026-06-28",
  │     cash: 1000000,
  │     objective: "sharpe_with_drawdown",    // "sharpe" | "return" | "sharpe_drawdown"
  │     n_trials: 100,
  │     params_to_search: [                   // 自动从卡片提取
  │       {name: "fastPeriod",  type: "int",   low: 3,  high: 30},
  │       {name: "slowPeriod",  type: "int",   low: 10, high: 120},
  │       {name: "stopLossPct", type: "float", low: 0.03, high: 0.15},
  │     ],
  │     fixed_params: {                       // 用户没勾选的参数，保持原值
  │       commission: 0.0003,
  │     }
  │   }
  │
  ├─ Bridge: start_optimization(params_json)
  │   → 创建 OptunaWorker
  │   → job_manager 注册
  │   → 返回 {success, job_id}
  │
  ├─ OptunaWorker.run():
  │   study = optuna.create_study(
  │     sampler=TPESampler(seed=42),
  │     pruner=MedianPruner(),            // 中位数剪枝
  │     direction="maximize"
  │   )
  │   study.optimize(
  │     lambda trial: objective(trial, fixed_params, strategy_code, stock, ...),
  │     n_trials=n_trials,
  │     callbacks=[progress_callback]     // 每完成一次 trial 发射进度信号
  │   )
  │
  │   objective(trial, ...):
  │     // 1. 从 trial 采样参数 → 注入到 strategy_code
  │     fast = trial.suggest_int("fastPeriod", 3, 30)
  │     slow = trial.suggest_int("slowPeriod", 10, 120)
  │     code_with_params = inject_params(strategy_code, {fastPeriod: fast, ...})
  │
  │     // 2. 运行回测（复用 BacktestExecutor）
  │     executor = BacktestExecutor(data_feed)
  │     result = executor.run(code_with_params, stock, ...)
  │
  │     // 3. 计算目标值
  │     metrics = result["metrics"]
  │     if objective == "sharpe_drawdown":
  │         if metrics["max_drawdown"] < -15:  // 回撤超标 → 剪枝
  │             raise optuna.TrialPruned()
  │         return metrics["sharpe_ratio"] * 0.7 + metrics["total_return"] * 0.3
  │     elif objective == "sharpe":
  │         return metrics["sharpe_ratio"]
  │     else:
  │         return metrics["total_return"]
  │
  │   // 搜索完成后
  │   result = {
  │     best_params: study.best_params,
  │     best_value: study.best_value,
  │     trials: [{number, params, value, state}, ...],
  │     importance: optuna.importance.get_param_importances(study),
  │   }
  │   → 保存到 optimization_history 表
  │   → 发射 finished 信号
  │
  ├─ 前端: 轮询 get_optimization_progress(job_id)
  │   ← {status: "running", current: 42, total: 100, best_value: 23.5,
  │      history: [{trial, value}, ...]}     // 增量返回，用于画曲线
  │
  └─ 前端: get_optimization_result(job_id)
      ← {ready: true, result: {best_params, best_value, trials, importance}}
      → 渲染参数重要性图 + 最优参数表
```

## 5. 前端组件

### 5.1 优化面板入口

策略页新增按钮"🔍 参数优化"，点击后在 `#dynamicContent` 区域下方或模态框中打开优化面板。建议复用策略详情页的 tab 模式，新增一个"优化"tab。

### 5.2 设置面板

- 股票代码 input（默认取当前策略页的股票）
- 优化目标 select（稳健/夏普优先/纯收益）
- 试验次数 input（默认 100，范围 20~500）
- 回测区间（默认继承策略页设置）
- 参数列表：自动从 `CARD_TYPE_META` 提取，每行显示参数名、类型、范围、勾选框
- 开始/停止按钮

### 5.3 结果面板

- **状态卡片**（3 列）：运行状态 | 已完成试验数 | 当前最优值
- **优化历史曲线**（ECharts scatter/line）：x=试验序号，y=目标值。蓝线连接每步最优值（单调上升），灰点表示被剪枝的试验
- **参数重要性图**（ECharts 柱状图）：搜索完成后显示，x=参数名，y=Optuna 重要性分数（0~1）
- **最优参数表**：参数名、最优值、原值（对比），带"应用"按钮

### 5.4 与现有策略卡片的交互

"应用最优参数" → 遍历最优参数对象 → 更新 `cards[i].params[key] = bestValue` → 刷新策略页 UI → 用户可直接保存策略或运行回测验证。

## 6. 参数范围自动推断规则

| CARD_TYPE_META.paramFields.type | Optuna suggest | 默认范围 |
|------|------|------|
| `number`（整数口径，如 fastPeriod） | `suggest_int` | [max(2, default/3), min(default×3, 200)] |
| `number`（浮点口径，如 stopLossPct） | `suggest_float` | [default/5, min(default×3, 0.5)] |
| `select` | 不生成搜索参数（离散选项，暂不支持） | — |

用户可手动调整每个参数的范围和是否参与搜索。

## 7. 错误处理

- **策略代码编译失败**：该 trial 返回 `NaN`（Optuna 自动跳过）
- **回测数据不足**：同上，trial 标记为 `FAIL`
- **Optuna 数据库锁**：使用 `in-memory` storage（`sqlite:///:memory:`），不落地
- **用户停止**：`study.stop()` 后返回当前最优结果，不丢失已完成的 trial

## 8. 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/optimization/__init__.py` | 新增 | 模块入口 |
| `backend/optimization/opt_worker.py` | 新增 | OptunaWorker QThread |
| `backend/optimization/opt_objective.py` | 新增 | objective 函数 + 参数注入 |
| `app/web_bridge.py` | 修改 | 新增 4 个 Slot |
| `backend/backtest_job_manager.py` | 修改 | 扩展支持 optimization job 类型 |
| `js/strategyBuilder.js` | 修改 | 新增优化面板 + 按钮 + 轮询逻辑 |
| `js/strategyUtils.js` | 修改 | 新增 `extractParamsFromCards()` 提取辅助函数 |
| `Tquant.html` | 修改 | 新增优化面板 CSS |
| `requirements.txt` | 修改 | 新增 `optuna>=3.0` |

## 9. Phase 2 扩展点

- 多股票聚合目标（avg sharpe across N stocks）
- 策略对比模式（分别搜，横向比较）
- 帕累托前沿可视化（多目标模式）
- 优化历史记录查看（从 `optimization_history` 表加载）
- 定时自动搜索（夜间跑，早晨看结果）
