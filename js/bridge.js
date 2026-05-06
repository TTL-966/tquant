import { stockNameMap } from './stockData.js';

export var bridge = null;
export var bridgeReady = false;
var pendingCallbacks = [];

export function updateBridgeStatus(text, color) {
    var el = document.getElementById('bridgeStatus');
    if (el) {
        el.innerHTML = text;
        el.style.color = color || '#ffffff';
    }
}

export function onBridgeReady(callback) {
    if (bridgeReady && callback) {
        callback();
    } else if (callback) {
        pendingCallbacks.push(callback);
    }
}

export function log(msg) {
    console.log("[Tquant]", msg);
}

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
