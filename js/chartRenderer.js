// js/chartRenderer.js
import { stockNameMap } from './stockData.js';

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

// ---- 渲染K线及买卖点（含均线）----
export function renderKlineWithSignals(dates, values, buyPts, sellPts, maData, extraLines) {
    console.log("=== renderKlineWithSignals 被调用 ===");
    console.log("dates 数量:", dates ? dates.length : 0);
    console.log("values 数量:", values ? values.length : 0);
    console.log("maData:", maData ? "存在" : "无");

    var dom = document.getElementById('klineMainChart');
    console.log("klineMainChart 容器:", dom);

    if (!dom) {
        console.error('❌ 找不到 klineMainChart 容器');
        return;
    }

    var rect = dom.getBoundingClientRect();
    console.log("容器尺寸:", rect.width, "x", rect.height);
    if (rect.width === 0 || rect.height === 0) {
        console.warn("容器尺寸为 0，可能被隐藏");
        dom.style.height = "460px";
        dom.style.width = "100%";
    }

    if (typeof echarts === 'undefined') {
        console.error('❌ ECharts 未加载');
        return;
    }

    var existingChart = echarts.getInstanceByDom(dom);
    if (existingChart) {
        existingChart.dispose();
        console.log("已销毁旧图表实例");
    }

    var chart = echarts.init(dom);
    console.log("ECharts 实例创建成功");

    var buySeriesData = [];
    var sellSeriesData = [];

    if (buyPts && buyPts.length > 0) {
        for (var i = 0; i < buyPts.length; i++) {
            var pt = buyPts[i];
            var idx = dates.indexOf(pt.date);
            if (idx >= 0 && idx < values.length) {
                var high = values[idx][3];
                var price = high + 0.05;
                buySeriesData.push([idx, price]);
            } else {
                console.warn("买入点日期未找到:", pt.date);
            }
        }
    }
    if (sellPts && sellPts.length > 0) {
        for (var i = 0; i < sellPts.length; i++) {
            var pt = sellPts[i];
            var idx = dates.indexOf(pt.date);
            if (idx >= 0 && idx < values.length) {
                var low = values[idx][2];
                var price = low - 0.05;
                sellSeriesData.push([idx, price]);
            } else {
                console.warn("卖出点日期未找到:", pt.date);
            }
        }
    }

    var series = [
        {
            name: 'K线',
            type: 'candlestick',
            data: values,
            itemStyle: {
                color: '#ef5350',
                color0: '#26a69a',
                borderColor: '#ef5350',
                borderColor0: '#26a69a'
            }
        },
        {
            name: '买入点',
            type: 'scatter',
            data: buySeriesData,
            symbol: 'triangle',
            symbolSize: 14,
            symbolRotate: 0,
            itemStyle: { color: '#ff0000' },
            label: {
                show: true,
                formatter: 'B',
                color: '#ffffff',
                fontSize: 10,
                position: 'top'
            },
            tooltip: { formatter: function(params) { return '买入: ' + dates[params.data[0]]; } }
        },
        {
            name: '卖出点',
            type: 'scatter',
            data: sellSeriesData,
            symbol: 'triangle',
            symbolSize: 14,
            symbolRotate: 180,
            itemStyle: { color: '#00ff00' },
            label: {
                show: true,
                formatter: 'S',
                color: '#ffffff',
                fontSize: 10,
                position: 'bottom'
            },
            tooltip: { formatter: function(params) { return '卖出: ' + dates[params.data[0]]; } }
        }
    ];

    var legendData = ['K线', '买入点', '卖出点'];

    if (maData && maData.ma5 && maData.ma5.length === dates.length) {
        var ma5Name = formatMaLegend(maData.ma5, 'MA5');
        var ma10Name = formatMaLegend(maData.ma10, 'MA10');
        var ma20Name = formatMaLegend(maData.ma20, 'MA20');
        var ma30Name = formatMaLegend(maData.ma30, 'MA30');

        series.push({
            name: ma5Name,
            type: 'line',
            data: maData.ma5,
            lineStyle: { width: 1, color: '#f2c94c' },
            smooth: false,
            showSymbol: false
        });
        legendData.push(ma5Name);

        series.push({
            name: ma10Name,
            type: 'line',
            data: maData.ma10,
            lineStyle: { width: 1, color: '#f2994a' },
            showSymbol: false
        });
        legendData.push(ma10Name);

        series.push({
            name: ma20Name,
            type: 'line',
            data: maData.ma20,
            lineStyle: { width: 1, color: '#eb5757' },
            showSymbol: false
        });
        legendData.push(ma20Name);

        series.push({
            name: ma30Name,
            type: 'line',
            data: maData.ma30,
            lineStyle: { width: 1, color: '#6fcf97' },
            showSymbol: false
        });
        legendData.push(ma30Name);
    }

    if (extraLines && extraLines.length > 0) {
        for (var ei = 0; ei < extraLines.length; ei++) {
            var extra = extraLines[ei];
            series.push({
                name: extra.name,
                type: 'line',
                data: extra.data,
                lineStyle: { width: 1, color: extra.color || '#ffffff' },
                showSymbol: false
            });
            legendData.push(extra.name);
        }
    }

    var option = {
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' }
        },
        xAxis: {
            data: dates,
            type: 'category',
            axisLabel: {
                rotate: 0,
                color: '#ffffff',
                interval: 'auto',
                formatter: function(value, index) {
                    return value.slice(0, 7);
                }
            }
        },
        yAxis: {
            scale: true,
            axisLabel: { color: '#ffffff' },
            name: '价格 (元)'
        },
        series: series,
        legend: {
            data: legendData,
            textStyle: { color: '#ffffff' },
            left: 'left'
        },
        grid: {
            containLabel: true,
            backgroundColor: '#0e1220'
        },
        dataZoom: [
            {
                type: 'inside',
                start: 80,
                end: 100,
                zoomOnMouseWheel: true,
                moveOnMouseMove: true,
                moveOnMouseWheel: false
            }
        ]
    };

    chart.setOption(option);
    console.log("图表设置完成");
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
        console.warn("个股K线容器高度为0，延迟重试 retryCount=" + retryCount);
        setTimeout(function() {
            renderStockKline(containerId, dates, values, retryCount + 1);
        }, 100);
        return;
    }
    if (container.clientHeight === 0) {
        container.style.height = "460px";
        container.style.minHeight = "460px";
    }

    var oldChart = echarts.getInstanceByDom(container);
    if (oldChart) oldChart.dispose();

    // 延迟10ms执行，使UI保持响应
    setTimeout(function() {
        var fixedValues = values.map(function(v) {
            var open = parseFloat(v[0]),
                close = parseFloat(v[1]);
            var low = parseFloat(v[2]),
                high = parseFloat(v[3]);
            low = Math.min(low, open, close);
            high = Math.max(high, open, close);
            return [open, close, low, high];
        });

        function calcMA(vals, period) {
            var ma = [];
            for (var i = 0; i < vals.length; i++) {
                if (i < period - 1) {
                    ma.push(null);
                    continue;
                }
                var sum = 0;
                for (var j = 0; j < period; j++) {
                    sum += vals[i - j][1];
                }
                ma.push(parseFloat((sum / period).toFixed(2)));
            }
            return ma;
        }

        var ma5Data = calcMA(values, 5);
        var ma10Data = calcMA(values, 10);
        var ma20Data = calcMA(values, 20);
        var ma30Data = calcMA(values, 30);

        var series = [
            {
                name: 'K线',
                type: 'candlestick',
                data: fixedValues,
                itemStyle: {
                    color: '#ef5350',
                    color0: '#26a69a',
                    borderColor: '#ef5350',
                    borderColor0: '#26a69a'
                }
            },
            {
                name: 'MA5',
                type: 'line',
                data: ma5Data,
                lineStyle: { width: 1, color: '#f2c94c' },
                smooth: false,
                showSymbol: false
            },
            {
                name: 'MA10',
                type: 'line',
                data: ma10Data,
                lineStyle: { width: 1, color: '#f2994a' },
                showSymbol: false
            },
            {
                name: 'MA20',
                type: 'line',
                data: ma20Data,
                lineStyle: { width: 1, color: '#eb5757' },
                showSymbol: false
            },
            {
                name: 'MA30',
                type: 'line',
                data: ma30Data,
                lineStyle: { width: 1, color: '#6fcf97' },
                showSymbol: false
            }
        ];

        var chart = echarts.init(container);
        var option = {
            backgroundColor: 'transparent',
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            xAxis: {
                type: 'category',
                data: dates,
                axisLabel: {
                    rotate: 0,
                    color: '#ffffff',
                    interval: 'auto',
                    formatter: function(v) { return v.slice(0, 7); }
                }
            },
            yAxis: { scale: true, axisLabel: { color: '#ffffff' }, name: '价格 (元)' },
            series: series,
            legend: {
                data: ['K线', 'MA5', 'MA10', 'MA20', 'MA30'],
                textStyle: { color: '#ffffff' },
                left: 'left'
            },
            grid: { containLabel: true, backgroundColor: '#0e1220' },
            dataZoom: [{
                type: 'inside',
                start: 80,
                end: 100,
                zoomOnMouseWheel: true,
                moveOnMouseMove: true,
                moveOnMouseWheel: false
            }]
        };
        chart.setOption(option, true);
        setTimeout(function() { chart.resize(); }, 100);
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
export function drawEquityCurve(containerId, equityCurve) {
    var dom = document.getElementById(containerId);
    if (!dom) {
        console.error("drawEquityCurve: 容器不存在", containerId);
        return;
    }
    if (typeof echarts === 'undefined') {
        console.error("ECharts 未加载");
        return;
    }

    // 如果数据为空，显示提示
    if (!equityCurve || equityCurve.length === 0) {
        dom.innerHTML = '<div style="color:#9aa9cc; padding:40px; text-align:center;">暂无收益数据</div>';
        return;
    }

    var chart = echarts.init(dom);
    var dates = equityCurve.map(function(item) { return item.date; });
    var values = equityCurve.map(function(item) { return item.value; });

    var option = {
        tooltip: { trigger: 'axis' },
        xAxis: {
            type: 'category',
            data: dates,
            axisLabel: { color: '#9aa9cc' }
        },
        yAxis: {
            type: 'value',
            name: '账户价值 (元)',
            axisLabel: { color: '#9aa9cc' }
        },
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
