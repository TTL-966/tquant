"""Optuna objective 函数 — 参数注入、回测执行、目标值计算"""

import json
import sys
import re

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
