// js/realtimeSim.js
// Multi-stock realtime simulation page: quote table, stock pool, signals, portfolio, logs.

import { bridge } from './bridge.js';
import { formatStockNameOnly } from './main.js';
import { formatStockDisplayHtml } from './chartRenderer.js';
import { Logger } from './logger.js';

const MAX_STOCKS = 30;

// 动态轮询间隔：根据股票数量自动调整
function getDynamicInterval(stockCount) {
    if (stockCount <= 10) return 3;
    if (stockCount <= 20) return 5;
    return 8;
}

var _quoteTableTimer = null;
var _signalPollTimer = null;
var _portfolioTimer = null;
var _logPollTimer = null;
var _isRunning = false;
var _signalLogger = null;
var _allSignals = [];
var _currentStockCodes = [];

function showToast(msg, isError, duration) {
    var tip = document.createElement('div');
    tip.style.cssText = 'position:fixed;top:20%;left:50%;transform:translateX(-50%);background:' +
        (isError ? '#ff4c4c' : '#4cff4c') + ';color:#000;padding:10px 20px;border-radius:8px;z-index:99999;font-weight:600;';
    tip.textContent = msg;
    document.body.appendChild(tip);
    setTimeout(function() { tip.remove(); }, duration || 2000);
}

function profitClass(val) {
    if (val > 0) return 'profit-positive';
    if (val < 0) return 'profit-negative';
    return '';
}

function fmtVolume(vol) {
    if (vol >= 1e8) return (vol / 1e8).toFixed(2) + '亿股';
    if (vol >= 1e4) return (vol / 1e4).toFixed(1) + '万股';
    return vol + '股';
}

export function renderRealtimeSimPage(container) {
    container.innerHTML = buildHtml();
    _isRunning = false;
    _allSignals = [];
    _currentStockCodes = [];

    _signalLogger = new Logger('realtimeLogBox', 'realtimeLogToolbar', { maxEntries: 500 });
    _signalLogger.init();
    _signalLogger.addLog('info', '多股实时模拟页面已加载');

    var codeArea = document.getElementById('rtMultiStrategyCode');
    var cashInput = document.getElementById('rtMultiCash');

    // Pre-fill from strategy builder (one-click transfer) — 优先级最高
    var filledFromParams = false;
    if (window._realtimeSimParams) {
        fillFormFromConfig(window._realtimeSimParams);
        filledFromParams = true;
        if (_signalLogger) _signalLogger.addLog('info', '已从策略工厂导入参数');
        // 延迟清除：等待策略启动后再清除，避免页面切换后丢失
    }

    // Pre-fill from context (仅在没有 _realtimeSimParams 时生效)
    if (!filledFromParams) {
        if (codeArea && window.currentStrategyCode) {
            codeArea.value = window.currentStrategyCode;
        }
        var nameInput = document.getElementById('rtMultiStrategyName');
        if (nameInput && window.currentStrategyName) {
            nameInput.value = window.currentStrategyName;
        }
        if (cashInput && window._initialCapital) {
            cashInput.value = window._initialCapital;
        }
    }

    bindEvents();
    startBackgroundPolling();
}

export function resumeUIIfEngineRunning() {
    if (!bridge || typeof bridge.get_multi_realtime_signals !== 'function') return;

    bridge.get_multi_realtime_signals().then(function(jsonStr) {
        var data = JSON.parse(jsonStr);
        if (!data.running) return;

        _isRunning = true;
        _currentStockCodes = data.stock_codes || [];
        updateRunningState(true);
        updateStockCount();
        if (_signalLogger) _signalLogger.addLog('info', '检测到策略引擎正在运行，正在恢复状态...');

        // 从后端加载当前策略配置并填充表单
        restoreFormFromBackend();

        // 立即拉取所有数据，不等待轮询周期
        restoreAllState();
    }).catch(function() { /* ignore */ });
}

function restoreFormFromBackend() {
    if (!bridge.get_current_realtime_config) return;
    bridge.get_current_realtime_config().then(function(jsonStr) {
        try {
            var data = JSON.parse(jsonStr);
            if (data.success && data.config) {
                fillFormFromConfig(data.config);
                if (_signalLogger) _signalLogger.addLog('info', '已从后端恢复策略配置');
            }
        } catch (e) { /* ignore */ }
    }).catch(function() { /* ignore */ });
}

function restoreAllState() {
    // 并行拉取：信号历史、持仓、全部日志
    var promises = [];

    // 1. 信号历史
    if (bridge.get_multi_realtime_all_signals) {
        promises.push(
            bridge.get_multi_realtime_all_signals().then(function(jsonStr) {
                try {
                    var data = JSON.parse(jsonStr);
                    if (data.success && data.signals) {
                        _allSignals = data.signals;
                        renderSignalTable();
                    }
                } catch (e) { /* ignore */ }
            }).catch(function() { /* ignore */ })
        );
    }

    // 2. 持仓
    promises.push(
        fetchPortfolio().catch(function() { /* ignore */ })
    );

    // 3. 行情报价
    promises.push(
        updateQuoteTable().catch(function() { /* ignore */ })
    );

    // 4. 全部日志
    if (bridge.get_multi_realtime_all_logs) {
        promises.push(
            bridge.get_multi_realtime_all_logs().then(function(jsonStr) {
                try {
                    var data = JSON.parse(jsonStr);
                    if (data.success && data.logs && _signalLogger) {
                        for (var i = 0; i < data.logs.length; i++) {
                            _signalLogger.addLog('info', data.logs[i]);
                        }
                    }
                } catch (e) { /* ignore */ }
            }).catch(function() { /* ignore */ })
        );
    }

    // 所有数据拉取完成后启动轮询
    Promise.all(promises).then(function() {
        if (_signalLogger) _signalLogger.addLog('info', '状态恢复完成');
    }).catch(function() { /* ignore */ });

    // 启动信号和日志轮询（行情/持仓轮询已由 renderRealtimeSimPage 启动）
    startSignalPolling();
    startLogPolling();
}

