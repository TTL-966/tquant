window._lastBacktestResult = null;
var buyPoints = [];
var sellPoints = [];
var currentStockCode = '000001';

import { stockNameMap, tradeStockLibrary, backtestStrategies, dailyHoldings, fetchStockName, searchStockSuggestions } from './stockData.js';
import { formatStockDisplayHtml, renderStockKline, drawDetailCurve } from './chartRenderer.js';
import { initDatePicker } from './datepicker.js';
import { bridge, updateBridgeStatus } from './bridge.js';
import { renderProfile } from './profile.js';
import { loadPage as originalLoadPage, navigateToKline } from './navigation.js';
import { debounceSuggestions } from './suggestions.js';

// ---- 股票名称显示辅助（纯名称）----
export function formatStockNameOnly(code) {
    return stockNameMap[code] || code;
}

function formatStockDisplay(code) {
    return stockNameMap[code] ? stockNameMap[code] + '(' + code + ')' : code;
}

// ---- 填充买卖点成交图下拉框 ----
export function populateStockSelector(selectId, stocks) {
    var sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = '';
    var seen = {};
    stocks.forEach(function(c) {
        if (!seen[c]) {
            seen[c] = true;
            var opt = document.createElement('option');
            opt.value = c;
            opt.textContent = formatStockNameOnly(c);
            sel.appendChild(opt);
        }
    });
    if (sel.options.length === 0) {
        var opt = document.createElement('option');
        opt.value = '000001';
        opt.textContent = formatStockNameOnly('000001');
        sel.appendChild(opt);
    }
}

// ---- 填充买卖点成交图 datalist（新的 input+datalist 方案） ----
export function populateStockDatalist(datalistId, stocks) {
    var dl = document.getElementById(datalistId);
    if (!dl) return;
    dl.innerHTML = '';
    var seen = {};
    stocks.forEach(function(c) {
        if (!seen[c]) {
            seen[c] = true;
            var opt = document.createElement('option');
            opt.value = c;
            opt.label = formatStockNameOnly(c);
            dl.appendChild(opt);
        }
    });
    if (dl.options.length === 0) {
        var opt = document.createElement('option');
        opt.value = '000001';
        opt.label = formatStockNameOnly('000001');
        dl.appendChild(opt);
    }
}

// ---- 辅助函数 ----
var mockTradeSignals = [
    { date: '2026-01-05', code: '000001', type: 'buy', price: 12.35, shares: 800 },
    { date: '2026-01-12', code: '000001', type: 'sell', price: 13.68, shares: 800 },
    { date: '2026-01-20', code: '000001', type: 'buy', price: 13.20, shares: 1000 },
    { date: '2026-02-01', code: '000001', type: 'sell', price: 14.55, shares: 1000 },
    { date: '2026-02-14', code: '000858', type: 'buy', price: 158.2, shares: 200 },
    { date: '2026-02-28', code: '000858', type: 'sell', price: 172.3, shares: 200 },
    { date: '2026-03-10', code: '300750', type: 'buy', price: 185.6, shares: 100 },
    { date: '2026-03-25', code: '300750', type: 'sell', price: 210.8, shares: 100 }
];

var currentTradeSignals = mockTradeSignals.slice();

export function profitClass(str) {
    if (!str || typeof str !== 'string') return '';
    if (str.startsWith('+')) return 'profit-positive';
    if (str.startsWith('-')) return 'profit-negative';
    return '';
}

export function escapeHtml(str) {
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

export function loadAvatarPreview() {
    var saved = localStorage.getItem('user_avatar');
    if (saved) { return '<img src="' + saved + '" alt="头像预览">'; }
    return '📷';
}

export function saveAvatarToStorage(dataUrl) {
    localStorage.setItem('user_avatar', dataUrl);
    var icon = document.getElementById('navAvatarIcon');
    if (icon) icon.innerHTML = '<img src="' + dataUrl + '" alt="头像">';
}

// ---- 窗口 resize 自适应图表 ----
(function() {
    var resizeTimer = null;
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function() {
            var chartDom = document.getElementById('stockKlineChart');
            if (chartDom) {
                var instance = echarts.getInstanceByDom(chartDom);
                if (instance) instance.resize();
            }
            var mainDom = document.getElementById('klineMainChart');
            if (mainDom) {
                var mainInstance = echarts.getInstanceByDom(mainDom);
                if (mainInstance) mainInstance.resize();
            }
        }, 500);
    });
})();

