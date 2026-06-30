# stub: simplified public version
import re

def suggest_for_param(trial, param_def):
    name = param_def["name"]
    low = param_def["low"]
    high = param_def["high"]
    if param_def.get("type") == "int":
        return trial.suggest_int(name, low, high, step=param_def.get("step", 1))
    else:
        return trial.suggest_float(name, low, high, step=param_def.get("step"))

def inject_params(strategy_code, sampled_params):
    code = strategy_code
    for name, value in sampled_params.items():
        pat1 = rf'(context\.c\d+_{name}\s*=\s*)(-?[\d.]+)'
        if re.search(pat1, code):
            code = re.sub(pat1, rf'\g<1>{value}', code)
        else:
            code = re.sub(rf'(\b{name}\s*=\s*)(-?[\d.]+)', rf'\g<1>{value}', code)
    return code

def compute_objective(metrics, objective_type, min_trades=5):
    total_trades = metrics.get("total_trades", 0)
    if total_trades < min_trades:
        return float(-200 * (min_trades - total_trades))
    if objective_type == "sharpe_drawdown":
        return float(metrics.get("sharpe_ratio", 0) * 0.7 + metrics.get("total_return", 0) * 0.3)
    elif objective_type == "sharpe":
        return float(metrics.get("sharpe_ratio", 0))
    return float(metrics.get("total_return", 0))

def run_objective(trial, params_to_search, fixed_params, strategy_code,
                  stock_code, start, end, cash, slippage,
                  commission_rate, stamp_tax_rate, slippage_cost_type,
                  slippage_cost_value, benchmark_code, objective_type,
                  data_feed=None, stock_codes=None):
    sampled = {p["name"]: suggest_for_param(trial, p) for p in params_to_search}
    try:
        inject_params(strategy_code, {**fixed_params, **sampled})
        return 0.0
    except Exception:
        return float("nan")