function fillFormFromConfig(config) {
    // 填充股票池
    if (config.stock_codes && config.stock_codes.length > 0) {
        var poolInput = document.getElementById('rtStockPoolInput');
        if (poolInput) {
            var codes = Array.isArray(config.stock_codes) ? config.stock_codes.join(',') : config.stock_codes;
            poolInput.value = codes;
            updateStockCount();
        }
    }
    // 填充股票池（stockPool 兼容策略工厂传递的格式）
    if (config.stockPool && config.stockPool.length > 0) {
        var poolInput2 = document.getElementById('rtStockPoolInput');
        if (poolInput2) {
            poolInput2.value = config.stockPool.join(',');
            updateStockCount();
        }
    }
    // 填充策略代码
    if (config.strategy_code || config.strategyCode) {
        var codeArea = document.getElementById('rtMultiStrategyCode');
        if (codeArea) codeArea.value = config.strategy_code || config.strategyCode || '';
    }
    // 填充资金
    if (config.cash) {
        var cashInput = document.getElementById('rtMultiCash');
        if (cashInput) cashInput.value = config.cash;
    }
    // 填充轮询间隔
    if (config.interval) {
        var intervalInput = document.getElementById('rtMultiInterval');
        if (intervalInput) intervalInput.value = config.interval;
    }
    // 填充交易成本参数
    if (config.commission_rate !== undefined) {
        var commInput = document.getElementById('rtCommission');
        if (commInput) commInput.value = config.commission_rate;
    }
    if (config.stamp_tax_rate !== undefined) {
        var taxInput = document.getElementById('rtStampTax');
        if (taxInput) taxInput.value = config.stamp_tax_rate;
    }
    if (config.slippage_cost_type) {
        var slipType = document.getElementById('rtSlippageType');
        if (slipType) slipType.value = config.slippage_cost_type;
        var slipInp = document.getElementById('rtSlippageTypeInput');
        if (slipInp) slipInp.value = config.slippage_cost_type === 'fixed' ? '固定点数(元)' : '百分比';
    }
    if (config.slippage_cost_value !== undefined) {
        var slipVal = document.getElementById('rtSlippageValue');
        if (slipVal) slipVal.value = config.slippage_cost_value;
    }
}

export function cleanupRealtimeSim() {
    stopSignalPolling();
    stopLogPolling();
    stopBackgroundPolling();
}

// Backward compatibility for navigation.js
window._realtimeSimCleanup = cleanupRealtimeSim;

// ---------- 自定义下拉面板（解决 QtWebEngine select 样式问题）----------
function showCustomSelect(input, options, callback) {
    closeCustomSelect();
    if (!options || options.length === 0) return;

    var panel = document.createElement('div');
    panel.className = 'custom-select-panel';
    panel.style.cssText = 'position:fixed; z-index:99999; background:#1a2135; border:1px solid #4f7eff; border-radius:12px; padding:6px 0; max-height:250px; overflow-y:auto; min-width:200px; box-shadow:0 8px 20px rgba(0,0,0,0.5);';

    options.forEach(function(opt) {
        var item = document.createElement('div');
        item.style.cssText = 'padding:8px 16px; cursor:pointer; color:#fff; font-size:13px; white-space:nowrap;';
        item.textContent = opt.label;
        item.setAttribute('data-value', opt.value);
        item.addEventListener('mouseenter', function() { item.style.background = '#2d3a5e'; });
        item.addEventListener('mouseleave', function() { item.style.background = 'transparent'; });
        item.addEventListener('click', function(e) {
            e.stopPropagation();
            input.value = opt.label;
            input.setAttribute('data-value', opt.value);
            panel.remove();
            if (typeof callback === 'function') callback(opt.value);
        });
        panel.appendChild(item);
    });

    document.body.appendChild(panel);

    var rect = input.getBoundingClientRect();
    panel.style.left = rect.left + 'px';
    panel.style.top = (rect.bottom + 4) + 'px';

    setTimeout(function() {
        document.addEventListener('click', closeCustomSelectOnClick);
    }, 0);
}

function closeCustomSelectOnClick(e) {
    var panel = document.querySelector('.custom-select-panel');
    if (panel && !panel.contains(e.target)) {
        closeCustomSelect();
    }
}

function closeCustomSelect() {
    var panel = document.querySelector('.custom-select-panel');
    if (panel) panel.remove();
    document.removeEventListener('click', closeCustomSelectOnClick);
}

// ---------- 页面可见性处理：隐藏时暂停轮询，节省资源 ----------
var _visibilityPaused = false;
document.addEventListener('visibilitychange', function() {
    if (document.hidden && !_visibilityPaused) {
        _visibilityPaused = true;
        stopSignalPolling();
        stopLogPolling();
        stopBackgroundPolling();
    } else if (!document.hidden && _visibilityPaused) {
        _visibilityPaused = false;
        if (_isRunning) {
            startBackgroundPolling();
            startSignalPolling();
            startLogPolling();
        } else {
            startBackgroundPolling();
        }
    }
});

// ---------- HTML ----------
function buildHtml() {
    return '<div class="card">' +
        '<div class="card-title">⚡ 多股实时模拟交易</div>' +
        buildControlCard() +
        '</div>' +
        '<div class="card">' +
        '<div class="card-title">📊 持仓行情</div>' +
        buildQuoteTableCard() +
        '</div>' +
        '<div class="card">' +
        '<div class="card-title">📋 交易信号</div>' +
        buildSignalCard() +
        '</div>' +
        '<div class="card">' +
        '<div class="card-title">💼 模拟持仓</div>' +
        buildPortfolioCard() +
        '</div>' +
        '<div class="card">' +
        '<div class="card-title">📝 运行日志</div>' +
        buildLogCard() +
        '</div>';
}

