// js/subChartRenderer.js
// 独立副图渲染模块 — 成交量柱状图（独立容器，类似同花顺布局）

var _volumeChart = null;
var _syncing = 0;

// 存储所有副图实例，供主图调用轴指针同步
if (!window._volumeChartInstances) window._volumeChartInstances = {};

function buildVolumeData(values) {
    if (!values || values.length === 0) return null;
    var sample = values[0];
    if (!sample || sample.length < 5) return null;

    var hasValid = false;
    var volData = [];
    for (var i = 0; i < values.length; i++) {
        var v = values[i];
        var open = Number(v[0]);
        var close = Number(v[1]);
        var high = Number(v[3]);
        var vol = Number(v[4]);
        if (isNaN(open)) open = 0;
        if (isNaN(close)) close = 0;
        if (isNaN(high)) high = 0;
        if (isNaN(vol)) vol = 0;
        else if (vol > 0) hasValid = true;
        // 兜底：如果 close 和 open 相等，参考 high 判断（高开低走=跌，低开高走=涨）
        var isUp;
        if (close === open) {
            isUp = high >= close;  // 极端相等时默认红色
        } else {
            isUp = close >= open;
        }
        volData.push({
            value: vol,
            itemStyle: {
                color: isUp ? '#ef5350' : '#26a69a'
            }
        });
    }
    return hasValid ? volData : null;
}

function calculateVolumeMA(volumes, period) {
    var ma = [];
    for (var i = 0; i < volumes.length; i++) {
        if (i < period - 1) {
            ma.push(null);
        } else {
            var sum = 0;
            for (var j = 0; j < period; j++) {
                sum += volumes[i - j];
            }
            ma.push(parseFloat((sum / period).toFixed(0)));
        }
    }
    return ma;
}

export function renderVolumeSubChart(containerId, dates, values, mainChart) {
    if (typeof echarts === 'undefined') return;

    var container = document.getElementById(containerId);
    if (!container) return;

    var volData = buildVolumeData(values);
    if (!volData) {
        container.style.display = 'none';
        return;
    }

    // 计算成交量均线
    var volumes = values.map(function(v) { return parseFloat(v[4]) || 0; });
    var ma5Data = calculateVolumeMA(volumes, 5);
    var ma10Data = calculateVolumeMA(volumes, 10);

    container.style.display = '';

    if (_volumeChart) {
        _volumeChart.dispose();
        _volumeChart = null;
    }
    _syncing = 0;

    _volumeChart = echarts.init(container);
    
    // 存储实例
    window._volumeChartInstances[containerId] = _volumeChart;

    var option = {
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' }
        },
        xAxis: {
            type: 'category',
            data: dates,
            axisLabel: { show: false },
            axisTick: { show: false },
            axisLine: { lineStyle: { color: '#2a314a' } },
            splitLine: { show: false }
        },
        yAxis: {
            type: 'value',
            axisLabel: {
                color: '#9aa9cc',
                fontSize: 10,
                formatter: function(v) {
                    if (v >= 100000000) return (v / 100000000).toFixed(1) + '亿';
                    if (v >= 10000) return (v / 10000).toFixed(0) + '万';
                    return v;
                }
            },
            splitLine: { show: false },
            name: 'VOL',
            nameTextStyle: { color: '#9aa9cc', fontSize: 10 }
        },
        legend: {
            data: ['成交量', 'VOLMA5', 'VOLMA10'],
            textStyle: { color: '#ffffff' },
            type: 'scroll',
            orient: 'horizontal',
            left: 'left',
            top: 0,
            itemWidth: 70,
            itemHeight: 20,
            pageIconColor: '#4f7eff',
            pageTextStyle: { color: '#ffffff' }
        },
        series: [{
            name: '成交量',
            type: 'bar',
            data: volData,
            barWidth: '60%'
        }, {
            name: 'VOLMA5',
            type: 'line',
            data: ma5Data,
            lineStyle: { width: 1, color: '#f2c94c' },
            smooth: false,
            showSymbol: false,
            yAxisIndex: 0
        }, {
            name: 'VOLMA10',
            type: 'line',
            data: ma10Data,
            lineStyle: { width: 1, color: '#bb86fc' },
            smooth: false,
            showSymbol: false,
            yAxisIndex: 0
        }],
        grid: {
            containLabel: true,
            left: '10%',
            right: '8%',
            top: 24,
            bottom: 10,
            backgroundColor: '#0e1220'
        },
        dataZoom: [{
            type: 'inside',
            start: 80,
            end: 100,
            zoomOnMouseWheel: false,
            moveOnMouseMove: false,
            moveOnMouseWheel: false
        }]
    };

    _volumeChart.setOption(option);

    if (mainChart) {
        var mainOpt = mainChart.getOption();
        var dzParams = {};
        if (mainOpt && mainOpt.dataZoom && mainOpt.dataZoom.length > 0) {
            dzParams.start = mainOpt.dataZoom[0].start;
            dzParams.end = mainOpt.dataZoom[0].end;
        } else {
            dzParams.start = 80;
            dzParams.end = 100;
        }
        _volumeChart.dispatchAction({
            type: 'dataZoom',
            start: dzParams.start,
            end: dzParams.end
        });

        mainChart.off('datazoom');
        mainChart.on('datazoom', function(params) {
            if (_syncing || !_volumeChart) return;
            _syncing = 1;
            _volumeChart.dispatchAction({
                type: 'dataZoom',
                start: params.start != null ? params.start : (params.batch ? params.batch[0].start : 80),
                end: params.end != null ? params.end : (params.batch ? params.batch[0].end : 100)
            });
            _syncing = 0;
        });

        _volumeChart.off('datazoom');
        _volumeChart.on('datazoom', function(params) {
            if (_syncing) return;
            _syncing = 1;
            mainChart.dispatchAction({
                type: 'dataZoom',
                start: params.start != null ? params.start : (params.batch ? params.batch[0].start : 80),
                end: params.end != null ? params.end : (params.batch ? params.batch[0].end : 100)
            });
            _syncing = 0;
        });
    }
}

export function destroyVolumeSubChart() {
    if (_volumeChart) {
        _volumeChart.dispose();
        _volumeChart = null;
    }
    window._volumeChartInstances = {};
    _syncing = 0;
}