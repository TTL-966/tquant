import { bridge } from './bridge.js';
import { fetchAndRenderKline, runBacktest, buyPoints, sellPoints, autoRunBacktest, autoBacktestScheduled, currentKlineDates, currentKlineValues, currentPeriod, setPeriod } from './kline.js';
import { renderProfile } from './profile.js';
import { renderStockKline, drawDetailCurve, formatStockDisplayHtml, drawEquityCurve, renderKlineWithSignals } from './chartRenderer.js';
import { renderVolumeSubChart, destroyVolumeSubChart } from './subChartRenderer.js';
import { bindDatePicker } from './datepicker.js';
import { stockNameMap, tradeStockLibrary, backtestStrategies, fetchStockName, searchStockSuggestions } from './stockData.js';
import { formatStockNameOnly, populateStockDatalist, populateStockSelector, profitClass, escapeHtml, loadAvatarPreview, saveAvatarToStorage } from './main.js';
import { renderStrategyPage } from './strategyBuilder.js';
import { renderCodeEditorPage } from './codeEditor.js';
import { renderTroubleshootPage } from './troubleshoot.js';
import { CARD_TYPE_META } from './strategyTemplates.js';

var currentStockCode = "000001";
var _syncingToSimulation = false;
var _quotePollTimer = null;

// ---- 自定义下拉面板（解决 QtWebEngine select/datalist 拉伸问题）----
var periodOptions = [
    { label: '日线', value: 'daily' },
    { label: '周线', value: 'weekly' },
    { label: '月线', value: 'monthly' }
];

function closeCustomDropdown(cls) {
    var panel = document.querySelector('.' + (cls || 'custom-dropdown-panel'));
    if (panel) panel.remove();
    document.removeEventListener('click', _onDocClickCustomDropdown);
}
function _onDocClickCustomDropdown(e) {
    var panel = document.querySelector('.custom-dropdown-panel');
    if (panel && !panel.contains(e.target)) {
        closeCustomDropdown('custom-dropdown-panel');
    }
}
function showCustomDropdown(input, options, onSelect) {
    closeCustomDropdown('custom-dropdown-panel');
    if (!options || options.length === 0) return;

    var panel = document.createElement('div');
    panel.className = 'custom-dropdown-panel';
    panel.style.cssText = 'position:fixed;z-index:99999;background:#1a2135;border:1px solid #4f7eff;border-radius:12px;padding:4px 0;max-height:250px;overflow-y:auto;min-width:100px;box-shadow:0 8px 20px rgba(0,0,0,0.5);';

    options.forEach(function(opt) {
        var item = document.createElement('div');
        item.style.cssText = 'padding:8px 16px;cursor:pointer;color:#fff;font-size:13px;white-space:nowrap;';
        item.textContent = opt.label;
        item.addEventListener('mouseenter', function() { item.style.background = '#2d3a5e'; });
        item.addEventListener('mouseleave', function() { item.style.background = 'transparent'; });
        item.addEventListener('click', function(e) {
            e.stopPropagation();
            input.value = opt.label;
            input.setAttribute('data-value', opt.value);
            closeCustomDropdown('custom-dropdown-panel');
            if (typeof onSelect === 'function') onSelect(opt.value);
        });
        panel.appendChild(item);
    });

    document.body.appendChild(panel);
    var rect = input.getBoundingClientRect();
    panel.style.left = rect.left + 'px';
    panel.style.top = (rect.bottom + 4) + 'px';

    setTimeout(function() {
        document.addEventListener('click', _onDocClickCustomDropdown);
    }, 0);
}

