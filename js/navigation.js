import { bridge } from './bridge.js';
import { fetchAndRenderKline, runBacktest, buyPoints, sellPoints, autoRunBacktest, autoBacktestScheduled, currentKlineDates, currentKlineValues } from './kline.js';
import { renderProfile } from './profile.js';
import { renderStockKline, drawDetailCurve, formatStockDisplayHtml, drawEquityCurve, renderKlineWithSignals } from './chartRenderer.js';
import { renderVolumeSubChart, destroyVolumeSubChart } from './subChartRenderer.js';
import { bindDatePicker } from './datepicker.js';
import { stockNameMap, tradeStockLibrary, backtestStrategies, fetchStockName, searchStockSuggestions } from './stockData.js';
import { formatStockNameOnly, populateStockDatalist, profitClass, escapeHtml, loadAvatarPreview, saveAvatarToStorage } from './main.js';
import { renderStrategyPage } from './strategyBuilder.js';
import { renderCodeEditorPage } from './codeEditor.js';
import { renderTroubleshootPage } from './troubleshoot.js';

var currentStockCode = "000001";

// ---- Toast 提示 ----
function showToast(msg, isError) {
    var tip = document.createElement('div');
    tip.style.cssText = 'position:fixed;top:20%;left:50%;transform:translateX(-50%);background:' +
        (isError ? '#ff4c4c' : '#4cff4c') + ';color:#000;padding:10px 20px;border-radius:8px;z-index:99999;font-weight:600;';
    tip.textContent = msg;
    document.body.appendChild(tip);
    setTimeout(function() { tip.remove(); }, 2000);
}

