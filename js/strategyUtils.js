// js/strategyUtils.js
// Code generation, config serialization, and validation for the Strategy Factory

// ---- Helpers ----

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

// ---- Per-card condition generators ----

function genMACross(card, idx) {
    var p = card.params;
    var fast = contextName(idx, 'fast');
    var slow = contextName(idx, 'slow');
    var fastP = ctxParam(idx, 'fastPeriod');
    var slowP = ctxParam(idx, 'slowPeriod');
    var lines = [];
    lines.push('# Card ' + idx + ': 均线交叉');
    lines.push(fast + ' = history_bars(stock, ' + fastP + ' + 1, \'1d\', \'close\')');
    lines.push(slow + ' = history_bars(stock, ' + slowP + ' + 1, \'1d\', \'close\')');
    lines.push('if len(' + fast + ') < ' + fastP + ' + 1 or len(' + slow + ') < ' + slowP + ' + 1:');
    lines.push('    return');
    lines.push(fast + '_ma = ' + fast + '[-' + fastP + ':].mean()');
    lines.push(slow + '_ma = ' + slow + '[-' + slowP + ':].mean()');
    lines.push(fast + '_ma_prev = ' + fast + '[:-1][-' + fastP + ':].mean()');
    lines.push(slow + '_ma_prev = ' + slow + '[:-1][-' + slowP + ':].mean()');
    if (p.direction === 'golden') {
        return { code: lines, cond: fast + '_ma_prev <= ' + slow + '_ma_prev and ' + fast + '_ma > ' + slow + '_ma' };
    } else {
        return { code: lines, cond: fast + '_ma_prev >= ' + slow + '_ma_prev and ' + fast + '_ma < ' + slow + '_ma' };
    }
}

function genRSI(card, idx) {
    var p = card.params;
    var closes = contextName(idx, 'closes');
    var periodP = ctxParam(idx, 'period');
    var oversoldP = ctxParam(idx, 'oversold');
    var overboughtP = ctxParam(idx, 'overbought');
    var lines = [];
    lines.push('# Card ' + idx + ': RSI');
    lines.push(closes + ' = history_bars(stock, ' + periodP + ' + 1, \'1d\', \'close\')');
    lines.push('if len(' + closes + ') < ' + periodP + ' + 1:');
    lines.push('    return');
    lines.push(contextName(idx, 'diffs') + ' = np.diff(' + closes + ')');
    lines.push(contextName(idx, 'gains') + ' = np.where(' + contextName(idx, 'diffs') + ' > 0, ' + contextName(idx, 'diffs') + ', 0)');
    lines.push(contextName(idx, 'losses') + ' = np.where(' + contextName(idx, 'diffs') + ' < 0, -' + contextName(idx, 'diffs') + ', 0)');
    lines.push(contextName(idx, 'avg_gain') + ' = ' + contextName(idx, 'gains') + '.mean()');
    lines.push(contextName(idx, 'avg_loss') + ' = ' + contextName(idx, 'losses') + '.mean()');
    lines.push(contextName(idx, 'rsi') + ' = 100.0');
    lines.push('if ' + contextName(idx, 'avg_loss') + ' != 0:');
    lines.push('    ' + contextName(idx, 'rsi') + ' = 100 - 100 / (1 + ' + contextName(idx, 'avg_gain') + ' / ' + contextName(idx, 'avg_loss') + ')');
    if (p.direction === 'oversold_buy') {
        return { code: lines, cond: contextName(idx, 'rsi') + ' < ' + oversoldP };
    } else {
        return { code: lines, cond: contextName(idx, 'rsi') + ' > ' + overboughtP };
    }
}

