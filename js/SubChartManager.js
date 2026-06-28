// js/SubChartManager.js
// 多副图管理器 — 支持注册/注销、指标切换、折叠/展开、dataZoom联动、十字光标同步
import * as indicators from './indicators.js';

const STORAGE_KEY = 'tquant_subchart_collapse';
const MIN_DATA_COUNT = 30; // 最少K线数量才能计算指标

export class SubChartManager {
    constructor() {
        this.instances = new Map();       // containerId -> { chart, type, mainChart, options, _dataZoomBound }
        this.cache = new Map();           // cacheKey -> indicatorResult
        this._collapseState = this._loadCollapseState();
        this._debugReady = false;
    }

    // ─── 调试面板 ───
    _initDebugPanel() {
        if (this._debugReady) return;
        if (!window.TQUANT_DEBUG) return;
        this._debugReady = true;

        const panel = document.createElement('div');
        panel.id = 'tquant-debug-panel';
        panel.style.cssText =
            'position:fixed;bottom:8px;right:8px;z-index:99999;' +
            'background:rgba(0,0,0,0.85);color:#4cff4c;font:11px/1.5 "Consolas",monospace;' +
            'max-height:260px;max-width:520px;overflow-y:auto;' +
            'padding:10px 12px;border-radius:8px;border:1px solid #4f7eff;' +
            'white-space:pre-wrap;word-break:break-all;';
        panel.title = '双击清空 | 拖拽移动';
        panel.ondblclick = () => { panel.textContent = ''; };

        // 简易拖拽
        let dragging = false, ox = 0, oy = 0;
        panel.addEventListener('mousedown', (e) => {
            if (e.target === panel) { dragging = true; ox = e.clientX - panel.offsetLeft; oy = e.clientY - panel.offsetTop; }
        });
        document.addEventListener('mousemove', (e) => {
            if (dragging) { panel.style.left = (e.clientX - ox) + 'px'; panel.style.right = 'auto'; panel.style.bottom = 'auto'; panel.style.top = (e.clientY - oy) + 'px'; }
        });
        document.addEventListener('mouseup', () => { dragging = false; });

        document.body.appendChild(panel);
        this._showDebugInfo('调试面板已启动');
    }

    _showDebugInfo(msg, isError) {
        if (!window.TQUANT_DEBUG) return;
        this._initDebugPanel();
        const panel = document.getElementById('tquant-debug-panel');
        if (!panel) return;
        const now = new Date();
        const ts = now.toTimeString().slice(0, 8);
        const line = document.createElement('div');
        line.style.cssText = 'margin-bottom:2px;' + (isError ? 'color:#ff6b6b;' : '');
        line.textContent = '[' + ts + '] ' + msg;
        panel.appendChild(line);
        panel.scrollTop = panel.scrollHeight;
    }

    // ─── 缓存 ───
    _cacheKey(stockCode, type, dataLength) {
        return `${stockCode}_${type}_${dataLength}`;
    }

