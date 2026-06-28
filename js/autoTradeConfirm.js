// js/autoTradeConfirm.js
// 自动下单确认对话框，支持"30天内不再询问"。
// 通过全局函数 window.onAutoTradeConfirmRequest / window.onAutoTradeConfirmResponse 与后端交互。

var _autoTradeDontAskUntil = null;  // ISO datetime string
var _autoTradePendingOrder = null;
var _autoTradeCallback = null;

/**
 * 由后端 bridge 调用，触发确认对话框。
 * orderInfo: { order_id, stock_code, action, price, volume, message }
 */
window.onAutoTradeConfirmRequest = function(orderInfo) {
    if (typeof orderInfo === 'string') {
        try { orderInfo = JSON.parse(orderInfo); } catch (e) { return; }
    }
    _autoTradePendingOrder = orderInfo;
    showAutoTradeConfirm(orderInfo, function(confirmed, dontAskAgain) {
        var response = {
            order_id: orderInfo.order_id,
            confirmed: confirmed,
            dont_ask_again_30d: dontAskAgain
        };
        if (window.bridge && typeof window.bridge.auto_trade_confirm_response === 'function') {
            window.bridge.auto_trade_confirm_response(JSON.stringify(response));
        }
    });
};

/**
 * 由后端通知，显示在页面上。
 * data: { type, order_id, stock_code, action, price, volume, success, message }
 */
window.onAutoTradeNotification = function(data) {
    if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (e) { return; }
    }
    var type = data.type || 'order_result';
    if (type === 'order_result') {
        var status = data.success ? '成功' : '失败';
        var cls = data.success ? 'profit-positive' : 'profit-negative';
        showToast(
            '[真实下单] ' + data.stock_code + ' ' +
            (data.action === 'buy' ? '买入' : '卖出') + ' ' +
            data.volume + '股 @' + (data.price != null ? data.price.toFixed(2) : '--') +
            ' → ' + status + ': ' + (data.message || ''),
            !data.success
        );
    } else if (type === 'order_rejected') {
        showToast('[真实下单拒绝] ' + (data.message || ''), true, 4000);
    } else if (type === 'order_cancelled') {
        showToast('[真实下单取消] ' + (data.message || ''), false, 3000);
    }
};

/**
 * 显示确认对话框。
 * @param {Object} orderInfo - 订单信息
 * @param {Function} callback - callback(confirmed: bool, dontAskAgain: bool)
 */
function showAutoTradeConfirm(orderInfo, callback) {
    // 检查是否在免确认期内
    if (_autoTradeDontAskUntil) {
        try {
            var until = new Date(_autoTradeDontAskUntil);
            if (new Date() < until) {
                callback(true, false);
                return;
            } else {
                _autoTradeDontAskUntil = null;
                localStorage.removeItem('auto_trade_dont_ask_until');
            }
        } catch (e) {
            _autoTradeDontAskUntil = null;
        }
    }

    _autoTradeCallback = callback;

    // 移除旧弹窗
    var existing = document.getElementById('autoTradeConfirmOverlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'autoTradeConfirmOverlay';
    overlay.style.cssText =
        'position:fixed;top:0;left:0;width:100%;height:100%;' +
        'background:rgba(0,0,0,0.6);z-index:100000;' +
        'display:flex;justify-content:center;align-items:center;';

    var actionText = orderInfo.action === 'buy' ? '买入' : '卖出';
    var actionColor = orderInfo.action === 'buy' ? '#ef5350' : '#26a69a';

    overlay.innerHTML =
        '<div style="background:#1a2135;border:1px solid #4f7eff;border-radius:16px;' +
        'padding:24px;min-width:380px;max-width:480px;box-shadow:0 12px 40px rgba(0,0,0,0.6);">' +
        '<h3 style="color:#fff;margin:0 0 16px 0;font-size:16px;">确认真实下单</h3>' +
        '<div style="background:#0e1220;border-radius:12px;padding:16px;margin-bottom:16px;">' +
        '<div style="display:flex;justify-content:space-between;margin-bottom:8px;">' +
        '<span style="color:#9aa9cc;">股票代码</span>' +
        '<span style="color:#fff;font-weight:600;">' + (orderInfo.stock_code || '--') + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;margin-bottom:8px;">' +
        '<span style="color:#9aa9cc;">操作方向</span>' +
        '<span style="color:' + actionColor + ';font-weight:600;">' + actionText + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;margin-bottom:8px;">' +
        '<span style="color:#9aa9cc;">价格</span>' +
        '<span style="color:#fff;">' + (orderInfo.price != null ? orderInfo.price.toFixed(2) : '--') + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;margin-bottom:8px;">' +
        '<span style="color:#9aa9cc;">数量(股)</span>' +
        '<span style="color:#fff;">' + (orderInfo.volume || 0) + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;">' +
        '<span style="color:#9aa9cc;">预估金额</span>' +
        '<span style="color:#f2c94c;font-weight:600;">' +
        ((orderInfo.price || 0) * (orderInfo.volume || 0)).toLocaleString() + ' 元</span></div>' +
        '</div>' +
        '<div style="margin-bottom:16px;">' +
        '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#9aa9cc;font-size:13px;">' +
        '<input type="checkbox" id="autoTradeDontAskCheck" style="accent-color:#4f7eff;">' +
        '30天内不再询问，自动执行所有订单</label></div>' +
        '<div style="display:flex;gap:12px;justify-content:flex-end;">' +
        '<button id="autoTradeCancelBtn" style="background:#323d5a;border:none;color:#fff;' +
        'padding:8px 24px;border-radius:30px;cursor:pointer;font-size:14px;">取消</button>' +
        '<button id="autoTradeConfirmBtn" style="background:#4f7eff;border:none;color:#fff;' +
        'padding:8px 24px;border-radius:30px;cursor:pointer;font-weight:600;font-size:14px;">确认下单</button>' +
        '</div></div>';

    document.body.appendChild(overlay);

    document.getElementById('autoTradeConfirmBtn').addEventListener('click', function() {
        var dontAsk = document.getElementById('autoTradeDontAskCheck').checked;
        if (dontAsk) {
            var until = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            _autoTradeDontAskUntil = until.toISOString();
            localStorage.setItem('auto_trade_dont_ask_until', _autoTradeDontAskUntil);
        }
        overlay.remove();
        _autoTradeCallback = null;
        callback(true, dontAsk);
    });

    document.getElementById('autoTradeCancelBtn').addEventListener('click', function() {
        overlay.remove();
        _autoTradeCallback = null;
        callback(false, false);
    });

    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) {
            overlay.remove();
            _autoTradeCallback = null;
            callback(false, false);
        }
    });
}

