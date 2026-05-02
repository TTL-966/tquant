import json
import pandas as pd
from backend.db import Database

class DataFeed:
    def __init__(self):
        self.db = Database()

    def get_kline_json(self, code, start_date="2026-01-01", end_date="2026-04-01"):
        df = self.db.get_kline(code, start_date, end_date)
        if df is None or df.empty:
            return self._mock_kline_json(code)

        # trade_date 已经是字符串，直接使用
        dates = [str(d) for d in df['trade_date']]
        values = [[round(o,2), round(c,2), round(l,2), round(h,2)]
                  for o,c,l,h in zip(df['open'], df['close'], df['low'], df['high'])]
        result = {
            "dates": dates,
            "values": values
        }
        return json.dumps(result)

    def _mock_kline_json(self, code):
        """生成模拟K线JSON（与真实数据格式一致）"""
        import numpy as np
        np.random.seed(42)
        n = 60
        dates = pd.date_range("2026-01-01", periods=n, freq='B')
        opens = 12.0 + np.cumsum(np.random.randn(n) * 0.5)
        closes = opens + np.random.randn(n) * 0.6
        highs = np.maximum(opens, closes) + np.random.rand(n) * 0.5
        lows = np.minimum(opens, closes) - np.random.rand(n) * 0.5

        date_strs = [d.strftime('%Y-%m-%d') for d in dates]
        values = [[round(opens[i],2), round(closes[i],2), round(lows[i],2), round(highs[i],2)]
                  for i in range(n)]
        return json.dumps({"dates": date_strs, "values": values})