function buildControlCard() {
    return '<div class="metric-row" style="margin-bottom:8px;">' +
        '<span>策略名称:</span>' +
        '<input type="text" id="rtMultiStrategyName" placeholder="策略名称" ' +
        'style="width:140px;background:#1e253b;border:1px solid #323d5a;border-radius:30px;color:#fff;padding:6px 10px;font-size:13px;">' +
        '<span>初始资金:</span>' +
        '<input type="number" id="rtMultiCash" min="10000" max="10000000" step="10000" value="100000" ' +
        'style="width:120px;background:#1e253b;border:1px solid #323d5a;border-radius:30px;color:#fff;padding:6px 10px;font-size:13px;">' +
        '<span>轮询间隔(秒):</span>' +
        '<input type="number" id="rtMultiInterval" min="3" max="60" step="1" value="3" ' +
        'style="width:65px;background:#1e253b;border:1px solid #323d5a;border-radius:30px;color:#fff;padding:6px 10px;font-size:13px;">' +
        '</div>' +
        '<div class="metric-row" style="margin-bottom:8px;">' +
        '<span>佣金率:</span>' +
        '<input type="number" id="rtCommission" value="0.0003" step="0.0001" min="0" max="0.003" ' +
        'style="width:90px;background:#1e253b;border:1px solid #323d5a;border-radius:30px;color:#fff;padding:6px 10px;font-size:13px;">' +
        '<span>印花税率:</span>' +
        '<input type="number" id="rtStampTax" value="0.001" step="0.0001" min="0" max="0.003" ' +
        'style="width:90px;background:#1e253b;border:1px solid #323d5a;border-radius:30px;color:#fff;padding:6px 10px;font-size:13px;">' +
        '<span>滑点类型:</span>' +
        '<select id="rtSlippageType" style="display:none;">' +
        '<option value="percent">百分比</option>' +
        '<option value="fixed">固定点数(元)</option>' +
        '</select>' +
        '<input id="rtSlippageTypeInput" type="text" readonly value="百分比" ' +
        'style="width:120px;background:#1e253b;border:1px solid #323d5a;border-radius:30px;color:#fff;padding:6px 10px;font-size:13px;cursor:pointer;">' +
        '<span>滑点值:</span>' +
        '<input type="number" id="rtSlippageValue" value="0.1" step="0.01" min="0" ' +
        'style="width:80px;background:#1e253b;border:1px solid #323d5a;border-radius:30px;color:#fff;padding:6px 10px;font-size:13px;">' +
        '</div>' +
        '<div class="metric-row" style="margin-bottom:6px;">' +
        '<span>股票池 (逗号分隔，最多' + MAX_STOCKS + '只):</span>' +
        '<span id="rtStockCount" style="color:#4f7eff;font-weight:600;margin-left:4px;">0/' + MAX_STOCKS + '</span>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-bottom:8px;">' +
        '<textarea id="rtStockPoolInput" rows="2" placeholder="如: 000001,000858,600519" ' +
        'style="flex:1;background:#0b0e1a;border:1px solid #2a3145;border-radius:12px;color:#fff;font-family:monospace;padding:10px;font-size:13px;resize:none;"></textarea>' +
        '<div style="display:flex;flex-direction:column;gap:6px;">' +
        '<button id="rtImportHoldingsBtn" style="background:#323d5a;border:none;color:#9aa9cc;padding:6px 12px;border-radius:20px;cursor:pointer;font-size:12px;white-space:nowrap;">从持仓导入</button>' +
        '<button id="rtClearPoolBtn" style="background:#323d5a;border:none;color:#9aa9cc;padding:6px 12px;border-radius:20px;cursor:pointer;font-size:12px;">清空</button>' +
        '</div>' +
        '</div>' +
        '<div class="metric-row" style="margin-bottom:8px;">' +
        '<span>策略代码:</span>' +
        '</div>' +
        '<textarea id="rtMultiStrategyCode" rows="8" placeholder="在此粘贴策略代码..." ' +
        'style="width:100%;background:#0b0e1a;border:1px solid #2a3145;border-radius:16px;color:#fff;font-family:\'Fira Code\',monospace;padding:14px;font-size:13px;resize:vertical;box-sizing:border-box;"></textarea>' +
        '<div style="display:flex;gap:12px;align-items:center;margin-top:12px;">' +
        '<button id="rtMultiStartBtn" style="background:#4caf50;border:none;padding:8px 24px;border-radius:30px;color:#fff;font-weight:600;cursor:pointer;font-size:14px;">▶ 启动多股策略</button>' +
        '<button id="rtMultiStopBtn" style="background:#f44336;border:none;padding:8px 24px;border-radius:30px;color:#fff;font-weight:600;cursor:pointer;font-size:14px;" disabled>⏹ 停止策略</button>' +
        '<span id="rtMultiStatus" style="color:#9aa9cc;font-size:13px;font-weight:500;">● 未启动</span>' +
        '<button id="rtAdvancedToggle" style="background:#323d5a;border:none;color:#9aa9cc;padding:6px 14px;border-radius:20px;cursor:pointer;font-size:12px;margin-left:auto;">⚙ 高级设置</button>' +
        '</div>' +
        '<div id="rtAdvancedPanel" style="display:none;margin-top:8px;padding:10px;background:#0e1220;border:1px solid #2a3145;border-radius:12px;">' +
        '<div class="metric-row" style="margin-bottom:4px;">' +
        '<span style="font-size:12px;color:#9aa9cc;">自定义轮询间隔 (3-30秒，0=自动):</span>' +
        '<input type="number" id="rtCustomInterval" min="0" max="30" step="1" value="0" ' +
        'style="width:65px;background:#1e253b;border:1px solid #323d5a;border-radius:30px;color:#fff;padding:6px 10px;font-size:13px;">' +
        '<span style="font-size:11px;color:#666;">(0=根据股票数量自动: ≤10→3s, 11-20→5s, 21-30→8s)</span>' +
        '</div>' +
        '</div>' +
        // 真实下单控制栏
        '<div style="margin-top:10px;padding:10px;background:#0e1220;border:1px solid #2a3145;border-radius:12px;">' +
        '<div class="metric-row" style="align-items:center;gap:10px;">' +
        '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;">' +
        '<input type="checkbox" id="enableRealTrade" style="accent-color:#4f7eff;">' +
        '<span style="color:#fff;font-size:13px;">同时真实下单</span></label>' +
        '<input type="text" id="realTradeModeInput" readonly data-value="pyautogui" value="pyautogui" ' +
        'style="width:110px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 8px;font-size:12px;cursor:pointer;">' +
        '<select id="realTradeMode" style="display:none;">' +
        '<option value="pyautogui">pyautogui</option>' +
        '<option value="easytrader">easytrader</option></select>' +
        '<button id="rtAutoTradeConfigBtn" style="background:#323d5a;border:none;color:#9aa9cc;padding:4px 12px;border-radius:20px;cursor:pointer;font-size:12px;">⚙ 下单配置</button>' +
        '<span id="rtAutoTradeStatus" style="color:#9aa9cc;font-size:12px;">● 未启用</span>' +
        '<button id="rtEmergencyStopBtn" style="background:#e74c3c;border:none;color:#fff;padding:4px 14px;border-radius:20px;cursor:pointer;font-size:12px;display:none;">⏹ 紧急停止</button>' +
        '<button id="rtResetStopBtn" style="background:#27ae60;border:none;color:#fff;padding:4px 14px;border-radius:20px;cursor:pointer;font-size:12px;display:none;">▶ 重置停止</button>' +
        '</div></div>';
}

