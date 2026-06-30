// stub: simplified public version — full implementation is local only
// ponytail: keeps 2 demo card types; full version has 12+ card types + templates

export function generateCardId() {
    return 'card_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
}

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
                { value: 'oversold_buy', label: '超卖买入' },
                { value: 'overbought_sell', label: '超买卖出' }
            ], default: 'oversold_buy' }
        ]
    }
};

export var STRATEGY_TEMPLATES = [
    {
        name: '均线交叉策略（示例）',
        description: 'MA5/MA20 金叉买入，死叉卖出',
        cards: [
            { id: 'demo_1', type: 'ma_cross', action: 'buy', params: { fastPeriod: 5, slowPeriod: 20, direction: 'golden' } },
            { id: 'demo_2', type: 'ma_cross', action: 'sell', params: { fastPeriod: 5, slowPeriod: 20, direction: 'death' } }
        ]
    }
];

export function createDefaultCard(type) {
    var meta = CARD_TYPE_META[type];
    if (!meta) return null;
    return {
        id: generateCardId(),
        type: type,
        action: meta.defaultAction || 'buy',
        params: JSON.parse(JSON.stringify(meta.defaultParams || {}))
    };
}
