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

    def get_kline(self, code, start_date="2026-01-01", end_date="2026-04-01"):
        """
        获取K线数据
        code: 股票代码，如 '000001' 或 '000001.SZ'
        start_date: 开始日期，格式 YYYY-MM-DD
        end_date: 结束日期，格式 YYYY-MM-DD
        """
        if self.engine:
            try:
                # 1. 转换日期格式：2026-01-05 -> 20260105
                start = start_date.replace('-', '')
                end = end_date.replace('-', '')

                # 2. 处理股票代码格式：000001 -> 000001.SZ
                if '.' not in code:
                    code = f"{code}.SZ"

                sql = text("""
                    SELECT trade_date, open, high, low, close, vol AS volume
                    FROM stock_daily
                    WHERE ts_code = :code
                      AND trade_date >= :start
                      AND trade_date <= :end
                    ORDER BY trade_date ASC
                    LIMIT 60
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

                if df.empty:
                    print(f"未找到 {code} 在 {start_date} 到 {end_date} 的数据")
                    return self._generate_mock_data()

                return df
            except Exception as e:
                print("查询失败，使用模拟数据:", e)
        return self._generate_mock_data()

    def _generate_mock_data(self):
        n = 60
        np.random.seed(42)
        dates = pd.date_range("2026-01-01", periods=n, freq='B')
        base = 12.0
        opens = base + np.cumsum(np.random.randn(n) * 0.5)
        closes = opens + np.random.randn(n) * 0.6
        highs = np.maximum(opens, closes) + np.random.rand(n) * 0.5
        lows = np.minimum(opens, closes) - np.random.rand(n) * 0.5
        volumes = np.random.randint(100000, 500000, n)
        df = pd.DataFrame({
            'trade_date': [d.strftime('%Y%m%d') for d in dates],  # YYYYMMDD 格式
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