function genMACD(card, idx) {
    var p = card.params;
    var closeVar = contextName(idx, 'closes');
    var fastP = ctxParam(idx, 'fastPeriod');
    var slowP = ctxParam(idx, 'slowPeriod');
    var sigP = ctxParam(idx, 'signalPeriod');
    var maxP = Math.max(p.fastPeriod, p.slowPeriod);
    var needed = maxP + p.signalPeriod + 3;
    var lines = [];
    lines.push('# Card ' + idx + ': MACD');
    lines.push(closeVar + ' = history_bars(stock, ' + needed + ', \'1d\', \'close\')');
    lines.push('if len(' + closeVar + ') < ' + (p.slowPeriod + p.signalPeriod) + ':');
    lines.push('    return');
    lines.push(contextName(idx, 'ema_fast') + ' = pd.Series(' + closeVar + ').ewm(span=' + fastP + ', adjust=False).mean().values');
    lines.push(contextName(idx, 'ema_slow') + ' = pd.Series(' + closeVar + ').ewm(span=' + slowP + ', adjust=False).mean().values');
    lines.push(contextName(idx, 'dif') + ' = ' + contextName(idx, 'ema_fast') + ' - ' + contextName(idx, 'ema_slow'));
    lines.push(contextName(idx, 'dea') + ' = pd.Series(' + contextName(idx, 'dif') + ').ewm(span=' + sigP + ', adjust=False).mean().values');
    lines.push(contextName(idx, 'dif_cur') + ' = ' + contextName(idx, 'dif') + '[-1]');
    lines.push(contextName(idx, 'dea_cur') + ' = ' + contextName(idx, 'dea') + '[-1]');
    lines.push(contextName(idx, 'dif_prev') + ' = ' + contextName(idx, 'dif') + '[-2]');
    lines.push(contextName(idx, 'dea_prev') + ' = ' + contextName(idx, 'dea') + '[-2]');
    if (p.direction === 'golden') {
        return {
            code: lines,
            cond: contextName(idx, 'dif_prev') + ' <= ' + contextName(idx, 'dea_prev') + ' and ' + contextName(idx, 'dif_cur') + ' > ' + contextName(idx, 'dea_cur')
        };
    } else {
        return {
            code: lines,
            cond: contextName(idx, 'dif_prev') + ' >= ' + contextName(idx, 'dea_prev') + ' and ' + contextName(idx, 'dif_cur') + ' < ' + contextName(idx, 'dea_cur')
        };
    }
}

function genBollinger(card, idx) {
    var p = card.params;
    var closes = contextName(idx, 'closes');
    var periodP = ctxParam(idx, 'period');
    var stdP = ctxParam(idx, 'stdMultiplier');
    var lines = [];
    lines.push('# Card ' + idx + ': 布林带');
    lines.push(closes + ' = history_bars(stock, ' + periodP + ', \'1d\', \'close\')');
    lines.push('if len(' + closes + ') < ' + periodP + ':');
    lines.push('    return');
    lines.push(contextName(idx, 'mid') + ' = ' + closes + '.mean()');
    lines.push(contextName(idx, 'std') + ' = ' + closes + '.std()');
    lines.push(contextName(idx, 'upper') + ' = ' + contextName(idx, 'mid') + ' + ' + stdP + ' * ' + contextName(idx, 'std'));
    lines.push(contextName(idx, 'lower') + ' = ' + contextName(idx, 'mid') + ' - ' + stdP + ' * ' + contextName(idx, 'std'));
    lines.push(contextName(idx, 'last_close') + ' = ' + closes + '[-1]');
    if (p.direction === 'lower_breakout') {
        return { code: lines, cond: contextName(idx, 'last_close') + ' < ' + contextName(idx, 'lower') };
    } else {
        return { code: lines, cond: contextName(idx, 'last_close') + ' > ' + contextName(idx, 'upper') };
    }
}

function genKDJ(card, idx) {
    var p = card.params;
    var nP = ctxParam(idx, 'n');
    var m1P = ctxParam(idx, 'm1');
    var m2P = ctxParam(idx, 'm2');
    var totalNeeded = p.n + Math.max(p.m1, p.m2) + 5;
    var lines = [];
    lines.push('# Card ' + idx + ': KDJ');
    lines.push(contextName(idx, 'highs') + ' = history_bars(stock, ' + totalNeeded + ', \'1d\', \'high\')');
    lines.push(contextName(idx, 'lows') + ' = history_bars(stock, ' + totalNeeded + ', \'1d\', \'low\')');
    lines.push(contextName(idx, 'closes') + ' = history_bars(stock, ' + totalNeeded + ', \'1d\', \'close\')');
    lines.push('if len(' + contextName(idx, 'closes') + ') < ' + totalNeeded + ':');
    lines.push('    return');
    lines.push(contextName(idx, 'high_n') + ' = pd.Series(' + contextName(idx, 'highs') + ').rolling(' + nP + ').max().values[' + (p.n - 1) + ':]');
    lines.push(contextName(idx, 'low_n') + ' = pd.Series(' + contextName(idx, 'lows') + ').rolling(' + nP + ').min().values[' + (p.n - 1) + ':]');
    lines.push(contextName(idx, 'close_n') + ' = ' + contextName(idx, 'closes') + '[' + (p.n - 1) + ':]');
    lines.push(contextName(idx, 'rsv') + ' = np.where(' + contextName(idx, 'high_n') + ' != ' + contextName(idx, 'low_n') + ',');
    lines.push('    (' + contextName(idx, 'close_n') + ' - ' + contextName(idx, 'low_n') + ') / (' + contextName(idx, 'high_n') + ' - ' + contextName(idx, 'low_n') + ') * 100, 50)');
    lines.push(contextName(idx, 'k_vals') + ' = pd.Series(' + contextName(idx, 'rsv') + ').ewm(alpha=1.0/' + m1P + ', adjust=False).mean().values');
    lines.push(contextName(idx, 'd_vals') + ' = pd.Series(' + contextName(idx, 'k_vals') + ').ewm(alpha=1.0/' + m2P + ', adjust=False).mean().values');
    lines.push(contextName(idx, 'k_cur') + ' = ' + contextName(idx, 'k_vals') + '[-1]');
    lines.push(contextName(idx, 'd_cur') + ' = ' + contextName(idx, 'd_vals') + '[-1]');
    lines.push(contextName(idx, 'k_prev') + ' = ' + contextName(idx, 'k_vals') + '[-2]');
    lines.push(contextName(idx, 'd_prev') + ' = ' + contextName(idx, 'd_vals') + '[-2]');
    if (p.direction === 'golden') {
        return {
            code: lines,
            cond: contextName(idx, 'k_prev') + ' <= ' + contextName(idx, 'd_prev') + ' and ' + contextName(idx, 'k_cur') + ' > ' + contextName(idx, 'd_cur')
        };
    } else {
        return {
            code: lines,
            cond: contextName(idx, 'k_prev') + ' >= ' + contextName(idx, 'd_prev') + ' and ' + contextName(idx, 'k_cur') + ' < ' + contextName(idx, 'd_cur')
        };
    }
}