function buildQuoteTableCard() {
    return '<div class="scrollable-table" style="max-height:280px;overflow-y:auto;">' +
        '<table><thead><tr><th>股票</th><th>最新价</th><th>涨跌幅</th><th>开盘</th><th>最高</th><th>最低</th><th>成交量</th></tr></thead>' +
        '<tbody id="rtQuoteTbody"><tr><td colspan="7" style="text-align:center;color:#9aa9cc;">暂无持仓</td></tr></tbody>' +
        '</table></div>';
}

function buildSignalCard() {
    return '<div class="scrollable-table" style="max-height:300px;overflow-y:auto;">' +
        '<table><thead><tr><th>时间</th><th>股票</th><th>方向</th><th>价格</th><th>数量</th><th>原因</th></tr></thead>' +
        '<tbody id="rtMultiSignalsTbody"><tr><td colspan="6" style="text-align:center;color:#9aa9cc;">暂无信号</td></tr></tbody>' +
        '</table></div>';
}

function buildPortfolioCard() {
    return '<div id="rtMultiPortfolioContainer">' +
        '<div class="account-cards" id="rtMultiAccountCards" style="margin-bottom:12px;">' +
        '<div class="account-card"><div class="label">总资产</div><div class="value" id="rtMultiTotalAssets">--</div></div>' +
        '<div class="account-card"><div class="label">可用资金</div><div class="value" id="rtMultiCash">--</div></div>' +
        '<div class="account-card"><div class="label">持仓市值</div><div class="value" id="rtMultiMarketValue">--</div></div>' +
        '<div class="account-card"><div class="label">浮动盈亏</div><div class="value" id="rtMultiProfit">--</div></div>' +
        '</div>' +
        '<div class="scrollable-table" style="max-height:200px;overflow-y:auto;">' +
        '<table><thead><tr><th>股票</th><th>持股数</th><th>成本价</th><th>现价</th><th>盈亏</th></tr></thead>' +
        '<tbody id="rtMultiHoldingsTbody"><tr><td colspan="5" style="text-align:center;color:#9aa9cc;">暂无持仓</td></tr></tbody>' +
        '</table></div>' +
        '</div>';
}

function buildLogCard() {
    return '<div id="realtimeLogToolbar" style="margin-bottom:6px;"></div>' +
        '<div id="realtimeLogBox" style="height:180px;overflow-y:auto;background:#0e1220;border:1px solid #323d5a;border-radius:12px;padding:8px;color:#9aa9cc;font-size:12px;font-family:monospace;"></div>';
}

// ---------- Events ----------
function bindEvents() {
    var startBtn = document.getElementById('rtMultiStartBtn');
    var stopBtn = document.getElementById('rtMultiStopBtn');
    var importBtn = document.getElementById('rtImportHoldingsBtn');
    var clearBtn = document.getElementById('rtClearPoolBtn');
    var poolInput = document.getElementById('rtStockPoolInput');

    if (startBtn) startBtn.addEventListener('click', startMultiRealtime);
    if (stopBtn) stopBtn.addEventListener('click', stopMultiRealtime);
    if (importBtn) importBtn.addEventListener('click', importFromHoldings);
    if (clearBtn) clearBtn.addEventListener('click', function() {
        if (poolInput) { poolInput.value = ''; updateStockCount(); }
    });
    if (poolInput) poolInput.addEventListener('input', updateStockCount);

    // 高级设置折叠面板
    var advToggle = document.getElementById('rtAdvancedToggle');
    var advPanel = document.getElementById('rtAdvancedPanel');
    if (advToggle && advPanel) {
        advToggle.addEventListener('click', function() {
            var visible = advPanel.style.display !== 'none';
            advPanel.style.display = visible ? 'none' : 'block';
            advToggle.textContent = visible ? '⚙ 高级设置' : '⚙ 收起设置';
        });
    }

    // 从 localStorage 恢复自定义间隔
    var customIntervalInput = document.getElementById('rtCustomInterval');
    if (customIntervalInput) {
        var saved = localStorage.getItem('rtCustomInterval');
        if (saved !== null) customIntervalInput.value = saved;
        customIntervalInput.addEventListener('change', function() {
            localStorage.setItem('rtCustomInterval', this.value);
        });
    }

    // 滑点类型自定义下拉
    var slipInput = document.getElementById('rtSlippageTypeInput');
    if (slipInput) {
        slipInput.addEventListener('click', function(e) {
            e.stopPropagation();
            showCustomSelect(this, [
                { value: 'percent', label: '百分比' },
                { value: 'fixed', label: '固定点数(元)' }
            ], function(val) {
                var sel = document.getElementById('rtSlippageType');
                if (sel) sel.value = val;
            });
        });
    }

    // 真实下单控件事件
    bindAutoTradeEvents();
}

function parseStockPool() {
    var input = document.getElementById('rtStockPoolInput');
    if (!input) return [];
    var raw = input.value.trim();
    if (!raw) return [];
    // Split by comma, semicolon, space, newline
    var codes = raw.split(/[,;，；\s\n]+/).filter(function(c) { return c.length > 0; });
    // Strip suffixes
    codes = codes.map(function(c) { return c.replace(/\.(SZ|SH|BJ)$/i, ''); });
    // Deduplicate and limit
    var seen = {};
    var result = [];
    for (var i = 0; i < codes.length; i++) {
        if (!seen[codes[i]]) {
            seen[codes[i]] = true;
            result.push(codes[i]);
        }
        if (result.length >= MAX_STOCKS) break;
    }
    return result;
}

