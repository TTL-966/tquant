#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""为现有日线数据补充换手率（自由流通股本版，turnover_rate_f）"""

import sys
import os
import time
import pandas as pd
from sqlalchemy import text
from backend.db import Database
from backend.config_manager import load_config
import tushare as ts


def add_turnover_f_column(engine):
    with engine.connect() as conn:
        result = conn.execute(text("PRAGMA table_info(stock_daily_qfq_with_name)"))
        columns = [row[1] for row in result]
        if 'turnover_rate_f' not in columns:
            conn.execute(text("ALTER TABLE stock_daily_qfq_with_name ADD COLUMN turnover_rate_f REAL"))
            conn.commit()
            print("已添加 turnover_rate_f 列")
        else:
            print("turnover_rate_f 列已存在")


def main():
    config = load_config()
    token = config.get('tushare_token')
    if not token:
        print("没有 Tushare token，请配置")
        return
    ts.set_token(token)
    pro = ts.pro_api()

    db = Database()
    engine = db.engine

    add_turnover_f_column(engine)

    # 获取需要更新的股票列表（只取有足够日线数据的）
    df_stocks = pd.read_sql("""
        SELECT DISTINCT ts_code FROM stock_daily_qfq_with_name 
        WHERE turnover_rate_f IS NULL 
        AND ts_code IN (SELECT ts_code FROM stock_daily_qfq_with_name GROUP BY ts_code HAVING COUNT(*) > 100)
    """, engine)

    if df_stocks.empty:
        print("所有股票的 turnover_rate_f 已有数据，无需更新")
        return

    codes = df_stocks['ts_code'].tolist()
    total = len(codes)
    print(f"共 {total} 只股票需要补充自由流通换手率")

    batch_size = 50
    for i in range(0, total, batch_size):
        batch = codes[i:i + batch_size]
        print(f"处理批次 {i // batch_size + 1}/{(total + batch_size - 1) // batch_size}，股票数 {len(batch)}")

        for ts_code in batch:
            try:
                # 只获取 turnover_rate_f 字段
                df = pro.daily_basic(ts_code=ts_code, fields='trade_date,turnover_rate_f')
                if df is None or df.empty:
                    continue
                df['trade_date'] = pd.to_datetime(df['trade_date'], format='%Y%m%d').dt.strftime('%Y-%m-%d')
                df.rename(columns={'turnover_rate_f': 'turnover_f'}, inplace=True)

                # 批量更新
                with engine.begin() as conn:
                    update_data = [
                        {"turn_f": row['turnover_f'], "code": ts_code, "date": row['trade_date']}
                        for _, row in df.iterrows()
                    ]
                    if update_data:
                        conn.execute(
                            text("UPDATE stock_daily_qfq_with_name SET turnover_rate_f = :turn_f WHERE ts_code = :code AND trade_date = :date"),
                            update_data
                        )
                time.sleep(0.2)  # 控制频率
            except Exception as e:
                print(f"  错误处理 {ts_code}: {e}")

        time.sleep(1)

    print("自由流通换手率更新完成")


if __name__ == "__main__":
    main()