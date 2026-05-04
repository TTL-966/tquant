import json
import sys
import traceback
import numpy as np
import pandas as pd
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

    @Slot(str, str, str, result=str)
    def get_kline_data(self, code, start_date="2010-01-01", end_date="2026-12-31"):
        """
        返回K线数据（JSON），包含 dates, values (OHLC)。
        支持自定义日期范围。
        """
        try:
            raw = self.data_feed.get_kline_json(code, start_date, end_date)
            if isinstance(raw, str):
                parsed = json.loads(raw)
                if 'dates' in parsed and 'values' in parsed:
                    return raw
                return self._mock_kline_json(code)
            # 如果是DataFrame
            if hasattr(raw, 'to_dict'):
                df = raw
                values = []
                for _, row in df.iterrows():
                    values.append([
                        float(row['open']),
                        float(row['close']),
                        float(row['low']),
                        float(row['high'])
                    ])
                data = {
                    "dates": df['trade_date'].dt.strftime('%Y-%m-%d').tolist(),
                    "values": values,
                    "opens": df['open'].tolist(),
                    "highs": df['high'].tolist(),
                    "lows": df['low'].tolist(),
                    "closes": df['close'].tolist(),
                    "volumes": df['volume'].tolist()
                }
                return json.dumps(data)
            return self._mock_kline_json(code)
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return self._mock_kline_json(code)

    def _mock_kline_json(self, code):
        """生成覆盖 2010-01-01 至 2026-12-31 的标准格式模拟K线JSON"""
        n_dates = pd.date_range("2010-01-01", "2026-12-31", freq='B')
        n = len(n_dates)
        np.random.seed(42)
        base = 12.0
        opens = base + np.cumsum(np.random.randn(n) * 0.5)
        closes = opens + np.random.randn(n) * 0.6
        highs = np.maximum(opens, closes) + np.random.rand(n) * 0.5
        lows = np.minimum(opens, closes) - np.random.rand(n) * 0.5
        volumes = np.random.randint(100000, 500000, n)

        values = []
        for i in range(n):
            values.append([
                round(opens[i], 2),
                round(closes[i], 2),
                round(lows[i], 2),
                round(highs[i], 2)
            ])
        data = {
            "dates": [d.strftime('%Y-%m-%d') for d in n_dates],
            "values": values,
            "opens": [round(o, 2) for o in opens],
            "highs": [round(h, 2) for h in highs],
            "lows": [round(l, 2) for l in lows],
            "closes": [round(c, 2) for c in closes],
            "volumes": [int(v) for v in volumes]
        }
        return json.dumps(data)

    @Slot(str, str, str, result=str)
    def run_backtest(self, code, start_date="2010-01-01", end_date="2026-12-31"):
        """
        运行回测，返回含收益率曲线、信号、均线数据等完整数据。
        """
        try:
            signals, ma_data = self.strategy_engine.run_backtest(code, start_date, end_date)
            equity_curve = self._get_equity_curve(code)
            result = {
                "success": True,
                "signals": signals,
                "ma_data": ma_data,
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

    @Slot(result=str)
    def test_db_connection(self):
        try:
            status = self.db.connection_status()
            return json.dumps(status)
        except Exception as e:
            return json.dumps({"connected": False, "message": str(e)})

    @Slot(result=str)
    def get_traded_stocks(self):
        """返回持仓中的股票代码列表"""
        try:
            portfolio = self.trade.get_portfolio()
            holdings = portfolio.get("holdings", [])
            codes = []
            if isinstance(holdings, dict):
                codes = list(holdings.keys())
            elif isinstance(holdings, list):
                for item in holdings:
                    if isinstance(item, dict) and 'code' in item:
                        codes.append(item['code'])
            return json.dumps({"stocks": codes})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"stocks": []})

    def _get_equity_curve(self, code):
        """
        根据当前持仓和现金构造一条模拟的收益率曲线
        """
        try:
            df = self.data_feed.get_kline_json(code)
            if not hasattr(df, 'to_dict'):
                return []
            df = df.tail(30)
            initial_cash = 1000000.0
            curve = []
            for i, row in df.iterrows():
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
