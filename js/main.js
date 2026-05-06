// js/main.js
// js/main.js
import { stockNameMap, tradeStockLibrary, backtestStrategies, dailyHoldings, fetchStockName, searchStockSuggestions } from './stockData.js';
import { renderKlineWithSignals, renderStockKline, drawDetailCurve, formatStockDisplayHtml } from './chartRenderer.js';
import { initDatePicker, bindDatePicker } from './datepicker.js';

// ---- 辅助函数：计算均线 ----
function calcMA(values, period) {
    var ma = [];
    for (var i = 0; i < values.length; i++) {
        if (i < period - 1) {
            ma.push(0);
            continue;
        }
        var sum = 0;
        for (var j = 0; j < period; j++) {
            sum += values[i - j][1]; // close 价格
        }
        ma.push(parseFloat((sum / period).toFixed(2)));
    }
    return ma;
}

// ---- Bridge 状态指示器更新 ----
function updateBridgeStatus(text, color) {
    var el = document.getElementById('bridgeStatus');
    if (el) {
        el.innerHTML = text;
        el.style.color = color || '#ffffff';
    }
}

// ---- 全局变量 & 通信日志 ----
var bridge = null;
var klineChart = null;
var stockChart = null;
var currentStockCode = "000001";
var buyPoints = [];
var sellPoints = [];
var bridgeReady = false;
var pendingCallbacks = [];
var autoRunBacktest = false;
var autoBacktestScheduled = false;

// ---- 股票名称显示辅助（纯名称）----
function formatStockNameOnly(code) {
    return stockNameMap[code] || code;
}

function formatStockDisplay(code) {
    return stockNameMap[code] ? stockNameMap[code] + '(' + code + ')' : code;
}

function log(msg) {
    console.log("[Tquant]", msg);
}

function onBridgeReady(callback) {
    if (bridgeReady && callback) {
        callback();
    } else if (callback) {
        pendingCallbacks.push(callback);
    }
}

// ---- 建立 QWebChannel ----
document.addEventListener("DOMContentLoaded", function() {
    if (typeof QWebChannel !== 'undefined' && typeof qt !== 'undefined' && qt.webChannelTransport) {
        new QWebChannel(qt.webChannelTransport, function(channel) {
            bridge = channel.objects.bridge;
            bridgeReady = true;
            log("QWebChannel 已建立，bridge.ping = " + typeof bridge.ping);
            updateBridgeStatus("🔌 Bridge: 已连接", "#4caf50");
            pendingCallbacks.forEach(function(cb) { cb(); });
            pendingCallbacks = [];

            if (typeof bridge.ping === 'function') {
                bridge.ping().then(function(reply) {
                    log("ping 响应: " + reply);
                }).catch(function(err) {
                    log("ping 失败: " + err);
                });
            }

            // 初始化股票名称映射
            if (typeof bridge.get_traded_stocks === 'function') {
                bridge.get_traded_stocks().then(function(jsonStr) {
                    var data = JSON.parse(jsonStr);
                    var stocks = data.stocks || [];
                    stocks.forEach(function(s) {
                        var display = s.display || '';
                        var match = display.match(/^(.+?)\((\d+)\)$/);
                        if (match) {
                            var name = match[1];
                            var code = match[2];
                            stockNameMap[code] = name;
                        } else {
                            stockNameMap[s.code] = s.code;
                        }
                    });
                    log("股票名称映射已加载，共 " + Object.keys(stockNameMap).length + " 只");
                }).catch(function(err) {
                    console.warn("获取股票列表失败，可能无法显示名称", err);
                });
            }
        });
    } else {
        log("QWebChannel 环境不可用（qt.webChannelTransport 未定义），使用模拟数据。");
        updateBridgeStatus("🔌 Bridge: 离线模拟", "#ff9800");
    }
});

