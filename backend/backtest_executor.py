# stub: simplified public version
import traceback
import numpy as np
import pandas as pd

def calculate_benchmark_metrics(strategy_nav_series, benchmark_close_series, risk_free_rate=0.03):
    try:
        if benchmark_close_series.empty or len(benchmark_close_series) < 2:
            return {}
        bm_nav = benchmark_close_series / benchmark_close_series.iloc[0]
        aligned = pd.DataFrame({'strategy_nav': strategy_nav_series, 'bm_nav': bm_nav}).dropna()
        if len(aligned) < 2:
            return {}
        strategy_total_ret = (aligned['strategy_nav'].iloc[-1] / aligned['strategy_nav'].iloc[0] - 1) * 100
        bm_total_ret = (aligned['bm_nav'].iloc[-1] / aligned['bm_nav'].iloc[0] - 1) * 100
        return {'benchmark_return': round(bm_total_ret, 2), 'excess_return': round(strategy_total_ret - bm_total_ret, 2), 'outperform': bool(strategy_total_ret > bm_total_ret)}
    except Exception as e:
        print(f"[Benchmark] calc error: {e}")
        return {}

class Logger:
    def __init__(self, on_log=None):
        self.on_log = on_log
    def __call__(self, msg):
        print(f"[Backtest] {msg}")
        if self.on_log: self.on_log(str(msg))
    def info(self, msg): self.__call__(f"[INFO] {msg}")
    def warn(self, msg): self.__call__(f"[WARN] {msg}")
    def error(self, msg): self.__call__(f"[ERROR] {msg}")

class BacktestExecutor:
    def __init__(self, data_feed):
        self.data_feed = data_feed

    def run(self, user_code, stock_code, start_date, end_date, initial_cash=1000000,
            slippage='close', commission_rate=0.0003, stamp_tax_rate=0.001,
            slippage_cost_type='percent', slippage_cost_value=0.1,
            benchmark_code=None, on_log=None, progress_callback=None):
        logger = Logger(on_log)
        logger("Demo backtest mode - install full version for actual results")
        try:
            code = compile(user_code, '<strategy>', 'exec')
            ns = {'np': np, 'pd': pd, '__builtins__': __builtins__}
            exec(code, ns)
            metrics = {'total_return': 0.0, 'annual_return': 0.0, 'sharpe_ratio': 0.0, 'max_drawdown': 0.0, 'win_rate': 0.0, 'total_trades': 0, 'benchmark_return': 0.0, 'excess_return': 0.0}
            return {'status': 'success', 'metrics': metrics, 'signals': [], 'equity_curve': [], 'benchmark_equity_curve': [], 'logs': [], 'stock_performance': []}
        except Exception as e:
            traceback.print_exc()
            return {'status': 'error', 'message': str(e)}
