import { stockNameMap, tradeStockLibrary, backtestStrategies, dailyHoldings, fetchStockName, searchStockSuggestions } from './stockData.js';
import { formatStockDisplayHtml, renderStockKline, drawDetailCurve } from './chartRenderer.js';
import { initDatePicker } from './datepicker.js';
import { bridge, updateBridgeStatus } from './bridge.js';
import { renderProfile } from './profile.js';
import { loadPage, navigateToKline } from './navigation.js';
import { debounceSuggestions } from './suggestions.js';

// ---- 股票名称显示辅助（纯名称）----
export function formatStockNameOnly(code) {
    return stockNameMap[code] || code;
}

function formatStockDisplay(code) {
    return stockNameMap[code] ? stockNameMap[code] + '(' + code + ')' : code;
}

// ---- 填充买卖点成交图下拉框 ----
function populateStockSelector(selectorId, stocks) {
    var sel = document.getElementById(selectorId);
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
    if (!str) return '';
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
});