// ---- 行业浮层 ----
function showIndustryPopup(jsonStr, industry) {
    var data = JSON.parse(jsonStr);
    if (!Array.isArray(data) || data.length === 0) return;

    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:1999;';
    overlay.onclick = function() { overlay.remove(); content.remove(); };

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

// ---- 实时行情栏更新 ----
function updatePriceBarName(name, code) {
    var nameEl = document.getElementById('stockPriceBarName');
    var codeEl = document.getElementById('stockPriceBarCode');
    if (nameEl) nameEl.textContent = name || '--';
    if (codeEl) codeEl.textContent = code || '--';
}

function updatePriceBar(data) {
    var priceEl = document.getElementById('stockPriceBarPrice');
    var changeEl = document.getElementById('stockPriceBarChange');
    var changePctEl = document.getElementById('stockPriceBarChangePct');

    if (!data || data.error) {
        if (priceEl) { priceEl.textContent = '--'; priceEl.className = 'latest-price price-flat'; }
        if (changeEl) { changeEl.textContent = '--'; changeEl.className = ''; }
        if (changePctEl) { changePctEl.textContent = '--'; changePctEl.className = ''; }
        return;
    }

    var change = data.change || 0;
    var changePct = data.change_pct || 0;
    var cls = change > 0 ? 'price-up' : (change < 0 ? 'price-down' : 'price-flat');

    if (priceEl) {
        priceEl.textContent = data.price != null ? data.price.toFixed(2) : '--';
        priceEl.className = 'latest-price ' + cls;
    }
    if (changeEl) {
        changeEl.textContent = (change >= 0 ? '+' : '') + change.toFixed(2);
        changeEl.className = cls;
    }
    if (changePctEl) {
        changePctEl.textContent = (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%';
        changePctEl.className = cls;
    }
}

// ========== 主路由 ==========
export function loadPage(pageId) {
    var container = document.getElementById('dynamicContent');
    if (!container) return;

    // 切换页面时清理旧副图实例
    destroyVolumeSubChart();

    if (pageId === 'profile') {
        renderProfile();
    } else if (pageId === 'kchart') {
        renderKchartPage(container);
    } else if (pageId === 'stock') {
        renderStockPage(container);
    } else if (pageId === 'history') {
        renderHistoryPage(container);
    } else if (pageId === 'strategy') {
        container.innerHTML = '';
        renderStrategyPage(container);
    } else if (pageId === 'codeEditor') {
        container.innerHTML = '';
        renderCodeEditorPage(container);
    } else if (pageId === 'detail') {
        renderDetailPage(container);
    } else if (pageId === 'api') {
        renderApiPage(container);
    } else if (pageId === 'troubleshoot') {
        renderTroubleshootPage(container);
    } else if (pageId === 'settings') {
        renderSettingsPage(container);
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

// ========== 买卖点成交图页 (K线) ==========
function renderKchartPage(container) {
    // 获取回测时间段
    var backtestStart = window.strategyStartDate || '2010-01-01';
    var backtestEnd = window.strategyEndDate || new Date().toISOString().slice(0, 10);
    var periodText = window.strategyStartDate ? (backtestStart + ' ~ ' + backtestEnd) : '未设置';

    container.innerHTML = `
        <div class="card" id="kchartCard">
            <div class="card-title">📈 买卖点成交图 (策略回测生成买卖点)</div>
            <div id="currentStrategyDisplay" style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
                <span style="color:#9aa9cc;">📋 当前回测策略：</span>
                <span id="currentStrategyName" style="color:#ffffff; font-weight:600;">无</span>
            </div>
            <div style="color:#9aa9cc; font-size:13px; margin-bottom:8px;">
                回测区间：<span id="backtestPeriodDisplay" style="color:#4f7eff;">${periodText}</span>
            </div>
            <div class="legend-sign"><span><i class="buy-point"></i> 买入 (B)</span><span><i class="sell-point"></i> 卖出 (S)</span></div>
            <div class="metric-row">
                <span>当前股票:</span>
                <input type="text" id="stockSelectorKline" list="stockListKline" placeholder="输入或选择股票" style="width:130px;">
                <datalist id="stockListKline"></datalist>
                <button id="loadStrategySignalsBtn">📊 加载策略信号</button>
                <button id="gotoStrategyBtn">📝 跳转到策略页</button>
                <button id="refreshKlineBtn">刷新K线</button>
            </div>
            <div id="klineMainChart" class="kline-container"></div>
            <div id="volumeSubChart" style="width:100%;background:#0e1220;border-radius:0 0 20px 20px;margin-top:2px;"></div>
            <p class="kchart-bottom-text" style="margin-top:6px; color:#9aa9cc;">若无买卖点，请先在策略页运行回测并保存信号，再点击"加载策略信号"。</p>
        </div>`;

    setTimeout(function() {
        // 挂载副图渲染函数到全局，供 chartRenderer.js 在 setOption 后回调
        window.renderVolumeSubChart = renderVolumeSubChart;

        // 策略名称显示
        var nameSpan = document.getElementById('currentStrategyName');
        if (nameSpan) nameSpan.innerText = window.currentStrategyName || '无';

        // 回测区间显示
        var periodSpan = document.getElementById('backtestPeriodDisplay');
        if (periodSpan) {
            var s = window.strategyStartDate;
            var e = window.strategyEndDate;
            periodSpan.textContent = s ? (s + ' ~ ' + e) : '未设置';
        }

        // 填充股票 datalist（优先使用回测结果中的 topPositionCodes）
        function refreshKlineDatalist() {
            var topFromBacktest = window.topPositionCodes || [];
            var sorted = tradeStockLibrary.slice().sort(function(a, b) { return b.shares - a.shares; });
            var topCodes = [];
            var seen = {};
            topFromBacktest.forEach(function(c) { seen[c] = true; topCodes.push(c); });
            sorted.forEach(function(t) {
                if (!seen[t.code]) { seen[t.code] = true; topCodes.push(t.code); }
            });
            populateStockDatalist('stockListKline', topCodes.slice(0, 6));
        }
        refreshKlineDatalist();
        // 若 bridge 已连接，确保名称映射已加载后刷新 datalist
        if (bridge && typeof bridge.get_traded_stocks === 'function') {
            bridge.get_traded_stocks().then(function() { refreshKlineDatalist(); }).catch(function() {});
        }

        var selInput = document.getElementById('stockSelectorKline');
        if (selInput) {
            selInput.value = formatStockNameOnly(currentStockCode);
            selInput.setAttribute('data-current-code', currentStockCode);

            selInput.addEventListener('input', function() {});
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
                var displayName = formatStockNameOnly(code);
                if (this.value !== displayName) this.value = displayName;
                buyPoints.length = 0;
                sellPoints.length = 0;
                fetchAndRenderKline(currentStockCode, backtestStart, backtestEnd);
            });
            selInput.addEventListener('focus', function() { this.value = ''; });
            selInput.addEventListener('blur', function() {
                if (this.value.trim() === '') {
                    this.value = formatStockNameOnly(currentStockCode);
                    this.setAttribute('data-current-code', currentStockCode);
                }
            });
        }

        // 刷新K线按钮
        var refreshBtn = document.getElementById('refreshKlineBtn');
        if (refreshBtn) {
            refreshBtn.onclick = function() {
                fetchAndRenderKline(currentStockCode, backtestStart, backtestEnd);
            };
        }

        // 加载策略信号按钮
        var loadSignalBtn = document.getElementById('loadStrategySignalsBtn');
        if (loadSignalBtn) {
            loadSignalBtn.addEventListener('click', function() {
                var sigs = window.strategySignals;
                if (!sigs || sigs.length === 0) {
                    showToast('请先在策略页运行回测', true);
                    return;
                }
                var code = currentStockCode;
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
                if (matched.length === 0) {
                    showToast('当前股票无匹配信号', true);
                    return;
                }
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
                    fetchAndRenderKline(code, backtestStart, backtestEnd);
                }
                showToast('已加载 ' + matched.length + ' 个信号', false);
            });
        }

        // 跳转到策略页
        var gotoBtn = document.getElementById('gotoStrategyBtn');
        if (gotoBtn) {
            gotoBtn.onclick = function() {
                var nav = document.querySelector('.nav-item[data-page="strategy"]');
                if (nav) nav.click();
            };
        }

        // 初始加载K线
        buyPoints.length = 0;
        sellPoints.length = 0;
        setTimeout(function() {
            fetchAndRenderKline(currentStockCode, backtestStart, backtestEnd);
        }, 200);
    }, 50);
}

// ========== 个股详情页 ==========
function renderStockPage(container) {
    container.innerHTML = `
        <div class="card" id="stockCard">
            <div class="card-title">📉 个股详情</div>
            <div class="stock-search-row" style="display:flex; justify-content:space-between; align-items:center;">
                <div style="display:flex; gap:10px; align-items:center; flex:1; position:relative;">
                    <input type="text" id="stockCodeInput" placeholder="输入股票代码或名称搜索" style="flex:1; background:#1e253b; border:1px solid #323d5a; padding:8px 14px; border-radius:30px; color:#ffffff; font-size:13px;">
                    <div id="stockSuggestionsContainer" style="position: absolute; top:40px; left:0; right:0; z-index: 1000; max-height: 200px; overflow-y: auto; background: #1a2135; border:1px solid #2a314a; border-radius: 8px; display: none;"></div>
                    <button id="stockSearchBtn">🔍 查询</button>
                </div>
                <div id="stockIndustryInfo" style="display:flex; align-items:center; gap:8px; margin-left:16px; white-space:nowrap;">
                    <span id="stockIndustryLabel" style="color:#9aa9cc; font-size:13px;">行业：--</span>
                    <button id="stockIndustryBtn" style="background:#2a3a5a;">🏭 同行业股票</button>
                </div>
            </div>
            <div id="stockPriceBar" class="stock-price-bar">
                <div class="stock-name-code">
                    <span class="stock-name-large" id="stockPriceBarName">--</span>
                    <span class="stock-code-small" id="stockPriceBarCode">--</span>
                </div>
                <div class="stock-price-info">
                    <span class="latest-price" id="stockPriceBarPrice">--</span>
                    <div class="change-row">
                        <span id="stockPriceBarChange">--</span>
                        <span id="stockPriceBarChangePct">--</span>
                    </div>
                </div>
            </div>
            <div id="stockInfoArea" style="margin-bottom:12px; color:#9aa9cc;">请输入股票代码查询</div>
            <div id="stockKlineChart" style="width:100%;"></div>
            <div id="stockVolumeSubChart" style="width:100%;background:#0e1220;border-radius:0 0 20px 20px;margin-top:2px;"></div>
            <div id="indicatorArea" style="margin-top:12px; padding:16px; background:#151c2c; border:1px solid #242a40; border-radius:16px; color:#9aa9cc; text-align:center;">
                MACD / KDJ 等指标区域（即将开放）
            </div>
        </div>`;

    setTimeout(function() {
        // 挂载副图渲染函数到全局，供 chartRenderer.js 在 setOption 后回调
        window.renderVolumeSubChart = renderVolumeSubChart;

        var codeInput = document.getElementById('stockCodeInput');
        var searchBtn = document.getElementById('stockSearchBtn');
        var infoArea = document.getElementById('stockInfoArea');
        var industryBtn = document.getElementById('stockIndustryBtn');
        var industryLabel = document.getElementById('stockIndustryLabel');

        var stockSuggestionsContainer = document.getElementById('stockSuggestionsContainer');

        if (codeInput) {
            codeInput.value = formatStockNameOnly(currentStockCode);
            codeInput.addEventListener('focus', function() { this.value = ''; });
            codeInput.addEventListener('blur', function() {
                if (this.value.trim() === '') this.value = formatStockNameOnly(currentStockCode);
            });

            // 模糊搜索：输入时显示建议列表
            codeInput.addEventListener('input', function() {
                var keyword = this.value.trim();
                if (!keyword || keyword.length < 1) {
                    stockSuggestionsContainer.style.display = 'none';
                    stockSuggestionsContainer.innerHTML = '';
                    return;
                }
                searchStockSuggestions(keyword, bridge).then(function(list) {
                    if (!list || list.length === 0) {
                        stockSuggestionsContainer.style.display = 'none';
                        return;
                    }
                    stockSuggestionsContainer.innerHTML = '';
                    stockSuggestionsContainer.style.display = 'block';
                    list.forEach(function(item) {
                        var div = document.createElement('div');
                        div.style.cssText = 'padding:8px 12px; cursor:pointer; background:#1a2135; border-bottom:1px solid #2a314a; color:#ffffff;';
                        div.innerHTML = '<span style="color:#fff;font-weight:600;">' + item.name + '</span> <span style="color:#9aa9cc;">(' + item.code + ')</span>';
                        div.addEventListener('click', function() {
                            codeInput.value = item.code;
                            stockSuggestionsContainer.style.display = 'none';
                            loadStock(item.code);
                        });
                        stockSuggestionsContainer.appendChild(div);
                    });
                });
            });
        }

        // 点击其他区域关闭建议列表
        document.addEventListener('click', function(e) {
            if (!e.target.closest('#stockSuggestionsContainer') && !e.target.closest('#stockCodeInput')) {
                stockSuggestionsContainer.style.display = 'none';
            }
        });

        function loadStock(code) {
            currentStockCode = code;
            if (codeInput) codeInput.value = formatStockNameOnly(code);
            fetchStockName(code, bridge).then(function(fetchedName) {
                if (fetchedName) stockNameMap[code] = fetchedName;
                var name = stockNameMap[code] || code;
                if (infoArea) {
                    infoArea.innerHTML = '<span style="color:#fff;font-weight:600;">' + name + '</span> <span style="color:#9aa9cc;">(' + code + ')</span>';
                }
                // 更新实时行情栏中的股票名称和代码
                updatePriceBarName(name, code);
            });

            // 预填实时行情栏中的股票代码
            updatePriceBarName(formatStockNameOnly(code), code);
            // 获取行业信息
            if (bridge && industryLabel) {
                bridge.get_industry(code).then(function(jsonStr) {
                    var data = JSON.parse(jsonStr);
                    if (data && data.industry) {
                        industryLabel.textContent = '行业：' + data.industry;
                        window._currentIndustry = data.industry;
                    } else {
                        industryLabel.textContent = '行业：--';
                        window._currentIndustry = null;
                    }
                }).catch(function() {
                    industryLabel.textContent = '行业：--';
                    window._currentIndustry = null;
                });
            }
            // 加载K线
            var today = new Date().toISOString().slice(0, 10);
            if (bridge) {
                bridge.get_kline_data(code, '2010-01-01', today, 0).then(function(jsonStr) {
                    var data = JSON.parse(jsonStr);
                    if (data.error) {
                        var chartDom = document.getElementById('stockKlineChart');
                        if (chartDom) chartDom.innerHTML = '<div style="color:#ff6b6b;padding:20px;">' + data.error + '</div>';
                        return;
                    }
                    if (data.dates && !data.values && data.opens && data.highs && data.lows && data.closes) {
                        data.values = data.dates.map(function(_, i) {
                            return [data.opens[i], data.closes[i], data.lows[i], data.highs[i]];
                        });
                    }
                    if (data.dates && data.values) {
                        renderStockKline('stockKlineChart', data.dates, data.values, 0);
                    }
                }).catch(function(err) {
                    var chartDom = document.getElementById('stockKlineChart');
                    if (chartDom) chartDom.innerHTML = '<div style="color:#ff6b6b;padding:20px;">加载失败: ' + err.message + '</div>';
                });
            }
            // 获取实时行情
            if (bridge) {
                bridge.get_latest_price(code).then(function(jsonStr) {
                    var data = JSON.parse(jsonStr);
                    updatePriceBar(data);
                }).catch(function() {
                    updatePriceBar(null);
                });
            }
        }

        window._loadStockRef = loadStock;

        if (searchBtn) {
            searchBtn.addEventListener('click', function() {
                var val = (codeInput.value || '').trim();
                if (!val) return;
                stockSuggestionsContainer.style.display = 'none';
                loadStock(val);
            });
            codeInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') searchBtn.click();
            });
        }

        if (industryBtn) {
            industryBtn.addEventListener('click', function() {
                if (!bridge) { showToast('Bridge 未连接', true); return; }
                var industry = window._currentIndustry;
                if (!industry) {
                    showToast('未能获取当前股票行业', true);
                    return;
                }
                bridge.get_stocks_by_industry(industry).then(function(jsonStr) {
                    showIndustryPopup(jsonStr, industry);
                }).catch(function(err) {
                    showToast('获取行业数据失败: ' + err.message, true);
                });
            });
        }

        // 初始加载
        loadStock(currentStockCode);
    }, 50);
}

