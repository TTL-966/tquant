// js/strategyUtils.js
// Code generation, config serialization, and validation for the Strategy Factory

import { CARD_TYPE_META } from './strategyTemplates.js';

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
    if (p.direction === 'golden') {
        lines.push('    ' + sigVar + '.append(' + fast + '_ma_prev <= ' + slow + '_ma_prev and ' + fast + '_ma > ' + slow + '_ma)');
    } else {
        lines.push('    ' + sigVar + '.append(' + fast + '_ma_prev >= ' + slow + '_ma_prev and ' + fast + '_ma < ' + slow + '_ma)');
    }
    var reason = p.direction === 'golden'
        ? 'MA' + p.fastPeriod + '上穿MA' + p.slowPeriod + '金叉' + (card.action === 'buy' ? '买入' : '卖出')
        : 'MA' + p.fastPeriod + '下穿MA' + p.slowPeriod + '死叉' + (card.action === 'buy' ? '买入' : '卖出');
    return { code: lines, cond: '', reason: reason };
}

function genRSI(card, idx) {
    var p = card.params;
    var closes = contextName(idx, 'closes');
    var periodP = ctxParam(idx, 'period');
    var oversoldP = ctxParam(idx, 'oversold');
    var overboughtP = ctxParam(idx, 'overbought');
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var lines = [];
    lines.push('# Card ' + idx + ': RSI');
    lines.push(closes + ' = history_bars(stock, ' + periodP + ' + 1, \'1d\', \'close\')');
    lines.push('if len(' + closes + ') < ' + periodP + ' + 1:');
    lines.push('    ' + sigVar + '.append(False)');
    lines.push('else:');
    lines.push('    ' + contextName(idx, 'diffs') + ' = np.diff(' + closes + ')');
    lines.push('    ' + contextName(idx, 'gains') + ' = np.where(' + contextName(idx, 'diffs') + ' > 0, ' + contextName(idx, 'diffs') + ', 0)');
    lines.push('    ' + contextName(idx, 'losses') + ' = np.where(' + contextName(idx, 'diffs') + ' < 0, -' + contextName(idx, 'diffs') + ', 0)');
    lines.push('    ' + contextName(idx, 'avg_gain') + ' = ' + contextName(idx, 'gains') + '.mean()');
    lines.push('    ' + contextName(idx, 'avg_loss') + ' = ' + contextName(idx, 'losses') + '.mean()');
    lines.push('    ' + contextName(idx, 'rsi') + ' = 100.0');
    lines.push('    if ' + contextName(idx, 'avg_loss') + ' != 0:');
    lines.push('        ' + contextName(idx, 'rsi') + ' = 100 - 100 / (1 + ' + contextName(idx, 'avg_gain') + ' / ' + contextName(idx, 'avg_loss') + ')');
    if (p.direction === 'oversold_buy') {
        lines.push('    ' + sigVar + '.append(' + contextName(idx, 'rsi') + ' < ' + oversoldP + ')');
    } else {
        lines.push('    ' + sigVar + '.append(' + contextName(idx, 'rsi') + ' > ' + overboughtP + ')');
    }
    var reason = p.direction === 'oversold_buy'
        ? 'RSI(' + p.period + ')超卖(' + p.oversold + ')' + (card.action === 'buy' ? '买入' : '卖出')
        : 'RSI(' + p.period + ')超买(' + p.overbought + ')' + (card.action === 'buy' ? '买入' : '卖出');
    return { code: lines, cond: '', reason: reason };
}

function genMACD(card, idx) {
    var p = card.params;
    var closeVar = contextName(idx, 'closes');
    var fastP = ctxParam(idx, 'fastPeriod');
    var slowP = ctxParam(idx, 'slowPeriod');
    var sigP = ctxParam(idx, 'signalPeriod');
    var maxP = Math.max(p.fastPeriod, p.slowPeriod);
    var needed = maxP + p.signalPeriod + 3;
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var lines = [];
    lines.push('# Card ' + idx + ': MACD');
    lines.push(closeVar + ' = history_bars(stock, ' + needed + ', \'1d\', \'close\')');
    lines.push('if len(' + closeVar + ') < ' + (p.slowPeriod + p.signalPeriod) + ':');
    lines.push('    ' + sigVar + '.append(False)');
    lines.push('else:');
    lines.push('    ' + contextName(idx, 'ema_fast') + ' = pd.Series(' + closeVar + ').ewm(span=' + fastP + ', adjust=False).mean().values');
    lines.push('    ' + contextName(idx, 'ema_slow') + ' = pd.Series(' + closeVar + ').ewm(span=' + slowP + ', adjust=False).mean().values');
    lines.push('    ' + contextName(idx, 'dif') + ' = ' + contextName(idx, 'ema_fast') + ' - ' + contextName(idx, 'ema_slow'));
    lines.push('    ' + contextName(idx, 'dea') + ' = pd.Series(' + contextName(idx, 'dif') + ').ewm(span=' + sigP + ', adjust=False).mean().values');
    lines.push('    ' + contextName(idx, 'dif_cur') + ' = ' + contextName(idx, 'dif') + '[-1]');
    lines.push('    ' + contextName(idx, 'dea_cur') + ' = ' + contextName(idx, 'dea') + '[-1]');
    lines.push('    ' + contextName(idx, 'dif_prev') + ' = ' + contextName(idx, 'dif') + '[-2]');
    lines.push('    ' + contextName(idx, 'dea_prev') + ' = ' + contextName(idx, 'dea') + '[-2]');
    if (p.direction === 'golden') {
        lines.push('    ' + sigVar + '.append(' + contextName(idx, 'dif_prev') + ' <= ' + contextName(idx, 'dea_prev') + ' and ' + contextName(idx, 'dif_cur') + ' > ' + contextName(idx, 'dea_cur') + ')');
    } else {
        lines.push('    ' + sigVar + '.append(' + contextName(idx, 'dif_prev') + ' >= ' + contextName(idx, 'dea_prev') + ' and ' + contextName(idx, 'dif_cur') + ' < ' + contextName(idx, 'dea_cur') + ')');
    }
    var reason = p.direction === 'golden'
        ? 'MACD金叉' + (card.action === 'buy' ? '买入' : '卖出')
        : 'MACD死叉' + (card.action === 'buy' ? '买入' : '卖出');
    return { code: lines, cond: '', reason: reason };
}

function genBollinger(card, idx) {
    var p = card.params;
    var closes = contextName(idx, 'closes');
    var periodP = ctxParam(idx, 'period');
    var stdP = ctxParam(idx, 'stdMultiplier');
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var lines = [];
    lines.push('# Card ' + idx + ': 布林带');
    lines.push(closes + ' = history_bars(stock, ' + periodP + ', \'1d\', \'close\')');
    lines.push('if len(' + closes + ') < ' + periodP + ':');
    lines.push('    ' + sigVar + '.append(False)');
    lines.push('else:');
    lines.push('    ' + contextName(idx, 'mid') + ' = ' + closes + '.mean()');
    lines.push('    ' + contextName(idx, 'std') + ' = ' + closes + '.std()');
    lines.push('    ' + contextName(idx, 'upper') + ' = ' + contextName(idx, 'mid') + ' + ' + stdP + ' * ' + contextName(idx, 'std'));
    lines.push('    ' + contextName(idx, 'lower') + ' = ' + contextName(idx, 'mid') + ' - ' + stdP + ' * ' + contextName(idx, 'std'));
    lines.push('    ' + contextName(idx, 'last_close') + ' = ' + closes + '[-1]');
    if (p.direction === 'lower_breakout') {
        lines.push('    ' + sigVar + '.append(' + contextName(idx, 'last_close') + ' < ' + contextName(idx, 'lower') + ')');
    } else {
        lines.push('    ' + sigVar + '.append(' + contextName(idx, 'last_close') + ' > ' + contextName(idx, 'upper') + ')');
    }
    var reason = p.direction === 'lower_breakout'
        ? '布林带下轨突破' + (card.action === 'buy' ? '买入' : '卖出')
        : '布林带上轨突破' + (card.action === 'buy' ? '买入' : '卖出');
    return { code: lines, cond: '', reason: reason };
}

function genKDJ(card, idx) {
    var p = card.params;
    var nP = ctxParam(idx, 'n');
    var m1P = ctxParam(idx, 'm1');
    var m2P = ctxParam(idx, 'm2');
    var totalNeeded = p.n + Math.max(p.m1, p.m2) + 5;
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var lines = [];
    lines.push('# Card ' + idx + ': KDJ');
    lines.push(contextName(idx, 'highs') + ' = history_bars(stock, ' + totalNeeded + ', \'1d\', \'high\')');
    lines.push(contextName(idx, 'lows') + ' = history_bars(stock, ' + totalNeeded + ', \'1d\', \'low\')');
    lines.push(contextName(idx, 'closes') + ' = history_bars(stock, ' + totalNeeded + ', \'1d\', \'close\')');
    lines.push('if len(' + contextName(idx, 'closes') + ') < ' + totalNeeded + ':');
    lines.push('    ' + sigVar + '.append(False)');
    lines.push('else:');
    lines.push('    ' + contextName(idx, 'high_n') + ' = pd.Series(' + contextName(idx, 'highs') + ').rolling(' + nP + ').max().values[' + (p.n - 1) + ':]');
    lines.push('    ' + contextName(idx, 'low_n') + ' = pd.Series(' + contextName(idx, 'lows') + ').rolling(' + nP + ').min().values[' + (p.n - 1) + ':]');
    lines.push('    ' + contextName(idx, 'close_n') + ' = ' + contextName(idx, 'closes') + '[' + (p.n - 1) + ':]');
    lines.push('    ' + contextName(idx, 'rsv') + ' = np.where(' + contextName(idx, 'high_n') + ' != ' + contextName(idx, 'low_n') + ',');
    lines.push('        (' + contextName(idx, 'close_n') + ' - ' + contextName(idx, 'low_n') + ') / (' + contextName(idx, 'high_n') + ' - ' + contextName(idx, 'low_n') + ') * 100, 50)');
    lines.push('    ' + contextName(idx, 'k_vals') + ' = pd.Series(' + contextName(idx, 'rsv') + ').ewm(alpha=1.0/' + m1P + ', adjust=False).mean().values');
    lines.push('    ' + contextName(idx, 'd_vals') + ' = pd.Series(' + contextName(idx, 'k_vals') + ').ewm(alpha=1.0/' + m2P + ', adjust=False).mean().values');
    lines.push('    ' + contextName(idx, 'k_cur') + ' = ' + contextName(idx, 'k_vals') + '[-1]');
    lines.push('    ' + contextName(idx, 'd_cur') + ' = ' + contextName(idx, 'd_vals') + '[-1]');
    lines.push('    ' + contextName(idx, 'k_prev') + ' = ' + contextName(idx, 'k_vals') + '[-2]');
    lines.push('    ' + contextName(idx, 'd_prev') + ' = ' + contextName(idx, 'd_vals') + '[-2]');
    if (p.direction === 'golden') {
        lines.push('    ' + sigVar + '.append(' + contextName(idx, 'k_prev') + ' <= ' + contextName(idx, 'd_prev') + ' and ' + contextName(idx, 'k_cur') + ' > ' + contextName(idx, 'd_cur') + ')');
    } else {
        lines.push('    ' + sigVar + '.append(' + contextName(idx, 'k_prev') + ' >= ' + contextName(idx, 'd_prev') + ' and ' + contextName(idx, 'k_cur') + ' < ' + contextName(idx, 'd_cur') + ')');
    }
    var reason = p.direction === 'golden'
        ? 'KDJ金叉' + (card.action === 'buy' ? '买入' : '卖出')
        : 'KDJ死叉' + (card.action === 'buy' ? '买入' : '卖出');
    return { code: lines, cond: '', reason: reason };
}

