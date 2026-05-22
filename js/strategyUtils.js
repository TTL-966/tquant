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
    if (positionCard) {
        if (positionCard.params.positionType === 'fixed') {
            targetPercent = String(positionCard.params.fixedPercent || 1.0);
        } else if (positionCard.params.positionType === 'kelly') {
            var winRate = 0.5;
            var profitRatio = 2.0;
            var kellyF = winRate - (1 - winRate) / profitRatio;
            kellyF = Math.max(0.01, Math.min(1.0, kellyF));
            targetPercent = String(kellyF.toFixed(4));
        }
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
        lines.push('    context._entry_price_dict = {}');
        lines.push('    context._entry_date_dict = {}');
    }

    lines.push('');
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

    var entryReasons = [];
    var exitReasons = [];

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
            case 'stop_loss_profit':
                lines.push('    # Card ' + i + ': 止损止盈（参数已记录）');
                lines.push('');
                continue;
            case 'price_limit':
                lines.push('    # Card ' + i + ': 涨跌停限制（已在 bar 入口拦截）');
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

    // Execute entry
    lines.push('    # 执行入场信号');
    var entryReasonLine = entryReasons.length > 0 ? 'context._last_signal_reason = "' + entryReasons.join('+') + '"' : null;
    lines.push('    if len(entry_signals) > 0 and all(entry_signals):');
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
    lines.push('    # 执行离场信号');
    var exitReasonLine = exitReasons.length > 0 ? 'context._last_signal_reason = "' + exitReasons.join('+') + '"' : null;
    lines.push('    if len(exit_signals) > 0 and all(exit_signals):');
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

export function serializeConfig(cards, capital, startDate, endDate, stockPool, slippage, commission, stampTax, slippageCostType, slippageCostValue) {
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
        slippage_cost_value: slippageCostValue !== undefined ? slippageCostValue : 0.1
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
            slippage_cost_value: config.slippage_cost_value !== undefined ? config.slippage_cost_value : 0.1
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