function updateStockCount() {
    var codes = parseStockPool();
    var countEl = document.getElementById('rtStockCount');
    if (countEl) {
        countEl.textContent = codes.length + '/' + MAX_STOCKS;
        if (codes.length > MAX_STOCKS) {
            countEl.style.color = '#ef4444';
            countEl.textContent += ' ⚠ 超限';
        } else if (codes.length > 20) {
            countEl.style.color = '#ff9800';
            countEl.textContent += ' (推荐≤20)';
        } else if (codes.length > 0) {
            countEl.style.color = '#4f7eff';
        } else {
            countEl.style.color = '#9aa9cc';
        }
    }
}

function importFromHoldings() {
    if (!bridge || typeof bridge.get_portfolio !== 'function') return;
    bridge.get_portfolio().then(function(jsonStr) {
        try {
            var data = JSON.parse(jsonStr);
            var holdings = data.holdings || [];
            if (holdings.length === 0) {
                showToast('当前无持仓', true);
                return;
            }
            var codes = holdings.map(function(h) { return h.code; });
            var input = document.getElementById('rtStockPoolInput');
            if (input) {
                var existing = parseStockPool();
                var merged = existing.concat(codes.filter(function(c) { return existing.indexOf(c) === -1; }));
                if (merged.length > MAX_STOCKS) merged = merged.slice(0, MAX_STOCKS);
                input.value = merged.join(',');
                updateStockCount();
            }
            showToast('已导入 ' + codes.length + ' 只持仓股票', false);
        } catch (e) { /* ignore */ }
    }).catch(function() { /* ignore */ });
}

// ---------- Start / Stop ----------
function startMultiRealtime() {
    if (!bridge) {
        showToast('Bridge 未连接，请刷新页面后重试', true);
        return;
    }

    var stockCodes = parseStockPool();
    var strategyCode = (document.getElementById('rtMultiStrategyCode').value || '').trim();
    var cash = parseInt(document.getElementById('rtMultiCash').value) || 100000;
    var commissionRate = parseFloat(document.getElementById('rtCommission').value) || 0.0003;
    var stampTaxRate = parseFloat(document.getElementById('rtStampTax').value) || 0.001;
    var slippageType = (document.getElementById('rtSlippageType').value || 'percent');
    var slippageValue = parseFloat(document.getElementById('rtSlippageValue').value) || 0.1;
    var customInterval = parseInt(document.getElementById('rtCustomInterval').value) || 0;

    if (stockCodes.length === 0) {
        showToast('请输入至少一只股票代码', true);
        return;
    }
    if (stockCodes.length > MAX_STOCKS) {
        showToast('股票数量不能超过' + MAX_STOCKS + '只，当前' + stockCodes.length + '只', true);
        return;
    }
    if (!strategyCode) {
        showToast('请输入策略代码', true);
        return;
    }

    // 动态轮询间隔
    var interval = customInterval > 0 ? customInterval : getDynamicInterval(stockCodes.length);
    if (interval < 3) interval = 3;
    // 更新 UI 上的间隔显示
    var intervalInput = document.getElementById('rtMultiInterval');
    if (intervalInput) intervalInput.value = interval;

    // Replace placeholder: STOCK_CODE_PLACEHOLDER -> context.stock
    strategyCode = strategyCode.replace(/"STOCK_CODE_PLACEHOLDER"/g, 'context.stock');
    strategyCode = strategyCode.replace(/'STOCK_CODE_PLACEHOLDER'/g, 'context.stock');
    strategyCode = strategyCode.replace(/STOCK_CODE_PLACEHOLDER/g, 'context.stock');

    _currentStockCodes = stockCodes;

    var params = {
        stock_codes: stockCodes,
        strategy_code: strategyCode,
        cash: cash,
        interval: interval,
        commission_rate: commissionRate,
        stamp_tax_rate: stampTaxRate,
        slippage_cost_type: slippageType,
        slippage_cost_value: slippageValue
    };

    if (_signalLogger) _signalLogger.addLog('info', '正在启动多股策略: ' + stockCodes.length + ' 只股票 资金: ' + cash +
        ' 佣金:' + commissionRate + ' 印花税:' + stampTaxRate);

    bridge.start_multi_realtime_strategy(JSON.stringify(params)).then(function(jsonStr) {
        try {
            var res = JSON.parse(jsonStr);
            if (res.success) {
                _isRunning = true;
                _allSignals = [];
                _signalRowCount = 0;
                // 策略启动成功后才清除一次性参数
                window._realtimeSimParams = null;
                updateRunningState(true);
                startBackgroundPolling();
                startSignalPolling();
                startLogPolling();
                if (_signalLogger) _signalLogger.addLog('success', res.message || '策略已启动');
                showToast(res.message || '多股策略已启动', false);
            } else {
                if (_signalLogger) _signalLogger.addLog('error', '启动失败: ' + (res.message || '未知错误'));
                showToast('启动失败: ' + (res.message || ''), true);
            }
        } catch (e) {
            if (_signalLogger) _signalLogger.addLog('error', '解析响应失败: ' + e.message);
        }
    }).catch(function(err) {
        if (_signalLogger) _signalLogger.addLog('error', '启动请求失败: ' + err);
        showToast('启动失败: ' + err, true);
    });
}

function stopMultiRealtime() {
    if (!bridge) {
        showToast('Bridge 未连接', true);
        return;
    }
    if (_signalLogger) _signalLogger.addLog('info', '正在停止多股策略...');

    bridge.stop_multi_realtime_strategy().then(function(jsonStr) {
        try {
            var res = JSON.parse(jsonStr);
            _isRunning = false;
            updateRunningState(false);
            stopSignalPolling();
            stopLogPolling();
            if (_signalLogger) _signalLogger.addLog('info', res.message || '策略已停止');
            showToast(res.message || '策略已停止', !res.success);
        } catch (e) {
            _isRunning = false;
            updateRunningState(false);
            stopSignalPolling();
            stopLogPolling();
        }
    }).catch(function(err) {
        _isRunning = false;
        updateRunningState(false);
        stopSignalPolling();
        stopLogPolling();
        if (_signalLogger) _signalLogger.addLog('error', '停止失败: ' + err);
    });
}

