"""Smoke test for multi-stock optimization objective."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import optuna
from backend.optimization.opt_objective import run_objective, compute_objective


def test_multi_stock_objective_returns_float():
    """Multi-stock objective should return a float (or NaN on error)."""
    study = optuna.create_study(direction="maximize")
    trial = study.ask({"fastPeriod": optuna.distributions.IntDistribution(5, 20)})

    strategy_code = """
def initialize(context):
    context.fastPeriod = 5
    context.slowPeriod = 20
    context.c0_fastPeriod = 5
    context.c0_slowPeriod = 20

def handle_bar(context, bar):
    ma_fast = bar.close.rolling(context.c0_fastPeriod).mean()
    ma_slow = bar.close.rolling(context.c0_slowPeriod).mean()
    if ma_fast.iloc[-1] > ma_slow.iloc[-1] and context.c0_fastPeriod > 0:
        order_target_value(security="STOCK_CODE_PLACEHOLDER", value=10000)
    elif ma_fast.iloc[-1] < ma_slow.iloc[-1]:
        order_target_value(security="STOCK_CODE_PLACEHOLDER", value=0)
"""

    params_to_search = [
        {"name": "c0_fastPeriod", "type": "int", "low": 5, "high": 20, "step": 1},
    ]
    fixed_params = {"c0_slowPeriod": 20}

    result = run_objective(
        trial=trial,
        params_to_search=params_to_search,
        fixed_params=fixed_params,
        strategy_code=strategy_code,
        stock_code="000001",
        stock_codes=["000001", "000858"],
        start="2025-01-01",
        end="2025-06-30",
        cash=100000,
        slippage="close",
        commission_rate=0.0003,
        stamp_tax_rate=0.001,
        slippage_cost_type="percent",
        slippage_cost_value=0.1,
        benchmark_code=None,
        objective_type="sharpe_drawdown",
    )

    assert isinstance(result, float), f"Expected float, got {type(result)}"
    print(f"Multi-stock objective result: {result}")


def test_single_stock_still_works():
    """Single-stock path should still work after adding stock_codes parameter."""
    study = optuna.create_study(direction="maximize")
    trial = study.ask({"fastPeriod": optuna.distributions.IntDistribution(5, 20)})

    result = run_objective(
        trial=trial,
        params_to_search=[{"name": "c0_fastPeriod", "type": "int", "low": 5, "high": 20, "step": 1}],
        fixed_params={"c0_slowPeriod": 20},
        strategy_code="def initialize(context):\n    context.c0_fastPeriod = 5\n    context.c0_slowPeriod = 20\ndef handle_bar(context, bar):\n    pass\n",
        stock_code="000001",
        start="2025-01-01",
        end="2025-06-30",
        cash=100000,
        slippage="close",
        commission_rate=0.0003,
        stamp_tax_rate=0.001,
        slippage_cost_type="percent",
        slippage_cost_value=0.1,
        benchmark_code=None,
        objective_type="sharpe_drawdown",
    )

    assert isinstance(result, float), f"Expected float, got {type(result)}"
    print(f"Single-stock objective result: {result}")


if __name__ == "__main__":
    test_multi_stock_objective_returns_float()
    test_single_stock_still_works()
    print("All tests passed!")