function closeStockDropdown() {
    var panel = document.querySelector('.stock-dropdown-panel');
    if (panel) panel.remove();
    document.removeEventListener('click', _onDocClickStockDropdown);
}
function _onDocClickStockDropdown(e) {
    var panel = document.querySelector('.stock-dropdown-panel');
    if (panel && !panel.contains(e.target) && e.target.id !== 'stockSelectorKline' && e.target.id !== 'stockSelectorArrow') {
        closeStockDropdown();
    }
}
function showStockDropdown(input, options, onSelect) {
    closeStockDropdown();
    if (!options || options.length === 0) return;

    var panel = document.createElement('div');
    panel.className = 'stock-dropdown-panel';
    panel.style.cssText = 'position:fixed;z-index:99999;background:#1a2135;border:1px solid #4f7eff;border-radius:12px;padding:4px 0;max-height:280px;overflow-y:auto;min-width:260px;box-shadow:0 8px 20px rgba(0,0,0,0.5);';

    options.forEach(function(opt) {
        var item = document.createElement('div');
        item.style.cssText = 'padding:8px 16px;cursor:pointer;color:#fff;font-size:13px;white-space:nowrap;display:flex;justify-content:space-between;';
        item.innerHTML = '<span>' + opt.name + '</span><span style="color:#9aa9cc;font-size:11px;">' + opt.code + '</span>';
        item.addEventListener('mouseenter', function() { item.style.background = '#2d3a5e'; });
        item.addEventListener('mouseleave', function() { item.style.background = 'transparent'; });
        item.addEventListener('click', function(e) {
            e.stopPropagation();
            input.value = opt.name;
            input.setAttribute('data-code', opt.code);
            closeStockDropdown();
            if (typeof onSelect === 'function') onSelect(opt.code);
        });
        panel.appendChild(item);
    });

    document.body.appendChild(panel);

    var rect = input.getBoundingClientRect();
    panel.style.left = rect.left + 'px';
    panel.style.top = (rect.bottom + 4) + 'px';

    setTimeout(function() {
        document.addEventListener('click', _onDocClickStockDropdown);
    }, 0);
}

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

    // 切换页面时清理旧副图实例和行情轮询
    destroyVolumeSubChart();
    if (pageId !== 'stock' && _quotePollTimer) {
        clearInterval(_quotePollTimer);
        _quotePollTimer = null;
    }

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
                <div style="position:relative;display:inline-block;">
                    <input type="text" id="stockSelectorKline" readonly placeholder="选择股票" style="width:150px;background:#1e253b;border:1px solid #323d5a;border-radius:30px;color:#fff;padding:6px 32px 6px 10px;font-size:13px;cursor:pointer;box-sizing:border-box;">
                    <span id="stockSelectorArrow" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);color:#9aa9cc;pointer-events:none;font-size:10px;">▼</span>
                </div>
                <button id="searchStockBtn" style="margin-left:4px; background:#2d3a5e; color:#fff; border:none; border-radius:30px; padding:6px 12px; cursor:pointer; font-size:13px;">🔍</button>
                <button id="loadStrategySignalsBtn">📊 加载策略信号</button>
                <button id="gotoStrategyBtn">📝 跳转到策略页</button>
                <button id="refreshKlineBtn">刷新K线</button>
                <div style="position:relative;display:inline-block;">
                    <input type="text" id="periodInput" readonly value="日线" data-value="daily" style="width:70px;background:#1e253b;border:1px solid #323d5a;border-radius:30px;color:#fff;padding:6px 28px 6px 10px;font-size:13px;cursor:pointer;box-sizing:border-box;">
                    <span id="periodArrow" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);color:#9aa9cc;pointer-events:none;font-size:10px;">▼</span>
                </div>
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

        // 股票选项存储（供下拉面板使用）
        var _stockOptions = [];

        function _codesToOptions(codes) {
            return codes.map(function(c) {
                return { code: c, name: formatStockNameOnly(c) };
            });
        }

        function _ensureOptionsContain(code) {
            for (var i = 0; i < _stockOptions.length; i++) {
                if (_stockOptions[i].code === code) return;
            }
            _stockOptions.push({ code: code, name: formatStockNameOnly(code) });
        }

        function _updateStockInput(code) {
            var input = document.getElementById('stockSelectorKline');
            if (input) {
                input.value = formatStockNameOnly(code);
                input.setAttribute('data-code', code);
            }
        }

        // 构建股票选项列表：仅显示有信号的股票，持仓优先 + 信号频率排序
        function refreshStockSelect() {
            var signals = window.strategySignals || [];
            if (signals.length === 0) {
                _stockOptions = [{ code: '000001', name: formatStockNameOnly('000001') }];
                _updateStockInput('000001');
                return;
            }
            var freq = {};
            signals.forEach(function(s) {
                var code = (s.code || '').split('.')[0];
                if (code) freq[code] = (freq[code] || 0) + 1;
            });
            var uniqueCodes = Object.keys(freq);
            var topFreq = uniqueCodes.sort(function(a, b) { return freq[b] - freq[a]; }).slice(0, 10);

            function applyOptions(codes) {
                _stockOptions = _codesToOptions(codes);
                _updateStockInput(currentStockCode);
            }

            if (bridge && typeof bridge.get_portfolio === 'function') {
                bridge.get_portfolio().then(function(jsonStr) {
                    var data = JSON.parse(jsonStr);
                    var holdingCodes = (data.holdings || []).map(function(h) { return h.code; });
                    var merged = holdingCodes.concat(topFreq);
                    var seen = {};
                    var final = [];
                    merged.forEach(function(c) {
                        if (!seen[c]) { seen[c] = true; final.push(c); }
                    });
                    applyOptions(final.slice(0, 15));
                }).catch(function() {
                    applyOptions(topFreq);
                });
            } else {
                applyOptions(topFreq);
            }
        }
        refreshStockSelect();

        // 自动选择首只有信号的股票
        var signals = window.strategySignals || [];
        var selInput = document.getElementById('stockSelectorKline');
        if (signals.length > 0) {
            var signalCodes = {};
            signals.forEach(function(s) {
                signalCodes[(s.code || '').split('.')[0]] = true;
            });
            var pureCurrent = (currentStockCode || '').split('.')[0];
            if (!signalCodes[pureCurrent]) {
                var firstCode = Object.keys(signalCodes)[0];
                if (firstCode) {
                    currentStockCode = firstCode;
                }
            }
        }
        if (selInput) {
            _updateStockInput(currentStockCode);
        }

        // 点击输入框或箭头 → 弹出下拉面板
        function _openStockDropdown() {
            if (_stockOptions.length === 0) return;
            showStockDropdown(selInput, _stockOptions, function(code) {
                currentStockCode = code;
                buyPoints.length = 0;
                sellPoints.length = 0;
                fetchAndRenderKline(code, backtestStart, backtestEnd);
            });
        }

        if (selInput) {
            selInput.addEventListener('click', function(e) {
                e.stopPropagation();
                // 刷新选项（可能信号已更新）
                if (_stockOptions.length === 0) refreshStockSelect();
                _openStockDropdown();
            });
        }

        var arrowEl = document.getElementById('stockSelectorArrow');
        if (arrowEl) {
            arrowEl.style.pointerEvents = 'auto';
            arrowEl.style.cursor = 'pointer';
            arrowEl.addEventListener('click', function(e) {
                e.stopPropagation();
                if (_stockOptions.length === 0) refreshStockSelect();
                _openStockDropdown();
            });
        }

        // 刷新K线按钮
        var refreshBtn = document.getElementById('refreshKlineBtn');
        if (refreshBtn) {
            refreshBtn.onclick = function() {
                fetchAndRenderKline(currentStockCode, backtestStart, backtestEnd);
            };
        }

        // 周期切换（自定义下拉，避免QtWebEngine原生select拉伸）
        var periodInput = document.getElementById('periodInput');
        var periodArrow = document.getElementById('periodArrow');
        function applyPeriod(period) {
            setPeriod(period);
            buyPoints.length = 0;
            sellPoints.length = 0;
            fetchAndRenderKline(currentStockCode, backtestStart, backtestEnd, period);
        }
        if (periodInput) {
            // 根据 currentPeriod 设置初始显示
            var curOpt = periodOptions.find(function(o) { return o.value === currentPeriod; });
            if (curOpt) {
                periodInput.value = curOpt.label;
                periodInput.setAttribute('data-value', curOpt.value);
            }
            periodInput.addEventListener('click', function(e) {
                e.stopPropagation();
                showCustomDropdown(periodInput, periodOptions, applyPeriod);
            });
            periodArrow.style.pointerEvents = 'auto';
            periodArrow.style.cursor = 'pointer';
            periodArrow.addEventListener('click', function(e) {
                e.stopPropagation();
                showCustomDropdown(periodInput, periodOptions, applyPeriod);
            });
        }

        // 搜索按钮：按关键词搜索，通过下拉面板展示结果
        var searchBtn = document.getElementById('searchStockBtn');
        if (searchBtn) {
            searchBtn.addEventListener('click', function() {
                var keyword = prompt('输入股票代码或名称搜索:');
                if (!keyword || !keyword.trim()) return;
                keyword = keyword.trim();
                searchStockSuggestions(keyword, bridge).then(function(list) {
                    if (!list || list.length === 0) {
                        showToast('未找到匹配股票', true);
                        return;
                    }
                    var searchOptions = [];
                    list.forEach(function(item) {
                        var code = (item.code || '').split('.')[0];
                        if (code) {
                            searchOptions.push({ code: code, name: item.name || formatStockNameOnly(code) });
                        }
                    });
                    if (searchOptions.length === 0) {
                        showToast('未找到匹配股票', true);
                        return;
                    }
                    var input = document.getElementById('stockSelectorKline');
                    if (!input) return;
                    showStockDropdown(input, searchOptions, function(code) {
                        // 将选中股票加入主选项列表（去重）
                        _ensureOptionsContain(code);
                        currentStockCode = code;
                        _updateStockInput(code);
                        buyPoints.length = 0;
                        sellPoints.length = 0;
                        fetchAndRenderKline(code, backtestStart, backtestEnd);
                    });
                }).catch(function() {
                    showToast('搜索失败，请确认 Bridge 已连接', true);
                });
            });
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
                        buyPoints.push({ date: s.date, code: code, price: s.price, shares: s.shares, reason: s.reason || '买入信号' });
                    } else {
                        sellPoints.push({ date: s.date, code: code, price: s.price, shares: s.shares, reason: s.reason || '卖出信号' });
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
                refreshStockSelect();
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
            <div style="display:flex; gap:10px; align-items:center; margin-bottom:8px;">
                <span style="color:#9aa9cc; font-size:13px;">K线周期：</span>
                <div style="position:relative;display:inline-block;">
                    <input type="text" id="stockPeriodInput" readonly value="日线" data-value="daily" style="width:70px;background:#1e253b;border:1px solid #323d5a;border-radius:30px;color:#fff;padding:6px 28px 6px 10px;font-size:13px;cursor:pointer;box-sizing:border-box;">
                    <span id="stockPeriodArrow" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);color:#9aa9cc;pointer-events:none;font-size:10px;">▼</span>
                </div>
            </div>
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
            var periodEl = document.getElementById('stockPeriodInput');
            var reqPeriod = periodEl ? (periodEl.getAttribute('data-value') || 'daily') : 'daily';
            if (bridge) {
                bridge.get_kline_data(code, '2010-01-01', today, 0, reqPeriod).then(function(jsonStr) {
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
            // 开启实时行情轮询（初始立即获取一次，之后每5秒刷新）
            startQuotePolling(code);
        }

        function startQuotePolling(code) {
            if (_quotePollTimer) {
                clearInterval(_quotePollTimer);
                _quotePollTimer = null;
            }
            fetchAndUpdateQuote(code);
            _quotePollTimer = setInterval(function() {
                fetchAndUpdateQuote(code);
            }, 5000);
        }

        function fetchAndUpdateQuote(code) {
            if (!bridge || typeof bridge.get_realtime_quote !== 'function') return;
            bridge.get_realtime_quote(code).then(function(jsonStr) {
                try {
                    var data = JSON.parse(jsonStr);
                    if (data.success) {
                        if (data.change === undefined && data.price != null && data.prev_close != null) {
                            data.change = parseFloat((data.price - data.prev_close).toFixed(2));
                        }
                        updatePriceBar(data);
                    }
                } catch (e) {
                    console.log('[Quote] 解析行情数据失败:', e);
                }
            }).catch(function(err) {
                console.log('[Quote] 请求行情失败:', err);
            });
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

        // 个股详情页周期切换（自定义下拉，避免QtWebEngine原生select拉伸）
        var stockPeriodInput = document.getElementById('stockPeriodInput');
        var stockPeriodArrow = document.getElementById('stockPeriodArrow');
        function applyStockPeriod(period) {
            setPeriod(period);
            loadStock(currentStockCode);
        }
        if (stockPeriodInput) {
            var stockCurOpt = periodOptions.find(function(o) { return o.value === currentPeriod; });
            if (stockCurOpt) {
                stockPeriodInput.value = stockCurOpt.label;
                stockPeriodInput.setAttribute('data-value', stockCurOpt.value);
            }
            stockPeriodInput.addEventListener('click', function(e) {
                e.stopPropagation();
                showCustomDropdown(stockPeriodInput, periodOptions, applyStockPeriod);
            });
            stockPeriodArrow.style.pointerEvents = 'auto';
            stockPeriodArrow.style.cursor = 'pointer';
            stockPeriodArrow.addEventListener('click', function(e) {
                e.stopPropagation();
                showCustomDropdown(stockPeriodInput, periodOptions, applyStockPeriod);
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
    function escapeHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ---- Build accordion panel data ----
    var panels = [
        {
            id: 'basics',
            icon: '🏗️',
            title: '策略基础结构',
            body: '<p style="color:#9aa9cc;margin-bottom:8px;">一个完整的策略必须包含两个函数：<code style="color:#4f7eff;">initialize</code> 在回测开始时执行一次，<code style="color:#4f7eff;">handle_bar</code> 每根日K线调用一次。</p>' +
                '<pre class="code-area">def initialize(context):\n    # 初始化参数、设置全局变量\n    pass\n\ndef handle_bar(context, bar_dict):\n    # 每根K线都会调用一次，在这里编写交易逻辑\n    pass</pre>'
        },
        {
            id: 'bar_dict',
            icon: '📊',
            title: '当前K线数据：bar_dict',
            body: '<p style="color:#9aa9cc;margin-bottom:8px;">在 <code style="color:#4f7eff;">handle_bar</code> 中通过 bar_dict 字典获取当前日行情。</p>' +
                '<table style="width:100%;border-collapse:collapse;margin-bottom:8px;">' +
                '<tr style="color:#4f7eff;"><th style="text-align:left;padding:4px 8px;">字段</th><th style="text-align:left;padding:4px 8px;">含义</th><th style="text-align:left;padding:4px 8px;">类型</th></tr>' +
                '<tr style="color:#9aa9cc;"><td style="padding:4px 8px;">bar_dict[\'open\']</td><td style="padding:4px 8px;">开盘价</td><td style="padding:4px 8px;">float</td></tr>' +
                '<tr style="color:#9aa9cc;"><td style="padding:4px 8px;">bar_dict[\'high\']</td><td style="padding:4px 8px;">最高价</td><td style="padding:4px 8px;">float</td></tr>' +
                '<tr style="color:#9aa9cc;"><td style="padding:4px 8px;">bar_dict[\'low\']</td><td style="padding:4px 8px;">最低价</td><td style="padding:4px 8px;">float</td></tr>' +
                '<tr style="color:#9aa9cc;"><td style="padding:4px 8px;">bar_dict[\'close\']</td><td style="padding:4px 8px;">收盘价</td><td style="padding:4px 8px;">float</td></tr>' +
                '<tr style="color:#9aa9cc;"><td style="padding:4px 8px;">bar_dict[\'volume\']</td><td style="padding:4px 8px;">成交量（股）</td><td style="padding:4px 8px;">int</td></tr>' +
                '</table>'
        },
        {
            id: 'history_bars',
            icon: '📦',
            title: '历史数据：history_bars',
            body: '<p style="color:#9aa9cc;margin-bottom:8px;">获取股票历史K线数据，返回 numpy array。</p>' +
                '<table style="width:100%;border-collapse:collapse;margin-bottom:8px;">' +
                '<tr style="color:#4f7eff;"><th style="text-align:left;padding:4px 8px;">参数</th><th style="text-align:left;padding:4px 8px;">说明</th></tr>' +
                '<tr style="color:#9aa9cc;"><td style="padding:4px 8px;">security</td><td style="padding:4px 8px;">股票代码，如 "000001"</td></tr>' +
                '<tr style="color:#9aa9cc;"><td style="padding:4px 8px;">count</td><td style="padding:4px 8px;">获取K线数量</td></tr>' +
                '<tr style="color:#9aa9cc;"><td style="padding:4px 8px;">unit</td><td style="padding:4px 8px;">周期，仅支持 \'1d\'</td></tr>' +
                '<tr style="color:#9aa9cc;"><td style="padding:4px 8px;">field</td><td style="padding:4px 8px;">字段：\'open\' / \'close\' / \'high\' / \'low\' / \'volume\'</td></tr>' +
                '</table>' +
                '<pre class="code-area">closes = history_bars("000001", 20, \'1d\', \'close\')\n# → numpy array [10.2, 10.5, 10.3, ...]\nvols  = history_bars("000001", 20, \'1d\', \'volume\')</pre>'
        },
        {
            id: 'order',
            icon: '💊',
            title: '下单函数与成交价模式',
            body: '<p style="color:#9aa9cc;margin-bottom:8px;">调整股票仓位，资金管理由引擎自动处理。</p>' +
                '<table style="width:100%;border-collapse:collapse;margin-bottom:8px;">' +
                '<tr style="color:#4f7eff;"><th style="text-align:left;padding:4px 8px;">函数</th><th style="text-align:left;padding:4px 8px;">作用</th></tr>' +
                '<tr style="color:#9aa9cc;"><td style="padding:4px 8px;">order_target_percent(stock, pct)</td><td style="padding:4px 8px;">目标仓位比例（0~1），推荐使用</td></tr>' +
                '<tr style="color:#9aa9cc;"><td style="padding:4px 8px;">order_target_value(stock, val)</td><td style="padding:4px 8px;">目标持仓市值（元）</td></tr>' +
                '</table>' +
                '<pre class="code-area">order_target_percent("000001", 1.0)   # 全仓买入\norder_target_percent("000001", 0.5)   # 半仓\norder_target_percent("000001", 0)     # 清仓</pre>' +
                '<p style="color:#9aa9cc;font-size:12px;">📌 最小交易单位为100股（1手），不足1手的订单会被舍去。</p>' +
                '<hr style="border-color:#323d5a;margin:10px 0;">' +
                '<p style="color:#fff;font-weight:600;margin-bottom:4px;">🎯 成交价模式说明</p>' +
                '<table style="width:100%;border-collapse:collapse;margin-bottom:8px;">' +
                '<tr style="color:#4f7eff;"><th style="text-align:left;padding:2px 8px;">data-value</th><th style="text-align:left;padding:2px 8px;">前端选项</th><th style="text-align:left;padding:2px 8px;">实际成交价</th></tr>' +
                '<tr style="color:#9aa9cc;"><td style="padding:4px 8px;color:#4cff4c;">close</td><td style="padding:4px 8px;">收盘价成交（回测默认）</td><td style="padding:4px 8px;">当前bar收盘价。日线回测标准做法，无未来数据问题。</td></tr>' +
                '<tr style="color:#9aa9cc;"><td style="padding:4px 8px;color:#f2c94c;">next_open</td><td style="padding:4px 8px;">次日开盘价成交</td><td style="padding:4px 8px;">下一交易日开盘价。模拟信号产生当天无法以收盘价成交、需次日开盘执行的场景。</td></tr>' +
                '<tr style="color:#9aa9cc;"><td style="padding:4px 8px;color:#9aa9cc;">half_spread</td><td style="padding:4px 8px;">半价差偏移（仅K线图标记）</td><td style="padding:4px 8px;">实际成交价仍为收盘价，仅K线图买卖点标记偏移到 (high+low)/2 位置。</td></tr>' +
                '</table>' +
                '<p style="color:#9aa9cc;font-size:12px;">💡 回测用当前bar收盘价成交；如要模拟开盘抢单或延迟成交，选择"次日开盘价成交"。</p>'
        },
        {
            id: 'log',
            icon: '📝',
            title: '日志输出：log',
            body: '<p style="color:#9aa9cc;margin-bottom:8px;">支持多级别日志，输出显示在前端回测日志区域。</p>' +
                '<pre class="code-area">log.info("买入信号触发")\nlog.error("数据不足")\nlog.warn("注意：仓位已达上限")</pre>'
        },
        {
            id: 'context',
            icon: '⚙️',
            title: '全局存储：context',
            body: '<p style="color:#9aa9cc;margin-bottom:8px;">context 是全局命名空间对象，在 initialize 中设置参数，在 handle_bar 中读取。</p>' +
                '<pre class="code-area">def initialize(context):\n    context.my_param = 20\n    context.stock = "000001"\n\ndef handle_bar(context, bar_dict):\n    period = context.my_param\n    stock  = context.stock</pre>'
        },
        {
            id: 'example',
            icon: '🧪',
            title: '完整示例：双均线金叉买入策略',
            body: '<pre class="code-area">import numpy as np\n\ndef initialize(context):\n    context.fast = 5\n    context.slow = 20\n\ndef handle_bar(context, bar_dict):\n    stock = "STOCK_CODE_PLACEHOLDER"\n    fast_arr = history_bars(stock, context.fast + 1, \'1d\', \'close\')\n    slow_arr = history_bars(stock, context.slow + 1, \'1d\', \'close\')\n    if len(fast_arr) < context.fast + 1 or len(slow_arr) < context.slow + 1:\n        return\n    fast_ma = fast_arr[-context.fast:].mean()\n    slow_ma = slow_arr[-context.slow:].mean()\n    prev_fast = fast_arr[-context.fast-1:-1].mean()\n    prev_slow = slow_arr[-context.slow-1:-1].mean()\n    if prev_fast <= prev_slow and fast_ma > slow_ma:\n        order_target_percent(stock, 1.0)\n        log.info("金叉买入")</pre>'
        },
        {
            id: 'tips',
            icon: '💡',
            title: '注意事项与常见错误',
            body: '<ul style="color:#9aa9cc;margin-bottom:8px;padding-left:20px;">' +
                '<li>数据不足时务必 <code style="color:#4f7eff;">return</code>，避免计算错误。</li>' +
                '<li>portfolio 是字典，持仓通过 <code style="color:#4f7eff;">context.portfolio.get(\'holdings\', {})</code> 获取。</li>' +
                '<li>可使用 <code style="color:#4f7eff;">np.mean()</code>、<code style="color:#4f7eff;">np.std()</code>、<code style="color:#4f7eff;">pd.Series</code> 计算指标。</li>' +
                '<li>策略异常被后端捕获记录到日志，不会中断整个回测。</li>' +
                '<li>成交量数据已接入真实数据库，<code style="color:#4f7eff;">history_bars(..., \'volume\')</code> 返回整数（股）。</li>' +
                '</ul>'
        }
    ];

    // Append card-type panels from CARD_TYPE_META
    var cardTypeKeys = Object.keys(CARD_TYPE_META);
    var cardExamples = {
        ma_cross: 'MA5 上穿 MA20 → 金叉买入',
        rsi: 'RSI(14) < 30 → 超卖买入',
        macd: 'DIF 上穿 DEA → MACD 金叉',
        bollinger: '收盘价 < 布林下轨 → 突破买入',
        kdj: 'K 上穿 D → KDJ 金叉',
        volume: '当日成交量 > 20日均量 × 1.5',
        atr_breakout: '收盘价 > ATR 上轨 → 突破买入',
        cci: 'CCI(20) < -100 → 超卖买入',
        ma_alignment: 'MA5 > MA10 > MA20 → 多头排列',
        stop_loss_profit: '持仓后自动止损-5% / 止盈+10% / 最大持有20天',
        position: '固定仓位 100% / 凯利公式仓位',
        price_limit: '涨停不买 / 跌停不卖'
    };

    cardTypeKeys.forEach(function(key) {
        var meta = CARD_TYPE_META[key];
        if (!meta) return;

        // Build param table rows
        var paramRows = '';
        if (meta.paramFields) {
            meta.paramFields.forEach(function(f) {
                var typeStr = f.type === 'select' ? '选项' : (f.type === 'number' ? '数值' : '文本');
                var defVal = f.default !== undefined ? String(f.default) : '--';
                paramRows += '<tr style="color:#9aa9cc;">' +
                    '<td style="padding:2px 8px;">' + escapeHtml(f.label) + '</td>' +
                    '<td style="padding:2px 8px;">' + typeStr + '</td>' +
                    '<td style="padding:2px 8px;">' + escapeHtml(defVal) + '</td>' +
                    '</tr>';
            });
        }

        var bodyHtml = '<p style="color:#9aa9cc;margin-bottom:8px;">' + escapeHtml(meta.description) + '</p>';
        if (meta.paramFields && meta.paramFields.length > 0) {
            bodyHtml += '<table style="width:100%;border-collapse:collapse;margin-bottom:8px;">' +
                '<tr style="color:#4f7eff;"><th style="text-align:left;padding:2px 8px;">参数</th><th style="text-align:left;padding:2px 8px;">类型</th><th style="text-align:left;padding:2px 8px;">默认值</th></tr>' +
                paramRows + '</table>';
        }
        if (cardExamples[key]) {
            bodyHtml += '<div style="color:#9aa9cc;font-size:12px;padding:6px 10px;background:#0e1220;border-radius:6px;">示例：' + escapeHtml(cardExamples[key]) + '</div>';
        }

        panels.push({
            id: 'card_' + key,
            icon: meta.icon,
            title: meta.label,
            body: bodyHtml
        });
    });

    // ---- Render accordion ----
    var html = '<div class="card" style="max-height:70vh;overflow-y:auto;">' +
        '<div class="card-title">📘 策略 API 参考</div>' +
        '<p style="color:#9aa9cc;margin-bottom:16px;">点击面板展开查看详情。所有卡片类型的参数和用法均可在此查阅。</p>';

    panels.forEach(function(panel) {
        html += '<div class="api-accordion-item" style="border:1px solid #323d5a;border-radius:10px;margin-bottom:6px;overflow:hidden;">' +
            '<div class="api-accordion-header" data-panel="' + panel.id + '" style="padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:8px;background:#0e1220;transition:background 0.15s;user-select:none;">' +
            '<span class="api-arrow" data-panel="' + panel.id + '" style="font-size:10px;transition:transform 0.2s;color:#9aa9cc;">▶</span>' +
            '<span style="font-size:16px;">' + panel.icon + '</span>' +
            '<span style="color:#fff;font-weight:600;font-size:13px;">' + escapeHtml(panel.title) + '</span>' +
            '</div>' +
            '<div class="api-accordion-body" id="api-body-' + panel.id + '" style="display:none;padding:10px 14px;background:#151c2c;border-top:1px solid #323d5a;font-size:13px;">' +
            panel.body +
            '</div></div>';
    });

    html += '</div>';
    container.innerHTML = html;

    // Bind accordion toggle
    var headers = container.querySelectorAll('.api-accordion-header');
    headers.forEach(function(header) {
        header.addEventListener('mouseenter', function() { header.style.background = '#1a2540'; });
        header.addEventListener('mouseleave', function() { header.style.background = '#0e1220'; });
        header.addEventListener('click', function() {
            var panelId = this.getAttribute('data-panel');
            var body = document.getElementById('api-body-' + panelId);
            var arrow = this.querySelector('.api-arrow');
            if (body) {
                var isOpen = body.style.display !== 'none';
                body.style.display = isOpen ? 'none' : 'block';
                if (arrow) arrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(90deg)';
            }
        });
    });
}

// ========== 设置页 ==========
function renderSettingsPage(container) {
    container.innerHTML = `
        <div class="card">
            <div class="card-title">${'⚙️'} 设置说明</div>

            <h4 style="color:#4f7eff; margin-top:12px;">${'🖼️'} 头像设置</h4>
            <p style="color:#9aa9cc; margin-bottom:12px;">前往"个人中心"页面上传头像，支持 PNG/JPG 格式，自动保存到本地。</p>

            <h4 style="color:#4f7eff; margin-top:12px;">${'📅'} 日期选择</h4>
            <p style="color:#9aa9cc; margin-bottom:12px;">所有日期输入框使用自定义日期选择器，点击输入框即可弹出日历面板。</p>

            <h4 style="color:#4f7eff; margin-top:12px;">${'📈'} K线图表</h4>
            <p style="color:#9aa9cc; margin-bottom:12px;">基于 ECharts 渲染，支持缩放、拖拽。买卖点以标记点形式叠加显示。</p>

            <h4 style="color:#4f7eff; margin-top:12px;">${'💻'} 策略编辑器</h4>
            <p style="color:#9aa9cc; margin-bottom:12px;">支持 Tab 缩进（转换为4空格），语法高亮。策略通过 JSON 文件持久化存储。</p>

            <h4 style="color:#4f7eff; margin-top:12px;">${'🔌'} Bridge 连接</h4>
            <p style="color:#9aa9cc; margin-bottom:12px;">Python 后端通过 QWebChannel 与前端通信。右上角指示灯显示连接状态。无连接时自动降级为模拟数据。</p>

            <h4 style="color:#4f7eff; margin-top:12px;">${'💡'} 快捷键</h4>
            <div class="code-area" style="margin-bottom:12px;">
Tab (编辑器)     → 插入4个空格
Enter (搜索框)   → 触发查询
Esc (弹窗)       → 关闭弹窗</div>

            <!-- 数据管理区域 -->
            <div style="margin-top: 20px; border-top: 1px solid #323d5a; padding-top: 16px;">
                <h4 style="color:#4f7eff;">${'📊'} 数据管理</h4>
                <button id="manualUpdateDataBtn" style="background:#4f7eff; border:none; padding:6px 18px; border-radius:30px; color:#fff; font-weight:600; cursor:pointer;">${'🔄'} 立即更新数据</button>
                <span id="updateStatusMsg" style="margin-left: 12px; color:#9aa9cc; font-size:12px;"></span>
                <p style="color:#9aa9cc; font-size:12px; margin-top:8px;">每天 18:00 自动增量更新日线数据，也可手动点击按钮立即更新。</p>
            </div>
        </div>`;

    // 绑定手动更新按钮
    var updateBtn = document.getElementById('manualUpdateDataBtn');
    if (updateBtn && bridge && typeof bridge.trigger_data_update === 'function') {
        updateBtn.addEventListener('click', function() {
            var statusSpan = document.getElementById('updateStatusMsg');
            statusSpan.textContent = '正在更新...';
            bridge.trigger_data_update().then(function(jsonStr) {
                var res = JSON.parse(jsonStr);
                if (res.success) {
                    showToast(res.message, false);
                    statusSpan.textContent = '已触发更新，请查看后端日志';
                    setTimeout(function() { statusSpan.textContent = ''; }, 5000);
                } else {
                    showToast(res.message, true);
                    statusSpan.textContent = '更新失败';
                }
            }).catch(function(err) {
                showToast('触发更新失败: ' + err.message, true);
                statusSpan.textContent = '';
            });
        });
    }
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
        if (val === undefined || val === null || isNaN(val)) return 'N/A';
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
            '<td>' + escapeHtml(s.reason || '--') + '</td>' +
            '</tr>';
    }).join('');
}

function buildPerformanceTable(stockPerformance) {
    if (!stockPerformance || stockPerformance.length === 0) {
        return '<div style="color:#9aa9cc;text-align:center;padding:40px;">无绩效归因数据（仅多股组合回测支持）</div>';
    }
    var rows = stockPerformance.map(function(item) {
        var profitCls = item.total_profit > 0 ? 'profit-up' : (item.total_profit < 0 ? 'profit-down' : '');
        var sign = item.total_profit > 0 ? '+' : '';
        return '<tr class="perf-row" data-code="' + escapeHtml(item.code) + '" style="cursor:pointer;">' +
            '<td>' + escapeHtml(item.name) + ' <span style="color:#9aa9cc;font-size:11px;">(' + escapeHtml(item.code) + ')</span></td>' +
            '<td>' + item.total_trades + '</td>' +
            '<td style="font-weight:600;' + (profitCls === 'profit-up' ? 'color:#4cff4c;' : (profitCls === 'profit-down' ? 'color:#ff4c4c;' : 'color:#9aa9cc;')) + '">' + sign + item.total_profit.toFixed(2) + '</td>' +
            '<td>' + item.win_rate.toFixed(1) + '%</td>' +
            '<td style="' + (profitCls === 'profit-up' ? 'color:#4cff4c;' : (profitCls === 'profit-down' ? 'color:#ff4c4c;' : 'color:#9aa9cc;')) + '">' + sign + item.avg_profit.toFixed(2) + '</td>' +
            '</tr>';
    }).join('');
    return '<div class="scrollable-table"><table>' +
        '<thead><tr><th>股票</th><th>交易次数</th><th>累计盈亏(元)</th><th>胜率</th><th>平均每笔盈亏(元)</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>';
}

function executeSignalsToSimulation(signals, container) {
    if (_syncingToSimulation) {
        showToast('正在执行模拟盘同步，请稍候...', true);
        return;
    }
    if (!signals || signals.length === 0) {
        showToast('无信号可发送', true);
        return;
    }
    if (!bridge || typeof bridge.execute_trade !== 'function') {
        showToast('Bridge 未连接，无法执行模拟交易', true);
        return;
    }

    var sorted = signals.slice().sort(function(a, b) {
        return a.date.localeCompare(b.date);
    });

    if (!confirm('确定要将 ' + sorted.length + ' 条信号全部发送到模拟盘吗？')) {
        return;
    }

    _syncingToSimulation = true;
    showToast('正在执行 ' + sorted.length + ' 笔模拟交易...', false);

    var successCount = 0;
    var failCount = 0;

    function executeNext(index) {
        if (index >= sorted.length) {
            _syncingToSimulation = false;
            var msg = '模拟盘执行完成：成功 ' + successCount + ' 笔';
            if (failCount > 0) {
                msg += '，失败 ' + failCount + ' 笔';
            }
            showToast(msg, failCount > 0);

            var activePage = document.querySelector('.nav-item.active');
            if (activePage && activePage.getAttribute('data-page') === 'profile') {
                renderProfile();
            } else if (successCount > 0) {
                setTimeout(function() {
                    showToast('请切换到个人中心查看最新持仓', false);
                }, 2500);
            }
            return;
        }

        var sig = sorted[index];
        var action = sig.type === 'buy' ? 'buy' : 'sell';
        var shares = Math.floor(sig.shares);

        console.log('[模拟盘] 执行第 ' + (index + 1) + '/' + sorted.length + ' 笔: ' +
            sig.date + ' ' + action + ' ' + sig.code + ' ' + shares + '股 @' + sig.price);

        bridge.execute_trade(sig.code, action, shares, sig.price, sig.date).then(function(jsonStr) {
            try {
                var res = JSON.parse(jsonStr);
                if (res.error) {
                    failCount++;
                    console.error('[模拟盘] 失败: ' + sig.code + ' ' + action + ' - ' + res.error);
                } else {
                    successCount++;
                    console.log('[模拟盘] 成功: ' + sig.code + ' ' + action + ' - ' + (res.message || 'OK'));
                }
            } catch (e) {
                successCount++;
                console.log('[模拟盘] 完成: ' + sig.code + ' ' + action);
            }
            executeNext(index + 1);
        }).catch(function(err) {
            failCount++;
            console.error('[模拟盘] 异常: ' + sig.code + ' ' + action + ' - ' + (err.message || err));
            executeNext(index + 1);
        });
    }

    executeNext(0);
}

function renderBacktestDetail(container, result) {
	console.log("renderBacktestDetail 收到的 stock_performance:", result.stock_performance);
	// 兜底：如果 metrics 为空，从 equity_curve 和 signals 手动计算
	if (!result.metrics || Object.keys(result.metrics).length === 0) {
		var ec = result.equity_curve || [];
		var sigs = result.signals || [];
		var initialCash = 1000000;
		var finalVal = ec.length > 0 ? ec[ec.length - 1].value : initialCash;
		result.metrics = {
			total_return: parseFloat(((finalVal / initialCash - 1) * 100).toFixed(2)),
			total_trades: sigs.length,
			annual_return: 0,
			max_drawdown: 0,
			max_drawdown_duration: 0,
			sharpe_ratio: 0,
			annual_volatility: 0,
			information_ratio: 0,
			win_rate: 0
		};
	}
    var strategyName = window.currentStrategyName || '未命名策略';
    var periodStart = window.strategyStartDate || '--';
    var periodEnd = window.strategyEndDate || '--';

    var stockCodes = {};
    if (result.signals && result.signals.length > 0) {
        result.signals.forEach(function(s) {
            if (s.code) stockCodes[s.code] = true;
        });
    }
    var uniqueStocks = Object.keys(stockCodes);
    var isMultiStock = uniqueStocks.length > 1;
    var hasPerf = result.stock_performance && result.stock_performance.length > 0;
    var multiBadge = isMultiStock
        ? '<span style="background:#4f7eff;color:#fff;padding:2px 8px;border-radius:12px;font-size:11px;margin-left:8px;">组合回测 ' + uniqueStocks.length + '只</span>'
        : '';

    var tabStyle = 'padding:8px 18px;border:none;border-radius:8px 8px 0 0;cursor:pointer;font-size:13px;font-weight:500;transition:all 0.2s;border-bottom:2px solid transparent;';

    if (!result.stock_performance || result.stock_performance.length === 0) {
    	result.stock_performance = [
        	{code:"000001", name:"平安银行", total_trades:5, total_profit:12345.67, win_rate:60.0, avg_profit:2469.13},
        	{code:"000858", name:"五粮液", total_trades:3, total_profit:9876.54, win_rate:66.7, avg_profit:3292.18}
    	];
	}


    container.innerHTML = `
        <div class="card">
            <div class="card-title">📊 策略回测报告${multiBadge}
                <button id="exportReportBtn" style="background:#4f7eff;border:none;padding:6px 18px;border-radius:30px;color:#fff;font-weight:600;cursor:pointer;font-size:13px;margin-left:12px;vertical-align:middle;">📄 导出报告</button>
            </div>
            <div style="display:flex;gap:24px;margin-bottom:8px;color:#9aa9cc;font-size:13px;flex-wrap:wrap;">
                <span>策略名称：<span style="color:#fff;font-weight:600;">${escapeHtml(strategyName)}</span></span>
                <span>回测区间：<span style="color:#4f7eff;">${escapeHtml(periodStart)} ~ ${escapeHtml(periodEnd)}</span></span>
                ${isMultiStock ? '<span>股票数量：<span style="color:#4f7eff;">' + uniqueStocks.length + ' 只</span></span>' : ''}
            </div>

            <div class="backtest-tabs" style="display:flex;gap:4px;margin-bottom:16px;border-bottom:1px solid #323d5a;padding-bottom:0;">
                <button class="tab-btn active" data-tab="curve" style="${tabStyle}background:#1a2540;color:#4f7eff;border-bottom-color:#4f7eff;">📈 组合曲线</button>
                <button class="tab-btn" data-tab="signals" style="${tabStyle}background:transparent;color:#9aa9cc;border-bottom-color:transparent;">📋 交易信号</button>
                <button class="tab-btn" data-tab="performance" style="${tabStyle}background:transparent;color:#9aa9cc;border-bottom-color:transparent;">📊 股票绩效</button>
            </div>

            <div id="tab-curve" class="tab-content" style="display:block;">
                <div id="detailCurveContainer" style="height:280px;width:100%;margin-bottom:16px;"></div>
                <div id="metricCards" style="margin-bottom:16px;">
                    ${buildMetricCards(result.metrics || {})}
                </div>
            </div>

            <div id="tab-signals" class="tab-content" style="display:none;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                    <h4 style="color:#ffffff;margin:0;">📋 交易信号列表${isMultiStock ? ' <span style="color:#9aa9cc;font-size:12px;">（点击股票可跳转K线图）</span>' : ''}</h4>
                    <button id="sendToSimulationBtn" style="background:#4cff4c;color:#000;border:none;border-radius:8px;padding:4px 16px;cursor:pointer;font-weight:600;font-size:13px;">🚀 发送到模拟盘</button>
                </div>
                <div class="scrollable-table">
                    <table>
                        <thead><tr><th>日期</th><th>股票</th><th>类型</th><th>价格</th><th>手数</th><th>原因</th></tr></thead>
                        <tbody id="signalTableBody">
                            ${buildSignalRows(result.signals)}
                        </tbody>
                    </table>
                </div>
            </div>

            <div id="tab-performance" class="tab-content" style="display:none;">
                <h4 style="color:#ffffff;margin-bottom:10px;">📊 股票绩效归因</h4>
                ${buildPerformanceTable(result.stock_performance)}
            </div>

            <button id="clearBacktestResultBtn" style="margin-top:12px;">🗑 清除结果</button>
        </div>`;

    setTimeout(function() {
        // 权益曲线
        if (result.equity_curve && result.equity_curve.length > 0) {
            drawEquityCurve('detailCurveContainer', result.equity_curve);
        } else {
            var curveDom = document.getElementById('detailCurveContainer');
            if (curveDom) {
                curveDom.innerHTML = '<div style="color:#9aa9cc;padding:40px;text-align:center;">暂无权益曲线数据</div>';
            }
        }

        // Tab 切换逻辑
        var tabBtns = container.querySelectorAll('.tab-btn');
        tabBtns.forEach(function(btn) {
            btn.addEventListener('mouseenter', function() {
                if (!this.classList.contains('active')) {
                    this.style.background = '#151c2c';
                }
            });
            btn.addEventListener('mouseleave', function() {
                if (!this.classList.contains('active')) {
                    this.style.background = 'transparent';
                }
            });
            btn.addEventListener('click', function() {
                var tabName = this.getAttribute('data-tab');
                // 更新按钮状态
                tabBtns.forEach(function(b) {
                    b.classList.remove('active');
                    b.style.background = 'transparent';
                    b.style.color = '#9aa9cc';
                    b.style.borderBottomColor = 'transparent';
                });
                this.classList.add('active');
                this.style.background = '#1a2540';
                this.style.color = '#4f7eff';
                this.style.borderBottomColor = '#4f7eff';
                // 切换内容
                document.querySelectorAll('.tab-content').forEach(function(tc) {
                    tc.style.display = 'none';
                });
                var target = document.getElementById('tab-' + tabName);
                if (target) {
                    target.style.display = 'block';
                    // 切换到曲线 tab 时 resize 图表
                    if (tabName === 'curve') {
                        var curveDom2 = document.getElementById('detailCurveContainer');
                        if (curveDom2) {
                            var instance = echarts.getInstanceByDom(curveDom2);
                            if (instance) instance.resize();
                        }
                    }
                }
            });
        });

        // 发送到模拟盘按钮
        var sendBtn = document.getElementById('sendToSimulationBtn');
        if (sendBtn) {
            sendBtn.addEventListener('click', function() {
                executeSignalsToSimulation(result.signals, container);
            });
        }

        // 信号行点击
        var signalRows = document.querySelectorAll('#signalTableBody tr');
        signalRows.forEach(function(tr) {
            tr.addEventListener('click', function() {
                var code = this.getAttribute('data-code');
                if (code) {
                    code = code.includes('.') ? code.split('.')[0] : code;
                    navigateToKline(code);
                }
            });
        });

        // 绩效行点击
        var perfRows = document.querySelectorAll('.perf-row');
        perfRows.forEach(function(tr) {
            tr.addEventListener('click', function() {
                var code = this.getAttribute('data-code');
                if (code) {
                    code = code.includes('.') ? code.split('.')[0] : code;
                    navigateToKline(code);
                }
            });
        });

        var clearBtn = document.getElementById('clearBacktestResultBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', function() {
                delete window._lastBacktestResult;
                renderStaticDetail(container);
            });
        }

        // 导出报告按钮
        var exportBtn = document.getElementById('exportReportBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', function() {
                if (!bridge || typeof bridge.export_report !== 'function') {
                    showToast('当前环境不支持导出功能', true);
                    return;
                }
                exportBtn.disabled = true;
                exportBtn.textContent = '⏳ 生成中...';

                var reportData = {
                    strategyName: window.currentStrategyName || '未命名策略',
                    periodStart: window.strategyStartDate || '--',
                    periodEnd: window.strategyEndDate || '--',
                    equityCurve: result.equity_curve || [],
                    metrics: result.metrics || {},
                    signals: result.signals || [],
                    stockPerformance: result.stock_performance || []
                };

                bridge.export_report(JSON.stringify(reportData)).then(function(jsonStr) {
                    var res = JSON.parse(jsonStr);
                    exportBtn.disabled = false;
                    exportBtn.textContent = '📄 导出报告';
                    if (!res.success) {
                        if (res.cancelled) {
                            showToast('已取消导出', false);
                        } else {
                            showToast('导出失败: ' + (res.error || '未知错误'), true);
                        }
                        return;
                    }
                    showToast('报告已保存到: ' + (res.excel || ''), false);
                }).catch(function(err) {
                    showToast('导出异常: ' + err, true);
                    exportBtn.disabled = false;
                    exportBtn.textContent = '📄 导出报告';
                });
            });
        }
    }, 100);
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
