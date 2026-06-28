#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
财务数据更新器 —— 基于 Baostock（稳定版）
获取最新财务数据：PE、PB、ROE、营收、净利润、流通股本。
支持增量更新（超过90天未更新或新股），过滤退市股。
在更新完成后，自动根据最新收盘价和流通股本计算并更新总市值（流通市值）。
"""

import sys
import os
import time
from datetime import datetime, timedelta
import pandas as pd
import numpy as np
from sqlalchemy import text

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from backend.db import Database
from backend.base_updater import BaseUpdater

try:
    import baostock as bs
except ImportError:
    print("请先安装 baostock: pip install baostock")
    sys.exit(1)


class FinancialUpdaterBaostock(BaseUpdater):
    def __init__(self, db_engine):
        super().__init__("financial_baostock")
        self.engine = db_engine
        self.refresh_days = 90
        self.request_interval = 0.5

    def _login_baostock(self, retry=3):
        for attempt in range(retry):
            lg = bs.login()
            if lg.error_code == '0':
                self.log("Baostock 登录成功")
                return True
            self.log(f"登录失败 (尝试 {attempt+1}/{retry}): {lg.error_msg}", "WARN")
            time.sleep(3)
        return False

    @staticmethod
    def _get_baostock_code(pure_code: str) -> str:
        if pure_code.startswith(('6', '9')):
            return f"sh.{pure_code}"
        return f"sz.{pure_code}"

    @staticmethod
    def _get_ts_code(pure_code: str) -> str:
        if pure_code.startswith(('6', '9')):
            return f"{pure_code}.SH"
        elif pure_code.startswith('8'):
            return f"{pure_code}.BJ"
        else:
            return f"{pure_code}.SZ"

    @staticmethod
    def _safe_float(val):
        if val is None or val == '' or val == '--':
            return None
        try:
            return float(val)
        except:
            return None

    def _get_valid_stocks(self) -> set:
        """获取近一年有日线数据的股票（过滤退市/长期停牌）"""
        one_year_ago = (datetime.now() - timedelta(days=365)).strftime('%Y-%m-%d')
        sql = """
            SELECT DISTINCT SUBSTR(ts_code, 1, INSTR(ts_code, '.') - 1) as code
            FROM stock_daily_qfq_with_name
            WHERE trade_date >= :date
        """
        df = pd.read_sql(sql, self.engine, params={"date": one_year_ago})
        return set(df['code'].astype(str))

    def needs_update(self) -> bool:
        """判断是否有新股或过期股票"""
        try:
            valid = self._get_valid_stocks()
            if not valid:
                return True
            existing = pd.read_sql("SELECT ts_code, update_date FROM stock_financial", self.engine)
            if existing.empty:
                return True
            existing['code'] = existing['ts_code'].str.split('.').str[0]
            existing_codes = set(existing['code'])
            # 新股
            new_codes = valid - existing_codes
            if new_codes:
                return True
            # 过期股票
            existing['days_since'] = existing['update_date'].apply(
                lambda d: (datetime.now() - datetime.strptime(d, '%Y-%m-%d')).days
            )
            stale = existing[existing['days_since'] >= self.refresh_days]
            return not stale.empty
        except Exception:
            return True

    def _fetch_valuation(self, bs_code: str) -> dict:
        """获取最新 PE(TTM)、PB"""
        try:
            rs = bs.query_history_k_data_plus(
                bs_code,
                "peTTM,pbMRQ",
                start_date=(datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d'),
                end_date=datetime.now().strftime('%Y-%m-%d'),
                adjustflag='2'
            )
            if rs.error_code != '0':
                return {}
            rows = []
            while rs.next():
                rows.append(rs.get_row_data())
            if not rows:
                return {}
            for row in reversed(rows):
                pe = self._safe_float(row[0])
                pb = self._safe_float(row[1])
                if pe is not None or pb is not None:
                    return {'pe_ttm': pe, 'pb': pb}
            return {}
        except Exception as e:
            self.log(f"获取估值失败 {bs_code}: {e}", "WARN")
            return {}

    def _fetch_profit_data(self, bs_code: str) -> dict:
        try:
            current_year = datetime.now().year
            for y in range(current_year, current_year - 2, -1):
                for q in range(4, 0, -1):
                    rs = bs.query_profit_data(bs_code, year=y, quarter=q)
                    if rs.error_code == '0' and rs.next():
                        row = rs.get_row_data()
                        if len(row) >= 9:
                            roe = self._safe_float(row[3])  # 净资产收益率 (%)
                            net_profit_yuan = self._safe_float(row[6])  # 净利润（元）
                            revenue_yuan = self._safe_float(row[8])  # 营业收入（元）
                            # 转换为亿元（除以 1e8）
                            net_profit = net_profit_yuan / 1e8 if net_profit_yuan is not None else None
                            revenue = revenue_yuan / 1e8 if revenue_yuan is not None else None
                            if roe is not None or net_profit is not None or revenue is not None:
                                return {'roe': roe, 'net_profit': net_profit, 'revenue': revenue}
            return {}
        except Exception as e:
            self.log(f"获取利润数据失败 {bs_code}: {e}", "WARN")
            return {}

    def _fetch_total_shares(self, bs_code: str) -> dict:
        try:
            rs = bs.query_profit_data(bs_code, year=datetime.now().year, quarter=1)
            if rs.error_code == '0' and rs.next():
                row = rs.get_row_data()
                if len(row) >= 11:
                    total_shares = self._safe_float(row[9])  # 总股本（股）
                    float_shares = self._safe_float(row[10])  # 流通股本（股）
                    if total_shares is not None:
                        total_shares = total_shares / 1e8
                    if float_shares is not None:
                        float_shares = float_shares / 1e8
                    return {'total_shares': total_shares, 'float_shares': float_shares}
            return {}
        except Exception as e:
            self.log(f"获取股本数据失败 {bs_code}: {e}", "WARN")
            return {}

    def _update_market_cap_from_local(self):
        """使用本地数据（最新收盘价 × 流通股本）更新总市值（流通市值）"""
        self.log("开始本地计算总市值（流通市值）...")
        try:
            # 1. 获取每只股票的最新收盘价
            sql_close = """
                SELECT ts_code, close, trade_date
                FROM stock_daily_qfq_with_name
                WHERE (ts_code, trade_date) IN (
                    SELECT ts_code, MAX(trade_date) 
                    FROM stock_daily_qfq_with_name 
                    GROUP BY ts_code
                )
            """
            df_close = pd.read_sql(sql_close, self.engine)
            df_close['code'] = df_close['ts_code'].str.split('.').str[0]
            self.log(f"获取到 {len(df_close)} 只股票的最新收盘价")

            # 2. 获取流通股本
            df_fin = pd.read_sql("SELECT ts_code, float_shares FROM stock_financial", self.engine)
            df_fin['code'] = df_fin['ts_code'].str.split('.').str[0]
            self.log(f"获取到 {len(df_fin)} 只股票的流通股本")

            # 3. 合并计算
            merged = pd.merge(df_close[['code', 'close']], df_fin[['code', 'float_shares']], on='code', how='inner')
            merged['total_mv'] = merged['close'] * merged['float_shares']
            merged['total_mv'] = merged['total_mv'].round(2)
            self.log(f"合并后有效股票数量: {len(merged)}")

            # 4. 更新数据库
            updated = 0
            with self.engine.begin() as conn:
                for _, row in merged.iterrows():
                    ts_code = df_fin[df_fin['code'] == row['code']]['ts_code'].iloc[0]
                    conn.execute(
                        text("UPDATE stock_financial SET total_mv = :mv WHERE ts_code = :code"),
                        {"mv": row['total_mv'], "code": ts_code}
                    )
                    updated += 1
                    if updated % 500 == 0:
                        self.log(f"已更新 {updated} 只股票的总市值")
            self.log(f"总市值更新完成，共更新 {updated} 只股票")
        except Exception as e:
            self.log(f"本地计算总市值失败: {e}", "ERROR")

    def run(self) -> tuple:
        self.log("开始使用 Baostock 更新财务数据...")

        if not self._login_baostock():
            return False, "Baostock 登录失败"

        try:
            # 1. 获取有效股票列表（过滤退市）
            valid_codes = self._get_valid_stocks()
            if not valid_codes:
                self.log("无有效股票，退出", "ERROR")
                return False, "无有效股票"

            # 2. 加载 stock_basic 并与有效集合并
            stocks = pd.read_sql("SELECT code, name FROM stock_basic", self.engine)
            stocks = stocks[stocks['code'].isin(valid_codes)]
            total_all = len(stocks)
            self.log(f"有效股票总数: {total_all}")

            # 3. 确定需要更新的股票（新股或超过 refresh_days 天未更新）
            existing = pd.read_sql("SELECT ts_code, update_date FROM stock_financial", self.engine)
            if existing.empty:
                target_codes = set(stocks['code'].astype(str))
                self.log("首次运行，将更新全部有效股票")
            else:
                existing['code'] = existing['ts_code'].str.split('.').str[0]
                existing['days_since'] = existing['update_date'].apply(
                    lambda d: (datetime.now() - datetime.strptime(d, '%Y-%m-%d')).days
                )
                stale_codes = set(existing[existing['days_since'] >= self.refresh_days]['code'])
                new_codes = set(stocks['code'].astype(str)) - set(existing['code'])
                target_codes = stale_codes.union(new_codes)
                self.log(f"需要更新 {len(target_codes)} 只（新股 {len(new_codes)}，过期 {len(stale_codes)}）")

            if not target_codes:
                self.log("所有股票财务数据均为最新，无需更新")
                # 即使没有新财务数据，也可以更新市值（股价每日变化）
                self._update_market_cap_from_local()
                return True, "无需更新"

            # 4. 逐只股票获取数据
            financial_rows = []
            success = 0
            fail = 0
            update_date = datetime.now().strftime('%Y-%m-%d')
            processed = 0

            for idx, row in stocks.iterrows():
                code = str(row['code']).zfill(6)
                if code not in target_codes:
                    continue
                processed += 1
                self.log(f"[{processed}/{len(target_codes)}] 处理 {code}")
                bs_code = self._get_baostock_code(code)
                ts_code = self._get_ts_code(code)

                try:
                    valuation = self._fetch_valuation(bs_code)
                    profit = self._fetch_profit_data(bs_code)
                    shares = self._fetch_total_shares(bs_code)

                    pe_ttm = valuation.get('pe_ttm')
                    pb = valuation.get('pb')
                    roe = profit.get('roe')
                    revenue = profit.get('revenue')
                    net_profit = profit.get('net_profit')
                    float_shares = shares.get('float_shares')

                    # 不再估算总市值，留空，稍后统一用本地收盘价计算
                    total_mv = None

                    if pe_ttm is None and pb is None and roe is None:
                        self.log(f"  无任何财务数据，跳过")
                        fail += 1
                        continue

                    financial_rows.append({
                        'ts_code': ts_code,
                        'pe_ttm': pe_ttm,
                        'pb': pb,
                        'roe': roe,
                        'total_mv': total_mv,
                        'revenue': revenue,
                        'net_profit': net_profit,
                        'float_shares': float_shares,
                        'update_date': update_date,
                    })
                    success += 1
                    self.log(f"  成功: PE={pe_ttm}, PB={pb}, ROE={roe}")

                except Exception as e:
                    self.log(f"处理 {code} 时异常: {e}", "ERROR")
                    fail += 1

                time.sleep(self.request_interval)

            # 5. 写入数据库
            if financial_rows:
                with self.engine.begin() as conn:
                    for r in financial_rows:
                        conn.execute(text("DELETE FROM stock_financial WHERE ts_code = :ts_code"), {"ts_code": r['ts_code']})
                        conn.execute(
                            text("""INSERT INTO stock_financial
                                    (ts_code, pe_ttm, pb, roe, total_mv, revenue, net_profit, float_shares, update_date)
                                    VALUES (:ts_code, :pe_ttm, :pb, :roe, :total_mv, :revenue, :net_profit, :float_shares, :update_date)"""),
                            r
                        )
                self.log(f"成功更新 {len(financial_rows)} 只股票")

            # 6. 更新总市值（基于最新收盘价）
            self._update_market_cap_from_local()

            msg = f"更新完成: 成功 {success}, 失败 {fail}"
            self.log(msg)
            return True, msg

        finally:
            bs.logout()


if __name__ == "__main__":
    db = Database()
    updater = FinancialUpdaterBaostock(db.engine)
    success, msg = updater._safe_run()
    print(msg)
    sys.exit(0 if success else 1)

# 为保持调度器兼容
FinancialUpdater = FinancialUpdaterBaostock