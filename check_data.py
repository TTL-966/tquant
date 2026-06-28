#!/usr/bin/env python
# -*- coding: utf-8 -*-
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd
from sqlalchemy import text
from backend.db import Database

def main():
    db = Database()
    engine = db.engine

    # 询问要删除几天前的数据（例如删除最近3天的数据）
    days = input("请输入要删除最近几天的数据（例如 3）：")
    try:
        days = int(days)
    except:
        print("输入无效，默认删除3天")
        days = 3

    from datetime import datetime, timedelta
    cutoff = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
    print(f"将删除 trade_date >= {cutoff} 的数据")

    # 先确认
    count_sql = f"SELECT COUNT(*) FROM stock_daily_qfq_with_name WHERE trade_date >= '{cutoff}'"
    count = pd.read_sql(count_sql, engine).iloc[0,0]
    print(f"共 {count} 条记录将被删除")
    confirm = input("确认删除？(y/n): ")
    if confirm.lower() != 'y':
        print("取消操作")
        return

    with engine.begin() as conn:
        conn.execute(text(f"DELETE FROM stock_daily_qfq_with_name WHERE trade_date >= :cutoff"), {"cutoff": cutoff})
        print("删除完成")

if __name__ == "__main__":
    main()