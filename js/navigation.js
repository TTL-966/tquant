import { bridge } from './bridge.js';
import { fetchAndRenderKline, runBacktest, buyPoints, sellPoints, autoRunBacktest, autoBacktestScheduled, runCustomBacktest } from './kline.js';
import { renderProfile } from './profile.js';
import { renderStockKline, drawDetailCurve, formatStockDisplayHtml, drawEquityCurve } from './chartRenderer.js';
import { initDatePicker, bindDatePicker } from './datepicker.js';
import { stockNameMap, tradeStockLibrary, backtestStrategies, dailyHoldings, fetchStockName, searchStockSuggestions } from './stockData.js';
import { debounceSuggestions } from './suggestions.js';
import { formatStockNameOnly, populateStockDatalist, profitClass, escapeHtml, loadAvatarPreview, saveAvatarToStorage } from './main.js';
import { renderStrategyPage } from './strategy.js';

var currentStockCode = "000001";

// ---- 新增行业浮层函数 ----
function showIndustryPopup(jsonStr, industry) {
    var data = JSON.parse(jsonStr);
    if (!Array.isArray(data) || data.length === 0) {
        return;
    }
    // 遮罩
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:1999;';
    overlay.onclick = function() {
        overlay.remove();
        content.remove();
    };
    // 内容框
    var content = document.createElement('div');
    content.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); background:#1a2135; border:1px solid #4f7eff; border-radius:12px; padding:10px; z-index:2500; max-height:300px; overflow-y:auto; min-width:300px;';
    var title = document.createElement('div');
    title.style.cssText = 'margin-bottom:10px; color:#fff; font-weight:600;';
    title.textContent = '同行业股票 - ' + industry;
    content.appendChild(title);
    data.forEach(function(item) {
        var row = document.createElement('div');
        row.style.cssText = 'padding:6px; margin:4px 0; background:#0e1220; border-radius:6px; cursor:pointer; color:#fff;';
        row.textContent = item.name + ' (' + item.code + ')';
        row.onclick = function(e) {
            e.stopPropagation();
            var codeInput = document.getElementById('stockCodeInput');
            if (codeInput) codeInput.value = item.code;
            if (window._loadStockRef) window._loadStockRef(item.code);
            overlay.remove();
            content.remove();
        };
        content.appendChild(row);
    });
    document.body.appendChild(overlay);
    document.body.appendChild(content);
}

