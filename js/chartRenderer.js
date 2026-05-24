// js/chartRenderer.js
import { stockNameMap } from './stockData.js';
import * as indicators from './indicators.js';

// ---- 模块级均线缓存 ----
var _stockMACache = null;

// ---- 均线图例格式化辅助函数（去掉箭头，只显示数值）----
function formatMaLegend(maArray, name) {
    var lastVal = null;
    for (var i = maArray.length - 1; i >= 0; i--) {
        var v = maArray[i];
        if (v !== 0 && v !== null && !isNaN(v)) {
            lastVal = v;
            break;
        }
    }
    if (lastVal === null) return name;
    return name + ':' + lastVal.toFixed(2);
}

// ---- 返回美化 HTML ----
export function formatStockDisplayHtml(code) {
    var name = stockNameMap[code] || code;
    var codeStr = code;
    return '<div class="stock-display"><span class="stock-name">' + name + '</span><span class="stock-code">' + codeStr + '</span></div>';
}

// ---- 创建下拉指标选择器（按钮 + 浮层面板）----
function createDropdownControl(chart, fullSeries, rawValues) {
    var container = chart.getDom();
    var containerId = container.id || 'chart';
    var currentPeriod = 60;

    // 移除旧按钮和面板
    var oldBtn = document.getElementById('indicatorBtn_' + containerId);
    if (oldBtn) oldBtn.remove();
    var oldPanel = document.getElementById('indicatorPanel_' + containerId);
    if (oldPanel) oldPanel.remove();

    var items = [
        { name: 'K线', key: 'candle', seriesName: 'K线', default: true },
        { name: 'MA5', key: 'ma5', seriesName: 'MA5', default: true },
        { name: 'MA10', key: 'ma10', seriesName: 'MA10', default: true },
        { name: 'MA20', key: 'ma20', seriesName: 'MA20', default: true },
        { name: 'MA30', key: 'ma30', seriesName: 'MA30', default: true },
        { name: 'SAR', key: 'sar', seriesName: 'SAR', default: false },
        { name: 'VWAP60', key: 'vwap', seriesName: 'VWAP60', default: false },
        { name: '中位数60', key: 'median', seriesName: 'Median60', default: false },
        { name: '算术平均60', key: 'mean', seriesName: 'Mean60', default: false }
    ];

    var alwaysKeep = ['买入点', '卖出点'];

    var controllableNames = [];
    for (var it = 0; it < items.length; it++) {
        controllableNames.push(items[it].seriesName);
    }

    function _applyFilter() {
        if (!chart || chart.isDisposed()) return;

        var visibleNames = [];
        var keyToName = {};
        for (var ki = 0; ki < items.length; ki++) {
            keyToName[items[ki].key] = items[ki].seriesName;
        }
        var panel = document.getElementById('indicatorPanel_' + containerId);
        if (!panel) return;
        var checkboxes = panel.querySelectorAll('input[type="checkbox"]');
        for (var ci = 0; ci < checkboxes.length; ci++) {
            if (checkboxes[ci].checked) {
                var k = checkboxes[ci].getAttribute('data-key');
                if (keyToName[k]) visibleNames.push(keyToName[k]);
            }
        }

        var newSeriesList = fullSeries.filter(function(s) {
            var name = s.name;
            if (alwaysKeep.indexOf(name) !== -1) return true;
            if (controllableNames.indexOf(name) === -1) return true;
            return visibleNames.indexOf(name) !== -1;
        });

        chart.setOption({ series: newSeriesList }, { replaceMerge: ['series'] });
    }

    // 创建按钮
    var btn = document.createElement('button');
    btn.id = 'indicatorBtn_' + containerId;
    btn.textContent = '\u{1F4CA} 指标';
    btn.style.cssText =
        'position:absolute;top:10px;right:10px;z-index:20;' +
        'background:rgba(15,20,35,0.85);backdrop-filter:blur(4px);' +
        'border:1px solid #4f7eff;border-radius:6px;padding:4px 10px;' +
        'color:#fff;cursor:pointer;font-size:12px;font-family:monospace;';
    container.style.position = 'relative';
    container.appendChild(btn);

    // 创建浮层面板（初始隐藏）
    var panelDiv = document.createElement('div');
    panelDiv.id = 'indicatorPanel_' + containerId;
    panelDiv.style.cssText =
        'display:none;position:absolute;top:34px;right:0;' +
        'background:rgba(15,20,35,0.95);backdrop-filter:blur(4px);' +
        'border:1px solid #4f7eff;border-radius:8px;padding:8px 12px;' +
        'z-index:21;grid-template-columns:repeat(2,1fr);gap:4px 14px;' +
        'min-width:210px;box-shadow:0 4px 12px rgba(0,0,0,0.3);' +
        'font-size:12px;font-family:monospace;';

    for (var i = 0; i < items.length; i++) {
        (function(item) {
            var label = document.createElement('label');
            label.style.cssText =
                'display:flex;align-items:center;gap:4px;' +
                'white-space:nowrap;color:#fff;cursor:pointer;font-size:12px;';

            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = item.default;
            cb.style.cssText = 'margin:0;cursor:pointer;';
            cb.setAttribute('data-key', item.key);

            label.appendChild(cb);
            label.appendChild(document.createTextNode(item.name));

            cb.addEventListener('change', function() {
                _applyFilter();
                var tip = document.createElement('div');
                tip.textContent = item.name + (cb.checked ? ' 显示' : ' 隐藏');
                tip.style.cssText =
                    'position:fixed;bottom:20px;left:20px;' +
                    'background:rgba(0,0,0,0.75);color:#fff;' +
                    'padding:4px 12px;border-radius:6px;z-index:99999;font-size:12px;';
                document.body.appendChild(tip);
                setTimeout(function() { tip.remove(); }, 800);
            });

            panelDiv.appendChild(label);
        })(items[i]);
    }

    // ---- 周期选择器 ----
    var periodRow = document.createElement('div');
    periodRow.style.cssText =
        'margin-top:6px;padding-top:6px;border-top:1px solid #323d5a;' +
        'grid-column:1/-1;display:flex;align-items:center;gap:4px;flex-wrap:wrap;';

    var periodLabel = document.createElement('span');
    periodLabel.textContent = '周期：';
    periodLabel.style.cssText = 'color:#9aa9cc;font-size:11px;';
    periodRow.appendChild(periodLabel);

    var periodBtns = [];
    var presetPeriods = [20, 60, 120];
    var activeBtnStyle = 'background:#4f7eff;border-color:#4f7eff;color:#fff;';
    var inactiveBtnStyle = 'background:#1e253b;border:1px solid #323d5a;color:#9aa9cc;';

    for (var pi = 0; pi < presetPeriods.length; pi++) {
        (function(period) {
            var pb = document.createElement('button');
            pb.textContent = period;
            pb.setAttribute('data-period', period);
            pb.style.cssText =
                'border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;' +
                (period === currentPeriod ? activeBtnStyle : inactiveBtnStyle);
            pb.onclick = function() {
                if (currentPeriod === period) return;
                currentPeriod = period;
                customInput.value = '';
                updatePeriod(period);
                updatePeriodBtnStyles();
            };
            periodRow.appendChild(pb);
            periodBtns.push(pb);
        })(presetPeriods[pi]);
    }

    var customInput = document.createElement('input');
    customInput.type = 'number';
    customInput.placeholder = '自定义';
    customInput.min = '5';
    customInput.max = '500';
    customInput.step = '5';
    customInput.style.cssText =
        'width:56px;background:#1e253b;border:1px solid #323d5a;' +
        'border-radius:4px;color:#fff;padding:2px 4px;font-size:11px;';
    customInput.onchange = function() {
        var val = parseInt(customInput.value);
        if (isNaN(val) || val < 5 || val > 500) return;
        if (val === currentPeriod) return;
        currentPeriod = val;
        updatePeriod(val);
        updatePeriodBtnStyles();
    };
    periodRow.appendChild(customInput);

    panelDiv.appendChild(periodRow);

    function updatePeriodBtnStyles() {
        for (var bi = 0; bi < periodBtns.length; bi++) {
            var bp = parseInt(periodBtns[bi].getAttribute('data-period'));
            periodBtns[bi].style.cssText =
                'border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;' +
                (bp === currentPeriod ? activeBtnStyle : inactiveBtnStyle);
        }
    }

    function updatePeriod(period) {
        var closes = rawValues.map(function(v) { return parseFloat(v[1]) || 0; });
        var highs = rawValues.map(function(v) { return parseFloat(v[3]) || 0; });
        var lows = rawValues.map(function(v) { return parseFloat(v[2]) || 0; });
        var volumes = rawValues.map(function(v) { return parseFloat(v[4]) || 0; });

        var meanData = indicators.calculateMean(closes, period);
        var medianData = indicators.calculateMedian(closes, period);
        var vwapData = indicators.calculateVWAP(highs, lows, closes, volumes, period);

        for (var si = 0; si < fullSeries.length; si++) {
            var s = fullSeries[si];
            if (s.name === 'VWAP60') s.data = vwapData;
            else if (s.name === 'Median60') s.data = medianData;
            else if (s.name === 'Mean60') s.data = meanData;
        }

        _applyFilter();
    }

    container.appendChild(panelDiv);

    // 初始过滤（隐藏默认关闭的系列）
    _applyFilter();

    var panelVisible = false;

    btn.onclick = function(e) {
        e.stopPropagation();
        panelVisible = !panelVisible;
        panelDiv.style.display = panelVisible ? 'grid' : 'none';
    };

    // 点击外部关闭浮层
    document.addEventListener('click', function(e) {
        if (panelVisible && !panelDiv.contains(e.target) && e.target !== btn) {
            panelDiv.style.display = 'none';
            panelVisible = false;
        }
    });
}

