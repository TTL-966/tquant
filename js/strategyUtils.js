// stub: simplified public version — full implementation is local only
// ponytail: keeps basic code generation for MA cross and RSI; full version has all card types

import { CARD_TYPE_META } from './strategyTemplates.js';

function indent(text, level) {
    var pad = '';
    for (var i = 0; i < level * 4; i++) pad += ' ';
    return text.split('\n').map(function(line) { return pad + line; }).join('\n');
}

function contextName(cardIdx, key) {
    return 'c' + cardIdx + '_' + key;
}

function ctxParam(cardIdx, key) {
    return 'context.' + contextName(cardIdx, key);
}

function genMACross(card, idx) {
    var p = card.params;
    var fast = contextName(idx, 'fast');
    var slow = contextName(idx, 'slow');
    var fastP = ctxParam(idx, 'fastPeriod');
    var slowP = ctxParam(idx, 'slowPeriod');
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var lines = [];
    lines.push('# Card ' + idx + ': 均线交叉');
    lines.push(fast + ' = history_bars(stock, ' + fastP + ' + 1, \'1d\', \'close\')');
    lines.push(slow + ' = history_bars(stock, ' + slowP + ' + 1, \'1d\', \'close\')');
    lines.push('if len(' + fast + ') < ' + fastP + ' + 1 or len(' + slow + ') < ' + slowP + ' + 1:');
    lines.push('    ' + sigVar + '.append(False)');
    lines.push('else:');
    lines.push('    ' + fast + '_ma = ' + fast + '[-' + fastP + ':].mean()');
    lines.push('    ' + slow + '_ma = ' + slow + '[-' + slowP + ':].mean()');
    lines.push('    ' + fast + '_ma_prev = ' + fast + '[:-1][-' + fastP + ':].mean()');
    lines.push('    ' + slow + '_ma_prev = ' + slow + '[:-1][-' + slowP + ':].mean()');
    lines.push('    if ' + fast + '_ma_prev <= ' + slow + '_ma_prev and ' + fast + '_ma > ' + slow + '_ma:');
    lines.push('        ' + sigVar + '.append(True)');
    lines.push('    else:');
    lines.push('        ' + sigVar + '.append(False)');
    return lines.join('\n');
}

function genRSI(card, idx) {
    var p = card.params;
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var lines = [];
    lines.push('# Card ' + idx + ': RSI');
    lines.push('rsi_vals = rsi(history_bars(stock, ' + ctxParam(idx, 'period') + ' + 1, \'1d\', \'close\'), ' + ctxParam(idx, 'period') + ')');
    lines.push('if len(rsi_vals) == 0 or rsi_vals[-1] is None:');
    lines.push('    ' + sigVar + '.append(False)');
    lines.push('else:');
    if (card.params.direction === 'oversold_buy') {
        lines.push('    ' + sigVar + '.append(rsi_vals[-1] < ' + ctxParam(idx, 'oversold') + ')');
    } else {
        lines.push('    ' + sigVar + '.append(rsi_vals[-1] > ' + ctxParam(idx, 'overbought') + ')');
    }
    return lines.join('\n');
}

var _generators = {
    'ma_cross': genMACross,
    'rsi': genRSI,
};

export function generateCode(cards, config) {
    if (!cards || cards.length === 0) return '# 无策略卡片';
    var lines = [
        '# Auto-generated strategy code (public demo version)',
        '# Full version supports 12+ indicator types',
        '',
        'def user(stock, context, history_bars, rsi, macd):',
        '    entry_signals = []',
        '    exit_signals = []',
        ''
    ];
    for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var gen = _generators[card.type];
        if (gen) {
            lines.push(indent(gen(card, i), 1));
            lines.push('');
        } else {
            lines.push(indent('# Card ' + i + ': ' + (card.type || 'unknown') + ' (仅完整版支持)', 1));
            lines.push('');
        }
    }
    lines.push('    return entry_signals, exit_signals');
    return lines.join('\n');
}

export function serializeConfig(cards, name, config) {
    return JSON.stringify({
        name: name || '',
        cards: cards || [],
        config: config || {},
        _version: 'demo'
    }, null, 2);
}

export function deserializeConfig(json) {
    try {
        var obj = JSON.parse(json);
        return obj || { cards: [], name: '', config: {} };
    } catch (e) {
        return { cards: [], name: '', config: {} };
    }
}

export function validateCards(cards) {
    if (!cards || cards.length === 0) return { valid: false, errors: ['至少需要一个策略卡片'] };
    return { valid: true, errors: [] };
}

export function extractParamsFromCards(cards) {
    var params = {};
    for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        if (card.params) {
            for (var key in card.params) {
                params[contextName(i, key)] = card.params[key];
            }
        }
    }
    return params;
}