function calcMAHelper(values, period) {
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

export function loadPage(pageId) {
    var container = document.getElementById('dynamicContent');
    if (pageId === 'profile') { renderProfile(); } else if (pageId === 'kchart') {
        container.innerHTML = `
                <div class="card">
                    <div class="card-title">📈 买卖点成交图 (策略回测生成买卖点)</div>
                    <div id="currentStrategyDisplay" style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                        <span style="color:#9aa9cc;">📋 当前回测策略：</span>
                        <span id="currentStrategyName" style="color:#ffffff; font-weight:600;">无</span>
                    </div>
                    <div class="legend-sign"><span><i class="buy-point"></i> 买入 (B)</span><span><i class="sell-point"></i> 卖出 (S)</span></div>
                    <div class="metric-row">
                        <span>当前股票:</span>
                        <input type="text" id="stockSelectorKline" list="stockListKline" placeholder="输入或选择股票" style="width:130px;">
                        <datalist id="stockListKline"></datalist>
                        <span>起始日期:</span>
                        <input type="text" class="datepicker-input" id="startDateInput" value="2010-01-01" readonly>
                        <span>结束日期:</span>
                        <input type="text" class="datepicker-input" id="endDateInput" value="" readonly>
                        <button id="loadStrategySignalsBtn">📊 加载策略信号</button>
                        <button id="gotoStrategyBtn">📝 跳转到策略页</button>
                        <button id="refreshKlineBtn">刷新K线</button>
                    </div>
                    <div id="klineMainChart" class="kline-container"></div>
                    <p style="margin-top:12px; color:#ffffff;">点击“加载策略信号”将从最近一次策略回测结果中提取买卖点并显示</p>
                </div>`;
        setTimeout(function() {
            var today = new Date().toISOString().slice(0, 10);
            var endDateInput = document.getElementById('endDateInput');
            if (endDateInput && !endDateInput.value) {
                endDateInput.value = today;
            }
            var startDateInput = document.getElementById('startDateInput');
            bindDatePicker(startDateInput);
            bindDatePicker(endDateInput);

            // 更新策略名称显示
            var nameSpan = document.getElementById('currentStrategyName');
            if (nameSpan) {
                nameSpan.innerText = window.currentStrategyName || '无';
            }

            // 按成交数量（shares）降序排序，去重取前6
            var sorted = tradeStockLibrary.slice().sort(function(a,b) { return b.shares - a.shares; });
            var topCodes = [];
            var seen = {};
            sorted.forEach(function(t) {
                if (!seen[t.code]) {
                    seen[t.code] = true;
                    topCodes.push(t.code);
                }
            });
            var top6 = topCodes.slice(0,6);
            populateStockDatalist('stockListKline', top6);
            var selInput = document.getElementById('stockSelectorKline');
            if (selInput) {
                // 设置初始值显示名称，并记录代码
                selInput.value = formatStockNameOnly(currentStockCode);
                selInput.setAttribute('data-current-code', currentStockCode);

                // 输入事件：不做主动替换，但为了兼容，依然保留空函数
                selInput.addEventListener('input', function() {
                    // 不做任何操作
                });

                // change 事件：从 datalist 中获取代码，并显示名称
                selInput.addEventListener('change', function() {
                    var code = this.value;
                    var dl = document.getElementById('stockListKline');
                    if (dl) {
                        for (var i = 0; i < dl.options.length; i++) {
                            if (dl.options[i].label === this.value || dl.options[i].value === this.value) {
                                code = dl.options[i].value;
                                break;
                            }
                        }
                    }
                    currentStockCode = code;
                    this.setAttribute('data-current-code', code);
                    // 保证输入框显示名称
                    var displayName = formatStockNameOnly(code);
                    if (this.value !== displayName) this.value = displayName;
                    buyPoints.length = 0;
                    sellPoints.length = 0;
                    fetchAndRenderKline(currentStockCode, startDateInput.value, endDateInput.value);
                });

                // focus 事件：输入框获得焦点时清空值，让 datalist 显示所有选项
                selInput.addEventListener('focus', function() {
                    this.value = '';
                });

                // blur 事件：失去焦点且用户未选择时恢复显示当前股票名称
                selInput.addEventListener('blur', function() {
                    if (this.value.trim() === '') {
                        this.value = formatStockNameOnly(currentStockCode);
                        this.setAttribute('data-current-code', currentStockCode);
                    }
                });
            }
            var refreshBtn = document.getElementById('refreshKlineBtn');
            if (refreshBtn) refreshBtn.onclick = function() {
                fetchAndRenderKline(currentStockCode, startDateInput.value, endDateInput.value);
            };

            // 加载策略信号按钮
            var loadSignalBtn = document.getElementById('loadStrategySignalsBtn');
            if (loadSignalBtn) {
                loadSignalBtn.addEventListener('click', function() {
                    var sigs = window.strategySignals;
                    if (!sigs) {
                        addLog('warn', '请先在策略页运行回测');
                        return;
                    }
                    var code = currentStockCode;
                    // 匹配多种后缀
                    var candidates = [code, code + '.SZ', code + '.SH', code + '.BJ'];
                    var matched = sigs.filter(function(s) {
                        return candidates.indexOf(s.code) !== -1;
                    });
                    buyPoints.length = 0;
                    sellPoints.length = 0;
                    matched.forEach(function(s) {
                        if (s.type === 'buy') {
                            buyPoints.push({ date: s.date, code: code, price: s.price, shares: s.shares });
                        } else {
                            sellPoints.push({ date: s.date, code: code, price: s.price, shares: s.shares });
                        }
                    });
                    if (currentKlineDates.length > 0) {
                        var maData = {
                            dates: currentKlineDates,
                            ma5: calcMAHelper(currentKlineValues, 5),
                            ma10: calcMAHelper(currentKlineValues, 10),
                            ma20: calcMAHelper(currentKlineValues, 20),
                            ma30: calcMAHelper(currentKlineValues, 30)
                        };
                        renderKlineWithSignals(currentKlineDates, currentKlineValues, buyPoints, sellPoints, maData);
                    } else {
                        fetchAndRenderKline(code, startDateInput.value, endDateInput.value);
                    }
                });
            }

            // 跳转到策略页按钮
            var gotoBtn = document.getElementById('gotoStrategyBtn');
            if (gotoBtn) {
                gotoBtn.onclick = function() {
                    document.querySelector('.nav-item[data-page="strategy"]').click();
                };
            }

            buyPoints.length = 0;
            sellPoints.length = 0;
            var startDate = startDateInput.value;
            var endDate = endDateInput.value;
            setTimeout(function() {
                fetchAndRenderKline(currentStockCode, startDate, endDate);
            }, 200);
        }, 50);
    } else if (pageId === 'stock') {
        // 个股详情页代码保持不变
        // ... (与之前相同)
    } else if (pageId === 'history') {
        // 历史记录页代码保持不变
        // ... (与之前相同)
    } else if (pageId === 'strategy') {
        container.innerHTML = '';
        renderStrategyPage(container);
    } else if (pageId === 'detail') {
        // ---------- 动态回测结果展示 ----------
        var result = window._lastBacktestResult;
        if (result && result.success) {
            renderBacktestDetail(container, result);
        } else {
            renderStaticDetail(container);
        }
    } else if (pageId === 'daily') {
        // 每日持仓页代码保持不变
        // ... (与之前相同)
    } else if (pageId === 'api') {
        // API文档页代码保持不变
        // ... (与之前相同)
    } else if (pageId === 'settings') {
        // 设置页代码保持不变
        // ... (与之前相同)
    }
    document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
    var target = document.querySelector('.nav-item[data-page="' + pageId + '"]');
    if (target) target.classList.add('active');
}

export function navigateToKline(code) {
    currentStockCode = code;
    autoRunBacktest = true;
    document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
    var target = document.querySelector('.nav-item[data-page="kchart"]');
    if (target) target.classList.add('active');
    loadPage('kchart');
}

/* ========== 内部辅助函数 ========== */

function buildMetricCards(metrics) {
    var arr = [];
    function add(label, display, cls) {
        arr.push(`<div class="metric-tag ${cls||''}">${label}: ${display}</div>`);
    }
    var tr = metrics.total_return;
    add('累计收益率', (tr != null ? tr.toFixed(2)+'%' : 'N/A'), profitClass(tr));
    var ar = metrics.annual_return;
    add('年化收益率', (ar != null ? ar.toFixed(2)+'%' : 'N/A'), profitClass(ar));
    var md = metrics.max_drawdown;
    add('最大回撤', (md != null ? md.toFixed(2)+'%' : 'N/A'), profitClass(md));
    var sr = metrics.sharpe_ratio;
    add('夏普比率', (sr != null ? sr.toFixed(2) : 'N/A'));
    var wr = metrics.win_rate;
    if (wr != null) {
        add('胜率', (typeof wr === 'number' ? wr.toFixed(1)+'%' : wr));
    } else {
        add('胜率', 'N/A');
    }
    var tt = metrics.total_trades;
    add('交易次数', (tt != null ? tt : 'N/A'));
    // 新增指标（如果有）
    var av = metrics.annual_volatility;
    if (av != null) {
        add('年化波动率', av.toFixed(2)+'%');
    }
    var ir = metrics.information_ratio;
    if (ir != null) {
        add('信息比率', ir.toFixed(2));
    }
    var mdd_dur = metrics.max_drawdown_duration;
    if (mdd_dur != null) {
        add('最长回撤期', mdd_dur + '天');
    }
    return arr.join('');
}

function buildSignalRows(signals, stockCode) {
    if (!signals || signals.length === 0) {
        return '<tr><td colspan="4">无交易信号</td></tr>';
    }
    return signals.map(function(s) {
        var typeText = s.type === 'buy' ? '买入' : '卖出';
        var code = s.code || stockCode || '';
        return `<tr class="signal-row" data-code="${escapeHtml(code)}" style="cursor:pointer;">
            <td>${escapeHtml(s.date)}</td>
            <td>${typeText}</td>
            <td>${(s.price != null ? s.price.toFixed(2) : '--')}</td>
            <td>${(s.shares != null ? s.shares : '--')}</td>
        </tr>`;
    }).join('');
}

function renderBacktestDetail(container, result) {
    container.innerHTML = `
        <div class="card">
            <div class="card-title">📊 策略回测报告</div>
            <div id="detailCurveContainer" style="height: 280px; width:100%; margin-bottom: 16px;"></div>
            <div id="metricCards" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:16px;">
                ${buildMetricCards(result.metrics || {})}
            </div>
            <div style="margin-top: 20px;">
                <h4 style="color:#ffffff;">📋 交易信号列表</h4>
                <div class="scrollable-table">
                    <table>
                        <thead><tr><th>日期</th><th>类型</th><th>价格</th><th>数量</th></tr></thead>
                        <tbody id="signalTableBody">
                            ${buildSignalRows(result.signals)}
                        </tbody>
                    </table>
                </div>
            </div>
            <button id="clearBacktestResultBtn" style="margin-top:12px;">🗑 清除结果</button>
        </div>`;

    // 绘制收益曲线
    setTimeout(function() {
        drawEquityCurve('detailCurveContainer', result.equity_curve || []);
    }, 50);

    // 绑定信号行点击（修复后缀）
    document.querySelectorAll('#signalTableBody tr').forEach(function(tr) {
        tr.addEventListener('click', function() {
            var code = this.getAttribute('data-code');
            if (code) {
                code = code.includes('.') ? code.split('.')[0] : code;
                navigateToKline(code);
            }
        });
    });

    // 清除结果按钮
    var clearBtn = document.getElementById('clearBacktestResultBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', function() {
            delete window._lastBacktestResult;
            renderStaticDetail(container);
        });
    }
}

