import pandas as pd
import numpy as np
import pymysql

class Database:
    def __init__(self):
        self.connection = None
        try:
            self.connection = pymysql.connect(
                host='localhost',
                port=3306,
                user='root',
                password='998867',
                database='studb',
                charset='utf8mb4',
                cursorclass=pymysql.cursors.DictCursor
            )
        except Exception as e:
            print("数据库连接失败，将使用模拟数据:", e)

    def get_kline(self, code, start_date="2026-01-01", end_date="2026-04-01"):
        if self.connection:
            try:
                sql = """
                    SELECT trade_date, open, high, low, close, volume
                    FROM stock_daily
                    WHERE code = %s
                      AND trade_date BETWEEN %s AND %s
                    ORDER BY trade_date ASC
                """
                df = pd.read_sql(sql, self.connection, params=[code, start_date, end_date])
                df['trade_date'] = pd.to_datetime(df['trade_date'])
                return df
            except Exception as e:
                print("查询失败，使用模拟数据:", e)
        return self._generate_mock_data()

    def _generate_mock_data(self):
        n = 60
        np.random.seed(42)
        base = 12.0
        dates = pd.date_range("2026-01-01", periods=n, freq='B')
        opens = base + np.cumsum(np.random.randn(n) * 0.5)
        closes = opens + np.random.randn(n) * 0.6
        highs = np.maximum(opens, closes) + np.random.rand(n) * 0.5
        lows = np.minimum(opens, closes) - np.random.rand(n) * 0.5
        volumes = np.random.randint(100000, 500000, n)
        df = pd.DataFrame({
            'trade_date': dates,
            'open': opens,
            'high': highs,
            'low': lows,
            'close': closes,
            'volume': volumes
        })
        return df