function updateRunningState(running) {
    var startBtn = document.getElementById('rtMultiStartBtn');
    var stopBtn = document.getElementById('rtMultiStopBtn');
    var statusEl = document.getElementById('rtMultiStatus');
    if (startBtn) startBtn.disabled = running;
    if (stopBtn) stopBtn.disabled = !running;
    if (statusEl) {
        statusEl.innerHTML = running ?
            '<span style="color:#4cff4c;">● 策略运行中</span>' :
            '<span style="color:#9aa9cc;">● 未启动</span>';
    }
}

// ---------- 真实下单控件 ----------
function bindAutoTradeEvents() {
    var enableCheck = document.getElementById('enableRealTrade');
    var modeInput = document.getElementById('realTradeModeInput');
    var configBtn = document.getElementById('rtAutoTradeConfigBtn');
    var emergencyBtn = document.getElementById('rtEmergencyStopBtn');
    var resetBtn = document.getElementById('rtResetStopBtn');
    var statusEl = document.getElementById('rtAutoTradeStatus');

    // 启用开关
    if (enableCheck) {
        enableCheck.addEventListener('change', function() {
            var enabled = this.checked;
            if (bridge && typeof bridge.set_auto_trade_enabled === 'function') {
                bridge.set_auto_trade_enabled(enabled);
            }
            updateAutoTradeStatusUI(enabled, false);
            localStorage.setItem('auto_trade_enabled', enabled ? '1' : '0');
        });
    }

    // 模式切换 - 自定义下拉
    if (modeInput) {
        modeInput.addEventListener('click', function(e) {
            e.stopPropagation();
            showCustomSelect(this, [
                { value: 'pyautogui', label: 'pyautogui' },
                { value: 'easytrader', label: 'easytrader' }
            ], function(val) {
                var hiddenSel = document.getElementById('realTradeMode');
                if (hiddenSel) hiddenSel.value = val;
                if (bridge && typeof bridge.set_auto_trade_mode === 'function') {
                    bridge.set_auto_trade_mode(val);
                }
                localStorage.setItem('auto_trade_mode', val);
            });
        });
    }

    // 配置按钮 → 跳转到设置页
    if (configBtn) {
        configBtn.addEventListener('click', function() {
            if (typeof window.navigateTo === 'function') {
                window.navigateTo('settings');
            }
        });
    }

    // 紧急停止
    if (emergencyBtn) {
        emergencyBtn.addEventListener('click', function() {
            if (bridge && typeof bridge.emergency_stop_auto_trade === 'function') {
                bridge.emergency_stop_auto_trade();
            }
            if (enableCheck) enableCheck.checked = false;
            updateAutoTradeStatusUI(false, true);
            showToast('真实下单已紧急停止', false, 3000);
        });
    }

    // 重置紧急停止
    if (resetBtn) {
        resetBtn.addEventListener('click', function() {
            if (bridge && typeof bridge.reset_emergency_stop === 'function') {
                bridge.reset_emergency_stop();
            }
            updateAutoTradeStatusUI(false, false);
            showToast('紧急停止已重置，可重新启用', false, 3000);
        });
    }

    // 恢复上次状态
    restoreAutoTradeState();
}

function updateAutoTradeStatusUI(enabled, emergencyStop) {
    var statusEl = document.getElementById('rtAutoTradeStatus');
    var emergencyBtn = document.getElementById('rtEmergencyStopBtn');
    var resetBtn = document.getElementById('rtResetStopBtn');

    if (emergencyStop) {
        if (statusEl) statusEl.innerHTML = '<span style="color:#e74c3c;">⏹ 紧急停止中</span>';
        if (emergencyBtn) emergencyBtn.style.display = 'none';
        if (resetBtn) resetBtn.style.display = 'inline-block';
    } else if (enabled) {
        if (statusEl) statusEl.innerHTML = '<span style="color:#4cff4c;">● 真实下单已启用</span>';
        if (emergencyBtn) emergencyBtn.style.display = 'inline-block';
        if (resetBtn) resetBtn.style.display = 'none';
    } else {
        if (statusEl) statusEl.innerHTML = '<span style="color:#9aa9cc;">● 未启用</span>';
        if (emergencyBtn) emergencyBtn.style.display = 'none';
        if (resetBtn) resetBtn.style.display = 'none';
    }
}

function restoreAutoTradeState() {
    var enabledSaved = localStorage.getItem('auto_trade_enabled');
    var modeSaved = localStorage.getItem('auto_trade_mode');
    var enableCheck = document.getElementById('enableRealTrade');
    var modeInput = document.getElementById('realTradeModeInput');

    function setModeUI(mode) {
        if (modeInput) {
            modeInput.value = mode;
            modeInput.setAttribute('data-value', mode);
        }
        var hiddenSel = document.getElementById('realTradeMode');
        if (hiddenSel) hiddenSel.value = mode;
    }

    // 先尝试从后端加载配置
    if (bridge && typeof bridge.get_auto_trade_config === 'function') {
        bridge.get_auto_trade_config().then(function(jsonStr) {
            try {
                var data = JSON.parse(jsonStr);
                if (data.success && data.config) {
                    var cfg = data.config;
                    if (enableCheck) enableCheck.checked = cfg.enabled || false;
                    setModeUI(cfg.mode || 'pyautogui');
                    updateAutoTradeStatusUI(cfg.enabled || false, cfg.emergency_stop || false);
                    if (cfg.auto_confirm_until) {
                        localStorage.setItem('auto_trade_dont_ask_until', cfg.auto_confirm_until);
                    }
                }
            } catch (e) { /* ignore */ }
        }).catch(function() {
            fallbackRestore();
        });
    } else {
        fallbackRestore();
    }

    function fallbackRestore() {
        if (enabledSaved === '1' && enableCheck) enableCheck.checked = true;
        if (modeSaved) setModeUI(modeSaved);
        updateAutoTradeStatusUI(enabledSaved === '1', false);
    }
}

// 导出 showToast 供 autoTradeConfirm.js 使用
window._realtimeShowToast = showToast;

