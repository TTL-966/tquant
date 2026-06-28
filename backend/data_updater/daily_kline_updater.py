#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
统一日线数据更新器
支持通过配置文件动态选择数据源（baostock / tushare）：
  - 个股日线（前复权）
  - 指数日线

用法：
  python daily_kline_updater.py --type stock
  python daily_kline_updater.py --type index
  python daily_kline_updater.py --type stock --source tushare
  python daily_kline_updater.py --type index --start 2020-01-01

配置：
  config.json 中的 data_source 和 tushare_token 字段
  Tushare 积分不足（<200）时自动降级为 Baostock
"""

import pandas as pd
import time
import os
import sys
import argparse
from datetime import datetime, timedelta
from sqlalchemy import text, create_engine

current_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.dirname(current_dir)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from base_updater import BaseUpdater
from config_manager import load_config, save_config


# ==================== 通知回调（由外部注入） ====================
_notify_callback = None


def set_notify_callback(cb):
    """注入前端通知回调，用于降级等事件通知。cb(source, message)"""
    global _notify_callback
    _notify_callback = cb


def _notify(message: str):
    if _notify_callback:
        try:
            _notify_callback("data_source", message)
        except Exception:
            pass
    # 同时写入降级通知文件，供 web_bridge 读取
    try:
        import json as _json
        notice_path = os.path.join(backend_dir, 'degradation_notice.json')
        with open(notice_path, 'w', encoding='utf-8') as _f:
            _json.dump({"message": message, "timestamp": datetime.now().isoformat()}, _f)
    except Exception:
        pass


# ==================== 数据源适配器基类 ====================
class DataSourceMixin:
    """数据源适配器基类，定义统一的数据获取接口。"""

    @property
    def source_name(self):
        raise NotImplementedError

    def login(self) -> bool:
        raise NotImplementedError

    def logout(self):
        pass

    # -- 个股 --
    def get_valid_stocks(self, trade_date=None) -> set:
        raise NotImplementedError

    def get_latest_trade_date(self, end_date=None) -> str:
        raise NotImplementedError

    def fetch_stock_data(self, source_code, start_date, end_date):
        """返回 DataFrame | None | 'INVALID'"""
        raise NotImplementedError

    def pure_code_to_source(self, pure_code: str) -> str:
        raise NotImplementedError

    def source_code_to_ts(self, source_code: str) -> str:
        raise NotImplementedError

    # -- 指数 --
    def fetch_index_data(self, source_code, start_date, end_date):
        """返回 DataFrame | None | 'INVALID'"""
        raise NotImplementedError

    def get_default_indices(self) -> list:
        """返回 [(source_code, ts_code), ...]"""
        raise NotImplementedError


# ==================== Tushare 数据获取器 ====================
class TushareFetcher(DataSourceMixin):
    def __init__(self, token: str):
        self.token = token
        self.low_integral = False
        import tushare as ts
        self.ts = ts
        self.ts.set_token(self.token)
        self.pro = self.ts.pro_api()

    @property
    def source_name(self):
        return "tushare"

    def login(self) -> bool:
        return True

    def check_integral(self) -> bool:
        """检查 Tushare 积分是否 >= 200。通过尝试最近几个交易日的前复权数据来判断。"""
        try:
            from datetime import datetime, timedelta
            pro = self.pro
            # 尝试最近 5 个交易日
            for i in range(1, 8):  # 最多尝试7天，确保覆盖周末
                test_date = (datetime.now() - timedelta(days=i)).strftime('%Y%m%d')
                try:
                    df = pro.daily(ts_code='000001.SZ', start_date=test_date, end_date=test_date, adj='qfq')
                    if df is not None and not df.empty:
                        self.low_integral = False
                        return True
                except Exception:
                    continue
            # 所有尝试都失败
            self.low_integral = True
            return False
        except Exception as e:
            self.low_integral = True
            return False

    # ---- 个股 ----
    def pure_code_to_source(self, pure_code: str) -> str:
        if pure_code.startswith(('6', '9')):
            return f"{pure_code}.SH"
        return f"{pure_code}.SZ"

    def source_code_to_ts(self, source_code: str) -> str:
        return source_code

    def get_valid_stocks(self, trade_date=None) -> set:
        try:
            df = self.pro.stock_basic(list_status='L', fields='ts_code')
            if df is None or df.empty:
                return set()
            return {code.split('.')[0] for code in df['ts_code']}
        except Exception:
            return set()

    def get_latest_trade_date(self, end_date=None) -> str:
        if end_date is None:
            end_date = datetime.now().strftime('%Y-%m-%d')
        end_date_yyyymmdd = end_date.replace('-', '')
        try:
            df = self.pro.trade_cal(exchange='SSE', start_date='19900101',
                                     end_date=end_date_yyyymmdd)
            if df is None or df.empty:
                raise Exception("No trade calendar")
            trade_dates = df[df['is_open'] == 1]['cal_date'].tolist()
            if not trade_dates:
                raise Exception("No open trade date")
            trade_dates.sort()
            last = trade_dates[-1]
            last_date = f"{last[:4]}-{last[4:6]}-{last[6:8]}"
            now = datetime.now()
            if last_date == now.strftime('%Y-%m-%d'):
                if now.hour < 17 or (now.hour == 17 and now.minute < 30):
                    if len(trade_dates) >= 2:
                        prev = trade_dates[-2]
                        return f"{prev[:4]}-{prev[4:6]}-{prev[6:8]}"
            return last_date
        except Exception:
            dt = datetime.strptime(end_date, '%Y-%m-%d')
            while True:
                if dt.weekday() >= 5:
                    dt -= timedelta(days=1)
                    continue
                if dt.date() == datetime.now().date():
                    now = datetime.now()
                    if now.hour < 17 or (now.hour == 17 and now.minute < 30):
                        dt -= timedelta(days=1)
                        continue
                break
            return dt.strftime('%Y-%m-%d')

    def fetch_stock_data(self, ts_code, start_date, end_date, skip_turnover=False):
        for attempt in range(2):
            try:
                df = self.ts.pro_bar(
                    ts_code=ts_code, adj='qfq',
                    start_date=start_date, end_date=end_date,
                    factors=['tor', 'vr']
                )
                if df is None or df.empty:
                    check_df = self.ts.pro_bar(
                        ts_code=ts_code, adj='qfq',
                        start_date='19900101', end_date=end_date, limit=1
                    )
                    if check_df is None or check_df.empty:
                        return 'INVALID'
                    return None

                df['trade_date'] = pd.to_datetime(
                    df['trade_date'], format='%Y%m%d'
                ).dt.strftime('%Y-%m-%d')
                if 'amount' in df.columns:
                    df['amount'] = df['amount'] * 1000
                if 'vol' in df.columns:
                    df['vol'] = df['vol'] * 100

                required = ['trade_date', 'open', 'high', 'low', 'close', 'vol', 'amount']
                for col in required:
                    if col not in df.columns:
                        df[col] = pd.NA
                df = df[required]
                for col in ['open', 'high', 'low', 'close', 'vol', 'amount']:
                    df[col] = pd.to_numeric(df[col], errors='coerce')

                # 换手率：可由外部批量获取后合并，也可单独请求
                if not skip_turnover:
                    tun = self._fetch_single_turnover(ts_code, start_date, end_date)
                    if tun is not None and not tun.empty:
                        df = df.merge(tun, on='trade_date', how='left')
                    else:
                        df['turnover_rate_f'] = None
                else:
                    df['turnover_rate_f'] = None

                return df
            except Exception:
                time.sleep(1)
        return None

    def _fetch_single_turnover(self, ts_code, start_date, end_date):
        """获取单只股票的换手率数据。"""
        try:
            bf = self.pro.daily_basic(
                ts_code=ts_code,
                start_date=start_date.replace('-', ''),
                end_date=end_date.replace('-', ''),
                fields='trade_date,turnover_rate_f'
            )
            if bf is not None and not bf.empty:
                bf['trade_date'] = pd.to_datetime(
                    bf['trade_date'], format='%Y%m%d'
                ).dt.strftime('%Y-%m-%d')
                return bf[['trade_date', 'turnover_rate_f']]
        except Exception as e:
            print(f"获取换手率失败 {ts_code}: {e}")
        return None

    def fetch_batch_turnover(self, stock_date_ranges):
        """批量获取多只股票的换手率，使用 Tushare 多代码批量接口。
        stock_date_ranges: list of (ts_code, start_date, end_date)
        返回 dict: {(ts_code, trade_date): turnover_rate_f}
        每批最多 200 只股票，批次间隔 0.2 秒。
        批量失败时降级为单只重试。
        """
        if not stock_date_ranges:
            return {}

        result = {}
        BATCH_SIZE = 200

        # 按股票去重，合并日期范围（取最小 start，最大 end）
        stock_range_map = {}  # ts_code -> (min_start, max_end)
        for ts_code, start, end in stock_date_ranges:
            if ts_code not in stock_range_map:
                stock_range_map[ts_code] = (start, end)
            else:
                old_start, old_end = stock_range_map[ts_code]
                stock_range_map[ts_code] = (min(old_start, start), max(old_end, end))

        codes = list(stock_range_map.keys())
        total_codes = len(codes)
        batches = [codes[i:i + BATCH_SIZE] for i in range(0, len(codes), BATCH_SIZE)]

        for bi, batch_codes in enumerate(batches):
            # 计算本批次的日期范围（取最宽的覆盖）
            min_start = min(stock_range_map[c][0] for c in batch_codes)
            max_end = max(stock_range_map[c][1] for c in batch_codes)
            ts_code_str = ','.join(batch_codes)

            try:
                bf = self.pro.daily_basic(
                    ts_code=ts_code_str,
                    start_date=min_start.replace('-', ''),
                    end_date=max_end.replace('-', ''),
                    fields='ts_code,trade_date,turnover_rate_f'
                )
                if bf is not None and not bf.empty:
                    bf['trade_date'] = pd.to_datetime(
                        bf['trade_date'], format='%Y%m%d'
                    ).dt.strftime('%Y-%m-%d')
                    for _, row in bf.iterrows():
                        result[(row['ts_code'], row['trade_date'])] = row['turnover_rate_f']
                    done = min((bi + 1) * BATCH_SIZE, total_codes)
                    print(f"[Turnover] 已获取 {done} 只股票 ({done}/{total_codes})")
                else:
                    # 批量返回空，降级为单只重试
                    print(f"[Turnover] 批次 {bi+1} 批量返回空，降级单只重试 ({len(batch_codes)} 只)")
                    for ts_code in batch_codes:
                        self._retry_single_turnover(ts_code, stock_range_map[ts_code], result)
            except Exception as e:
                print(f"[Turnover] 批次 {bi+1} 批量失败: {e}，降级单只重试 ({len(batch_codes)} 只)")
                for ts_code in batch_codes:
                    self._retry_single_turnover(ts_code, stock_range_map[ts_code], result)

            if bi < len(batches) - 1:
                time.sleep(0.2)

        return result

    def _retry_single_turnover(self, ts_code, date_range, result):
        """单只股票换手率获取（批量失败时的降级方案）。"""
        try:
            start, end = date_range
            bf = self.pro.daily_basic(
                ts_code=ts_code,
                start_date=start.replace('-', ''),
                end_date=end.replace('-', ''),
                fields='trade_date,turnover_rate_f'
            )
            if bf is not None and not bf.empty:
                bf['trade_date'] = pd.to_datetime(
                    bf['trade_date'], format='%Y%m%d'
                ).dt.strftime('%Y-%m-%d')
                for _, row in bf.iterrows():
                    result[(ts_code, row['trade_date'])] = row['turnover_rate_f']
            time.sleep(0.3)
        except Exception as e:
            print(f"获取换手率失败 {ts_code}: {e}")

    # ---- 指数 ----
    def get_default_indices(self) -> list:
        return [
            ('000300.SH', '000300.SH'),
            ('000001.SH', '000001.SH'),
            ('399001.SZ', '399001.SZ'),
            ('000905.SH', '000905.SH'),
            ('399006.SZ', '399006.SZ'),
            ('000016.SH', '000016.SH'),
            ('399330.SZ', '399330.SZ'),
            ('000852.SH', '000852.SH'),
        ]

    def fetch_index_data(self, ts_code, start_date, end_date):
        for attempt in range(2):
            try:
                start = start_date.replace('-', '')
                end = end_date.replace('-', '')
                df = self.pro.index_daily(ts_code=ts_code, start_date=start, end_date=end)
                if df is None or df.empty:
                    return 'INVALID'
                df['trade_date'] = pd.to_datetime(
                    df['trade_date'], format='%Y%m%d'
                ).dt.strftime('%Y-%m-%d')
                if 'amount' in df.columns:
                    df['amount'] = df['amount'] * 1000.0
                required = ['trade_date', 'open', 'high', 'low', 'close', 'vol', 'amount']
                for col in required:
                    if col not in df.columns:
                        df[col] = pd.NA
                df = df[required]
                for col in ['open', 'high', 'low', 'close', 'vol', 'amount']:
                    df[col] = pd.to_numeric(df[col], errors='coerce')
                return df
            except Exception:
                time.sleep(1)
        return None


# ==================== Baostock 数据获取器 ====================
class BaostockFetcher(DataSourceMixin):
    def __init__(self):
        import baostock as bs
        self.bs = bs

    @property
    def source_name(self):
        return "baostock"

    def login(self) -> bool:
        for attempt in range(3):
            lg = self.bs.login()
            if lg.error_code == '0':
                return True
            time.sleep(2)
        return False

    def logout(self):
        try:
            self.bs.logout()
        except Exception:
            pass

    # ---- 个股 ----
    def pure_code_to_source(self, pure_code: str) -> str:
        if pure_code.startswith(('6', '9')):
            return f"sh.{pure_code}"
        return f"sz.{pure_code}"

    def source_code_to_ts(self, source_code: str) -> str:
        parts = source_code.split('.')
        if len(parts) == 2:
            suffix = parts[0].upper()
            return f"{parts[1]}.{suffix}"
        return source_code

    def get_valid_stocks(self, trade_date=None) -> set:
        if trade_date is None:
            trade_date = datetime.now().strftime('%Y-%m-%d')
        try:
            rs = self.bs.query_all_stock(day=trade_date)
            if rs.error_code != '0':
                return set()
            valid = set()
            while rs.next():
                code = rs.get_row_data()[0]
                pure = code.split('.')[1]
                valid.add(pure)
            return valid
        except Exception:
            return set()

    def get_latest_trade_date(self, end_date=None) -> str:
        if end_date is None:
            end_date = datetime.now().strftime('%Y-%m-%d')
        try:
            rs = self.bs.query_trade_dates(start_date="1990-01-01", end_date=end_date)
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
                    now = datetime.now()
                    if now.hour < 17 or (now.hour == 17 and now.minute < 30):
                        dt -= timedelta(days=1)
                        continue
                break
            return dt.strftime('%Y-%m-%d')

    def fetch_stock_data(self, bs_code, start_date, end_date, skip_turnover=False):
        for attempt in range(2):
            try:
                k_rs = self.bs.query_history_k_data_plus(
                    bs_code,
                    "date,open,high,low,close,volume,amount,turn",
                    start_date=start_date, end_date=end_date,
                    adjustflag='2'
                )
                if k_rs.error_code != '0':
                    time.sleep(1)
                    continue
                data_list = []
                while k_rs.next():
                    data_list.append(k_rs.get_row_data())
                if not data_list:
                    check_rs = self.bs.query_history_k_data_plus(
                        bs_code, "date",
                        start_date="1990-01-01",
                        end_date=datetime.now().strftime('%Y-%m-%d'),
                        adjustflag='2'
                    )
                    has_any = False
                    while check_rs.next():
                        has_any = True
                        break
                    return 'INVALID' if not has_any else None

                df = pd.DataFrame(
                    data_list,
                    columns=['trade_date', 'open', 'high', 'low', 'close', 'vol', 'amount','turn']
                )
                for col in ['open', 'high', 'low', 'close', 'vol', 'amount']:
                    df[col] = pd.to_numeric(df[col], errors='coerce')
                df['amount'] = df['amount'] * 1000.0
                df['turnover_rate_f'] = pd.to_numeric(df['turn'], errors='coerce')
                df.drop('turn', axis=1, inplace=True)
                return df
            except Exception:
                time.sleep(1)
        return None

    # ---- 指数 ----
    def get_default_indices(self) -> list:
        return [
            ('sh.000300', '000300.SH'),
            ('sh.000001', '000001.SH'),
            ('sz.399001', '399001.SZ'),
            ('sh.000905', '000905.SH'),
            ('sz.399006', '399006.SZ'),
            ('sh.000016', '000016.SH'),
            ('sz.399330', '399330.SZ'),
            ('sh.000852', '000852.SH'),
        ]

    def fetch_index_data(self, bs_code, start_date, end_date):
        for attempt in range(2):
            try:
                k_rs = self.bs.query_history_k_data_plus(
                    bs_code,
                    "date,open,high,low,close,volume,amount",
                    start_date=start_date, end_date=end_date,
                    adjustflag='2'
                )
                if k_rs.error_code != '0':
                    time.sleep(1)
                    continue
                data_list = []
                while k_rs.next():
                    data_list.append(k_rs.get_row_data())
                if not data_list:
                    return 'INVALID'
                df = pd.DataFrame(
                    data_list,
                    columns=['trade_date', 'open', 'high', 'low', 'close', 'vol', 'amount']
                )
                for col in ['open', 'high', 'low', 'close', 'vol', 'amount']:
                    df[col] = pd.to_numeric(df[col], errors='coerce')
                df['amount'] = df['amount'] * 1000.0
                return df
            except Exception:
                time.sleep(1)
        return None


# ==================== Fetcher 工厂函数 ====================
def create_fetcher(source: str = None, token: str = None, auto_degrade: bool = True):
    """根据配置创建数据源获取器。

    Args:
        source: 数据源名称 ('baostock' / 'tushare')，为 None 时从配置文件读取
        token: Tushare Token，为 None 时从配置文件读取
        auto_degrade: Tushare 积分不足时是否自动降级为 Baostock

    Returns:
        DataSourceMixin 实例
    """
    config = load_config()
    source = source or config.get('data_source', 'baostock')

    if source == 'tushare':
        token = token or config.get('tushare_token', '')
        if not token:
            print("[daily_kline_updater] Tushare Token 未配置，降级为 Baostock")
            return BaostockFetcher()
        fetcher = TushareFetcher(token)
        if auto_degrade and not fetcher.check_integral():
            print("[daily_kline_updater] WARNING: Tushare 积分不足200，本次运行时自动切换为 Baostock 数据源")
            # 不再修改 config.json，只返回 BaostockFetcher 临时使用
            _notify("数据源临时降级为 Baostock（Tushare 积分不足），您的配置仍为 Tushare")
            return BaostockFetcher()
        return fetcher
    return BaostockFetcher()


# ==================== 个股日线更新器 ====================
class StockDailyUpdater(BaseUpdater):
    def __init__(self, db_engine, fetcher=None, source=None, token=None):
        super().__init__("daily_kline")
        self.engine = db_engine
        self.table_name = 'stock_daily_qfq_with_name'
        self.request_interval = 0.1
        self.max_retries = 2

        if fetcher is not None:
            self.fetcher = fetcher
        else:
            self.fetcher = create_fetcher(source=source, token=token)

        if self.fetcher.source_name == 'tushare':
            self.request_interval = 0.1
        else:
            self.request_interval = 0.5

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
            # 1. 检查全局最大日期
            sql_max = f"SELECT MAX(trade_date) as max_date FROM {self.table_name}"
            result = pd.read_sql(sql_max, self.engine)
            max_date = result.iloc[0, 0]
            if max_date is None:
                return True

            latest_trade = self.fetcher.get_latest_trade_date()
            # 如果全局最大日期小于最新交易日，肯定需要更新
            if max_date < latest_trade:
                return True

            # 2. 即使全局最大日期已是最新，仍可能有部分股票落后（如停牌后复牌、上次更新失败等）
            sql_unfinished = f"""
                SELECT COUNT(*) FROM (
                    SELECT REPLACE(REPLACE(ts_code, '.SH', ''), '.SZ', '') as code,
                           MAX(trade_date) as max_date
                    FROM {self.table_name}
                    GROUP BY code
                ) t
                WHERE t.max_date < :latest_trade
            """
            count = pd.read_sql(sql_unfinished, self.engine, params={"latest_trade": latest_trade}).iloc[0, 0]
            if count > 0:
                self.log(f"全局最新日期已达 {max_date}，但仍有 {count} 只股票未更新到最新，继续更新")
                return True

            self.log("所有股票数据已是最新，无需更新")
            return False
        except Exception as e:
            self.log(f"needs_update 异常: {e}", "ERROR")
            return True

    def _write_progress(self, status, total_stocks=0, current_stock=0, step="", percent=0):
        """写入更新进度文件，供前端轮询读取。打包模式下写入临时目录确保可写。"""
        try:
            import json as _json
            from backend.config_manager import get_progress_path
            progress_path = get_progress_path()
            data = {
                "status": status,
                "total_stocks": total_stocks,
                "current_stock": current_stock,
                "step": step,
                "percent": percent,
                "timestamp": datetime.now().isoformat()
            }
            with open(progress_path, 'w', encoding='utf-8') as f:
                _json.dump(data, f)
        except Exception:
            pass

    def run(self) -> tuple:
        if not self._acquire_lock():
            print("获取锁失败")
            self.log("已有更新进程在运行，跳过本次更新")
            return False, "已有更新进程"

        try:
            # 读取更新选项
            options = getattr(self, '_update_options', None)
            if options is None:
                config = load_config()
                options = config.get('update_options', {})
            update_kline = options.get('update_kline', True)
            update_turnover = options.get('update_turnover', False)
            max_days_back = int(options.get('max_days_back', 0))

            if not update_kline and not update_turnover:
                return False, "未选择任何更新任务"

            if not self.needs_update():
                self.log("数据已是最新，无需更新")
                self._write_progress("done", 0, 0, "idle", 100)
                return True, "数据已是最新，跳过更新"

            checkpoint = self._get_checkpoint()
            if checkpoint:
                self.log(f"检测到未完成的更新，从断点 {checkpoint} 继续")

            if not self.fetcher.login():
                self._write_progress("error", 0, 0, "login", 0)
                return False, "登录失败"

            today_natural = datetime.now().strftime('%Y-%m-%d')
            latest_trade_date = self.fetcher.get_latest_trade_date(today_natural)

            dt = datetime.strptime(latest_trade_date, '%Y-%m-%d')
            if dt.weekday() >= 5:
                days_back = dt.weekday() - 4
                dt -= timedelta(days=days_back)
                latest_trade_date = dt.strftime('%Y-%m-%d')
                self.log(f"检测到周末日期，已自动修正为上一个交易日: {latest_trade_date}", "INFO")
            self.log(f"当前自然日: {today_natural}, 最新交易日: {latest_trade_date}")
            self.log(f"数据源: {self.fetcher.source_name}")
            self.log(f"更新选项: K线={update_kline}, 换手率={update_turnover}, 最多天数={max_days_back}")

            self._write_progress("running", 0, 0, "init", 0)

            self.log("获取有效股票列表...")
            valid_stocks = self.fetcher.get_valid_stocks(trade_date=latest_trade_date)
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
                self._write_progress("error", 0, 0, "query", 0)
                return False, "无股票数据"

            if valid_stocks:
                original_count = len(df_latest)
                delisted_codes = df_latest[~df_latest['code'].isin(valid_stocks)]['code']
                for dc in delisted_codes:
                    if not self._should_skip_stock(dc):
                        self._permanent_skip(dc)
                df_latest = df_latest[df_latest['code'].isin(valid_stocks)]
                self.log(f"过滤后剩余 {len(df_latest)} 只股票（原 {original_count} 只，移除了 {len(delisted_codes)} 只无效/退市股）")

            end_date = latest_trade_date

            # 应用 max_days_back：限制每只股票的起始日期
            if max_days_back > 0:
                start_limit_dt = datetime.strptime(latest_trade_date, '%Y-%m-%d') - timedelta(days=max_days_back)
                start_limit = start_limit_dt.strftime('%Y-%m-%d')
                self.log(f"max_days_back={max_days_back}，起始日期限制: {start_limit}")
            else:
                start_limit = None

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
            skip_recent = 0
            total = len(df_latest)
            start_processing = False

            self._write_progress("running", total, 0, "kline", 0)

            # ---- 阶段 1: 收集换手率请求（仅在 update_turnover=True 时） ----
            turnover_requests = []
            if update_turnover and self.fetcher.source_name == 'tushare':
                for idx, row in df_latest.iterrows():
                    code = row['code']
                    max_date = row['max_date']
                    if self._should_skip_stock(code):
                        continue
                    if checkpoint and code < (checkpoint or ''):
                        continue
                    if max_date is None or pd.isna(max_date):
                        st = (datetime.now() - timedelta(days=365)).strftime('%Y-%m-%d')
                    else:
                        st_dt = datetime.strptime(max_date, '%Y-%m-%d') + timedelta(days=1)
                        st = st_dt.strftime('%Y-%m-%d')
                    if st > end_date:
                        continue
                    if start_limit and st < start_limit:
                        st = start_limit
                    if st > end_date:
                        continue
                    source_code = self.fetcher.pure_code_to_source(code)
                    ts_code = self.fetcher.source_code_to_ts(source_code)
                    turnover_requests.append((ts_code, st, end_date))

            # ---- 阶段 2: 批量获取换手率 ----
            turnover_map = {}
            if update_turnover and turnover_requests and hasattr(self.fetcher, 'fetch_batch_turnover'):
                self.log(f"开始批量获取换手率，共 {len(turnover_requests)} 只股票...")
                self._write_progress("running", total, 0, "turnover", 0)
                turnover_map = self.fetcher.fetch_batch_turnover(turnover_requests)
                self.log(f"换手率批量获取完成，共获取 {len(turnover_map)} 条记录")

            # ---- 阶段 3: 逐只股票更新K线 ----
            if update_kline:
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

                    # 应用 max_days_back 起始限制
                    if start_limit and start_date < start_limit:
                        start_date = start_limit

                    if start_date > end_date:
                        skip_recent += 1
                        continue

                    source_code = self.fetcher.pure_code_to_source(code)
                    ts_code = self.fetcher.source_code_to_ts(source_code)

                    skip_turnover = not update_turnover or self.fetcher.source_name != 'tushare'

                    self._record_checkpoint(code)

                    result = self.fetcher.fetch_stock_data(source_code, start_date, end_date, skip_turnover=skip_turnover)

                    if result is None:
                        fail += 1
                        self.log(f"[{idx + 1}/{total}] ✗ {code} 查询失败或无数据")
                        self._record_fail(code, is_permanent=False)
                    elif isinstance(result, str) and result == 'INVALID':
                        skip_invalid += 1
                        self.log(f"[{idx + 1}/{total}] ✗ {code} 无效股票，永久跳过")
                        self._record_fail(code, is_permanent=True)
                    else:
                        df = result
                        df['ts_code'] = ts_code
                        df['name'] = name_dict.get(code, None)
                        # 从批量换手率映射中补充 turnover_rate_f
                        turnover_col = []
                        for td in df['trade_date']:
                            key = (ts_code, str(td))
                            turnover_col.append(turnover_map.get(key, None))
                        df['turnover_rate_f'] = turnover_col
                        cols = ['trade_date', 'open', 'high', 'low', 'close', 'vol', 'amount', 'turnover_rate_f', 'ts_code',
                                'name']
                        for col in cols:
                            if col not in df.columns:
                                df[col] = None
                        df = df[cols]

                        existing_dates = self._get_existing_dates(ts_code)
                        if existing_dates:
                            df = df[~df['trade_date'].isin(existing_dates)]
                        if df.empty:
                            skip_duplicate += 1
                            self._record_success(code)
                            continue

                        try:
                            df.to_sql(self.table_name, self.engine, if_exists='append',
                                      index=False, method='multi')
                            success += 1
                            self._record_success(code)
                        except Exception as e:
                            fail += 1
                            self.log(f"[{idx + 1}/{total}] ✗ {code} 写入失败: {e}", "ERROR")
                            self._record_fail(code, is_permanent=False)

                    processed = success + fail + skip_invalid + skip_duplicate + skip_recent
                    # 每 100 只输出进度日志，更新进度文件
                    if processed % 100 == 0 or processed == total:
                        pct = int(processed / total * 100) if total > 0 else 100
                        self.log(f"[进度] {processed}/{total} ({pct}%) 成功={success} 失败={fail}")
                        self._write_progress("running", total, processed, "kline", pct)

                    time.sleep(self.request_interval)

            self.fetcher.logout()
            self.log(f"更新完成: 成功 {success}, 失败 {fail}, 跳过无效 {skip_invalid}, 跳过重复 {skip_duplicate}, 跳过近期 {skip_recent}")
            self._write_progress("done", total, total, "complete", 100)
            self._clear_checkpoint()
            return True, f"成功 {success}, 失败 {fail}, 跳过无效 {skip_invalid}, 跳过重复 {skip_duplicate}"
        finally:
            self._release_lock()


# ==================== 指数日线更新器 ====================
class IndexDailyUpdater(BaseUpdater):
    def __init__(self, db_engine, fetcher=None, source=None, token=None, index_list=None):
        super().__init__("index_daily_updater")
        self.engine = db_engine
        self.table_name = 'index_daily'
        self.max_retries = 2

        if fetcher is not None:
            self.fetcher = fetcher
        else:
            self.fetcher = create_fetcher(source=source, token=token)

        if self.fetcher.source_name == 'tushare':
            self.request_interval = 0.5
        else:
            self.request_interval = 0.5

        if index_list is not None:
            # 用户传入 ts_code 列表，转换为 (source_code, ts_code) 元组
            if isinstance(index_list[0], (list, tuple)):
                self.index_list = index_list
            else:
                # ts_code 列表
                self.index_list = []
                for ts_code in index_list:
                    if self.fetcher.source_name == 'baostock':
                        pure = ts_code.replace('.SH', '').replace('.SZ', '')
                        if ts_code.endswith('.SH'):
                            self.index_list.append((f"sh.{pure}", ts_code))
                        else:
                            self.index_list.append((f"sz.{pure}", ts_code))
                    else:
                        self.index_list.append((ts_code, ts_code))
        else:
            self.index_list = self.fetcher.get_default_indices()

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
            row = conn.execute(text(
                "SELECT fail_count FROM index_update_fail WHERE ts_code = :code"
            ), {"code": ts_code}).fetchone()
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
            latest_trade = self.fetcher.get_latest_trade_date()
            need = datetime.strptime(max_date, '%Y-%m-%d').date() < \
                   datetime.strptime(latest_trade, '%Y-%m-%d').date()
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
            if end_date is None:
                end_date = self.fetcher.get_latest_trade_date()

            if not self.needs_update():
                self.log("指数数据已是最新，无需更新")
                return True, "数据已最新"

            if not self.fetcher.login():
                return False, "登录失败"

            self.log(f"目标结束日期: {end_date}")
            self.log(f"数据源: {self.fetcher.source_name}")

            indices_to_update = []
            for source_code, ts_code in self.index_list:
                existing_dates = self._get_existing_dates(ts_code)
                if existing_dates:
                    max_existing = max(existing_dates)
                    if max_existing >= end_date:
                        self.log(f"指数 {ts_code} 数据已到 {max_existing}，无需更新")
                        continue
                    start = (datetime.strptime(max_existing, '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d')
                else:
                    start = start_date
                indices_to_update.append((source_code, ts_code, start))

            self.log(f"共 {len(indices_to_update)} 个指数需要更新")

            checkpoint = self._get_checkpoint()
            start_processing = False
            success_cnt = 0
            fail_cnt = 0
            skip_cnt = 0

            for idx, (source_code, ts_code, start) in enumerate(indices_to_update):
                if checkpoint and not start_processing:
                    if ts_code == checkpoint:
                        start_processing = True
                    else:
                        continue
                if not start_processing:
                    start_processing = True

                if self._should_skip_index(ts_code):
                    self.log(f"[{idx + 1}/{len(indices_to_update)}] 跳过 {ts_code}（临时失败标记）")
                    skip_cnt += 1
                    continue

                self.log(f"[{idx + 1}/{len(indices_to_update)}] 更新 {ts_code} : {start} -> {end_date}")
                self._record_checkpoint(ts_code)

                result = self.fetcher.fetch_index_data(source_code, start, end_date)

                if result is None:
                    fail_cnt += 1
                    self.log(f"✗ 指数 {ts_code} 拉取失败")
                    self._record_fail(ts_code)
                elif isinstance(result, str) and result == 'INVALID':
                    self.log(f"✗ 指数代码 {source_code} 无效，跳过")
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
                        df.to_sql(self.table_name, self.engine, if_exists='append',
                                  index=False, method='multi')
                        success_cnt += 1
                        self.log(f"✓ 写入 {len(df)} 条记录")
                        self._record_success(ts_code)
                    except Exception as e:
                        fail_cnt += 1
                        self.log(f"✗ 写入失败: {e}", "ERROR")
                        self._record_fail(ts_code)

                time.sleep(self.request_interval)

            self.fetcher.logout()
            self.log(f"更新完成: 成功 {success_cnt}, 失败 {fail_cnt}, 跳过 {skip_cnt}")
            self._clear_checkpoint()
            return True, f"成功 {success_cnt}, 失败 {fail_cnt}, 跳过 {skip_cnt}"
        finally:
            self._release_lock()


# ==================== 统一命令行入口 ====================
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="统一数据更新器（个股/指数）")
    parser.add_argument("--type", required=True, choices=["stock", "index"],
                        help="更新类型：stock=个股日线，index=指数日线")
    parser.add_argument("--source", default=None, choices=["baostock", "tushare"],
                        help="数据源（可选，默认使用配置文件设置）")
    parser.add_argument("--token", default=None,
                        help="Tushare Token（可选，默认使用配置文件设置）")
    parser.add_argument("--start", default="2010-01-01",
                        help="起始日期，仅对指数更新有效")
    parser.add_argument("--end", help="结束日期，仅对指数更新有效")
    parser.add_argument("--indices", nargs="+",
                        help="自定义指数代码列表，仅对指数更新有效，如 000300.SH 000001.SH")
    parser.add_argument("--no-degrade", action="store_true",
                        help="禁止自动降级（积分不足时直接报错而非切换数据源）")
    parser.add_argument("--options", default=None,
                        help="更新选项 JSON 文件路径，包含 update_kline/update_turnover/max_days_back")
    args = parser.parse_args()

    # 加载更新选项
    update_options = None
    if args.options:
        import json as _json
        try:
            with open(args.options, 'r', encoding='utf-8') as _f:
                update_options = _json.load(_f)
            print(f"加载更新选项: {update_options}")
        except Exception as e:
            print(f"WARNING: 无法加载更新选项文件 {args.options}: {e}")

    # 数据库路径：兼容 dev 和 PyInstaller 打包模式
    if getattr(sys, 'frozen', False):
        db_path = os.path.join(os.path.dirname(sys.executable), 'tquant.db')
    else:
        db_path = os.path.join(os.path.dirname(backend_dir), 'tquant.db')
    engine = create_engine(f'sqlite:///{db_path}')

    fetcher = create_fetcher(source=args.source, token=args.token,
                              auto_degrade=not args.no_degrade)
    print(f"使用数据源: {fetcher.source_name}")

    if args.type == "stock":
        updater = StockDailyUpdater(engine, fetcher=fetcher)
        if update_options:
            updater._update_options = update_options
        success, msg = updater._safe_run()
    else:
        index_list = args.indices if args.indices else None
        updater = IndexDailyUpdater(engine, fetcher=fetcher, index_list=index_list)
        success, msg = updater._safe_run(start_date=args.start, end_date=args.end)

    sys.exit(0 if success else 1)