// ---- 渲染K线及买卖点（含均线）----
export function renderKlineWithSignals(dates, values, buyPts, sellPts, maData, extraLines) {
    console.log("=== renderKlineWithSignals 被调用 ===");
    console.log("dates 数量:", dates ? dates.length : 0);
    console.log("values 数量:", values ? values.length : 0);
    console.log("maData:", maData ? "存在" : "无");

    var dom = document.getElementById('klineMainChart');
    if (!dom) {
        console.error('❌ 找不到 klineMainChart 容器');
        return;
    }

    // 确保容器尺寸
    if (dom.clientWidth === 0 || dom.clientHeight === 0) {
        dom.style.height = "460px";
        dom.style.width = "100%";
    }

    if (typeof echarts === 'undefined') {
        console.error('❌ ECharts 未加载');
        return;
    }

    var chart = echarts.getInstanceByDom(dom);
    if (!chart) {
        chart = echarts.init(dom);
    }

    // 构建买卖点数据
    var buySeriesData = [];
    var sellSeriesData = [];
    var halfSpread = (window._slippageMode === 'half_spread');
    if (buyPts && buyPts.length > 0) {
        for (var i = 0; i < buyPts.length; i++) {
            var pt = buyPts[i];
            var idx = dates.indexOf(pt.date);
            if (idx >= 0 && idx < values.length) {
                var high = values[idx][3];
                var closeP = values[idx][1];
                var price = halfSpread ? (high + closeP) / 2 : high + 0.05;
                buySeriesData.push([idx, price]);
            }
        }
    }
    if (sellPts && sellPts.length > 0) {
        for (var i = 0; i < sellPts.length; i++) {
            var pt = sellPts[i];
            var idx = dates.indexOf(pt.date);
            if (idx >= 0 && idx < values.length) {
                var low = values[idx][2];
                var closeP = values[idx][1];
                var price = halfSpread ? (low + closeP) / 2 : low - 0.05;
                sellSeriesData.push([idx, price]);
            }
        }
    }

    // 主图系列定义（初始全部可见）
    var candleSeries = {
        name: 'K线',
        type: 'candlestick',
        data: values,
        itemStyle: {
            color: '#ef5350',
            color0: '#26a69a',
            borderColor: '#ef5350',
            borderColor0: '#26a69a'
        }
    };
    if (values.length > 1000) {
        candleSeries.progressive = 200;
        candleSeries.progressiveThreshold = 1000;
    }

    var series = [
        candleSeries,
        {
            name: '买入点',
            type: 'scatter',
            data: buySeriesData,
            symbol: 'triangle',
            symbolSize: 14,
            symbolRotate: 0,
            itemStyle: { color: '#ff0000' },
            label: { show: false },
            tooltip: { show: false }
        },
        {
            name: '卖出点',
            type: 'scatter',
            data: sellSeriesData,
            symbol: 'triangle',
            symbolSize: 14,
            symbolRotate: 180,
            itemStyle: { color: '#00ff00' },
            label: { show: false },
            tooltip: { show: false }
        }
    ];

    // 添加均线
    if (maData && maData.ma5 && maData.ma5.length === dates.length) {
        series.push({
            name: 'MA5',
            type: 'line',
            data: maData.ma5,
            lineStyle: { width: 1, color: '#f2c94c' },
            smooth: false,
            showSymbol: false
        });
        series.push({
            name: 'MA10',
            type: 'line',
            data: maData.ma10,
            lineStyle: { width: 1, color: '#f2994a' },
            showSymbol: false
        });
        series.push({
            name: 'MA20',
            type: 'line',
            data: maData.ma20,
            lineStyle: { width: 1, color: '#eb5757' },
            showSymbol: false
        });
        series.push({
            name: 'MA30',
            type: 'line',
            data: maData.ma30,
            lineStyle: { width: 1, color: '#6fcf97' },
            showSymbol: false
        });
    }

    // 添加 SAR（默认不显示，控制面板默认关闭）
    var highsSAR = values.map(v => parseFloat(v[3]) || 0);
    var lowsSAR = values.map(v => parseFloat(v[2]) || 0);
    var sarPoints = indicators.calculateSAR(highsSAR, lowsSAR);
    var sarScatter = [];
    for (var si = 0; si < sarPoints.length; si++) {
        if (sarPoints[si] !== null) {
            sarScatter.push([si, sarPoints[si]]);
        }
    }
    if (sarScatter.length > 0) {
        series.push({
            name: 'SAR',
            type: 'scatter',
            data: sarScatter,
            symbol: 'circle',
            symbolSize: 6,
            itemStyle: { color: '#f2c94c', borderColor: '#f2c94c', borderWidth: 1 },
            label: { show: false },
            tooltip: { show: false }
        });
    }

    // VWAP60 / 中位数60 / 算术平均60
    var closes60 = values.map(function(v) { return parseFloat(v[1]) || 0; });
    var highs60 = values.map(function(v) { return parseFloat(v[3]) || 0; });
    var lows60 = values.map(function(v) { return parseFloat(v[2]) || 0; });
    var volumes60 = values.map(function(v) { return parseFloat(v[4]) || 0; });

    var mean60Data = indicators.calculateMean(closes60, 60);
    var median60Data = indicators.calculateMedian(closes60, 60);
    var vwap60Data = indicators.calculateVWAP(highs60, lows60, closes60, volumes60, 60);

    series.push({
        name: 'VWAP60',
        type: 'line',
        data: vwap60Data,
        lineStyle: { width: 1.5, color: '#ffa500' },
        showSymbol: false
    });
    series.push({
        name: 'Median60',
        type: 'line',
        data: median60Data,
        lineStyle: { width: 1.5, color: '#9b59b6' },
        showSymbol: false
    });
    series.push({
        name: 'Mean60',
        type: 'line',
        data: mean60Data,
        lineStyle: { width: 1.5, color: '#1abc9c' },
        showSymbol: false
    });

    // 保存全系列供控制面板使用（所有系列初始均包含，控制面板负责切换）
    var allSeries = series.slice();

    // 额外线条（如策略线）
    if (extraLines && extraLines.length > 0) {
        for (var ei = 0; ei < extraLines.length; ei++) {
            var extra = extraLines[ei];
            var extraSeries = {
                name: extra.name,
                type: 'line',
                data: extra.data,
                lineStyle: { width: 1, color: extra.color || '#ffffff' },
                showSymbol: false
            };
            series.push(extraSeries);
            allSeries.push(extraSeries);
        }
    }

    var option = {
        backgroundColor: 'transparent',
        animation: false,
        tooltip: {
            trigger: 'axis',
            axisPointer: {
                type: 'cross',
                crossStyle: { color: 'rgba(255,255,255,0.2)' },
                lineStyle: { color: 'rgba(255,255,255,0.3)', width: 1, type: 'dashed' },
                label: {
                    backgroundColor: '#4f7eff',
                    color: '#ffffff',
                    position: 'bottom',
                    formatter: function(params) {
                        if (params && params.value) return params.value;
                        return '';
                    }
                }
            }
        },
        xAxis: {
            data: dates,
            type: 'category',
            axisLabel: {
                rotate: 0,
                color: '#ffffff',
                interval: 'auto',
                formatter: function(value) { return value.slice(0, 7); }
            }
        },
        yAxis: {
            scale: true,
            axisLabel: { color: '#ffffff' },
            name: '价格 (元)',
            splitLine: {
                show: true,
                lineStyle: {
                    color: '#3a4055',
                    width: 1,
                    type: 'dashed'
                }
            }
        },
        series: series,
        legend: { show: false }, // 隐藏默认图例
        grid: {
            containLabel: true,
            backgroundColor: '#0e1220',
            left: '8%',
            right: '8%',
            top: 20,
            bottom: 8
        },
        dataZoom: [
            {
                type: 'inside',
                start: (function() {
                    var total = dates.length;
                    var defaultCount = 220;
                    if (total > defaultCount) return (total - defaultCount) / total * 100;
                    return 0;
                })(),
                end: 100,
                zoomOnMouseWheel: true,
                moveOnMouseMove: true,
                moveOnMouseWheel: false
            }
        ]
    };

    chart.setOption(option);
    console.log("图表设置完成");

    // 创建下拉指标选择器（买卖点成交图页）
    createDropdownControl(chart, allSeries, values);

    // 通知副图管理器
    setTimeout(function() {
        if (window.subChartManager) {
            window.subChartManager.onMainChartReady('klineMainChart', chart, dates, values);
        }
    }, 50);

    // 浮动信号卡片
    var signalCard = document.getElementById('signalInfoCard');
    if (!signalCard) {
        signalCard = document.createElement('div');
        signalCard.id = 'signalInfoCard';
        dom.style.position = 'relative';
        signalCard.style.cssText = 'display:none; position:absolute; bottom:220px; right:10px; background:rgba(15,18,32,0.85); border:1px solid #4f7eff; border-radius:6px; padding:4px 12px; color:#ffffff; font-family:monospace; font-size:12px; z-index:10; pointer-events:none; line-height:1.6; max-width:260px;';
        dom.parentElement.style.position = 'relative';
        dom.appendChild(signalCard);
    }

    chart.on('mousemove', function(params) {
        if (!params || params.dataIndex === undefined) {
            signalCard.style.display = 'none';
            return;
        }
        var date = dates[params.dataIndex];
        if (!date) return;
        var buyHere = buyPts ? buyPts.filter(function(b) { return b.date === date; }) : [];
        var sellHere = sellPts ? sellPts.filter(function(s) { return s.date === date; }) : [];
        if (buyHere.length === 0 && sellHere.length === 0) {
            signalCard.style.display = 'none';
            return;
        }
        var lines = [];
        buyHere.forEach(function(b) {
            var lot = Math.floor((b.shares || 0) / 100) || '零股';
            lines.push('<span style="color:#ff4d4f;">B ' + (b.price != null ? b.price.toFixed(2) : '--') + ' ' + lot + '手</span>');
            if (b.reason) lines.push('<span style="font-size:10px;color:#ccc;">' + b.reason + '</span>');
        });
        sellHere.forEach(function(s) {
            var lot = Math.floor((s.shares || 0) / 100) || '零股';
            lines.push('<span style="color:#52c41a;">S ' + (s.price != null ? s.price.toFixed(2) : '--') + ' ' + lot + '手</span>');
            if (s.reason) lines.push('<span style="font-size:10px;color:#ccc;">' + s.reason + '</span>');
        });
        signalCard.innerHTML = lines.join('<br>');
        signalCard.style.display = '';
    });
    chart.on('mouseout', function() { signalCard.style.display = 'none'; });

    if (!window._klineResizeBound) {
        window._klineResizeBound = true;
        window.addEventListener('resize', function() {
            if (chart && !chart.isDisposed()) chart.resize();
        });
    }
}