function genVolume(card, idx) {
    var p = card.params;
    var vols = contextName(idx, 'vols');
    var periodP = ctxParam(idx, 'period');
    var multP = ctxParam(idx, 'multiple');
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var lines = [];
    lines.push('# Card ' + idx + ': 成交量放大');
    lines.push(vols + ' = history_bars(stock, ' + periodP + ' + 1, \'1d\', \'volume\')');
    lines.push('if len(' + vols + ') < ' + periodP + ' + 1:');
    lines.push('    ' + sigVar + '.append(False)');
    lines.push('else:');
    lines.push('    ' + contextName(idx, 'avg_vol') + ' = ' + vols + '[:-1].mean()');
    lines.push('    ' + contextName(idx, 'cur_vol') + ' = ' + vols + '[-1]');
    lines.push('    ' + sigVar + '.append(' + contextName(idx, 'cur_vol') + ' > ' + contextName(idx, 'avg_vol') + ' * ' + multP + ')');
    var reason = '成交量放大' + (card.action === 'buy' ? '买入' : '卖出');
    return { code: lines, cond: '', reason: reason };
}

function genBollingerWidth(card, idx) {
    var p = card.params;
    var closes = contextName(idx, 'closes');
    var periodP = ctxParam(idx, 'period');
    var stdP = ctxParam(idx, 'stdMultiplier');
    var thresP = ctxParam(idx, 'widthThreshold');
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var lines = [];
    lines.push('# Card ' + idx + ': 布林带宽度');
    lines.push(closes + ' = history_bars(stock, ' + periodP + ', \'1d\', \'close\')');
    lines.push('if len(' + closes + ') < ' + periodP + ':');
    lines.push('    ' + sigVar + '.append(False)');
    lines.push('else:');
    lines.push('    ' + contextName(idx, 'mid') + ' = ' + closes + '.mean()');
    lines.push('    ' + contextName(idx, 'std') + ' = ' + closes + '.std()');
    lines.push('    ' + contextName(idx, 'width') + ' = (2 * ' + stdP + ' * ' + contextName(idx, 'std') + ') / ' + contextName(idx, 'mid'));
    lines.push('    ' + sigVar + '.append(' + contextName(idx, 'width') + ' < ' + thresP + ' / 100.0)');
    var reason = '布林带宽度低于' + p.widthThreshold + '%' + (card.action === 'buy' ? '买入' : '卖出');
    return { code: lines, cond: '', reason: reason };
}

function genVolumeContraction(card, idx) {
    var p = card.params;
    var vols = contextName(idx, 'vols');
    var periodP = ctxParam(idx, 'period');
    var ratioP = ctxParam(idx, 'ratio');
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var lines = [];
    lines.push('# Card ' + idx + ': 成交量萎缩');
    lines.push(vols + ' = history_bars(stock, ' + periodP + ' + 1, \'1d\', \'volume\')');
    lines.push('if len(' + vols + ') < ' + periodP + ' + 1:');
    lines.push('    ' + sigVar + '.append(False)');
    lines.push('else:');
    lines.push('    ' + contextName(idx, 'avg_vol') + ' = ' + vols + '[:-1].mean()');
    lines.push('    ' + contextName(idx, 'cur_vol') + ' = ' + vols + '[-1]');
    lines.push('    ' + sigVar + '.append(' + contextName(idx, 'cur_vol') + ' < ' + contextName(idx, 'avg_vol') + ' * ' + ratioP + ')');
    var reason = '成交量萎缩（低于' + p.period + '日均量×' + p.ratio + '）' + (card.action === 'buy' ? '买入' : '卖出');
    return { code: lines, cond: '', reason: reason };
}

function genDayOfWeek(card, idx) {
    var p = card.params;
    var targetP = ctxParam(idx, 'targetDay');
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var lines = [];
    lines.push('# Card ' + idx + ': 周几效应');
    lines.push(contextName(idx, 'weekday') + ' = context.current_dt.weekday()');
    lines.push(sigVar + '.append(' + contextName(idx, 'weekday') + ' == ' + targetP + ')');
    var weekdays = ['周一', '周二', '周三', '周四', '周五'];
    var reason = weekdays[p.targetDay] + '信号' + (card.action === 'buy' ? '买入' : '卖出');
    return { code: lines, cond: '', reason: reason };
}

function genSAR(card, idx) {
    var p = card.params;
    var accP = ctxParam(idx, 'acceleration');
    var maxAccP = ctxParam(idx, 'maxAcceleration');
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var high = contextName(idx, 'high');
    var low = contextName(idx, 'low');
    var close = contextName(idx, 'close');
    var ep = contextName(idx, 'ep');
    var sv = contextName(idx, 'sv');
    var af = contextName(idx, 'af');
    var up = contextName(idx, 'up');
    var ls = contextName(idx, 'ls');
    var lines = [];
    lines.push('# Card ' + idx + ': 抛物线转向(SAR)');
    lines.push(high + ' = history_bars(stock, 100, \'1d\', \'high\')');
    lines.push(low + ' = history_bars(stock, 100, \'1d\', \'low\')');
    lines.push(close + ' = history_bars(stock, 100, \'1d\', \'close\')');
    lines.push('if len(' + close + ') < 20:');
    lines.push('    ' + sigVar + '.append(False)');
    lines.push('else:');
    lines.push('    ' + ep + ' = ' + high + '[0]');
    lines.push('    ' + sv + ' = ' + low + '[0]');
    lines.push('    ' + af + ' = ' + accP);
    lines.push('    ' + up + ' = True');
    lines.push('    for i in range(1, len(' + close + ')):');
    lines.push('        if ' + up + ':');
    lines.push('            ' + sv + ' = ' + sv + ' + ' + af + ' * (' + ep + ' - ' + sv + ')');
    lines.push('            if ' + high + '[i] > ' + ep + ':');
    lines.push('                ' + ep + ' = ' + high + '[i]');
    lines.push('                ' + af + ' = min(' + af + ' + ' + accP + ', ' + maxAccP + ')');
    lines.push('            if ' + low + '[i] < ' + sv + ':');
    lines.push('                ' + up + ' = False');
    lines.push('                ' + sv + ' = ' + ep);
    lines.push('                ' + ep + ' = ' + low + '[i]');
    lines.push('                ' + af + ' = ' + accP);
    lines.push('        else:');
    lines.push('            ' + sv + ' = ' + sv + ' + ' + af + ' * (' + ep + ' - ' + sv + ')');
    lines.push('            if ' + low + '[i] < ' + ep + ':');
    lines.push('                ' + ep + ' = ' + low + '[i]');
    lines.push('                ' + af + ' = min(' + af + ' + ' + accP + ', ' + maxAccP + ')');
    lines.push('            if ' + high + '[i] > ' + sv + ':');
    lines.push('                ' + up + ' = True');
    lines.push('                ' + sv + ' = ' + ep);
    lines.push('                ' + ep + ' = ' + high + '[i]');
    lines.push('                ' + af + ' = ' + accP);
    lines.push('    ' + ls + ' = ' + sv);
    if (card.action === 'buy') {
        lines.push('    ' + sigVar + '.append(' + close + '[-1] > ' + ls + ')');
    } else {
        lines.push('    ' + sigVar + '.append(' + close + '[-1] < ' + ls + ')');
    }
    var reason = 'SAR转向信号' + (card.action === 'buy' ? '买入' : '卖出');
    return { code: lines, cond: '', reason: reason };
}

function genOBV(card, idx) {
    var p = card.params;
    var periodP = ctxParam(idx, 'period');
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var close = contextName(idx, 'close');
    var vol = contextName(idx, 'vol');
    var obv = contextName(idx, 'obv');
    var obvSeries = contextName(idx, 'obv_series');
    var obvMa = contextName(idx, 'obv_ma');
    var prevObv = contextName(idx, 'prev_obv');
    var prevMa = contextName(idx, 'prev_ma');
    var lines = [];
    lines.push('# Card ' + idx + ': 能量潮(OBV)');
    lines.push(close + ' = history_bars(stock, ' + periodP + ' + 2, \'1d\', \'close\')');
    lines.push(vol + ' = history_bars(stock, ' + periodP + ' + 2, \'1d\', \'volume\')');
    lines.push('if len(' + close + ') < ' + periodP + ' + 2:');
    lines.push('    ' + sigVar + '.append(False)');
    lines.push('else:');
    lines.push('    ' + obv + ' = [0]');
    lines.push('    for i in range(1, len(' + close + ')):');
    lines.push('        if ' + close + '[i] > ' + close + '[i-1]:');
    lines.push('            ' + obv + '.append(' + obv + '[-1] + ' + vol + '[i])');
    lines.push('        elif ' + close + '[i] < ' + close + '[i-1]:');
    lines.push('            ' + obv + '.append(' + obv + '[-1] - ' + vol + '[i])');
    lines.push('        else:');
    lines.push('            ' + obv + '.append(' + obv + '[-1])');
    lines.push('    ' + obvSeries + ' = np.array(' + obv + ')');
    lines.push('    ' + obvMa + ' = ' + obvSeries + '[-' + periodP + ':].mean()');
    lines.push('    ' + prevObv + ' = ' + obvSeries + '[-2]');
    lines.push('    ' + prevMa + ' = ' + obvSeries + '[-' + periodP + '-1:-1].mean()');
    if (card.action === 'buy') {
        lines.push('    ' + sigVar + '.append(' + prevObv + ' <= ' + prevMa + ' and ' + obvSeries + '[-1] > ' + obvMa + ')');
    } else {
        lines.push('    ' + sigVar + '.append(' + prevObv + ' >= ' + prevMa + ' and ' + obvSeries + '[-1] < ' + obvMa + ')');
    }
    var reason = (card.action === 'buy' ? 'OBV上穿均线买入' : 'OBV下穿均线卖出');
    return { code: lines, cond: '', reason: reason };
}

function genHammerHanging(card, idx) {
    var p = card.params;
    var bodyRatioP = ctxParam(idx, 'bodyRatio');
    var shadowRatioP = ctxParam(idx, 'shadowRatio');
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var body = contextName(idx, 'body');
    var range = contextName(idx, 'range');
    var bodyPct = contextName(idx, 'body_pct');
    var lShadow = contextName(idx, 'l_shadow');
    var uShadow = contextName(idx, 'u_shadow');
    var lines = [];
    lines.push('# Card ' + idx + ': 锤子线/吊颈线');
    lines.push('open_p = bar_dict[\'open\']');
    lines.push('high_p = bar_dict[\'high\']');
    lines.push('low_p = bar_dict[\'low\']');
    lines.push('close_p = bar_dict[\'close\']');
    lines.push(body + ' = abs(close_p - open_p)');
    lines.push(range + ' = high_p - low_p');
    lines.push('if ' + range + ' == 0:');
    lines.push('    ' + sigVar + '.append(False)');
    lines.push('else:');
    lines.push('    ' + bodyPct + ' = ' + body + ' / ' + range);
    lines.push('    ' + lShadow + ' = min(open_p, close_p) - low_p');
    lines.push('    ' + uShadow + ' = high_p - max(open_p, close_p)');
    lines.push('    ' + contextName(idx, 'is_hammer') + ' = (' + lShadow + ' >= ' + uShadow + ' * 2) and (' + lShadow + ' / ' + range + ' >= ' + shadowRatioP + ')');
    lines.push('    ' + contextName(idx, 'is_hanging') + ' = (' + uShadow + ' >= ' + lShadow + ' * 2) and (' + uShadow + ' / ' + range + ' >= ' + shadowRatioP + ')');
    if (card.action === 'buy') {
        lines.push('    ' + sigVar + '.append(' + contextName(idx, 'is_hammer') + ' and ' + bodyPct + ' <= ' + bodyRatioP + ')');
    } else {
        lines.push('    ' + sigVar + '.append(' + contextName(idx, 'is_hanging') + ' and ' + bodyPct + ' <= ' + bodyRatioP + ')');
    }
    var reason = (card.action === 'buy' ? '锤子线买入' : '吊颈线卖出');
    return { code: lines, cond: '', reason: reason };
}

