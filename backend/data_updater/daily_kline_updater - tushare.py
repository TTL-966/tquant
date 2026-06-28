import pandas as pd
import time
import os
from datetime import datetime, timedelta
from sqlalchemy import text
import tushare as ts

from backend.base_updater import BaseUpdater


class DailyKlineUpdater(BaseUpdater):
    def __init__(self, db_engine, token="05790ffb76982fbf877806ccacae6964e72be8f361bbf702e0ad13d4"):
        super().__init__("daily_kline")
        self.engine = db_engine
        self.table_name = 'stock_daily_qfq_with_name'
        self.request_interval = 0.1
        self.max_retries = 2
        self.token = token
        ts.set_token(self.token)
        self.pro = ts.pro_api()
        self._init_lock_table()
        self._init_fail_table()

    def _init_lock_table(self):
        with self.engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS update_lock (
                    name TEXT PRIMARY KEY,
                    pid INTEGER,
                    start_time TEXT,
                    checkpoint TEXT
                )
"""))
            try:
                conn.execute(text("ALTER TABLE update_lock ADD COLUMN checkpoint TEXT"))
                conn.commit()
            except Exception:
                pass
            conn.commit()

    def _init_fail_table(self):
        with self.engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS stock_update_fail (
                    code TEXT PRIMARY KEY,
                    fail_count INTEGER DEFAULT 0,
                    last_fail_date TEXT,
                    skip_until TEXT
                )
"""))
            try:
                conn.execute(text("ALTER TABLE stock_update_fail ADD COLUMN permanent BOOLEAN DEFAULT 0"))
                conn.commit()
            except Exception:
                pass
            conn.commit()

    def _acquire_lock(self):
        now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        pid = os.getpid()
        timeout_minutes = 60
        with self.engine.connect() as conn:
            conn.execute(text("""
                DELETE FROM update_lock 
                WHERE name = 'daily_kline' 
                AND datetime(start_time) < datetime('now', :interval)
"""), {"interval": f'-{timeout_minutes} minutes'})
            conn.commit()
            res = conn.execute(text("""
                INSERT OR IGNORE INTO update_lock (name, pid, start_time)
                VALUES ('daily_kline', :pid, :start_time)
"""), {"pid": pid, "start_time": now_str})
            conn.commit()
            return res.rowcount != 0

    def _release_lock(self):
        with self.engine.connect() as conn:
            conn.execute(text("DELETE FROM update_lock WHERE name = 'daily_kline'"))
            conn.commit()

    def _record_checkpoint(self, code):
        with self.engine.connect() as conn:
            conn.execute(text("""
                INSERT OR REPLACE INTO update_lock (name, pid, start_time, checkpoint)
                VALUES ('daily_kline_checkpoint', :code, datetime('now'), :code)
"""), {"code": code})
            conn.commit()

    def _get_checkpoint(self):
        with self.engine.connect() as conn:
            row = conn.execute(text("""
                SELECT checkpoint FROM update_lock WHERE name = 'daily_kline_checkpoint'
""")).fetchone()
            return row[0] if row else None

    def _clear_checkpoint(self):
        with self.engine.connect() as conn:
            conn.execute(text("DELETE FROM update_lock WHERE name = 'daily_kline_checkpoint'"))
            conn.commit()

    def _should_skip_stock(self, code):
        with self.engine.connect() as conn:
            row = conn.execute(text("""
                SELECT skip_until, permanent FROM stock_update_fail WHERE code = :code
"""), {"code": code}).fetchone()
            if row:
                if row[1]:
                    return True
                if row[0] and datetime.now().strftime('%Y-%m-%d') < row[0]:
                    return True
        return False

    def _permanent_skip(self, code):
        with self.engine.connect() as conn:
            conn.execute(text("""
                INSERT OR REPLACE INTO stock_update_fail 
                (code, fail_count, last_fail_date, skip_until, permanent)
                VALUES (:code, 0, :last_date, '9999-12-31', 1)
"""), {"code": code, "last_date": datetime.now().strftime('%Y-%m-%d')})
            conn.commit()
        self.log(f"股票 {code} 标记为永久无效，不再更新")

    def _record_fail(self, code, is_permanent=False):
        if is_permanent:
            self._permanent_skip(code)
            return
        with self.engine.connect() as conn:
            row = conn.execute(text("""
                SELECT fail_count FROM stock_update_fail WHERE code = :code
"""), {"code": code}).fetchone()
            fail_count = row[0] if row else 0
            fail_count += 1
            skip_until = None
            if fail_count >= 3:
                skip_until = (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')
                fail_count = 0
            conn.execute(text("""
                INSERT OR REPLACE INTO stock_update_fail (code, fail_count, last_fail_date, skip_until, permanent)
                VALUES (:code, :fail_count, :last_date, :skip_until, 0)
"""), {"code": code, "fail_count": fail_count,
       "last_date": datetime.now().strftime('%Y-%m-%d'),
       "skip_until": skip_until})
            conn.commit()

    def _record_success(self, code):
        with self.engine.connect() as conn:
            conn.execute(text("DELETE FROM stock_update_fail WHERE code = :code"), {"code": code})
            conn.commit()

    def _login_baostock(self) -> bool:
        return True

    def _get_ts_code(self, pure_code):
        if pure_code.startswith(('6', '9')):
            return f"{pure_code}.SH"
        return f"{pure_code}.SZ"

    def _get_valid_stocks(self, trade_date=None):
        try:
            df = self.pro.stock_basic(list_status='L', fields='ts_code')
            if df.empty:
                self.log("获取股票列表为空", "WARN")
                return set()
            valid = {code.split('.')[0] for code in df['ts_code']}
            self.log(f"获取到 {len(valid)} 只上市股票")
            return valid
        except Exception as e:
            self.log(f"获取有效股票列表异常: {e}", "ERROR")
            return set()

    def _get_latest_trade_date(self, end_date=None):
        """返回 Baostock 数据已可用的最近交易日（考虑到数据更新时间为 17:30），返回 YYYY-MM-DD 格式"""
        if end_date is None:
            end_date = datetime.now().strftime('%Y-%m-%d')
        end_date_yyyymmdd = end_date.replace('-', '')
        try:
            df = self.pro.trade_cal(exchange='SSE', start_date='19900101', end_date=end_date_yyyymmdd)
            if df.empty:
                raise Exception("No trade calendar")
            trade_dates = df[df['is_open'] == 1]['cal_date'].tolist()
            if not trade_dates:
                raise Exception("No open trade date")
            trade_dates.sort()
            last_date_yyyymmdd = trade_dates[-1]
            last_date = f"{last_date_yyyymmdd[:4]}-{last_date_yyyymmdd[4:6]}-{last_date_yyyymmdd[6:8]}"

            now = datetime.now()
            if last_date == now.strftime('%Y-%m-%d'):
                if now.hour < 17 or (now.hour == 17 and now.minute < 30):
                    if len(trade_dates) >= 2:
                        prev = trade_dates[-2]
                        return f"{prev[:4]}-{prev[4:6]}-{prev[6:8]}"
            return last_date
        except Exception as e:
            self.log(f"获取最新交易日失败: {e}，尝试向前手动查找", "WARN")
            dt = datetime.strptime(end_date, '%Y-%m-%d')
            while True:
                if dt.weekday() >= 5:
                    dt -= timedelta(days=1)
                    continue
                if dt.date() == datetime.now().date():
                    if datetime.now().hour < 17 or (datetime.now().hour == 17 and datetime.now().minute < 30):
                        dt -= timedelta(days=1)
                        continue
                break
            return dt.strftime('%Y-%m-%d')

    def _fetch_stock_data(self, ts_code, start_date, end_date):
        """使用 tushare pro_bar 获取前复权日线数据，并统一字段格式"""
        for attempt in range(self.max_retries):
            try:
                df = ts.pro_bar(
                    ts_code=ts_code,
                    adj='qfq',
                    start_date=start_date,
                    end_date=end_date,
                    factors=['tor', 'vr']
                )
                if df is None or df.empty:
                    check_df = ts.pro_bar(ts_code=ts_code, adj='qfq', start_date='19900101', end_date=end_date, limit=1)
                    if check_df is None or check_df.empty:
                        return 'INVALID'
                    else:
                        return None

                # 1. 日期格式转换：YYYYMMDD -> YYYY-MM-DD
                df['trade_date'] = pd.to_datetime(df['trade_date'], format='%Y%m%d').dt.strftime('%Y-%m-%d')

                # 2. 单位转换：tushare 的 amount 是千元，原 baostock 是元，统一为元
                if 'amount' in df.columns:
                    df['amount'] = df['amount'] * 1000

                # 3. 单位转换：tushare 的 vol 是股，原 baostock 是手，统一为手（1手=100股）
                if 'vol' in df.columns:
                    df['vol'] = df['vol'] / 100.0

                # 4. 确保需要的列都存在（vol 和 amount 可能存在缺失，补 NA）
                required_cols = ['trade_date', 'open', 'high', 'low', 'close', 'vol', 'amount']
                for col in required_cols:
                    if col not in df.columns:
                        df[col] = pd.NA

                # 5. 选取所需列并保持顺序
                df = df[required_cols]

                # 6. 转换数值类型
                numeric_cols = ['open', 'high', 'low', 'close', 'vol', 'amount']
                for col in numeric_cols:
                    df[col] = pd.to_numeric(df[col], errors='coerce')

                return df
            except Exception as e:
                self.log(f"请求异常 (尝试 {attempt + 1}/{self.max_retries}): {e}", "WARN")
                time.sleep(1)
        return None

    def _get_existing_dates(self, ts_code):
        try:
            existing = pd.read_sql(
                f"SELECT trade_date FROM {self.table_name} WHERE ts_code = '{ts_code}'",
                self.engine
            )
            return set(existing['trade_date'])
        except Exception:
            return set()

    def needs_update(self) -> bool:
        try:
            sql = f"SELECT MAX(trade_date) as max_date FROM {self.table_name}"
            result = pd.read_sql(sql, self.engine)
            max_date = result.iloc[0, 0]
            if max_date is None:
                return True
            latest_trade = self._get_latest_trade_date()
            need = datetime.strptime(max_date, '%Y-%m-%d').date() < datetime.strptime(latest_trade, '%Y-%m-%d').date()
            self.log(f"max_date={max_date}, latest_trade_date={latest_trade}, need_update={need}")
            return need
        except Exception as e:
            self.log(f"needs_update 异常: {e}", "ERROR")
            return True

    def run(self) -> tuple:
        if not self._acquire_lock():
            print("获取锁失败")
            self.log("已有更新进程在运行，跳过本次更新")
            return False, "已有更新进程"

        try:
            if not self.needs_update():
                self.log("数据已是最新，无需更新")
                return True, "数据已是最新，跳过更新"
            checkpoint = self._get_checkpoint()
            if checkpoint:
                self.log(f"检测到未完成的更新，从断点 {checkpoint} 继续")

            if not self._login_baostock():
                return False, "登录失败"

            today_natural = datetime.now().strftime('%Y-%m-%d')
            latest_trade_date = self._get_latest_trade_date(today_natural)

            dt = datetime.strptime(latest_trade_date, '%Y-%m-%d')
            if dt.weekday() >= 5:
                days_back = dt.weekday() - 4
                dt -= timedelta(days=days_back)
                latest_trade_date = dt.strftime('%Y-%m-%d')
                self.log(f"检测到周末日期，已自动修正为上一个交易日: {latest_trade_date}", "INFO")
            self.log(f"当前自然日: {today_natural}, 最新交易日: {latest_trade_date}")

            self.log("获取有效股票列表...")
            valid_stocks = self._get_valid_stocks()
            if not valid_stocks:
                self.log("无法获取有效股票列表，将使用数据库中的全部股票（可能包含退市股）", "WARN")
            else:
                self.log(f"获取到 {len(valid_stocks)} 只有效股票")

            sql = """
                SELECT REPLACE(REPLACE(ts_code, '.SH', ''), '.SZ', '') as code,
                       MAX(trade_date) as max_date
                FROM stock_daily_qfq_with_name
                GROUP BY code
                ORDER BY code
"""
            df_latest = pd.read_sql(sql, self.engine)
            if df_latest.empty:
                return False, "无股票数据"

            if valid_stocks:
                original_count = len(df_latest)
                df_latest = df_latest[df_latest['code'].isin(valid_stocks)]
                self.log(f"过滤后剩余 {len(df_latest)} 只股票（原 {original_count} 只，移除了无效/退市股）")

            end_date = latest_trade_date
            df_latest = df_latest[df_latest['max_date'] < end_date]
            self.log(f"需要实际更新的股票数量: {len(df_latest)} 只（已过滤掉数据已最新的股票）")

            try:
                name_df = pd.read_sql("SELECT code, name FROM stock_basic", self.engine)
                name_dict = dict(zip(name_df['code'], name_df['name']))
            except Exception:
                name_dict = {}

            success = 0
            fail = 0
            skip_invalid = 0
            skip_duplicate = 0
            total = len(df_latest)
            start_processing = False

            for idx, row in df_latest.iterrows():
                code = row['code']
                max_date = row['max_date']

                if checkpoint and not start_processing:
                    if code == checkpoint:
                        start_processing = True
                    continue
                if not start_processing:
                    start_processing = True

                if self._should_skip_stock(code):
                    self.log(f"[{idx + 1}/{total}] 跳过 {code}（已标记跳过）")
                    skip_invalid += 1
                    continue

                if max_date is None or pd.isna(max_date):
                    start_date = (datetime.now() - timedelta(days=365)).strftime('%Y-%m-%d')
                else:
                    start_dt = datetime.strptime(max_date, '%Y-%m-%d') + timedelta(days=1)
                    start_date = start_dt.strftime('%Y-%m-%d')

                if start_date > end_date:
                    continue

                ts_code = self._get_ts_code(code)
                self.log(f"[{idx + 1}/{total}] 更新 {ts_code} 区间 {start_date} ~ {end_date} ...")
                self._record_checkpoint(code)

                result = self._fetch_stock_data(ts_code, start_date, end_date)

                if result is None:
                    fail += 1
                    self.log(f"✗ 查询失败或无数据（临时失败）")
                    self._record_fail(code, is_permanent=False)
                elif isinstance(result, str) and result == 'INVALID':
                    skip_invalid += 1
                    self.log(f"✗ 无效股票（无任何历史数据），永久跳过")
                    self._record_fail(code, is_permanent=True)
                else:
                    df = result
                    df['ts_code'] = ts_code
                    df['name'] = name_dict.get(code, None)

                    existing_dates = self._get_existing_dates(ts_code)
                    if existing_dates:
                        df = df[~df['trade_date'].isin(existing_dates)]
                    if df.empty:
                        self.log(f"✓ 数据已存在，无需写入")
                        skip_duplicate += 1
                        self._record_success(code)
                        continue

                    try:
                        df.to_sql(self.table_name, self.engine, if_exists='append', index=False, method='multi')
                        success += 1
                        self.log(f"✓ 写入 {len(df)} 条")
                        self._record_success(code)
                    except Exception as e:
                        fail += 1
                        self.log(f"✗ 写入失败: {e}", "ERROR")
                        self._record_fail(code, is_permanent=False)

                time.sleep(self.request_interval)

            self.log(f"更新完成: 成功 {success}, 失败 {fail}, 跳过无效 {skip_invalid}, 跳过重复 {skip_duplicate}")
            self._clear_checkpoint()
            return True, f"成功 {success}, 失败 {fail}, 跳过无效 {skip_invalid}, 跳过重复 {skip_duplicate}"
        finally:
            self._release_lock( )