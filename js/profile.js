import { bridge, log } from './bridge.js';
import { formatStockDisplayHtml } from './chartRenderer.js';
import { populateStockDatalist, profitClass, formatStockNameOnly } from './main.js';

var _tradeHistoryExpanded = false;

function showToast(msg, isError, duration) {
    var tip = document.createElement('div');
    tip.style.cssText = 'position:fixed;top:20%;left:50%;transform:translateX(-50%);background:' +
        (isError ? '#ff4c4c' : '#4cff4c') + ';color:#000;padding:10px 20px;border-radius:8px;z-index:99999;font-weight:600;';
    tip.textContent = msg;
    document.body.appendChild(tip);
    setTimeout(function() { tip.remove(); }, duration || 2000);
}

export function renderProfile() {
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

function renderDailyAssetsTable(rowsHtml) {
    var tbody = document.getElementById('dailyAssetsTbody');
    if (tbody) { tbody.innerHTML = rowsHtml; }
}

function fetchDailyAssets() {
    var tbody = document.getElementById('dailyAssetsTbody');
    if (!bridge || typeof bridge.get_daily_assets !== 'function') {
        if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#9aa9cc;padding:20px;">暂无可展示的每日收益数据，请先进行模拟交易</td></tr>';
        return;
    }
    bridge.get_daily_assets().then(function(jsonStr) {
        var result = JSON.parse(jsonStr);
        if (!result || !result.dates || result.dates.length === 0) {
            if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#9aa9cc;padding:20px;">暂无可展示的每日收益数据，请先进行模拟交易</td></tr>';
            return;
        }
        var dates = result.dates;
        var cashArr = result.cash || [];
        var dailyReturns = result.daily_returns || [];
        var cumulativeReturns = result.cumulative_returns || [];
        var rows = '';
        for (var i = 0; i < dates.length; i++) {
            var dailyCls = profitClass(dailyReturns[i] || 0);
            var cumCls = profitClass(cumulativeReturns[i] || 0);
            rows += '<tr>' +
                '<td>' + dates[i] + '</td>' +
                '<td>' + (cashArr[i] != null ? cashArr[i].toLocaleString() : '--') + '</td>' +
                '<td class="' + dailyCls + '">' + (dailyReturns[i] != null ? dailyReturns[i].toLocaleString() : '--') + '</td>' +
                '<td class="' + cumCls + '">' + (cumulativeReturns[i] != null ? cumulativeReturns[i].toLocaleString() : '--') + '</td>' +
                '</tr>';
        }
        if (tbody) tbody.innerHTML = rows;
    }).catch(function(err) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#ff4c4c;padding:20px;">加载每日收益数据失败: ' + err + '</td></tr>';
    });
}