function genWilliamsR(card, idx) {
    var p = card.params;
    var periodP = ctxParam(idx, 'period');
    var oversoldP = ctxParam(idx, 'oversold');
    var overboughtP = ctxParam(idx, 'overbought');
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var high = contextName(idx, 'high');
    var low = contextName(idx, 'low');
    var close = contextName(idx, 'close');
    var hh = contextName(idx, 'hh');
    var ll = contextName(idx, 'll');
    var cc = contextName(idx, 'cc');
    var wr = contextName(idx, 'wr');
    var lines = [];
    lines.push('# Card ' + idx + ': 威廉指标(%R)');
    lines.push(high + ' = history_bars(stock, ' + periodP + ', \'1d\', \'high\')');
    lines.push(low + ' = history_bars(stock, ' + periodP + ', \'1d\', \'low\')');
    lines.push(close + ' = history_bars(stock, ' + periodP + ', \'1d\', \'close\')');
    lines.push('if len(' + high + ') < ' + periodP + ':');
    lines.push('    ' + sigVar + '.append(False)');
    lines.push('else:');
    lines.push('    ' + hh + ' = max(' + high + ')');
    lines.push('    ' + ll + ' = min(' + low + ')');
    lines.push('    ' + cc + ' = ' + close + '[-1]');
    lines.push('    if ' + hh + ' == ' + ll + ':');
    lines.push('        ' + wr + ' = -50');
    lines.push('    else:');
    lines.push('        ' + wr + ' = -100 * (' + hh + ' - ' + cc + ') / (' + hh + ' - ' + ll + ')');
    if (card.action === 'buy') {
        lines.push('    ' + sigVar + '.append(' + wr + ' < ' + oversoldP + ')');
    } else {
        lines.push('    ' + sigVar + '.append(' + wr + ' > ' + overboughtP + ')');
    }
    var reason = (card.action === 'buy' ? '威廉指标超卖买入' : '威廉指标超买卖出');
    return { code: lines, cond: '', reason: reason };
}

function genROC(card, idx) {
    var p = card.params;
    var periodP = ctxParam(idx, 'period');
    var thresholdP = ctxParam(idx, 'threshold');
    var useZeroCross = p.useZeroCross !== 'false';
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var close = contextName(idx, 'close');
    var roc = contextName(idx, 'roc');
    var prevRoc = contextName(idx, 'prev_roc');
    var lines = [];
    lines.push('# Card ' + idx + ': 变动率(ROC)');
    lines.push(close + ' = history_bars(stock, ' + periodP + ' + 2, \'1d\', \'close\')');
    lines.push('if len(' + close + ') < ' + periodP + ' + 2:');
    lines.push('    ' + sigVar + '.append(False)');
    lines.push('else:');
    lines.push('    ' + roc + ' = (' + close + '[-1] - ' + close + '[-' + periodP + ' - 1]) / ' + close + '[-' + periodP + ' - 1] * 100');
    lines.push('    ' + prevRoc + ' = (' + close + '[-2] - ' + close + '[-' + periodP + ' - 2]) / ' + close + '[-' + periodP + ' - 2] * 100');
    if (useZeroCross) {
        if (card.action === 'buy') {
            lines.push('    ' + sigVar + '.append(' + prevRoc + ' <= 0 and ' + roc + ' > 0)');
        } else {
            lines.push('    ' + sigVar + '.append(' + prevRoc + ' >= 0 and ' + roc + ' < 0)');
        }
    } else {
        if (card.action === 'buy') {
            lines.push('    ' + sigVar + '.append(' + roc + ' > ' + thresholdP + ')');
        } else {
            lines.push('    ' + sigVar + '.append(' + roc + ' < -' + thresholdP + ')');
        }
    }
    var reason = (card.action === 'buy' ? 'ROC买入信号' : 'ROC卖出信号');
    return { code: lines, cond: '', reason: reason };
}

function genPSY(card, idx) {
    var p = card.params;
    var periodP = ctxParam(idx, 'period');
    var oversoldP = ctxParam(idx, 'oversold');
    var overboughtP = ctxParam(idx, 'overbought');
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var close = contextName(idx, 'close');
    var upDays = contextName(idx, 'up_days');
    var psyVal = contextName(idx, 'psy');
    var lines = [];
    lines.push('# Card ' + idx + ': 心理线(PSY)');
    lines.push(close + ' = history_bars(stock, ' + periodP + ' + 1, \'1d\', \'close\')');
    lines.push('if len(' + close + ') < ' + periodP + ' + 1:');
    lines.push('    ' + sigVar + '.append(False)');
    lines.push('else:');
    lines.push('    ' + upDays + ' = 0');
    lines.push('    for i in range(1, ' + periodP + ' + 1):');
    lines.push('        if ' + close + '[-i] > ' + close + '[-i-1]:');
    lines.push('            ' + upDays + ' += 1');
    lines.push('    ' + psyVal + ' = ' + upDays + ' / ' + periodP + ' * 100');
    if (card.action === 'buy') {
        lines.push('    ' + sigVar + '.append(' + psyVal + ' < ' + oversoldP + ')');
    } else {
        lines.push('    ' + sigVar + '.append(' + psyVal + ' > ' + overboughtP + ')');
    }
    var reason = (card.action === 'buy' ? '心理线超卖买入' : '心理线超买卖出');
    return { code: lines, cond: '', reason: reason };
}

function genATRBreakout(card, idx) {
    var p = card.params;
    var periodP = ctxParam(idx, 'period');
    var multP = ctxParam(idx, 'multiplier');
    var totalNeeded = p.period + 2;
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var lines = [];
    lines.push('# Card ' + idx + ': ATR通道突破');
    lines.push(contextName(idx, 'highs') + ' = history_bars(stock, ' + totalNeeded + ', \'1d\', \'high\')');
    lines.push(contextName(idx, 'lows') + ' = history_bars(stock, ' + totalNeeded + ', \'1d\', \'low\')');
    lines.push(contextName(idx, 'closes') + ' = history_bars(stock, ' + totalNeeded + ', \'1d\', \'close\')');
    lines.push('if len(' + contextName(idx, 'closes') + ') < ' + totalNeeded + ':');
    lines.push('    ' + sigVar + '.append(False)');
    lines.push('else:');
    lines.push('    ' + contextName(idx, 'tr_list') + ' = []');
    lines.push('    for i in range(1, len(' + contextName(idx, 'closes') + ')):');
    lines.push('        high_low = ' + contextName(idx, 'highs') + '[i] - ' + contextName(idx, 'lows') + '[i]');
    lines.push('        high_close = abs(' + contextName(idx, 'highs') + '[i] - ' + contextName(idx, 'closes') + '[i-1])');
    lines.push('        low_close = abs(' + contextName(idx, 'lows') + '[i] - ' + contextName(idx, 'closes') + '[i-1])');
    lines.push('        ' + contextName(idx, 'tr_list') + '.append(max(high_low, high_close, low_close))');
    lines.push('    ' + contextName(idx, 'atr') + ' = np.mean(' + contextName(idx, 'tr_list') + '[-' + periodP + ':])');
    lines.push('    ' + contextName(idx, 'mid') + ' = ' + contextName(idx, 'closes') + '[-' + periodP + ':].mean()');
    lines.push('    ' + contextName(idx, 'upper') + ' = ' + contextName(idx, 'mid') + ' + ' + multP + ' * ' + contextName(idx, 'atr'));
    lines.push('    ' + contextName(idx, 'lower') + ' = ' + contextName(idx, 'mid') + ' - ' + multP + ' * ' + contextName(idx, 'atr'));
    lines.push('    ' + contextName(idx, 'last_close') + ' = ' + contextName(idx, 'closes') + '[-1]');
    if (p.direction === 'upper_breakout') {
        lines.push('    ' + sigVar + '.append(' + contextName(idx, 'last_close') + ' > ' + contextName(idx, 'upper') + ')');
    } else {
        lines.push('    ' + sigVar + '.append(' + contextName(idx, 'last_close') + ' < ' + contextName(idx, 'lower') + ')');
    }
    var reason = p.direction === 'upper_breakout'
        ? 'ATR上轨突破' + (card.action === 'buy' ? '买入' : '卖出')
        : 'ATR下轨突破' + (card.action === 'buy' ? '买入' : '卖出');
    return { code: lines, cond: '', reason: reason };
}

function genCCI(card, idx) {
    var p = card.params;
    var periodP = ctxParam(idx, 'period');
    var oversoldP = ctxParam(idx, 'oversold');
    var overboughtP = ctxParam(idx, 'overbought');
    var totalNeeded = p.period + 1;
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var lines = [];
    lines.push('# Card ' + idx + ': CCI');
    lines.push(contextName(idx, 'highs') + ' = history_bars(stock, ' + totalNeeded + ', \'1d\', \'high\')');
    lines.push(contextName(idx, 'lows') + ' = history_bars(stock, ' + totalNeeded + ', \'1d\', \'low\')');
    lines.push(contextName(idx, 'closes') + ' = history_bars(stock, ' + totalNeeded + ', \'1d\', \'close\')');
    lines.push('if len(' + contextName(idx, 'closes') + ') < ' + totalNeeded + ':');
    lines.push('    ' + sigVar + '.append(False)');
    lines.push('else:');
    lines.push('    ' + contextName(idx, 'tp') + ' = (' + contextName(idx, 'highs') + ' + ' + contextName(idx, 'lows') + ' + ' + contextName(idx, 'closes') + ') / 3.0');
    lines.push('    ' + contextName(idx, 'tp_ma') + ' = ' + contextName(idx, 'tp') + '[-' + periodP + ':].mean()');
    lines.push('    ' + contextName(idx, 'md') + ' = np.abs(' + contextName(idx, 'tp') + '[-' + periodP + ':] - ' + contextName(idx, 'tp_ma') + ').mean()');
    lines.push('    ' + contextName(idx, 'cci') + ' = 0');
    lines.push('    if ' + contextName(idx, 'md') + ' != 0:');
    lines.push('        ' + contextName(idx, 'cci') + ' = (' + contextName(idx, 'tp') + '[-1] - ' + contextName(idx, 'tp_ma') + ') / (0.015 * ' + contextName(idx, 'md') + ')');
    if (p.direction === 'oversold_buy') {
        lines.push('    ' + sigVar + '.append(' + contextName(idx, 'cci') + ' < ' + oversoldP + ')');
    } else {
        lines.push('    ' + sigVar + '.append(' + contextName(idx, 'cci') + ' > ' + overboughtP + ')');
    }
    var reason = p.direction === 'oversold_buy'
        ? 'CCI(' + p.period + ')超卖(' + p.oversold + ')' + (card.action === 'buy' ? '买入' : '卖出')
        : 'CCI(' + p.period + ')超买(' + p.overbought + ')' + (card.action === 'buy' ? '买入' : '卖出');
    return { code: lines, cond: '', reason: reason };
}

function genMAAlignment(card, idx) {
    var p = card.params;
    var fastP = ctxParam(idx, 'fastPeriod');
    var midP = ctxParam(idx, 'midPeriod');
    var slowP = ctxParam(idx, 'slowPeriod');
    var maxPeriod = Math.max(p.fastPeriod, p.midPeriod, p.slowPeriod);
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var lines = [];
    lines.push('# Card ' + idx + ': 均线排列');
    lines.push(contextName(idx, 'closes') + ' = history_bars(stock, ' + (maxPeriod + 1) + ', \'1d\', \'close\')');
    lines.push('if len(' + contextName(idx, 'closes') + ') < ' + (maxPeriod + 1) + ':');
    lines.push('    ' + sigVar + '.append(False)');
    lines.push('else:');
    lines.push('    ' + contextName(idx, 'ma_fast') + ' = ' + contextName(idx, 'closes') + '[-' + fastP + ':].mean()');
    lines.push('    ' + contextName(idx, 'ma_mid') + ' = ' + contextName(idx, 'closes') + '[-' + midP + ':].mean()');
    lines.push('    ' + contextName(idx, 'ma_slow') + ' = ' + contextName(idx, 'closes') + '[-' + slowP + ':].mean()');
    if (p.direction === 'bullish') {
        lines.push('    ' + sigVar + '.append(' + contextName(idx, 'ma_fast') + ' > ' + contextName(idx, 'ma_mid') + ' and ' + contextName(idx, 'ma_mid') + ' > ' + contextName(idx, 'ma_slow') + ')');
    } else {
        lines.push('    ' + sigVar + '.append(' + contextName(idx, 'ma_fast') + ' < ' + contextName(idx, 'ma_mid') + ' and ' + contextName(idx, 'ma_mid') + ' < ' + contextName(idx, 'ma_slow') + ')');
    }
    var reason = p.direction === 'bullish'
        ? '均线多头排列' + (card.action === 'buy' ? '买入' : '卖出')
        : '均线空头排列' + (card.action === 'buy' ? '买入' : '卖出');
    return { code: lines, cond: '', reason: reason };
}

