import baostock as bs
import pandas as pd
from sqlalchemy import create_engine, text
from datetime import datetime, timedelta
import time

# ==================== 配置 ====================
MYSQL_CONFIG = {
    'user': 'root',
    'password': '998867',
    'host': '127.0.0.1',
    'port': 3306,
    'database': 'studb',
}
TABLE_NAME = 'stock_daily_qfq_with_name'
# =============================================

engine = create_engine(
    f"mysql+pymysql://{MYSQL_CONFIG['user']}:{MYSQL_CONFIG['password']}@{MYSQL_CONFIG['host']}:{MYSQL_CONFIG['port']}/{MYSQL_CONFIG['database']}?charset=utf8mb4"
)

print("=" * 60)
print("Baostock 每日增量更新（增强版）")
print("=" * 60)

# ==================== 加载股票名称映射 ====================
print("\n[0] 加载股票名称映射...")
try:
    name_df = pd.read_sql("SELECT code, name FROM stock_basic", engine)
    name_dict = dict(zip(name_df['code'], name_df['name']))
    expected_stock_count = len(name_df)
    print(f"加载完成，共 {len(name_dict)} 只股票")
except Exception as e:
    print(f"加载名称映射失败: {e}")
    name_dict = {}
    expected_stock_count = 0

# ==================== 1. 获取数据库中最新日期 ====================
print("\n[1] 查询本地最新数据日期...")
try:
    result = pd.read_sql(f"SELECT MAX(trade_date) as last_date FROM {TABLE_NAME}", engine)
    latest_date = result['last_date'].iloc[0]
    if not latest_date:
        print("本地无数据，请先运行全量下载脚本")
        exit(1)
    latest_dt = datetime.strptime(latest_date, '%Y-%m-%d')
    start_date = (latest_dt + timedelta(days=1)).strftime('%Y-%m-%d')
    print(f"本地最新日期: {latest_date}")
    print(f"增量起始日期: {start_date}")
except Exception as e:
    print(f"查询失败: {e}")
    exit(1)

# ==================== 1.5 检查当天数据完整性（关键修复） ====================
today = datetime.now().strftime('%Y-%m-%d')
if latest_date == today and expected_stock_count > 0:
    try:
        count_today = pd.read_sql(
            f"SELECT COUNT(DISTINCT ts_code) FROM {TABLE_NAME} WHERE trade_date = '{today}'",
            engine
        ).iloc[0, 0]
        # 如果当天数据少于预期股票的 95%，认为不完整，删除今天数据重新下载
        if count_today < expected_stock_count * 0.95:
            print(f"⚠️ 发现 {today} 的数据不完整（实际 {count_today} 只，预期约 {expected_stock_count} 只）")
            print("将删除今天的不完整数据并重新下载")
            with engine.connect() as conn:
                conn.execute(text(f"DELETE FROM {TABLE_NAME} WHERE trade_date = '{today}'"))
            # 重置最新日期为昨天
            latest_dt = datetime.strptime(today, '%Y-%m-%d') - timedelta(days=1)
            latest_date = latest_dt.strftime('%Y-%m-%d')
            start_date = today
            print(f"重置后增量起始日期: {start_date}")
        else:
            print(f"✓ {today} 数据完整性检查通过（{count_today} 只股票）")
    except Exception as e:
        print(f"完整性检查失败: {e}，将继续尝试增量下载")

# ==================== 2. 获取今日日期 ====================
end_date = datetime.now().strftime('%Y-%m-%d')

# ==================== 3. 判断是否需要更新 ====================
if datetime.strptime(start_date, '%Y-%m-%d') > datetime.now():
    print("\n数据已是最新，无需更新！")
    exit(0)

# ==================== 4. 登录 Baostock（带重试） ====================
max_retries = 3
for attempt in range(max_retries):
    lg = bs.login()
    if lg.error_code == '0':
        print("登录 Baostock 成功")
        break
    else:
        print(f"Baostock 登录失败 (尝试 {attempt+1}/{max_retries}): {lg.error_msg}")
        time.sleep(2)
