# stub: simplified public version — full implementation is local only
import traceback
import os

os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")

from PySide6.QtCore import QThread, Signal

from .opt_objective import run_objective


class OptunaWorker(QThread):
    """Background Optuna hyperparameter search worker. Simplified public version."""

    progress = Signal(dict)
    finished = Signal(dict)

    def __init__(self, params, parent=None):
        super().__init__(parent)
        self.params = params
        self._study = None

    def run(self):
        try:
            p = self.params
            self.progress.emit({
                "current": 1,
                "total": 1,
                "best_value": 0.0,
                "mode": "single",
                "stock_count": 1,
                "last_trial": {
                    "number": 0,
                    "value": 0.0,
                    "state": "COMPLETE",
                    "params": {},
                },
            })

            self.finished.emit({
                "success": True,
                "best_params": {},
                "best_value": 0.0,
                "n_trials_completed": 1,
                "trials": [],
                "param_importance": {},
                "mode": "single",
                "stock_count": 1,
                "message": "公开版演示 — 完整版支持 Optuna TPE 超参搜索"
            })
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
        self.requestInterruption()