// ========== 历史回测页 ==========
function renderHistoryPage(container) {
    var rows = backtestStrategies.map(function(s) {
        var profitClassStr = profitClass(s.profit);
        return '<tr style="cursor:pointer;" class="history-strategy-row" data-id="' + s.id + '">' +
            '<td>' + escapeHtml(s.name) + '</td>' +
            '<td class="' + profitClassStr + '">' + s.profit + '</td>' +
            '<td><button class="load-history-btn" data-id="' + s.id + '">📋 加载到编辑器</button></td>' +
            '</tr>';
    }).join('');

    container.innerHTML = `
        <div class="card">
            <div class="card-title">📁 历史回测</div>
            <p style="color:#9aa9cc; margin-bottom:16px;">内置经典策略模板，点击可加载到策略编辑器进行回测。</p>
            <div class="scrollable-table">
                <table>
                    <thead><tr><th>策略名称</th><th>历史收益</th><th>操作</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>`;

    // 绑定加载按钮
    container.querySelectorAll('.load-history-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var id = parseInt(this.getAttribute('data-id'));
            var found = backtestStrategies.find(function(s) { return s.id === id; });
            if (found) {
                window.currentStrategyName = found.name;
                window.currentStrategyCode = found.code;
                showToast('已加载策略模板: ' + found.name + '，请切换到策略页查看', false);
            }
        });
    });

    // 点击行也加载
    container.querySelectorAll('.history-strategy-row').forEach(function(row) {
        row.addEventListener('click', function() {
            var id = parseInt(this.getAttribute('data-id'));
            var found = backtestStrategies.find(function(s) { return s.id === id; });
            if (found) {
                window.currentStrategyName = found.name;
                window.currentStrategyCode = found.code;
                showToast('已加载策略模板: ' + found.name + '，请切换到策略页查看', false);
            }
        });
    });
}

