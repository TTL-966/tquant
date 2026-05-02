import json
import sys
import traceback
from PySide6.QtCore import QObject, Slot
from backend.data_feed import DataFeed
from backend.strategy_engine import StrategyEngine
from backend.trade_simulation import TradeSimulation
from backend.db import Database

class WebBridge(QObject):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.data_feed = DataFeed()
        self.strategy_engine = StrategyEngine()
        self.trade = TradeSimulation()
        self.db = Database()

    @Slot(result=str)
    def ping(self):
        return "pong"

    @Slot(str, result=str)
    def get_kline_data(self, code):
        """
        返回K线数据（JSON），包含 dates, opens, highs, lows, closes, volumes
        """
        try:
            df = self.data_feed.get_kline_json(code)
            # 如果返回的是DataFrame 则构造标准JSON
            if hasattr(df, 'to_dict'):
                data = {
                    "dates": df['trade_date'].dt.strftime('%Y-%m-%d').tolist(),
                    "opens": df['open'].tolist(),
                    "highs": df['high'].tolist(),
                    "lows": df['low'].tolist(),
                    "closes": df['close'].tolist(),
                    "volumes": df['volume'].tolist()
                }
                return json.dumps(data)
            # 否则假设已经是JSON字符串
            return df
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"error": str(e)})

    @Slot(str, result=str)
    def run_backtest(self, code):
        """
        运行回测，返回含收益率曲线、信号等完整数据
        """
        try:
            # 调用策略引擎获取信号
            signals = self.strategy_engine.run_backtest(code)
            # 从模拟交易中获取收益率曲线（模拟）
            equity_curve = self._get_equity_curve(code)
            result = {
                "success": True,
                "signals": signals,
                "equity_curve": equity_curve
            }
            return json.dumps(result)
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    @Slot(str, result=str)
    def get_signals(self, code):
        try:
            signals = self.strategy_engine.get_signals(code)
            return json.dumps({"signals": signals})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"error": str(e)})

    @Slot(str, str, int, float, result=str)
    def execute_trade(self, code, action, shares, price):
        try:
            result = self.trade.execute_trade(code, action, shares, price)
            return json.dumps(result)
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "message": str(e)})

    @Slot(result=str)
    def get_portfolio(self):
        try:
            data = self.trade.get_portfolio()
            return json.dumps(data)
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"error": str(e)})

    # ---------- 数据库连接测试 ----------
    @Slot(result=str)
    def test_db_connection(self):
        try:
            status = self.db.connection_status()
            return json.dumps(status)
        except Exception as e:
            return json.dumps({"connected": False, "message": str(e)})

    # ---------- 新增：获取已成交股票列表（用于买卖点K线下拉框） ----------
    @Slot(result=str)
    def get_traded_stocks(self):
        """返回持仓中的股票代码列表"""
        try:
            portfolio = self.trade.get_portfolio()
            holdings = portfolio.get("holdings", {})
            codes = list(holdings.keys())
            return json.dumps({"stocks": codes})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"stocks": []})

    # ---------- 辅助：生成简单收益率曲线 ----------
    def _get_equity_curve(self, code):
        """
        根据当前持仓和现金构造一条模拟的收益率曲线
        """
        try:
            df = self.data_feed.get_kline_json(code)
            if not hasattr(df, 'to_dict'):
                return []
            # 取最后30个交易日
            df = df.tail(30)
            # 假设第一天资金为100万，逐步买入信号（这里简单取收盘价变化）
            initial_cash = 1000000.0
            curve = []
            for i, row in df.iterrows():
                # 模拟收益率：当日收盘价除以基准价（取第一根收盘为基准）
                base_close = df.iloc[0]['close']
                ratio = row['close'] / base_close
                equity = initial_cash * ratio
                curve.append({
                    "date": row['trade_date'].strftime('%Y-%m-%d'),
                    "value": round(equity, 2)
                })
            return curve
        except Exception:
            return []