// ---- 个股详情页K线渲染（含均线）----
export function renderStockKline(containerId, dates, values, retryCount) {
    if (retryCount === undefined) retryCount = 0;
    var container = document.getElementById(containerId);
    if (!container) {
        console.error("❌ 个股K线容器不存在:", containerId);
        return;
    }
    if (container.clientHeight === 0 && retryCount < 5) {
        setTimeout(() => renderStockKline(containerId, dates, values, retryCount + 1), 100);
        return;
    }
    if (container.clientHeight === 0) {
        container.style.height = "460px";
        container.style.minHeight = "460px";
    }

    setTimeout(() => {
        var fixedValues = values.map(v => {
            var open = parseFloat(v[0]), close = parseFloat(v[1]), low = parseFloat(v[2]), high = parseFloat(v[3]);
            low = Math.min(low, open, close);
            high = Math.max(high, open, close);
            return [open, close, low, high];
        });

        function calcMA(vals, period) {
            var ma = [];
            for (var i = 0; i < vals.length; i++) {
                if (i < period - 1) { ma.push(null); continue; }
                var sum = 0;
                for (var j = 0; j < period; j++) sum += vals[i - j][1];
                ma.push(parseFloat((sum / period).toFixed(2)));
            }
            return ma;
        }

        var ma5Data, ma10Data, ma20Data, ma30Data;
        if (_stockMACache && _stockMACache.datesRef === dates) {
            ma5Data = _stockMACache.ma5;
            ma10Data = _stockMACache.ma10;
            ma20Data = _stockMACache.ma20;
            ma30Data = _stockMACache.ma30;
        } else {
            ma5Data = calcMA(values, 5);
            ma10Data = calcMA(values, 10);
            ma20Data = calcMA(values, 20);
            ma30Data = calcMA(values, 30);
            _stockMACache = { datesRef: dates, ma5: ma5Data, ma10: ma10Data, ma20: ma20Data, ma30: ma30Data };
        }

        var candleSeries = {
            name: 'K线',
            type: 'candlestick',
            data: fixedValues,
            itemStyle: {
                color: '#ef5350',
                color0: '#26a69a',
                borderColor: '#ef5350',
                borderColor0: '#26a69a'
            }
        };
        if (values.length > 1000) {
            candleSeries.progressive = 200;
            candleSeries.progressiveThreshold = 1000;
        }

        var series = [
            candleSeries,
            { name: 'MA5', type: 'line', data: ma5Data, lineStyle: { width: 1, color: '#f2c94c' }, showSymbol: false },
            { name: 'MA10', type: 'line', data: ma10Data, lineStyle: { width: 1, color: '#f2994a' }, showSymbol: false },
            { name: 'MA20', type: 'line', data: ma20Data, lineStyle: { width: 1, color: '#eb5757' }, showSymbol: false },
            { name: 'MA30', type: 'line', data: ma30Data, lineStyle: { width: 1, color: '#6fcf97' }, showSymbol: false }
        ];

        // SAR
        var highsSAR = values.map(v => parseFloat(v[3]) || 0);
        var lowsSAR = values.map(v => parseFloat(v[2]) || 0);
        var sarPoints = indicators.calculateSAR(highsSAR, lowsSAR);
        var sarScatter = [];
        for (var si = 0; si < sarPoints.length; si++) {
            if (sarPoints[si] !== null) sarScatter.push([si, sarPoints[si]]);
        }
        if (sarScatter.length > 0) {
            series.push({
                name: 'SAR',
                type: 'scatter',
                data: sarScatter,
                symbol: 'circle',
                symbolSize: 6,
                itemStyle: { color: '#f2c94c', borderColor: '#f2c94c', borderWidth: 1 },
                label: { show: false },
                tooltip: { show: false }
            });
        }

        // VWAP60 / 中位数60 / 算术平均60
        var closes60 = values.map(function(v) { return parseFloat(v[1]) || 0; });
        var highs60 = values.map(function(v) { return parseFloat(v[3]) || 0; });
        var lows60 = values.map(function(v) { return parseFloat(v[2]) || 0; });
        var volumes60 = values.map(function(v) { return parseFloat(v[4]) || 0; });

        var mean60Data = indicators.calculateMean(closes60, 60);
        var median60Data = indicators.calculateMedian(closes60, 60);
        var vwap60Data = indicators.calculateVWAP(highs60, lows60, closes60, volumes60, 60);

        series.push({
            name: 'VWAP60',
            type: 'line',
            data: vwap60Data,
            lineStyle: { width: 1.5, color: '#ffa500' },
            showSymbol: false
        });
        series.push({
            name: 'Median60',
            type: 'line',
            data: median60Data,
            lineStyle: { width: 1.5, color: '#9b59b6' },
            showSymbol: false
        });
        series.push({
            name: 'Mean60',
            type: 'line',
            data: mean60Data,
            lineStyle: { width: 1.5, color: '#1abc9c' },
            showSymbol: false
        });

        var allSeries = series.slice();

        var chart = echarts.getInstanceByDom(container);
        if (!chart) chart = echarts.init(container);

        var option = {
            backgroundColor: 'transparent',
            animation: false,
            tooltip: {
                trigger: 'axis',
                axisPointer: {
                    type: 'cross',
                    crossStyle: { color: 'rgba(255,255,255,0.2)' },
                    lineStyle: { color: 'rgba(255,255,255,0.3)', width: 1, type: 'dashed' },
                    label: {
                        backgroundColor: '#4f7eff',
                        color: '#ffffff',
                        formatter: (params) => params && params.value ? params.value : ''
                    }
                }
            },
            xAxis: {
                type: 'category',
                data: dates,
                axisLabel: { rotate: 0, color: '#ffffff', interval: 'auto', formatter: v => v.slice(0, 7) }
            },
            yAxis: {
                scale: true,
                axisLabel: { color: '#ffffff' },
                name: '价格 (元)',
                splitLine: {
                    show: true,
                    lineStyle: { color: '#3a4055', width: 1, type: 'dashed' }
                }
            },
            series: series,
            legend: { show: false },
            grid: { containLabel: true, backgroundColor: '#0e1220', left: '8%', right: '8%', top: 15, bottom: 8 },
            dataZoom: [{
                type: 'inside',
                start: (function() {
                    var total = dates.length;
                    var defaultCount = 220;
                    return total > defaultCount ? (total - defaultCount) / total * 100 : 0;
                })(),
                end: 100,
                zoomOnMouseWheel: true,
                moveOnMouseMove: true,
                moveOnMouseWheel: false
            }]
        };
        chart.setOption(option, true);

        // 创建下拉指标选择器（个股详情页）
        createDropdownControl(chart, allSeries, values);

        setTimeout(function() {
            if (window.subChartManager) {
                window.subChartManager.onMainChartReady(containerId, chart, dates, values);
            }
        }, 50);

        setTimeout(() => chart.resize(), 100);

        if (!window._stockKlineResizeBound) {
            window._stockKlineResizeBound = true;
            window.addEventListener('resize', () => { if (chart && !chart.isDisposed()) chart.resize(); });
        }
    }, 10);
}

