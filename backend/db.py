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
        """内部查询方法，返回DataFrame；若失败则抛出异常"""
        if start_date is None:
            start_date = "2010-01-01"
        if end_date is None:
            end_date = "2026-12-31"
        start = start_date.replace('-', '')
        end = end_date.replace('-', '')
        start = start_date.replace('-', '')
        end = end_date.replace('-', '')
        sql = text("""
            SELECT trade_date, open, high, low, close, vol AS volume
            FROM stock_daily
            WHERE ts_code = :code
              AND trade_date >= :start
              AND trade_date <= :end
            ORDER BY trade_date ASC
        """)
        with self.engine.connect() as conn:
            df = pd.read_sql(
                sql,
                conn,
                params={
                    "code": code,
                    "start": start,
                    "end": end
                }
            )
        return df

    def get_kline(self, code, start_date="2010-01-01", end_date="2026-12-31"):
        """
        获取K线数据
        code: 股票代码，如 '000001' 或 '000001.SZ'
        start_date: 开始日期，格式 YYYY-MM-DD
        end_date: 结束日期，格式 YYYY-MM-DD
        """
        if start_date is None:
            start_date = "2010-01-01"
        if end_date is None:
            end_date = "2026-12-31"
        # 没有数据库连接，直接返回模拟数据
        if self.engine is None:
            return self._generate_mock_data()

        original_code = code
        if '.' not in code:
            suffix = self._get_stock_suffix(code)
            code_for_query = f"{code}{suffix}"
        else:
            code_for_query = code
            suffix = '.' + code.split('.')[1]

        # 第一次查询
        try:
            df = self._query_kline(code_for_query, start_date, end_date)
            if not df.empty:
                return df
        except Exception as e:
            print("查询失败:", e)

        # 如果第一次查询未找到数据且传入的是无后缀代码，尝试另一个市场
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
                        print(f"[DB] 查询成功，返回 {len(df)} 条数据，日期范围 {df['trade_date'].min()} 到 {df['trade_date'].max()}")
                        return df
                except Exception as e:
                    print("备用查询失败:", e)

        # 最终返回模拟数据（覆盖整个请求范围）
        return self._generate_mock_data()

    def _generate_mock_data(self):
        """生成覆盖 2010-01-01 至 2026-12-31 的模拟K线数据"""
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
        print(f"[DB] 使用模拟数据，生成 {len(df)} 条数据（{dates[0].strftime('%Y-%m-%d')} ~ {dates[-1].strftime('%Y-%m-%d')}）")
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
