// stub: simplified public version - 2 demo card types
// ponytail: full version has 12+ card types + templates
export function generateCardId() {
    return 'card_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
}

export var CARD_TYPE_META = {
    ma_cross: { type: 'ma_cross', label: 'MA Cross', icon: '📊', description: 'Golden/death cross signals', defaultAction: 'buy', defaultParams: { fastPeriod: 5, slowPeriod: 20, direction: 'golden' }, paramFields: [
        { key: 'fastPeriod', label: 'Fast Period', type: 'number', min: 2, max: 250, default: 5 },
        { key: 'slowPeriod', label: 'Slow Period', type: 'number', min: 3, max: 500, default: 20 },
        { key: 'direction', label: 'Direction', type: 'select', options: [{ value: 'golden', label: 'Golden Cross' }, { value: 'death', label: 'Death Cross' }], default: 'golden' }
    ]},
    rsi: { type: 'rsi', label: 'RSI', icon: '📈', description: 'Overbought/oversold signals', defaultAction: 'buy', defaultParams: { period: 14, oversold: 30, overbought: 70, direction: 'oversold_buy' }, paramFields: [
        { key: 'period', label: 'Period', type: 'number', min: 2, max: 100, default: 14 },
        { key: 'oversold', label: 'Oversold', type: 'number', min: 5, max: 50, default: 30 },
        { key: 'overbought', label: 'Overbought', type: 'number', min: 50, max: 95, default: 70 },
        { key: 'direction', label: 'Direction', type: 'select', options: [{ value: 'oversold_buy', label: 'Oversold Buy' }, { value: 'overbought_sell', label: 'Overbought Sell' }], default: 'oversold_buy' }
    ]}
};

export var STRATEGY_TEMPLATES = [
    { name: 'MA Cross Demo', description: 'MA5/MA20 golden cross buy, death cross sell', cards: [
        { id: 'demo_1', type: 'ma_cross', action: 'buy', params: { fastPeriod: 5, slowPeriod: 20, direction: 'golden' } },
        { id: 'demo_2', type: 'ma_cross', action: 'sell', params: { fastPeriod: 5, slowPeriod: 20, direction: 'death' } }
    ]}
];

export function createDefaultCard(type) {
    var meta = CARD_TYPE_META[type];
    if (!meta) return null;
    return { id: generateCardId(), type: type, action: meta.defaultAction || 'buy', params: JSON.parse(JSON.stringify(meta.defaultParams || {})) };
}
