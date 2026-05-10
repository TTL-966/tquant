// js/strategyTemplates.js
// Card type metadata and built-in strategy templates for the Strategy Factory

export function generateCardId() {
    return 'card_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
}

// ---- Card Type Definitions ----
export var CARD_TYPE_META = {
    ma_cross: {
        type: 'ma_cross',
        label: '均线交叉',
        icon: '📊',
        description: '快慢均线金叉/死叉信号',
        defaultAction: 'buy',
        defaultParams: { fastPeriod: 5, slowPeriod: 20, direction: 'golden' },
        paramFields: [
            { key: 'fastPeriod', label: '快线周期', type: 'number', min: 2, max: 250, default: 5 },
            { key: 'slowPeriod', label: '慢线周期', type: 'number', min: 3, max: 500, default: 20 },
            { key: 'direction', label: '交叉方向', type: 'select', options: [
                { value: 'golden', label: '金叉（快线上穿慢线）' },
                { value: 'death', label: '死叉（快线下穿慢线）' }
            ], default: 'golden' }
        ]
    },
    rsi: {
        type: 'rsi',
        label: 'RSI 超买超卖',
        icon: '📈',
        description: '相对强弱指标超买超卖信号',
        defaultAction: 'buy',
        defaultParams: { period: 14, oversold: 30, overbought: 70, direction: 'oversold_buy' },
        paramFields: [
            { key: 'period', label: '计算周期', type: 'number', min: 2, max: 100, default: 14 },
            { key: 'oversold', label: '超卖阈值', type: 'number', min: 5, max: 50, default: 30 },
            { key: 'overbought', label: '超买阈值', type: 'number', min: 50, max: 95, default: 70 },
            { key: 'direction', label: '信号方向', type: 'select', options: [
                { value: 'oversold_buy', label: '超卖买入（RSI低于阈值）' },
                { value: 'overbought_sell', label: '超买卖出（RSI高于阈值）' }
            ], default: 'oversold_buy' }
        ]
    },
    macd: {
        type: 'macd',
        label: 'MACD 交叉',
        icon: '📉',
        description: 'MACD 金叉/死叉信号',
        defaultAction: 'buy',
        defaultParams: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, direction: 'golden' },
        paramFields: [
            { key: 'fastPeriod', label: '快线周期', type: 'number', min: 2, max: 50, default: 12 },
            { key: 'slowPeriod', label: '慢线周期', type: 'number', min: 5, max: 100, default: 26 },
            { key: 'signalPeriod', label: '信号线周期', type: 'number', min: 2, max: 30, default: 9 },
            { key: 'direction', label: '交叉方向', type: 'select', options: [
                { value: 'golden', label: '金叉（DIF上穿DEA）' },
                { value: 'death', label: '死叉（DIF下穿DEA）' }
            ], default: 'golden' }
        ]
    },
    bollinger: {
        type: 'bollinger',
        label: '布林带突破',
        icon: '📐',
        description: '价格突破布林带上下轨信号',
        defaultAction: 'buy',
        defaultParams: { period: 20, stdMultiplier: 2, direction: 'lower_breakout' },
        paramFields: [
            { key: 'period', label: '计算周期', type: 'number', min: 5, max: 100, default: 20 },
            { key: 'stdMultiplier', label: '标准差倍数', type: 'number', min: 1, max: 4, step: 0.1, default: 2 },
            { key: 'direction', label: '突破方向', type: 'select', options: [
                { value: 'lower_breakout', label: '跌破下轨买入' },
                { value: 'upper_breakout', label: '突破上轨卖出' }
            ], default: 'lower_breakout' }
        ]
    },
    kdj: {
        type: 'kdj',
        label: 'KDJ 交叉',
        icon: '🔄',
        description: 'KDJ 随机指标金叉/死叉',
        defaultAction: 'buy',
        defaultParams: { n: 9, m1: 3, m2: 3, direction: 'golden' },
        paramFields: [
            { key: 'n', label: 'RSV周期 N', type: 'number', min: 3, max: 50, default: 9 },
            { key: 'm1', label: 'K值平滑 M1', type: 'number', min: 2, max: 10, default: 3 },
            { key: 'm2', label: 'D值平滑 M2', type: 'number', min: 2, max: 10, default: 3 },
            { key: 'direction', label: '交叉方向', type: 'select', options: [
                { value: 'golden', label: '金叉（K上穿D）' },
                { value: 'death', label: '死叉（K下穿D）' }
            ], default: 'golden' }
        ]
    },
    volume: {
        type: 'volume',
        label: '成交量放大',
        icon: '📊',
        description: '成交量突破均量倍数信号',
        defaultAction: 'buy',
        defaultParams: { period: 20, multiple: 1.5 },
        paramFields: [
            { key: 'period', label: '均量周期', type: 'number', min: 5, max: 100, default: 20 },
            { key: 'multiple', label: '放大倍数', type: 'number', min: 1.1, max: 10, step: 0.1, default: 1.5 }
        ]
    },
    stop_loss_profit: {
        type: 'stop_loss_profit',
        label: '止损止盈',
        icon: '🛡️',
        description: '持仓后自动止损止盈和最大持有天数',
        defaultAction: 'sell',
        defaultParams: { stopLossPercent: 5, takeProfitPercent: 10, maxHoldDays: 20 },
        paramFields: [
            { key: 'stopLossPercent', label: '止损百分比(%)', type: 'number', min: 0.5, max: 50, step: 0.5, default: 5 },
            { key: 'takeProfitPercent', label: '止盈百分比(%)', type: 'number', min: 0.5, max: 200, step: 0.5, default: 10 },
            { key: 'maxHoldDays', label: '最大持仓天数', type: 'number', min: 1, max: 365, default: 20 }
        ]
    },
    position: {
        type: 'position',
        label: '仓位管理',
        icon: '⚖️',
        description: '设置每次交易的仓位比例',
        defaultAction: null,
        defaultParams: { positionType: 'fixed', fixedPercent: 1.0 },
        paramFields: [
            { key: 'positionType', label: '仓位类型', type: 'select', options: [
                { value: 'fixed', label: '固定仓位' },
                { value: 'kelly', label: '凯利公式（预留）' }
            ], default: 'fixed' },
            { key: 'fixedPercent', label: '仓位比例', type: 'number', min: 0.01, max: 1.0, step: 0.01, default: 1.0 }
        ]
    }
};

