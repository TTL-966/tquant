#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
独立数据更新脚本，由主进程通过 subprocess 调用。
避免 Baostock / Tushare 与 QtWebEngine 的多线程冲突。

用法：
  python standalone_updater.py                    # 默认更新个股日线
  python standalone_updater.py --type daily_kline # 个股日线（兼容旧版）
  python standalone_updater.py --type stock       # 个股日线
  python standalone_updater.py --type index       # 指数日线
  python standalone_updater.py --type financial   # 财务数据
  python standalone_updater.py --type stock --source tushare  # 指定数据源
"""

import sys
import os
import json
import argparse

from sqlalchemy import text

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from concurrent.futures import ThreadPoolExecutor, as_completed
from backend.db import Database
from backend.data_updater.daily_kline_updater import (
    StockDailyUpdater, IndexDailyUpdater, create_fetcher
)
from backend.data_updater.financial_updater import FinancialUpdater
from backend.data_updater.fund_flow_updater import FundFlowFetcher


def run_fund_flow_update(db, args):
    """资金流向增量更新：最近 N 日数据，并发抓取，批量 upsert。"""
    days = args.days if args.days else 5
    engine = db.engine

    # 获取所有股票代码
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT code FROM stock_basic ORDER BY code")
        ).fetchall()
    codes = [r[0] for r in rows]
    total = len(codes)
    if not args.quiet:
        print(f"[fund_flow] 待处理 {total} 只股票，days={days}")

    fetcher = FundFlowFetcher(cache_ttl=0)
    inserted = 0
    failed = 0

    def fetch_one(code):
        data_list = fetcher.get_fund_flow_recent(code, days=days)
        return code, data_list

    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {executor.submit(fetch_one, c): c for c in codes}
        for i, future in enumerate(as_completed(futures)):
            code, data_list = future.result()
            if not data_list:
                failed += 1
                continue

            ts_code = f"{code}.SZ" if not code.startswith("6") else f"{code}.SH"
            with engine.connect() as conn:
                for d in data_list:
                    conn.execute(text("""
                        INSERT INTO fund_flow_history
                            (ts_code, trade_date, main_net, super_net, big_net, medium_net, small_net)
                        VALUES (:ts, :date, :main, :super, :big, :med, :small)
                        ON CONFLICT(ts_code, trade_date) DO UPDATE SET
                            main_net=excluded.main_net, super_net=excluded.super_net,
                            big_net=excluded.big_net, medium_net=excluded.medium_net,
                            small_net=excluded.small_net
                    """), {
                        "ts": ts_code,
                        "date": d["date"],
                        "main": d["main_net"],
                        "super": d["super_net"],
                        "big": d["big_net"],
                        "med": d["medium_net"],
                        "small": d["small_net"],
                    })
                conn.commit()
                inserted += len(data_list)

            if not args.quiet and (i + 1) % 100 == 0:
                print(f"[fund_flow] 进度 {i+1}/{total}，已插入 {inserted} 条")

    msg = f"资金流向更新完成: 成功 {total - failed}/{total} 只, 插入 {inserted} 条"
    print(msg)
    return True, msg


def main():
    parser = argparse.ArgumentParser(description='Tquant 数据更新工具')
    parser.add_argument('--quiet', action='store_true', help='静默模式，不输出详细日志')
    parser.add_argument('--type', default='daily_kline',
                        choices=['daily_kline', 'stock', 'index', 'financial', 'fund_flow'],
                        help='更新类型')
    parser.add_argument('--source', default=None, choices=['baostock', 'tushare'],
                        help='数据源（可选）')
    parser.add_argument('--token', default=None,
                        help='Tushare Token（可选）')
    parser.add_argument('--start', default='2010-01-01',
                        help='起始日期')
    parser.add_argument('--end', help='结束日期')
    parser.add_argument('--days', type=int, default=5,
                        help='资金流向：抓取最近几个交易日，默认 5')
    parser.add_argument('--options', default=None,
                        help='更新选项 JSON 文件路径')
    args = parser.parse_args()

    # 加载更新选项
    update_options = None
    if args.options:
        try:
            with open(args.options, 'r', encoding='utf-8') as _f:
                update_options = json.loads(_f.read())
            if not args.quiet:
                print(f"加载更新选项: {update_options}")
        except Exception as e:
            if not args.quiet:
                print(f"WARNING: 无法加载更新选项文件 {args.options}: {e}")

    try:
        db = Database()

        if args.type == 'fund_flow':
            run_fund_flow_update(db, args)
            sys.exit(0)
        elif args.type == 'financial':
            updater = FinancialUpdater(db.engine)
        elif args.type == 'index':
            fetcher = create_fetcher(source=args.source, token=args.token)
            if not args.quiet:
                print(f"使用数据源: {fetcher.source_name}")
            updater = IndexDailyUpdater(db.engine, fetcher=fetcher)
            success, msg = updater._safe_run(start_date=args.start, end_date=args.end)
            if not args.quiet:
                print(f"更新结果: {msg}")
            sys.exit(0 if success else 1)
        else:  # daily_kline 或 stock
            fetcher = create_fetcher(source=args.source, token=args.token)
            if not args.quiet:
                print(f"使用数据源: {fetcher.source_name}")
            updater = StockDailyUpdater(db.engine, fetcher=fetcher)
            if update_options:
                updater._update_options = update_options
            success, msg = updater._safe_run()
            if not args.quiet:
                print(f"更新结果: {msg}")
            sys.exit(0 if success else 1)
    except Exception as e:
        print(f"更新失败: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
