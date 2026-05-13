import json
import datetime
import bisect
import pandas as pd
from backend.db import Database
import math

class DataFeed:
    _kline_cache = {}   # key: 纯代码(不带后缀)，value: {"dates": [...], "values": [[o,c,l,h], ...]}

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

    def _slice_by_date_range(self, cached, start, end):
        """
        在已排序的日期数组上，用二分查找定位 [start, end] 区间，避免全量表遍历。
        返回 (dates_sub, values_sub)
        """
        dates = cached["dates"]
        values = cached["values"]
        if not dates:
            return [], []
        lo = bisect.bisect_left(dates, start)
        hi = bisect.bisect_right(dates, end)
        return dates[lo:hi], values[lo:hi]

    def get_kline_json(self, code, start_date=None, end_date=None, limit=0):
        """获取K线数据 JSON，支持缓存，根据日期范围过滤，并支持限制行数"""
        code_pure = code.split('.')[0]

        def safe_float(x):
            try:
                if x is None or (isinstance(x, float) and math.isnan(x)):
                    return 0.0
                return round(float(x), 2)
            except (ValueError, TypeError):
                return 0.0

        def safe_int(x):
            try:
                if x is None or (isinstance(x, float) and math.isnan(x)):
                    return 0
                return int(float(x))
            except (ValueError, TypeError):
                return 0

        # 如果缓存中没有，则从数据库加载全量数据
        if code_pure not in self._kline_cache:
            df = self.db.get_kline(code, start_date=None, end_date=None, limit=0)  # 全量
            if df is None or df.empty:
                # 无数据时，缓存设为空字典，后续直接返回错误
                self._kline_cache[code_pure] = None
                return json.dumps({"error": "无数据"})

            # 将 DataFrame 转换为缓存格式
            dates = [self._format_date(d) for d in df['trade_date']]
            values = [[safe_float(o), safe_float(c), safe_float(l), safe_float(h), safe_int(v)]
                      for o, c, l, h, v in zip(df['open'], df['close'], df['low'], df['high'], df['volume'])]
            self._kline_cache[code_pure] = {"dates": dates, "values": values}

        cached = self._kline_cache.get(code_pure)
        if cached is None:
            return json.dumps({"error": "无数据"})

        # 使用二分查找进行日期范围过滤
        if start_date is None and end_date is None:
            filtered_dates = cached["dates"]
            filtered_values = cached["values"]
        else:
            if start_date is None:
                start_date = "2010-01-01"
            if end_date is None:
                end_date = "2026-12-31"
            filtered_dates, filtered_values = self._slice_by_date_range(cached, start_date, end_date)

        # 如果 limit > 0，取尾部 limit 条
        if limit > 0 and len(filtered_dates) > limit:
            filtered_dates = filtered_dates[-limit:]
            filtered_values = filtered_values[-limit:]

        result = {"dates": filtered_dates, "values": filtered_values}
        return json.dumps(result)

    def get_latest_price(self, code):
        """返回最新价、日期、前一收盘价及涨跌幅"""
        code_pure = code.split('.')[0]
        # 若缓存缺失则利用 get_kline_json 加载全量数据
        if code_pure not in self._kline_cache:
            self.get_kline_json(code)  # 加载并缓存
        cached = self._kline_cache.get(code_pure)
        if cached is None:
            return {"error": "无数据"}
        dates = cached["dates"]
        values = cached["values"]
        if len(dates) < 2:
            return {"error": "数据不足两个交易日"}
        last_date = dates[-1]
        last_close = values[-1][1]      # close index 1
        prev_close = values[-2][1]
        price = last_close
        change = round(last_close - prev_close, 2)
        change_pct = round((change / prev_close) * 100, 2) if prev_close != 0 else 0.0
        return {
            "price": price,
            "date": last_date,
            "prev_close": prev_close,
            "change": change,
            "change_pct": change_pct
        }

    def _mock_kline_json(self, code):
        """生成覆盖 2010-01-01 至 2026-12-31 的模拟K线JSON（周线，数据量可控）"""
        import numpy as np
        np.random.seed(42)
        dates_all = pd.date_range("2010-01-01", "2026-12-31", freq='W')
        n = len(dates_all)
        opens = 12.0 + np.cumsum(np.random.randn(n) * 0.5)
        closes = opens + np.random.randn(n) * 0.6
        highs = np.maximum(opens, closes) + np.random.rand(n) * 0.5
        lows = np.minimum(opens, closes) - np.random.rand(n) * 0.5

        date_strs = [d.strftime('%Y-%m-%d') for d in dates_all]
        volumes = np.random.randint(100000, 500000, n)
        values = [[round(opens[i],2), round(closes[i],2), round(lows[i],2), round(highs[i],2), int(volumes[i])] for i in range(n)]
        return json.dumps({"dates": date_strs, "values": values})
