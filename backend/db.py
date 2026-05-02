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
        if self.engine:
            try:
                # 处理代码格式
                if '.' not in code:
                    code_sz = f"{code}.SZ"
                    code_sh = f"{code}.SH"
                    sql = text("""
                        SELECT trade_date, open, high, low, close, vol AS volume
                        FROM stock_daily
                        WHERE (ts_code = :code_sz OR ts_code = :code_sh)
                          AND trade_date >= :start_date
                          AND trade_date <= :end_date
                        ORDER BY trade_date ASC
                        LIMIT 60
                    """)
                    with self.engine.connect() as conn:
                        df = pd.read_sql(
                            sql,
                            conn,
                            params={
                                "code_sz": code_sz,
                                "code_sh": code_sh,
                                "start_date": start_date,
                                "end_date": end_date
                            }
                        )
                else:
                    sql = text("""
                        SELECT trade_date, open, high, low, close, vol AS volume
                        FROM stock_daily
                        WHERE ts_code = :code
                          AND trade_date >= :start_date
                          AND trade_date <= :end_date
                        ORDER BY trade_date ASC
                        LIMIT 60
                    """)
                    with self.engine.connect() as conn:
                        df = pd.read_sql(
                            sql,
                            conn,
                            params={
                                "code": code,
                                "start_date": start_date,
                                "end_date": end_date
                            }
                        )

                if df.empty:
                    return self._generate_mock_data()
                # trade_date 是字符串，不再转换
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
            'trade_date': dates.strftime('%Y-%m-%d'),
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
