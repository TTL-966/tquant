#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""使用 AkShare 更新指数成分股数据，存入 index_components 表"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import time
import pandas as pd
from sqlalchemy import text
from backend.db import Database
from backend.data_updater.base_updater import BaseUpdater

import socket
socket.setdefaulttimeout(30)

try:
    import akshare as ak
except ImportError:
    print("请先安装 akshare: pip install akshare")
    sys.exit(1)


class IndexComponentUpdater(BaseUpdater):
    def __init__(self, db_engine):
        super().__init__("index_components")
        self.engine = db_engine

    def needs_update(self) -> bool:
        """检查数据库中是否有任何指数成分股记录，若无则需要更新"""
        try:
            df = pd.read_sql("SELECT 1 FROM index_components LIMIT 1", self.engine)
            return df.empty
        except Exception:
            return True

    def _fetch_index_stocks_akshare(self, index_name: str) -> list:
        """
        使用 AkShare 获取指定指数的成分股代码（纯数字）
        index_name: 'hs300', 'zz500', 'zz1000', 'cyb', 'kc50'
        """
        try:
            if index_name == 'hs300':
                # 沪深300 指数代码 000300
                df = ak.index_stock_cons_csindex("000300")
            elif index_name == 'zz500':
                df = ak.index_stock_cons_csindex("000905")
            elif index_name == 'zz1000':
                df = ak.index_stock_cons_csindex("000852")
            elif index_name == 'cyb':
                # 创业板指 399006，使用中证指数接口
                df = ak.index_stock_cons_csindex("399006")
            elif index_name == 'kc50':
                # 科创50 指数 000688，成分股列表
                df = ak.index_stock_cons_csindex("000688")
            else:
                return []

            if df.empty:
                return []

            # 提取代码列，AkShare 返回的列名可能是 '成分券代码' 或 '代码'
            code_col = None
            for col in ['成分券代码', '代码', 'stock_code']:
                if col in df.columns:
                    code_col = col
                    break
            if code_col is None:
                return []

            codes = df[code_col].astype(str).str.strip().tolist()
            # 统一为6位数字，去除可能的后缀 .SH/.SZ
            pure_codes = [c.split('.')[0].zfill(6) for c in codes]
            return pure_codes
        except Exception as e:
            self.log(f"获取指数 {index_name} 失败: {e}", "ERROR")
            return []

    def run(self) -> tuple:
        self.log("开始更新指数成分股数据...")
        try:
            # 定义要更新的指数及其在数据库中的 index_code
            indices = {
                'hs300': '000300.XSHG',
                'zz500': '000905.XSHG',
                'zz1000': '000852.XSHG',
                'cyb': '399006.XSHE',
                'kc50': '000688.XSHG',
            }
            today = pd.Timestamp.now().strftime('%Y-%m-%d')
            total_updated = 0

            with self.engine.begin() as conn:
                for name, index_code in indices.items():
                    self.log(f"获取指数 {name} ({index_code}) 成分股...")
                    codes = self._fetch_index_stocks_akshare(name)
                    if not codes:
                        self.log(f"指数 {name} 获取失败，跳过", "WARN")
                        continue

                    # 删除该指数旧数据
                    conn.execute(
                        text("DELETE FROM index_components WHERE index_code = :ic"),
                        {"ic": index_code}
                    )
                    # 插入新数据
                    for code in codes:
                        conn.execute(
                            text(
                                "INSERT INTO index_components (index_code, stock_code, update_date) VALUES (:ic, :sc, :ud)"),
                            {"ic": index_code, "sc": code, "ud": today}
                        )
                    self.log(f"更新 {name} 完成，共 {len(codes)} 只股票")
                    total_updated += len(codes)
                    time.sleep(0.5)  # 避免请求过快

            msg = f"指数成分股更新完成，共更新 {total_updated} 条记录"
            self.log(msg)
            return True, msg
        except Exception as e:
            self.log(f"更新失败: {e}", "ERROR")
            return False, str(e)


if __name__ == "__main__":
    db = Database()
    updater = IndexComponentUpdater(db.engine)
    success, msg = updater._safe_run()
    print(msg)
    sys.exit(0 if success else 1)