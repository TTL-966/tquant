#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
按需更新 & 空闲后台更新模块。
- update_stock_if_needed() — 单只股票按需更新
- get_stale_stocks() — 查询长期未更新的股票列表
- IdleUpdater — 空闲时后台静默更新，支持暂停/恢复
"""

import time
import threading
from datetime import datetime, timedelta

import pandas as pd
from sqlalchemy import text

from .data_updater.daily_kline_updater import create_fetcher


def _ts_code_from_pure(pure_code: str) -> str:
    """纯数字代码 → Tushare 格式 ts_code。"""
    if pure_code.startswith(('6', '9')):
        return f"{pure_code}.SH"
    return f"{pure_code}.SZ"


def update_stock_if_needed(code: str, engine) -> int:
    print(f"[StockUpdater] 进入 update_stock_if_needed, code={code}")
    """按需更新单只股票的日线数据。

    Args:
        code: 纯数字股票代码，如 '000001'
        engine: SQLAlchemy engine

    Returns:
        写入的条数，0 表示无需更新或更新失败
    """
    pure_code = code.split('.')[0].zfill(6)
    ts_code = _ts_code_from_pure(pure_code)

    try:
        # 0. 检查是否已标记为永久跳过（如退市股）
        with engine.connect() as conn:
            skip_row = conn.execute(
                text("SELECT permanent FROM stock_update_fail WHERE code = :code"),
                {"code": pure_code}
            ).fetchone()
            if skip_row and skip_row[0]:
                return 0  # 已永久跳过，不再尝试

        # 1. 查询数据库中该股票的最新日期
        with engine.connect() as conn:
            row = conn.execute(
                text("SELECT MAX(trade_date) FROM stock_daily_qfq_with_name WHERE ts_code = :ts"),
                {"ts": ts_code}
            ).scalar()

        # 2. 创建 fetcher 获取最新交易日
        fetcher = create_fetcher()
        if not fetcher.login():
            return 0

        try:
            latest_trade_date = fetcher.get_latest_trade_date()

            # 3. 确定需要更新的起始日期
            if row:
                db_max_date = str(row)
                if db_max_date >= latest_trade_date:
                    return 0  # 已是最新
                start_dt = datetime.strptime(db_max_date, '%Y-%m-%d') + timedelta(days=1)
                start_date = start_dt.strftime('%Y-%m-%d')
            else:
                # 无数据，从半年前开始
                start_date = (datetime.now() - timedelta(days=180)).strftime('%Y-%m-%d')

            if start_date > latest_trade_date:
                return 0

            # 4. 获取数据
            source_code = fetcher.pure_code_to_source(pure_code)
            result = fetcher.fetch_stock_data(source_code, start_date, latest_trade_date)

            if result is None or isinstance(result, str):
                return 0

            df = result
            df['ts_code'] = ts_code

            # 去重
            existing_dates = set()
            try:
                existing = pd.read_sql(
                    f"SELECT trade_date FROM stock_daily_qfq_with_name WHERE ts_code = '{ts_code}'",
                    engine
                )
                existing_dates = set(existing['trade_date'])
            except Exception:
                pass

            if existing_dates:
                df = df[~df['trade_date'].isin(existing_dates)]

            if df.empty:
                return 0

            df.to_sql('stock_daily_qfq_with_name', engine, if_exists='append',
                      index=False, method='multi')
            return len(df)
        finally:
            fetcher.logout()
    except Exception as e:
        print(f"[StockUpdater] 更新 {code} 失败: {e}")
        return 0


def get_stale_stocks(engine, days_threshold: int = 3, limit: int = 50):
    """查询长期未更新的股票列表。

    Args:
        engine: SQLAlchemy engine
        days_threshold: 多少天未更新视为陈旧
        limit: 最多返回数量

    Returns:
        list of (code, last_date) tuples，按 last_date 升序（最旧的优先）
    """
    threshold_date = (datetime.now() - timedelta(days=days_threshold)).strftime('%Y-%m-%d')
    try:
        sql = text("""
            SELECT REPLACE(REPLACE(ts_code, '.SH', ''), '.SZ', '') as code,
                   MAX(trade_date) as last_date
            FROM stock_daily_qfq_with_name
            GROUP BY code
            HAVING last_date < :threshold
            ORDER BY last_date ASC
            LIMIT :limit
        """)
        with engine.connect() as conn:
            rows = conn.execute(sql, {"threshold": threshold_date, "limit": limit}).fetchall()
        return [(r[0], r[1]) for r in rows]
    except Exception as e:
        print(f"[StockUpdater] 查询陈旧股票失败: {e}")
        return []


class IdleUpdater:
    """空闲时后台静默更新器。

    用法:
        updater = IdleUpdater(engine, days_threshold=3, batch_size=50, interval=2.0)
        updater.start()
        ...
        updater.pause()   # 用户活动时暂停
        updater.resume()  # 再次空闲时恢复
        updater.stop()
    """

    def __init__(self, engine, days_threshold=3, batch_size=50, interval=2.0):
        self.engine = engine
        self.days_threshold = days_threshold
        self.batch_size = batch_size
        self.interval = interval
        self._thread = None
        self._running = False
        self._paused = False
        self._checkpoint_code = None  # 断点续传

    @property
    def is_running(self):
        return self._running and not self._paused

    def start(self):
        if self._running:
            return
        self._running = True
        self._paused = False
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        print("[IdleUpdater] 后台空闲更新已启动")

    def pause(self):
        self._paused = True
        print("[IdleUpdater] 后台更新已暂停")

    def resume(self):
        self._paused = False
        print("[IdleUpdater] 后台更新已恢复")

    def stop(self):
        self._running = False
        self._paused = False
        print("[IdleUpdater] 后台更新已停止")

    def set_params(self, days_threshold=None, batch_size=None, interval=None):
        if days_threshold is not None:
            self.days_threshold = days_threshold
        if batch_size is not None:
            self.batch_size = batch_size
        if interval is not None:
            self.interval = interval

    def _run(self):
        while self._running:
            if self._paused:
                time.sleep(1)
                continue

            try:
                stale = get_stale_stocks(self.engine, self.days_threshold, self.batch_size)
                if not stale:
                    print("[IdleUpdater] 所有股票数据已是最新，后台更新结束")
                    self._running = False
                    break

                updated_count = 0
                for code, last_date in stale:
                    if not self._running:
                        break
                    if self._paused:
                        break

                    # 断点续传：跳过已处理过的
                    if self._checkpoint_code and code <= self._checkpoint_code:
                        continue

                    print(f"[IdleUpdater] 静默更新 {code} (最新: {last_date})")
                    n = update_stock_if_needed(code, self.engine)
                    if n > 0:
                        updated_count += 1

                    self._checkpoint_code = code
                    time.sleep(self.interval)

                print(f"[IdleUpdater] 本轮更新 {updated_count} 只股票")
                self._checkpoint_code = None  # 每轮重置断点

            except Exception as e:
                print(f"[IdleUpdater] 更新循环异常: {e}")
                time.sleep(5)