function genVolume(card, idx) {
    var p = card.params;
    var vols = contextName(idx, 'vols');
    var periodP = ctxParam(idx, 'period');
    var multP = ctxParam(idx, 'multiple');
    var lines = [];
    lines.push('# Card ' + idx + ': 成交量放大');
    lines.push(vols + ' = history_bars(stock, ' + periodP + ' + 1, \'1d\', \'volume\')');
    lines.push('if len(' + vols + ') < ' + periodP + ' + 1:');
    lines.push('    return');
    lines.push(contextName(idx, 'avg_vol') + ' = ' + vols + '[:-1].mean()');
    lines.push(contextName(idx, 'cur_vol') + ' = ' + vols + '[-1]');
    return { code: lines, cond: contextName(idx, 'cur_vol') + ' > ' + contextName(idx, 'avg_vol') + ' * ' + multP };
}

// ---- Main code generation ----

export function generateCode(cards) {
    if (!cards || cards.length === 0) {
        return 'def initialize(context):\n    context.stock = "STOCK_CODE_PLACEHOLDER"\n\ndef handle_bar(context, bar_dict):\n    pass\n';
    }

    var hasStopLoss = false;
    var stopLossCard = null;
    var positionCard = null;
    var targetPercent = '1.0';

    for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        if (card.type === 'stop_loss_profit') { hasStopLoss = true; stopLossCard = card; }
        if (card.type === 'position') { positionCard = card; }
    }
    if (positionCard && positionCard.params.positionType === 'fixed') {
        targetPercent = String(positionCard.params.fixedPercent || 1.0);
    }

    return rebuildOutput(cards, hasStopLoss, stopLossCard, positionCard, targetPercent);
}

