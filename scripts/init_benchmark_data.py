#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
初始化基准指数日线数据。
从 Baostock/Tushare 拉取常用指数（沪深300、上证、深证、中证500、创业板指）
的历史日线数据到 index_daily 表。运行一次即可。

用法：
  python scripts/init_benchmark_data.py
  python scripts/init_benchmark_data.py --source tushare --token YOUR_TOKEN
"""

import os
import sys
import argparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.db import Database
from backend.data_updater.daily_kline_updater import IndexDailyUpdater, create_fetcher


BENCHMARK_CODES = [
    '000300.SH',   # 沪深300
    '000001.SH',   # 上证指数
    '399001.SZ',   # 深证成指
    '000905.SH',   # 中证500
    '399006.SZ',   # 创业板指
]


def main():
    parser = argparse.ArgumentParser(description='初始化基准指数日线数据')
    parser.add_argument('--source', default=None, choices=['baostock', 'tushare'],
                        help='数据源（默认使用配置文件设置）')
    parser.add_argument('--token', default=None, help='Tushare Token')
    parser.add_argument('--start', default='2010-01-01', help='起始日期')
    args = parser.parse_args()

    print("=" * 50)
    print("初始化基准指数日线数据")
    print("=" * 50)

    db = Database()
    fetcher = create_fetcher(source=args.source, token=args.token)
    print(f"数据源: {fetcher.source_name}")

    updater = IndexDailyUpdater(db.engine, fetcher=fetcher, index_list=BENCHMARK_CODES)

    print(f"指数列表: {BENCHMARK_CODES}")
    print(f"起始日期: {args.start}")
    print()

    success, msg = updater._safe_run(start_date=args.start)
    print()
    print(f"结果: {msg}")
    print("=" * 50)

    if success:
        print("基准指数数据初始化完成！")
    else:
        print("初始化失败，请检查数据源配置。")

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
