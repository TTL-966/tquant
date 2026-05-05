// js/stockData.js
export const defaultStockNames = {
    '000001': '平安银行',
    '000858': '五粮液',
    '300750': '宁德时代',
    '600519': '贵州茅台'
};

export const tradeStockLibrary = [
    { time: "2026-01-05 09:35", code: "000001", shares: 800, price: 12.35, mktValue: 9880 },
    { time: "2026-01-12 14:20", code: "000001", shares: 800, price: 13.68, mktValue: 10944 },
    { time: "2026-02-14 10:05", code: "000858", shares: 200, price: 158.2, mktValue: 31640 }
];

export const backtestStrategies = [
    {
        id: 1,
        name: "双均线策略 (5,20)",
        profit: "+23.5%",
        code: "def initialize(context):\n    context.stock = '000001.SZ'\n    context.short_win = 5\n    context.long_win = 20\n\ndef handle_bar(context, bar_dict):\n    short_ma = history_bars(context.stock, context.short_win, '1d', 'close').mean()\n    long_ma = history_bars(context.stock, context.long_win, '1d', 'close').mean()\n    if short_ma > long_ma:\n        order_target_percent(context.stock, 1.0)\n        log.info('买入信号 at 价格:'+ str(bar_dict[context.stock].close))\n    elif short_ma < long_ma:\n        order_target_percent(context.stock, 0)\n        log.info('卖出信号')"
    },
    {
        id: 2,
        name: "RSI 超买超卖",
        profit: "+15.2%",
        code: "def initialize(context):\n    context.stock = '000858.SZ'\n    context.rsi_period = 14\n\ndef handle_bar(context, bar_dict):\n    rsi = RSI(context.stock, context.rsi_period)\n    if rsi < 30:\n        order_target_percent(context.stock, 0.8)\n        log.info('RSI 低吸买入')\n    elif rsi > 70:\n        order_target_percent(context.stock, 0)\n        log.info('RSI 超买卖出')"
    },
    {
        id: 3,
        name: "动量突破策略",
        profit: "+31.8%",
        code: "def initialize(context):\n    context.stock = '300750.SZ'\n    context.window = 20\n\ndef handle_bar(context, bar_dict):\n    prices = history_bars(context.stock, context.window, '1d', 'close')\n    if prices[-1] > max(prices[:-1]):\n        order_target_percent(context.stock, 1.0)\n        log.info('动量突破买入')\n    elif prices[-1] < min(prices[:-1]):\n        order_target_percent(context.stock, 0)"
    }
];

export const dailyHoldings = [
    { date: "2026-01-05", cash: "100,000", dailyProfit: "0.00", cumulative: "0.00" },
    { date: "2026-01-12", cash: "100,980", dailyProfit: "+980", cumulative: "+980" },
    { date: "2026-01-20", cash: "102,300", dailyProfit: "+1,320", cumulative: "+2,300" },
    { date: "2026-02-01", cash: "104,150", dailyProfit: "+1,850", cumulative: "+4,150" }
];

// stockNameMap 初始化为默认值的浅拷贝
export var stockNameMap = Object.assign({}, defaultStockNames);
