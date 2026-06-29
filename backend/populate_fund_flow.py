#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""资金流向历史数据初次填充脚本。

从东方财富 API 获取最近 5 个交易日数据，写入 fund_flow_history 表。
仅用于初次数据初始化，不拉取全量历史。
"""

import sys
import os
import time
import random
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from backend.db import Database
from backend.data_updater.fund_flow_updater import FundFlowFetcher


def main(limit: int = 50, days: int = 5):
    db = Database()
    engine = db.engine
    fetcher = FundFlowFetcher(cache_ttl=0)  # 不缓存，每次实时抓取

    # 从 stock_basic 获取股票代码
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT code FROM stock_basic ORDER BY code LIMIT :lim"),
            {"lim": limit}
        ).fetchall()
    codes = [r[0] for r in rows]
    print(f"[populate] 待处理 {len(codes)} 只股票（LIMIT {limit}）")

    total_inserted = 0
    for idx, code in enumerate(codes):
        print(f"[populate] [{idx+1}/{len(codes)}] 获取 {code} ...")
        data_list = fetcher.get_fund_flow_recent(code, days=days)

        if not data_list:
            print(f"  -> 无数据，跳过")
            continue

        # INSERT OR IGNORE 防重复
        with engine.connect() as conn:
            for d in data_list:
                conn.execute(text("""
                    INSERT OR IGNORE INTO fund_flow_history
                        (ts_code, trade_date, main_net, super_net, big_net, medium_net, small_net)
                    VALUES (:ts, :date, :main, :super, :big, :med, :small)
                """), {
                    "ts": f"{code}.SZ" if not code.startswith("6") else f"{code}.SH",
                    "date": d["date"],
                    "main": d["main_net"],
                    "super": d["super_net"],
                    "big": d["big_net"],
                    "med": d["medium_net"],
                    "small": d["small_net"],
                })
            conn.commit()
            total_inserted += len(data_list)
        print(f"  -> 写入 {len(data_list)} 条")

        delay = random.uniform(1.0, 2.5)
        if idx < len(codes) - 1:
            time.sleep(delay)

    print(f"[populate] 完成，共插入 {total_inserted} 条记录")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="资金流向历史数据初始化")
    parser.add_argument("--limit", type=int, default=50, help="测试用：限制股票数量")
    parser.add_argument("--days", type=int, default=5, help="抓取最近几个交易日的数据")
    args = parser.parse_args()
    main(limit=args.limit, days=args.days)
