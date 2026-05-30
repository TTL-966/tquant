"""
指数日线数据更新器
用途：下载沪深300、上证指数等主要指数的日K线数据（从2010年至今）
存储表：index_daily
字段：ts_code, trade_date, open, high, low, close, vol, amount
单位：vol（手），amount（千元 → 转换为元，与个股保持一致）
"""

import pandas as pd
import time
import os
import sys
import argparse
from datetime import datetime, timedelta
from sqlalchemy import text, create_engine
import tushare as ts

# 确保能导入 backend 模块
# 如果当前脚本在 backend/data_updater 下，则将 backend 的父目录加入 sys.path
current_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.dirname(current_dir)   # backend 目录
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from base_updater import BaseUpdater   # 现在可以正确导入


class IndexDailyUpdater(BaseUpdater):
    def __init__(self, db_engine, token="05790ffb76982fbf877806ccacae6964e72be8f361bbf702e0ad13d4",
                 index_list=None):
        """
        :param db_engine: SQLAlchemy 数据库引擎
        :param token: Tushare token
        :param index_list: 要下载的指数代码列表（默认：主要A股指数）
        """
        super().__init__("index_daily_updater")
        self.engine = db_engine
        self.table_name = 'index_daily'
        self.request_interval = 0.5   # 指数较少，间隔稍长避免被封
        self.max_retries = 2
        self.token = token
        ts.set_token(self.token)
        self.pro = ts.pro_api()

        # 默认指数列表（Tushare 代码格式）
        if index_list is None:
            self.index_list = [
                '000300.SH',   # 沪深300
                '000001.SH',   # 上证指数
                '399001.SZ',   # 深证成指
                '000905.SH',   # 中证500
                '399006.SZ',   # 创业板指
                '000016.SH',   # 上证50
                '399330.SZ',   # 深证100
                '000852.SH',   # 中证1000
            ]
        else:
            self.index_list = index_list

        self._init_table()
        self._init_lock_table()
        self._init_fail_table()

    def _init_table(self):
        """创建指数日线表（如果不存在）"""
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
        """锁表（与个股更新器共用 update_lock，但使用不同的 name）"""
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
        """失败记录表（简化版，记录指数拉取失败）"""
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
        timeout_minutes = 30   # 指数少，超时短一些
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

    def _get_latest_trade_date(self):
        """获取最新交易日（使用交易日历）"""
        today = datetime.now().strftime('%Y%m%d')
        try:
            df = self.pro.trade_cal(exchange='SSE', start_date='19900101', end_date=today)
            if df.empty:
                raise Exception("No trade calendar")
            trade_dates = df[df['is_open'] == 1]['cal_date'].tolist()
            if not trade_dates:
                raise Exception("No open trade date")
            trade_dates.sort()
            last = trade_dates[-1]
            return f"{last[:4]}-{last[4:6]}-{last[6:8]}"
        except Exception as e:
            self.log(f"获取最新交易日失败: {e}，使用昨天", "WARN")
            yesterday = datetime.now() - timedelta(days=1)
            return yesterday.strftime('%Y-%m-%d')

    def _fetch_index_data(self, ts_code, start_date, end_date):
        """使用 tushare index_daily 获取指数日线数据"""
        for attempt in range(self.max_retries):
            try:
                # 注意：index_daily 的 start_date/end_date 格式为 YYYYMMDD
                start = start_date.replace('-', '')
                end = end_date.replace('-', '')
                df = self.pro.index_daily(ts_code=ts_code, start_date=start, end_date=end)
                if df is None or df.empty:
                    # 无数据可能是代码无效
                    return 'INVALID'

                # 日期格式转换：YYYYMMDD -> YYYY-MM-DD
                df['trade_date'] = pd.to_datetime(df['trade_date'], format='%Y%m%d').dt.strftime('%Y-%m-%d')

                # 单位转换：tushare 指数 amount 单位是“千元”，转换为“元”（与个股保持一致）
                if 'amount' in df.columns:
                    df['amount'] = df['amount'] * 1000.0

                # vol 单位已经是“手”，不需转换
                # 保留字段：open, high, low, close, vol, amount
                required = ['trade_date', 'open', 'high', 'low', 'close', 'vol', 'amount']
                for col in required:
                    if col not in df.columns:
                        df[col] = pd.NA
                df = df[required]

                # 数值类型转换
                for col in ['open', 'high', 'low', 'close', 'vol', 'amount']:
                    df[col] = pd.to_numeric(df[col], errors='coerce')

                return df
            except Exception as e:
                self.log(f"请求指数 {ts_code} 异常 (尝试 {attempt+1}/{self.max_retries}): {e}", "WARN")
                time.sleep(1)
        return None

    def _get_existing_dates(self, ts_code):
        """获取表中已存在的交易日期（用于增量更新）"""
        try:
            existing = pd.read_sql(
                f"SELECT trade_date FROM {self.table_name} WHERE ts_code = '{ts_code}'",
                self.engine
            )
            return set(existing['trade_date'])
        except Exception:
            return set()

    def needs_update(self) -> bool:
        """判断是否需要更新（检查最新日期是否早于最近交易日）"""
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
        """
        执行指数日线下载
        :param start_date: 起始日期（默认 2010-01-01），首次下载用
        :param end_date:   结束日期（默认最新交易日）
        """
        if not self._acquire_lock():
            self.log("已有更新进程在运行，跳过本次更新")
            return False, "已有更新进程"

        try:
            # 检查是否需要更新（避免无变化时仍然重新下载全量）
            if not self.needs_update():
                self.log("指数数据已是最新，无需更新")
                return True, "数据已最新"

            if end_date is None:
                end_date = self._get_latest_trade_date()
            self.log(f"目标结束日期: {end_date}")

            # 准备需要更新的指数列表
            indices_to_update = []
            for ts_code in self.index_list:
                # 获取表中已有最新日期
                existing_dates = self._get_existing_dates(ts_code)
                if existing_dates:
                    max_existing = max(existing_dates)
                    if max_existing >= end_date:
                        self.log(f"指数 {ts_code} 数据已到 {max_existing}，无需更新")
                        continue
                    start = (datetime.strptime(max_existing, '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d')
                else:
                    start = start_date
                indices_to_update.append((ts_code, start))

            self.log(f"共 {len(indices_to_update)} 个指数需要更新")

            checkpoint = self._get_checkpoint()
            start_processing = False
            success_cnt = 0
            fail_cnt = 0
            skip_cnt = 0

            for idx, (ts_code, start) in enumerate(indices_to_update):
                # 断点续传
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

                self.log(f"[{idx+1}/{len(indices_to_update)}] 更新 {ts_code} : {start} -> {end_date}")
                self._record_checkpoint(ts_code)

                result = self._fetch_index_data(ts_code, start, end_date)

                if result is None:
                    fail_cnt += 1
                    self.log(f"✗ 指数 {ts_code} 拉取失败")
                    self._record_fail(ts_code)
                elif isinstance(result, str) and result == 'INVALID':
                    self.log(f"✗ 指数代码 {ts_code} 无效，跳过")
                    skip_cnt += 1
                    # 无效指数永久记录，但本次不加入失败重试
                else:
                    df = result
                    df['ts_code'] = ts_code
                    # 去重（基于已有数据）
                    existing = self._get_existing_dates(ts_code)
                    if existing:
                        df = df[~df['trade_date'].isin(existing)]
                    if df.empty:
                        self.log(f"✓ 指数 {ts_code} 无新数据")
                        self._record_success(ts_code)
                        continue

                    try:
                        # 追加写入
                        df.to_sql(self.table_name, self.engine, if_exists='append', index=False, method='multi')
                        success_cnt += 1
                        self.log(f"✓ 写入 {len(df)} 条记录")
                        self._record_success(ts_code)
                    except Exception as e:
                        fail_cnt += 1
                        self.log(f"✗ 写入失败: {e}", "ERROR")
                        self._record_fail(ts_code)

                time.sleep(self.request_interval)

            self.log(f"更新完成: 成功 {success_cnt}, 失败 {fail_cnt}, 跳过 {skip_cnt}")
            self._clear_checkpoint()
            return True, f"成功 {success_cnt}, 失败 {fail_cnt}, 跳过 {skip_cnt}"
        finally:
            self._release_lock()


# 独立运行入口
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="指数日线数据下载器（沪深300、上证等）")
    parser.add_argument("--start", default="2010-01-01", help="起始日期 (YYYY-MM-DD)")
    parser.add_argument("--end", help="结束日期 (默认最新交易日)")
    parser.add_argument("--indices", nargs="+", help="指定指数代码，例如 000300.SH 000001.SH")
    args = parser.parse_args()

    # 配置数据库连接（请修改为你的实际路径）
    db_path = r'E:\Tquant1\tquant.db'
    engine = create_engine(f'sqlite:///{db_path}')

    # 自定义指数列表（如果命令行指定）
    index_list = args.indices if args.indices else None

    updater = IndexDailyUpdater(engine, index_list=index_list)
    updater.run(start_date=args.start, end_date=args.end)