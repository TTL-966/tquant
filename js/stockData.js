// js/stockData.js
// 股票数据模块

export var stockNameMap = {
    '000001': '平安银行',
    '000858': '五粮液',
    '300750': '宁德时代',
    '600519': '贵州茅台',
    '002415': '海康威视',
    '000333': '美的集团'
};

// tradeStockLibrary: 每个对象包含 code, shares（成交股数），用于排序
export var tradeStockLibrary = [
    { code: '000001', shares: 80000, name: '平安银行' },
    { code: '000858', shares: 60000, name: '五粮液' },
    { code: '300750', shares: 40000, name: '宁德时代' },
    { code: '600519', shares: 20000, name: '贵州茅台' },
    { code: '002415', shares: 15000, name: '海康威视' },
    { code: '000333', shares: 10000, name: '美的集团' }
];

export var backtestStrategies = [
    { id: 1, name: '双均线策略', code: 'def initialize(context):\n    context.stock = "000001.SZ"\n    context.short_win = 5\n    context.long_win = 20\n\ndef handle_bar(context, bar_dict):\n    short_ma = history_bars(context.stock, context.short_win, \'1d\', \'close\').mean()\n    long_ma = history_bars(context.stock, context.long_win, \'1d\', \'close\').mean()\n    if short_ma > long_ma:\n        order_target_percent(context.stock, 1.0)\n        log.info("买入信号")\n    elif short_ma < long_ma:\n        order_target_percent(context.stock, 0)\n        log.info("卖出信号")', profit: '+23.5%' },
    { id: 2, name: 'RSI策略', code: 'def initialize(context):\n    context.stock = "000001.SZ"\n    context.period = 14\n\ndef handle_bar(context, bar_dict):\n    close_prices = history_bars(context.stock, context.period, \'1d\', \'close\')\n    if len(close_prices) < context.period:\n        return\n    gains = sum(close_prices[1:] - close_prices[:-1] > 0)\n    losses = sum(close_prices[1:] - close_prices[:-1] < 0)\n    if losses == 0:\n        rsi = 100\n    else:\n        rs = gains / losses\n        rsi = 100 - (100 / (1 + rs))\n    if rsi < 30:\n        order_target_percent(context.stock, 1.0)\n        log.info("超卖买入")\n    elif rsi > 70:\n        order_target_percent(context.stock, 0)\n        log.info("超买卖出")', profit: '+18.2%' },
    { id: 3, name: '布林带策略', code: 'def initialize(context):\n    context.stock = "000001.SZ"\n    context.period = 20\n    context.std = 2\n\ndef handle_bar(context, bar_dict):\n    prices = history_bars(context.stock, context.period, \'1d\', \'close\')\n    if len(prices) < context.period:\n        return\n    ma = np.mean(prices)\n    std = np.std(prices)\n    upper = ma + context.std * std\n    lower = ma - context.std * std\n    if prices[-1] > upper:\n        order_target_percent(context.stock, 0)\n        log.info("突破上轨卖出")\n    elif prices[-1] < lower:\n        order_target_percent(context.stock, 1.0)\n        log.info("跌破下轨买入")', profit: '+15.6%' }
];

export var dailyHoldings = [
    { date: '2026-01-05', cash: '¥998,400.00', dailyProfit: '+3,200.00', cumulative: '+3,200.00' },
    { date: '2026-01-12', cash: '¥1,010,560.00', dailyProfit: '+12,160.00', cumulative: '+15,360.00' },
    { date: '2026-01-20', cash: '¥997,120.00', dailyProfit: '-13,440.00', cumulative: '+1,920.00' },
    { date: '2026-02-01', cash: '¥1,023,040.00', dailyProfit: '+25,920.00', cumulative: '+27,840.00' },
    { date: '2026-02-14', cash: '¥1,045,760.00', dailyProfit: '+22,720.00', cumulative: '+50,560.00' }
];

// 异步获取股票名称（可扩展为调用后端接口）
export function fetchStockName(code, bridge) {
    return new Promise(function(resolve) {
        if (stockNameMap[code]) {
            resolve(stockNameMap[code]);
        } else if (bridge && typeof bridge.search_stock === 'function') {
            bridge.search_stock(code).then(function(jsonStr) {
                var results = JSON.parse(jsonStr);
                if (results.length > 0 && results[0].name) {
                    stockNameMap[code] = results[0].name;
                }
                resolve(stockNameMap[code] || code);
            }).catch(function() {
                resolve(code);
            });
        } else {
            resolve(code);
        }
    });
}

// 异步搜索建议（可选实现，使用后端 search_stock）
export function searchStockSuggestions(query, bridge) {
    if (!bridge || typeof bridge.search_stock !== 'function') {
        return Promise.resolve([]);
    }
    return bridge.search_stock(query).then(function(jsonStr) {
        return JSON.parse(jsonStr);
    }).catch(function() {
        return [];
    });
}
