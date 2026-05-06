import { bridge, log } from './bridge.js';
import { formatStockDisplayHtml } from './chartRenderer.js';
import { populateStockDatalist } from './main.js';

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
                    <div class="account-card"><div class="label">总收益率</div><div class="value ${returnCls}">${returnStr}</div></div>
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
