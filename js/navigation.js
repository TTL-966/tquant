import { bridge } from './bridge.js';
import { fetchAndRenderKline, runBacktest, buyPoints, sellPoints, autoRunBacktest, autoBacktestScheduled } from './kline.js';
import { renderProfile } from './profile.js';
import { renderStockKline, drawDetailCurve, formatStockDisplayHtml } from './chartRenderer.js';
import { initDatePicker, bindDatePicker } from './datepicker.js';
import { stockNameMap, tradeStockLibrary, backtestStrategies, dailyHoldings, fetchStockName, searchStockSuggestions } from './stockData.js';
import { debounceSuggestions } from './suggestions.js';
import { formatStockNameOnly, populateStockDatalist, profitClass, escapeHtml, loadAvatarPreview, saveAvatarToStorage } from './main.js';
import { renderStrategyPage } from './strategy.js';   // 新增导入

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

export function loadPage(pageId) {
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
            var runBtn = document.getElementById('runBacktestBtn');
            var refreshBtn = document.getElementById('refreshKlineBtn');
            if (runBtn) runBtn.onclick = function() {
                runBacktest(currentStockCode, startDateInput.value, endDateInput.value);
            };
            if (refreshBtn) refreshBtn.onclick = function() {
                fetchAndRenderKline(currentStockCode, startDateInput.value, endDateInput.value);
            };
            buyPoints.length = 0;
            sellPoints.length = 0;
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
                    <div class="card-title" style="display:flex; justify-content:space-between; align-items:center;">
                        <span>📉 <span id="mainStockTitle">个股详情</span></span>
                        <span id="stockPriceBar" style="font-size:14px; padding-right:4px;"></span>
                    </div>
                    <div class="stock-search-row" style="position: relative;">
                        <input type="text" id="stockCodeInput" placeholder="股票代码" value="000001" style="background:#1e253b; border:1px solid #323d5a; padding:8px 14px; border-radius:30px; color:#ffffff; width:120px;">
                        <button id="stockSearchBtn">查询K线</button>
                    </div>
                    <div id="stockSuggestionsContainer" style="position: absolute; z-index: 1000; width: 200px; max-height: 200px; overflow-y: auto; background: #1a2135; border:1px solid #2a314a; border-radius: 8px; display: none;"></div>
                    <div id="stockInfoDisplay" style="margin: 12px 0; padding: 8px 16px; background: #1a2135; border-radius: 12px; min-height: 40px;"></div>
                    <div id="stockKlineChart" class="kline-container" style="height:460px;"></div>
                    <div style="margin-top:12px;">
                        
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
                // 获取最新价与涨跌幅
                function updatePriceBar(code) {
                    if (!bridge || typeof bridge.get_latest_price !== 'function') {
                        var bar = document.getElementById('stockPriceBar');
                        if (bar) bar.innerHTML = '最新价: 暂无数据';
                        return;
                    }
                    bridge.get_latest_price(code).then(function(jsonStr) {
                        var data = JSON.parse(jsonStr);
                        var bar = document.getElementById('stockPriceBar');
                        if (!bar) return;
                        if (data.error) {
                            bar.innerHTML = '最新价: ' + data.error;
                            return;
                        }
                        var price = data.price;
                        var change = data.change;
                        var changePct = data.change_pct;
                        var color = change >= 0 ? '#ff4c4c' : '#4cff4c';
                        var sign = change >= 0 ? '+' : '';
                        bar.innerHTML = '最新价: <b style="color:' + color + ';">' + price.toFixed(2) + '</b> ' +
                                        sign + change.toFixed(2) + ' (' + sign + changePct.toFixed(2) + '%)';

                        // 获取行业信息并追加
                        bridge.get_industry(code).then(function(indJson) {
                            var indData = JSON.parse(indJson);
                            var industry = indData.industry || '未知';
                            var indSpan = document.createElement('span');
                            indSpan.style.cssText = 'color:#9aa9cc; margin-left:12px; cursor:pointer; text-decoration:underline;';
                            indSpan.textContent = '行业: ' + industry;
                            indSpan.addEventListener('click', function(e) {
                                e.stopPropagation();
                                bridge.get_stocks_by_industry(industry).then(function(stkJson) {
                                    showIndustryPopup(stkJson, industry);
                                });
                            });
                            bar.appendChild(indSpan);
                        }).catch(function() {
                            // 行业获取失败，忽略
                        });
                    }).catch(function() {
                        var bar = document.getElementById('stockPriceBar');
                        if (bar) bar.innerHTML = '最新价: 获取失败';
                    });
                }

                fetchStockName(stockCode, bridge).then(function() {
                    updateStockInfo(stockCode);
                    updatePriceBar(stockCode);
                    if (!bridge) {
                        stockInfoDisplay.innerHTML = '⚠️ Bridge 未连接，无法查询';
                        return;
                    }
                    var callPromise = bridge.get_kline_data(stockCode, "2010-01-01", "2026-12-31", 500);
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
            // 暴露 loadStock 引用，供浮层点击切换股票使用
            window._loadStockRef = loadStock;

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
        container.innerHTML = '';
        renderStrategyPage(container);
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

export function navigateToKline(code) {
    currentStockCode = code;
    autoRunBacktest = true;
    document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
    var target = document.querySelector('.nav-item[data-page="kchart"]');
    if (target) target.classList.add('active');
    loadPage('kchart');
}
