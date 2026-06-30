# stub: simplified public version
import traceback
import os

os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")

from PySide6.QtCore import QThread, Signal

class OptunaWorker(QThread):
    progress = Signal(dict)
    finished = Signal(dict)

    def __init__(self, params, parent=None):
        super().__init__(parent)
        self.params = params
        self._study = None

    def run(self):
        try:
            self.progress.emit({"current": 1, "total": 1, "best_value": 0.0, "mode": "single", "stock_count": 1, "last_trial": {"number": 0, "value": 0.0, "state": "COMPLETE", "params": {}}})
            self.finished.emit({"success": True, "best_params": {}, "best_value": 0.0, "n_trials_completed": 1, "trials": [], "param_importance": {}, "mode": "single", "stock_count": 1, "message": "Public demo - full version supports Optuna TPE search"})
        except Exception as e:
            traceback.print_exc()
            self.finished.emit({"success": False, "error": str(e), "best_params": {}, "best_value": None, "trials": [], "param_importance": {}})

    def cancel(self):
        self.requestInterruption()
