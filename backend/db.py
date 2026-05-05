import pandas as pd
import numpy as np
from sqlalchemy import create_engine, text

class Database:
    def __init__(self):
        self.engine = None
        try:
            self.engine = create_engine(
                'mysql+pymysql://root:998867@localhost:3306/studb?charset=utf8mb4',
                echo=False
            )
            with self.engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        except Exception as e:
            print("数据库连接失败，将使用模拟数据:", e)
            self.engine = None

    def _get_stock_suffix(self, code):
        code = str(code).zfill(6)
        if code.startswith(('000', '001', '002', '003', '300', '301')):
            return '.SZ'
        if code.startswith(('600', '601', '603', '605', '688', '689')):
            return '.SH'
        if code.startswith('8'):
            return '.BJ'
        return '.SZ'

    def _query_kline(self, code, start_date, end_date):
        if start_date is None:
            start_date = "2010-01-01"
        if end_date is None:
            end_date = "2026-12-31"
        sql = text("""
            SELECT trade_date, open, high, low, close, vol AS volume
            FROM stock_daily_qfq_with_name
            WHERE ts_code = :code
              AND trade_date >= :start
              AND trade_date <= :end
            ORDER BY trade_date ASC
        """)
        with self.engine.connect() as conn:
            df = pd.read_sql(
                sql,
                conn,
                params={"code": code, "start": start_date, "end": end_date}
            )
        return df

    def get_kline(self, code, start_date="2010-01-01", end_date="2026-12-31"):
        if start_date is None:
            start_date = "2010-01-01"
        if end_date is None:
            end_date = "2026-12-31"
        if self.engine is None:
            return self._generate_mock_data()
        original_code = code
        if '.' not in code:
            suffix = self._get_stock_suffix(code)
            code_for_query = f"{code}{suffix}"
        else:
            code_for_query = code
            suffix = '.' + code.split('.')[1]
        try:
            df = self._query_kline(code_for_query, start_date, end_date)
            if not df.empty:
                return df
        except Exception as e:
            print("查询失败:", e)
        if '.' not in original_code:
            alt_suffix = None
            if suffix == '.SZ':
                alt_suffix = '.SH'
            elif suffix == '.SH':
                alt_suffix = '.SZ'
            if alt_suffix:
                alt_code = f"{original_code}{alt_suffix}"
                try:
                    df = self._query_kline(alt_code, start_date, end_date)
                    if not df.empty:
                        print(f"[DB] 查询成功，返回 {len(df)} 条数据")
                        return df
                except Exception as e:
                    print("备用查询失败:", e)
        return self._generate_mock_data()

    def _generate_mock_data(self):
        n_dates = pd.date_range("2010-01-01", "2026-12-31", freq='B')
        n = len(n_dates)
        np.random.seed(42)
        dates = n_dates
        base = 12.0
        opens = base + np.cumsum(np.random.randn(n) * 0.5)
        closes = opens + np.random.randn(n) * 0.6
        highs = np.maximum(opens, closes) + np.random.rand(n) * 0.5
        lows = np.minimum(opens, closes) - np.random.rand(n) * 0.5
        volumes = np.random.randint(100000, 500000, n)
        df = pd.DataFrame({
            'trade_date': [d.strftime('%Y%m%d') for d in dates],
            'open': opens,
            'high': highs,
            'low': lows,
            'close': closes,
            'volume': volumes
        })
        return df

    def connection_status(self):
        if self.engine is None:
            return {"connected": False, "message": "无数据库连接（将使用模拟数据）"}
        try:
            with self.engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return {"connected": True, "message": "数据库连接正常"}
        except Exception as e:
            return {"connected": False, "message": f"数据库连接异常: {str(e)}"}

    def search_stock(self, keyword):
        if self.engine is None or not keyword:
            return []
        like = f"%{keyword}%"
        sql = text("""
            SELECT DISTINCT ts_code, name
            FROM stock_daily_qfq_with_name
            WHERE ts_code LIKE :like OR name LIKE :like
            LIMIT 50
        """)
        try:
            with self.engine.connect() as conn:
                rows = conn.execute(sql, {"like": like}).fetchall()
            result = []
            for row in rows:
                ts_code = row[0]
                name = row[1]
                code = ts_code.split('.')[0]
                result.append({"code": code, "name": name, "ts_code": ts_code})
            return result
        except Exception as e:
            print("搜索股票失败:", e)
            return []
