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
    // 5 秒后若未连接则弹窗提醒
    var _bridgeTimeout = setTimeout(function() {
        if (!bridgeReady && !document.getElementById('bridgeErrorOverlay')) {
            var ov = document.createElement('div');
            ov.id = 'bridgeErrorOverlay';
            ov.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center;';
            ov.innerHTML = '<div style="background:#1a1f35;border:1px solid #e74c3c;border-radius:12px;padding:24px;text-align:center;max-width:400px;">' +
                '<div style="font-size:48px;margin-bottom:12px;">⚠️</div>' +
                '<div style="color:#fff;font-size:16px;font-weight:600;margin-bottom:8px;">后端未连接</div>' +
                '<div style="color:#9aa9cc;font-size:13px;margin-bottom:16px;">请确认 Tquant.exe 和数据库文件在同一目录，然后重新启动程序。</div>' +
                '<button onclick="document.getElementById(\'bridgeErrorOverlay\').remove()" style="background:#e74c3c;border:none;padding:8px 24px;border-radius:20px;color:#fff;cursor:pointer;">关闭</button></div>';
            document.body.appendChild(ov);
        }
    }, 5000);

    if (typeof QWebChannel !== 'undefined' && typeof qt !== 'undefined' && qt.webChannelTransport) {
        new QWebChannel(qt.webChannelTransport, function(channel) {
            bridge = channel.objects.bridge;
            bridgeReady = true;
            clearTimeout(_bridgeTimeout);
            updateBridgeStatus("🔌 Bridge: 已连接", "#4caf50");
            // 3 秒后自动隐藏
            setTimeout(function() {
                var el = document.getElementById('bridgeStatus');
                if (el) { el.style.opacity = '0'; el.style.transition = 'opacity 0.5s'; }
            }, 3000);
            pendingCallbacks.forEach(function(cb) { cb(); });
            pendingCallbacks = [];

            if (typeof bridge.ping === 'function') {
                bridge.ping().then(function(reply) {
                    log("ping 响应: " + reply);
                }).catch(function(err) {
                    log("ping 失败: " + err);
                });
            }

            // 启动时检查降级通知（延迟 1s 确保页面已加载）
            setTimeout(function() {
                if (typeof bridge.get_degradation_notice === 'function') {
                    bridge.get_degradation_notice().then(function(jsonStr) {
                        try {
                            var res = JSON.parse(jsonStr);
                            if (res.success && res.notice) {
                                console.log('[Bridge] 降级通知:', res.notice.message);
                                // 触发自定义事件，由 settings.js 处理
                                window.dispatchEvent(new CustomEvent('tquant:degradation', {
                                    detail: res.notice
                                }));
                            }
                        } catch (e) {}
                    }).catch(function() {});
                }
            }, 1000);

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