function genSupertrend(card, idx) {
    var p = card.params;
    var period = p.period || 10;
    var multiplier = parseFloat(p.multiplier) || 3;
    var direction = p.direction || 'trend_up';
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var needBars = period + 5;
    var lines = [];
    lines.push('# Card ' + idx + ': 超级趋势');
    lines.push(contextName(idx, 'highs') + ' = history_bars(stock, ' + needBars + ', \'1d\', \'high\')');
    lines.push(contextName(idx, 'lows') + ' = history_bars(stock, ' + needBars + ', \'1d\', \'low\')');
    lines.push(contextName(idx, 'closes') + ' = history_bars(stock, ' + needBars + ', \'1d\', \'close\')');
    lines.push('if len(' + contextName(idx, 'closes') + ') < ' + needBars + ':');
    lines.push('    ' + sigVar + '.append(False)');
    lines.push('else:');
    lines.push('    _h = np.array(' + contextName(idx, 'highs') + ')');
    lines.push('    _l = np.array(' + contextName(idx, 'lows') + ')');
    lines.push('    _c = np.array(' + contextName(idx, 'closes') + ')');
    lines.push('    _n = len(_c)');
    // ATR
    lines.push('    _tr = np.maximum(_h - _l, np.maximum(np.abs(_h - np.roll(_c, 1)), np.abs(_l - np.roll(_c, 1))))');
    lines.push('    _tr[0] = _h[0] - _l[0]');
    lines.push('    _atr = np.zeros(_n)');
    lines.push('    _atr[:' + period + '] = np.nan');
    lines.push('    _atr[' + period + '] = np.mean(_tr[1:' + (period + 1) + '])');
    lines.push('    for _j in range(' + (period + 1) + ', _n):');
    lines.push('        _atr[_j] = (_atr[_j-1] * (' + (period - 1) + ') + _tr[_j]) / ' + period);
    // Basic bands
    lines.push('    _src = (_h + _l + _c) / 3');
    lines.push('    _basicUpper = _src + ' + multiplier + ' * _atr');
    lines.push('    _basicLower = _src - ' + multiplier + ' * _atr');
    // Trend
    lines.push('    _trend = np.zeros(_n)');
    lines.push('    _trendLine = np.zeros(_n)');
    lines.push('    _currTrend = 1');
    lines.push('    _start = ' + period);
    lines.push('    _trend[_start] = _currTrend');
    lines.push('    _trendLine[_start] = _basicLower[_start] if _currTrend == 1 else _basicUpper[_start]');
    lines.push('    for _j in range(_start + 1, _n):');
    lines.push('        if _currTrend == 1:');
    lines.push('            if _c[_j] > _trendLine[_j-1]:');
    lines.push('                _trend[_j] = 1');
    lines.push('                _trendLine[_j] = max(_basicLower[_j], _trendLine[_j-1])');
    lines.push('            else:');
    lines.push('                _currTrend = -1');
    lines.push('                _trend[_j] = -1');
    lines.push('                _trendLine[_j] = _basicUpper[_j]');
    lines.push('        else:');
    lines.push('            if _c[_j] < _trendLine[_j-1]:');
    lines.push('                _trend[_j] = -1');
    lines.push('                _trendLine[_j] = min(_basicUpper[_j], _trendLine[_j-1])');
    lines.push('            else:');
    lines.push('                _currTrend = 1');
    lines.push('                _trend[_j] = 1');
    lines.push('                _trendLine[_j] = _basicLower[_j]');
    if (direction === 'trend_up') {
        lines.push('    ' + sigVar + '.append(_trend[-1] == 1)');
    } else {
        lines.push('    ' + sigVar + '.append(_trend[-1] == -1)');
    }
    var reason = direction === 'trend_up' ? '超级趋势上升(' + (card.action === 'buy' ? '买入' : '卖出') + ')' : '超级趋势下降(' + (card.action === 'buy' ? '买入' : '卖出') + ')';
    return { code: lines, cond: '', reason: reason };
}

function genCMF(card, idx) {
    var p = card.params;
    var period = p.period || 20;
    var threshold = parseFloat(p.threshold) || 0.1;
    var direction = p.direction || 'gt';
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var needBars = period + 2;
    var lines = [];
    lines.push('# Card ' + idx + ': CMF资金流');
    lines.push(contextName(idx, 'highs') + ' = history_bars(stock, ' + needBars + ', \'1d\', \'high\')');
    lines.push(contextName(idx, 'lows') + ' = history_bars(stock, ' + needBars + ', \'1d\', \'low\')');
    lines.push(contextName(idx, 'closes') + ' = history_bars(stock, ' + needBars + ', \'1d\', \'close\')');
    lines.push(contextName(idx, 'vols') + ' = history_bars(stock, ' + needBars + ', \'1d\', \'volume\')');
    lines.push('if len(' + contextName(idx, 'closes') + ') < ' + needBars + ':');
    lines.push('    ' + sigVar + '.append(False)');
    lines.push('else:');
    lines.push('    _h = np.array(' + contextName(idx, 'highs') + ')');
    lines.push('    _l = np.array(' + contextName(idx, 'lows') + ')');
    lines.push('    _c = np.array(' + contextName(idx, 'closes') + ')');
    lines.push('    _v = np.array(' + contextName(idx, 'vols') + ')');
    lines.push('    _range = _h - _l');
    lines.push('    _range[_range == 0] = 1e-10');
    lines.push('    _mfm = ((_c - _l) - (_h - _c)) / _range');
    lines.push('    _mfv = _mfm * _v');
    lines.push('    _cmf = np.zeros(len(_c))');
    lines.push('    _cmf[:' + (period - 1) + '] = np.nan');
    lines.push('    _sumVol = np.convolve(_v, np.ones(' + period + '), \'valid\')');
    lines.push('    _sumMfv = np.convolve(_mfv, np.ones(' + period + '), \'valid\')');
    lines.push('    _cmf[' + (period - 1) + ':] = _sumMfv / np.where(_sumVol == 0, 1, _sumVol)');
    if (direction === 'gt') {
        lines.push('    ' + sigVar + '.append(not np.isnan(_cmf[-1]) and _cmf[-1] > ' + threshold + ')');
    } else {
        lines.push('    ' + sigVar + '.append(not np.isnan(_cmf[-1]) and _cmf[-1] < -' + threshold + ')');
    }
    var reason = direction === 'gt' ? 'CMF>' + threshold + '(资金流入/' + (card.action === 'buy' ? '买入' : '卖出') + ')' : 'CMF<-' + threshold + '(资金流出/' + (card.action === 'buy' ? '买入' : '卖出') + ')';
    return { code: lines, cond: '', reason: reason };
}

function genResonance(card, idx) {
    var p = card.params;
    var rsiOversold = p.rsiOversold || 30;
    var maShort = p.maShort || 5;
    var maMid = p.maMid || 10;
    var maLong = p.maLong || 20;
    var kdjN = p.kdjN || 9;
    var kdjM1 = p.kdjM1 || 3;
    var kdjM2 = p.kdjM2 || 3;
    var threshold = p.threshold || 3;
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var maxPeriod = Math.max(maLong, kdjN + kdjM1 + kdjM2, 20);
    var needBars = maxPeriod + 10;
    var lines = [];
    lines.push('# Card ' + idx + ': 共振指标');
    lines.push(contextName(idx, 'highs') + ' = history_bars(stock, ' + needBars + ', \'1d\', \'high\')');
    lines.push(contextName(idx, 'lows') + ' = history_bars(stock, ' + needBars + ', \'1d\', \'low\')');
    lines.push(contextName(idx, 'closes') + ' = history_bars(stock, ' + needBars + ', \'1d\', \'close\')');
    lines.push('if len(' + contextName(idx, 'closes') + ') < ' + needBars + ':');
    lines.push('    ' + sigVar + '.append(False)');
    lines.push('else:');
    lines.push('    _h = np.array(' + contextName(idx, 'highs') + ')');
    lines.push('    _l = np.array(' + contextName(idx, 'lows') + ')');
    lines.push('    _c = np.array(' + contextName(idx, 'closes') + ')');
    lines.push('    _n = len(_c)');
    // RSI
    lines.push('    _rsi = np.zeros(_n); _rsi[:] = np.nan');
    lines.push('    _delta = np.diff(_c)');
    lines.push('    _gain = np.where(_delta > 0, _delta, 0)');
    lines.push('    _loss = np.where(_delta < 0, -_delta, 0)');
    lines.push('    _avgGain = np.mean(_gain[:14]) if len(_gain) >= 14 else 0');
    lines.push('    _avgLoss = np.mean(_loss[:14]) if len(_loss) >= 14 else 0');
    lines.push('    if _avgLoss == 0: _rsi[14] = 100');
    lines.push('    else: _rsi[14] = 100 - 100 / (1 + _avgGain / _avgLoss)');
    lines.push('    for _j in range(15, _n):');
    lines.push('        _avgGain = (_avgGain * 13 + _gain[_j-1]) / 14');
    lines.push('        _avgLoss = (_avgLoss * 13 + _loss[_j-1]) / 14');
    lines.push('        _rsi[_j] = 100 - 100 / (1 + _avgGain / _avgLoss) if _avgLoss > 0 else 100');
    // KDJ
    lines.push('    _lowN = np.array([np.min(_l[max(0,_j-' + kdjN + '+1):_j+1]) for _j in range(_n)])');
    lines.push('    _highN = np.array([np.max(_h[max(0,_j-' + kdjN + '+1):_j+1]) for _j in range(_n)])');
    lines.push('    _rsv = np.where(_highN - _lowN > 0, (_c - _lowN) / (_highN - _lowN) * 100, 50)');
    lines.push('    _kArr = np.zeros(_n); _dArr = np.zeros(_n)');
    lines.push('    _kArr[:' + (kdjN - 1) + '] = np.nan; _dArr[:' + (kdjN - 1) + '] = np.nan');
    lines.push('    _kArr[' + (kdjN - 1) + '] = 50; _dArr[' + (kdjN - 1) + '] = 50');
    lines.push('    for _j in range(' + kdjN + ', _n):');
    lines.push('        _kArr[_j] = _kArr[_j-1] * (' + kdjM1 + '-1)/' + kdjM1 + ' + _rsv[_j] / ' + kdjM1);
    lines.push('        _dArr[_j] = _dArr[_j-1] * (' + kdjM2 + '-1)/' + kdjM2 + ' + _kArr[_j] / ' + kdjM2);
    // MACD
    lines.push('    _ema12 = np.zeros(_n); _ema26 = np.zeros(_n)');
    lines.push('    _ema12[11] = np.mean(_c[:12]); _ema26[25] = np.mean(_c[:26])');
    lines.push('    for _j in range(12, _n): _ema12[_j] = _c[_j] * 2/13 + _ema12[_j-1] * 11/13');
    lines.push('    for _j in range(26, _n): _ema26[_j] = _c[_j] * 2/27 + _ema26[_j-1] * 25/27');
    lines.push('    _dif = _ema12 - _ema26');
    lines.push('    _dea = np.zeros(_n); _dea[33] = np.mean(_dif[26:34])');
    lines.push('    for _j in range(34, _n): _dea[_j] = _dif[_j] * 2/10 + _dea[_j-1] * 8/10');
    // MA
    lines.push('    _maS = np.convolve(_c, np.ones(' + maShort + ')/' + maShort + ', \'valid\')');
    lines.push('    _maM = np.convolve(_c, np.ones(' + maMid + ')/' + maMid + ', \'valid\')');
    lines.push('    _maL = np.convolve(_c, np.ones(' + maLong + ')/' + maLong + ', \'valid\')');
    // Score
    lines.push('    _score = np.zeros(_n)');
    lines.push('    _start = max(' + maLong + '-1, ' + kdjN + '+1, 34)');
    lines.push('    for _j in range(_start, _n):');
    lines.push('        _cnt = 0');
    lines.push('        if not np.isnan(_rsi[_j]) and _rsi[_j] < ' + rsiOversold + ': _cnt += 1');
    lines.push('        if not np.isnan(_kArr[_j]) and not np.isnan(_dArr[_j]) and _kArr[_j-1] <= _dArr[_j-1] and _kArr[_j] > _dArr[_j]: _cnt += 1');
    lines.push('        if not np.isnan(_dif[_j]) and not np.isnan(_dea[_j]) and _dif[_j-1] <= _dea[_j-1] and _dif[_j] > _dea[_j]: _cnt += 1');
    lines.push('        _maSIdx = _j - ' + (maShort - 1) + '; _maMIdx = _j - ' + (maMid - 1) + '; _maLIdx = _j - ' + (maLong - 1));
    lines.push('        if _maSIdx >= 0 and _maMIdx >= 0 and _maLIdx >= 0:');
    lines.push('            if _maS[_maSIdx] > _maM[_maMIdx] and _maM[_maMIdx] > _maL[_maLIdx]: _cnt += 1');
    lines.push('        _score[_j] = _cnt');
    lines.push('    ' + sigVar + '.append(_score[-1] >= ' + threshold + ')');
    var reason = '共振分数≥' + threshold + '(' + (card.action === 'buy' ? '买入' : '卖出') + ')';
    return { code: lines, cond: '', reason: reason };
}

