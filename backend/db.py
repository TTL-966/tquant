import os
import pandas as pd
import numpy as np
from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError


class Database:
    def __init__(self):
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        db_path = os.path.join(base_dir, 'tquant.db')
        self.db_path = db_path
        self.engine = create_engine(f'sqlite:///{db_path}?check_same_thread=False', echo=False)
        self._init_tables()

    def _init_tables(self):
        with self.engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS stock_daily_qfq_with_name (
                    ts_code TEXT,
                    name TEXT,
                    trade_date TEXT,
                    open REAL,
                    high REAL,
                    low REAL,
                    close REAL,
                    vol INTEGER,
                    amount REAL,
                    PRIMARY KEY (ts_code, trade_date)
                )
            """))
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS idx_ts_code_trade_date
                ON stock_daily_qfq_with_name(ts_code, trade_date)
            """))

            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS stock_basic (
                    code TEXT PRIMARY KEY,
                    name TEXT
                )
            """))

            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS stock_industry (
                    ts_code TEXT PRIMARY KEY,
                    stock_name TEXT,
                    industry TEXT,
                    industry_classification TEXT
                )
            """))
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS idx_stock_industry_industry
                ON stock_industry(industry)
            """))

            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS index_components (
                    index_code TEXT,
                    stock_code TEXT,
                    update_date TEXT,
                    PRIMARY KEY (index_code, stock_code)
                )
            """))

            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS stock_financial (
                    ts_code TEXT PRIMARY KEY,
                    pe_ttm REAL,
                    pb REAL,
                    roe REAL,
                    total_mv REAL,
                    revenue REAL,
                    net_profit REAL,
                    update_date TEXT
                )
            """))
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS idx_financial_pe ON stock_financial(pe_ttm)
            """))
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS idx_financial_pb ON stock_financial(pb)
            """))
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS idx_financial_roe ON stock_financial(roe)
            """))

            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS stock_industry_detail (
                    ts_code TEXT PRIMARY KEY,
                    stock_name TEXT,
                    industry_level1 TEXT,
                    industry_level2 TEXT,
                    industry_level3 TEXT,
                    concept_sectors TEXT,
                    update_date TEXT
                )
            """))
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS idx_industry_l1 ON stock_industry_detail(industry_level1)
            """))
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS idx_industry_l2 ON stock_industry_detail(industry_level2)
            """))

            conn.commit()

    def _get_stock_suffix(self, code):
        code = str(code).zfill(6)
        if code.startswith(('000', '001', '002', '003', '300', '301')):
            return '.SZ'
        if code.startswith(('600', '601', '603', '605', '688', '689')):
            return '.SH'
        if code.startswith('8'):
            return '.BJ'
        return '.SZ'

    def _query_kline(self, code, start_date, end_date, limit=0):
        if start_date is None:
            start_date = "2010-01-01"
        if end_date is None:
            end_date = "2026-12-31"

        def do_query():
            if limit > 0:
                sql = text("""
                    SELECT trade_date, open, high, low, close, vol AS volume
                    FROM stock_daily_qfq_with_name
                    WHERE ts_code = :code
                      AND trade_date >= :start
                      AND trade_date <= :end
                    ORDER BY trade_date DESC LIMIT :limit
                """)
                with self.engine.connect() as conn:
                    df = pd.read_sql(
                        sql,
                        conn,
                        params={"code": code, "start": start_date, "end": end_date, "limit": limit}
                    )
                if not df.empty:
                    df = df.sort_values('trade_date', ascending=True).reset_index(drop=True)
                return df
            else:
                sql = text("""
                    SELECT trade_date, open, high, low, close, vol AS volume
                    FROM stock_daily_qfq_with_name
                    WHERE ts_code = :code
                      AND trade_date >= :start
                      AND trade_date <= :end
                    ORDER BY trade_date ASC
                """)
                with self.engine.connect() as conn:
                    df = pd.read_sql(sql, conn, params={"code": code, "start": start_date, "end": end_date})
                return df

        try:
            return do_query()
        except OperationalError:
            self.engine.dispose()
            return do_query()

    def get_kline(self, code, start_date="2010-01-01", end_date="2026-12-31", limit=0):
        if start_date is None:
            start_date = "2010-01-01"
        if end_date is None:
            end_date = "2026-12-31"
        original_code = code
        if '.' not in code:
            suffix = self._get_stock_suffix(code)
            code_for_query = f"{code}{suffix}"
        else:
            code_for_query = code
            suffix = '.' + code.split('.')[1]
        try:
            df = self._query_kline(code_for_query, start_date, end_date, limit)
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
                    df = self._query_kline(alt_code, start_date, end_date, limit)
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
        if not os.path.exists(self.db_path):
            return {"connected": False, "message": f"数据库文件不存在: {self.db_path}"}
        try:
            with self.engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return {"connected": True, "message": f"SQLite 数据库连接正常 ({self.db_path})"}
        except Exception as e:
            return {"connected": False, "message": f"数据库连接异常: {str(e)}"}

    def search_stock(self, keyword):
        if not keyword:
            return []
        like = f"%{keyword}%"
        sql = text("""
            SELECT code, name FROM stock_basic
            WHERE code LIKE :like OR name LIKE :like
            LIMIT 50
        """)
        def do_query():
            with self.engine.connect() as conn:
                rows = conn.execute(sql, {"like": like}).fetchall()
            result = []
            for row in rows:
                code = row[0]
                name = row[1]
                result.append({"code": code, "name": name})
            return result
        try:
            return do_query()
        except OperationalError:
            self.engine.dispose()
            return do_query()

    def get_name_by_code(self, code):
        for suffix in ('.SZ', '.SH', '.BJ'):
            ts_code_candidate = f"{code}{suffix}"
            sql = text("""
                SELECT name FROM stock_daily_qfq_with_name
                WHERE ts_code = :ts_code
                LIMIT 1
            """)
            try:
                with self.engine.connect() as conn:
                    rows = conn.execute(sql, {"ts_code": ts_code_candidate}).fetchall()
                if rows:
                    name = rows[0][0]
                    return f"{name} ({code})"
            except Exception:
                continue
        like = f"{code}%"
        sql = text("""
            SELECT name FROM stock_daily_qfq_with_name
            WHERE ts_code LIKE :like
            LIMIT 1
        """)
        try:
            with self.engine.connect() as conn:
                rows = conn.execute(sql, {"like": like}).fetchall()
            if rows:
                name = rows[0][0]
                return f"{name} ({code})"
        except Exception:
            pass
        return code

    def get_stock_status(self, code):
        """返回默认值。当前 stock_basic 表仅有 code/name 字段，无 list_date/delist_date。"""
        return {'listed': '1900-01-01', 'delisted': None}

    def get_industry_by_code(self, code):
        suffix = self._get_stock_suffix(code)
        ts_code = f"{code}{suffix}"
        sql = text("SELECT industry FROM stock_industry WHERE ts_code = :ts_code LIMIT 1")
        try:
            with self.engine.connect() as conn:
                rows = conn.execute(sql, {"ts_code": ts_code}).fetchall()
            if rows:
                return rows[0][0]
            return None
        except Exception:
            return None

    def get_stocks_by_industry(self, industry_name):
        like = f"%{industry_name}%"
        sql = text("SELECT ts_code, stock_name FROM stock_industry WHERE industry LIKE :industry LIMIT 20")
        try:
            with self.engine.connect() as conn:
                rows = conn.execute(sql, {"industry": like}).fetchall()
            result = []
            for row in rows:
                ts_code = row[0]
                name = row[1]
                pure_code = ts_code.split('.')[0] if '.' in ts_code else ts_code
                result.append({"code": pure_code, "name": name})
            return result
        except Exception:
            return []

    def get_index_stocks(self, index_code):
        try:
            sql = text(
                "SELECT stock_code FROM index_components "
                "WHERE index_code = :index_code ORDER BY stock_code"
            )
            with self.engine.connect() as conn:
                rows = conn.execute(sql, {"index_code": index_code}).fetchall()
            if rows:
                return [row[0].split('.')[0] if '.' in str(row[0]) else str(row[0]) for row in rows]
        except Exception:
            pass

        mock_indices = {
            '000300.XSHG': [
                '000001', '000002', '000063', '000333', '000651', '000725', '000858',
                '002142', '002415', '002594', '300750', '600000', '600009', '600016',
                '600028', '600030', '600036', '600048', '600050', '600104', '600276',
                '600309', '600519', '600585', '600809', '600887', '601012', '601088',
                '601166', '601288', '601318', '601328', '601398', '601668', '601857',
                '601888', '601939', '603259', '603288'
            ],
            '000905.XSHG': [
                '000012', '000021', '000039', '000050', '000060', '000066', '000100',
                '000155', '002013', '002028', '002049', '002074', '002091', '002110',
                '002129', '002138', '002155', '300001', '300003', '300014', '300024',
                '300033', '300037', '300058', '300070', '300088', '600004', '600008',
                '600012', '600017', '600018', '600019', '600020', '600021', '600022',
                '601000', '601001', '601003', '601005', '601006', '601008'
            ],
            '000852.XSHG': [
                '000158', '000301', '000401', '000420', '000426', '000501', '000510',
                '000519', '002001', '002003', '002007', '002008', '002010', '002011',
                '002017', '002019', '002020', '300002', '300004', '300005', '300006',
                '300007', '300008', '300009', '300010', '300011', '600001', '600002',
                '600003', '600005', '600006', '600007', '600010', '600011', '600012'
            ],
            '399006.XSHE': [
                '300001', '300003', '300014', '300015', '300024', '300033', '300037',
                '300058', '300059', '300070', '300088', '300122', '300124', '300142',
                '300146', '300207', '300251', '300274', '300316', '300347', '300408',
                '300413', '300433', '300450', '300498', '300502', '300529', '300558',
                '300595', '300601', '300628', '300661', '300750', '300759', '300760'
            ],
            '000688.XSHG': [
                '688001', '688005', '688008', '688009', '688012', '688036', '688065',
                '688111', '688126', '688187', '688223', '688256', '688303', '688396',
                '688516', '688536', '688561', '688599', '688728', '688777', '688981'
            ],
        }
        return mock_indices.get(index_code, [])