// ========== API文档页 ==========
function renderApiPage(container) {
    container.innerHTML = `
        <div class="card">
            <div class="card-title">📘 策略代码编写 API 参考</div>
            <p style="color:#9aa9cc; margin-bottom:16px;">本指南教您如何在"策略代码"编辑器中编写自定义回测策略。引擎提供简洁的 API，让您专注于交易逻辑。</p>

            <h4 style="color:#4f7eff; margin-top:24px;">🏗️ 策略基础结构</h4>
            <p style="color:#9aa9cc;">一个完整的策略必须包含两个函数：</p>
            <div class="code-area" style="margin-bottom:12px;">
def initialize(context):
    # 初始化参数、设置全局变量
    pass

def handle_bar(context, bar_dict):
    # 每根K线都会调用一次，在这里编写交易逻辑
    pass
            </div>
            <p style="color:#9aa9cc;">策略运行时，先执行一次 <code style="color:#4f7eff;">initialize</code>，然后按时间顺序遍历每一根日K线，调用 <code style="color:#4f7eff;">handle_bar</code>。</p>

            <h4 style="color:#4f7eff; margin-top:24px;">📦 常用数据获取：history_bars</h4>
            <p style="color:#9aa9cc;">获取股票的历史K线数据，返回 numpy array。</p>
            <div class="code-area" style="margin-bottom:12px;">
# 语法
history_bars(security, count, unit, field)

# 参数说明
# security : 股票代码 (字符串)，如 "000001"
# count    : 获取的K线数量 (整数)
# unit     : K线周期，目前只支持 '1d' (日线)
# field    : 字段名，可选 'open', 'close', 'high', 'low', 'volume'

# 示例：获取最近 20 根日线的收盘价
closes = history_bars("000001", 20, '1d', 'close')
# 返回 numpy array，如 [10.2, 10.5, 10.3, ...]

# 获取成交量
vols = history_bars("000001", 20, '1d', 'volume')
# 返回 numpy array，如 [150000, 230000, 180000, ...]
            </div>

            <h4 style="color:#4f7eff; margin-top:24px;">💊 下单函数</h4>
            <p style="color:#9aa9cc;">调整股票仓位，资金管理由引擎自动处理。</p>
            <div class="code-area" style="margin-bottom:12px;">
# 按百分比下单 (推荐)
order_target_percent(security, percent)
# security : 股票代码
# percent  : 目标仓位比例，0.0 ~ 1.0 之间
# 示例：全仓买入
order_target_percent("000001", 1.0)
# 示例：清仓卖出
order_target_percent("000001", 0.0)

# 按固定金额下单 (可选)
order_target_value(security, value)
# value : 目标持仓市值 (元)
            </div>
            <p style="color:#9aa9cc; font-size:13px;">📌 默认每次交易以收盘价成交（可配置滑点）。买入最小单位为 100 股（1手）。</p>

            <h4 style="color:#4f7eff; margin-top:24px;">📊 当前K线数据：bar_dict</h4>
            <p style="color:#9aa9cc;">在 handle_bar 中，通过 bar_dict 字典获取当前日期的行情。</p>
            <div class="code-area" style="margin-bottom:12px;">
def handle_bar(context, bar_dict):
    current_close = bar_dict['close']   # 收盘价
    current_open  = bar_dict['open']    # 开盘价
    current_high  = bar_dict['high']    # 最高价
    current_low   = bar_dict['low']     # 最低价
    current_vol   = bar_dict['volume']  # 成交量（整数，单位：股）
            </div>

            <h4 style="color:#4f7eff; margin-top:24px;">📝 日志输出：log</h4>
            <div class="code-area" style="margin-bottom:12px;">
log.info("这是一条普通日志")
log.error("这是一个错误日志")
# 日志会显示在前端的回测日志区域
            </div>

            <h4 style="color:#4f7eff; margin-top:24px;">⚙️ 全局存储：context</h4>
            <p style="color:#9aa9cc;">context 是一个全局共享的命名空间对象，可以在 initialize 中设置参数，在 handle_bar 中读取和使用。</p>
            <div class="code-area" style="margin-bottom:12px;">
def initialize(context):
    context.my_param = 20
    context.stock = "000001"

def handle_bar(context, bar_dict):
    # 读取参数
    period = context.my_param
    stock = context.stock
            </div>

            <h4 style="color:#4f7eff; margin-top:24px;">🧪 完整示例：双均线策略</h4>
            <div class="code-area" style="margin-bottom:12px;">
# 双均线策略：金叉买入，死叉卖出

import numpy as np

def initialize(context):
    context.fast = 5
    context.slow = 20

def handle_bar(context, bar_dict):
    stock = "STOCK_CODE_PLACEHOLDER"  # 编辑器会自动替换为实际代码

    # 获取历史收盘价
    fast_arr = history_bars(stock, context.fast + 1, '1d', 'close')
    slow_arr = history_bars(stock, context.slow + 1, '1d', 'close')

    if len(fast_arr) < context.fast + 1 or len(slow_arr) < context.slow + 1:
        return

    fast_ma = fast_arr[-context.fast:].mean()
    slow_ma = slow_arr[-context.slow:].mean()
    prev_fast = fast_arr[-context.fast-1:-1].mean()
    prev_slow = slow_arr[-context.slow-1:-1].mean()

    if prev_fast <= prev_slow and fast_ma > slow_ma:
        order_target_percent(stock, 1.0)
        log.info("金叉买入信号")
    elif prev_fast >= prev_slow and fast_ma < slow_ma:
        order_target_percent(stock, 0)
        log.info("死叉卖出信号")
            </div>

            <h4 style="color:#4f7eff; margin-top:24px;">💡 注意事项</h4>
            <ul style="color:#9aa9cc; margin-bottom:12px; padding-left:20px;">
                <li>数据不足时 (<code>len(arr) &lt; period</code>) 务必 <code>return</code>，避免计算错误。</li>
                <li>可使用 <code>np.mean()</code>、<code>np.std()</code>、<code>pd.Series</code> 等计算指标。</li>
                <li>策略异常会被后端捕获并记录到日志，不会中断整个回测。</li>
                <li>滑点模式、初始资金、回测区间在前端面板中配置，无需在代码中设置。</li>
                <li>✅ 成交量数据已接入真实数据库，可用于构建量价策略（如成交量放大突破）。</li>
            </ul>

            <h4 style="color:#4f7eff; margin-top:24px;">❌ 常见错误与解决方案</h4>

            <div style="background:#151c2c;border:1px solid #242a40;border-radius:8px;padding:12px;margin-bottom:12px;">
                <p style="color:#ff6b6b;font-weight:600;margin-bottom:4px;">1. 'dict' object has no attribute 'positions'</p>
                <p style="color:#9aa9cc;font-size:13px;">原因：使用了 <code style="color:#4f7eff;">context.portfolio.positions</code>，但引擎中 portfolio 是一个字典。</p>
                <div class="code-area" style="margin-top:6px;"># 正确写法
holdings = context.portfolio.get('holdings', {})
current_position = holdings.get(stock, 0)</div>
            </div>

            <div style="background:#151c2c;border:1px solid #242a40;border-radius:8px;padding:12px;margin-bottom:12px;">
                <p style="color:#ff6b6b;font-weight:600;margin-bottom:4px;">2. 'types.SimpleNamespace' object has no attribute 'stock'</p>
                <p style="color:#9aa9cc;font-size:13px;">原因：在 <code style="color:#4f7eff;">initialize</code> 中没有定义 <code style="color:#4f7eff;">context.stock</code> 就直接使用。</p>
                <div class="code-area" style="margin-top:6px;"># 正确写法：在 initialize 中设置
def initialize(context):
    context.stock = "STOCK_CODE_PLACEHOLDER"

# 或者直接在 handle_bar 中写
def handle_bar(context, bar_dict):
    stock = "STOCK_CODE_PLACEHOLDER"  # 编辑器会自动替换占位符</div>
            </div>

            <div style="background:#151c2c;border:1px solid #242a40;border-radius:8px;padding:12px;margin-bottom:12px;">
                <p style="color:#ff6b6b;font-weight:600;margin-bottom:4px;">3. 回测无信号</p>
                <ul style="color:#9aa9cc;font-size:13px;padding-left:20px;margin:4px 0;">
                    <li>检查 <code style="color:#4f7eff;">history_bars</code> 的数据长度是否满足计算要求（数据不足时需 <code style="color:#4f7eff;">return</code>）。</li>
                    <li>检查策略逻辑是否过于严格（如阈值设置过高）。</li>
                    <li>查看后端日志中是否有错误信息（前端日志区域会显示后端的 <code style="color:#4f7eff;">[ERROR]</code> 日志）。</li>
                </ul>
            </div>

            <div style="background:#151c2c;border:1px solid #242a40;border-radius:8px;padding:12px;margin-bottom:12px;">
                <p style="color:#ff6b6b;font-weight:600;margin-bottom:4px;">4. 成交量数据使用</p>
                <ul style="color:#9aa9cc;font-size:13px;padding-left:20px;margin:4px 0;">
                    <li><code style="color:#4f7eff;">history_bars(stock, n, '1d', 'volume')</code> 返回的数组元素是整数（单位：股）。</li>
                    <li>均量计算应取 <code style="color:#4f7eff;">vols[:-1].mean()</code>，排除当前未完成的成交量。</li>
                </ul>
            </div>
        </div>`;
}