function genSevenSwords(card, idx) {
    var p = card.params;
    var minBullish = parseInt(p.minBullish) || 4;
    var activeSwords = [];
    if (p.useVol !== 'false') activeSwords.push('vol');
    if (p.useCCI !== 'false') activeSwords.push('cci');
    if (p.useMACD !== 'false') activeSwords.push('macd');
    if (p.useSAR !== 'false') activeSwords.push('sar');
    if (p.useRSI !== 'false') activeSwords.push('rsi');
    if (p.useKDJ !== 'false') activeSwords.push('kdj');
    if (p.useCJDX !== 'false') activeSwords.push('cjdx');
    var maxActive = activeSwords.length;
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var needBars = 30;
    var lines = [];
    lines.push('# Card ' + idx + ': 七脉神剑 (活跃指标: ' + activeSwords.join(',') + ')');
    lines.push(contextName(idx, 'closes') + ' = history_bars(stock, ' + needBars + ', \'1d\', \'close\')');
    lines.push(contextName(idx, 'highs') + ' = history_bars(stock, ' + needBars + ', \'1d\', \'high\')');
    lines.push(contextName(idx, 'lows') + ' = history_bars(stock, ' + needBars + ', \'1d\', \'low\')');
    lines.push(contextName(idx, 'volumes') + ' = history_bars(stock, ' + needBars + ', \'1d\', \'volume\')');
    lines.push('if len(' + contextName(idx, 'closes') + ') < ' + needBars + ':');
    lines.push('    ' + sigVar + '.append(False)');
    lines.push('else:');
    lines.push('    import numpy as np');
    lines.push('    _c = np.array(' + contextName(idx, 'closes') + ')');
    lines.push('    _h = np.array(' + contextName(idx, 'highs') + ')');
    lines.push('    _l = np.array(' + contextName(idx, 'lows') + ')');
    lines.push('    _v = np.array(' + contextName(idx, 'volumes') + ')');
    lines.push('    _n = len(_c)');
    lines.push('    _swords = np.zeros(7)  # [VOL, CCI, MACD, SAR, RSI, KDJ, CJDX]');

    // 1. VOL: MA5 > MA10
    if (activeSwords.indexOf('vol') >= 0) {
        lines.push('    _v_ma5 = np.convolve(_v, np.ones(5)/5, \'valid\')[-1]');
        lines.push('    _v_ma10 = np.convolve(_v, np.ones(10)/10, \'valid\')[-1]');
        lines.push('    _swords[0] = 1 if _v_ma5 > _v_ma10 else -1');
    }

    // 2. CCI(14)
    if (activeSwords.indexOf('cci') >= 0) {
        lines.push('    _tp = (_h + _l + _c) / 3');
        lines.push('    _tp_ma14 = np.mean(_tp[-14:])');
        lines.push('    _md14 = np.mean(np.abs(_tp[-14:] - _tp_ma14))');
        lines.push('    _cci = (_tp[-1] - _tp_ma14) / (0.015 * _md14) if _md14 > 0 else 0');
        lines.push('    if _cci < -100: _swords[1] = 1');
        lines.push('    elif _cci > 100: _swords[1] = -1');
    }

    // 3. MACD(12,26,9): DIF > DEA
    if (activeSwords.indexOf('macd') >= 0) {
        lines.push('    _ema12 = np.zeros(_n); _ema26 = np.zeros(_n)');
        lines.push('    _ema12[11] = np.mean(_c[:12]); _ema26[25] = np.mean(_c[:26])');
        lines.push('    for _j in range(12, _n): _ema12[_j] = _c[_j] * 2/13 + _ema12[_j-1] * 11/13');
        lines.push('    for _j in range(26, _n): _ema26[_j] = _c[_j] * 2/27 + _ema26[_j-1] * 25/27');
        lines.push('    _dif = _ema12 - _ema26');
        lines.push('    _dea = np.zeros(_n); _dea[33] = np.mean(_dif[26:34])');
        lines.push('    for _j in range(34, _n): _dea[_j] = _dif[_j] * 2/10 + _dea[_j-1] * 8/10');
        lines.push('    _swords[2] = 1 if _dif[-1] > _dea[-1] else -1');
    }

    // 4. SAR(0.02, 0.2): 价格 > SAR
    if (activeSwords.indexOf('sar') >= 0) {
        lines.push('    _sar = _l[0]; _ep = _h[0]; _af = 0.02; _up = True');
        lines.push('    for _j in range(1, _n):');
        lines.push('        _prevSar = _sar');
        lines.push('        if _up:');
        lines.push('            _sar = _prevSar + _af * (_ep - _prevSar)');
        lines.push('            _sar = min(_sar, _l[_j-1]); if _j > 1: _sar = min(_sar, _l[_j-2])');
        lines.push('        else:');
        lines.push('            _sar = _prevSar + _af * (_ep - _prevSar)');
        lines.push('            _sar = max(_sar, _h[_j-1]); if _j > 1: _sar = max(_sar, _h[_j-2])');
        lines.push('        if _up:');
        lines.push('            if _h[_j] > _ep: _ep = _h[_j]; _af = min(_af + 0.02, 0.2)');
        lines.push('            if _l[_j] < _sar: _up = False; _sar = _ep; _ep = _l[_j]; _af = 0.02');
        lines.push('        else:');
        lines.push('            if _l[_j] < _ep: _ep = _l[_j]; _af = min(_af + 0.02, 0.2)');
        lines.push('            if _h[_j] > _sar: _up = True; _sar = _ep; _ep = _h[_j]; _af = 0.02');
        lines.push('    _swords[3] = 1 if _c[-1] > _sar else -1');
    }

    // 5. RSI(6)
    if (activeSwords.indexOf('rsi') >= 0) {
        lines.push('    _delta6 = np.diff(_c[-7:])');
        lines.push('    _gain6 = np.mean(np.where(_delta6 > 0, _delta6, 0))');
        lines.push('    _loss6 = np.mean(np.where(_delta6 < 0, -_delta6, 0))');
        lines.push('    _rsi6 = 100 - 100 / (1 + _gain6 / _loss6) if _loss6 > 0 else 100');
        lines.push('    if _rsi6 < 30: _swords[4] = 1');
        lines.push('    elif _rsi6 > 70: _swords[4] = -1');
    }

    // 6. KDJ(9,3,3): K > D
    if (activeSwords.indexOf('kdj') >= 0) {
        lines.push('    _low9 = np.array([np.min(_l[max(0,_j-8):_j+1]) for _j in range(_n)])');
        lines.push('    _high9 = np.array([np.max(_h[max(0,_j-8):_j+1]) for _j in range(_n)])');
        lines.push('    _rsv = np.where(_high9 - _low9 > 0, (_c - _low9) / (_high9 - _low9) * 100, 50)');
        lines.push('    _k9 = np.zeros(_n); _d9 = np.zeros(_n); _j9 = np.zeros(_n)');
        lines.push('    for _j in range(1, _n):');
        lines.push('        _k9[_j] = _k9[_j-1] * 2/3 + _rsv[_j] / 3');
        lines.push('        _d9[_j] = _d9[_j-1] * 2/3 + _k9[_j] / 3');
        lines.push('        _j9[_j] = 3 * _k9[_j] - 2 * _d9[_j]');
        lines.push('    _swords[5] = 1 if _k9[-1] > _d9[-1] else -1');
    }

    // 7. CJDX: J[i] > J[i-1]
    if (activeSwords.indexOf('cjdx') >= 0 && activeSwords.indexOf('kdj') < 0) {
        // 如果 KDJ 已计算，复用 _j9；否则需重新计算
        lines.push('    _low9b = np.array([np.min(_l[max(0,_j-8):_j+1]) for _j in range(_n)])');
        lines.push('    _high9b = np.array([np.max(_h[max(0,_j-8):_j+1]) for _j in range(_n)])');
        lines.push('    _rsvb = np.where(_high9b - _low9b > 0, (_c - _low9b) / (_high9b - _low9b) * 100, 50)');
        lines.push('    _k9b = np.zeros(_n); _d9b = np.zeros(_n); _j9b = np.zeros(_n)');
        lines.push('    for _j in range(1, _n):');
        lines.push('        _k9b[_j] = _k9b[_j-1] * 2/3 + _rsvb[_j] / 3');
        lines.push('        _d9b[_j] = _d9b[_j-1] * 2/3 + _k9b[_j] / 3');
        lines.push('        _j9b[_j] = 3 * _k9b[_j] - 2 * _d9b[_j]');
        lines.push('    _swords[6] = 1 if _j9b[-1] > _j9b[-2] else -1');
    } else if (activeSwords.indexOf('cjdx') >= 0) {
        lines.push('    _swords[6] = 1 if _j9[-1] > _j9[-2] else -1');
    }

    lines.push('    _bullCount = int(np.sum(_swords == 1))');
    lines.push('    ' + sigVar + '.append(_bullCount >= ' + minBullish + ')');
    var reason = '七脉神剑多头数≥' + minBullish + '/' + maxActive;
    return { code: lines, cond: '', reason: reason };
}

