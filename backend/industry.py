import baostock as bs
import pandas as pd
from sqlalchemy import create_engine

import os
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
db_path = os.path.join(base_dir, 'tquant.db')
engine = create_engine(f'sqlite:///{db_path}?check_same_thread=False')


def download_industry_components():
    """
    下载行业成分股数据（每只股票属于哪个行业）
    注意：这个数据变化慢，一个月更新一次即可
    """
    print("正在下载行业成分股数据...")
    lg = bs.login()

    # 获取所有股票的行业分类
    rs = bs.query_stock_industry()

    data = []
    while (rs.error_code == '0') & rs.next():
        row = rs.get_row_data()
        # row: [updateDate, code, code_name, industry, industryClassification]
        data.append(row)

    df = pd.DataFrame(data,
                      columns=['update_date', 'baostock_code', 'stock_name', 'industry', 'industry_classification'])

    # 转换代码格式：sh.600519 → 600519.SH
    def convert_to_db_code(code):
        if code.startswith('sh.'):
            return f"{code[3:]}.SH"
        elif code.startswith('sz.'):
            return f"{code[3:]}.SZ"
        return code

    df['ts_code'] = df['baostock_code'].apply(convert_to_db_code)

    # 存入数据库
    df.to_sql('stock_industry', engine, if_exists='replace', index=False)

    bs.logout()
    print(f"行业成分股数据下载完成，共 {len(df)} 条")
    return df


def get_industry_by_code(ts_code):
    """根据股票代码获取行业"""
    sql = f"SELECT industry FROM stock_industry WHERE ts_code = '{ts_code}'"
    df = pd.read_sql(sql, engine)
    return df['industry'].iloc[0] if not df.empty else None


def get_stocks_by_industry(industry_name):
    """根据行业名称获取成分股列表"""
    sql = f"SELECT ts_code, stock_name FROM stock_industry WHERE industry LIKE '%{industry_name}%'"
    return pd.read_sql(sql, engine)


if __name__ == "__main__":
    download_industry_components()