// 页面加载时从 localStorage 恢复免确认截止时间
(function() {
    try {
        var saved = localStorage.getItem('auto_trade_dont_ask_until');
        if (saved) {
            var until = new Date(saved);
            if (new Date() < until) {
                _autoTradeDontAskUntil = saved;
            } else {
                localStorage.removeItem('auto_trade_dont_ask_until');
            }
        }
    } catch (e) {
        _autoTradeDontAskUntil = null;
    }
})();

// 重新导出 showToast 的引用（由 realtimeSim.js 提供，此处提供备用实现）
function showToast(msg, isError, duration) {
    if (typeof window._realtimeShowToast === 'function') {
        window._realtimeShowToast(msg, isError, duration);
        return;
    }
    var tip = document.createElement('div');
    tip.style.cssText =
        'position:fixed;top:20%;left:50%;transform:translateX(-50%);background:' +
        (isError ? '#ff4c4c' : '#4cff4c') +
        ';color:#000;padding:10px 20px;border-radius:8px;z-index:99999;font-weight:600;';
    tip.textContent = msg;
    document.body.appendChild(tip);
    setTimeout(function() { tip.remove(); }, duration || 2000);
}

/**
 * 坐标捕获回调，由后端 bridge 调用。
 * data: { x: int, y: int, target: 'code'|'price'|'volume'|'cancelled'|'timeout'|'error' }
 */
window.onCoordinateCaptured = function(data) {
    if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (e) { return; }
    }

    var x = data.x;
    var y = data.y;
    var target = data.target;

    // 恢复所有捕获按钮颜色，隐藏取消按钮和状态
    setTimeout(function() {
        var btns = document.querySelectorAll('.capture-coord-btn');
        for (var i = 0; i < btns.length; i++) { btns[i].style.background = '#4f7eff'; }
        var statusEl = document.getElementById('atCaptureStatus');
        if (statusEl) { statusEl.style.display = 'none'; }
        var cancelBtn = document.getElementById('atCancelCaptureBtn');
        if (cancelBtn) cancelBtn.style.display = 'none';
    }, 100);

    // 错误：缺少依赖
    if (x === -2 && y === -2) {
        showToast('坐标捕获需要安装 pynput 和 keyboard 库: pip install pynput keyboard', true, 5000);
        return;
    }

    // 取消
    if (target === 'cancelled' || (x === -1 && y === -1 && target === 'cancelled')) {
        showToast('坐标捕获已取消', false, 2000);
        return;
    }

    // 超时
    if (target === 'timeout' || (x === -1 && y === -1)) {
        showToast('坐标捕获超时（30秒无操作），已自动退出', false, 3000);
        return;
    }

    // 成功：自动填充坐标
    var targetField = target || window._coordinateCaptureTarget || 'code';

    // 目标字段 → 元素ID前缀映射
    var prefixMap = {
        code: 'atPgCode',
        price: 'atPgPrice',
        volume: 'atPgVol',
        buybtn: 'atBuyBtn',
        sellbtn: 'atSellBtn',
        confirmyes: 'atConfirmYes',
        confirmno: 'atConfirmNo',
        errorok: 'atErrorOk'
    };
    var labelMap = {
        code: '代码输入', price: '价格输入', volume: '数量输入',
        buybtn: '买入按钮', sellbtn: '卖出按钮',
        confirmyes: '确认"是"', confirmno: '确认"否"',
        errorok: '错误弹窗"确定"'
    };

    var prefix = prefixMap[targetField];
    if (prefix) {
        var elX = document.getElementById(prefix + 'X');
        var elY = document.getElementById(prefix + 'Y');
        if (elX) elX.value = x;
        if (elY) elY.value = y;
    }

    var label = labelMap[targetField] || targetField;
    showToast('坐标已捕获 (' + x + ', ' + y + ')，已自动填入' + label + '输入框', false, 2500);

    // 自动触发保存 pyautogui 配置
    var saveBtn = document.getElementById('atSavePyautoguiBtn');
    if (saveBtn) saveBtn.click();
};
