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
        return 0.0
    except Exception:
        return float("nan")
