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

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.db import Database
from backend.data_updater.daily_kline_updater import (
    StockDailyUpdater, IndexDailyUpdater, create_fetcher
)
from backend.data_updater.financial_updater import FinancialUpdater


def main():
    parser = argparse.ArgumentParser(description='Tquant 数据更新工具')
    parser.add_argument('--quiet', action='store_true', help='静默模式，不输出详细日志')
    parser.add_argument('--type', default='daily_kline',
                        choices=['daily_kline', 'stock', 'index', 'financial'],
                        help='更新类型 (daily_kline/stock=个股日线, index=指数日线, financial=财务数据)')
    parser.add_argument('--source', default=None, choices=['baostock', 'tushare'],
                        help='数据源（可选，默认使用配置文件设置）')
    parser.add_argument('--token', default=None,
                        help='Tushare Token（可选，默认使用配置文件设置）')
    parser.add_argument('--start', default='2010-01-01',
                        help='起始日期，仅对指数更新有效')
    parser.add_argument('--end', help='结束日期，仅对指数更新有效')
    parser.add_argument('--options', default=None,
                        help='更新选项 JSON 文件路径，包含 update_kline/update_turnover/max_days_back')
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

        if args.type == 'financial':
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
