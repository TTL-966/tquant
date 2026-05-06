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

    @Slot(str, str, str, int, result=str)
    def get_kline_data(self, code, start_date="2010-01-01", end_date="2026-12-31", limit=0):
        try:
            raw = self.data_feed.get_kline_json(code, start_date, end_date, limit)
            if isinstance(raw, str):
                parsed = json.loads(raw)
                if 'dates' in parsed and 'values' in parsed:
                    data = {"dates": parsed["dates"], "values": parsed["values"]}
                    # 数据库已经限定了行数，不需要再截断
                    return json.dumps(data)
                return self._mock_kline_json(code)
            if hasattr(raw, 'to_dict'):
                df = raw
                values = []
                for _, row in df.iterrows():
                    values.append([float(row['open']), float(row['close']), float(row['low']), float(row['high'])])
                data = {
                    "dates": df['trade_date'].dt.strftime('%Y-%m-%d').tolist(),
                    "values": values,
                    "opens": df['open'].tolist(),
                    "highs": df['high'].tolist(),
                    "lows": df['low'].tolist(),
                    "closes": df['close'].tolist(),
                    "volumes": df['volume'].tolist()
                }
                # 数据库已经限定了行数，不需要再截断
                return json.dumps(data)
            return self._mock_kline_json(code)
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return self._mock_kline_json(code)

    def _mock_kline_json(self, code):
        n_dates = pd.date_range("2010-01-01", "2026-12-31", freq='B')
        n = len(n_dates)
        np.random.seed(42)
        base = 12.0
        opens = base + np.cumsum(np.random.randn(n) * 0.5)
        closes = opens + np.random.randn(n) * 0.6
        highs = np.maximum(opens, closes) + np.random.rand(n) * 0.5
        lows = np.minimum(opens, closes) - np.random.rand(n) * 0.5
        volumes = np.random.randint(100000, 500000, n)
        values = [[round(opens[i],2), round(closes[i],2), round(lows[i],2), round(highs[i],2)] for i in range(n)]
        data = {
            "dates": [d.strftime('%Y-%m-%d') for d in n_dates],
            "values": values,
            "opens": [round(o,2) for o in opens],
            "highs": [round(h,2) for h in highs],
            "lows": [round(l,2) for l in lows],
            "closes": [round(c,2) for c in closes],
            "volumes": [int(v) for v in volumes]
        }
        return json.dumps(data)

    @Slot(str, str, str, result=str)
    def run_backtest(self, code, start_date="2010-01-01", end_date="2026-12-31"):
        try:
            signals, ma_data = self.strategy_engine.run_backtest(code, start_date, end_date)
            equity_curve = self._get_equity_curve(code)
            return json.dumps({"success": True, "signals": signals, "ma_data": ma_data, "equity_curve": equity_curve})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "error": str(e)})

    @Slot(str, result=str)
    def get_signals(self, code):
        try:
            return json.dumps({"signals": self.strategy_engine.get_signals(code)})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"error": str(e)})

    @Slot(str, str, int, float, result=str)
    def execute_trade(self, code, action, shares, price):
        try:
            return json.dumps(self.trade.execute_trade(code, action, shares, price))
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"success": False, "message": str(e)})

    @Slot(result=str)
    def get_portfolio(self):
        try:
            portfolio = self.trade.get_portfolio()
            holdings = portfolio.get("holdings")
            if isinstance(holdings, dict):
                enhanced_holdings = {}
                for code, info in holdings.items():
                    display = self.db.get_name_by_code(code)
                    enhanced_holdings[code] = info
                    if isinstance(enhanced_holdings[code], dict):
                        enhanced_holdings[code]["display"] = display
                    else:
                        enhanced_holdings[code] = {"value": info, "display": display}
                portfolio["holdings"] = enhanced_holdings
            elif isinstance(holdings, list):
                enhanced_holdings = []
                for item in holdings:
                    if isinstance(item, dict) and 'code' in item:
                        code = item['code']
                        display = self.db.get_name_by_code(code)
                        item["display"] = display
                    enhanced_holdings.append(item)
                portfolio["holdings"] = enhanced_holdings
            return json.dumps(portfolio)
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"error": str(e)})

    @Slot(result=str)
    def test_db_connection(self):
        try:
            return json.dumps(self.db.connection_status())
        except Exception as e:
            return json.dumps({"connected": False, "message": str(e)})

    @Slot(result=str)
    def get_traded_stocks(self):
        try:
            portfolio = self.trade.get_portfolio()
            holdings = portfolio.get("holdings", [])
            codes = []
            if isinstance(holdings, dict):
                raw_codes = list(holdings.keys())
                for code in raw_codes:
                    display = self.db.get_name_by_code(code)
                    codes.append({"code": code, "display": display})
            elif isinstance(holdings, list):
                for item in holdings:
                    if isinstance(item, dict) and 'code' in item:
                        code = item['code']
                        display = self.db.get_name_by_code(code)
                        codes.append({"code": code, "display": display})
            return json.dumps({"stocks": codes})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps({"stocks": []})

    @Slot(str, result=str)
    def search_stock(self, keyword):
        try:
            result = self.db.search_stock(keyword)
            # stock_basic 返回的 code 已是不带后缀的纯代码，直接构建 display
            for item in result:
                item["display"] = f"{item['name']} ({item['code']})"
            return json.dumps(result)
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return json.dumps([])

    def _get_equity_curve(self, code):
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
                curve.append({"date": row['trade_date'].strftime('%Y-%m-%d'), "value": round(equity,2)})
            return curve
        except Exception:
            return []
