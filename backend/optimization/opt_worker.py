"""OptunaWorker — 在 QThread 中运行 Optuna Study，逐步发射进度信号"""

import traceback
import gc
import os

# 禁用 numpy/pandas MKL 多线程（Windows 0xC0000409 崩溃修复）
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("NUMEXPR_NUM_THREADS", "1")

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

            # 多股模式：提取股票列表，计算调整后的 trial 数
            stock_codes = p.get("stock_codes")
            if stock_codes and isinstance(stock_codes, list) and len(stock_codes) > 1:
                base_trials = p.get("n_trials", 100)
                import math
                adjusted = max(30, int(base_trials / math.sqrt(len(stock_codes))))
            else:
                stock_codes = None
                adjusted = p.get("n_trials", 100)

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
                val = float(trial.value) if trial.value is not None else float("nan")
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

                best_val = study.best_value if study.best_trial else None
                if best_val is not None:
                    best_val = float(best_val)

                # 每 trial 后强制 GC，防止内存累积
                if trial.number % 5 == 0:
                    gc.collect()

                self.progress.emit({
                    "current": len(results),
                    "total": adjusted,
                    "best_value": best_val,
                    "mode": "multi" if stock_codes else "single",
                    "stock_count": len(stock_codes) if stock_codes else 1,
                    "last_trial": {
                        "number": trial.number,
                        "value": val if val == val else None,
                        "state": state,
                        "params": trial.params,
                    },
                })

            # 单 DataFeed 实例复用于所有 trial，避免 SQLite 连接累积
            from backend.data_feed import DataFeed
            shared_feed = DataFeed()

            # 包装 objective，传入 class 的参数
            def objective(trial):
                return run_objective(
                    trial=trial,
                    data_feed=shared_feed,
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
                    stock_codes=stock_codes,
                )

            study.optimize(
                objective,
                n_trials=adjusted,
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
                "mode": "multi" if stock_codes else "single",
                "stock_count": len(stock_codes) if stock_codes else 1,
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
        """停止 Optuna Study（通过中断标志，不在外部调 study.stop）。"""
        self.requestInterruption()
        # study.stop() 只能在 objective/callback 内调用，外部调用抛 RuntimeError
        if self._study:
            try:
                self._study.stop()
            except RuntimeError:
                pass  # 不在 objective 内，忽略