// ---- 跳转函数 ----
export function navigateToKline(code) {
    currentStockCode = code;
    autoRunBacktest = true;
    document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
    var target = document.querySelector('.nav-item[data-page="kchart"]');
    if (target) target.classList.add('active');
    loadPage('kchart');
}

// ---- K线数据获取与渲染（含买卖点），支持日期范围 ----
function fetchAndRenderKline(code, startDate, endDate) {
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

        // ---- 异步计算（含采样）避免卡顿 ----
        setTimeout(function() {
            // 采样函数
            function sampleArray(arr, step) {
                var res = [];
                for (var i = 0; i < arr.length; i += step) {
                    res.push(arr[i]);
                }
                return res;
            }
            var MAX_POINTS = 500;
            var step = (data.dates.length > MAX_POINTS) ? Math.ceil(data.dates.length / MAX_POINTS) : 1;
            // 如果数据被采样，清空买卖点（避免索引错乱）
            if (step > 1) {
                buyPoints = [];
                sellPoints = [];
            }
            var sampledDates = sampleArray(data.dates, step);
            var sampledValues = sampleArray(data.values, step);

            // 基于原始 data.values 计算均线（全量）
            var ma5 = calcMA(data.values, 5);
            var ma10 = calcMA(data.values, 10);
            var ma20 = calcMA(data.values, 20);
            var ma30 = calcMA(data.values, 30);

            // 采样均线
            var ma5_sampled = sampleArray(ma5, step);
            var ma10_sampled = sampleArray(ma10, step);
            var ma20_sampled = sampleArray(ma20, step);
            var ma30_sampled = sampleArray(ma30, step);

            var maData_sampled = {
                dates: sampledDates,
                ma5: ma5_sampled,
                ma10: ma10_sampled,
                ma20: ma20_sampled,
                ma30: ma30_sampled
            };

            renderKlineWithSignals(sampledDates, sampledValues, buyPoints, sellPoints, maData_sampled);

            if (autoBacktestScheduled) {
                autoBacktestScheduled = false;
                runBacktest(code, startDate, endDate);
            }
        }, 10);
    }).catch(function(err) {
        log("请求失败: " + err);
        var container = document.getElementById('klineMainChart');
        if (container) {
            container.innerHTML = '<div style="color:#ff6b6b;padding:20px;">请求失败: ' + err + '</div>';
        }
    });
}

var currentKlineDates = [];
var currentKlineValues = [];