// ---- 策略详情页曲线图（静态）----
export function drawDetailCurve() {
    var dom = document.getElementById('detailCurveContainer');
    if (dom && typeof echarts !== 'undefined') {
        var chart = echarts.init(dom);
        chart.setOption({
            tooltip: { trigger: 'axis' },
            xAxis: { data: ['1月', '2月', '3月'], axisLabel: { color: '#ffffff' } },
            yAxis: { name: '收益率%', axisLabel: { color: '#ffffff' } },
            series: [{
                type: 'line',
                data: [0, 12.3, 23.5],
                name: '策略收益曲线',
                lineStyle: { color: '#4f7eff' }
            }]
        });
    }
}

// ---- 收益曲线（动态数据）----
export function drawEquityCurve(containerId, equityCurve, retry) {
    if (retry === undefined) retry = 0;
    var dom = document.getElementById(containerId);
    if (!dom) {
        console.error("drawEquityCurve: 容器不存在", containerId);
        return;
    }
    if (dom.clientHeight === 0) {
        if (retry < 5) {
            setTimeout(() => drawEquityCurve(containerId, equityCurve, retry + 1), 200);
        } else {
            dom.innerHTML = '<div style="color:#9aa9cc; padding:40px; text-align:center;">图表加载失败</div>';
        }
        return;
    }
    if (typeof echarts === 'undefined') {
        console.error("ECharts 未加载");
        return;
    }
    if (!equityCurve || equityCurve.length === 0) {
        dom.innerHTML = '<div style="color:#9aa9cc; padding:40px; text-align:center;">暂无收益数据</div>';
        return;
    }
    var chart = echarts.init(dom);
    var dates = equityCurve.map(item => item.date);
    var values = equityCurve.map(item => item.value);
    var option = {
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'category', data: dates, axisLabel: { color: '#9aa9cc' } },
        yAxis: { type: 'value', name: '账户价值 (元)', axisLabel: { color: '#9aa9cc' } },
        series: [{
            type: 'line',
            data: values,
            smooth: true,
            lineStyle: { color: '#4f7eff' },
            areaStyle: {
                color: {
                    type: 'linear',
                    x: 0, y: 0, x2: 0, y2: 1,
                    colorStops: [
                        { offset: 0, color: 'rgba(79,126,255,0.5)' },
                        { offset: 1, color: 'rgba(79,126,255,0.05)' }
                    ]
                }
            }
        }],
        grid: { containLabel: true, backgroundColor: '#0e1220' }
    };
    chart.setOption(option);
}