function renderStaticDetail(container) {
    // 静态演示数据
    var metrics = {
        winRate: '66.7%',
        annualReturn: '18.5%',
        maxDrawdown: '-8.2%',
        sharpeRatio: '1.35',
        totalTrades: 2
    };
    var signals = [
        { date: '2026-01-05', code: '000001', type: 'buy', price: 12.35, shares: 800 },
        { date: '2026-01-12', code: '000001', type: 'sell', price: 13.68, shares: 800 }
    ];
    var equityCurve = [
        { date: '2026-01-01', value: 1000000 },
        { date: '2026-01-08', value: 1023500 },
        { date: '2026-01-15', value: 1018000 },
        { date: '2026-01-22', value: 1052000 },
        { date: '2026-01-29', value: 1089000 }
    ];

    // 指标标签（静态）
    var tagsHtml = '<span class="metric-tag">策略收益 +23.5%</span>' +
                   '<span class="metric-tag">基准收益 +12.1%</span>' +
                   '<span class="metric-tag">阿尔法 0.18</span>' +
                   '<span class="metric-tag">贝塔 0.92</span>' +
                   '<span class="metric-tag">最大回撤 -8.2%</span>';

    // 信号表格行
    var signalRows = signals.map(function(sig) {
        var typeText = sig.type === 'buy' ? '买入' : '卖出';
        return '<tr class="signal-row" data-code="' + sig.code + '" style="cursor:pointer;">' +
               '<td>' + sig.date + '</td>' +
               '<td>' + typeText + '</td>' +
               '<td>' + (sig.price != null ? sig.price.toFixed(2) : '--') + '</td>' +
               '<td>' + (sig.shares != null ? sig.shares : '--') + '</td></tr>';
    }).join('');

    container.innerHTML = `
        <div class="card">
            <div class="card-title">📊 策略详情</div>
            <div class="metric-row">${tagsHtml}</div>
            <div id="detailCurveContainer" style="height: 240px; width:100%; margin-bottom: 24px;"></div>
            <div style="margin-top: 20px;">
                <h4 style="color:#ffffff;">📋 交易信号列表</h4>
                <div class="scrollable-table">
                    <table>
                        <thead><tr><th>日期</th><th>类型</th><th>价格</th><th>数量</th></tr></thead>
                        <tbody>${signalRows}</tbody>
                    </table>
                </div>
            </div>
            <button id="gotoKlineBtn" style="margin-top: 16px;">🔍 查看买卖点成交图(K线)</button>
        </div>`;

    setTimeout(function() {
        // 绘制收益曲线
        var chartDom = document.getElementById('detailCurveContainer');
        if (chartDom && equityCurve.length > 0 && typeof echarts !== 'undefined') {
            var myChart = echarts.init(chartDom);
            var option = {
                tooltip: { trigger: 'axis' },
                xAxis: {
                    type: 'category',
                    data: equityCurve.map(function(e) { return e.date; }),
                    axisLabel: { color: '#9aa9cc' }
                },
                yAxis: {
                    type: 'value',
                    name: '账户价值(元)',
                    axisLabel: { color: '#9aa9cc' }
                },
                series: [{
                    type: 'line',
                    data: equityCurve.map(function(e) { return e.value; }),
                    smooth: true,
                    lineStyle: { color: '#4f7eff' },
                    areaStyle: { color: 'rgba(79,126,255,0.2)' }
                }]
            };
            myChart.setOption(option);
        }

        // 绑定信号行点击事件（修复后缀）
        document.querySelectorAll('.signal-row').forEach(function(tr) {
            tr.addEventListener('click', function() {
                var code = this.getAttribute('data-code');
                if (code) {
                    code = code.includes('.') ? code.split('.')[0] : code;
                    navigateToKline(code);
                }
            });
        });

        // 绑定“查看买卖点成交图”按钮
        var gotoBtn = document.getElementById('gotoKlineBtn');
        if (gotoBtn) {
            gotoBtn.onclick = function() {
                document.querySelector('.nav-item[data-page="kchart"]').click();
            };
        }
    }, 50);
}