function genTrendStrength(card, idx) {
    var p = card.params;
    var signalType = p.signal_type || 'short_bottom';
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var needBars = signalType === 'golden_finger' ? 130 : 180;
    var lines = [];
    lines.push('# Card ' + idx + ': 趋势强度');
    lines.push(contextName(idx, 'highs') + ' = history_bars(stock, ' + needBars + ', \'1d\', \'high\')');
    lines.push(contextName(idx, 'lows') + ' = history_bars(stock, ' + needBars + ', \'1d\', \'low\')');
    lines.push(contextName(idx, 'closes') + ' = history_bars(stock, ' + needBars + ', \'1d\', \'close\')');
    lines.push('if len(' + contextName(idx, 'closes') + ') < ' + needBars + ':');
    lines.push('    ' + sigVar + '.append(False)');
    lines.push('else:');
    lines.push('    _h = np.array(' + contextName(idx, 'highs') + ')');
    lines.push('    _l = np.array(' + contextName(idx, 'lows') + ')');
    lines.push('    _c = np.array(' + contextName(idx, 'closes') + ')');
    lines.push('    _n = len(_c)');

    if (signalType === 'short_bottom') {
        // 短底信号: 基于168日低点和21日高点的归一化EMA交叉
        lines.push('    _low168 = np.array([np.min(_l[max(0,_j-167):_j+1]) for _j in range(_n)])');
        lines.push('    _high21 = np.array([np.max(_h[max(0,_j-20):_j+1]) for _j in range(_n)])');
        lines.push('    _norm = np.where(_high21 - _low168 > 0, (_c - _low168) / (_high21 - _low168), 0.5)');
        lines.push('    _ema = np.zeros(_n); _ema[0] = _norm[0]');
        lines.push('    for _j in range(1, _n): _ema[_j] = _ema[_j-1] * 0.9 + _norm[_j] * 0.1');
        lines.push('    ' + sigVar + '.append(_norm[-1] > _ema[-1] and _norm[-2] <= _ema[-2])');
    } else if (signalType === 'golden_finger') {
        // 金手指: MA20上穿MA120
        lines.push('    _ma20 = np.convolve(_c, np.ones(20)/20, \'valid\')');
        lines.push('    _ma120 = np.convolve(_c, np.ones(120)/120, \'valid\')');
        lines.push('    _idx20 = _n - 20; _idx120 = _n - 120');
        lines.push('    ' + sigVar + '.append(_idx20 >= 0 and _idx120 >= 0 and _ma20[_idx20] > _ma120[_idx120] and _ma20[_idx20-1] <= _ma120[_idx120-1])');
    } else if (signalType === 'price_above_pressure') {
        // 价格突破压力线（20日高点）
        lines.push('    _high20 = np.array([np.max(_h[max(0,_j-19):_j+1]) for _j in range(_n)])');
        lines.push('    ' + sigVar + '.append(_c[-1] > _high20[-1])');
    } else if (signalType === 'price_below_support') {
        // 价格跌破支撑线（20日低点）
        lines.push('    _low20 = np.array([np.min(_l[max(0,_j-19):_j+1]) for _j in range(_n)])');
        lines.push('    ' + sigVar + '.append(_c[-1] < _low20[-1])');
    }
    var reasonMap = { short_bottom: '趋势强度短底信号', golden_finger: '趋势强度金手指', price_above_pressure: '趋势强度突破压力', price_below_support: '趋势强度跌破支撑' };
    var reason = (reasonMap[signalType] || '趋势强度') + (card.action === 'buy' ? '买入' : '卖出');
    return { code: lines, cond: '', reason: reason };
}

function genVWAP(card, idx) {
    var p = card.params;
    var period = p.period;
    var direction = p.direction;
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var needBars = period + 2;
    var lines = [];
    lines.push('# Card ' + idx + ': VWAP 信号');
    lines.push(contextName(idx, 'highs') + ' = history_bars(stock, ' + needBars + ', \'1d\', \'high\')');
    lines.push(contextName(idx, 'lows') + ' = history_bars(stock, ' + needBars + ', \'1d\', \'low\')');
    lines.push(contextName(idx, 'closes') + ' = history_bars(stock, ' + needBars + ', \'1d\', \'close\')');
    lines.push(contextName(idx, 'vols') + ' = history_bars(stock, ' + needBars + ', \'1d\', \'volume\')');
    lines.push('if len(' + contextName(idx, 'closes') + ') < ' + needBars + ':');
    lines.push('    ' + sigVar + '.append(False)');
    lines.push('else:');
    lines.push('    _h = np.array(' + contextName(idx, 'highs') + ')');
    lines.push('    _l = np.array(' + contextName(idx, 'lows') + ')');
    lines.push('    _c = np.array(' + contextName(idx, 'closes') + ')');
    lines.push('    _v = np.array(' + contextName(idx, 'vols') + ')');
    lines.push('    _typical = (_h[-' + (period + 1) + ':-1] + _l[-' + (period + 1) + ':-1] + _c[-' + (period + 1) + ':-1]) / 3.0');
    lines.push('    _tv = _typical * _v[-' + (period + 1) + ':-1]');
    lines.push('    _cum_tv = np.sum(_tv)');
    lines.push('    _cum_vol = np.sum(_v[-' + (period + 1) + ':-1])');
    lines.push('    _vwap = _cum_tv / _cum_vol if _cum_vol != 0 else _c[-1]');
    lines.push('    _cur_close = _c[-1]');
    if (direction === 'above') {
        lines.push('    ' + sigVar + '.append(_cur_close > _vwap)');
    } else {
        lines.push('    ' + sigVar + '.append(_cur_close < _vwap)');
    }
    var reason = direction === 'above' ? '收盘价 > VWAP(' + period + ')' + (card.action === 'buy' ? '买入' : '卖出') : '收盘价 < VWAP(' + period + ')' + (card.action === 'buy' ? '买入' : '卖出');
    return { code: lines, cond: '', reason: reason };
}

function genMedian(card, idx) {
    var p = card.params;
    var period = p.period;
    var direction = p.direction;
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var needBars = period + 2;
    var lines = [];
    lines.push('# Card ' + idx + ': 中位数信号');
    lines.push(contextName(idx, 'closes') + ' = history_bars(stock, ' + needBars + ', \'1d\', \'close\')');
    lines.push('if len(' + contextName(idx, 'closes') + ') < ' + needBars + ':');
    lines.push('    ' + sigVar + '.append(False)');
    lines.push('else:');
    lines.push('    _c = np.array(' + contextName(idx, 'closes') + ')');
    lines.push('    _median = np.median(_c[-' + (period + 1) + ':-1])');
    lines.push('    _cur_close = _c[-1]');
    if (direction === 'above') {
        lines.push('    ' + sigVar + '.append(_cur_close > _median)');
    } else {
        lines.push('    ' + sigVar + '.append(_cur_close < _median)');
    }
    var reason = direction === 'above' ? '收盘价 > 中位数(' + period + ')' + (card.action === 'buy' ? '买入' : '卖出') : '收盘价 < 中位数(' + period + ')' + (card.action === 'buy' ? '买入' : '卖出');
    return { code: lines, cond: '', reason: reason };
}

function genMean(card, idx) {
    var p = card.params;
    var period = p.period;
    var direction = p.direction;
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var needBars = period + 2;
    var lines = [];
    lines.push('# Card ' + idx + ': 算术平均信号');
    lines.push(contextName(idx, 'closes') + ' = history_bars(stock, ' + needBars + ', \'1d\', \'close\')');
    lines.push('if len(' + contextName(idx, 'closes') + ') < ' + needBars + ':');
    lines.push('    ' + sigVar + '.append(False)');
    lines.push('else:');
    lines.push('    _c = np.array(' + contextName(idx, 'closes') + ')');
    lines.push('    _mean = np.mean(_c[-' + (period + 1) + ':-1])');
    lines.push('    _cur_close = _c[-1]');
    if (direction === 'above') {
        lines.push('    ' + sigVar + '.append(_cur_close > _mean)');
    } else {
        lines.push('    ' + sigVar + '.append(_cur_close < _mean)');
    }
    var reason = direction === 'above' ? '收盘价 > 算术平均(' + period + ')' + (card.action === 'buy' ? '买入' : '卖出') : '收盘价 < 算术平均(' + period + ')' + (card.action === 'buy' ? '买入' : '卖出');
    return { code: lines, cond: '', reason: reason };
}

function genTurnoverThreshold(card, idx) {
    var p = card.params;
    var threshold = p.threshold;
    var direction = p.direction;
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var lines = [];
    lines.push('# Card ' + idx + ': 换手率阈值');
    lines.push('turnovers = history_bars(stock, 2, \'1d\', \'turnover_rate_f\')');
    lines.push('if len(turnovers) < 1:');
    lines.push('    ' + sigVar + '.append(False)');
    lines.push('else:');
    lines.push('    cur_turn = turnovers[-1]');
    lines.push('    if cur_turn is None or np.isnan(cur_turn):');
    lines.push('        ' + sigVar + '.append(False)');
    if (direction === 'above') {
        lines.push('    else:');
        lines.push('        ' + sigVar + '.append(cur_turn > ' + threshold + ')');
    } else {
        lines.push('    else:');
        lines.push('        ' + sigVar + '.append(cur_turn < ' + threshold + ')');
    }
    var reason = (direction === 'above' ? '换手率>' : '换手率<') + threshold + '%';
    return { code: lines, cond: '', reason: reason };
}

function genTurnoverRatio(card, idx) {
    var p = card.params;
    var period = p.period;
    var ratio = p.ratio;
    var direction = p.direction;
    var sigVar = card.action === 'buy' ? 'entry_signals' : 'exit_signals';
    var needBars = period + 2;
    var lines = [];
    lines.push('# Card ' + idx + ': 换手率均量比');
    lines.push('turnovers = history_bars(stock, ' + needBars + ', \'1d\', \'turnover_rate_f\')');
    lines.push('if len(turnovers) < ' + needBars + ':');
    lines.push('    ' + sigVar + '.append(False)');
    lines.push('else:');
    lines.push('    cur_turn = turnovers[-1]');
    lines.push('    prev_turns = turnovers[-' + (period + 1) + ':-1]');
    lines.push('    prev_turns_clean = [x for x in prev_turns if x is not None and not np.isnan(x)]');
    lines.push('    if cur_turn is None or np.isnan(cur_turn) or len(prev_turns_clean) == 0:');
    lines.push('        ' + sigVar + '.append(False)');
    lines.push('    else:');
    lines.push('        avg_turn = np.mean(prev_turns_clean)');
    if (direction === 'above') {
        lines.push('        ' + sigVar + '.append(cur_turn > avg_turn * ' + ratio + ')');
    } else {
        lines.push('        ' + sigVar + '.append(cur_turn < avg_turn * ' + ratio + ')');
    }
    var reason = (direction === 'above' ? '换手率放量' : '换手率缩量') + '（均量' + period + '日）';
    return { code: lines, cond: '', reason: reason };
}

// ---- Index Sentiment code generation ----

