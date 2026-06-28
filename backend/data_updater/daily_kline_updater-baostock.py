#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
统一数据更新器 (Baostock 数据源)
支持：
  - 个股日线数据 (前复权)
  - 主要指数日线数据 (沪深300、上证、深证、中证500、创业板等)

用法：
  python unified_updater_baostock.py --type stock
  python unified_updater_baostock.py --type index
  python unified_updater_baostock.py --type index --start 2020-01-01
"""

import baostock as bs
import pandas as pd
import time
import os
import sys
import argparse
from datetime import datetime, timedelta
from sqlalchemy import text, create_engine

# 确保能导入 backend 模块
current_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.dirname(current_dir)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from base_updater import BaseUpdater


# ==================== 公共辅助函数 ====================
def convert_baostock_amount(amount_series):
    """Baostock 成交额单位是千元，转换为元"""
    return amount_series * 1000.0


# ==================== 个股日线更新器 (Baostock) ====================
class StockDailyUpdater(BaseUpdater):
    def __init__(self, db_engine):
        super().__init__("daily_kline")
        self.engine = db_engine
        self.table_name = 'stock_daily_qfq_with_name'
        self.request_interval = 0.5
        self.max_retries = 2
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
        for attempt in range(3):
            lg = bs.login()
            if lg.error_code == '0':
                self.log("登录成功")
                return True
            self.log(f"登录失败 (尝试 {attempt + 1}/3): {lg.error_msg}", "WARN")
            time.sleep(2)
        return False

    def _get_baostock_code(self, pure_code):
        if pure_code.startswith(('6', '9')):
            return f"sh.{pure_code}"
        return f"sz.{pure_code}"

    def _get_valid_stocks(self, trade_date=None):
        if trade_date is None:
            trade_date = datetime.now().strftime('%Y-%m-%d')
        try:
            rs = bs.query_all_stock(day=trade_date)
            if rs.error_code != '0':
                self.log(f"获取有效股票列表失败: {rs.error_msg}", "WARN")
                return set()
            valid = set()
            while rs.next():
                code = rs.get_row_data()[0]
                pure = code.split('.')[1]
                valid.add(pure)
            return valid
        except Exception as e:
            self.log(f"获取有效股票列表异常: {e}", "ERROR")
            return set()

    def _get_latest_trade_date(self, end_date=None):
        """返回 Baostock 数据已可用的最近交易日（考虑到数据更新时间为 17:30）"""
        if end_date is None:
            end_date = datetime.now().strftime('%Y-%m-%d')
        try:
            rs = bs.query_trade_dates(start_date="1990-01-01", end_date=end_date)
            if rs.error_code != '0':
                raise Exception(rs.error_msg)
            dates = []
            while rs.next():
                dates.append(rs.get_row_data()[0])
            if not dates:
                raise Exception("No trade date found")
            last_date = dates[-1]
            now = datetime.now()
            if last_date == now.strftime('%Y-%m-%d'):
                if now.hour < 17 or (now.hour == 17 and now.minute < 30):
                    if len(dates) >= 2:
                        return dates[-2]
            return last_date
        except Exception:
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

    def _fetch_stock_data(self, bs_code, start_date, end_date):
        for attempt in range(self.max_retries):
            try:
                k_rs = bs.query_history_k_data_plus(
                    bs_code,
                    "date,open,high,low,close,volume,amount",
                    start_date=start_date,
                    end_date=end_date,
                    adjustflag='2'
                )
                if k_rs.error_code != '0':
                    self.log(f"查询失败 (尝试 {attempt+1}/{self.max_retries}): {k_rs.error_msg}", "WARN")
                    time.sleep(1)
                    continue
                data_list = []
                while k_rs.next():
                    data_list.append(k_rs.get_row_data())
                if not data_list:
                    # 检查是否有任何历史数据
                    check_rs = bs.query_history_k_data_plus(
                        bs_code,
                        "date",
                        start_date="1990-01-01",
                        end_date=datetime.now().strftime('%Y-%m-%d'),
                        adjustflag='2'
                    )
                    has_any = False
                    while check_rs.next():
                        has_any = True
                        break
                    if not has_any:
                        return 'INVALID'
                    else:
                        return None
                df = pd.DataFrame(data_list,
                                  columns=['trade_date', 'open', 'high', 'low', 'close', 'vol', 'amount'])
                numeric_cols = ['open', 'high', 'low', 'close', 'vol', 'amount']
                for col in numeric_cols:
                    df[col] = pd.to_numeric(df[col], errors='coerce')
                # 修正成交额单位：千元 -> 元
                df['amount'] = df['amount'] * 1000.0
                return df
            except Exception as e:
                self.log(f"请求异常 (尝试 {attempt+1}/{self.max_retries}): {e}", "WARN")
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

            self.log("获取 baostock 有效股票列表...")
            valid_stocks = self._get_valid_stocks(trade_date=latest_trade_date)
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
                    self.log(f"[{idx+1}/{total}] 跳过 {code}（已标记跳过）")
                    skip_invalid += 1
                    continue

                if max_date is None or pd.isna(max_date):
                    start_date = (datetime.now() - timedelta(days=365)).strftime('%Y-%m-%d')
                else:
                    start_dt = datetime.strptime(max_date, '%Y-%m-%d') + timedelta(days=1)
                    start_date = start_dt.strftime('%Y-%m-%d')

                if start_date > end_date:
                    continue

                bs_code = self._get_baostock_code(code)
                self.log(f"[{idx+1}/{total}] 更新 {bs_code} 区间 {start_date} ~ {end_date} ...")
                self._record_checkpoint(code)

                result = self._fetch_stock_data(bs_code, start_date, end_date)

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
                    if code.startswith(('6', '9')):
                        ts_code = f"{code}.SH"
                    else:
                        ts_code = f"{code}.SZ"
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

            bs.logout()
            self.log(f"更新完成: 成功 {success}, 失败 {fail}, 跳过无效 {skip_invalid}, 跳过重复 {skip_duplicate}")
            self._clear_checkpoint()
            return True, f"成功 {success}, 失败 {fail}, 跳过无效 {skip_invalid}, 跳过重复 {skip_duplicate}"
        finally:
            self._release_lock()


# ==================== 指数日线更新器 (Baostock) ====================
class IndexDailyUpdater(BaseUpdater):
    def __init__(self, db_engine, index_list=None):
        super().__init__("index_daily_updater")
        self.engine = db_engine
        self.table_name = 'index_daily'
        self.request_interval = 0.5
        self.max_retries = 2

        # 默认指数列表（Baostock 代码格式）
        if index_list is None:
            self.index_list = [
                ('sh.000300', '000300.SH'),   # 沪深300
                ('sh.000001', '000001.SH'),   # 上证指数
                ('sz.399001', '399001.SZ'),   # 深证成指
                ('sh.000905', '000905.SH'),   # 中证500
                ('sz.399006', '399006.SZ'),   # 创业板指
                ('sh.000016', '000016.SH'),   # 上证50
                ('sz.399330', '399330.SZ'),   # 深证100
                ('sh.000852', '000852.SH'),   # 中证1000
            ]
        else:
            # 如果用户传入的是 ts_code 列表，需要转换为 baostock 代码
            self.index_list = []
            for ts_code in index_list:
                if ts_code.endswith('.SH'):
                    bs_code = f"sh.{ts_code.replace('.SH', '')}"
                elif ts_code.endswith('.SZ'):
                    bs_code = f"sz.{ts_code.replace('.SZ', '')}"
                else:
                    # 默认尝试 sh
                    bs_code = f"sh.{ts_code}"
                self.index_list.append((bs_code, ts_code))

        self._init_table()
        self._init_lock_table()
        self._init_fail_table()

    def _init_table(self):
        with self.engine.connect() as conn:
            conn.execute(text(f"""
                CREATE TABLE IF NOT EXISTS {self.table_name} (
                    ts_code TEXT NOT NULL,
                    trade_date TEXT NOT NULL,
                    open REAL,
                    high REAL,
                    low REAL,
                    close REAL,
                    vol REAL,
                    amount REAL,
                    PRIMARY KEY (ts_code, trade_date)
                )
            """))
            conn.commit()
            self.log(f"表 {self.table_name} 已就绪")

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
                CREATE TABLE IF NOT EXISTS index_update_fail (
                    ts_code TEXT PRIMARY KEY,
                    fail_count INTEGER DEFAULT 0,
                    last_fail_date TEXT,
                    skip_until TEXT
                )
            """))
            conn.commit()

    def _acquire_lock(self):
        now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        pid = os.getpid()
        timeout_minutes = 30
        with self.engine.connect() as conn:
            conn.execute(text("""
                DELETE FROM update_lock 
                WHERE name = 'index_daily_updater' 
                AND datetime(start_time) < datetime('now', :interval)
            """), {"interval": f'-{timeout_minutes} minutes'})
            conn.commit()
            res = conn.execute(text("""
                INSERT OR IGNORE INTO update_lock (name, pid, start_time)
                VALUES ('index_daily_updater', :pid, :start_time)
            """), {"pid": pid, "start_time": now_str})
            conn.commit()
            return res.rowcount != 0

    def _release_lock(self):
        with self.engine.connect() as conn:
            conn.execute(text("DELETE FROM update_lock WHERE name = 'index_daily_updater'"))
            conn.commit()

    def _record_checkpoint(self, ts_code):
        with self.engine.connect() as conn:
            conn.execute(text("""
                INSERT OR REPLACE INTO update_lock (name, pid, start_time, checkpoint)
                VALUES ('index_daily_checkpoint', :code, datetime('now'), :code)
            """), {"code": ts_code})
            conn.commit()

    def _get_checkpoint(self):
        with self.engine.connect() as conn:
            row = conn.execute(text("""
                SELECT checkpoint FROM update_lock WHERE name = 'index_daily_checkpoint'
            """)).fetchone()
            return row[0] if row else None

    def _clear_checkpoint(self):
        with self.engine.connect() as conn:
            conn.execute(text("DELETE FROM update_lock WHERE name = 'index_daily_checkpoint'"))
            conn.commit()

    def _should_skip_index(self, ts_code):
        with self.engine.connect() as conn:
            row = conn.execute(text("""
                SELECT skip_until FROM index_update_fail WHERE ts_code = :code
            """), {"code": ts_code}).fetchone()
            if row and row[0] and datetime.now().strftime('%Y-%m-%d') < row[0]:
                return True
        return False

    def _record_fail(self, ts_code):
        with self.engine.connect() as conn:
            row = conn.execute(text("SELECT fail_count FROM index_update_fail WHERE ts_code = :code"),
                               {"code": ts_code}).fetchone()
            fail_count = row[0] if row else 0
            fail_count += 1
            skip_until = None
            if fail_count >= 3:
                skip_until = (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')
                fail_count = 0
            conn.execute(text("""
                INSERT OR REPLACE INTO index_update_fail (ts_code, fail_count, last_fail_date, skip_until)
                VALUES (:code, :fail_count, :last_date, :skip_until)
            """), {"code": ts_code, "fail_count": fail_count,
                   "last_date": datetime.now().strftime('%Y-%m-%d'),
                   "skip_until": skip_until})
            conn.commit()

    def _record_success(self, ts_code):
        with self.engine.connect() as conn:
            conn.execute(text("DELETE FROM index_update_fail WHERE ts_code = :code"), {"code": ts_code})
            conn.commit()

    def _login_baostock(self) -> bool:
        for attempt in range(3):
            lg = bs.login()
            if lg.error_code == '0':
                self.log("登录成功")
                return True
            self.log(f"登录失败 (尝试 {attempt + 1}/3): {lg.error_msg}", "WARN")
            time.sleep(2)
        return False

    def _get_latest_trade_date(self):
        """获取最新交易日（使用 Baostock 交易日期查询）"""
        try:
            rs = bs.query_trade_dates(start_date="1990-01-01", end_date=datetime.now().strftime('%Y-%m-%d'))
            if rs.error_code != '0':
                raise Exception(rs.error_msg)
            dates = []
            while rs.next():
                dates.append(rs.get_row_data()[0])
            if not dates:
                raise Exception("No trade date found")
            last_date = dates[-1]
            now = datetime.now()
            if last_date == now.strftime('%Y-%m-%d') and now.hour < 17:
                if len(dates) >= 2:
                    return dates[-2]
            return last_date
        except Exception as e:
            self.log(f"获取最新交易日失败: {e}，使用昨天", "WARN")
            yesterday = datetime.now() - timedelta(days=1)
            return yesterday.strftime('%Y-%m-%d')

    def _fetch_index_data(self, bs_code, start_date, end_date):
        """使用 baostock 获取指数日线数据"""
        for attempt in range(self.max_retries):
            try:
                k_rs = bs.query_history_k_data_plus(
                    bs_code,
                    "date,open,high,low,close,volume,amount",
                    start_date=start_date,
                    end_date=end_date,
                    adjustflag='2'   # 前复权（指数无影响）
                )
                if k_rs.error_code != '0':
                    self.log(f"查询指数 {bs_code} 失败 (尝试 {attempt+1}/{self.max_retries}): {k_rs.error_msg}", "WARN")
                    time.sleep(1)
                    continue
                data_list = []
                while k_rs.next():
                    data_list.append(k_rs.get_row_data())
                if not data_list:
                    # 可能指数代码无效
                    return 'INVALID'
                df = pd.DataFrame(data_list,
                                  columns=['trade_date', 'open', 'high', 'low', 'close', 'vol', 'amount'])
                numeric_cols = ['open', 'high', 'low', 'close', 'vol', 'amount']
                for col in numeric_cols:
                    df[col] = pd.to_numeric(df[col], errors='coerce')
                # 单位转换：成交额千元 -> 元
                df['amount'] = df['amount'] * 1000.0
                # 成交量单位 Baostock 已经是手，无需转换
                return df
            except Exception as e:
                self.log(f"请求指数异常 (尝试 {attempt+1}/{self.max_retries}): {e}", "WARN")
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
            self.log(f"指数表最新日期={max_date}, 最新交易日={latest_trade}, 需要更新={need}")
            return need
        except Exception as e:
            self.log(f"needs_update 异常: {e}", "ERROR")
            return True

    def run(self, start_date='2010-01-01', end_date=None) -> tuple:
        if not self._acquire_lock():
            self.log("已有更新进程在运行，跳过本次更新")
            return False, "已有更新进程"

        try:
            if not self.needs_update():
                self.log("指数数据已是最新，无需更新")
                return True, "数据已最新"

            if not self._login_baostock():
                return False, "登录失败"

            if end_date is None:
                end_date = self._get_latest_trade_date()
            self.log(f"目标结束日期: {end_date}")

            # 准备需要更新的指数列表
            indices_to_update = []
            for bs_code, ts_code in self.index_list:
                existing_dates = self._get_existing_dates(ts_code)
                if existing_dates:
                    max_existing = max(existing_dates)
                    if max_existing >= end_date:
                        self.log(f"指数 {ts_code} 数据已到 {max_existing}，无需更新")
                        continue
                    start = (datetime.strptime(max_existing, '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d')
                else:
                    start = start_date
                indices_to_update.append((bs_code, ts_code, start))

            self.log(f"共 {len(indices_to_update)} 个指数需要更新")

            checkpoint = self._get_checkpoint()
            start_processing = False
            success_cnt = 0
            fail_cnt = 0
            skip_cnt = 0

            for idx, (bs_code, ts_code, start) in enumerate(indices_to_update):
                if checkpoint and not start_processing:
                    if ts_code == checkpoint:
                        start_processing = True
                    else:
                        continue
                if not start_processing:
                    start_processing = True

                if self._should_skip_index(ts_code):
                    self.log(f"[{idx+1}/{len(indices_to_update)}] 跳过 {ts_code}（临时失败标记）")
                    skip_cnt += 1
                    continue

                self.log(f"[{idx+1}/{len(indices_to_update)}] 更新 {ts_code} ({bs_code}) : {start} -> {end_date}")
                self._record_checkpoint(ts_code)

                result = self._fetch_index_data(bs_code, start, end_date)

                if result is None:
                    fail_cnt += 1
                    self.log(f"✗ 指数 {ts_code} 拉取失败")
                    self._record_fail(ts_code)
                elif isinstance(result, str) and result == 'INVALID':
                    self.log(f"✗ 指数代码 {bs_code} 无效，跳过")
                    skip_cnt += 1
                else:
                    df = result
                    df['ts_code'] = ts_code
                    existing = self._get_existing_dates(ts_code)
                    if existing:
                        df = df[~df['trade_date'].isin(existing)]
                    if df.empty:
                        self.log(f"✓ 指数 {ts_code} 无新数据")
                        self._record_success(ts_code)
                        continue

                    try:
                        df.to_sql(self.table_name, self.engine, if_exists='append', index=False, method='multi')
                        success_cnt += 1
                        self.log(f"✓ 写入 {len(df)} 条记录")
                        self._record_success(ts_code)
                    except Exception as e:
                        fail_cnt += 1
                        self.log(f"✗ 写入失败: {e}", "ERROR")
                        self._record_fail(ts_code)

                time.sleep(self.request_interval)

            bs.logout()
            self.log(f"更新完成: 成功 {success_cnt}, 失败 {fail_cnt}, 跳过 {skip_cnt}")
            self._clear_checkpoint()
            return True, f"成功 {success_cnt}, 失败 {fail_cnt}, 跳过 {skip_cnt}"
        finally:
            self._release_lock()


# ==================== 统一命令行入口 ====================
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="统一数据更新器 (Baostock数据源)")
    parser.add_argument("--type", required=True, choices=["stock", "index"], help="更新类型：stock=个股日线，index=指数日线")
    parser.add_argument("--start", default="2010-01-01", help="起始日期，仅对指数更新有效")
    parser.add_argument("--end", help="结束日期，仅对指数更新有效")
    parser.add_argument("--indices", nargs="+", help="自定义指数代码列表 (Tushare格式，如 000300.SH 000001.SH)")
    args = parser.parse_args()

    db_path = r'E:\Tquant1\tquant.db'
    engine = create_engine(f'sqlite:///{db_path}')

    if args.type == "stock":
        updater = StockDailyUpdater(engine)
        updater.run()
    else:  # index
        index_list = args.indices if args.indices else None
        updater = IndexDailyUpdater(engine, index_list=index_list)
        updater.run(start_date=args.start, end_date=args.end)