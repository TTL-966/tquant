# stub: simplified public version — full implementation is local only
import traceback
import numpy as np
import pandas as pd
from backend.backtest_executor import Logger, BacktestExecutor, calculate_benchmark_metrics


class MultiBacktestExecutor:
    """Multi-stock shared-pool backtest executor. Simplified public version."""

    def __init__(self, data_feed):
        self.data_feed = data_feed

    def run(self, user_code, stock_codes, start_date, end_date, initial_cash=1000000,
            slippage='close', commission_rate=0.0003, stamp_tax_rate=0.001,
            slippage_cost_type='percent', slippage_cost_value=0.1,
            benchmark_code=None, on_log=None):
        """Run multi-stock backtest. Returns demo result."""
        logger = Logger(on_log)
        logger("Demo multi-backtest mode — install full version for actual results")

        try:
            code = compile(user_code, '<multi_strategy>', 'exec')
            ns = {'np': np, 'pd': pd, '__builtins__': __builtins__}
            exec(code, ns)

            metrics = {
                'total_return': 0.0, 'annual_return': 0.0,
                'sharpe_ratio': 0.0, 'max_drawdown': 0.0,
                'win_rate': 0.0, 'total_trades': 0,
                'benchmark_return': 0.0, 'excess_return': 0.0,
            }

            return {
                'success': True,
                'metrics': metrics,
                'signals': [],
                'nav_series': [],
                'benchmark_nav': [],
            }
        except Exception as e:
            traceback.print_exc()
            return {'success': False, 'error': str(e)}