function genIndexSentiment(card, idx) {
    var p = card.params;
    var varName = 'index_cond_' + idx;
    var indexCode = p.index_code || '000300.SH';
    var indicator = p.indicator || 'close_above_ma';
    var strictMode = p.strict_mode === true ? 'True' : 'False';
    var updateFunc = 'update_' + varName;
    var lines = [];

    lines.push('# Card ' + idx + ': 指数情绪 - ' + indicator);
    lines.push('def ' + updateFunc + '(context):');

    switch (indicator) {
        case 'close_above_ma':
            var maPeriod = p.ma_period || 20;
            lines.push('    closes = get_index_history("' + indexCode + '", ' + (maPeriod + 1) + ', "close", strict=' + strictMode + ')');
            lines.push('    if len(closes) < ' + (maPeriod + 1) + ':');
            lines.push('        context.' + varName + ' = False');
            lines.push('    else:');
            lines.push('        ma = np.mean(closes[-' + maPeriod + ':])');
            lines.push('        prev_close = closes[-1]');
            lines.push('        context.' + varName + ' = prev_close > ma');
            break;
        case 'close_below_ma':
            var maPeriod2 = p.ma_period || 20;
            lines.push('    closes = get_index_history("' + indexCode + '", ' + (maPeriod2 + 1) + ', "close", strict=' + strictMode + ')');
            lines.push('    if len(closes) < ' + (maPeriod2 + 1) + ':');
            lines.push('        context.' + varName + ' = False');
            lines.push('    else:');
            lines.push('        ma = np.mean(closes[-' + maPeriod2 + ':])');
            lines.push('        prev_close = closes[-1]');
            lines.push('        context.' + varName + ' = prev_close < ma');
            break;
        case 'rsi_above':
            var rsiPeriod = p.rsi_period || 14;
            var threshold = p.rsi_threshold || 70;
            lines.push('    closes = get_index_history("' + indexCode + '", ' + (rsiPeriod + 2) + ', "close", strict=' + strictMode + ')');
            lines.push('    if len(closes) < ' + (rsiPeriod + 2) + ':');
            lines.push('        context.' + varName + ' = False');
            lines.push('    else:');
            lines.push('        diffs = np.diff(closes)');
            lines.push('        gains = np.where(diffs > 0, diffs, 0)');
            lines.push('        losses = np.where(diffs < 0, -diffs, 0)');
            lines.push('        avg_gain = gains[-' + rsiPeriod + ':].mean()');
            lines.push('        avg_loss = losses[-' + rsiPeriod + ':].mean()');
            lines.push('        if avg_loss == 0:');
            lines.push('            rsi_val = 100');
            lines.push('        else:');
            lines.push('            rsi_val = 100 - 100 / (1 + avg_gain / avg_loss)');
            lines.push('        context.' + varName + ' = rsi_val > ' + threshold);
            break;
        case 'rsi_below':
            var rsiPeriod2 = p.rsi_period || 14;
            var threshold2 = p.rsi_threshold || 70;
            lines.push('    closes = get_index_history("' + indexCode + '", ' + (rsiPeriod2 + 2) + ', "close", strict=' + strictMode + ')');
            lines.push('    if len(closes) < ' + (rsiPeriod2 + 2) + ':');
            lines.push('        context.' + varName + ' = False');
            lines.push('    else:');
            lines.push('        diffs = np.diff(closes)');
            lines.push('        gains = np.where(diffs > 0, diffs, 0)');
            lines.push('        losses = np.where(diffs < 0, -diffs, 0)');
            lines.push('        avg_gain = gains[-' + rsiPeriod2 + ':].mean()');
            lines.push('        avg_loss = losses[-' + rsiPeriod2 + ':].mean()');
            lines.push('        if avg_loss == 0:');
            lines.push('            rsi_val = 100');
            lines.push('        else:');
            lines.push('            rsi_val = 100 - 100 / (1 + avg_gain / avg_loss)');
            lines.push('        context.' + varName + ' = rsi_val < ' + threshold2);
            break;
        case 'macd_golden':
            lines.push('    closes = get_index_history("' + indexCode + '", 35, "close", strict=' + strictMode + ')');
            lines.push('    if len(closes) < 35:');
            lines.push('        context.' + varName + ' = False');
            lines.push('    else:');
            lines.push('        ema_fast = pd.Series(closes).ewm(span=12, adjust=False).mean().values');
            lines.push('        ema_slow = pd.Series(closes).ewm(span=26, adjust=False).mean().values');
            lines.push('        dif = ema_fast - ema_slow');
            lines.push('        dea = pd.Series(dif).ewm(span=9, adjust=False).mean().values');
            lines.push('        context.' + varName + ' = dif[-2] <= dea[-2] and dif[-1] > dea[-1]');
            break;
        case 'macd_death':
            lines.push('    closes = get_index_history("' + indexCode + '", 35, "close", strict=' + strictMode + ')');
            lines.push('    if len(closes) < 35:');
            lines.push('        context.' + varName + ' = False');
            lines.push('    else:');
            lines.push('        ema_fast = pd.Series(closes).ewm(span=12, adjust=False).mean().values');
            lines.push('        ema_slow = pd.Series(closes).ewm(span=26, adjust=False).mean().values');
            lines.push('        dif = ema_fast - ema_slow');
            lines.push('        dea = pd.Series(dif).ewm(span=9, adjust=False).mean().values');
            lines.push('        context.' + varName + ' = dif[-2] >= dea[-2] and dif[-1] < dea[-1]');
            break;

        case 'macd_bull':
		    lines.push('    closes = get_index_history("' + indexCode + '", 35, "close", strict=' + strictMode + ')');
		    lines.push('    if len(closes) < 35:');
		    lines.push('        context.' + varName + ' = False');
		    lines.push('    else:');
		    lines.push('        ema_fast = pd.Series(closes).ewm(span=12, adjust=False).mean().values');
		    lines.push('        ema_slow = pd.Series(closes).ewm(span=26, adjust=False).mean().values');
		    lines.push('        dif = ema_fast - ema_slow');
		    lines.push('        dea = pd.Series(dif).ewm(span=9, adjust=False).mean().values');
		    lines.push('        context.' + varName + ' = dif[-1] > dea[-1]');
		    break;
		case 'macd_bear':
		    lines.push('    closes = get_index_history("' + indexCode + '", 35, "close", strict=' + strictMode + ')');
		    lines.push('    if len(closes) < 35:');
		    lines.push('        context.' + varName + ' = False');
		    lines.push('    else:');
		    lines.push('        ema_fast = pd.Series(closes).ewm(span=12, adjust=False).mean().values');
		    lines.push('        ema_slow = pd.Series(closes).ewm(span=26, adjust=False).mean().values');
		    lines.push('        dif = ema_fast - ema_slow');
		    lines.push('        dea = pd.Series(dif).ewm(span=9, adjust=False).mean().values');
		    lines.push('        context.' + varName + ' = dif[-1] < dea[-1]');
		    break;
		case 'dif_above_zero':
		    lines.push('    closes = get_index_history("' + indexCode + '", 35, "close", strict=' + strictMode + ')');
		    lines.push('    if len(closes) < 35:');
		    lines.push('        context.' + varName + ' = False');
		    lines.push('    else:');
		    lines.push('        ema_fast = pd.Series(closes).ewm(span=12, adjust=False).mean().values');
		    lines.push('        ema_slow = pd.Series(closes).ewm(span=26, adjust=False).mean().values');
		    lines.push('        dif = ema_fast - ema_slow');
		    lines.push('        context.' + varName + ' = dif[-1] > 0');
		    break;
		case 'dif_below_zero':
		    lines.push('    closes = get_index_history("' + indexCode + '", 35, "close", strict=' + strictMode + ')');
		    lines.push('    if len(closes) < 35:');
		    lines.push('        context.' + varName + ' = False');
		    lines.push('    else:');
		    lines.push('        ema_fast = pd.Series(closes).ewm(span=12, adjust=False).mean().values');
		    lines.push('        ema_slow = pd.Series(closes).ewm(span=26, adjust=False).mean().values');
		    lines.push('        dif = ema_fast - ema_slow');
		    lines.push('        context.' + varName + ' = dif[-1] < 0');
		    break;

        case 'volume_ratio':
            var volPeriod = p.volume_ratio_period || 20;
            var volThreshold = p.volume_ratio_threshold || 1.5;
            lines.push('    vols = get_index_history("' + indexCode + '", ' + (volPeriod + 1) + ', "volume", strict=' + strictMode + ')');
            lines.push('    if len(vols) < ' + (volPeriod + 1) + ':');
            lines.push('        context.' + varName + ' = False');
            lines.push('    else:');
            lines.push('        avg_vol = np.mean(vols[-' + volPeriod + ':-1]) if len(vols) >= ' + (volPeriod + 1) + ' else np.mean(vols[:-' + volPeriod + '])');
            lines.push('        cur_vol = vols[-1]');
            lines.push('        context.' + varName + ' = cur_vol > avg_vol * ' + volThreshold);
            break;
        default:
            lines.push('    context.' + varName + ' = True');
            break;
    }

    return { updateFunc: updateFunc, varName: varName, code: lines };
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

    var indexCards = [];
    for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        if (card.type === 'stop_loss_profit') { hasStopLoss = true; stopLossCard = card; }
        if (card.type === 'position') { positionCard = card; }
        if (card.type === 'index_sentiment') { indexCards.push({ card: card, idx: i }); }
    }
    if (positionCard) {
        var posMode = positionCard.params.position_mode || 'percentage';
        var posValue = positionCard.params.position_value;
        // 向后兼容旧格式: positionType + fixedPercent
        if (posValue === undefined) {
            posMode = 'percentage';
            if (positionCard.params.positionType === 'fixed') {
                posValue = (positionCard.params.fixedPercent || 1.0) * 100;
            } else if (positionCard.params.positionType === 'kelly') {
                var winRate = 0.5;
                var profitRatio = 2.0;
                var kellyF = winRate - (1 - winRate) / profitRatio;
                kellyF = Math.max(0.01, Math.min(1.0, kellyF));
                posValue = kellyF * 100;
            } else {
                posValue = 100;
            }
        }
        if (posMode === 'percentage') {
            targetPercent = String((posValue || 100) / 100);
        } else {
            // 固定数量模式：targetPercent 设为 1.0，后端通过 position_mode/position_value 计算实际股数
            targetPercent = '1.0';
        }
    }

    var entryLogicSelect = document.getElementById('entryLogicSelect');
    var exitLogicSelect = document.getElementById('exitLogicSelect');
    var entryLogic = entryLogicSelect ? (entryLogicSelect.getAttribute('data-value') || 'all') : 'all';
    var exitLogic = exitLogicSelect ? (exitLogicSelect.getAttribute('data-value') || 'any') : 'any';

    return rebuildOutput(cards, hasStopLoss, stopLossCard, positionCard, targetPercent, indexCards, entryLogic, exitLogic);
}

