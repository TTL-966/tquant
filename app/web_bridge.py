import json
from PySide6.QtCore import QObject, Slot
from backend.data_feed import DataFeed
from backend.strategy_engine import StrategyEngine

class WebBridge(QObject):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.data_feed = DataFeed()
        self.strategy_engine = StrategyEngine()

    @Slot(result=str)
    def ping(self):
        return "pong"

    @Slot(str, result=str)
    def get_kline_data(self, code):
        try:
            return self.data_feed.get_kline_json(code)
        except Exception as e:
            return json.dumps({"error": str(e)})

    @Slot(str, result=str)
    def run_backtest(self, code):
        try:
            signals = self.strategy_engine.run_backtest(code)
            return json.dumps({"success": True, "signals": signals})
        except Exception as e:
            return json.dumps({"error": str(e)})

    @Slot(str, result=str)
    def get_signals(self, code):
        try:
            signals = self.strategy_engine.get_signals(code)
            return json.dumps({"signals": signals})
        except Exception as e:
            return json.dumps({"error": str(e)})