// ---- 运行回测（支持日期范围）----
function runBacktest(code, startDate, endDate) {
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

// ---- 个人中心页面 ----
function renderProfile() {
    if (bridge) {
        bridge.get_portfolio().then(function(jsonStr) {
            var data = JSON.parse(jsonStr);
            if (data.error) { log("获取持仓失败: " + data.error);
                useMockProfile(); return; }
            renderProfileWithData(data);
        }).catch(function(err) { log("获取持仓出错: " + err);
            useMockProfile(); });
    } else {
        useMockProfile();
    }
}

function useMockProfile() {
    var mock = {
        cash: 1000000,
        total_assets: 1000000,
        holdings: [
            { code: '000001', shares: 1000, cost: 12.50, price: 13.68, profit: 1180 },
            { code: '000858', shares: 200, cost: 158.20, price: 172.30, profit: 2820 },
            { code: '300750', shares: 100, cost: 185.60, price: 210.80, profit: 2520 }
        ],
        history: [
            { date: '2026-01-05', type: '买入', code: '000001', price: 12.35, shares: 800 },
            { date: '2026-01-20', type: '买入', code: '000001', price: 13.20, shares: 1000 },
            { date: '2026-02-14', type: '买入', code: '000858', price: 158.2, shares: 200 }
        ]
    };
    renderProfileWithData(mock);
}

function renderProfileWithData(data) {
    var container = document.getElementById('dynamicContent');
    var holdingRows = data.holdings.map(function(h) {
        var profitCls = h.profit >= 0 ? 'profit-positive' : 'profit-negative';
        return '<tr><td>' + formatStockDisplayHtml(h.code) + '</td><td>' + h.shares + '</td><td>' + h.cost.toFixed(2) + '</td><td class="' + profitCls + '">' + h.profit.toFixed(2) + '</td></tr>';
    }).join('');
    var tradeRows = data.history.map(function(t) {
        var typeCls = t.type === '买入' ? 'profit-positive' : 'profit-negative';
        return '<tr><td>' + t.date + '</td><td class="' + typeCls + '">' + t.type + '</td><td>' + formatStockDisplayHtml(t.code) + '</td><td>' + t.price.toFixed(2) + '</td><td>' + t.shares + '</td></tr>';
    }).join('');
    var totalReturn = (data.total_assets - 1000000) / 1000000 * 100;
    var returnStr = (totalReturn >= 0 ? '+' : '') + totalReturn.toFixed(2) + '%';
    var returnCls = totalReturn >= 0 ? 'profit-positive' : 'profit-negative';
    var tradeCodes = ['000001', '000858', '300750'];
    container.innerHTML = `
            <div class="card">
                <div class="card-title">📋 当前持仓</div>
                <table><thead><tr><th>股票代码</th><th>持股数</th><th>成本价</th><th>现价</th><th>盈亏</th></tr></thead>
                <tbody>${holdingRows}</tbody></table>
            </div>
            <div class="card">
                <div class="card-title">📜 交易记录</div>
                <table><thead><tr><th>日期</th><th>类型</th><th>代码</th><th>价格</th><th>数量</th></tr></thead>
                <tbody>${tradeRows}</tbody></table>
            </div>
            <div class="card">
                <div class="card-title">💰 账户概况</div>
                <div class="account-cards">
                    <div class="account-card"><div class="label">总资产</div><div class="value">${data.total_assets.toLocaleString()}</div></div>
                    <div class="account-card"><div class="label">可用资金</div><div class="value">${data.cash.toLocaleString()}</div></div>
                    <div class="account-card"><div class="label">总收益率</div><div class="value ${returnCls}" style="font-size:28px;">${returnStr}</div></div>
                </div>
            </div>
            <div class="card">
                <div class="card-title">🛒 模拟交易(输入)</div>
                <div class="trade-input-row">
                    <input type="text" id="tradeStockSelect" list="tradeStockList" placeholder="选择股票" style="width:130px; background:#1e253b; border:1px solid #323d5a; border-radius:30px; color:#ffffff; padding:8px 14px; font-size:13px;">
                    <datalist id="tradeStockList"></datalist>
                    <input type="number" id="tradeShares" placeholder="数量" value="100" min="1" step="1">
                    <input type="number" id="tradePrice" placeholder="价格" value="12.00" step="0.01">
                    <button id="tradeBuyBtn">买入</button>
                    <button id="tradeSellBtn">卖出</button>
                </div>
                <div id="tradeResult" style="margin-top:8px; font-size:13px;"></div>
            </div>
        `;
    // 填充 datalist 并设置默认值
    populateStockDatalist('tradeStockList', tradeCodes);
    document.getElementById('tradeStockSelect').value = tradeCodes[0];

    document.getElementById('tradeBuyBtn').onclick = function() { doTrade('buy'); };
    document.getElementById('tradeSellBtn').onclick = function() { doTrade('sell'); };
}

function doTrade(action) {
    var code = document.getElementById('tradeStockSelect').value;
    var shares = parseInt(document.getElementById('tradeShares').value);
    var price = parseFloat(document.getElementById('tradePrice').value);
    if (!bridge) { document.getElementById('tradeResult').innerText = 'bridge未连接'; return; }
    bridge.execute_trade(code, action, shares, price).then(function(jsonStr) {
        var res = JSON.parse(jsonStr);
        document.getElementById('tradeResult').innerText = res.message;
        renderProfile();
    }).catch(function(err) {
        document.getElementById('tradeResult').innerText = '交易失败: ' + err;
    });
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
function populateStockDatalist(datalistId, stocks) {
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

function profitClass(str) {
    if (!str) return '';
    if (str.startsWith('+')) return 'profit-positive';
    if (str.startsWith('-')) return 'profit-negative';
    return '';
}

function escapeHtml(str) {
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function loadAvatarPreview() {
    var saved = localStorage.getItem('user_avatar');
    if (saved) { return '<img src="' + saved + '" alt="头像预览">'; }
    return '📷';
}

function saveAvatarToStorage(dataUrl) {
    localStorage.setItem('user_avatar', dataUrl);
    var icon = document.getElementById('navAvatarIcon');
    if (icon) icon.innerHTML = '<img src="' + dataUrl + '" alt="头像">';
}

// ---- 搜索建议节流函数 ----
var suggestionTimer = null;

function debounceSuggestions() {
    if (suggestionTimer) clearTimeout(suggestionTimer);
    suggestionTimer = setTimeout(function() {
        var input = document.getElementById('stockCodeInput');
        if (!input) return;
        var keyword = input.value.trim();
        if (keyword === '') {
            var container = document.getElementById('stockSuggestionsContainer');
            if (container) container.innerHTML = '';
            return;
        }
        searchStockSuggestions(keyword, bridge).then(function(list) {
            var container = document.getElementById('stockSuggestionsContainer');
            if (!container) return;
            container.innerHTML = '';
            if (list.length === 0) {
                container.style.display = 'none';
                return;
            }
            container.style.display = 'block';
            list.forEach(function(item) {
                var div = document.createElement('div');
                div.className = 'suggestion-item';
                div.style.cssText = 'padding:6px 12px; cursor:pointer; background:#1a2135; border-bottom:1px solid #2a314a; color:#ffffff;';
                div.innerHTML = formatStockDisplayHtml(item.code) + ' <span style="color:#9aa9cc;">' + item.name + '</span>';
                div.addEventListener('click', function() {
                    input.value = item.code;
                    container.innerHTML = '';
                    container.style.display = 'none';
                    var stockCode = item.code;
                    if (typeof loadStock === 'function') {
                        loadStock();
                    } else {
                        var btn = document.getElementById('stockSearchBtn');
                        if (btn) btn.click();
                    }
                });
                container.appendChild(div);
            });
        });
    }, 300);
}

// ---- 页面导航 ----
function loadPage(pageId) {
    var container = document.getElementById('dynamicContent');
    if (pageId === 'profile') { renderProfile(); } else if (pageId === 'kchart') {
        container.innerHTML = `
                <div class="card">
                    <div class="card-title">📈 买卖点成交图 (策略回测生成买卖点)</div>
                    <div class="legend-sign"><span><i class="buy-point"></i> 买入 (B)</span><span><i class="sell-point"></i> 卖出 (S)</span></div>
                    <div class="metric-row">
                        <span>当前股票:</span>
                        <input type="text" id="stockSelectorKline" list="stockListKline" placeholder="输入或选择股票" style="width:130px;">
                        <datalist id="stockListKline"></datalist>
                        <span>起始日期:</span>
                        <input type="text" class="datepicker-input" id="startDateInput" value="2010-01-01" readonly>
                        <span>结束日期:</span>
                        <input type="text" class="datepicker-input" id="endDateInput" value="" readonly>
                        <button id="runBacktestBtn">▶ 运行回测</button>
                        <button id="refreshKlineBtn">刷新K线</button>
                    </div>
                    <div id="klineMainChart" class="kline-container"></div>
                    <p style="margin-top:12px; color:#ffffff;">买卖点由双均线策略(MA5, MA20)自动生成</p>
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

            // 按成交数量( shares )降序排序，取前6只不同的股票
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
                selInput.value = currentStockCode;
                selInput.addEventListener('change', function() {
                    currentStockCode = this.value;
                    buyPoints = [];
                    sellPoints = [];
                    fetchAndRenderKline(currentStockCode, startDateInput.value, endDateInput.value);
                });
            }
            var runBtn = document.getElementById('runBacktestBtn');
            var refreshBtn = document.getElementById('refreshKlineBtn');
            if (runBtn) runBtn.onclick = function() {
                runBacktest(currentStockCode, startDateInput.value, endDateInput.value);
            };
            if (refreshBtn) refreshBtn.onclick = function() {
                fetchAndRenderKline(currentStockCode, startDateInput.value, endDateInput.value);
            };
            buyPoints = [];
            sellPoints = [];
            var startDate = startDateInput.value;
            var endDate = endDateInput.value;
            autoBacktestScheduled = true;
            autoRunBacktest = false;
            setTimeout(function() {
                fetchAndRenderKline(currentStockCode, startDate, endDate);
            }, 200);
        }, 50);
    } else if (pageId === 'stock') {
        container.innerHTML = `
                <div class="card">
                    <div class="card-title">📉 <span id="mainStockTitle">个股详情</span></div>
                    <div class="stock-search-row" style="position: relative;">
                        <input type="text" id="stockCodeInput" placeholder="股票代码" value="000001" style="background:#1e253b; border:1px solid #323d5a; padding:8px 14px; border-radius:30px; color:#ffffff; width:120px;">
                        <button id="stockSearchBtn">查询K线</button>
                    </div>
                    <div id="stockSuggestionsContainer" style="position: absolute; z-index: 1000; width: 200px; max-height: 200px; overflow-y: auto; background: #1a2135; border:1px solid #2a314a; border-radius: 8px; display: none;"></div>
                    <div id="stockInfoDisplay" style="margin: 12px 0; padding: 8px 16px; background: #1a2135; border-radius: 12px; min-height: 40px;"></div>
                    <div id="stockKlineChart" class="kline-container" style="height:460px;"></div>
                    <div style="margin-top:12px;">
                        <span>支持日K/周K/月K切换，均线M5/M10等，点击股票显示K线图预览。</span>
                    </div>
                </div>`;
        setTimeout(function() {
            var searchBtn = document.getElementById('stockSearchBtn');
            var codeInput = document.getElementById('stockCodeInput');
            var stockInfoDisplay = document.getElementById('stockInfoDisplay');
            var stockSuggestionsContainer = document.getElementById('stockSuggestionsContainer');

            function updateStockInfo(code) {
                if (!code) {
                    stockInfoDisplay.innerHTML = '请输入股票代码查询';
                } else {
                    stockInfoDisplay.innerHTML = formatStockDisplayHtml(code);
                }
                var mainTitle = document.getElementById('mainStockTitle');
                if (mainTitle) {
                    if (!code) {
                        mainTitle.innerHTML = '个股详情';
                    } else {
                        mainTitle.innerHTML = formatStockDisplayHtml(code);
                    }
                }
            }

            function withTimeout(promise, ms) {
                var timeout = new Promise(function(_, reject) {
                    setTimeout(function() {
                        reject(new Error('查询超时，请重试'));
                    }, ms);
                });
                return Promise.race([promise, timeout]);
            }

            function parseKlineData(jsonStr) {
                var data = JSON.parse(jsonStr);
                if (data.error) {
                    return null;
                }
                var dates = [];
                var values = [];
                if (data.dates && data.values && data.values.length > 0) {
                    for (var i = 0; i < data.dates.length; i++) {
                        dates.push(data.dates[i]);
                        var v = data.values[i];
                        if (v && v.length >= 4) {
                            values.push([
                                parseFloat(v[0]) || 0,
                                parseFloat(v[1]) || 0,
                                parseFloat(v[2]) || 0,
                                parseFloat(v[3]) || 0
                            ]);
                        } else {
                            console.warn("无效K线数据点", v);
                        }
                    }
                } else if (data.dates && data.opens && data.closes && data.lows && data.highs) {
                    for (var i = 0; i < data.dates.length; i++) {
                        dates.push(data.dates[i]);
                        values.push([
                            parseFloat(data.opens[i]) || 0,
                            parseFloat(data.closes[i]) || 0,
                            parseFloat(data.lows[i]) || 0,
                            parseFloat(data.highs[i]) || 0
                        ]);
                    }
                }
                if (dates.length > 0 && values.length > 0) {
                    return { dates: dates, values: values };
                }
                return null;
            }

            var loadStock = function() {
                var stockCode = codeInput.value.trim();
                if (stockCode === '') stockCode = '000001';

                updateStockInfo(stockCode);
                stockInfoDisplay.innerHTML = '⏳ 加载中...';

                fetchStockName(stockCode, bridge).then(function() {
                    updateStockInfo(stockCode);
                    if (!bridge) {
                        stockInfoDisplay.innerHTML = '⚠️ Bridge 未连接，无法查询';
                        return;
                    }
                    var callPromise = bridge.get_kline_data(stockCode, "2010-01-01", "2026-12-31");
                    var raced = withTimeout(callPromise, 5000);
                    raced.then(function(jsonStr) {
                        var parsed = parseKlineData(jsonStr);
                        if (parsed) {
                            renderStockKline('stockKlineChart', parsed.dates, parsed.values);
                        } else {
                            stockInfoDisplay.innerHTML = '⚠️ 股票代码不存在或无数据';
                            var container = document.getElementById('stockKlineChart');
                            if (container) {
                                container.innerHTML = '<div style="color:#ff6b6b;">无数据</div>';
                            }
                        }
                    }).catch(function(err) {
                        console.error("获取K线失败或超时:", err);
                        stockInfoDisplay.innerHTML = '⚠️ ' + err.message;
                        var container = document.getElementById('stockKlineChart');
                        if (container) {
                            container.innerHTML = '<div style="color:#ff6b6b;">查询失败</div>';
                        }
                    });
                }).catch(function() {
                    updateStockInfo(stockCode);
                });
            };

            if (searchBtn) searchBtn.onclick = loadStock;
            if (codeInput) {
                codeInput.addEventListener('keypress', function(e) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        loadStock();
                    }
                });
                codeInput.addEventListener('input', debounceSuggestions);
                document.addEventListener('click', function(e) {
                    if (!e.target.closest('#stockSuggestionsContainer') && !e.target.closest('#stockCodeInput')) {
                        if (stockSuggestionsContainer) {
                            stockSuggestionsContainer.innerHTML = '';
                            stockSuggestionsContainer.style.display = 'none';
                        }
                    }
                });
            }
            updateStockInfo('000001');
            setTimeout(loadStock, 100);
        }, 50);
    } else if (pageId === 'history') {
        var listHtml = backtestStrategies.map(function(s) {
            var profitCls = profitClass(s.profit);
            return `
                <div class="backtest-item" data-strategy-id="${s.id}" data-strategy-name="${s.name}" data-strategy-code="${escapeHtml(s.code)}" style="background:#1a2135; border-radius: 16px; padding: 14px; margin-bottom: 12px; cursor:pointer;">
                    <div style="font-weight:600; color:#ffffff;">${s.name}</div>
                    <div style="font-size:12px;" class="${profitCls}">收益 ${s.profit} | 点击加载策略代码并跳转</div>
                </div>`;
        }).join('');
        container.innerHTML = `
                <div class="card">
                    <div class="card-title">📂 历史回测记录</div>
                    <p style="margin-bottom: 16px; color:#ffffff;">保存的回测策略，点击任意策略会跳转到【策略代码】模块并自动填充代码。</p>
                    <div id="historyList">${listHtml}</div>
                    <div style="margin-top: 16px;"><button id="demoBacktestBtn" style="background:#3a4a70;">📌 回测详情演示（策略详情）</button></div>
                </div>`;
        setTimeout(function() {
            document.querySelectorAll('.backtest-item').forEach(function(el) {
                el.onclick = function(e) {
                    var name = el.getAttribute('data-strategy-name');
                    var code = el.getAttribute('data-strategy-code');
                    document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
                    document.querySelector('.nav-item[data-page="strategy"]').classList.add('active');
                    loadPage('strategy');
                    setTimeout(function() {
                        var textarea = document.getElementById('strategyTextArea');
                        if (textarea && code) { textarea.value = decodeURIComponent(code); }
                        var logDiv = document.getElementById('runLogConsole');
                        if (logDiv) logDiv.innerHTML += '<div>✅ 已加载策略: ' + name + '，点击运行回测模拟产生买卖点。</div>';
                    }, 50);
                };
            });
            var demoBtn = document.getElementById('demoBacktestBtn');
            if (demoBtn) demoBtn.onclick = function() { document.querySelector('.nav-item[data-page="detail"]').click(); };
        }, 50);
    } else if (pageId === 'strategy') {
        container.innerHTML = `
                <div class="card">
                    <div class="card-title">✍️ 策略代码编写区</div>
                    <div style="margin-bottom: 12px;"><button id="runCodeBtn">▶ 运行回测 (模拟)</button></div>
                    <textarea id="strategyTextArea" rows="9">def initialize(context):
    context.stock = "000001.SZ"
    context.short_win = 5
    context.long_win = 20

def handle_bar(context, bar_dict):
    short_ma = history_bars(context.stock, context.short_win, '1d', 'close').mean()
    long_ma = history_bars(context.stock, context.long_win, '1d', 'close').mean()
    if short_ma > long_ma:
        order_target_percent(context.stock, 1.0)
        log.info("买入信号")
    elif short_ma < long_ma:
        order_target_percent(context.stock, 0)</textarea>
                    <div class="log-box" id="runLogConsole">
                        [系统] 就绪，点击运行回测或从左侧历史回测加载策略代码。<br>
                    </div>
                </div>`;
        setTimeout(function() {
            var runBtn = document.getElementById('runCodeBtn');
            var logDiv = document.getElementById('runLogConsole');
            if (runBtn && logDiv) {
                runBtn.onclick = function() {
                    logDiv.innerHTML += '<div>🚀 回测运行中... 基于当前策略产生买卖信号: 2026-01-05 买入 000001 800股@12.35, 2026-01-12 卖出 @13.68</div>';
                    logDiv.scrollTop = logDiv.scrollHeight;
                    currentTradeSignals.push({ date: '2026-01-20', code: '000001', type: 'buy', price: 13.20, shares: 1000 });
                    alert("回测模拟完成，买卖点已记录，可前往买卖点成交图查看最新K线标识。");
                };
            }
        }, 50);
    } else if (pageId === 'detail') {
        var profitTags = ["策略收益 +23.5%", "基准收益 +12.1%", "阿尔法 0.18", "贝塔 0.92", "最大回撤 -8.2%"];
        var tagHtml = profitTags.map(function(t) { var cls = profitClass(t); return '<span class="metric-tag ' + cls + '">' + t + '</span>'; }).join('');
        var stockRows = tradeStockLibrary.map(function(t) {
            return '<tr><td>' + t.time + '</td><td class="stock-code-link" data-code="' + t.code + '">' + formatStockDisplayHtml(t.code) + '</td><td>' + t.shares + '</td><td>' + t.price + '</td><td>' + t.mktValue + '</td></tr>';
        }).join('');
        container.innerHTML = `
                <div class="card">
                    <div class="card-title">📊 策略详情 (双均线示例)</div>
                    <div class="metric-row">${tagHtml}</div>
                    <div id="detailCurveContainer" style="height: 240px; width:100%; margin-bottom: 24px;"></div>
                    <div style="margin-top: 20px;"><h4 style="color:#ffffff;">📋 成交股票库 (成交时间+代码+数量+价格+市值)</h4>
                    <div class="scrollable-table">
                    <table><thead><tr><th>成交时间</th><th>股票代码</th><th>成交数量</th><th>成交价格</th><th>当前市值(元)</th></tr></thead>
                    <tbody>${stockRows}</tbody></table>
                    </div></div>
                    <button id="gotoKlineBtn" style="margin-top: 16px;">🔍 查看买卖点成交图(K线)</button>
                </div>`;
        setTimeout(function() {
            drawDetailCurve();
            var gotoBtn = document.getElementById('gotoKlineBtn');
            if (gotoBtn) gotoBtn.onclick = function() { document.querySelector('.nav-item[data-page="kchart"]').click(); };
            var contentPanel = document.getElementById('dynamicContent');
            contentPanel.addEventListener('click', function(e) {
                var target = e.target;
                var link = target.closest('.stock-code-link');
                if (link) {
                    var code = link.getAttribute('data-code');
                    if (code) navigateToKline(code);
                }
            });
        }, 50);
    } else if (pageId === 'daily') {
        var rows = dailyHoldings.map(function(d) {
            var dailyCls = profitClass(d.dailyProfit);
            var cumCls = profitClass(d.cumulative);
            return '<tr><td>' + d.date + '</td><td>' + d.cash + '</td><td class="' + dailyCls + '">' + d.dailyProfit + '</td><td class="' + cumCls + '">' + d.cumulative + '</td></tr>';
        }).join('');
        container.innerHTML = `<div class="card"><div class="card-title">💰 每日持仓 & 收益明细</div>
                <table><thead><tr><th>日期</th><th>现金/资产(元)</th><th>日收益(元)</th><th>累计收益(元)</th></tr></thead>
                <tbody>${rows}</tbody></table></div>`;
    } else if (pageId === 'api') {
        container.innerHTML = `<div class="card"><div class="card-title">📘 API文档</div><div class="code-area">GET /api/backtest/list<br>POST /api/strategy/run<br>GET /api/stock/kline?code=000001<br>GET /api/trade/signals</div></div>`;
    } else if (pageId === 'settings') {
        container.innerHTML = `
                <div class="card">
                    <div class="card-title">⚙️ 设置说明</div>
                    <p style="color:#ffffff;">界面支持所有模块独立滑动，K线图买卖点完全基于回测产生的信号展示。后续可对接实盘数据。</p>
                </div>
                <div class="card">
                    <div class="card-title">👤 账号设置</div>
                    <div class="profile-avatar-upload">
                        <div class="preview" id="avatarPreview">${loadAvatarPreview()}</div>
                        <label class="file-upload-label" for="avatarInput">选择头像图片</label>
                        <input type="file" id="avatarInput" accept="image/*">
                        <button id="saveAvatarBtn">保存头像</button>
                    </div>
                </div>`;
        setTimeout(function() {
            var fileInput = document.getElementById('avatarInput');
            var preview = document.getElementById('avatarPreview');
            var saveBtn = document.getElementById('saveAvatarBtn');
            if (fileInput && preview && saveBtn) {
                fileInput.addEventListener('change', function(e) {
                    var file = e.target.files[0];
                    if (file) {
                        var reader = new FileReader();
                        reader.onload = function(ev) {
                            preview.innerHTML = '<img src="' + ev.target.result + '" alt="头像预览">';
                            preview.dataset.tempDataUrl = ev.target.result;
                        };
                        reader.readAsDataURL(file);
                    }
                });
                saveBtn.addEventListener('click', function() {
                    var dataUrl = preview.dataset.tempDataUrl;
                    if (dataUrl) {
                        saveAvatarToStorage(dataUrl);
                        alert('头像已保存！');
                    } else {
                        alert('请先选择一张图片。');
                    }
                });
            }
        }, 50);
    }
    document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
    var target = document.querySelector('.nav-item[data-page="' + pageId + '"]');
    if (target) target.classList.add('active');
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
            if (pageId === 'kchart') autoRunBacktest = false;
            loadPage(pageId);
        });
    });
    loadPage('history');
});