// ========== 设置页 ==========
function renderSettingsPage(container) {
    container.innerHTML = `
        <div class="card">
            <div class="card-title">⚙️ 设置说明</div>

            <h4 style="color:#4f7eff; margin-top:12px;">🖼️ 头像设置</h4>
            <p style="color:#9aa9cc; margin-bottom:12px;">前往"个人中心"页面上传头像，支持 PNG/JPG 格式，自动保存到本地。</p>

            <h4 style="color:#4f7eff; margin-top:12px;">📅 日期选择</h4>
            <p style="color:#9aa9cc; margin-bottom:12px;">所有日期输入框使用自定义日期选择器，点击输入框即可弹出日历面板。</p>

            <h4 style="color:#4f7eff; margin-top:12px;">📈 K线图表</h4>
            <p style="color:#9aa9cc; margin-bottom:12px;">基于 ECharts 渲染，支持缩放、拖拽。买卖点以标记点形式叠加显示。</p>

            <h4 style="color:#4f7eff; margin-top:12px;">💻 策略编辑器</h4>
            <p style="color:#9aa9cc; margin-bottom:12px;">支持 Tab 缩进（转换为4空格），语法高亮。策略通过 JSON 文件持久化存储。</p>

            <h4 style="color:#4f7eff; margin-top:12px;">🔌 Bridge 连接</h4>
            <p style="color:#9aa9cc; margin-bottom:12px;">Python 后端通过 QWebChannel 与前端通信。右上角指示灯显示连接状态。无连接时自动降级为模拟数据。</p>

            <h4 style="color:#4f7eff; margin-top:12px;">💡 快捷键</h4>
            <div class="code-area" style="margin-bottom:12px;">
Tab (编辑器)     → 插入4个空格
Enter (搜索框)   → 触发查询
Esc (弹窗)       → 关闭弹窗</div>
        </div>`;
}

