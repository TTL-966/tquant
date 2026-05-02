from backend.data_feed import DataFeed
from backend.db import Database

class StrategyEngine:
    def __init__(self):
        self.data_feed = DataFeed()
        self.signals = []  # 存储最后一次回测的买卖点

    def run_backtest(self, code, initial_cash=1000000, shares_per_trade=100):
        """
        使用双均线策略(MA5, MA20)产生买卖信号。
        返回买卖点列表：[{date, type, price, shares}, ...]
        """
        # 获取K线数据（直接用 DataFeed 获取 JSON 后解析回 DataFrame）
        kline_json = self.data_feed.get_kline_json(code)
        import json
        kline_data = json.loads(kline_json)
        if "error" in kline_data:
            return []

        dates = kline_data["dates"]
        values = kline_data["values"]  # [open, close, low, high]

        # 转换为 DataFrame
        import pandas as pd
        import numpy as np
        df = pd.DataFrame({
            "trade_date": pd.to_datetime(dates),
            "open": [v[0] for v in values],
            "close": [v[1] for v in values],
            "low": [v[2] for v in values],
            "high": [v[3] for v in values]
        })

        # 计算均线
        df['ma5'] = df['close'].rolling(window=5).mean()
        df['ma20'] = df['close'].rolling(window=20).mean()

        signals = []
        cash = initial_cash
        holdings = 0  # 持仓股数

        for i in range(20, len(df)):
            # 简化：在 ma5 上穿 ma20 时买入，下穿时卖出
            if (df['ma5'].iloc[i-1] <= df['ma20'].iloc[i-1] and
                df['ma5'].iloc[i] > df['ma20'].iloc[i]):
                # 买入信号
                price = df['close'].iloc[i]
                shares = min(shares_per_trade, int(cash / price))  # 能买多少买多少，但不超过固定股
                if shares > 0:
                    cost = round(price * shares, 2)
                    if cost <= cash:
                        signals.append({
                            "date": df['trade_date'].iloc[i].strftime('%Y-%m-%d'),
                            "code": code,
                            "type": "buy",
                            "price": round(price, 2),
                            "shares": shares
                        })
                        cash -= cost
                        holdings += shares

            elif (df['ma5'].iloc[i-1] >= df['ma20'].iloc[i-1] and
                  df['ma5'].iloc[i] < df['ma20'].iloc[i] and holdings > 0):
                # 卖出信号
                price = df['close'].iloc[i]
                shares = min(holdings, shares_per_trade)
                if shares > 0:
                    signals.append({
                        "date": df['trade_date'].iloc[i].strftime('%Y-%m-%d'),
                        "code": code,
                        "type": "sell",
                        "price": round(price, 2),
                        "shares": shares
                    })
                    cash += round(price * shares, 2)
                    holdings -= shares

        self.signals = signals
        return signals

    def get_signals(self, code=None):
        """返回所有信号，若code不为None则过滤"""
        if code is None:
            return self.signals
        return [sig for sig in self.signals if sig['code'] == code]
