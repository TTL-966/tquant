#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MySQL → SQLite 数据迁移脚本（高性能完整版）
使用原生 sqlite3 + INSERT OR IGNORE + 性能优化
解决主键冲突问题，速度可达 5000-15000 条/秒
"""

import os
import sys
import time
import argparse
import sqlite3
import pandas as pd
from sqlalchemy import create_engine, text

# ---------- 配置 ----------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, 'tquant.db')

MYSQL_CONFIG = {
    'user': 'root',
    'password': '998867',
    'host': '127.0.0.1',
    'port': 3306,
    'database': 'studb',
    'charset': 'utf8mb4',
}


def get_mysql_engine():
    cfg = MYSQL_CONFIG
    url = (f"mysql+pymysql://{cfg['user']}:{cfg['password']}@"
           f"{cfg['host']}:{cfg['port']}/{cfg['database']}"
           f"?charset={cfg['charset']}")
    return create_engine(url, echo=False)


def get_sqlite_engine():
    return create_engine(f'sqlite:///{DB_PATH}?check_same_thread=False', echo=False)


# ---------- 初始化 SQLite 表结构 ----------
def init_sqlite_tables(sqlite_conn):
    """创建所有需要的表（与 db.py 保持一致）"""
    sqlite_conn.execute(text("""
        CREATE TABLE IF NOT EXISTS stock_daily_qfq_with_name (
            ts_code TEXT,
            name TEXT,
            trade_date TEXT,
            open REAL,
            high REAL,
            low REAL,
            close REAL,
            vol INTEGER,
            amount REAL,
            PRIMARY KEY (ts_code, trade_date)
        )
    """))
    sqlite_conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_ts_code_trade_date
        ON stock_daily_qfq_with_name(ts_code, trade_date)
    """))
    sqlite_conn.execute(text("""
        CREATE TABLE IF NOT EXISTS stock_basic (
            code TEXT PRIMARY KEY,
            name TEXT
        )
    """))
    sqlite_conn.execute(text("""
        CREATE TABLE IF NOT EXISTS stock_industry (
            ts_code TEXT PRIMARY KEY,
            stock_name TEXT,
            industry TEXT,
            industry_classification TEXT
        )
    """))
    sqlite_conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_stock_industry_industry
        ON stock_industry(industry)
    """))
    sqlite_conn.execute(text("""
        CREATE TABLE IF NOT EXISTS index_components (
            index_code TEXT,
            stock_code TEXT,
            update_date TEXT,
            PRIMARY KEY (index_code, stock_code)
        )
    """))
    sqlite_conn.commit()
    print("[OK] SQLite 表结构初始化完成")


# ---------- 迁移小表（使用 pandas to_sql）----------
def migrate_stock_basic(mysql_engine, sqlite_engine):
    print("\n" + "=" * 60)
    print("开始迁移 stock_basic（股票基础信息）")
    try:
        with mysql_engine.connect() as conn:
            df = pd.read_sql("SELECT code, name FROM stock_basic", conn)
        if df.empty:
            print("stock_basic 表为空，跳过")
            return
        df.to_sql('stock_basic', sqlite_engine, if_exists='replace', index=False)
        print(f"[OK] stock_basic 迁移完成，共 {len(df)} 条")
    except Exception as e:
        print(f"[WARN] stock_basic 迁移失败: {e}")


def migrate_stock_industry(mysql_engine, sqlite_engine):
    print("\n" + "=" * 60)
    print("开始迁移 stock_industry（行业分类）")
    try:
        with mysql_engine.connect() as conn:
            df = pd.read_sql(
                "SELECT ts_code, stock_name, industry, industry_classification "
                "FROM stock_industry", conn
            )
        if df.empty:
            print("stock_industry 表为空，跳过")
            return
        df.to_sql('stock_industry', sqlite_engine, if_exists='replace', index=False)
        print(f"[OK] stock_industry 迁移完成，共 {len(df)} 条")
    except Exception as e:
        print(f"[WARN] stock_industry 迁移失败: {e}")


# ---------- 迁移日线表（核心优化版）----------
def migrate_daily_kline(mysql_engine, sqlite_engine, chunk_size=200000):
    print("\n" + "=" * 60)
    print("开始迁移 stock_daily_qfq_with_name（日线数据 - 高性能版）")

    # 获取 MySQL 总行数
    with mysql_engine.connect() as conn:
        total_rows = pd.read_sql(
            "SELECT COUNT(*) AS cnt FROM stock_daily_qfq_with_name", conn
        ).iloc[0, 0]
    print(f"MySQL 中共有 {total_rows:,} 条日线记录")

    # 获取原生 SQLite 连接
    sqlite_raw_conn = sqlite_engine.raw_connection()
    cursor = sqlite_raw_conn.cursor()

    # ========== SQLite 性能优化 ==========
    print("配置 SQLite 性能参数...")
    cursor.execute("PRAGMA journal_mode = WAL")  # WAL 模式，读写不阻塞
    cursor.execute("PRAGMA synchronous = NORMAL")  # 减少磁盘同步次数
    cursor.execute("PRAGMA cache_size = -1000000")  # 1GB 页面缓存（负数表示 KB）
    cursor.execute("PRAGMA temp_store = MEMORY")  # 临时表放内存
    cursor.execute("PRAGMA mmap_size = 1073741824")  # 1GB 内存映射
    cursor.execute("PRAGMA page_size = 4096")  # 页面大小（需要在创建表前设置）
    cursor.execute("PRAGMA foreign_keys = OFF")  # 关闭外键检查
    cursor.execute("PRAGMA count_changes = OFF")  # 关闭变化计数
    cursor.execute("PRAGMA automatic_index = OFF")  # 关闭自动索引

    # 预编译 INSERT OR IGNORE 语句
    insert_sql = """
        INSERT OR IGNORE INTO stock_daily_qfq_with_name 
        (ts_code, name, trade_date, open, high, low, close, vol, amount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """

    # 开启显式事务
    cursor.execute("BEGIN TRANSACTION")
    print("SQLite 优化完成\n")

    offset = 0
    inserted_total = 0
    skipped_total = 0
    start_time = time.time()
    batch_count = 0
    commit_interval = 10  # 每 10 批提交一次（200 万条）

    while offset < total_rows:
        # 从 MySQL 分批读取数据
        sql = text(
            "SELECT ts_code, name, trade_date, open, high, low, close, vol, amount "
            "FROM stock_daily_qfq_with_name "
            "ORDER BY ts_code, trade_date "
            "LIMIT :limit OFFSET :offset"
        )
        with mysql_engine.connect() as conn:
            df = pd.read_sql(sql, conn, params={"limit": chunk_size, "offset": offset})

        if df.empty:
            break

        # 将 DataFrame 转换为元组列表
        data = [tuple(row) for row in df.itertuples(index=False)]

        # 批量执行 INSERT OR IGNORE
        try:
            cursor.executemany(insert_sql, data)
            inserted = cursor.rowcount
            inserted_total += inserted
            skipped_total += (len(data) - inserted)

            batch_count += 1
            # 定期提交，避免事务过大
            if batch_count % commit_interval == 0:
                cursor.execute("COMMIT")
                cursor.execute("BEGIN TRANSACTION")

        except Exception as e:
            print(f"\n⚠️ 批量插入失败 (offset={offset}): {e}")
            cursor.execute("ROLLBACK")
            cursor.execute("BEGIN TRANSACTION")
            # 降级为逐条插入
            for row in data:
                try:
                    cursor.execute(insert_sql, row)
                    inserted_total += 1
                except Exception as inner_e:
                    skipped_total += 1
                    if "UNIQUE constraint failed" not in str(inner_e):
                        print(f"逐条插入失败: {inner_e}")
            cursor.execute("COMMIT")
            cursor.execute("BEGIN TRANSACTION")

        offset += chunk_size
        progress = min(offset, total_rows)
        elapsed = time.time() - start_time

        if elapsed > 0:
            rate = progress / elapsed
            remaining = (total_rows - progress) / rate if rate > 0 else 0

            # 动态显示进度
            progress_pct = progress / total_rows * 100
            eta_hours = remaining / 3600
            eta_minutes = (remaining % 3600) / 60

            if eta_hours >= 1:
                eta_str = f"{int(eta_hours)}时{int(eta_minutes)}分"
            else:
                eta_str = f"{int(eta_minutes)}分"

            print(f"\r  进度: {progress:,}/{total_rows:,} ({progress_pct:.1f}%) "
                  f"已插入 {inserted_total:,} 条, 跳过 {skipped_total:,} 条 "
                  f"速度: {rate:.0f} 条/秒 "
                  f"预计剩余: {eta_str}", end='', flush=True)

    # 最后提交剩余数据
    cursor.execute("COMMIT")
    cursor.close()
    sqlite_raw_conn.close()

    print()
    elapsed = time.time() - start_time
    elapsed_min = elapsed / 60
    print(f"[OK] 日线数据迁移完成 (耗时 {elapsed_min:.1f} 分钟, 插入 {inserted_total:,} 条, 跳过 {skipped_total:,} 条)")


# ---------- 主函数 ----------
def main():
    parser = argparse.ArgumentParser(description="MySQL → SQLite 数据迁移（高性能版）")
    parser.add_argument('--skip-kline', action='store_true', help='跳过大体积日线表迁移')
    parser.add_argument('--chunk-size', type=int, default=200000,
                        help='日线迁移块大小（默认200000，建议100000-500000）')
    parser.add_argument('--dry-run', action='store_true', help='仅检查数据量，不实际迁移')
    args = parser.parse_args()

    print("=" * 60)
    print("Tquant MySQL → SQLite 数据迁移工具（高性能版）")
    print(f"目标文件: {DB_PATH}")
    print("=" * 60)

    # 连接 MySQL
    print("\n[1/4] 连接 MySQL...")
    try:
        mysql_engine = get_mysql_engine()
        with mysql_engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        print("[OK] MySQL 连接成功")
    except Exception as e:
        print(f"[ERROR] MySQL 连接失败: {e}")
        print("请确认 MySQL 服务已启动，且配置正确")
        sys.exit(1)

    # 连接/创建 SQLite
    print("\n[2/4] 初始化 SQLite...")
    sqlite_engine = get_sqlite_engine()
    with sqlite_engine.connect() as conn:
        init_sqlite_tables(conn)

    if args.dry_run:
        print("\n[dry-run 模式] 仅统计数据量：")
        for table in ['stock_daily_qfq_with_name', 'stock_basic', 'stock_industry']:
            try:
                with mysql_engine.connect() as conn:
                    cnt = pd.read_sql(f"SELECT COUNT(*) FROM {table}", conn).iloc[0, 0]
                print(f"  {table}: {cnt:,} 条")
            except Exception:
                print(f"  {table}: 表不存在或无法读取")
        return

    # 迁移
    print("\n[3/4] 开始数据迁移...")
    migrate_stock_basic(mysql_engine, sqlite_engine)
    migrate_stock_industry(mysql_engine, sqlite_engine)

    if args.skip_kline:
        print("\n[SKIP] 已跳过日线表迁移")
    else:
        migrate_daily_kline(mysql_engine, sqlite_engine, chunk_size=args.chunk_size)

    # 验证
    print("\n[4/4] 验证 SQLite 数据...")
    with sqlite_engine.connect() as conn:
        for table in ['stock_daily_qfq_with_name', 'stock_basic', 'stock_industry']:
            try:
                cnt = pd.read_sql(f"SELECT COUNT(*) FROM {table}", conn).iloc[0, 0]
                print(f"  SQLite.{table}: {cnt:,} 条")
            except Exception:
                print(f"  SQLite.{table}: 表不存在")

    mysql_engine.dispose()
    sqlite_engine.dispose()
    print("\n" + "=" * 60)
    print("迁移完成！")
    print(f"SQLite 数据库: {DB_PATH}")
    print("=" * 60)


if __name__ == "__main__":
    main()