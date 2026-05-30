import { bridge, log } from './bridge.js';
import { renderKlineWithSignals } from './chartRenderer.js';

function calcMA(values, period) {
    var ma = [];
    for (var i = 0; i < values.length; i++) {
        if (i < period - 1) {
            ma.push(0);
        } else {
            var sum = 0;
            for (var j = 0; j < period; j++) sum += values[i - j][1];
            ma.push(parseFloat((sum / period).toFixed(2)));
        }
    }
    return ma;
}

// ========== 数据缓存 ==========
export var klineDataCache = new Map();

function getCacheKey(type, code, startDate, endDate) {
    return type + '_' + code + '_' + startDate + '_' + endDate;
}

export function clearKlineCache() {
    klineDataCache.clear();
    log("K线缓存已清空");
}

function fmtVolume(vol) {
    if (vol >= 1e8) return (vol / 1e8).toFixed(2) + '亿手';
    if (vol >= 1e4) return (vol / 1e4).toFixed(1) + '万手';
    return vol + '手';
}

function fmtAmount(amt) {
    if (amt >= 1e8) return (amt / 1e8).toFixed(2) + '亿元';
    if (amt >= 1e4) return (amt / 1e4).toFixed(1) + '万元';
    return amt.toFixed(0) + '元';
}