// ========== 自定义 loadPage 包装（直接委托给 navigation.js） ==========

function loadPage(pageId) {
    originalLoadPage(pageId);
}

// ---- 策略详情页渲染 ----
function renderDetailPage() {
    var container = document.getElementById('detailContent');
    if (!container) {
        container = document.getElementById('dynamicContent');
        if (!container) return;
    }
    var result = window._lastBacktestResult;
    if (!result) {
        // 使用默认模拟示例
        result = {
            equityCurve: {
                dates: ['2026-01-01','2026-01-08','2026-01-15','2026-01-22','2026-01-29'],
                values: [1000000, 1023500, 1018000, 1052000, 1089000]
            },
            signals: [
                { date: '2026-01-05', code: '000001', type: 'buy', price: 12.35, shares: 800 },
                { date: '2026-01-12', code: '000001', type: 'sell', price: 13.68, shares: 800 }
            ],
            metrics: {
                winRate: '66.7%',
                annualReturn: '18.5%',
                maxDrawdown: '-8.2%',
                sharpeRatio: '1.35'
            }
        };
    }
    container.innerHTML = '';
    // 曲线图
    var chartDiv = document.createElement('div');
    chartDiv.id = 'detailCurveChart';
    chartDiv.style.height = '300px';
    chartDiv.style.width = '100%';
    container.appendChild(chartDiv);
    drawDetailCurve(result.equityCurve);
    // 绩效指标表格
    var metrics = result.metrics || {};
    var metricsTable = document.createElement('table');
    metricsTable.className = 'metrics-table';
    var metricRow = function(label, value) {
        var tr = document.createElement('tr');
        tr.innerHTML = '<td>' + label + '</td><td>' + (value || '--') + '</td>';
        return tr;
    };
    metricsTable.appendChild(metricRow('胜率', metrics.winRate));
    metricsTable.appendChild(metricRow('年化收益率', metrics.annualReturn));
    metricsTable.appendChild(metricRow('最大回撤', metrics.maxDrawdown));
    metricsTable.appendChild(metricRow('夏普比率', metrics.sharpeRatio));
    container.appendChild(metricsTable);
    // 信号表格
    var signalTitle = document.createElement('h3');
    signalTitle.textContent = '交易信号列表';
    container.appendChild(signalTitle);
    var signalTable = document.createElement('table');
    signalTable.className = 'signal-table';
    signalTable.innerHTML = '<thead><tr><th>日期</th><th>股票</th><th>类型</th><th>价格</th><th>数量</th></tr></thead><tbody></tbody>';
    var tbody = signalTable.querySelector('tbody');
    var signals = result.signals || [];
    signals.forEach(function(sig) {
        var tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', function() {
            navigateToKline(sig.code);
        });
        tr.innerHTML = '<td>' + sig.date + '</td>' +
            '<td>' + formatStockNameOnly(sig.code) + '</td>' +
            '<td>' + (sig.type === 'buy' ? '买入' : '卖出') + '</td>' +
            '<td>' + sig.price.toFixed(2) + '</td>' +
            '<td>' + sig.shares + '</td>';
        tbody.appendChild(tr);
    });
    container.appendChild(signalTable);
}

