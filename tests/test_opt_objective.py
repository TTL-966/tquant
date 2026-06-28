"""Smoke tests for optimization objective helpers."""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from backend.optimization.opt_objective import (
    inject_params,
    compute_objective,
    suggest_for_param,
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


def test_inject_params_handles_negative_values():
    code = """def initialize(context):
    context.someVal = -5
"""
    result = inject_params(code, {"someVal": -8})
    assert "context.someVal = -8" in result


def test_inject_params_handles_positive_unchanged():
    code = """def initialize(context):
    context.someVal = 3
"""
    result = inject_params(code, {"someVal": 3})
    assert "context.someVal = 3" in result


def test_suggest_for_param_int():
    import optuna
    trial = optuna.trial.FixedTrial({"myParam": 15})
    result = suggest_for_param(trial, {"name": "myParam", "type": "int", "low": 3, "high": 30})
    assert result == 15


def test_suggest_for_param_float():
    import optuna
    trial = optuna.trial.FixedTrial({"myFloat": 0.05})
    result = suggest_for_param(trial, {"name": "myFloat", "type": "float", "low": 0.01, "high": 0.2, "step": 0.01})
    assert result == 0.05


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
