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

    前端 generateCode 使用 contextName(i, key) 生成上下文变量名，
    格式为 context.c{cardIdx}_{paramKey}（如 context.c0_fastPeriod）。
    本函数匹配该模式并替换数值。
    """
    code = strategy_code
    for name, value in sampled_params.items():
        # 主模式: context.c0_fastPeriod = 5 -> context.c0_fastPeriod = <new>
        pat1 = rf'(context\.c\d+_{name}\s*=\s*)(-?[\d.]+)'
        if re.search(pat1, code):
            code = re.sub(pat1, rf'\g<1>{value}', code)
        else:
            # fallback: word-boundary match for non-card-indexed params
            pat2 = rf'(\b{name}\s*=\s*)(-?[\d.]+)'
            code = re.sub(pat2, rf'\g<1>{value}', code)
    return code

def compute_objective(metrics, objective_type, min_trades=5):
    """从回测指标计算目标值。

    Args:
        metrics: BacktestExecutor.run() 返回的 metrics dict
        objective_type: "sharpe_drawdown" | "sharpe" | "return"
        min_trades: 最低交易次数，低于此数返回 -999 惩罚（防低频策略钻空子）

    Returns:
        float 目标值（越大越好）

    Raises:
        optuna.TrialPruned: 剪枝信号（回撤超标）
    """
    import optuna

    total_trades = metrics.get("total_trades", 0)

    # 交易次数不足 → 极低惩罚分，防止 Optuna 偏爱低频策略
    if total_trades < min_trades:
        return float(-999)

    if objective_type == "sharpe_drawdown":
        drawdown = metrics.get("max_drawdown", 0)
        if drawdown < -15:
            raise optuna.TrialPruned(
                f"回撤 {drawdown:.1f}% 超过 15% 约束"
            )
        sharpe = metrics.get("sharpe_ratio", 0)
        total_ret = metrics.get("total_return", 0)
        return float(sharpe * 0.7 + total_ret * 0.3)

    elif objective_type == "sharpe":
        return float(metrics.get("sharpe_ratio", 0))

    else:  # "return"
        return float(metrics.get("total_return", 0))


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
    return compute_objective(metrics, objective_type, min_trades=fixed_params.get('_min_trades', 5))