function rebuildOutput(cards, hasStopLoss, stopLossCard, positionCard, targetPercent, indexCards, entryLogic, exitLogic) {
    var lines = [];
    lines.push('import numpy as np');
    lines.push('import pandas as pd');
    lines.push('');
    lines.push('def initialize(context):');
    lines.push('    context.stock = "STOCK_CODE_PLACEHOLDER"');

    for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        if (card.type === 'index_sentiment') continue;  // handled separately
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
        lines.push('    context._entry_price_dict = {}');
        lines.push('    context._entry_date_dict = {}');
    }

    // 仓位模式与参数（供后端下单函数读取）
    if (positionCard) {
        var _pm = positionCard.params.position_mode || 'percentage';
        var _pv = positionCard.params.position_value;
        if (_pv === undefined) {
            _pm = 'percentage';
            _pv = (positionCard.params.positionType === 'fixed')
                ? (positionCard.params.fixedPercent || 1.0) * 100 : 100;
        }
        lines.push('    context._position_mode = "' + _pm + '"');
        lines.push('    context._position_value = ' + _pv);
        lines.push('    context._quantity_unit = "' + (positionCard.params.quantity_unit || 'shares') + '"');
    } else {
        lines.push('    context._position_mode = "percentage"');
        lines.push('    context._position_value = 100');
    }

    // ---- Index sentiment init vars (inside initialize) ----
    var indexInfos = [];
    var indexFuncLines = [];  // collected separately for module-level insertion
    for (var ix = 0; ix < indexCards.length; ix++) {
        var ic = indexCards[ix];
        var info = genIndexSentiment(ic.card, ic.idx);
        indexInfos.push(info);
        lines.push('    context.' + info.varName + ' = False');
        lines.push('    run_daily(' + info.updateFunc + ', \'every_bar\')');
        // Collect function definition for module-level output
        for (var li = 0; li < info.code.length; li++) {
            indexFuncLines.push(info.code[li]);
        }
        indexFuncLines.push('');
    }

    lines.push('');

    // Module-level index condition update function definitions
    for (var fl = 0; fl < indexFuncLines.length; fl++) {
        lines.push(indexFuncLines[fl]);
    }

    lines.push('def handle_bar(context, bar_dict):');
    lines.push('    stock = context.stock');
    lines.push('    entry_signals = []');
    lines.push('    exit_signals = []');

    // ---- 检查涨跌停限制卡片 ----
    var hasPriceLimit = false;
    var priceLimitType = 'no_buy_on_limit_up';
    for (var pi = 0; pi < cards.length; pi++) {
        if (cards[pi].type === 'price_limit') {
            hasPriceLimit = true;
            priceLimitType = cards[pi].params.limitType || 'no_buy_on_limit_up';
            break;
        }
    }
    if (hasPriceLimit) {
        lines.push('');
        lines.push('    # 涨跌停限制');
        lines.push('    def _is_limit_up(prev_close):');
        lines.push('        if prev_close is None or prev_close <= 0:');
        lines.push('            return False');
        lines.push('        return bar_dict[\'high\'] >= round(prev_close * 1.1, 2)');
        lines.push('');
        lines.push('    def _is_limit_down(prev_close):');
        lines.push('        if prev_close is None or prev_close <= 0:');
        lines.push('            return False');
        lines.push('        return bar_dict[\'low\'] <= round(prev_close * 0.9, 2)');
        lines.push('');
        lines.push('    _prev_closes = history_bars(stock, 2, \'1d\', \'close\')');
        lines.push('    _prev_close = _prev_closes[-2] if len(_prev_closes) >= 2 else None');
        lines.push('');
        lines.push('    _buy_blocked = \'' + priceLimitType + '\' in [\'no_buy_on_limit_up\', \'both\'] and _is_limit_up(_prev_close)');
        lines.push('    _sell_blocked = \'' + priceLimitType + '\' in [\'no_sell_on_limit_down\', \'both\'] and _is_limit_down(_prev_close)');
    }
    lines.push('');

    // ---- 计算指数情绪条件（任一满足即允许交易）----
    if (indexInfos.length > 0) {
        var condNames = indexInfos.map(function(inf) { return 'context.' + inf.varName; });
        lines.push('    any_index_conds = ' + condNames.join(' or '));
    } else {
        lines.push('    any_index_conds = True');
    }

    var entryReasons = [];
    var exitReasons = [];

    // Generate each card's condition block
    for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        if (card.type === 'position') continue;

        var genResult;
        switch (card.type) {
            case 'turnover_threshold': genResult = genTurnoverThreshold(card, i); break;
            case 'turnover_ratio': genResult = genTurnoverRatio(card, i); break;
            case 'vwap_signal': genResult = genVWAP(card, i); break;
            case 'median_signal': genResult = genMedian(card, i); break;
            case 'mean_signal': genResult = genMean(card, i); break;
            case 'ma_cross': genResult = genMACross(card, i); break;
            case 'rsi': genResult = genRSI(card, i); break;
            case 'macd': genResult = genMACD(card, i); break;
            case 'bollinger': genResult = genBollinger(card, i); break;
            case 'bollinger_width': genResult = genBollingerWidth(card, i); break;
            case 'kdj': genResult = genKDJ(card, i); break;
            case 'volume': genResult = genVolume(card, i); break;
            case 'atr_breakout': genResult = genATRBreakout(card, i); break;
            case 'cci': genResult = genCCI(card, i); break;
            case 'volume_contraction': genResult = genVolumeContraction(card, i); break;
            case 'day_of_week': genResult = genDayOfWeek(card, i); break;
            case 'sar': genResult = genSAR(card, i); break;
            case 'obv': genResult = genOBV(card, i); break;
            case 'hammer_hanging': genResult = genHammerHanging(card, i); break;
            case 'williams_r': genResult = genWilliamsR(card, i); break;
            case 'roc': genResult = genROC(card, i); break;
            case 'psy': genResult = genPSY(card, i); break;
            case 'ma_alignment': genResult = genMAAlignment(card, i); break;
            case 'resonance': genResult = genResonance(card, i); break;
            case 'seven_swords': genResult = genSevenSwords(card, i); break;
            case 'stop_loss_profit':
                lines.push('    # Card ' + i + ': 止损止盈（参数已记录）');
                lines.push('');
                continue;
            case 'price_limit':
                lines.push('    # Card ' + i + ': 涨跌停限制（已在 bar 入口拦截）');
                lines.push('');
                continue;
            case 'index_sentiment':
                lines.push('    # Card ' + i + ': 指数情绪（已通过 run_daily 更新 context 变量）');
                lines.push('');
                continue;
            default: continue;
        }

        if (genResult && genResult.reason) {
            if (card.action === 'buy') {
                entryReasons.push(genResult.reason);
            } else {
                exitReasons.push(genResult.reason);
            }
        }

        for (var li = 0; li < genResult.code.length; li++) {
            lines.push('    ' + genResult.code[li]);
        }
        if (genResult.cond) {
            var sigType = card.action === 'buy' ? 'entry' : 'exit';
            lines.push('    ' + sigType + '_signals.append(' + genResult.cond + ')');
        }
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

    var entryFunc = entryLogic === 'all' ? 'all' : 'any';
    var exitFunc = exitLogic === 'all' ? 'all' : 'any';

    // Execute entry
    lines.push('    # 执行入场信号（逻辑: ' + (entryLogic === 'all' ? 'AND' : 'OR') + '）');
    var entryReasonLine = entryReasons.length > 0 ? 'context._last_signal_reason = "' + entryReasons.join('+') + '"' : null;
    lines.push('    if len(entry_signals) > 0 and ' + entryFunc + '(entry_signals) and any_index_conds:');
    if (hasPriceLimit) {
        lines.push('        if _buy_blocked:');
        lines.push('            log.info("涨停不买入")');
        lines.push('        else:');
        if (hasStopLoss) {
            lines.push('            _current_pos = context.portfolio.get("holdings", {}).get(stock, 0)');
        }
        if (entryReasonLine) lines.push('            ' + entryReasonLine);
        lines.push('            order_target_percent(stock, target_percent)');
        if (hasStopLoss) {
            lines.push('            if _current_pos == 0 and target_percent > 0:');
            lines.push('                context._entry_price_dict[stock] = bar_dict["close"]');
            lines.push('                context._entry_date_dict[stock] = context.current_dt');
        }
        lines.push('            log.info("买入信号触发")');
    } else {
        if (hasStopLoss) {
            lines.push('        _current_pos = context.portfolio.get("holdings", {}).get(stock, 0)');
        }
        if (entryReasonLine) lines.push('        ' + entryReasonLine);
        lines.push('        order_target_percent(stock, target_percent)');
        if (hasStopLoss) {
            lines.push('        if _current_pos == 0 and target_percent > 0:');
            lines.push('            context._entry_price_dict[stock] = bar_dict["close"]');
            lines.push('            context._entry_date_dict[stock] = context.current_dt');
        }
        lines.push('        log.info("买入信号触发")');
    }
    lines.push('');

    // Execute exit from exit conditions
    lines.push('    # 执行离场信号（逻辑: ' + (exitLogic === 'all' ? 'AND' : 'OR') + '）');
    var exitReasonLine = exitReasons.length > 0 ? 'context._last_signal_reason = "' + exitReasons.join('+') + '"' : null;
    lines.push('    if len(exit_signals) > 0 and ' + exitFunc + '(exit_signals) and any_index_conds:');
    if (hasPriceLimit) {
        lines.push('        if _sell_blocked:');
        lines.push('            log.info("跌停不卖出")');
        lines.push('        else:');
        if (exitReasonLine) lines.push('            ' + exitReasonLine);
        lines.push('            order_target_percent(stock, 0)');
        if (hasStopLoss) {
            lines.push('            context._entry_price_dict.pop(stock, None)');
            lines.push('            context._entry_date_dict.pop(stock, None)');
        }
        lines.push('            log.info("卖出信号触发")');
    } else {
        if (exitReasonLine) lines.push('        ' + exitReasonLine);
        lines.push('        order_target_percent(stock, 0)');
        if (hasStopLoss) {
            lines.push('        context._entry_price_dict.pop(stock, None)');
            lines.push('        context._entry_date_dict.pop(stock, None)');
        }
        lines.push('        log.info("卖出信号触发")');
    }
    lines.push('');

    // Stop loss / take profit logic (runs independently)
    if (hasStopLoss) {
        lines.push('    # 止损止盈检查');
        lines.push('    positions = context.portfolio.get("holdings", {})');
        lines.push('    stock_pos = positions.get(stock, 0)');
        lines.push('    entry_price = context._entry_price_dict.get(stock, 0.0)');
        lines.push('    entry_date = context._entry_date_dict.get(stock)');
        lines.push('    if stock_pos > 0 and entry_price > 0:');
        lines.push('        current_price = bar_dict["close"]');
        lines.push('        pnl_pct = (current_price - entry_price) / entry_price * 100');
        lines.push('        sl_triggered = pnl_pct <= -sl_percent');
        lines.push('        tp_triggered = pnl_pct >= tp_percent');
        lines.push('        days_triggered = False');
        lines.push('        if entry_date is not None:');
        lines.push('            hold_days = (context.current_dt - entry_date).days');
        lines.push('            days_triggered = hold_days >= max_days');
        lines.push('            log.info("DEBUG: 持有天数={}, max_days={}, days_triggered={}".format(hold_days, max_days, days_triggered))');
        lines.push('        if sl_triggered or tp_triggered or days_triggered:');
        lines.push('            if sl_triggered:');
        lines.push('                context._last_signal_reason = "止损卖出"');
        lines.push('            elif tp_triggered:');
        lines.push('                context._last_signal_reason = "止盈卖出"');
        lines.push('            else:');
        lines.push('                context._last_signal_reason = "持仓天数到期卖出"');
        lines.push('            order_target_percent(stock, 0)');
        lines.push('            context._entry_price_dict.pop(stock, None)');
        lines.push('            context._entry_date_dict.pop(stock, None)');
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

export function serializeConfig(cards, capital, startDate, endDate, stockPool, slippage, commission, stampTax, slippageCostType, slippageCostValue, entryLogic, exitLogic) {
    var config = {
        version: 1,
        cards: cards,
        capital: capital || 1000000,
        startDate: startDate || '2010-01-01',
        endDate: endDate || new Date().toISOString().slice(0, 10),
        stockPool: stockPool || '',
        slippage: slippage || 'close',
        commission_rate: commission !== undefined ? commission : 0.0003,
        stamp_tax_rate: stampTax !== undefined ? stampTax : 0.001,
        slippage_cost_type: slippageCostType || 'percent',
        slippage_cost_value: slippageCostValue !== undefined ? slippageCostValue : 0.1,
        entry_logic: entryLogic || 'all',
        exit_logic: exitLogic || 'any'
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
            endDate: config.endDate || new Date().toISOString().slice(0, 10),
            stockPool: config.stockPool || '',
            slippage: config.slippage || 'close',
            commission_rate: config.commission_rate !== undefined ? config.commission_rate : 0.0003,
            stamp_tax_rate: config.stamp_tax_rate !== undefined ? config.stamp_tax_rate : 0.001,
            slippage_cost_type: config.slippage_cost_type || 'percent',
            slippage_cost_value: config.slippage_cost_value !== undefined ? config.slippage_cost_value : 0.1,
            entry_logic: config.entry_logic || 'all',
            exit_logic: config.exit_logic || 'any',
            poolConfig: config.poolConfig || null
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

/**
 * 从策略卡片数组中提取所有可搜索的数值参数。
 * 参数范围基于 CARD_TYPE_META.paramFields.min/max/default 自动推断。
 *
 * @param {Array} cards - 策略卡片数组 [{type, params}]
 * @returns {Array} [{name, type, low, high, step?, label, cardType}]
 */
export function extractParamsFromCards(cards) {
    var result = [];
    var seen = {};

    cards.forEach(function(card) {
        var meta = CARD_TYPE_META[card.type];
        if (!meta || !meta.paramFields) return;

        meta.paramFields.forEach(function(field) {
            // 只支持 number 类型（整数或浮点），跳过 select
            if (field.type !== 'number') return;

            var name = field.key;
            // 同名参数去重（多张卡可能共用参数名）
            var dedupKey = card.type + '.' + name;
            if (seen[dedupKey]) return;
            seen[dedupKey] = true;

            var currentVal = (card.params && card.params[name] !== undefined)
                ? card.params[name]
                : field.default;

            // 自动推断范围
            var isInt = !field.step || (field.step === 1 && Number.isInteger(field.default));
            var low, high;

            if (isInt) {
                low = Math.max(field.min || 2, Math.floor(currentVal / 3));
                high = Math.min(field.max || 200, Math.ceil(currentVal * 3));
            } else {
                // 浮点参数
                var step = field.step || 0.01;
                low = Math.max(field.min || 0.001, Math.floor((currentVal / 5) / step) * step);
                high = Math.min(field.max || 0.5, Math.ceil((currentVal * 3) / step) * step);
                // 修正精度
                low = parseFloat(low.toFixed(4));
                high = parseFloat(high.toFixed(4));
            }
            // 负值默认参数（如止损 -0.05）会导致 low > high，交换确保 low <= high
            if (low > high) {
                var _swap = low;
                low = high;
                high = _swap;
            }

            result.push({
                name: name,
                label: field.label || name,
                type: isInt ? 'int' : 'float',
                low: low,
                high: high,
                step: field.step || (isInt ? 1 : 0.01),
                default: currentVal,
                cardType: card.type,
            });
        });
    });

    return result;
}