// ========== 策略详情页（内部辅助） ==========
function buildMetricCards(metrics) {
    var cards = [];
    function add(label, value, cls) {
        cards.push(
            '<div style="background:#151c2c;border:1px solid #242a40;border-radius:12px;padding:14px 12px;text-align:center;">' +
            '<div style="font-size:20px;font-weight:700;color:' + (cls || '#4f7eff') + ';">' + value + '</div>' +
            '<div style="font-size:11px;color:#9aa9cc;margin-top:4px;">' + label + '</div>' +
            '</div>'
        );
    }
    function fmtPct(val) {
        if (val == null) return 'N/A';
        return (val >= 0 ? '+' : '') + val.toFixed(2) + '%';
    }
    var tr = metrics.total_return;
    add('累计收益率', fmtPct(tr), tr != null ? profitClass(fmtPct(tr)) : null);
    var ar = metrics.annual_return;
    add('年化收益率', fmtPct(ar), ar != null ? profitClass(fmtPct(ar)) : null);
    var md = metrics.max_drawdown;
    add('最大回撤', (md != null ? md.toFixed(2) + '%' : 'N/A'), md != null ? profitClass((md >= 0 ? '+' : '') + md.toFixed(2) + '%') : null);
    var sr = metrics.sharpe_ratio;
    add('夏普比率', (sr != null ? sr.toFixed(2) : 'N/A'));
    var wr = metrics.win_rate;
    if (wr != null) {
        add('胜率', (typeof wr === 'number' ? wr.toFixed(1) + '%' : wr));
    } else {
        add('胜率', 'N/A');
    }
    var tt = metrics.total_trades;
    add('交易次数', (tt != null ? tt : 'N/A'));
    var av = metrics.annual_volatility;
    if (av != null) add('年化波动率', av.toFixed(2) + '%');
    var ir = metrics.information_ratio;
    if (ir != null) add('信息比率', ir.toFixed(2));
    var mdd_dur = metrics.max_drawdown_duration;
    if (mdd_dur != null) add('最长回撤期', mdd_dur + '天');
    return '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;">' + cards.join('') + '</div>';
}

