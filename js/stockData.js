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

// 内部降级函数
function fallbackSearch(code, bridge) {
    if (!bridge || typeof bridge.search_stock !== 'function') {
        stockNameMap[code] = code;
        return Promise.resolve(code);
    }
    return bridge.search_stock(code).then(function(jsonStr) {
        var arr = JSON.parse(jsonStr);
        if (Array.isArray(arr) && arr.length > 0) {
            var matched = null;
            for (var i = 0; i < arr.length; i++) {
                if (arr[i].code === code) {
                    matched = arr[i];
                    break;
                }
            }
            var item = matched || arr[0];
            var name = item.name;
            if (name) {
                stockNameMap[code] = name;
                return name;
            }
        }
        stockNameMap[code] = code;
        return code;
    }).catch(function() {
        stockNameMap[code] = code;
        return code;
    });
}

/**
 * 异步获取股票名称并缓存到 stockNameMap
 * 优先使用 bridge.get_stock_name 快速接口
 * @param {string} code - 股票代码
 * @param {object|null} bridge - Qt bridge 对象
 * @returns {Promise<string>} 名称（失败时返回 code）
 */
export function fetchStockName(code, bridge) {
    // 如果 stockNameMap 中已有且不是单纯取 code 自身（即已从后端获取）
    var existing = stockNameMap[code];
    if (existing && existing !== code) {
        return Promise.resolve(existing);
    }
    // ---- 优先使用 get_stock_name（快速接口）----
    if (bridge && typeof bridge.get_stock_name === 'function') {
        return bridge.get_stock_name(code).then(function(jsonStr) {
            var obj = JSON.parse(jsonStr);
            var name = obj && obj.name;
            if (name) {
                stockNameMap[code] = name;
                return name;
            }
            // 如果返回的名字为空，降级到 search_stock
            return fallbackSearch(code, bridge);
        }).catch(function(err) {
            console.error("get_stock_name 失败:", err);
            return fallbackSearch(code, bridge);
        });
    }
    // ---- 降级：使用 search_stock（已改为查小表）----
    return fallbackSearch(code, bridge);
}

/**
 * 搜索建议
 * @param {string} keyword
 * @param {object|null} bridge
 * @returns {Promise<Array<{code: string, name: string}>>}
 */
export function searchStockSuggestions(keyword, bridge) {
    if (!bridge || typeof bridge.search_stock !== 'function') {
        return Promise.resolve([]);
    }
    return bridge.search_stock(keyword).then(function(jsonStr) {
        var arr = JSON.parse(jsonStr);
        if (!Array.isArray(arr)) return [];
        // 转换为统一格式
        return arr.map(function(item) {
            return { code: item.code, name: item.name || item.code };
        });
    }).catch(function() {
        return [];
    });
}