import { bridge, log } from './bridge.js';
import { renderKlineWithSignals } from './chartRenderer.js';

export var currentKlineDates = [];
export var currentKlineValues = [];
export var buyPoints = [];
export var sellPoints = [];
export var autoRunBacktest = false;
export var autoBacktestScheduled = false;

export function fetchAndRenderKline(code, startDate, endDate) {
    if (!bridge) {
        var container = document.getElementById('klineMainChart');
        if (container) {
            container.innerHTML = '<div style="color:#aaa; padding:20px;">Bridge 未连接，无法获取数据</div>';
        }
        return;
    }
    log("请求 K线数据: " + code + " 范围 " + startDate + " ~ " + endDate);
    bridge.get_kline_data(code, startDate, endDate).then(function(jsonStr) {
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
                return [data.opens[i], data.closes[i], data.lows[i], data.highs[i]];
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
        currentKlineDates = data.dates;
        currentKlineValues = data.values;
        renderKlineWithSignals(data.dates, data.values, buyPoints, sellPoints, null);
        if (autoBacktestScheduled) {
            autoBacktestScheduled = false;
            runBacktest(code, startDate, endDate);
        }
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
                renderKlineWithSignals(currentKlineDates, currentKlineValues, buyPoints, sellPoints, maData);
            } else {
                fetchAndRenderKline(code, startDate, endDate);
            }
        }
    }).catch(function(err) {
        log("回测请求失败: " + err);
    });
}
