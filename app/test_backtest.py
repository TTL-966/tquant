"""直接测试 BacktestExecutor，排除前端干扰"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.data_feed import DataFeed
from backend.backtest_executor import BacktestExecutor

# 策略代码（简化版，必定产生信号）
strategy_code = """
def initialize(context):
    context.stock = "000001"
    context.short_win = 5
    context.long_win = 20

def handle_bar(context, bar_dict):
    short_arr = history_bars(context.stock, context.short_win, '1d', 'close')
    long_arr = history_bars(context.stock, context.long_win, '1d', 'close')

    # 数据不足则跳过
    if len(short_arr) < context.short_win or len(long_arr) < context.long_win:
        return

    short_ma = sum(short_arr) / len(short_arr)
    long_ma = sum(long_arr) / len(long_arr)

    if short_ma > long_ma:
        order_target_percent(context.stock, 1.0)
        log.info(f"买入信号: short_ma={short_ma:.2f}, long_ma={long_ma:.2f}")
    elif short_ma < long_ma:
        order_target_percent(context.stock, 0)
        log.info(f"卖出信号: short_ma={short_ma:.2f}, long_ma={long_ma:.2f}")
"""

# 初始化
data_feed = DataFeed()
executor = BacktestExecutor(data_feed)

print("=" * 60)
print("开始测试回测引擎...")
print("=" * 60)

# 执行回测
result = executor.run(
    user_code=strategy_code,
    stock_code="000001",
    start_date="2015-01-01",
    end_date="2020-12-31",
    initial_cash=1000000
)

print(f"\n状态: {result.get('status')}")
print(f"错误: {result.get('error', '无')}")
print(f"信号数量: {len(result.get('signals', []))}")
print(f"权益曲线长度: {len(result.get('equity_curve', []))}")
print(f"指标: {result.get('metrics', {})}")

# 打印前5个信号
signals = result.get('signals', [])
if signals:
    print("\n前5个信号:")
    for s in signals[:5]:
        print(f"  {s['date']} {s['type']} {s['code']} 价格={s['price']} 数量={s['shares']}")
else:
    print("\n❌ 无信号产生！")

# 打印部分日志
logs = result.get('logs', [])
print(f"\n日志 ({len(logs)} 条):")
for log in logs[-10:]:
    print(f"  {log}")