// ---------- Background polling ----------
function startBackgroundPolling() {
    stopBackgroundPolling();
    updateQuoteTable();
    fetchPortfolio();
    var intervalMs = (parseInt(document.getElementById('rtMultiInterval').value) || 3) * 1000;
    _quoteTableTimer = setInterval(updateQuoteTable, intervalMs);
    _portfolioTimer = setInterval(fetchPortfolio, intervalMs);
}

function stopBackgroundPolling() {
    if (_quoteTableTimer) { clearInterval(_quoteTableTimer); _quoteTableTimer = null; }
    if (_portfolioTimer) { clearInterval(_portfolioTimer); _portfolioTimer = null; }
}

// ---------- Quote table ----------
function updateQuoteTable() {
    if (!bridge) return Promise.resolve();

    // Get holdings first, then fetch quotes for those stocks
    return bridge.get_portfolio().then(function(jsonStr) {
        try {
            var data = JSON.parse(jsonStr);
            var holdings = data.holdings || [];
            var codes = holdings.map(function(h) { return h.code; });

            if (codes.length === 0) {
                renderQuoteTableEmpty();
                return;
            }

            return bridge.get_realtime_quotes(JSON.stringify(codes)).then(function(qJsonStr) {
                try {
                    var qData = JSON.parse(qJsonStr);
                    if (qData.success) {
                        renderQuoteTable(holdings, qData.quotes || {});
                    }
                } catch (e) { /* ignore */ }
            }).catch(function() { /* ignore */ });
        } catch (e) { /* ignore */ }
    }).catch(function() { /* ignore */ });
}

