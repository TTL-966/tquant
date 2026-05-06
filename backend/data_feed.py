import json
import datetime
import pandas as pd
from backend.db import Database

class DataFeed:
    def __init__(self):
        self.db = Database()

    def _format_date(self, d):
        """统一日期格式为 'YYYY-MM-DD' 字符串"""
        if isinstance(d, (pd.Timestamp, datetime.datetime)):
            return d.strftime('%Y-%m-%d')
        s = str(d).strip()
        # 8 位数字格式: 20260101 → 2026-01-01
        if len(s) == 8 and s.isdigit():
            return f"{s[:4]}-{s[4:6]}-{s[6:]}"
        # 已经是 YYYY-MM-DD 格式
        if len(s) == 10 and s[4] == '-' and s[7] == '-':
            return s
        # 处理 '2026-01-05 00:00:00' 之类的格式
        if ' ' in s:
            return s[:10]
        # 兜底
        return s

    def get_kline_json(self, code, start_date=None, end_date=None, limit=0):
        """获取K线数据 JSON，支持自定义日期范围（默认使用 db 模块的默认值）"""
        df = self.db.get_kline(code, start_date, end_date, limit)

        if df is None or df.empty:
            return self._mock_kline_json(code)

        # 统一日期格式
        dates = [self._format_date(d) for d in df['trade_date']]
        values = [[round(o, 2), round(c, 2), round(l, 2), round(h, 2)]
                  for o, c, l, h in zip(df['open'], df['close'], df['low'], df['high'])]
        result = {
            "dates": dates,
            "values": values
        }
        return json.dumps(result)

    def _mock_kline_json(self, code):
        """生成覆盖 2010-01-01 至 2026-12-31 的模拟K线JSON（与真实数据格式一致）"""
        import numpy as np
        np.random.seed(42)
        dates_all = pd.date_range("2010-01-01", "2026-12-31", freq='B')
        n = len(dates_all)
        opens = 12.0 + np.cumsum(np.random.randn(n) * 0.5)
        closes = opens + np.random.randn(n) * 0.6
        highs = np.maximum(opens, closes) + np.random.rand(n) * 0.5
        lows = np.minimum(opens, closes) - np.random.rand(n) * 0.5

        date_strs = [d.strftime('%Y-%m-%d') for d in dates_all]
        values = [[round(opens[i], 2), round(closes[i], 2), round(lows[i], 2), round(highs[i], 2)]
                  for i in range(n)]
        return json.dumps({"dates": date_strs, "values": values})
