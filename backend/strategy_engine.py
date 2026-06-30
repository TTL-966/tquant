# stub: simplified public version — full implementation is local only
from backend.data_feed import DataFeed
import pandas as pd
import numpy as np
import json

class StrategyEngine:
    def __init__(self):
        self.data_feed = DataFeed()
        self.signals = []

    def run_backtest(self, code, start_date="2010-01-01", end_date="2026-12-31",
                     initial_cash=1000000, shares_per_trade=100):
        """Demo: MA5/MA20 crossover strategy. Simplified public version."""
        kline_json = self.data_feed.get_kline_json(code, start_date, end_date)
        kline_data = json.loads(kline_json)
        if "error" in kline_data:
            return [], {}

        dates = kline_data["dates"]
        values = kline_data["values"]

        df = pd.DataFrame({
            "trade_date": pd.to_datetime(dates),
            "open": [v[0] for v in values],
            "close": [v[1] for v in values],
            "low": [v[2] for v in values],
            "high": [v[3] for v in values]
        })

        df['ma5'] = df['close'].rolling(window=5).mean()
        df['ma10'] = df['close'].rolling(window=10).mean()
        df['ma20'] = df['close'].rolling(window=20).mean()
        df['ma30'] = df['close'].rolling(window=30).mean()

        ma_data = {
            "dates": dates,
            "ma5": df['ma5'].fillna(0).round(2).tolist(),
            "ma10": df['ma10'].fillna(0).round(2).tolist(),
            "ma20": df['ma20'].fillna(0).round(2).tolist(),
            "ma30": df['ma30'].fillna(0).round(2).tolist()
        }

        signals = []
        cash = initial_cash
        holdings = 0

        for i in range(20, len(df)):
            if (df['ma5'].iloc[i-1] <= df['ma20'].iloc[i-1] and
                df['ma5'].iloc[i] > df['ma20'].iloc[i]):
                price = df['close'].iloc[i]
                shares = min(shares_per_trade, int(cash / price))
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
        return signals, ma_data

    def get_signals(self, code=None):
        if code is None:
            return self.signals
        return [sig for sig in self.signals if sig['code'] == code]