    // ─── localStorage 折叠状态 ───
    _loadCollapseState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (_) {
            return {};
        }
    }

    _saveCollapseState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this._collapseState));
        } catch (_) { /* ignore */ }
    }

    // ─── 公共方法 ───

    /**
     * 初始化一个副图（首次调用或主图重新渲染后调用）
     * @param {string} containerId  - 图表 DOM 容器 id
     * @param {object} mainChart    - 主图 ECharts 实例
     * @param {string} type         - 初始指标类型 'volume'|'macd'|'rsi'|'kdj'
     * @param {Array}  klineData    - K线数据 [[open,close,low,high,volume], ...]
     * @param {Array}  dates        - 日期字符串数组
     * @param {object} opts         - { stockCode, period }
     */
    init(containerId, mainChart, type, klineData, dates, opts = {}) {
        console.log('[SubChartManager] init', {
            containerId,
            type,
            klineDataLen: klineData ? klineData.length : 0,
            klineDataSample: klineData ? klineData.slice(0, 1) : null,
            datesLen: dates ? dates.length : 0,
            datesSample: dates ? dates.slice(0, 2) : null
        });

        if (typeof echarts === 'undefined') { console.warn('[SubChartManager] echarts undefined'); return; }
        const container = document.getElementById(containerId);
        if (!container) { console.warn('[SubChartManager] container not found:', containerId); return; }

        // dispose 已有实例
        this.destroy(containerId);

        const chart = echarts.init(container);
        const entry = {
            chart,
            type,
            mainChart,
            options: { ...opts, klineData, dates },
            _dataZoomBound: false
        };
        this.instances.set(containerId, entry);

        // 数据不足时显示提示
        if (!klineData || klineData.length < MIN_DATA_COUNT) {
            this._showInsufficientData(chart);
        } else {
            this._renderIndicator(containerId, type, klineData, dates);
        }

        // 绑定信号点击事件
        chart.off('click');
        chart.on('click', (params) => this._onSignalClick(params, entry));

        // 恢复折叠状态
        const wrapper = container.closest('.subchart-wrapper');
        if (wrapper && this._collapseState[containerId]) {
            this._applyCollapse(wrapper, container, true, false);
        }

        this._connectCharts();
    }

    /**
     * 更新数据（切换股票/周期时调用）
     */
    updateData(containerId, klineData, dates, mainChart, stockCode) {
        const entry = this.instances.get(containerId);
        if (!entry) return;

        // 新数据到达时清空指标缓存
        this.cache.clear();

        if (mainChart) {
            entry.mainChart = mainChart;
            if (!entry._dataZoomBound) {
                this._bindDataZoom(containerId);
            }
        }
        if (stockCode !== undefined) entry.options.stockCode = stockCode;
        entry.options.klineData = klineData;
        entry.options.dates = dates;

        if (!klineData || klineData.length < MIN_DATA_COUNT) {
            this._showInsufficientData(entry.chart);
        } else {
            this._renderIndicator(containerId, entry.type, klineData, dates);
        }

        this._connectCharts();
    }

    /**
     * 切换指标类型
     */
    switchType(containerId, newType) {
        const entry = this.instances.get(containerId);
        if (!entry) return;
        entry.type = newType;

        const klineData = entry.options.klineData;
        const dates = entry.options.dates;
        if (klineData && dates) {
            if (klineData.length < MIN_DATA_COUNT) {
                this._showInsufficientData(entry.chart);
            } else {
                this._renderIndicator(containerId, newType, klineData, dates);
            }
        }
    }

    /**
     * 切换折叠/展开
     */
    toggleCollapse(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const wrapper = container.closest('.subchart-wrapper');
        if (!wrapper) return;

        const collapsed = !wrapper.classList.contains('collapsed');
        this._applyCollapse(wrapper, container, collapsed, true);
    }

    /**
     * 主图渲染完成后的回调，由 chartRenderer 调用
     */
    onMainChartReady(mainChartContainerId, mainChart, dates, values) {
        console.log('[SubChartManager] onMainChartReady called', {
            mainChartContainerId,
            datesLen: dates ? dates.length : 0,
            valuesLen: values ? values.length : 0,
            valuesSample: values ? values.slice(0, 2) : null,
            pendingSubs: this._pendingSubs ? this._pendingSubs.length : 0,
            existingInstances: this.instances.size
        });

        // 新数据到达时清空指标缓存，避免返回过期结果
        this.cache.clear();

        // 处理预注册的副图（navigation.js 设置的 _pendingSubs）
        if (this._pendingSubs && this._pendingSubs.length > 0) {
            this._pendingSubs.forEach(sub => {
                this.init(sub.id, mainChart, sub.type, values, dates, { stockCode: this._stockCode || '' });
            });
            this._pendingSubs = null;
        }

        // 更新已有副图实例（使用传入的 values/dates）
        for (const [id, entry] of this.instances) {
            entry.mainChart = mainChart;
            if (!entry._dataZoomBound) {
                this._bindDataZoom(id);
            }
            // 更新存储的数据
            if (values && dates) {
                entry.options.klineData = values;
                entry.options.dates = dates;
            }
            const kd = entry.options.klineData;
            const ds = entry.options.dates;
            if (kd && ds) {
                if (kd.length < MIN_DATA_COUNT) {
                    this._showInsufficientData(entry.chart);
                } else {
                    this._renderIndicator(id, entry.type, kd, ds);
                }
            }
        }
        this._connectCharts();
    }

    /**
     * 销毁单个副图实例
     */
    destroy(containerId) {
        const entry = this.instances.get(containerId);
        if (entry) {
            if (entry.chart && !entry.chart.isDisposed()) {
                entry.chart.dispose();
            }
            this.instances.delete(containerId);
        }
    }

    /**
     * 销毁所有副图实例
     */
    destroyAll() {
        for (const [id] of this.instances) {
            this.destroy(id);
        }
        this.instances.clear();
    }

    // ─── 内部方法 ───

    _applyCollapse(wrapper, container, collapse, save) {
        if (collapse) {
            wrapper.classList.add('collapsed');
            // 更新折叠按钮文字
            const btn = wrapper.querySelector('.collapse-btn');
            if (btn) btn.textContent = '▼ 展开';
        } else {
            wrapper.classList.remove('collapsed');
            const btn = wrapper.querySelector('.collapse-btn');
            if (btn) btn.textContent = '▲ 折叠';
        }

        this._collapseState[container.id] = collapse;
        if (save) this._saveCollapseState();

        setTimeout(() => this.resizeAll(), 150);
    }

    resizeAll() {
        for (const [, entry] of this.instances) {
            if (entry.chart && !entry.chart.isDisposed()) entry.chart.resize();
            if (entry.mainChart && !entry.mainChart.isDisposed()) entry.mainChart.resize();
        }
    }

    _showInsufficientData(chart) {
        if (!chart || chart.isDisposed()) return;
        chart.setOption({
            title: {
                text: '数据不足（需≥' + MIN_DATA_COUNT + '根K线）',
                left: 'center',
                top: 'center',
                textStyle: { color: '#9aa9cc', fontSize: 13 }
            }
        }, true);
    }

    // ─── 信号点击 → 主图高亮 ───
    _onSignalClick(params, entry) {
        if (!params || params.componentType !== 'series') return;
        const signalSeriesNames = ['买入信号', '卖出信号', '短底信号', '金手指', '七脉神剑'];
        if (!signalSeriesNames.includes(params.seriesName)) return;
        if (!params.data || !params.data.date) return;

        const date = params.data.date;
        const signalType = params.data.signalType || params.seriesName;
        const colorMap = { buy: '#4caf50', sell: '#ef5350', shortBottom: '#2196f3', goldenFinger: '#ffd700', sevenSwords: '#ffd700' };
        const color = colorMap[signalType] || '#4f7eff';

        if (typeof window.highlightKlineByDate === 'function') {
            window.highlightKlineByDate(date, color);
        }
    }

    // ─── dataZoom 联动（主图 → 副图单向同步）───
    _bindDataZoom(containerId) {
        const entry = this.instances.get(containerId);
        if (!entry || !entry.mainChart || entry._dataZoomBound) return;
        entry._dataZoomBound = true;

        entry.mainChart.on('datazoom', (params) => {
            const e = this.instances.get(containerId);
            if (!e || !e.chart || e.chart.isDisposed()) return;
            if (e._syncing) return;
            e._syncing = true;
            e.chart.dispatchAction({
                type: 'dataZoom',
                start: params.start != null ? params.start : (params.batch ? params.batch[0].start : 0),
                end: params.end != null ? params.end : (params.batch ? params.batch[0].end : 100)
            });
            e._syncing = false;
        });
    }

    // ─── 十字光标同步（echarts.connect 统一管理）───
    _connectCharts() {
        const allCharts = [];
        const seen = new Set();
        for (const [, entry] of this.instances) {
            if (entry.chart && !entry.chart.isDisposed() && !seen.has(entry.chart)) {
                allCharts.push(entry.chart);
                seen.add(entry.chart);
            }
            if (entry.mainChart && !entry.mainChart.isDisposed() && !seen.has(entry.mainChart)) {
                allCharts.push(entry.mainChart);
                seen.add(entry.mainChart);
            }
        }
        if (allCharts.length >= 2) {
            echarts.connect(allCharts);
        }
    }

    // ─── 指标计算与渲染 ───

    _renderIndicator(containerId, type, klineData, dates) {
        console.log('[SubChartManager] _renderIndicator', {
            containerId,
            type,
            klineDataLen: klineData ? klineData.length : 0,
            datesLen: dates ? dates.length : 0
        });

        const entry = this.instances.get(containerId);
        if (!entry) { console.warn('[SubChartManager] _renderIndicator: no entry for', containerId); return; }
        if (!entry.chart || entry.chart.isDisposed()) { console.warn('[SubChartManager] _renderIndicator: chart disposed for', containerId); return; }

        const indicatorResult = this._computeIndicator(type, klineData, dates, entry.options.stockCode, entry.options);
        console.log('[SubChartManager] indicatorResult', {
            type: indicatorResult ? indicatorResult.type : null,
            hasDates: indicatorResult ? !!indicatorResult.dates : false,
            resultDatesLen: indicatorResult ? (indicatorResult.dates ? indicatorResult.dates.length : 0) : 0
        });
        if (!indicatorResult) return;

        const chartDates = indicatorResult.dates || dates;
        const option = this._buildOption(indicatorResult, type, chartDates, klineData);
        console.log('[SubChartManager] built option', {
            type,
            hasOption: !!option,
            seriesCount: option ? option.series.length : 0,
            xAxisDatesLen: option && option.xAxis ? option.xAxis.data.length : 0,
            series0DataLen: option && option.series[0] ? option.series[0].data.length : 0
        });
        if (option) {
            // 输出 series 数据长度
            const seriesInfo = option.series.map((s, i) =>
                s.name + '[' + i + ']:' + (s.data ? s.data.length : 0)
            ).join(' ');
            this._showDebugInfo(
                '[' + type + '] ECharts option: series=' + option.series.length +
                ' xAxis.data=' + (option.xAxis && option.xAxis.data ? option.xAxis.data.length : 0) +
                ' | ' + seriesInfo
            );
            // MACD 柱状图非空统计
            if (type === 'macd' && option.series[2] && option.series[2].data) {
                const barData = option.series[2].data;
                const nonNull = barData.filter(v => v !== null).length;
                const nullCount = barData.length - nonNull;
                this._showDebugInfo(
                    '[macd] 柱状图 series[2]: 总数=' + barData.length +
                    ' 有效=' + nonNull + ' null=' + nullCount,
                    nullCount > barData.length * 0.5
                );
            }
            entry.chart.setOption(option, true);
            console.log('[SubChartManager] setOption done for', containerId);
            this._updateValuesRow(containerId, type, indicatorResult);
            this._updateResonanceGear(containerId, type);
        }
    }

    _updateResonanceGear(containerId, type) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const wrapper = container.closest('.subchart-wrapper');
        if (!wrapper) return;
        const toolbar = wrapper.querySelector('.subchart-toolbar');
        if (!toolbar) return;

        // 移除旧的齿轮按钮
        const oldGear = toolbar.querySelector('.seven-swords-config-btn');
        if (oldGear) oldGear.remove();

        // 七脉神剑 显示信息按钮（只读，不可配置参数）
        if (type === 'seven_swords') {
            const gearBtn = document.createElement('button');
            gearBtn.className = 'seven-swords-config-btn';
            gearBtn.textContent = '⚔';
            gearBtn.title = '七脉神剑 — 量能/CCI/MACD/SAR/RSI/KDJ/CJDX 多空方向';
            gearBtn.style.cssText = 'background:transparent;border:1px solid #ffd700;color:#ffd700;padding:2px 6px;margin-left:4px;border-radius:4px;cursor:pointer;font-size:13px;';
            gearBtn.onclick = (e) => {
                e.stopPropagation();
                this._showSevenSwordsLegend(containerId);
            };
            toolbar.appendChild(gearBtn);
        }
    }

    // ─── 更新副图数值行 ───
    _updateValuesRow(containerId, type, result) {
        const valuesDiv = document.getElementById(containerId + 'Values');
        if (!valuesDiv) return;

        let html = '';
        switch (type) {
            case 'volume': {
                const vols = result.volumes;
                const lastVol = vols.length > 0 ? vols[vols.length - 1] : 0;
                const ma5 = this._lastSMA(vols, 5);
                const ma10 = this._lastSMA(vols, 10);
                const ma20 = this._lastSMA(vols, 20);
                html = '<span class="val-item">VOL <span class="val-num">' + this._fmtVol(lastVol) + '</span></span>';
                html += '<span class="val-item"><span class="val-label">MA5</span> <span class="val-num">' + this._fmtVol(ma5) + '</span></span>';
                html += '<span class="val-item"><span class="val-label">MA10</span> <span class="val-num">' + this._fmtVol(ma10) + '</span></span>';
                if (ma20 > 0 && lastVol > 0) {
                    if (lastVol > ma20 * 1.5) {
                        html += '<span class="val-item" style="color:#f2c94c;">⚠ 放量</span>';
                    } else if (lastVol < ma20 * 0.6) {
                        html += '<span class="val-item" style="color:#6a7a9a;">缩量</span>';
                    }
                }
                break;
            }
            case 'macd': {
                const dif = this._lastVal(result.dif);
                const dea = this._lastVal(result.dea);
                const macd = this._lastVal(result.histogram);
                if (dif !== null && dea !== null && macd !== null) {
                    html += '<span class="val-item"><span class="val-label">DIF</span> <span class="val-num">' + dif.toFixed(3) + '</span></span>';
                    html += '<span class="val-item"><span class="val-label">DEA</span> <span class="val-num">' + dea.toFixed(3) + '</span></span>';
                    const macdCls = macd >= 0 ? 'up' : 'down';
                    html += '<span class="val-item"><span class="val-label">MACD</span> <span class="val-num ' + macdCls + '">' + macd.toFixed(3) + '</span></span>';
                }
                break;
            }
            case 'rsi': {
                const rsi = this._lastVal(result.values);
                if (rsi !== null) {
                    const cls = rsi >= 70 ? 'up' : (rsi <= 30 ? 'down' : '');
                    const status = rsi >= 70 ? ' 超买' : (rsi <= 30 ? ' 超卖' : '');
                    html = '<span class="val-item"><span class="val-label">RSI</span> <span class="val-num ' + cls + '">' + rsi.toFixed(1) + '</span><span style="font-size:10px;color:#6a7a9a;">' + status + '</span></span>';
                }
                break;
            }
            case 'kdj': {
                const k = this._lastVal(result.k);
                const d = this._lastVal(result.d);
                const j = this._lastVal(result.j);
                if (k !== null) {
                    html += '<span class="val-item"><span class="val-label">K</span> <span class="val-num">' + k.toFixed(2) + '</span></span>';
                    html += '<span class="val-item"><span class="val-label">D</span> <span class="val-num">' + d.toFixed(2) + '</span></span>';
                    html += '<span class="val-item"><span class="val-label">J</span> <span class="val-num">' + j.toFixed(2) + '</span></span>';
                }
                break;
            }
            case 'bollinger': {
                const upper = this._lastVal(result.upper);
                const middle = this._lastVal(result.middle);
                const lower = this._lastVal(result.lower);
                if (middle !== null) {
                    html += '<span class="val-item"><span class="val-label">MID</span> <span class="val-num">' + middle.toFixed(2) + '</span></span>';
                    if (upper !== null && lower !== null) {
                        const bandPct = middle !== 0 ? ((upper - lower) / middle * 100).toFixed(1) : '--';
                        html += '<span class="val-item"><span class="val-label">带宽</span> <span class="val-num">' + bandPct + '%</span></span>';
                    }
                }
                break;
            }
            case 'atr_channel': {
                const upper = this._lastVal(result.upper);
                const middle = this._lastVal(result.middle);
                const lower = this._lastVal(result.lower);
                if (middle !== null) {
                    html += '<span class="val-item"><span class="val-label">MID</span> <span class="val-num">' + middle.toFixed(2) + '</span></span>';
                    if (upper !== null && lower !== null) {
                        const bandPct = middle !== 0 ? ((upper - lower) / middle * 100).toFixed(1) : '--';
                        html += '<span class="val-item"><span class="val-label">带宽</span> <span class="val-num">' + bandPct + '%</span></span>';
                    }
                }
                break;
            }
            case 'cci': {
                const cci = this._lastVal(result.values);
                if (cci !== null) {
                    let cls = '';
                    let status = ' 中性';
                    if (cci > 100) { cls = 'up'; status = ' 超买'; }
                    else if (cci < -100) { cls = 'down'; status = ' 超卖'; }
                    html = '<span class="val-item"><span class="val-label">CCI</span> <span class="val-num ' + cls + '">' + cci.toFixed(1) + '</span><span style="font-size:10px;color:#6a7a9a;">' + status + '</span></span>';
                }
                break;
            }
            case 'williams_r': {
                const wr = this._lastVal(result.values);
                if (wr !== null) {
                    const cls = wr > -20 ? 'up' : (wr < -80 ? 'down' : '');
                    const status = wr > -20 ? ' 超买' : (wr < -80 ? ' 超卖' : '');
                    html = '<span class="val-item"><span class="val-label">%R</span> <span class="val-num ' + cls + '">' + wr.toFixed(2) + '</span><span style="font-size:10px;color:#6a7a9a;">' + status + '</span></span>';
                }
                break;
            }
            case 'obv': {
                const obvVal = this._lastVal(result.obv);
                const maVal = this._lastVal(result.ma);
                if (obvVal !== null && maVal !== null) {
                    html = '<span class="val-item"><span class="val-label">OBV</span> <span class="val-num">' + this._fmtVol(obvVal) + '</span></span>';
                    html += '<span class="val-item"><span class="val-label">MA20</span> <span class="val-num">' + this._fmtVol(maVal) + '</span></span>';
                }
                break;
            }
            case 'roc': {
                const roc = this._lastVal(result.values);
                if (roc !== null) {
                    const cls = roc >= 0 ? 'up' : 'down';
                    const sign = roc >= 0 ? '+' : '';
                    html = '<span class="val-item"><span class="val-label">ROC</span> <span class="val-num ' + cls + '">' + sign + roc.toFixed(2) + '%</span></span>';
                }
                break;
            }
            case 'trend_strength': {
                const wma = this._lastVal(result.wma);
                const press = this._lastVal(result.high20);
                const supp = this._lastVal(result.low20);
                if (wma !== null) {
                    html += '<span class="val-item"><span class="val-label">加权均值</span> <span class="val-num">' + wma.toFixed(2) + '</span></span>';
                }
                if (press !== null && supp !== null) {
                    html += '<span class="val-item"><span class="val-label">压力</span> <span class="val-num up">' + press.toFixed(2) + '</span></span>';
                    html += '<span class="val-item"><span class="val-label">支撑</span> <span class="val-num down">' + supp.toFixed(2) + '</span></span>';
                }
                // 检查最新是否有信号
                const lastSB = result.shortBottom && result.shortBottom.length > 0 ? result.shortBottom[result.shortBottom.length - 1] : false;
                const lastGF = result.goldenFinger && result.goldenFinger.length > 0 ? result.goldenFinger[result.goldenFinger.length - 1] : false;
                if (lastSB) html += '<span class="val-item" style="color:#2196f3;">● 短底</span>';
                if (lastGF) html += '<span class="val-item" style="color:#ffd700;">◆ 金手指</span>';
                break;
            }
            case 'supertrend': {
                const lastTrend = this._lastVal(result.trend);
                const lastSignal = result.signal && result.signal.length > 0 ? result.signal[result.signal.length - 1] : false;
                if (lastTrend === 1) html += '<span class="val-item"><span class="val-label">趋势</span> <span class="val-num up">↑ 上升</span></span>';
                else if (lastTrend === -1) html += '<span class="val-item"><span class="val-label">趋势</span> <span class="val-num down">↓ 下降</span></span>';
                else html += '<span class="val-item"><span class="val-label">趋势</span> <span class="val-num">--</span></span>';
                if (lastSignal) html += '<span class="val-item" style="color:#ffd700;">⚠ 转向信号</span>';
                break;
            }
            case 'cmf': {
                const lastCmf = this._lastVal(result.cmf);
                if (lastCmf !== null) {
                    const cls = lastCmf > 0 ? 'up' : (lastCmf < 0 ? 'down' : '');
                    html += '<span class="val-item"><span class="val-label">CMF</span> <span class="val-num ' + cls + '">' + lastCmf.toFixed(3) + '</span></span>';
                    if (lastCmf > 0.1) html += '<span class="val-item" style="color:#4cff4c;">资金流入</span>';
                    else if (lastCmf < -0.1) html += '<span class="val-item" style="color:#ff4c4c;">资金流出</span>';
                }
                break;
            }
            case 'seven_swords': {
                const lastTotal = this._lastVal(result.total);
                if (lastTotal !== null) {
                    const strong = lastTotal >= 5;
                    html += '<span class="val-item"><span class="val-label">七脉神剑</span> <span class="val-num' + (strong ? ' up' : '') + '">' + lastTotal + '/7 多头</span></span>';
                    if (strong) html += '<span class="val-item" style="color:#ffd700;">⚔ 强多信号</span>';
                }
                break;
            }
        }
        valuesDiv.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;">' + html + '</div>';
    }

    _lastVal(arr) {
        if (!arr || arr.length === 0) return null;
        for (let i = arr.length - 1; i >= 0; i--) {
            if (arr[i] !== null && !isNaN(arr[i])) return arr[i];
        }
        return null;
    }

    _lastSMA(arr, period) {
        if (!arr || arr.length < period) return 0;
        let sum = 0, count = 0;
        for (let i = arr.length - 1; i >= arr.length - period && i >= 0; i--) {
            if (arr[i] !== null && !isNaN(arr[i])) { sum += arr[i]; count++; }
        }
        return count > 0 ? sum / count : 0;
    }

    _fmtVol(v) {
        if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿';
        if (v >= 1e4) return (v / 1e4).toFixed(1) + '万';
        return Math.round(v).toString();
    }

    /**
     * 将原始交易日序列扩展为连续日历日序列（每日都有），价格用前向填充。
     * @param {string[]} origDates - 原始日期数组 (YYYY-MM-DD)
     * @param {Array[]} origData  - 原始K线数据 [[open,close,low,high,volume], ...]
     * @returns {{ contDates: string[], contData: Array[], origIndices: number[] }}
     */
    _expandToContinuous(origDates, origData) {
        if (!origDates.length) return { contDates: [], contData: [], origIndices: [] };

        const start = new Date(origDates[0]);
        const end = new Date(origDates[origDates.length - 1]);
        const contDates = [];
        const contData = [];
        const origIndices = [];

        let origIdx = 0;
        let lastValidRow = null;

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().slice(0, 10);
            contDates.push(dateStr);

            if (origIdx < origDates.length && origDates[origIdx] === dateStr) {
                const row = origData[origIdx];
                contData.push(row);
                lastValidRow = row;
                origIndices.push(contDates.length - 1);
                origIdx++;
            } else {
                if (lastValidRow) {
                    const filledRow = [...lastValidRow];
                    filledRow[4] = 0;
                    contData.push(filledRow);
                } else {
                    contData.push([0, 0, 0, 0, 0]);
                }
            }
        }

        return { contDates, contData, origIndices };
    }

    _computeIndicator(type, klineData, dates, stockCode, opts = {}) {
        const dataLen = klineData.length;
        console.log('[SubChartManager] _computeIndicator', {
            type,
            dataLen,
            datesLen: dates ? dates.length : 0,
            stockCode
        });

        this._showDebugInfo(
            '[' + type + '] 入口: dates=' + (dates ? dates.length : 0) +
            ' klineData=' + dataLen +
            ' stock=' + (stockCode || '?') +
            ' dates首5=' + (dates ? JSON.stringify(dates.slice(0, 5)) : 'N/A')
        );

        // 使用数据内容生成缓存键（取首/中/尾收盘价），避免同长度但不同数据时返回过期结果
        const firstClose = klineData[0] ? (parseFloat(klineData[0][1]) || 0).toFixed(2) : '0';
        const lastClose = klineData[dataLen - 1] ? (parseFloat(klineData[dataLen - 1][1]) || 0).toFixed(2) : '0';
        const midClose = klineData[Math.floor(dataLen / 2)] ? (parseFloat(klineData[Math.floor(dataLen / 2)][1]) || 0).toFixed(2) : '0';
        const cacheKey = `${stockCode || ''}_${type}_${dataLen}_${firstClose}_${midClose}_${lastClose}`;

        if (this.cache.has(cacheKey)) {
            console.log('[SubChartManager] cache hit for', type);
            return this.cache.get(cacheKey);
        }

        // 不再降采样，使用全部原始数据
        let workData = klineData;
        let workDates = dates;

        // 扩展为连续日历日序列，使指标计算基于连续价格（消除周末缺口）
        const { contDates, contData, origIndices } = this._expandToContinuous(workDates, workData);
        if (contData.length === 0) return null;

        this._showDebugInfo(
            '[' + type + '] 扩展后: contDates=' + contDates.length +
            ' (首=' + (contDates[0] || '?') + ' 尾=' + (contDates[contDates.length - 1] || '?') + ')' +
            ' origIndices=' + origIndices.length +
            ' 缺口天数=' + (contDates.length - workDates.length)
        );

        const contCloses = contData.map(v => parseFloat(v[1]) || 0);
        const contHighs   = contData.map(v => parseFloat(v[3]) || 0);
        const contLows    = contData.map(v => parseFloat(v[2]) || 0);
        const contVolumes = contData.map(v => parseFloat(v[4]) || 0);

        let fullResult = null;
        switch (type) {
            case 'volume':
                fullResult = { type: 'volume', volumes: contVolumes, closes: contCloses, workData: contData, dates: contDates };
                break;
            case 'macd': {
                const macdResult = indicators.calculateMACD(contCloses);
                console.log('[SubChartManager] MACD result (continuous)', {
                    contLen: contCloses.length,
                    difNonNull: macdResult.dif.filter(v => v !== null).length,
                    deaNonNull: macdResult.dea.filter(v => v !== null).length,
                    histNonNull: macdResult.histogram.filter(v => v !== null).length
                });
                this._showDebugInfo(
                    '[macd] 连续序列: dif非空=' + macdResult.dif.filter(v => v !== null).length +
                    ' dea非空=' + macdResult.dea.filter(v => v !== null).length +
                    ' hist非空=' + macdResult.histogram.filter(v => v !== null).length +
                    ' / 总长度=' + macdResult.dif.length
                );
                fullResult = { type: 'macd', ...macdResult, dates: contDates };
                break;
            }
            case 'rsi':
                fullResult = { type: 'rsi', values: indicators.calculateRSI(contCloses), dates: contDates };
                break;
            case 'kdj': {
                const kdjResult = indicators.calculateKDJ(contHighs, contLows, contCloses);
                console.log('[SubChartManager] KDJ result (continuous)', {
                    contLen: contCloses.length,
                    kNonNull: kdjResult.k.filter(v => v !== null).length,
                    dNonNull: kdjResult.d.filter(v => v !== null).length,
                    jNonNull: kdjResult.j.filter(v => v !== null).length
                });
                fullResult = { type: 'kdj', ...kdjResult, dates: contDates };
                break;
            }
            case 'bollinger': {
                const bollResult = indicators.calculateBollinger(contCloses);
                fullResult = { type: 'bollinger', ...bollResult, dates: contDates };
                break;
            }
            case 'atr_channel': {
                const atrResult = indicators.calculateATRChannel(contHighs, contLows, contCloses);
                fullResult = { type: 'atr_channel', ...atrResult, dates: contDates };
                break;
            }
            case 'cci': {
                const cciValues = indicators.calculateCCI(contHighs, contLows, contCloses);
                fullResult = { type: 'cci', values: cciValues, dates: contDates };
                break;
            }
            case 'williams_r': {
                const wrValues = indicators.calculateWilliamsR(contHighs, contLows, contCloses);
                fullResult = { type: 'williams_r', values: wrValues, dates: contDates };
                break;
            }
            case 'obv': {
                const obvResult = indicators.calculateOBV(contCloses, contVolumes);
                fullResult = { type: 'obv', ...obvResult, dates: contDates };
                break;
            }
            case 'roc': {
                const rocValues = indicators.calculateROC(contCloses);
                fullResult = { type: 'roc', values: rocValues, dates: contDates };
                break;
            }
            case 'trend_strength': {
                const wma = indicators.weightedSMA(contCloses, 21);
                const { high20, low20 } = indicators.calcSupportResistance(contHighs, contLows);
                const shortBottom = indicators.shortBottomSignal(contHighs, contLows, contCloses);
                const goldenFinger = indicators.calcGoldenFinger(contCloses);
                fullResult = { type: 'trend_strength', wma, high20, low20, shortBottom, goldenFinger, dates: contDates };
                break;
            }
            case 'supertrend': {
                const stResult = indicators.calculateSupertrend(contHighs, contLows, contCloses);
                fullResult = { type: 'supertrend', ...stResult, dates: contDates };
                break;
            }
            case 'cmf': {
                const cmfResult = indicators.calculateCMF(contHighs, contLows, contCloses, contVolumes);
                fullResult = { type: 'cmf', cmf: cmfResult.cmf, dates: contDates };
                break;
            }
            case 'seven_swords': {
                const ssResult = indicators.calculateSevenSwords(contHighs, contLows, contCloses, contVolumes);
                fullResult = { type: 'seven_swords', ...ssResult, dates: contDates };
                break;
            }
        }

        if (!fullResult) return null;

        // 按原始交易日索引提取（只保留原始交易日位置的值）
        const extractArray = (arr) => origIndices.map(idx => arr[idx]);

        let result = null;
        switch (type) {
            case 'volume':
                result = {
                    type: 'volume',
                    volumes: extractArray(fullResult.volumes),
                    closes: extractArray(fullResult.closes),
                    workData: origIndices.map(idx => contData[idx]),
                    dates: workDates
                };
                break;
            case 'macd':
                result = {
                    type: 'macd',
                    dif: extractArray(fullResult.dif),
                    dea: extractArray(fullResult.dea),
                    histogram: extractArray(fullResult.histogram),
                    dates: workDates
                };
                break;
            case 'rsi':
                result = {
                    type: 'rsi',
                    values: extractArray(fullResult.values),
                    dates: workDates
                };
                break;
            case 'kdj':
                result = {
                    type: 'kdj',
                    k: extractArray(fullResult.k),
                    d: extractArray(fullResult.d),
                    j: extractArray(fullResult.j),
                    dates: workDates
                };
                break;
            case 'bollinger':
                result = {
                    type: 'bollinger',
                    upper: extractArray(fullResult.upper),
                    middle: extractArray(fullResult.middle),
                    lower: extractArray(fullResult.lower),
                    dates: workDates
                };
                break;
            case 'atr_channel':
                result = {
                    type: 'atr_channel',
                    upper: extractArray(fullResult.upper),
                    middle: extractArray(fullResult.middle),
                    lower: extractArray(fullResult.lower),
                    dates: workDates
                };
                break;
            case 'cci':
                result = {
                    type: 'cci',
                    values: extractArray(fullResult.values),
                    dates: workDates
                };
                break;
            case 'williams_r':
                result = {
                    type: 'williams_r',
                    values: extractArray(fullResult.values),
                    dates: workDates
                };
                break;
            case 'obv':
                result = {
                    type: 'obv',
                    obv: extractArray(fullResult.obv),
                    ma: extractArray(fullResult.ma),
                    dates: workDates
                };
                break;
            case 'roc':
                result = {
                    type: 'roc',
                    values: extractArray(fullResult.values),
                    dates: workDates
                };
                break;
            case 'trend_strength':
                result = {
                    type: 'trend_strength',
                    wma: extractArray(fullResult.wma),
                    high20: extractArray(fullResult.high20),
                    low20: extractArray(fullResult.low20),
                    shortBottom: extractArray(fullResult.shortBottom),
                    goldenFinger: extractArray(fullResult.goldenFinger),
                    dates: workDates
                };
                break;
            case 'supertrend':
                result = {
                    type: 'supertrend',
                    trend: extractArray(fullResult.trend),
                    trendLine: extractArray(fullResult.trendLine),
                    signal: extractArray(fullResult.signal),
                    dates: workDates
                };
                break;
            case 'cmf':
                result = {
                    type: 'cmf',
                    cmf: extractArray(fullResult.cmf),
                    dates: workDates
                };
                break;
            case 'seven_swords':
                result = {
                    type: 'seven_swords',
                    swords: fullResult.swords.map(sw => ({
                        name: sw.name,
                        signals: extractArray(sw.signals)
                    })),
                    total: extractArray(fullResult.total),
                    dates: workDates
                };
                break;
        }

        if (result) {
            this.cache.set(cacheKey, result);

            // 输出提取后的最终结果
            if (type === 'macd') {
                this._showDebugInfo(
                    '[macd] 提取后: dif=' + result.dif.length +
                    ' (非空=' + result.dif.filter(v => v !== null).length + ')' +
                    ' dea=' + result.dea.length +
                    ' (非空=' + result.dea.filter(v => v !== null).length + ')' +
                    ' hist=' + result.histogram.length +
                    ' (非空=' + result.histogram.filter(v => v !== null).length + ')' +
                    ' dates=' + result.dates.length
                );
            } else if (type === 'rsi') {
                this._showDebugInfo(
                    '[rsi] 提取后: values=' + result.values.length +
                    ' (非空=' + result.values.filter(v => v !== null).length + ')' +
                    ' dates=' + result.dates.length
                );
            } else if (type === 'kdj') {
                this._showDebugInfo(
                    '[kdj] 提取后: k=' + result.k.length +
                    ' (非空=' + result.k.filter(v => v !== null).length + ')' +
                    ' d=' + result.d.length +
                    ' (非空=' + result.d.filter(v => v !== null).length + ')' +
                    ' j=' + result.j.length +
                    ' (非空=' + result.j.filter(v => v !== null).length + ')' +
                    ' dates=' + result.dates.length
                );
            } else if (type === 'volume') {
                this._showDebugInfo(
                    '[volume] 提取后: volumes=' + result.volumes.length +
                    ' dates=' + result.dates.length
                );
            }
        }
        return result;
    }

    _downsample(data, targetLen) {
        if (data.length <= targetLen) return data;
        const step = data.length / targetLen;
        const result = [];
        for (let i = 0; i < targetLen; i++) {
            result.push(data[Math.floor(i * step)]);
        }
        return result;
    }

    // ─── ECharts option 构建 ───

    _baseGrid() {
        return { containLabel: true, left: '10%', right: '8%', top: 24, bottom: 10 };
    }

    _baseXAxis(dates) {
        return {
            type: 'category',
            data: dates,
            axisLabel: { show: false },
            axisTick: { show: false },
            axisLine: { lineStyle: { color: '#2a314a' } },
            splitLine: { show: false }
        };
    }

    _baseDataZoom(dates) {
        const total = dates.length;
        let start = 0;
        if (total > 220) start = Math.round(((total - 220) / total) * 100);
        return [{
            type: 'inside',
            start,
            end: 100,
            zoomOnMouseWheel: false,
            moveOnMouseMove: false,
            moveOnMouseWheel: false
        }];
    }

    _buildOption(indicatorResult, type, dates, klineData) {
        if (!indicatorResult) return null;

        const grid = this._baseGrid();
        const xAxis = this._baseXAxis(dates);
        const dataZoom = this._baseDataZoom(dates);

        let option = null;
        switch (type) {
            case 'volume': option = this._volumeOption(indicatorResult, dates, grid, xAxis, dataZoom); break;
            case 'macd':   option = this._macdOption(indicatorResult, dates, grid, xAxis, dataZoom); break;
            case 'rsi':    option = this._rsiOption(indicatorResult, dates, grid, xAxis, dataZoom); break;
            case 'kdj':       option = this._kdjOption(indicatorResult, dates, grid, xAxis, dataZoom); break;
            case 'bollinger':   option = this._bollingerOption(indicatorResult, dates, grid, xAxis, dataZoom); break;
            case 'atr_channel': option = this._atrChannelOption(indicatorResult, dates, grid, xAxis, dataZoom); break;
            case 'cci':         option = this._cciOption(indicatorResult, dates, grid, xAxis, dataZoom); break;
            case 'williams_r':  option = this._williamsROption(indicatorResult, dates, grid, xAxis, dataZoom); break;
            case 'obv':        option = this._obvOption(indicatorResult, dates, grid, xAxis, dataZoom); break;
            case 'roc':        option = this._rocOption(indicatorResult, dates, grid, xAxis, dataZoom); break;
            case 'trend_strength': option = this._trendStrengthOption(indicatorResult, dates, grid, xAxis, dataZoom); break;
            case 'supertrend': option = this._supertrendOption(indicatorResult, dates, grid, xAxis, dataZoom); break;
            case 'cmf': option = this._cmfOption(indicatorResult, dates, grid, xAxis, dataZoom); break;
            case 'seven_swords': option = this._sevenSwordsOption(indicatorResult, dates, grid, xAxis, dataZoom); break;
            default:            return null;
        }

        // tooltip 渲染到 body，避免被父容器 overflow:hidden 或上层图表遮挡
        if (option && option.tooltip) {
            option.tooltip.appendToBody = true;
        }
        return option;
    }

    _volumeOption(res, dates, grid, xAxis, dataZoom) {
        const { volumes, workData } = res;

        // 计算20日均量用于放量/缩量判断
        const ma20 = sma(volumes, 20);

        const volBars = workData.map((v, i) => {
            const open = parseFloat(v[0]) || 0;
            const close = parseFloat(v[1]) || 0;
            const high = parseFloat(v[3]) || 0;
            const vol = volumes[i] || 0;
            const avgVol = ma20[i];

            let color;
            if (avgVol && avgVol > 0) {
                if (vol > avgVol * 1.5) {
                    color = '#f2c94c'; // 放量：金色
                } else if (vol < avgVol * 0.6) {
                    color = '#6a7a9a'; // 缩量：深灰
                } else {
                    const isUp = (close === open) ? (high >= close) : (close >= open);
                    color = isUp ? '#ef5350' : '#26a69a';
                }
            } else {
                const isUp = (close === open) ? (high >= close) : (close >= open);
                color = isUp ? '#ef5350' : '#26a69a';
            }

            return {
                value: vol,
                itemStyle: { color }
            };
        });

        const ma5 = sma(volumes, 5);
        const ma10 = sma(volumes, 10);

        return {
            backgroundColor: 'transparent',
            animation: false,
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            xAxis,
            yAxis: {
                type: 'value',
                axisLabel: {
                    color: '#9aa9cc', fontSize: 10,
                    formatter: v => v >= 1e8 ? (v / 1e8).toFixed(1) + '亿' : v >= 1e4 ? (v / 1e4).toFixed(0) + '万' : v
                },
                splitLine: { show: false },
                name: 'VOL',
                nameTextStyle: { color: '#9aa9cc', fontSize: 10 }
            },
            series: [
                { name: '成交量', type: 'bar', data: volBars, barWidth: '60%' },
                { name: 'VOL5', type: 'line', data: ma5, lineStyle: { width: 1, color: '#f2c94c' }, showSymbol: false },
                { name: 'VOL10', type: 'line', data: ma10, lineStyle: { width: 1, color: '#bb86fc' }, showSymbol: false }
            ],
            legend: {
                data: ['成交量', 'VOL5', 'VOL10'],
                textStyle: { color: '#ffffff' },
                type: 'scroll', orient: 'horizontal', left: 'left', top: 0,
                itemWidth: 70, itemHeight: 20,
                pageIconColor: '#4f7eff', pageTextStyle: { color: '#ffffff' }
            },
            grid,
            dataZoom
        };
    }

    _macdOption(res, dates, grid, xAxis, dataZoom) {
        const { dif, dea, histogram } = res;
        const colors = histogram.map(v => v === null ? 'transparent' : (v >= 0 ? '#ef5350' : '#26a69a'));
        const barData = histogram.map((v, i) => v === null ? null : { value: v, itemStyle: { color: colors[i] } });

        return {
            backgroundColor: 'transparent',
            animation: false,
            tooltip: { trigger: 'axis' },
            xAxis,
            yAxis: {
                type: 'value',
                axisLabel: { color: '#9aa9cc', fontSize: 10 },
                splitLine: { lineStyle: { color: '#2a314a', type: 'dashed' } }
            },
            series: [
                { name: 'DIF', type: 'line', data: dif, lineStyle: { width: 1, color: '#f2c94c' }, showSymbol: false },
                { name: 'DEA', type: 'line', data: dea, lineStyle: { width: 1, color: '#bb86fc' }, showSymbol: false },
                { name: 'MACD', type: 'bar', data: barData, barWidth: '60%' }
            ],
            legend: {
                data: ['DIF', 'DEA', 'MACD'],
                textStyle: { color: '#ffffff' },
                type: 'scroll', orient: 'horizontal', left: 'left', top: 0,
                itemWidth: 70, itemHeight: 20,
                pageIconColor: '#4f7eff', pageTextStyle: { color: '#ffffff' }
            },
            grid,
            dataZoom
        };
    }

    _rsiOption(res, dates, grid, xAxis, dataZoom) {
        const { values } = res;

        return {
            backgroundColor: 'transparent',
            animation: false,
            tooltip: { trigger: 'axis' },
            xAxis,
            yAxis: {
                type: 'value',
                min: 'dataMin',  // 自动适应数据最小值（可显示负值）
    			max: 'dataMax',
                axisLabel: { color: '#9aa9cc', fontSize: 10 },
                splitLine: { lineStyle: { color: '#2a314a', type: 'dashed' } }
            },
            series: [
                { name: 'RSI', type: 'line', data: values, lineStyle: { width: 1.5, color: '#4f7eff' }, showSymbol: false },
                {
                    name: '超买线', type: 'line',
                    data: dates.map(() => 70),
                    lineStyle: { width: 1, color: '#ef5350', type: 'dashed' },
                    showSymbol: false, silent: true
                },
                {
                    name: '超卖线', type: 'line',
                    data: dates.map(() => 30),
                    lineStyle: { width: 1, color: '#26a69a', type: 'dashed' },
                    showSymbol: false, silent: true
                }
            ],
            legend: {
                data: ['RSI', '超买线', '超卖线'],
                textStyle: { color: '#ffffff' },
                type: 'scroll', orient: 'horizontal', left: 'left', top: 0,
                itemWidth: 70, itemHeight: 20,
                pageIconColor: '#4f7eff', pageTextStyle: { color: '#ffffff' }
            },
            grid,
            dataZoom
        };
    }

    _kdjOption(res, dates, grid, xAxis, dataZoom) {
        const { k, d, j } = res;

        return {
            backgroundColor: 'transparent',
            animation: false,
            tooltip: { trigger: 'axis' },
            xAxis,
            yAxis: {
                type: 'value',
                min: 'dataMin',
    			max: 'dataMax',
                axisLabel: { color: '#9aa9cc', fontSize: 10 },
                splitLine: { lineStyle: { color: '#2a314a', type: 'dashed' } }
            },
            series: [
                { name: 'K', type: 'line', data: k, lineStyle: { width: 1.5, color: '#f2c94c' }, showSymbol: false },
                { name: 'D', type: 'line', data: d, lineStyle: { width: 1.5, color: '#bb86fc' }, showSymbol: false },
                { name: 'J', type: 'line', data: j, lineStyle: { width: 1, color: '#ef5350' }, showSymbol: false }
            ],
            legend: {
                data: ['K', 'D', 'J'],
                textStyle: { color: '#ffffff' },
                type: 'scroll', orient: 'horizontal', left: 'left', top: 0,
                itemWidth: 70, itemHeight: 20,
                pageIconColor: '#4f7eff', pageTextStyle: { color: '#ffffff' }
            },
            grid,
            dataZoom
        };
    }

    _bollingerOption(res, dates, grid, xAxis, dataZoom) {
        const { upper, middle, lower } = res;

        return {
            backgroundColor: 'transparent',
            animation: false,
            tooltip: { trigger: 'axis' },
            xAxis,
            yAxis: {
                type: 'value',
                min: 'dataMin',
                max: 'dataMax',
                axisLabel: { color: '#9aa9cc', fontSize: 10 },
                splitLine: { lineStyle: { color: '#2a314a', type: 'dashed' } }
            },
            series: [
                { name: 'UPPER', type: 'line', data: upper, lineStyle: { width: 1, color: '#ef5350', type: 'dashed' }, showSymbol: false },
                { name: 'MID', type: 'line', data: middle, lineStyle: { width: 1.5, color: '#4f7eff' }, showSymbol: false },
                { name: 'LOWER', type: 'line', data: lower, lineStyle: { width: 1, color: '#26a69a', type: 'dashed' }, showSymbol: false }
            ],
            legend: {
                data: ['UPPER', 'MID', 'LOWER'],
                textStyle: { color: '#ffffff' },
                type: 'scroll', orient: 'horizontal', left: 'left', top: 0,
                itemWidth: 70, itemHeight: 20,
                pageIconColor: '#4f7eff', pageTextStyle: { color: '#ffffff' }
            },
            grid,
            dataZoom
        };
    }

    _atrChannelOption(res, dates, grid, xAxis, dataZoom) {
        const { upper, middle, lower } = res;

        return {
            backgroundColor: 'transparent',
            animation: false,
            tooltip: { trigger: 'axis' },
            xAxis,
            yAxis: {
                type: 'value',
                min: 'dataMin',
                max: 'dataMax',
                axisLabel: { color: '#9aa9cc', fontSize: 10 },
                splitLine: { lineStyle: { color: '#2a314a', type: 'dashed' } }
            },
            series: [
                { name: 'UPPER', type: 'line', data: upper, lineStyle: { width: 1, color: '#ef5350', type: 'dashed' }, showSymbol: false },
                { name: 'MID', type: 'line', data: middle, lineStyle: { width: 1.5, color: '#4f7eff' }, showSymbol: false },
                { name: 'LOWER', type: 'line', data: lower, lineStyle: { width: 1, color: '#26a69a', type: 'dashed' }, showSymbol: false }
            ],
            legend: {
                data: ['UPPER', 'MID', 'LOWER'],
                textStyle: { color: '#ffffff' },
                type: 'scroll', orient: 'horizontal', left: 'left', top: 0,
                itemWidth: 70, itemHeight: 20,
                pageIconColor: '#4f7eff', pageTextStyle: { color: '#ffffff' }
            },
            grid,
            dataZoom
        };
    }

    _cciOption(res, dates, grid, xAxis, dataZoom) {
        const { values } = res;

        return {
            backgroundColor: 'transparent',
            animation: false,
            tooltip: { trigger: 'axis' },
            xAxis,
            yAxis: {
                type: 'value',
                min: 'dataMin',
                max: 'dataMax',
                axisLabel: { color: '#9aa9cc', fontSize: 10 },
                splitLine: { lineStyle: { color: '#2a314a', type: 'dashed' } }
            },
            series: [
                { name: 'CCI', type: 'line', data: values, lineStyle: { width: 1.5, color: '#4f7eff' }, showSymbol: false },
                {
                    name: '超买线', type: 'line',
                    data: dates.map(() => 100),
                    lineStyle: { width: 1, color: '#ef5350', type: 'dashed' },
                    showSymbol: false, silent: true
                },
                {
                    name: '超卖线', type: 'line',
                    data: dates.map(() => -100),
                    lineStyle: { width: 1, color: '#26a69a', type: 'dashed' },
                    showSymbol: false, silent: true
                }
            ],
            legend: {
                data: ['CCI', '超买线', '超卖线'],
                textStyle: { color: '#ffffff' },
                type: 'scroll', orient: 'horizontal', left: 'left', top: 0,
                itemWidth: 70, itemHeight: 20,
                pageIconColor: '#4f7eff', pageTextStyle: { color: '#ffffff' }
            },
            grid,
            dataZoom
        };
    }

    _williamsROption(res, dates, grid, xAxis, dataZoom) {
        const { values } = res;

        return {
            backgroundColor: 'transparent',
            animation: false,
            tooltip: { trigger: 'axis' },
            xAxis,
            yAxis: {
                type: 'value',
                min: -100,
                max: 0,
                axisLabel: { color: '#9aa9cc', fontSize: 10 },
                splitLine: { lineStyle: { color: '#2a314a', type: 'dashed' } }
            },
            series: [
                { name: '%R', type: 'line', data: values, lineStyle: { width: 1.5, color: '#4f7eff' }, showSymbol: false },
                {
                    name: '超买线', type: 'line',
                    data: dates.map(() => -20),
                    lineStyle: { width: 1, color: '#ef5350', type: 'dashed' },
                    showSymbol: false, silent: true
                },
                {
                    name: '超卖线', type: 'line',
                    data: dates.map(() => -80),
                    lineStyle: { width: 1, color: '#26a69a', type: 'dashed' },
                    showSymbol: false, silent: true
                }
            ],
            legend: {
                data: ['%R', '超买线', '超卖线'],
                textStyle: { color: '#ffffff' },
                type: 'scroll', orient: 'horizontal', left: 'left', top: 0,
                itemWidth: 70, itemHeight: 20,
                pageIconColor: '#4f7eff', pageTextStyle: { color: '#ffffff' }
            },
            grid,
            dataZoom
        };
    }

    _obvOption(res, dates, grid, xAxis, dataZoom) {
        const { obv, ma } = res;

        return {
            backgroundColor: 'transparent',
            animation: false,
            tooltip: { trigger: 'axis' },
            xAxis,
            yAxis: {
                type: 'value',
                min: 'dataMin',
                max: 'dataMax',
                axisLabel: {
                    color: '#9aa9cc', fontSize: 10,
                    formatter: v => v >= 1e8 ? (v / 1e8).toFixed(1) + '亿' : v >= 1e4 ? (v / 1e4).toFixed(0) + '万' : v
                },
                splitLine: { lineStyle: { color: '#2a314a', type: 'dashed' } }
            },
            series: [
                { name: 'OBV', type: 'line', data: obv, lineStyle: { width: 1.5, color: '#4f7eff' }, showSymbol: false },
                { name: 'MA20', type: 'line', data: ma, lineStyle: { width: 1, color: '#f2c94c', type: 'dashed' }, showSymbol: false }
            ],
            legend: {
                data: ['OBV', 'MA20'],
                textStyle: { color: '#ffffff' },
                type: 'scroll', orient: 'horizontal', left: 'left', top: 0,
                itemWidth: 70, itemHeight: 20,
                pageIconColor: '#4f7eff', pageTextStyle: { color: '#ffffff' }
            },
            grid,
            dataZoom
        };
    }

    _rocOption(res, dates, grid, xAxis, dataZoom) {
        const { values } = res;

        return {
            backgroundColor: 'transparent',
            animation: false,
            tooltip: { trigger: 'axis' },
            xAxis,
            yAxis: {
                type: 'value',
                min: 'dataMin',
                max: 'dataMax',
                axisLabel: { color: '#9aa9cc', fontSize: 10 },
                splitLine: { lineStyle: { color: '#2a314a', type: 'dashed' } }
            },
            series: [
                { name: 'ROC', type: 'line', data: values, lineStyle: { width: 1.5, color: '#4f7eff' }, showSymbol: false },
                {
                    name: '零轴', type: 'line',
                    data: dates.map(() => 0),
                    lineStyle: { width: 1, color: '#9aa9cc', type: 'dashed' },
                    showSymbol: false, silent: true
                }
            ],
            legend: {
                data: ['ROC', '零轴'],
                textStyle: { color: '#ffffff' },
                type: 'scroll', orient: 'horizontal', left: 'left', top: 0,
                itemWidth: 70, itemHeight: 20,
                pageIconColor: '#4f7eff', pageTextStyle: { color: '#ffffff' }
            },
            grid,
            dataZoom
        };
    }

    _trendStrengthOption(res, dates, grid, xAxis, dataZoom) {
        const { wma, high20, low20, shortBottom, goldenFinger } = res;

        // 短底信号位置 → 散点数据
        const shortBottomData = [];
        const goldenFingerData = [];
        for (let i = 0; i < dates.length; i++) {
            if (shortBottom[i]) shortBottomData.push({ value: [i, wma[i] || 0], symbol: 'triangle', symbolRotate: 0, date: dates[i], signalType: 'shortBottom' });
            if (goldenFinger[i]) goldenFingerData.push({ value: [i, wma[i] || 0], symbol: 'triangle', symbolRotate: 180, date: dates[i], signalType: 'goldenFinger' });
        }

        return {
            backgroundColor: 'transparent',
            animation: false,
            tooltip: { trigger: 'axis' },
            xAxis,
            yAxis: {
                type: 'value',
                min: 'dataMin',
                max: 'dataMax',
                axisLabel: { color: '#9aa9cc', fontSize: 10 },
                splitLine: { lineStyle: { color: '#2a314a', type: 'dashed' } }
            },
            series: [
                { name: '加权均值', type: 'line', data: wma, lineStyle: { width: 1.5, color: '#ff9800' }, showSymbol: false },
                { name: '压力线(H20)', type: 'line', data: high20, lineStyle: { width: 1, color: '#00bcd4', type: 'dashed' }, showSymbol: false },
                { name: '支撑线(L20)', type: 'line', data: low20, lineStyle: { width: 1, color: '#4caf50', type: 'dashed' }, showSymbol: false },
                { name: '短底信号', type: 'scatter', data: shortBottomData, symbolSize: 10, itemStyle: { color: '#2196f3' }, z: 10 },
                { name: '金手指', type: 'scatter', data: goldenFingerData, symbolSize: 12, itemStyle: { color: '#ffd700' }, z: 10 }
            ],
            legend: {
                data: ['加权均值', '压力线(H20)', '支撑线(L20)', '短底信号', '金手指'],
                textStyle: { color: '#ffffff' },
                type: 'scroll', orient: 'horizontal', left: 'left', top: 0,
                itemWidth: 70, itemHeight: 20,
                pageIconColor: '#4f7eff', pageTextStyle: { color: '#ffffff' }
            },
            grid,
            dataZoom
        };
    }

    _supertrendOption(res, dates, grid, xAxis, dataZoom) {
        const { trend, trendLine, signal } = res;

        // 拆分为上升段（绿色）和下降段（红色），避免断点连线
        const upData = trendLine.map((v, i) => {
            return trend[i] === 1 ? v : null;
        });
        const downData = trendLine.map((v, i) => {
            return trend[i] === -1 ? v : null;
        });

        // 信号散点数据
        const buySignalData = [];
        const sellSignalData = [];
        for (let i = 0; i < dates.length; i++) {
            if (!signal[i]) continue;
            const val = trendLine[i] !== null ? trendLine[i] : 0;
            if (trend[i] === 1) {
                buySignalData.push({ value: [i, val], symbol: 'triangle', symbolRotate: 0, date: dates[i], signalType: 'buy' });
            } else if (trend[i] === -1) {
                sellSignalData.push({ value: [i, val], symbol: 'triangle', symbolRotate: 180, date: dates[i], signalType: 'sell' });
            }
        }

        return {
            backgroundColor: 'transparent',
            animation: false,
            tooltip: { trigger: 'axis' },
            xAxis,
            yAxis: {
                type: 'value',
                min: 'dataMin',
                max: 'dataMax',
                axisLabel: { color: '#9aa9cc', fontSize: 10 },
                splitLine: { lineStyle: { color: '#2a314a', type: 'dashed' } }
            },
            series: [
                { name: '上升趋势', type: 'line', data: upData, lineStyle: { width: 2, color: '#4caf50' }, showSymbol: false, connectNulls: false },
                { name: '下降趋势', type: 'line', data: downData, lineStyle: { width: 2, color: '#ef5350' }, showSymbol: false, connectNulls: false },
                { name: '买入信号', type: 'scatter', data: buySignalData, symbolSize: 12, itemStyle: { color: '#4caf50' }, z: 10 },
                { name: '卖出信号', type: 'scatter', data: sellSignalData, symbolSize: 12, itemStyle: { color: '#ef5350' }, z: 10 }
            ],
            legend: {
                data: ['上升趋势', '下降趋势', '买入信号', '卖出信号'],
                textStyle: { color: '#ffffff' },
                type: 'scroll', orient: 'horizontal', left: 'left', top: 0,
                itemWidth: 70, itemHeight: 20,
                pageIconColor: '#4f7eff', pageTextStyle: { color: '#ffffff' }
            },
            grid,
            dataZoom
        };
    }

    _cmfOption(res, dates, grid, xAxis, dataZoom) {
        const { cmf } = res;

        // 柱状图：正值红色，负值绿色
        const barData = cmf.map(v => {
            if (v === null) return null;
            return {
                value: v,
                itemStyle: { color: v >= 0 ? '#ef5350' : '#26a69a' }
            };
        });

        return {
            backgroundColor: 'transparent',
            animation: false,
            tooltip: { trigger: 'axis' },
            xAxis,
            yAxis: {
                type: 'value',
                min: -1,
                max: 1,
                axisLabel: { color: '#9aa9cc', fontSize: 10 },
                splitLine: { lineStyle: { color: '#2a314a', type: 'dashed' } }
            },
            series: [
                { name: 'CMF', type: 'bar', data: barData, barWidth: '60%' },
                {
                    name: '零轴', type: 'line',
                    data: dates.map(() => 0),
                    lineStyle: { width: 1, color: '#9aa9cc', type: 'solid' },
                    showSymbol: false, silent: true
                },
                {
                    name: '+0.1', type: 'line',
                    data: dates.map(() => 0.1),
                    lineStyle: { width: 1, color: '#ef5350', type: 'dashed' },
                    showSymbol: false, silent: true
                },
                {
                    name: '-0.1', type: 'line',
                    data: dates.map(() => -0.1),
                    lineStyle: { width: 1, color: '#26a69a', type: 'dashed' },
                    showSymbol: false, silent: true
                }
            ],
            legend: {
                data: ['CMF', '零轴', '+0.1', '-0.1'],
                textStyle: { color: '#ffffff' },
                type: 'scroll', orient: 'horizontal', left: 'left', top: 0,
                itemWidth: 70, itemHeight: 20,
                pageIconColor: '#4f7eff', pageTextStyle: { color: '#ffffff' }
            },
            grid,
            dataZoom
        };
    }

    _sevenSwordsOption(res, dates, grid, xAxis, dataZoom) {
        const { swords, total } = res;

        // 多头(绿色上箭头) / 空头(红色下箭头) 散点数据
        const bullData = [];  // [dateIdx, swordIdx]
        const bearData = [];
        for (let s = 0; s < swords.length; s++) {
            for (let i = 0; i < dates.length; i++) {
                const v = swords[s].signals[i];
                if (v === 1) bullData.push([i, s]);
                else if (v === -1) bearData.push([i, s]);
            }
        }

        // 强多信号标记（多头数≥5 时在图表上方标记）
        const strongSignalData = [];
        for (let i = 0; i < dates.length; i++) {
            if (total[i] >= 5) {
                strongSignalData.push({ value: [i, -0.5], date: dates[i], signalType: 'sevenSwords' });
            }
        }

        const gridExt = Object.assign({}, grid, {
            left: grid.left + 20,
            top: grid.top + 14,
            bottom: grid.bottom + 6
        });

        return {
            backgroundColor: 'transparent',
            animation: false,
            tooltip: {
                trigger: 'item',
                formatter: function(p) {
                    if (!p || p.dataIndex == null) return '';
                    const idx = p.value ? p.value[0] : p.dataIndex;
                    if (idx == null || idx >= dates.length) return '';
                    let html = '<b>' + dates[idx] + '</b><br/>';
                    const cnt = total[idx] || 0;
                    html += '多头总数：<b style="color:' + (cnt >= 5 ? '#ffd700' : '#9aa9cc') + '">' + cnt + '/7</b><br/>';
                    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 10px;margin-top:4px;font-size:12px;">';
                    for (let s = 0; s < swords.length; s++) {
                        const v = swords[s].signals[idx];
                        let icon, color;
                        if (v === 1) { icon = '▲'; color = '#27ae60'; }
                        else if (v === -1) { icon = '▼'; color = '#e74c3c'; }
                        else { icon = '─'; color = '#5a6070'; }
                        html += '<span style="font-weight:600;">' + swords[s].name + '</span><span style="color:' + color + ';font-weight:600;">' + icon + '</span>';
                    }
                    html += '</div>';
                    return html;
                }
            },
            xAxis,
            yAxis: {
                type: 'category',
                data: swords.map(s => s.name),
                axisLabel: { color: '#bcc9e6', fontSize: 11, fontWeight: 600 },
                axisLine: { show: false },
                axisTick: { show: false },
                splitLine: { lineStyle: { color: '#1e2a40', type: 'dashed' } },
                boundaryGap: true,
                axisPointer: { show: false }
            },
            series: [
                {
                    name: '空头', type: 'scatter',
                    data: bearData,
                    symbol: 'arrow',
                    symbolRotate: 180,
                    symbolSize: 7,
                    itemStyle: { color: '#e74c3c' },
                    z: 2
                },
                {
                    name: '多头', type: 'scatter',
                    data: bullData,
                    symbol: 'arrow',
                    symbolSize: 7,
                    itemStyle: { color: '#27ae60' },
                    z: 3
                },
                ...(strongSignalData.length > 0 ? [
                    {
                        name: '强多(≥5)', type: 'scatter',
                        data: strongSignalData,
                        symbol: 'diamond',
                        symbolSize: 8,
                        itemStyle: { color: '#ffd700', borderColor: '#fff', borderWidth: 1 },
                        z: 10
                    }
                ] : [])
            ],
            legend: {
                data: ['多头', '空头', ...(strongSignalData.length > 0 ? ['强多(≥5)'] : [])],
                textStyle: { color: '#bcc9e6', fontSize: 11 },
                type: 'scroll', orient: 'horizontal', left: 'center', top: 0,
                itemWidth: 12, itemHeight: 12,
                pageIconColor: '#4f7eff', pageTextStyle: { color: '#ffffff' }
            },
            grid: gridExt,
            dataZoom
        };
    }

    _showSevenSwordsLegend(containerId) {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:10000;';
        const panel = document.createElement('div');
        panel.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1a2135;border:1px solid #ffd700;border-radius:12px;padding:20px;min-width:320px;color:#fff;z-index:10001;font:14px/1.5 "Microsoft YaHei",sans-serif;';

        const swords = [
            { name: '量能(VOL)', color: '#00bcd4', rule: 'MA5 > MA10 为多头' },
            { name: 'CCI', color: '#ff9800', rule: 'CCI < -100 超卖(多), > +100 超买(空)' },
            { name: 'MACD', color: '#4caf50', rule: 'DIF > DEA 金叉多头' },
            { name: 'SAR', color: '#2196f3', rule: '收盘价 > SAR 上升趋势' },
            { name: 'RSI', color: '#e91e63', rule: 'RSI(6) < 30 超卖(多), > 70 超买(空)' },
            { name: 'KDJ', color: '#9c27b0', rule: 'K > D 多头排列' },
            { name: '动能(CJDX)', color: '#ffd700', rule: 'J值上升 动能向上' }
        ];

        let html = '<div style="font-size:16px;font-weight:600;margin-bottom:12px;border-bottom:1px solid #2a314a;padding-bottom:8px;">⚔ 七脉神剑 指标说明</div>';
        html += '<div style="font-size:11px;color:#9aa9cc;margin-bottom:12px;">■ 绿色 = 多头信号 &nbsp; ■ 红色 = 空头信号 &nbsp; 灰色 = 中性</div>';
        html += '<div style="display:flex;flex-direction:column;gap:6px;">';
        swords.forEach(s => {
            html += '<div style="display:flex;align-items:center;gap:8px;font-size:12px;">' +
                '<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + s.color + ';"></span>' +
                '<b>' + s.name + '</b>' +
                '<span style="color:#9aa9cc;">' + s.rule + '</span>' +
                '</div>';
        });
        html += '</div>';
        html += '<div style="margin-top:12px;font-size:11px;color:#ffd700;border-top:1px solid #2a314a;padding-top:8px;">▲ 多头数 ≥ 5 时标记强多信号</div>';
        html += '<div style="display:flex;justify-content:flex-end;margin-top:12px;">' +
            '<button id="ss_close" style="background:transparent;border:1px solid #9aa9cc;color:#9aa9cc;padding:6px 16px;border-radius:4px;cursor:pointer;">关闭</button>' +
            '</div>';

        panel.innerHTML = html;
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        const closeBtn = panel.querySelector('#ss_close');
        const close = () => overlay.remove();
        closeBtn.onclick = close;
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
    }

}

// 内部 SMA 辅助
function sma(data, period) {
    const result = new Array(data.length).fill(null);
    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) sum += data[i - j];
        result[i] = parseFloat((sum / period).toFixed(0));
    }
    return result;
}