else:
    print("Baostock 登录失败，无法更新")
    exit(1)

# ==================== 5. 获取需要更新的股票列表 ====================
print("\n[2] 获取需要更新的股票列表...")

existing_stocks = pd.read_sql(f"SELECT DISTINCT ts_code FROM {TABLE_NAME}", engine)
print(f"数据库中有 {len(existing_stocks)} 只股票")

# ==================== 6. 逐只股票增量更新 ====================
print(f"\n[3] 开始增量更新（日期范围: {start_date} 至 {end_date}）...")
success_count = 0
fail_count = 0

for idx, row in existing_stocks.iterrows():
    ts_code = row['ts_code']  # 格式: '600519.SH'

    # 转换为 Baostock 格式: '600519.SH' → 'sh.600519'
    if ts_code.endswith('.SH'):
        bs_code = f"sh.{ts_code[:-3]}"
    else:
        bs_code = f"sz.{ts_code[:-3]}"

    print(f"[{idx + 1}/{len(existing_stocks)}] 更新 {bs_code}...", end=' ', flush=True)

    try:
        k_rs = bs.query_history_k_data_plus(
            bs_code,
            "date,open,high,low,close,volume,amount",
            start_date=start_date,
            end_date=end_date,
            adjustflag='2'  # 前复权
        )

        data_list = []
        while (k_rs.error_code == '0') & k_rs.next():
            data_list.append(k_rs.get_row_data())

        if data_list:
            df = pd.DataFrame(data_list, columns=['trade_date', 'open', 'high', 'low', 'close', 'vol', 'amount'])
            numeric_cols = ['open', 'high', 'low', 'close', 'vol', 'amount']
            for col in numeric_cols:
                df[col] = pd.to_numeric(df[col], errors='coerce')

            df['ts_code'] = ts_code
            # 添加股票名称
            code_num = ts_code.split('.')[0]
            df['name'] = name_dict.get(code_num, None)

            df.to_sql(TABLE_NAME, engine, if_exists='append', index=False)
            success_count += 1
            print(f"✓ {len(df)} 条新数据")
        else:
            print(f"- 无新数据")

    except Exception as e:
        fail_count += 1
        print(f"✗ 错误: {e}")

    time.sleep(0.3)  # 适当放慢，避免触发 Baostock 限制

bs.logout()

# ==================== 7. 输出结果 ====================
print("\n" + "=" * 60)
print(f"增量更新完成！")
print(f"  成功更新: {success_count} 只股票")
print(f"  失败: {fail_count} 只股票")
print(f"  更新日期范围: {start_date} 至 {end_date}")
print("=" * 60)

# ==================== 8. 验证更新结果 ====================
print("\n[4] 验证更新结果...")
new_stats = pd.read_sql(f"SELECT MAX(trade_date) as last_date FROM {TABLE_NAME}", engine)
print(f"数据库最新日期: {new_stats['last_date'].iloc[0]}")

# 检查今天的数据完整性及名称情况
today = datetime.now().strftime('%Y-%m-%d')
count_today = pd.read_sql(
    f"SELECT COUNT(DISTINCT ts_code) FROM {TABLE_NAME} WHERE trade_date = '{today}'",
    engine
).iloc[0, 0]
null_check = pd.read_sql(
    f"SELECT COUNT(*) as cnt FROM {TABLE_NAME} WHERE trade_date = '{today}' AND name IS NULL",
    engine
)
if null_check['cnt'].iloc[0] > 0:
    print(f"⚠️ 警告：{today} 的数据中有 {null_check['cnt'].iloc[0]} 条记录名称为 NULL")
else:
    print(f"✓ {today} 的数据名称全部正常")

if expected_stock_count > 0 and count_today < expected_stock_count * 0.95:
    print(f"⚠️ 警告：{today} 数据量偏少（{count_today}/{expected_stock_count}），可能存在缺失，建议次日重试")
else:
    print(f"✓ {today} 数据完整性良好（{count_today} 只股票）")