function renderQuoteTableEmpty() {
    var tbody = document.getElementById('rtQuoteTbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#9aa9cc;">暂无持仓</td></tr>';
}

function renderQuoteTable(holdings, quotes) {
    var tbody = document.getElementById('rtQuoteTbody');
    if (!tbody) return;

    var colorUp = '#ef5350';
    var colorDown = '#26a69a';

    // 增量更新：基于 data-code 属性定位现有行
    var existingRows = {};
    var rows = tbody.querySelectorAll('tr[data-code]');
    for (var i = 0; i < rows.length; i++) {
        existingRows[rows[i].getAttribute('data-code')] = rows[i];
    }

    var seenCodes = {};

    for (var j = 0; j < holdings.length; j++) {
        var h = holdings[j];
        var code = h.code;
        seenCodes[code] = true;
        var q = quotes[code] || {};
        var price = q.price || 0;
        var prevClose = q.prev_close || price;
        var changePct = prevClose > 0 ? ((price - prevClose) / prevClose * 100) : 0;
        var color = changePct > 0 ? colorUp : (changePct < 0 ? colorDown : '#fff');

        var cells = '<td>' + formatStockDisplayHtml(code) + '</td>' +
            '<td style="color:' + color + ';font-weight:600;">' + (price ? price.toFixed(2) : '--') + '</td>' +
            '<td style="color:' + color + ';">' + (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%</td>' +
            '<td>' + (q.open ? q.open.toFixed(2) : '--') + '</td>' +
            '<td style="color:' + colorUp + ';">' + (q.high ? q.high.toFixed(2) : '--') + '</td>' +
            '<td style="color:' + colorDown + ';">' + (q.low ? q.low.toFixed(2) : '--') + '</td>' +
            '<td>' + (q.volume ? fmtVolume(q.volume * 100) : '--') + '</td>';

        var existing = existingRows[code];
        if (existing) {
            existing.innerHTML = cells;
        } else {
            var tr = document.createElement('tr');
            tr.setAttribute('data-code', code);
            tr.innerHTML = cells;
            tbody.appendChild(tr);
        }
    }

    // 删除已不在持仓中的行
    for (var codeKey in existingRows) {
        if (!seenCodes[codeKey] && existingRows[codeKey]) {
            existingRows[codeKey].remove();
        }
    }

    // 无持仓时显示占位
    if (holdings.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#9aa9cc;">暂无持仓</td></tr>';
    }
}

// ---------- Signal polling ----------
function startSignalPolling() {
    stopSignalPolling();
    var intervalMs = Math.max(2000, (parseInt(document.getElementById('rtMultiInterval').value) || 3) * 500);
    _signalPollTimer = setInterval(fetchSignals, intervalMs);
}

function stopSignalPolling() {
    if (_signalPollTimer) { clearInterval(_signalPollTimer); _signalPollTimer = null; }
}

function fetchSignals() {
    if (!_isRunning || !bridge || typeof bridge.get_multi_realtime_signals !== 'function') return;

    bridge.get_multi_realtime_signals().then(function(jsonStr) {
        try {
            var data = JSON.parse(jsonStr);
            if (data.signals && data.signals.length > 0) {
                for (var i = 0; i < data.signals.length; i++) {
                    _allSignals.push(data.signals[i]);
                    var s = data.signals[i];
                    if (_signalLogger) {
                        var dir = s.type === 'buy' ? '买入' : '卖出';
                        _signalLogger.addLog('info', '[' + s.date + '] ' + dir + ' ' + s.code +
                            ' 价格:' + (s.price != null ? s.price.toFixed(2) : '--') +
                            ' 数量:' + (s.shares || 0));
                    }
                }
                // 只追加新信号行，不全量重建
                appendSignalRows(data.signals);
            }
        } catch (e) { /* ignore */ }
    }).catch(function() { /* ignore */ });
}

var _signalRowCount = 0;
var MAX_SIGNAL_ROWS = 200;

function appendSignalRows(newSignals) {
    var tbody = document.getElementById('rtMultiSignalsTbody');
    if (!tbody) return;

    // 清除占位符
    if (_signalRowCount === 0) {
        tbody.innerHTML = '';
    }

    // 追加新行（在顶部插入，最新的在前）
    var frag = document.createDocumentFragment();
    for (var i = newSignals.length - 1; i >= 0; i--) {
        var s = newSignals[i];
        var cls = s.type === 'buy' ? 'profit-positive' : 'profit-negative';
        var text = s.type === 'buy' ? '买入' : '卖出';
        var tr = document.createElement('tr');
        tr.innerHTML = '<td>' + (s.date || '--') + '</td>' +
            '<td>' + formatStockNameOnly(s.code || '') + '</td>' +
            '<td class="' + cls + '">' + text + '</td>' +
            '<td>' + (s.price != null ? s.price.toFixed(2) : '--') + '</td>' +
            '<td>' + (s.shares || 0) + '</td>' +
            '<td style="color:#9aa9cc;">' + (s.reason || '--') + '</td>';
        frag.appendChild(tr);
        _signalRowCount++;
    }
    tbody.insertBefore(frag, tbody.firstChild);

    // 超过上限时删除最旧的行
    while (_signalRowCount > MAX_SIGNAL_ROWS && tbody.lastChild) {
        tbody.removeChild(tbody.lastChild);
        _signalRowCount--;
    }
}

function renderSignalTable() {
    // 全量重建（用于页面恢复）
    var tbody = document.getElementById('rtMultiSignalsTbody');
    if (!tbody) return;
    _signalRowCount = 0;
    if (_allSignals.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#9aa9cc;">暂无信号</td></tr>';
        return;
    }
    var display = _allSignals.slice(-MAX_SIGNAL_ROWS).reverse();
    _signalRowCount = display.length;
    tbody.innerHTML = display.map(function(s) {
        var cls = s.type === 'buy' ? 'profit-positive' : 'profit-negative';
        var text = s.type === 'buy' ? '买入' : '卖出';
        return '<tr>' +
            '<td>' + (s.date || '--') + '</td>' +
            '<td>' + formatStockNameOnly(s.code || '') + '</td>' +
            '<td class="' + cls + '">' + text + '</td>' +
            '<td>' + (s.price != null ? s.price.toFixed(2) : '--') + '</td>' +
            '<td>' + (s.shares || 0) + '</td>' +
            '<td style="color:#9aa9cc;">' + (s.reason || '--') + '</td>' +
            '</tr>';
    }).join('');
}

// ---------- Log polling ----------
function startLogPolling() {
    stopLogPolling();
    var intervalMs = Math.max(3000, (parseInt(document.getElementById('rtMultiInterval').value) || 3) * 1000);
    _logPollTimer = setInterval(fetchLogs, intervalMs);
}

function stopLogPolling() {
    if (_logPollTimer) { clearInterval(_logPollTimer); _logPollTimer = null; }
}

function fetchLogs() {
    if (!bridge || typeof bridge.get_multi_realtime_logs !== 'function') return;
    bridge.get_multi_realtime_logs().then(function(jsonStr) {
        try {
            var data = JSON.parse(jsonStr);
            if (data.logs && data.logs.length > 0) {
                for (var i = 0; i < data.logs.length; i++) {
                    if (_signalLogger) _signalLogger.addLog('info', data.logs[i]);
                }
            }
            if (data.running === false && _isRunning) {
                _isRunning = false;
                updateRunningState(false);
                stopSignalPolling();
                stopLogPolling();
                if (_signalLogger) _signalLogger.addLog('warn', '引擎已停止运行');
            }
        } catch (e) { /* ignore */ }
    }).catch(function() { /* ignore */ });
}

// ---------- Portfolio ----------
function fetchPortfolio() {
    if (!bridge || typeof bridge.get_portfolio !== 'function') return Promise.resolve();
    return bridge.get_portfolio().then(function(jsonStr) {
        try {
            var data = JSON.parse(jsonStr);
            if (data.error) return;
            updatePortfolioDisplay(data);
        } catch (e) { /* ignore */ }
    }).catch(function() { /* ignore */ });
}

function updatePortfolioDisplay(data) {
    var totalEl = document.getElementById('rtMultiTotalAssets');
    var cashEl = document.getElementById('rtMultiCash');
    var mvEl = document.getElementById('rtMultiMarketValue');
    var profitEl = document.getElementById('rtMultiProfit');
    var tbody = document.getElementById('rtMultiHoldingsTbody');

    if (totalEl) totalEl.textContent = (data.total_assets || 0).toLocaleString();
    if (cashEl) cashEl.textContent = (data.cash || 0).toLocaleString();

    var holdings = data.holdings || [];
    var totalMV = 0, totalCost = 0, totalProfit = 0;

    if (holdings.length === 0) {
        if (mvEl) mvEl.textContent = '0';
        if (profitEl) profitEl.textContent = '0';
        if (profitEl) profitEl.className = 'value';
        if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#9aa9cc;">暂无持仓</td></tr>';
        return;
    }

    // 增量更新：基于 data-code 属性定位现有行
    var existingRows = {};
    var rows = tbody ? tbody.querySelectorAll('tr[data-code]') : [];
    for (var i = 0; i < rows.length; i++) {
        existingRows[rows[i].getAttribute('data-code')] = rows[i];
    }
    var seenCodes = {};

    for (var j = 0; j < holdings.length; j++) {
        var h = holdings[j];
        var code = h.code;
        seenCodes[code] = true;
        var shares = h.shares || 0;
        var cost = h.cost || 0;
        var price = h.price || cost;
        var profit = h.profit || (price - cost) * shares;
        totalMV += price * shares;
        totalCost += cost * shares;
        totalProfit += profit;

        var cells = '<td>' + formatStockDisplayHtml(code) + '</td>' +
            '<td>' + shares + '</td>' +
            '<td>' + cost.toFixed(2) + '</td>' +
            '<td>' + price.toFixed(2) + '</td>' +
            '<td class="' + profitClass(profit) + '">' + profit.toFixed(2) + '</td>';

        var existing = existingRows[code];
        if (existing) {
            existing.innerHTML = cells;
        } else {
            var tr = document.createElement('tr');
            tr.setAttribute('data-code', code);
            tr.innerHTML = cells;
            if (tbody) tbody.appendChild(tr);
        }
    }

    // 删除已不在持仓中的行
    for (var codeKey in existingRows) {
        if (!seenCodes[codeKey] && existingRows[codeKey]) {
            existingRows[codeKey].remove();
        }
    }

    if (mvEl) mvEl.textContent = totalMV.toLocaleString();
    if (profitEl) {
        profitEl.textContent = totalProfit.toFixed(2);
        profitEl.className = 'value ' + profitClass(totalProfit);
    }
}
