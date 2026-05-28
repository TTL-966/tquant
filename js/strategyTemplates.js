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
    bollinger_width: {
        type: 'bollinger_width',
        label: '布林带宽度',
        icon: '📏',
        description: '布林带宽度低于阈值（挤压），预示突破',
        defaultAction: 'buy',
        defaultParams: { period: 20, stdMultiplier: 2, widthThreshold: 0.1 },
        paramFields: [
            { key: 'period', label: '周期', type: 'number', min: 5, max: 100, default: 20 },
            { key: 'stdMultiplier', label: '标准差倍数', type: 'number', min: 1, max: 4, step: 0.1, default: 2 },
            { key: 'widthThreshold', label: '宽度阈值(%)', type: 'number', min: 0.01, max: 0.5, step: 0.01, default: 0.1 }
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
    volume_contraction: {
        type: 'volume_contraction',
        label: '成交量萎缩',
        icon: '📉',
        description: '成交量低于过去 N 日均量的一定比例',
        defaultAction: 'buy',
        defaultParams: { period: 20, ratio: 0.6 },
        paramFields: [
            { key: 'period', label: '均量周期', type: 'number', min: 5, max: 100, default: 20 },
            { key: 'ratio', label: '萎缩比例', type: 'number', min: 0.1, max: 0.9, step: 0.05, default: 0.6 }
        ]
    },
    day_of_week: {
        type: 'day_of_week',
        label: '周几效应',
        icon: '📅',
        description: '指定星期几触发信号',
        defaultAction: 'buy',
        defaultParams: { targetDay: 4 },
        paramFields: [
            { key: 'targetDay', label: '目标星期', type: 'select', options: [
                { value: 0, label: '周一' }, { value: 1, label: '周二' }, { value: 2, label: '周三' },
                { value: 3, label: '周四' }, { value: 4, label: '周五' }
            ], default: 4 }
        ]
    },
    atr_breakout: {
        type: 'atr_breakout',
        label: 'ATR通道突破',
        icon: '🌊',
        description: '基于平均真实波幅的通道突破信号',
        defaultAction: 'buy',
        defaultParams: { period: 14, multiplier: 2, direction: 'upper_breakout' },
        paramFields: [
            { key: 'period', label: 'ATR周期', type: 'number', min: 5, max: 100, default: 14 },
            { key: 'multiplier', label: '通道倍数', type: 'number', min: 0.5, max: 5, step: 0.5, default: 2 },
            { key: 'direction', label: '突破方向', type: 'select', options: [
                { value: 'upper_breakout', label: '突破上轨买入' },
                { value: 'lower_breakout', label: '跌破下轨卖出' }
            ], default: 'upper_breakout' }
        ]
    },
    cci: {
        type: 'cci',
        label: 'CCI商品通道指数',
        icon: '📊',
        description: 'CCI超买超卖信号',
        defaultAction: 'buy',
        defaultParams: { period: 20, oversold: -100, overbought: 100, direction: 'oversold_buy' },
        paramFields: [
            { key: 'period', label: '计算周期', type: 'number', min: 5, max: 100, default: 20 },
            { key: 'oversold', label: '超卖阈值', type: 'number', min: -300, max: 0, default: -100 },
            { key: 'overbought', label: '超买阈值', type: 'number', min: 0, max: 300, default: 100 },
            { key: 'direction', label: '信号方向', type: 'select', options: [
                { value: 'oversold_buy', label: '超卖买入（CCI低于阈值）' },
                { value: 'overbought_sell', label: '超买卖出（CCI高于阈值）' }
            ], default: 'oversold_buy' }
        ]
    },
    ma_alignment: {
        type: 'ma_alignment',
        label: '均线排列',
        icon: '📈',
        description: '多周期均线排列状态信号',
        defaultAction: 'buy',
        defaultParams: { fastPeriod: 5, midPeriod: 10, slowPeriod: 20, direction: 'bullish' },
        paramFields: [
            { key: 'fastPeriod', label: '快线周期', type: 'number', min: 2, max: 50, default: 5 },
            { key: 'midPeriod', label: '中线周期', type: 'number', min: 3, max: 100, default: 10 },
            { key: 'slowPeriod', label: '慢线周期', type: 'number', min: 5, max: 250, default: 20 },
            { key: 'direction', label: '排列方向', type: 'select', options: [
                { value: 'bullish', label: '多头排列买入' },
                { value: 'bearish', label: '空头排列卖出' }
            ], default: 'bullish' }
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
                { value: 'kelly', label: '凯利公式' }
            ], default: 'fixed' },
            { key: 'fixedPercent', label: '仓位比例', type: 'number', min: 0.01, max: 1.0, step: 0.01, default: 1.0 }
        ]
    },
    price_limit: {
        type: 'price_limit',
        label: '涨跌停限制',
        icon: '🚫',
        description: '涨停时禁止买入 / 跌停时禁止卖出',
        defaultAction: 'buy',
        defaultParams: { limitType: 'no_buy_on_limit_up' },
        paramFields: [
            { key: 'limitType', label: '限制类型', type: 'select', options: [
                { value: 'no_buy_on_limit_up', label: '涨停不买入' },
                { value: 'no_sell_on_limit_down', label: '跌停不卖出' },
                { value: 'both', label: '涨停不买且跌停不卖' }
            ], default: 'no_buy_on_limit_up' }
        ]
    },
    sar: {
        type: 'sar',
        label: '抛物线转向(SAR)',
        icon: '🔄',
        description: '价格突破SAR线产生转向信号',
        defaultAction: 'buy',
        defaultParams: { acceleration: 0.02, maxAcceleration: 0.2 },
        paramFields: [
            { key: 'acceleration', label: '初始加速度', type: 'number', min: 0.01, max: 0.1, step: 0.01, default: 0.02 },
            { key: 'maxAcceleration', label: '最大加速度', type: 'number', min: 0.05, max: 0.5, step: 0.01, default: 0.2 }
        ]
    },
    obv: {
        type: 'obv',
        label: '能量潮(OBV)',
        icon: '🌊',
        description: 'OBV上穿/下穿均线信号',
        defaultAction: 'buy',
        defaultParams: { period: 20 },
        paramFields: [
            { key: 'period', label: '均线周期', type: 'number', min: 5, max: 100, default: 20 }
        ]
    },
    hammer_hanging: {
        type: 'hammer_hanging',
        label: '锤子线/吊颈线',
        icon: '🔨',
        description: '反转K线形态识别',
        defaultAction: 'buy',
        defaultParams: { bodyRatio: 0.3, shadowRatio: 0.6 },
        paramFields: [
            { key: 'bodyRatio', label: '实体占比上限', type: 'number', min: 0.1, max: 0.5, step: 0.05, default: 0.3 },
            { key: 'shadowRatio', label: '影线占比下限', type: 'number', min: 0.4, max: 0.9, step: 0.05, default: 0.6 }
        ]
    },
    williams_r: {
        type: 'williams_r',
        label: '威廉指标(%R)',
        icon: '📊',
        description: '威廉%R超买超卖信号',
        defaultAction: 'buy',
        defaultParams: { period: 14, oversold: -80, overbought: -20 },
        paramFields: [
            { key: 'period', label: '计算周期', type: 'number', min: 2, max: 100, default: 14 },
            { key: 'oversold', label: '超卖阈值', type: 'number', min: -100, max: -50, default: -80 },
            { key: 'overbought', label: '超买阈值', type: 'number', min: -50, max: 0, default: -20 }
        ]
    },
    roc: {
        type: 'roc',
        label: '变动率(ROC)',
        icon: '📈',
        description: '价格变化速度，穿越零轴或超阈值信号',
        defaultAction: 'buy',
        defaultParams: { period: 12, threshold: 5, useZeroCross: 'true' },
        paramFields: [
            { key: 'period', label: '对比周期', type: 'number', min: 2, max: 100, default: 12 },
            { key: 'threshold', label: '阈值(%)', type: 'number', min: 0.1, max: 20, step: 0.5, default: 5 },
            { key: 'useZeroCross', label: '使用零轴穿越', type: 'select', options: [
                { value: 'true', label: '是（零轴穿越）' },
                { value: 'false', label: '否（阈值突破）' }
            ], default: 'true' }
        ]
    },
    psy: {
        type: 'psy',
        label: '心理线(PSY)',
        icon: '🧠',
        description: '基于上涨天数比例的情绪指标',
        defaultAction: 'buy',
        defaultParams: { period: 12, oversold: 25, overbought: 75 },
        paramFields: [
            { key: 'period', label: '计算周期', type: 'number', min: 5, max: 50, default: 12 },
            { key: 'oversold', label: '超卖阈值', type: 'number', min: 10, max: 40, default: 25 },
            { key: 'overbought', label: '超买阈值', type: 'number', min: 60, max: 90, default: 75 }
        ]
    },
    pe_below: {
        type: 'pe_below',
        label: '市盈率低于',
        icon: '💹',
        description: '市盈率(TTM)低于指定阈值，适用于价值选股',
        defaultAction: 'buy',
        defaultParams: { maxPE: 20 },
        paramFields: [
            { key: 'maxPE', label: 'PE上限', type: 'number', min: 1, max: 300, default: 20 }
        ]
    },
    pb_below: {
        type: 'pb_below',
        label: '市净率低于',
        icon: '📋',
        description: '市净率低于指定阈值，适用于低估值筛选',
        defaultAction: 'buy',
        defaultParams: { maxPB: 2 },
        paramFields: [
            { key: 'maxPB', label: 'PB上限', type: 'number', min: 0.1, max: 20, step: 0.1, default: 2 }
        ]
    },
    roe_above: {
        type: 'roe_above',
        label: 'ROE高于',
        icon: '🏆',
        description: '净资产收益率高于指定阈值，筛选高盈利能力股票',
        defaultAction: 'buy',
        defaultParams: { minROE: 15 },
        paramFields: [
            { key: 'minROE', label: 'ROE下限(%)', type: 'number', min: 1, max: 100, default: 15 }
        ]
    },
    concept_contains: {
        type: 'concept_contains',
        label: '概念包含',
        icon: '🏷️',
        description: '股票所属概念板块包含指定概念',
        defaultAction: 'buy',
        defaultParams: { concepts: [], match_mode: 'any' },
        paramFields: [
            { key: 'concepts', label: '概念名称', type: 'select', multiple: true, options: [] },
            { key: 'match_mode', label: '匹配模式', type: 'select', options: [
                { value: 'any', label: '包含任意一个' },
                { value: 'all', label: '包含全部' }
            ], default: 'any' }
        ]
    },
    industry_contains: {
        type: 'industry_contains',
        label: '行业包含',
        icon: '🏭',
        description: '股票所属行业为指定行业',
        defaultAction: 'buy',
        defaultParams: { industry: '' },
        paramFields: [
            { key: 'industry', label: '行业名称', type: 'select', options: [] }
        ]
    },
    yesterday_change: {
        type: 'yesterday_change',
        label: '昨日涨幅',
        icon: '📈',
        description: '当日涨跌幅满足指定范围',
        defaultAction: 'buy',
        defaultParams: { minChange: 3, maxChange: 10, includeLimitUp: 'yes', direction: 'up' },
        paramFields: [
            { key: 'minChange', label: '最小涨幅(%)', type: 'number', min: -20, max: 20, step: 0.1, default: 3 },
            { key: 'maxChange', label: '最大涨幅(%)', type: 'number', min: -20, max: 20, step: 0.1, default: 10 },
            { key: 'includeLimitUp', label: '包含涨停', type: 'select', options: [
                { value: 'yes', label: '是' },
                { value: 'no', label: '否（排除涨停）' }
            ], default: 'yes' },
            { key: 'direction', label: '方向', type: 'select', options: [
                { value: 'up', label: '上涨' },
                { value: 'down', label: '下跌' },
                { value: 'both', label: '两者' }
            ], default: 'up' }
        ]
    },
    n_day_high: {
        type: 'n_day_high',
        label: '创N日新高',
        icon: '🔺',
        description: '当日最高价创近N个交易日新高',
        defaultAction: 'buy',
        defaultParams: { n: 20 },
        paramFields: [
            { key: 'n', label: '天数', type: 'number', min: 3, max: 250, default: 20 }
        ]
    },
    n_day_low: {
        type: 'n_day_low',
        label: '创N日新低',
        icon: '🔻',
        description: '当日最低价创近N个交易日新低',
        defaultAction: 'buy',
        defaultParams: { n: 20 },
        paramFields: [
            { key: 'n', label: '天数', type: 'number', min: 3, max: 250, default: 20 }
        ]
    },
    consecutive_up: {
        type: 'consecutive_up',
        label: '连续上涨',
        icon: '⬆️',
        description: '连续N个交易日收阳线上涨',
        defaultAction: 'buy',
        defaultParams: { n: 3 },
        paramFields: [
            { key: 'n', label: '连续天数', type: 'number', min: 2, max: 20, default: 3 }
        ]
    },
    volume_ratio: {
        type: 'volume_ratio',
        label: '量比',
        icon: '📊',
        description: '当日成交量与5日均量的比值在指定范围内',
        defaultAction: 'buy',
        defaultParams: { minRatio: 1.5, maxRatio: 5 },
        paramFields: [
            { key: 'minRatio', label: '最小量比', type: 'number', min: 0.1, max: 20, step: 0.1, default: 1.5 },
            { key: 'maxRatio', label: '最大量比', type: 'number', min: 0.1, max: 50, step: 0.1, default: 5 }
        ]
    },
    realtime_change: {
        type: 'realtime_change',
        label: '实时涨跌幅',
        icon: '⚡',
        description: '当前实时涨跌幅在指定范围内（仅限条件选股，不用于回测）',
        defaultAction: 'buy',
        defaultParams: { minChange: 3, maxChange: 10 },
        paramFields: [
            { key: 'minChange', label: '最小涨幅(%)', type: 'number', min: -20, max: 20, step: 0.1, default: 3 },
            { key: 'maxChange', label: '最大涨幅(%)', type: 'number', min: -20, max: 20, step: 0.1, default: 10 }
        ]
    },
    total_mv_between: {
        type: 'total_mv_between',
        label: '总市值区间',
        icon: '💰',
        description: '总市值在指定范围内（单位：亿元，空值表示无界限）',
        defaultAction: 'buy',
        defaultParams: { min: 0, max: 1000 },
        paramFields: [
            { key: 'min', label: '最小值(亿)', type: 'number', min: 0, max: 100000, step: 10, default: 0 },
            { key: 'max', label: '最大值(亿)', type: 'number', min: 0, max: 100000, step: 10, default: 1000 }
        ]
    },
    float_mv_between: {
        type: 'float_mv_between',
        label: '流通市值区间',
        icon: '💵',
        description: '流通市值在指定范围内（单位：亿元，当前使用总市值近似）',
        defaultAction: 'buy',
        defaultParams: { min: 0, max: 500 },
        paramFields: [
            { key: 'min', label: '最小值(亿)', type: 'number', min: 0, max: 100000, step: 10, default: 0 },
            { key: 'max', label: '最大值(亿)', type: 'number', min: 0, max: 100000, step: 10, default: 500 }
        ]
    },
    float_shares_between: {
        type: 'float_shares_between',
        label: '流通股本区间',
        icon: '📊',
        description: '流通股本在指定范围内（单位：亿股，空值表示无界限）',
        defaultAction: 'buy',
        defaultParams: { min: 0, max: 100 },
        paramFields: [
            { key: 'min', label: '最小值(亿股)', type: 'number', min: 0, max: 10000, step: 1, default: 0 },
            { key: 'max', label: '最大值(亿股)', type: 'number', min: 0, max: 10000, step: 1, default: 100 }
        ]
    },
    fund_flow_single: {
        type: 'fund_flow_single',
        label: '单日资金流向',
        icon: '💰',
        description: '当日主力/超大单/大单/中单/小单净流入超过阈值',
        defaultAction: 'buy',
        defaultParams: { field: 'main_net', direction: 'gt', threshold: 5000 },
        paramFields: [
            { key: 'field', label: '资金类型', type: 'select', options: [
                { value: 'main_net', label: '主力净流入' },
                { value: 'super_net', label: '超大单净流入' },
                { value: 'big_net', label: '大单净流入' },
                { value: 'medium_net', label: '中单净流入' },
                { value: 'small_net', label: '小单净流入' }
            ], default: 'main_net' },
            { key: 'direction', label: '方向', type: 'select', options: [
                { value: 'gt', label: '大于' },
                { value: 'lt', label: '小于' }
            ], default: 'gt' },
            { key: 'threshold', label: '阈值(万元)', type: 'number', min: 0, max: 100000, step: 100, default: 5000 }
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