// Helper: deep clone default params for a card type
export function createDefaultCard(typeKey) {
    var meta = CARD_TYPE_META[typeKey];
    if (!meta) return null;
    return {
        id: generateCardId(),
        type: typeKey,
        action: meta.defaultAction,
        params: JSON.parse(JSON.stringify(meta.defaultParams))
    };
}

// ---- Built-in Strategy Templates ----
export var STRATEGY_TEMPLATES = [
    {
        id: 'tpl_dual_ma',
        name: '双均线交叉策略',
        description: '经典金叉买入、死叉卖出。快线MA5上穿慢线MA20时全仓买入，下穿时清仓。',
        defaultStock: '000001',
        cards: [
            { id: generateCardId(), type: 'ma_cross', action: 'buy', params: { fastPeriod: 5, slowPeriod: 20, direction: 'golden' } },
            { id: generateCardId(), type: 'ma_cross', action: 'sell', params: { fastPeriod: 5, slowPeriod: 20, direction: 'death' } },
            { id: generateCardId(), type: 'position', action: null, params: { positionType: 'fixed', fixedPercent: 1.0 } }
        ]
    },
    {
        id: 'tpl_rsi_only',
        name: 'RSI 超买超卖策略',
        description: 'RSI低于30超卖时买入，高于70超买时卖出，配合止损止盈保护。',
        defaultStock: '000001',
        cards: [
            { id: generateCardId(), type: 'rsi', action: 'buy', params: { period: 14, oversold: 30, overbought: 70, direction: 'oversold_buy' } },
            { id: generateCardId(), type: 'rsi', action: 'sell', params: { period: 14, oversold: 30, overbought: 70, direction: 'overbought_sell' } },
            { id: generateCardId(), type: 'stop_loss_profit', action: 'sell', params: { stopLossPercent: 5, takeProfitPercent: 15, maxHoldDays: 30 } },
            { id: generateCardId(), type: 'position', action: null, params: { positionType: 'fixed', fixedPercent: 0.8 } }
        ]
    },
    {
        id: 'tpl_macd_kdj',
        name: 'MACD+KDJ 双确认策略',
        description: 'MACD金叉且KDJ金叉时买入，MACD死叉且KDJ死叉时卖出，双重确认降低假信号。',
        defaultStock: '000001',
        cards: [
            { id: generateCardId(), type: 'macd', action: 'buy', params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, direction: 'golden' } },
            { id: generateCardId(), type: 'kdj', action: 'buy', params: { n: 9, m1: 3, m2: 3, direction: 'golden' } },
            { id: generateCardId(), type: 'macd', action: 'sell', params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, direction: 'death' } },
            { id: generateCardId(), type: 'kdj', action: 'sell', params: { n: 9, m1: 3, m2: 3, direction: 'death' } },
            { id: generateCardId(), type: 'stop_loss_profit', action: 'sell', params: { stopLossPercent: 8, takeProfitPercent: 20, maxHoldDays: 40 } },
            { id: generateCardId(), type: 'position', action: null, params: { positionType: 'fixed', fixedPercent: 1.0 } }
        ]
    },
    {
        id: 'tpl_rsi_boll',
        name: 'RSI+布林带 联合策略',
        description: 'RSI超卖且价格跌破布林下轨时买入，RSI超买且价格突破布林上轨时卖出。',
        defaultStock: '000001',
        cards: [
            { id: generateCardId(), type: 'rsi', action: 'buy', params: { period: 14, oversold: 30, overbought: 70, direction: 'oversold_buy' } },
            { id: generateCardId(), type: 'bollinger', action: 'buy', params: { period: 20, stdMultiplier: 2, direction: 'lower_breakout' } },
            { id: generateCardId(), type: 'rsi', action: 'sell', params: { period: 14, oversold: 30, overbought: 70, direction: 'overbought_sell' } },
            { id: generateCardId(), type: 'bollinger', action: 'sell', params: { period: 20, stdMultiplier: 2, direction: 'upper_breakout' } },
            { id: generateCardId(), type: 'stop_loss_profit', action: 'sell', params: { stopLossPercent: 5, takeProfitPercent: 10, maxHoldDays: 20 } },
            { id: generateCardId(), type: 'position', action: null, params: { positionType: 'fixed', fixedPercent: 0.8 } }
        ]
    },
    {
        id: 'tpl_volume_break',
        name: '放量突破策略',
        description: '成交量放大1.5倍以上且均线金叉时买入，成交量放大且均线死叉时卖出。',
        defaultStock: '000001',
        cards: [
            { id: generateCardId(), type: 'volume', action: 'buy', params: { period: 20, multiple: 1.5 } },
            { id: generateCardId(), type: 'ma_cross', action: 'buy', params: { fastPeriod: 5, slowPeriod: 20, direction: 'golden' } },
            { id: generateCardId(), type: 'volume', action: 'sell', params: { period: 20, multiple: 1.5 } },
            { id: generateCardId(), type: 'ma_cross', action: 'sell', params: { fastPeriod: 5, slowPeriod: 20, direction: 'death' } },
            { id: generateCardId(), type: 'stop_loss_profit', action: 'sell', params: { stopLossPercent: 5, takeProfitPercent: 12, maxHoldDays: 25 } },
            { id: generateCardId(), type: 'position', action: null, params: { positionType: 'fixed', fixedPercent: 1.0 } }
        ]
    },
    {
        id: 'tpl_trend_follow',
        name: '均线多头排列策略',
        description: 'MA5>MA10>MA20>MA30 多头排列且MACD金叉时买入，任意死叉或排列破坏时卖出。',
        defaultStock: '000001',
        cards: [
            { id: generateCardId(), type: 'ma_cross', action: 'buy', params: { fastPeriod: 5, slowPeriod: 10, direction: 'golden' } },
            { id: generateCardId(), type: 'macd', action: 'buy', params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, direction: 'golden' } },
            { id: generateCardId(), type: 'ma_cross', action: 'sell', params: { fastPeriod: 5, slowPeriod: 20, direction: 'death' } },
            { id: generateCardId(), type: 'stop_loss_profit', action: 'sell', params: { stopLossPercent: 6, takeProfitPercent: 18, maxHoldDays: 60 } },
            { id: generateCardId(), type: 'position', action: null, params: { positionType: 'fixed', fixedPercent: 0.7 } }
        ]
    }
];