function renderProfileWithData(data) {
    var container = document.getElementById('dynamicContent');
    var holdingRows = data.holdings.map(function(h) {
        var showPrice = h.live_price || h.price || h.cost;
        var showProfit = h.live_profit != null ? h.live_profit : (h.profit || 0);
        var profitCls = showProfit >= 0 ? 'profit-positive' : 'profit-negative';
        return '<tr><td>' + formatStockDisplayHtml(h.code) + '</td><td>' + h.shares + '</td><td>' + h.cost.toFixed(2) + '</td><td>' + showPrice.toFixed(2) + '</td><td class="' + profitCls + '">' + showProfit.toFixed(2) + '</td></tr>';
    }).join('');
    var DEFAULT_VISIBLE = 5;
    _tradeHistoryExpanded = false;

    var historySorted = (data.history || []).slice().sort(function(a, b) {
        return b.date.localeCompare(a.date);
    });
    var allTradeRows = historySorted.map(function(t) {
        var typeCls = t.type === '买入' ? 'profit-positive' : 'profit-negative';
        return '<tr><td>' + t.date + '</td><td class="' + typeCls + '">' + t.type + '</td><td>' + formatStockDisplayHtml(t.code) + '</td><td>' + t.price.toFixed(2) + '</td><td>' + t.shares + '</td></tr>';
    });
    var totalTradeCount = allTradeRows.length;
    var allTradeRowsHtml = allTradeRows.join('');
    var visibleTradeRowsHtml = totalTradeCount > DEFAULT_VISIBLE ? allTradeRows.slice(0, DEFAULT_VISIBLE).join('') : allTradeRowsHtml;
    var showTradeToggle = totalTradeCount > DEFAULT_VISIBLE;
    var initCapital = data.initial_capital || 1000000;
    var totalReturn = (data.total_assets - initCapital) / initCapital * 100;
    var returnStr = (totalReturn >= 0 ? '+' : '') + totalReturn.toFixed(2) + '%';
    var returnCls = totalReturn >= 0 ? 'profit-positive' : 'profit-negative';
    var tradeCodes = ['000001', '000858', '300750'];

    container.innerHTML = `
            <div class="card">
                <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
                    <span>📋 当前持仓</span>
                    <span id="portfolioSummaryInline" style="font-size:13px;color:#9aa9cc;">加载盈亏中...</span>
                </div>
                <table><thead><tr><th>股票代码</th><th>持股数</th><th>成本价</th><th>现价</th><th>盈亏</th></tr></thead>
                <tbody>${holdingRows}</tbody></table>
            </div>
            <div class="card">
                <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
                    <span>📜 交易记录</span>
                    <button id="exportTradeCsvBtn" style="background:#2d3a5e;color:#fff;border:none;border-radius:30px;padding:4px 14px;font-size:12px;cursor:pointer;">📥 导出 CSV</button>
                </div>
                <table><thead><tr><th>日期</th><th>类型</th><th>代码</th><th>价格</th><th>数量</th></tr></thead>
                <tbody id="tradeHistoryTbody">${visibleTradeRowsHtml}</tbody></table>
                ${showTradeToggle ? '<div style="text-align:right;margin-top:8px;"><button id="toggleTradeHistoryBtn" style="background:#2d3a5e;color:#fff;border:none;border-radius:30px;padding:6px 18px;font-size:13px;cursor:pointer;">▼ 查看更多 (共 ' + totalTradeCount + ' 条)</button></div>' : ''}
            </div>
            <div class="card">
                <div class="card-title">💰 账户概况</div>
                <div class="account-cards" id="accountCardsContainer">
                    <div class="account-card"><div class="label">总资产</div><div class="value">${data.total_assets.toLocaleString()}</div></div>
                    <div class="account-card"><div class="label">可用资金</div><div class="value">${data.cash.toLocaleString()}</div></div>
                    <div class="account-card"><div class="label">总收益率</div><div class="value ${returnCls}">${returnStr}</div></div>
                    <div class="account-card" id="summaryMarketValue" style="display:none;"><div class="label">持仓总市值</div><div class="value">--</div></div>
                    <div class="account-card" id="summaryCost" style="display:none;"><div class="label">持仓总成本</div><div class="value">--</div></div>
                    <div class="account-card" id="summaryProfit" style="display:none;"><div class="label">浮动盈亏</div><div class="value">--</div></div>
                </div>
                <div class="account-cards" style="margin-top:12px;display:flex;gap:8px;">
                    <button id="closeAllBtn" style="background:#4f7eff;border:none;padding:8px 18px;border-radius:30px;color:#fff;font-weight:600;cursor:pointer;">🚀 一键平仓</button>
                    <button id="resetPortfolioBtn" style="background:#3d3040;border:none;padding:8px 18px;border-radius:30px;color:#fff;font-weight:600;cursor:pointer;">🔄 重置模拟盘</button>
                </div>
            </div>
            <div class="card">
                <div class="card-title">📅 每日持仓收益</div>
                <div class="scrollable-table" style="max-height:300px; overflow-y:auto;">
                    <table>
                        <thead><tr><th>日期</th><th>账户现金</th><th>日收益</th><th>累计收益</th></tr></thead>
                        <tbody id="dailyAssetsTbody"><tr><td colspan="4" style="text-align:center;color:#9aa9cc;padding:20px;">⏳ 加载中...</td></tr></tbody>
                    </table>
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

    // ---- Fetch daily assets ----
    fetchDailyAssets();

    // ---- Fetch portfolio summary ----
    if (bridge && typeof bridge.get_portfolio_summary === 'function') {
        bridge.get_portfolio_summary().then(function(jsonStr) {
            var summary = JSON.parse(jsonStr);
            if (summary.success) {
                var profitCls = summary.total_profit >= 0 ? 'profit-positive' : 'profit-negative';
                var sign = summary.total_profit >= 0 ? '+' : '';
                var mvCard = document.getElementById('summaryMarketValue');
                var costCard = document.getElementById('summaryCost');
                var profitCard = document.getElementById('summaryProfit');
                if (mvCard) { mvCard.style.display = ''; mvCard.querySelector('.value').textContent = summary.total_market_value.toLocaleString(); }
                if (costCard) { costCard.style.display = ''; costCard.querySelector('.value').textContent = summary.total_cost.toLocaleString(); }
                if (profitCard) {
                    profitCard.style.display = '';
                    profitCard.querySelector('.value').className = 'value ' + profitCls;
                    profitCard.querySelector('.value').textContent = sign + summary.total_profit.toFixed(2) + ' (' + sign + summary.profit_pct.toFixed(2) + '%)';
                }
                var inlineEl = document.getElementById('portfolioSummaryInline');
                if (inlineEl) {
                    inlineEl.innerHTML = '浮动盈亏 <span class="' + profitCls + '">' + sign + summary.total_profit.toFixed(2) + ' (' + sign + summary.profit_pct.toFixed(2) + '%)</span>';
                }
            } else {
                var inlineEl = document.getElementById('portfolioSummaryInline');
                if (inlineEl) inlineEl.textContent = '';
            }
        }).catch(function(e) {
            var inlineEl = document.getElementById('portfolioSummaryInline');
            if (inlineEl) inlineEl.textContent = '';
        });
    }

    // ---- Toggle trade history ----
    var toggleBtn = document.getElementById('toggleTradeHistoryBtn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', function() {
            var tbody = document.getElementById('tradeHistoryTbody');
            if (!tbody) return;
            if (_tradeHistoryExpanded) {
                tbody.innerHTML = visibleTradeRowsHtml;
                toggleBtn.textContent = '▼ 查看更多 (共 ' + totalTradeCount + ' 条)';
                _tradeHistoryExpanded = false;
            } else {
                tbody.innerHTML = allTradeRowsHtml;
                toggleBtn.textContent = '▲ 收起';
                _tradeHistoryExpanded = true;
            }
        });
    }

    // ---- Export CSV ----
    var exportBtn = document.getElementById('exportTradeCsvBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', function() {
            if (!historySorted.length) {
                showToast('无交易记录可导出', true);
                return;
            }
            var csvLines = ['日期,类型,代码,价格,数量（股）'];
            historySorted.forEach(function(t) {
                csvLines.push([t.date, t.type, t.code, t.price, t.shares].join(','));
            });
            var csvContent = csvLines.join('\n');
            if (bridge && typeof bridge.save_text_file === 'function') {
                bridge.save_text_file(csvContent, 'trade_history.csv').then(function(jsonStr) {
                    var res = JSON.parse(jsonStr);
                    if (res.success) {
                        showToast('已导出到: ' + res.path, false);
                    } else if (!res.cancelled) {
                        showToast('导出失败', true);
                    }
                }).catch(function(err) {
                    showToast('导出失败: ' + err, true);
                });
            } else {
                showToast('导出功能不可用', true);
            }
        });
    }

    // ---- Close all positions ----
    var closeAllBtn = document.getElementById('closeAllBtn');
    if (closeAllBtn) {
        closeAllBtn.addEventListener('click', function() {
            if (!confirm('确定以当前市价平掉所有持仓吗？此操作不可撤销。')) return;
            if (!bridge || typeof bridge.close_all_positions !== 'function') {
                showToast('Bridge 未连接', true);
                return;
            }
            closeAllBtn.disabled = true;
            closeAllBtn.textContent = '⏳ 平仓中...';
            bridge.close_all_positions().then(function(jsonStr) {
                var res = JSON.parse(jsonStr);
                if (res.success) {
                    showToast(res.message, false);
                    renderProfile();
                } else {
                    showToast('平仓失败: ' + (res.error || '未知错误'), true);
                    closeAllBtn.disabled = false;
                    closeAllBtn.textContent = '🚀 一键平仓';
                }
            }).catch(function(err) {
                showToast('平仓失败: ' + err, true);
                closeAllBtn.disabled = false;
                closeAllBtn.textContent = '🚀 一键平仓';
            });
        });
    }

    // ---- Reset portfolio ----
    var resetBtn = document.getElementById('resetPortfolioBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', function() {
            if (!confirm('重置模拟盘将清空所有持仓和交易记录，恢复初始资金（默认 100 万）。确定吗？')) return;
            if (!bridge || typeof bridge.reset_portfolio !== 'function') {
                showToast('Bridge 未连接', true);
                return;
            }
            resetBtn.disabled = true;
            resetBtn.textContent = '⏳ 重置中...';
            bridge.reset_portfolio().then(function(jsonStr) {
                var res = JSON.parse(jsonStr);
                if (res.success) {
                    showToast(res.message, false);
                    renderProfile();
                } else {
                    showToast('重置失败: ' + (res.error || '未知错误'), true);
                    resetBtn.disabled = false;
                    resetBtn.textContent = '🔄 重置模拟盘';
                }
            }).catch(function(err) {
                showToast('重置失败: ' + err, true);
                resetBtn.disabled = false;
                resetBtn.textContent = '🔄 重置模拟盘';
            });
        });
    }

    populateStockDatalist('tradeStockList', tradeCodes);
    document.getElementById('tradeStockSelect').value = formatStockNameOnly(tradeCodes[0]);

    document.getElementById('tradeBuyBtn').onclick = function() { doTrade('buy'); };
    document.getElementById('tradeSellBtn').onclick = function() { doTrade('sell'); };
}

function doTrade(action) {
    var code = document.getElementById('tradeStockSelect').value;
    var shares = parseInt(document.getElementById('tradeShares').value);
    var price = parseFloat(document.getElementById('tradePrice').value);
    if (!bridge) { document.getElementById('tradeResult').innerText = 'bridge未连接'; return; }
    bridge.execute_trade(code, action, shares, price, "").then(function(jsonStr) {
        var res = JSON.parse(jsonStr);
        document.getElementById('tradeResult').innerText = res.message;
        renderProfile();
    }).catch(function(err) {
        document.getElementById('tradeResult').innerText = '交易失败: ' + err;
    });
}
