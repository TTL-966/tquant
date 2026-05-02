import json
from PySide6.QtCore import QObject, Slot
from backend.data_feed import DataFeed
from backend.strategy_engine import StrategyEngine
from backend.trade_simulation import TradeSimulation

class WebBridge(QObject):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.data_feed = DataFeed()
        self.strategy_engine = StrategyEngine()
        self.trade = TradeSimulation()

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

    # 模拟交易接口
    @Slot(str, str, int, float, result=str)
    def execute_trade(self, code, action, shares, price):
        try:
            result = self.trade.execute_trade(code, action, shares, price)
            return json.dumps(result)
        except Exception as e:
            return json.dumps({"success": False, "message": str(e)})

    @Slot(result=str)
    def get_portfolio(self):
        try:
            data = self.trade.get_portfolio()
            return json.dumps(data)
        except Exception as e:
            return json.dumps({"error": str(e)})