function updateIndexQuoteBar(data, tsCode) {
    if (!data || !data.values || data.values.length === 0) return;

    var lastIdx = data.values.length - 1;
    var last = data.values[lastIdx];
    var openVal = last[0];
    var closeVal = last[1];
    var lowVal = last[2];
    var highVal = last[3];
    var volumeVal = last[4];
    var amountVal = data.amounts ? data.amounts[lastIdx] : 0;

    var changePct = 0;
    if (lastIdx > 0) {
        var prevClose = data.values[lastIdx - 1][1];
        if (prevClose && prevClose !== 0) {
            changePct = ((closeVal - prevClose) / prevClose) * 100;
        }
    }

    var indexName = tsCode;
    var idxSel = document.getElementById('indexSelector');
    if (idxSel && idxSel.value && idxSel.value !== '') {
        indexName = idxSel.value;
    }

    var nameDisplay = document.getElementById('stockNameDisplay');
    var latestPriceSpan = document.getElementById('stockLatestPrice');
    var openEl = document.getElementById('compactOpen');
    var highEl = document.getElementById('compactHigh');
    var lowEl = document.getElementById('compactLow');
    var volEl = document.getElementById('compactVol');
    var amtEl = document.getElementById('compactAmt');
    var changePctEl = document.getElementById('compactChangePct');

    if (nameDisplay) nameDisplay.textContent = indexName + ' (' + tsCode + ')';
    if (latestPriceSpan) {
        latestPriceSpan.textContent = closeVal.toFixed(2);
        latestPriceSpan.className = 'stock-latest-price ' + (changePct >= 0 ? 'price-up' : 'price-down');
    }
    if (openEl) openEl.textContent = openVal.toFixed(2);
    if (highEl) highEl.textContent = highVal.toFixed(2);
    if (lowEl) lowEl.textContent = lowVal.toFixed(2);
    if (volEl) volEl.textContent = fmtVolume(volumeVal);
    if (amtEl) amtEl.textContent = fmtAmount(amountVal / 10000);
    if (changePctEl) {
        changePctEl.textContent = (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%';
        changePctEl.className = changePct >= 0 ? 'price-up' : 'price-down';
    }
}

function renderKlineFromData(data, code, isIndex, buyPts, sellPts) {
    currentKlineDates = data.dates;
    currentKlineValues = data.values;

    if (isIndex) {
        updateIndexQuoteBar(data, code);
    }

    var mgr = window.subChartManager;
    if (mgr) {
        mgr._pendingSubs = [
            { id: 'kchartSubChart1', type: 'volume' },
            { id: 'kchartSubChart2', type: 'rsi' }
        ];
        mgr._stockCode = code;
    }

    setTimeout(function() {
        var maData = {
            dates: data.dates,
            ma5: calcMA(data.values, 5),
            ma10: calcMA(data.values, 10),
            ma20: calcMA(data.values, 20),
            ma30: calcMA(data.values, 30)
        };
        renderKlineWithSignals(data.dates, data.values, buyPts || [], sellPts || [], maData);
    }, 10);
}

export var currentKlineDates = [];
export var currentKlineValues = [];
export var buyPoints = [];
export var sellPoints = [];
export var autoRunBacktest = false;
export var autoBacktestScheduled = false;
export var currentPeriod = 'daily';

export function setPeriod(period) {
    currentPeriod = period;
}

export function fetchAndRenderKline(code, startDate, endDate, period) {
    if (!bridge) {
        var container = document.getElementById('klineMainChart');
        if (container) {
            container.innerHTML = '<div style="color:#aaa; padding:20px;">Bridge 未连接，无法获取数据</div>';
        }
        return;
    }
    period = period || currentPeriod;
    var cacheKey = getCacheKey('stock', code, startDate, endDate);
    if (klineDataCache.has(cacheKey)) {
        log("使用缓存的个股数据: " + code);
        renderKlineFromData(klineDataCache.get(cacheKey), code, false, buyPoints, sellPoints);
        return;
    }

    log("请求个股K线数据: " + code + " 周期 " + period + " 范围 " + startDate + " ~ " + endDate);
    bridge.get_kline_data(code, startDate, endDate, 0, period).then(function(jsonStr) {
        var data = JSON.parse(jsonStr);
        if (data.error) {
            log("后端错误: " + data.error);
            var container = document.getElementById('klineMainChart');
            if (container) {
                container.innerHTML = '<div style="color:#ff6b6b;padding:20px;">错误: ' + data.error + '</div>';
            }
            return;
        }
        if (data.dates && !data.values && data.opens && data.highs && data.lows && data.closes) {
            data.values = data.dates.map(function(_, i) {
                var vol = data.volumes ? data.volumes[i] : 0;
                return [data.opens[i], data.closes[i], data.lows[i], data.highs[i], vol];
            });
        }
        if (!data.dates || !data.values) {
            log("数据格式错误");
            var container = document.getElementById('klineMainChart');
            if (container) {
                container.innerHTML = '<div style="color:#ff6b6b;padding:20px;">数据格式错误</div>';
            }
            return;
        }
        klineDataCache.set(cacheKey, data);
        renderKlineFromData(data, code, false, buyPoints, sellPoints);
    }).catch(function(err) {
        log("请求失败: " + err);
        var container = document.getElementById('klineMainChart');
        if (container) {
            container.innerHTML = '<div style="color:#ff6b6b;padding:20px;">请求失败: ' + err + '</div>';
        }
    });
}

export function fetchAndRenderIndexKline(code, startDate, endDate) {
    if (!bridge) {
        var container = document.getElementById('klineMainChart');
        if (container) {
            container.innerHTML = '<div style="color:#aaa; padding:20px;">Bridge 未连接，无法获取数据</div>';
        }
        return;
    }
    var cacheKey = getCacheKey('index', code, startDate, endDate);
    if (klineDataCache.has(cacheKey)) {
        log("使用缓存的指数数据: " + code);
        renderKlineFromData(klineDataCache.get(cacheKey), code, true, [], []);
        return;
    }

    log("请求指数K线数据: " + code + " 范围 " + startDate + " ~ " + endDate);
    bridge.get_index_data(code, startDate, endDate).then(function(jsonStr) {
        var data = JSON.parse(jsonStr);
        if (data.error) {
            log("后端错误: " + data.error);
            var container = document.getElementById('klineMainChart');
            if (container) {
                container.innerHTML = '<div style="color:#ff6b6b;padding:20px;">错误: ' + data.error + '</div>';
            }
            return;
        }
        if (!data.dates || !data.values) {
            log("数据格式错误");
            var container = document.getElementById('klineMainChart');
            if (container) {
                container.innerHTML = '<div style="color:#ff6b6b;padding:20px;">数据格式错误</div>';
            }
            return;
        }
        klineDataCache.set(cacheKey, data);
        renderKlineFromData(data, code, true, [], []);
    }).catch(function(err) {
        log("请求失败: " + err);
        var container = document.getElementById('klineMainChart');
        if (container) {
            container.innerHTML = '<div style="color:#ff6b6b;padding:20px;">请求失败: ' + err + '</div>';
        }
    });
}

export function runBacktest(code, startDate, endDate) {
    if (!bridge) {
        console.error("Bridge 未连接，无法运行回测");
        return;
    }
    log("运行回测: " + code + " 范围 " + startDate + " ~ " + endDate);
    bridge.run_backtest(code, startDate, endDate).then(function(jsonStr) {
        var res = JSON.parse(jsonStr);
        if (res.error) {
            log("回测出错: " + res.error);
            return;
        }
        if (res.success) {
            buyPoints = res.signals.filter(s => s.type === 'buy');
            sellPoints = res.signals.filter(s => s.type === 'sell');
            var maData = res.ma_data;
            log("回测完成，买入 " + buyPoints.length + " 卖出 " + sellPoints.length);
            if (currentKlineDates.length > 0) {
                // 确保副图管理器有 pending subs（兼容直接调用场景）
                var mgr = window.subChartManager;
                if (mgr && mgr.instances.size === 0) {
                    mgr._pendingSubs = [
                        { id: 'kchartSubChart1', type: 'volume' },
                        { id: 'kchartSubChart2', type: 'rsi' }
                    ];
                    mgr._stockCode = code;
                }
                renderKlineWithSignals(currentKlineDates, currentKlineValues, buyPoints, sellPoints, maData);
            } else {
                fetchAndRenderKline(code, startDate, endDate);
            }
        }
    }).catch(function(err) {
        log("回测请求失败: " + err);
    });
}

// 使用自定义策略执行回测（单只股票，由 strategy.js 模态弹窗调用）
export function runCustomBacktest(stockCode, startDate, endDate, strategyName, cash) {
    if (!bridge) {
        window._lastBacktestError = 'Bridge 未连接';
        return Promise.reject(new Error('Bridge 未连接'));
    }
    var code = window.currentStrategyCode;
    if (!code) {
        window._lastBacktestError = '请先在策略页面保存代码';
        return Promise.reject(new Error('请先在策略页面保存代码'));
    }
    var params = {
        code: code,
        stock: stockCode,
        start: startDate,
        end: endDate,
        cash: cash || 1000000
    };
    return bridge.run_custom_backtest(JSON.stringify(params)).then(function(jsonStr) {
        var res = JSON.parse(jsonStr);
        if (!res.success) {
            window._lastBacktestError = res.error || '未知错误';
            return res;
        }
        // 更新买卖点
        buyPoints.length = 0;
        sellPoints.length = 0;
        (res.signals || []).forEach(function(s) {
            if (s.type === 'buy') {
                buyPoints.push({
                    date: s.date,
                    code: s.code || stockCode,
                    price: s.price,
                    shares: s.shares
                });
            } else {
                sellPoints.push({
                    date: s.date,
                    code: s.code || stockCode,
                    price: s.price,
                    shares: s.shares
                });
            }
        });
        // 存储结果和信号
        window._lastBacktestResult = res;
        window._lastBacktestError = null;
        // 更新全局信号（合并而非替换）
        if (!window.strategySignals) window.strategySignals = [];
        var existing = window.strategySignals;
        (res.signals || []).forEach(function(s) {
            existing.push({
                date: s.date,
                code: s.code || stockCode,
                type: s.type,
                price: s.price,
                shares: s.shares
            });
        });
        // 重绘K线（如果当前有数据）
        if (currentKlineDates.length > 0) {
            var maData = {
                dates: currentKlineDates,
                ma5: calcMA(currentKlineValues, 5),
                ma10: calcMA(currentKlineValues, 10),
                ma20: calcMA(currentKlineValues, 20),
                ma30: calcMA(currentKlineValues, 30)
            };
            // 确保副图管理器有 pending subs（兼容直接调用场景）
            var mgr = window.subChartManager;
            if (mgr && mgr.instances.size === 0) {
                mgr._pendingSubs = [
                    { id: 'kchartSubChart1', type: 'volume' },
                    { id: 'kchartSubChart2', type: 'rsi' }
                ];
                mgr._stockCode = stockCode;
            }
            renderKlineWithSignals(currentKlineDates, currentKlineValues, buyPoints, sellPoints, maData);
        }
        return res;
    }).catch(function(err) {
        window._lastBacktestError = err.message;
        throw err;
    });
}