function buildSignalRows(signals, stockCode) {
    if (!signals || signals.length === 0) {
        return '<tr><td colspan="6">无交易信号</td></tr>';
    }
    var topCodes = window.topPositionCodes || [];
    var filtered;
    if (topCodes.length > 0) {
        filtered = signals.filter(function(s) {
            return topCodes.indexOf(s.code) !== -1;
        });
        if (filtered.length === 0) filtered = signals.slice(0, 50);
    } else {
        filtered = signals;
    }
    return filtered.map(function(s) {
        var typeText = s.type === 'buy' ? '买入' : '卖出';
        var code = s.code || stockCode || '';
        var nameDisplay = formatStockNameOnly(code) + '(' + code + ')';
        var shares = s.shares != null ? s.shares : 0;
        var lotDisplay;
        if (shares < 100) {
            lotDisplay = '不足1手';
        } else {
            lotDisplay = Math.floor(shares / 100) + '手';
        }
        return '<tr class="signal-row" data-code="' + escapeHtml(code) + '" style="cursor:pointer;">' +
            '<td>' + escapeHtml(s.date) + '</td>' +
            '<td>' + escapeHtml(nameDisplay) + '</td>' +
            '<td>' + typeText + '</td>' +
            '<td>' + (s.price != null ? s.price.toFixed(2) : '--') + '</td>' +
            '<td>' + lotDisplay + '</td>' +
            '</tr>';
    }).join('');
}

