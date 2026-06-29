#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""资金流向历史数据初次填充脚本。

从东方财富 API 获取最近 4 个交易日数据，写入 fund_flow_history 表。
仅用于初次数据初始化，不拉取全量历史。
"""

import sys
import os
import time
import random

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from backend.db import Database
from backend.data_updater.fund_flow_updater import FundFlowFetcher


def main(limit: int = 0, days: int = 4):
    db = Database()
    engine = db.engine
    fetcher = FundFlowFetcher(cache_ttl=0)  # 不缓存，每次实时抓取

    # 从 stock_basic 获取股票代码
    with engine.connect() as conn:
        if limit > 0:
            # 如果显式传了 limit，就限制数量
            rows = conn.execute(
                text("SELECT code FROM stock_basic ORDER BY code LIMIT :lim"),
                {"lim": limit}
            ).fetchall()
        else:
            # 如果没有传 limit 或者传入 0，就全量拉取
            rows = conn.execute(
                text("SELECT code FROM stock_basic ORDER BY code")
            ).fetchall()

    codes = [r[0] for r in rows]
    print(f"[populate] 待处理 {len(codes)} 只股票（全市场）")

    total_inserted = 0
    for idx, code in enumerate(codes):
        print(f"[populate] [{idx + 1}/{len(codes)}] 获取 {code} ...")
        data_list = fetcher.get_fund_flow_recent(code, days=days)

        if not data_list:
            print(f"  -> 无数据，跳过")
            continue

        # 【优化点】将 conn 提到循环外，只打开一次连接，批量写入
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

        # 随机休眠 1~2.5 秒，完美规避封IP风险
        delay = random.uniform(1.0, 2.5)
        if idx < len(codes) - 1:
            time.sleep(delay)

    print(f"[populate] 完成，共插入 {total_inserted} 条记录")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="资金流向历史数据初始化")
    parser.add_argument("--limit", type=int, default=0, help="限制拉取股票数量，0代表全市场")
    parser.add_argument("--days", type=int, default=4, help="抓取最近几个交易日的数据")
    args = parser.parse_args()
    main(limit=args.limit, days=args.days)