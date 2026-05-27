#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""更新股票概念题材数据（使用 AkShare，增强稳定性）"""

import sys
import os
import time
import random
import pandas as pd
from sqlalchemy import text
from backend.db import Database
from backend.base_updater import BaseUpdater

try:
    import akshare as ak
except ImportError:
    print("请先安装 akshare: pip install akshare")
    sys.exit(1)


class ConceptUpdater(BaseUpdater):
    def __init__(self, db_engine):
        super().__init__("concept")
        self.engine = db_engine
        self.max_retries = 5  # 增加重试次数
        self.base_delay = 2  # 初始等待秒数

    def _retry_call(self, func, *args, **kwargs):
        """带指数退避和随机抖动的重试"""
        last_exception = None
        for attempt in range(self.max_retries):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                last_exception = e
                if attempt < self.max_retries - 1:
                    wait = (self.base_delay ** (attempt + 1)) + random.uniform(0, 1)
                    self.log(f"重试 {func.__name__} (尝试 {attempt + 1}/{self.max_retries})，等待 {wait:.1f}s: {e}",
                             "WARN")
                    time.sleep(wait)
                else:
                    self.log(f"重试 {func.__name__} 失败，跳过此项", "ERROR")
                    raise  # 最后一次失败后抛出，由上层捕获并跳过
        raise last_exception

    def needs_update(self) -> bool:
        try:
            df = pd.read_sql("SELECT 1 FROM concept LIMIT 1", self.engine)
            return df.empty
        except Exception:
            return True

    def run(self) -> tuple:
        self.log("开始更新概念题材数据...")

        # 1. 获取所有概念板块列表
        self.log("获取概念板块列表...")
        try:
            concept_list_df = self._retry_call(ak.stock_board_concept_name_em)
        except Exception as e:
            return False, f"获取概念板块列表失败: {e}"

        if concept_list_df.empty:
            return False, "未获取到概念板块列表"

        concepts = concept_list_df['板块名称'].tolist()
        self.log(f"获取到 {len(concepts)} 个概念板块")

        # 2. 准备存储数据
        concept_name_to_id = {}
        stock_concept_pairs = []  # (ts_code, concept_name)

        # 3. 先插入所有概念名称（获取自增ID）
        with self.engine.begin() as conn:
            for name in concepts:
                result = conn.execute(
                    text("INSERT OR IGNORE INTO concept (concept_name) VALUES (:name) RETURNING concept_id"),
                    {"name": name}
                )
                row = result.fetchone()
                if row:
                    concept_name_to_id[name] = row[0]
                else:
                    # 已存在，查询ID
                    row2 = conn.execute(text("SELECT concept_id FROM concept WHERE concept_name = :name"),
                                        {"name": name}).fetchone()
                    if row2:
                        concept_name_to_id[name] = row2[0]

        # 4. 遍历每个概念获取成分股（带跳过机制）
        success_concepts = 0
        fail_concepts = 0
        fail_list = []

        for idx, concept_name in enumerate(concepts):
            self.log(f"[{idx + 1}/{len(concepts)}] 处理概念: {concept_name}")
            try:
                # 获取该概念的成分股
                cons_df = self._retry_call(ak.stock_board_concept_cons_em, symbol=concept_name)
                if cons_df.empty:
                    self.log(f"  概念 {concept_name} 无成分股数据", "WARN")
                    fail_concepts += 1
                    continue

                # 提取股票代码并转换为 ts_code
                codes = cons_df['代码'].tolist()
                for code in codes:
                    code_str = str(code).zfill(6)
                    if code_str.startswith(('6', '9')):
                        ts_code = f"{code_str}.SH"
                    elif code_str.startswith('8'):
                        ts_code = f"{code_str}.BJ"
                    else:
                        ts_code = f"{code_str}.SZ"
                    stock_concept_pairs.append((ts_code, concept_name))

                success_concepts += 1
                self.log(f"  成功，获取 {len(codes)} 只股票")

            except Exception as e:
                self.log(f"  概念 {concept_name} 处理失败: {e}", "ERROR")
                fail_concepts += 1
                fail_list.append(concept_name)
                continue  # 跳过此概念，继续下一个

            # 每处理10个概念休息一下，避免请求过频
            if (idx + 1) % 10 == 0:
                time.sleep(random.uniform(1, 2))

        self.log(f"概念处理完成: 成功 {success_concepts} 个，失败 {fail_concepts} 个")
        if fail_list:
            self.log(f"失败的概念: {', '.join(fail_list[:20])}{'...' if len(fail_list) > 20 else ''}", "WARN")

        # 5. 写入关联表（清空旧数据，全量插入）
        if stock_concept_pairs:
            with self.engine.begin() as conn:
                conn.execute(text("DELETE FROM stock_concept"))
                for ts_code, concept_name in stock_concept_pairs:
                    concept_id = concept_name_to_id.get(concept_name)
                    if concept_id:
                        conn.execute(
                            text("INSERT OR IGNORE INTO stock_concept (ts_code, concept_id) VALUES (:ts, :cid)"),
                            {"ts": ts_code, "cid": concept_id}
                        )
            self.log(f"写入 {len(stock_concept_pairs)} 条股票-概念关联记录")
        else:
            self.log("无有效关联数据写入", "WARN")

        msg = f"概念数据更新完成: 成功概念 {success_concepts}/{len(concepts)}，关联记录 {len(stock_concept_pairs)} 条"
        self.log(msg)
        return True, msg


if __name__ == "__main__":
    db = Database()
    updater = ConceptUpdater(db.engine)
    success, msg = updater._safe_run()
    print(msg)
    sys.exit(0 if success else 1)