function renderBacktestDetail(container, result) {
    var strategyName = window.currentStrategyName || '未命名策略';
    var periodStart = window.strategyStartDate || '--';
    var periodEnd = window.strategyEndDate || '--';

    // 检测是否为多股组合回测
    var stockCodes = {};
    if (result.signals && result.signals.length > 0) {
        result.signals.forEach(function(s) {
            if (s.code) stockCodes[s.code] = true;
        });
    }
    var uniqueStocks = Object.keys(stockCodes);
    var isMultiStock = uniqueStocks.length > 1;
    var multiBadge = isMultiStock
        ? '<span style="background:#4f7eff;color:#fff;padding:2px 8px;border-radius:12px;font-size:11px;margin-left:8px;">组合回测 ' + uniqueStocks.length + '只</span>'
        : '';

    container.innerHTML = `
        <div class="card">
            <div class="card-title">📊 策略回测报告${multiBadge}</div>
            <div style="display:flex;gap:24px;margin-bottom:12px;color:#9aa9cc;font-size:13px;flex-wrap:wrap;">
                <span>策略名称：<span style="color:#fff;font-weight:600;">${escapeHtml(strategyName)}</span></span>
                <span>回测区间：<span style="color:#4f7eff;">${escapeHtml(periodStart)} ~ ${escapeHtml(periodEnd)}</span></span>
                ${isMultiStock ? '<span>股票数量：<span style="color:#4f7eff;">' + uniqueStocks.length + ' 只</span></span>' : ''}
            </div>
            <div id="detailCurveContainer" style="height: 280px; width:100%; margin-bottom: 16px;"></div>
            <div id="metricCards" style="margin-bottom:16px;">
                ${buildMetricCards(result.metrics || {})}
            </div>
            <div style="margin-top: 20px;">
                <h4 style="color:#ffffff;">📋 交易信号列表${isMultiStock ? ' <span style="color:#9aa9cc;font-size:12px;">（点击股票可跳转K线图）</span>' : ''}</h4>
                <div class="scrollable-table">
                    <table>
                        <thead><tr><th>日期</th><th>股票</th><th>类型</th><th>价格</th><th>手数</th></tr></thead>
                        <tbody id="signalTableBody">
                            ${buildSignalRows(result.signals)}
                        </tbody>
                    </table>
                </div>
            </div>
            <button id="clearBacktestResultBtn" style="margin-top:12px;">🗑 清除结果</button>
        </div>`;

    setTimeout(function() {
        if (result.equity_curve && result.equity_curve.length > 0) {
            drawEquityCurve('detailCurveContainer', result.equity_curve);
        } else {
            var curveDom = document.getElementById('detailCurveContainer');
            if (curveDom) {
                curveDom.innerHTML = '<div style="color:#9aa9cc; padding:40px; text-align:center;">暂无权益曲线数据</div>';
            }
        }
    }, 50);

    // 信号行点击
    try {
        document.querySelectorAll('#signalTableBody tr').forEach(function(tr) {
            tr.addEventListener('click', function() {
                var code = this.getAttribute('data-code');
                if (code) {
                    code = code.includes('.') ? code.split('.')[0] : code;
                    navigateToKline(code);
                }
            });
        });
    } catch (e) {
        console.warn('信号行绑定失败:', e);
    }

    var clearBtn = document.getElementById('clearBacktestResultBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', function() {
            delete window._lastBacktestResult;
            renderStaticDetail(container);
        });
    }
}

function renderStaticDetail(container) {
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

    var tagsHtml = '<span class="metric-tag">策略收益 +23.5%</span>' +
                   '<span class="metric-tag">基准收益 +12.1%</span>' +
                   '<span class="metric-tag">阿尔法 0.18</span>' +
                   '<span class="metric-tag">贝塔 0.92</span>' +
                   '<span class="metric-tag">最大回撤 -8.2%</span>';

    var signalRows = signals.map(function(sig) {
        var typeText = sig.type === 'buy' ? '买入' : '卖出';
        var nameDisplay = formatStockNameOnly(sig.code) + '(' + sig.code + ')';
        var shares = sig.shares != null ? sig.shares : 0;
        var lotDisplay = shares < 100 ? '不足1手' : Math.floor(shares / 100) + '手';
        return '<tr class="signal-row" data-code="' + sig.code + '" style="cursor:pointer;">' +
               '<td>' + sig.date + '</td>' +
               '<td>' + nameDisplay + '</td>' +
               '<td>' + typeText + '</td>' +
               '<td>' + (sig.price != null ? sig.price.toFixed(2) : '--') + '</td>' +
               '<td>' + lotDisplay + '</td></tr>';
    }).join('');

    container.innerHTML = `
        <div class="card">
            <div class="card-title">📊 策略详情</div>
            <p style="color:#9aa9cc; margin-bottom:12px;">暂无回测结果，以下为静态演示数据。请在策略页运行回测后查看真实结果。</p>
            <div class="metric-row">${tagsHtml}</div>
            <div id="detailCurveContainer" style="height: 240px; width:100%; margin-bottom: 24px;"></div>
            <div style="margin-top: 20px;">
                <h4 style="color:#ffffff;">📋 交易信号列表（示例）</h4>
                <div class="scrollable-table">
                    <table>
                        <thead><tr><th>日期</th><th>股票</th><th>类型</th><th>价格</th><th>手数</th></tr></thead>
                        <tbody>${signalRows}</tbody>
                    </table>
                </div>
            </div>
            <button id="gotoKlineBtn" style="margin-top: 16px;">🔍 查看买卖点成交图(K线)</button>
        </div>`;

    setTimeout(function() {
        var chartDom = document.getElementById('detailCurveContainer');
        if (chartDom && equityCurve.length > 0 && typeof echarts !== 'undefined') {
            var myChart = echarts.init(chartDom);
            myChart.setOption({
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
            });
        }

        document.querySelectorAll('.signal-row').forEach(function(tr) {
            tr.addEventListener('click', function() {
                var code = this.getAttribute('data-code');
                if (code) {
                    code = code.includes('.') ? code.split('.')[0] : code;
                    navigateToKline(code);
                }
            });
        });

        var gotoBtn = document.getElementById('gotoKlineBtn');
        if (gotoBtn) {
            gotoBtn.onclick = function() {
                var nav = document.querySelector('.nav-item[data-page="kchart"]');
                if (nav) nav.click();
            };
        }
    }, 50);
}

function renderDetailPage(container) {
    var result = window._lastBacktestResult;
    if (result && result.success) {
        renderBacktestDetail(container, result);
    } else if (result && result.status === 'success') {
        renderBacktestDetail(container, result);
    } else {
        renderStaticDetail(container);
    }
}