function rebuildOutput(cards, hasStopLoss, stopLossCard, positionCard, targetPercent) {
    var lines = [];
    lines.push('import numpy as np');
    lines.push('import pandas as pd');
    lines.push('');
    lines.push('def initialize(context):');
    lines.push('    context.stock = "STOCK_CODE_PLACEHOLDER"');

    for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var keys = Object.keys(card.params);
        for (var k = 0; k < keys.length; k++) {
            var key = keys[k];
            var val = card.params[key];
            if (typeof val === 'string') {
                lines.push('    context.' + contextName(i, key) + ' = "' + val + '"');
            } else {
                lines.push('    context.' + contextName(i, key) + ' = ' + val);
            }
        }
    }

    if (hasStopLoss) {
        lines.push('    context._entry_price = 0.0');
        lines.push('    context._entry_date = None');
    }

    lines.push('');
    lines.push('def handle_bar(context, bar_dict):');
    lines.push('    stock = context.stock');
    lines.push('    entry_signals = []');
    lines.push('    exit_signals = []');
    lines.push('');

    // Generate each card's condition block
    for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        if (card.type === 'position') continue;

        var genResult;
        switch (card.type) {
            case 'ma_cross': genResult = genMACross(card, i); break;
            case 'rsi': genResult = genRSI(card, i); break;
            case 'macd': genResult = genMACD(card, i); break;
            case 'bollinger': genResult = genBollinger(card, i); break;
            case 'kdj': genResult = genKDJ(card, i); break;
            case 'volume': genResult = genVolume(card, i); break;
            case 'stop_loss_profit':
                lines.push('    # Card ' + i + ': 止损止盈（参数已记录）');
                lines.push('');
                continue;
            default: continue;
        }

        for (var li = 0; li < genResult.code.length; li++) {
            lines.push('    ' + genResult.code[li]);
        }
        var sigType = card.action === 'buy' ? 'entry' : 'exit';
        lines.push('    ' + sigType + '_signals.append(' + genResult.cond + ')');
        lines.push('');
    }

    // Position and stop loss param extraction
    lines.push('    target_percent = ' + targetPercent);
    if (hasStopLoss && stopLossCard) {
        var slIdx = cards.indexOf(stopLossCard);
        lines.push('    sl_percent = ' + ctxParam(slIdx, 'stopLossPercent'));
        lines.push('    tp_percent = ' + ctxParam(slIdx, 'takeProfitPercent'));
        lines.push('    max_days = ' + ctxParam(slIdx, 'maxHoldDays'));
    }
    lines.push('');

    // Execute entry
    lines.push('    # 执行入场信号');
    lines.push('    if len(entry_signals) > 0 and all(entry_signals):');
    lines.push('        order_target_percent(stock, target_percent)');
    if (hasStopLoss) {
        lines.push('        context._entry_price = bar_dict["close"]');
        lines.push('        context._entry_date = context.current_dt');
    }
    lines.push('        log.info("买入信号触发")');
    lines.push('');

    // Execute exit from exit conditions
    lines.push('    # 执行离场信号');
    lines.push('    if len(exit_signals) > 0 and all(exit_signals):');
    lines.push('        order_target_percent(stock, 0)');
    if (hasStopLoss) {
        lines.push('        context._entry_price = 0.0');
        lines.push('        context._entry_date = None');
    }
    lines.push('        log.info("卖出信号触发")');
    lines.push('');

    // Stop loss / take profit logic (runs independently)
    if (hasStopLoss) {
        lines.push('    # 止损止盈检查');
        lines.push('    positions = context.portfolio.get("holdings", {})');
        lines.push('    stock_pos = positions.get(stock, 0)');
        lines.push('    if stock_pos > 0 and context._entry_price > 0:');
        lines.push('        current_price = bar_dict["close"]');
        lines.push('        pnl_pct = (current_price - context._entry_price) / context._entry_price * 100');
        lines.push('        sl_triggered = pnl_pct <= -sl_percent');
        lines.push('        tp_triggered = pnl_pct >= tp_percent');
        lines.push('        days_triggered = False');
        lines.push('        if context._entry_date is not None:');
        lines.push('            hold_days = (context.current_dt - context._entry_date).days');
        lines.push('            days_triggered = hold_days >= max_days');
        lines.push('        if sl_triggered or tp_triggered or days_triggered:');
        lines.push('            order_target_percent(stock, 0)');
        lines.push('            context._entry_price = 0.0');
        lines.push('            context._entry_date = None');
        lines.push('            if sl_triggered:');
        lines.push('                log.info("止损卖出 (亏损: {:.2f}%)".format(pnl_pct))');
        lines.push('            elif tp_triggered:');
        lines.push('                log.info("止盈卖出 (盈利: {:.2f}%)".format(pnl_pct))');
        lines.push('            else:');
        lines.push('                log.info("持仓天数到期卖出")');
    }

    return lines.join('\n');
}

// ---- Config serialization ----

export function serializeConfig(cards, capital, startDate, endDate) {
    var config = {
        version: 1,
        cards: cards,
        capital: capital || 1000000,
        startDate: startDate || '2010-01-01',
        endDate: endDate || new Date().toISOString().slice(0, 10)
    };
    return JSON.stringify(config);
}

export function deserializeConfig(jsonStr) {
    if (!jsonStr) return null;
    var trimmed = jsonStr.trim();
    if (!trimmed.startsWith('{')) return null;
    try {
        var config = JSON.parse(trimmed);
        if (!config.cards || !Array.isArray(config.cards)) return null;
        return {
            cards: config.cards,
            capital: config.capital || 1000000,
            startDate: config.startDate || '2010-01-01',
            endDate: config.endDate || new Date().toISOString().slice(0, 10)
        };
    } catch (e) {
        return null;
    }
}

// ---- Validation ----

export function validateCards(cards) {
    var errors = [];
    if (!cards || cards.length === 0) {
        errors.push('请至少添加一个条件卡片');
        return { valid: false, errors: errors };
    }
    var hasBuyOrSell = cards.some(function(c) {
        return c.action === 'buy' || c.action === 'sell';
    });
    if (!hasBuyOrSell) {
        errors.push('至少需要一个买入或卖出条件卡片');
    }
    // Check for duplicate IDs
    var ids = {};
    cards.forEach(function(c) {
        if (ids[c.id]) errors.push('卡片ID重复: ' + c.id);
        ids[c.id] = true;
    });
    return { valid: errors.length === 0, errors: errors };
}

// Export card param helper: get default card params for a type
export function getDefaultParams(typeKey) {
    var meta = null;
    // Dynamic import workaround: CARD_TYPE_META is imported by caller
    return null;
}