// ---- 策略页面增强 ----
function enhanceStrategyPage() {
    var strategyContainer = document.getElementById('strategyPage');
    if (!strategyContainer) {
        strategyContainer = document.getElementById('dynamicContent');
        if (!strategyContainer) return;
    }
    // 查找代码编辑器（假定 id="strategyCodeEditor"）
    var editor = document.getElementById('strategyCodeEditor');
    if (!editor) return;
    // 向上查找父容器，用于插入股票代码输入框
    var parent = editor.parentElement;
    if (!parent) return;
    // 检查是否已经添加过输入框
    if (document.getElementById('strategyStockInput')) return;
    // 创建输入框
    var inputGroup = document.createElement('div');
    inputGroup.style.marginBottom = '8px';
    inputGroup.innerHTML = '<label>股票代码：</label><input type="text" id="strategyStockInput" list="stockListKline" value="' + currentStockCode + '">';
    parent.insertBefore(inputGroup, editor);
    // 聚焦行为
    var stockInput = document.getElementById('strategyStockInput');
    stockInput.addEventListener('focus', function() {
        this.value = '';
    });
    stockInput.addEventListener('blur', function() {
        if (this.value === '') {
            this.value = currentStockCode;
        } else {
            currentStockCode = this.value;
        }
    });
    // 找到运行按钮（假定 id="runBacktestBtn"）
    var runBtn = document.getElementById('runBacktestBtn');
    if (runBtn) {
        // 移除旧的事件（用新的替代）
        var newBtn = runBtn.cloneNode(true);
        runBtn.parentNode.replaceChild(newBtn, runBtn);
        newBtn.addEventListener('click', function(e) {
            e.preventDefault();
            // 获取参数
            var stockCode = document.getElementById('strategyStockInput').value.trim() || currentStockCode;
            var strategyCode = editor.value;
            if (!stockCode) {
                alert('请输入股票代码');
                return;
            }
            if (!strategyCode) {
                alert('请输入策略代码');
                return;
            }
            // 显示日志
            var logArea = document.getElementById('strategyLog');
            if (logArea) logArea.textContent = '回测运行中...';
            // 模拟后端调用（实际应替换为真实API）
            runBacktest(stockCode, strategyCode).then(function(res) {
                window._lastBacktestResult = res;
                // 更新买卖点全局变量
                buyPoints = (res.signals || []).filter(function(s) { return s.type === 'buy'; });
                sellPoints = (res.signals || []).filter(function(s) { return s.type === 'sell'; });
                currentStockCode = stockCode;
                if (logArea) logArea.textContent = '回测完成，请前往【策略详情】查看结果';
            }).catch(function(err) {
                if (logArea) logArea.textContent = '回测失败: ' + err.message;
            });
        });
    }
}

// ---- 模拟后端回测接口（应替换为真实API） ----
function runBacktest(stockCode, strategyCode) {
    return new Promise(function(resolve, reject) {
        setTimeout(function() {
            // 模拟返回数据，生产环境替换为 fetch
            var mockResult = {
                equityCurve: {
                    dates: ['2026-01-01','2026-01-08','2026-01-15','2026-01-22','2026-01-29'],
                    values: [1000000, 1023500, 1018000, 1052000, 1089000]
                },
                signals: [
                    { date: '2026-01-05', code: stockCode, type: 'buy', price: 12.35, shares: 800 },
                    { date: '2026-01-12', code: stockCode, type: 'sell', price: 13.68, shares: 800 }
                ],
                metrics: {
                    winRate: '66.7%',
                    annualReturn: '18.5%',
                    maxDrawdown: '-8.2%',
                    sharpeRatio: '1.35'
                }
            };
            resolve(mockResult);
        }, 500);
    });
}

// ---- 首次加载及导航绑定 ----
document.addEventListener('DOMContentLoaded', function() {
    initDatePicker();
    var saved = localStorage.getItem('user_avatar');
    if (saved) {
        var icon = document.getElementById('navAvatarIcon');
        if (icon) icon.innerHTML = '<img src="' + saved + '" alt="头像">';
    }
    document.querySelectorAll('.nav-item').forEach(function(item) {
        item.addEventListener('click', function(e) {
            var pageId = item.getAttribute('data-page');
            loadPage(pageId);
        });
    });
    loadPage('history');

    // ---- 全屏切换 ----
    var fullscreenBtn = document.getElementById('fullscreenBtn');
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', function() {
            var elem = document.querySelector('.app-window');
            if (!document.fullscreenElement && !document.webkitFullscreenElement) {
                if (elem.requestFullscreen) {
                    elem.requestFullscreen().catch(function(err) {
                        console.error('全屏请求失败:', err.message);
                    });
                } else if (elem.webkitRequestFullscreen) {
                    elem.webkitRequestFullscreen();
                }
            } else {
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                } else if (document.webkitExitFullscreen) {
                    document.webkitExitFullscreen();
                }
            }
        });
    }

    // 监听全屏变化，调整样式并触发图表 resize
    function onFullscreenChange() {
        var appWindow = document.querySelector('.app-window');
        var isFull = !!(document.fullscreenElement || document.webkitFullscreenElement);
        if (appWindow) {
            if (isFull) {
                appWindow.classList.add('fullscreen-mode');
            } else {
                appWindow.classList.remove('fullscreen-mode');
            }
        }
        // 延迟触发 resize，等待布局更新
        setTimeout(function() {
            window.dispatchEvent(new Event('resize'));
        }, 100);
    }
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
});
