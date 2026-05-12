import baostock as bs
import pandas as pd
from sqlalchemy import create_engine, text
from datetime import datetime

# ==================== 配置 ====================
MYSQL_CONFIG = {
    'user': 'root',
    'password': '998867',
    'host': '127.0.0.1',
    'port': 3306,
    'database': 'studb',
}
# =============================================

engine = create_engine(
    f"mysql+pymysql://{MYSQL_CONFIG['user']}:{MYSQL_CONFIG['password']}@{MYSQL_CONFIG['host']}:{MYSQL_CONFIG['port']}/{MYSQL_CONFIG['database']}?charset=utf8mb4"
)

print("=" * 60)
print("新股同步工具（从 Baostock 更新 stock_basic）")
print("=" * 60)

# 登录 Baostock
lg = bs.login()
if lg.error_code != '0':
    print(f"Baostock 登录失败: {lg.error_msg}")
    exit(1)
print("登录 Baostock 成功")

# 获取全市场股票列表（使用最新日期）
today = datetime.now().strftime('%Y-%m-%d')
rs = bs.query_all_stock(day=today)

stock_list = []
while (rs.error_code == '0') & rs.next():
    row = rs.get_row_data()
    stock_list.append(row)

# Baostock 返回的字段: ['code', 'tradeStatus', 'code_name']
df_new = pd.DataFrame(stock_list, columns=['code', 'tradeStatus', 'code_name'])
print(f"Baostock 返回 {len(df_new)} 只证券")


# 只保留 A 股（根据代码格式过滤）
def is_a_stock(code):
    """判断是否为真正的 A 股（排除指数、B股等）"""
    if not code.startswith(('sh.', 'sz.')):
        return False

    # 提取纯数字代码
    pure_code = code.split('.')[1]

    # 上交所 A 股：60xxxx（主板）、68xxxx（科创板）
    if code.startswith('sh.') and pure_code.startswith(('60', '68')):
        return True
    # 深交所 A 股：00xxxx、30xxxx
    if code.startswith('sz.') and pure_code.startswith(('00', '30')):
        return True
    return False


df_a = df_new[df_new['code'].apply(is_a_stock)].copy()
print(f"过滤后 A 股数量: {len(df_a)}")


# 转换为数据库格式 (sh.600519 -> 600519.SH)
def to_db_format(baostock_code):
    if baostock_code.startswith('sh.'):
        return f"{baostock_code[3:]}.SH"
    elif baostock_code.startswith('sz.'):
        return f"{baostock_code[3:]}.SZ"
    return baostock_code


df_a['ts_code'] = df_a['code'].apply(to_db_format)
df_a['pure_code'] = df_a['ts_code'].str.split('.').str[0]

# 获取现有股票
existing = pd.read_sql("SELECT code FROM stock_basic", engine)
existing_codes = set(existing['code'].astype(str))

# 找出新股（不在 stock_basic 中的股票）
new_stocks = df_a[~df_a['pure_code'].isin(existing_codes)].copy()
print(f"发现 {len(new_stocks)} 只新股")

if len(new_stocks) > 0:
    # 准备插入数据
    to_insert = pd.DataFrame({
        'code': new_stocks['pure_code'],
        'name': new_stocks['code_name']
    })

    # 插入新股
    to_insert.to_sql('stock_basic', engine, if_exists='append', index=False)
    print(f"✓ 已添加 {len(to_insert)} 只新股到 stock_basic")

    # 显示新股列表
    print("\n新股列表:")
    for _, row in to_insert.head(30).iterrows():
        print(f"  {row['code']} - {row['name']}")
    if len(to_insert) > 30:
        print(f"  ... 共 {len(to_insert)} 只")
else:
    print("无新股需要添加")

bs.logout()

# 更新 daily 表中新股的名称
print("\n更新日线表中的新股名称...")
with engine.connect() as conn:
    result = conn.execute(text("""
        UPDATE stock_daily_qfq_with_name d
        JOIN stock_basic b ON SUBSTRING_INDEX(d.ts_code, '.', 1) = b.code
        SET d.name = b.name
        WHERE d.name IS NULL
    """))
    print(f"✓ 更新了 {result.rowcount} 条日线数据的名称")

print("\n同步完成！")