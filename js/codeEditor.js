// js/codeEditor.js  v20260607 (async backtest with progress polling)
// 策略代码编辑器：允许用户直接编写 Python 策略代码并运行回测
console.log('[codeEditor.js] v20260607 async loaded');

import { bridge, bridgeReady } from './bridge.js';
import { bindDatePicker } from './datepicker.js';
import { Logger } from './logger.js';

function showToast(msg, isError, duration) {
    var tip = document.createElement('div');
    tip.style.cssText = 'position:fixed;top:20%;left:50%;transform:translateX(-50%);background:' +
        (isError ? '#ff4c4c' : '#4cff4c') + ';color:#000;padding:10px 20px;border-radius:8px;z-index:99999;font-weight:600;';
    tip.textContent = msg;
    document.body.appendChild(tip);
    setTimeout(function() { tip.remove(); }, duration || 2000);
}

var DEFAULT_CODE = [
    '# 双均线策略（示例）',
    '# 短周期均线上穿长周期均线时买入，下穿时卖出',
    '',
    '# 如何获取持仓信息（正确方式）',
    '# holdings = context.portfolio.get(\'holdings\', {})',
    '# current_position = holdings.get(stock, 0)',
    '',
    'import numpy as np',
    '',
    'def initialize(context):',
    '    context.fast = 5',
    '    context.slow = 20',
    '',
    'def handle_bar(context, bar_dict):',
    '    # 使用全局 code（代码中已替换为实际股票代码）',
    '    stock = "STOCK_CODE_PLACEHOLDER"',
    '',
    '    fast_arr = history_bars(stock, context.fast + 1, \'1d\', \'close\')',
    '    slow_arr = history_bars(stock, context.slow + 1, \'1d\', \'close\')',
    '',
    '    if len(fast_arr) < context.fast + 1 or len(slow_arr) < context.slow + 1:',
    '        return',
    '',
    '    fast_ma = fast_arr[-context.fast:].mean()',
    '    slow_ma = slow_arr[-context.slow:].mean()',
    '    prev_fast = fast_arr[-context.fast-1:-1].mean()',
    '    prev_slow = slow_arr[-context.slow-1:-1].mean()',
    '',
    '    # 金叉买入',
    '    if prev_fast <= prev_slow and fast_ma > slow_ma:',
    '        order_target_percent(stock, 1.0)',
    '        log.info("金叉买入信号")',
    '',
    '    # 死叉卖出',
    '    if prev_fast >= prev_slow and fast_ma < slow_ma:',
    '        order_target_percent(stock, 0)',
    '        log.info("死叉卖出信号")'
].join('\n');

// ---- State ----
var codeEditorStartDate = '2025-01-01';
var codeEditorEndDate = new Date().toISOString().slice(0, 10);
var codeEditorCapital = 1000000;
var codeEditorSlippage = 'close';
var codeEditorLogger = null;

export function renderCodeEditorPage(container) {
    container.innerHTML =
        '<div class="card">' +
        '  <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">' +
        '    <span>💻 策略代码编辑器</span>' +
        '    <button id="codeEditorApiHelpBtn" style="background:transparent;border:1px solid #4f7eff;padding:4px 12px;border-radius:20px;color:#4f7eff;cursor:pointer;font-size:12px;">📖 API 帮助</button>' +
        '  </div>' +
        '  <p style="color:#9aa9cc; margin-bottom:16px;">直接编写 Python 策略代码，自定义回测逻辑。需定义 <code style="color:#4f7eff;">initialize(context)</code> 和 <code style="color:#4f7eff;">handle_bar(context, bar_dict)</code> 两个函数。使用 <code style="color:#4f7eff;">"STOCK_CODE_PLACEHOLDER"</code> 作为股票代码占位符。</p>' +

        '  <div class="metric-row" style="margin-bottom:12px;">' +
        '    <span>策略名称:</span>' +
        '    <input type="text" id="codeEditorName" placeholder="自定义策略" ' +
        '      style="width:200px;background:#1e253b;border:1px solid #323d5a;border-radius:30px;color:#fff;padding:6px 10px;font-size:13px;">' +
        '  </div>' +

        '  <div style="margin-bottom:12px;">' +
        '    <textarea id="codeEditorTextarea" spellcheck="false" ' +
        '      style="width:100%;height:420px;background:#0e1220;border:1px solid #323d5a;border-radius:8px;color:#e0e0e0;padding:12px;font-size:13px;font-family:Consolas,\'Courier New\',monospace;resize:vertical;box-sizing:border-box;tab-size:4;line-height:1.5;">' +
        escapeHtmlForTextarea(DEFAULT_CODE) +
        '    </textarea>' +
        '  </div>' +

        '  <div class="metric-row" style="margin-bottom:12px;display:flex;gap:8px;align-items:center;">' +
        '    <button id="codeEditorRunBtn" style="background:#4f7eff;border:none;padding:6px 18px;border-radius:30px;color:#fff;font-weight:600;cursor:pointer;">▶ 运行回测</button>' +
        '    <button id="codeEditorCompareBtn" style="background:transparent;border:1px solid #f2c94c;padding:6px 18px;border-radius:30px;color:#f2c94c;font-weight:600;cursor:pointer;">🔬 对比回测</button>' +
        '    <button id="codeEditorSaveBtn" style="background:transparent;border:1px solid #4f7eff;padding:6px 18px;border-radius:30px;color:#4f7eff;font-weight:600;cursor:pointer;">💾 保存策略</button>' +
        '    <button id="codeEditorDetailBtn" style="display:none;background:transparent;border:1px solid #4cff4c;padding:6px 18px;border-radius:30px;color:#4cff4c;font-weight:600;cursor:pointer;">📊 查看详情</button>' +
        '  </div>' +
        '</div>' +

        '<div class="card" style="margin-top:12px;">' +
        '  <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">' +
        '    <span>📋 回测日志</span>' +
        '    <div style="display:flex;gap:8px;">' +
        '      <button id="codeEditorExportLogBtn" style="background:transparent;border:1px solid #4f7eff;color:#4f7eff;padding:4px 12px;border-radius:20px;cursor:pointer;font-size:12px;">📄 导出</button>' +
        '      <button id="codeEditorClearLogBtn" style="background:transparent;border:1px solid #323d5a;color:#9aa9cc;padding:4px 12px;border-radius:20px;cursor:pointer;font-size:12px;">清空</button>' +
        '    </div>' +
        '  </div>' +
        '  <div id="codeEditorLogToolbar"></div>' +
        '  <div id="codeEditorLog" style="height:180px;overflow-y:auto;background:#0e1220;border:1px solid #323d5a;border-radius:8px;padding:8px;color:#9aa9cc;font-size:12px;font-family:monospace;line-height:1.6;"></div>' +
        '</div>';

    codeEditorLogger = new Logger('codeEditorLog', 'codeEditorLogToolbar', { maxEntries: 500 });
    codeEditorLogger.init();

    // Tab key support in textarea
    var textarea = document.getElementById('codeEditorTextarea');
    if (textarea) {
        textarea.addEventListener('keydown', function(e) {
            if (e.key === 'Tab') {
                e.preventDefault();
                var start = this.selectionStart;
                var end = this.selectionEnd;
                this.value = this.value.substring(0, start) + '    ' + this.value.substring(end);
                this.selectionStart = this.selectionEnd = start + 4;
            }
        });
    }

    // Run button — opens modal
    var runBtn = document.getElementById('codeEditorRunBtn');
    if (runBtn) {
        runBtn.addEventListener('click', function() { showBacktestModalForCodeEditor(); });
    }

    // Compare button — guides to strategy factory
    var compareBtn = document.getElementById('codeEditorCompareBtn');
    if (compareBtn) {
        compareBtn.addEventListener('click', function() {
            showToast('对比回测功能请前往【策略工厂】页面使用。在策略工厂中构建卡片策略后，点击"🔬 对比回测"即可快速对比不同参数组合。', false, 4000);
            // Auto-navigate to strategy page
            setTimeout(function() {
                var navEl = document.querySelector('.nav-item[data-page="strategy"]');
                if (navEl) navEl.click();
            }, 1500);
        });
    }

    // Save button
    var saveBtn = document.getElementById('codeEditorSaveBtn');
    if (saveBtn) {
        saveBtn.addEventListener('click', function() {
            if (!bridgeReady || !bridge) {
                showToast('Bridge 未连接，无法保存策略', true);
                return;
            }
            var code = document.getElementById('codeEditorTextarea').value;
            var name = document.getElementById('codeEditorName').value.trim() || '未命名策略';
            if (typeof bridge.save_strategy !== 'function') {
                showToast('save_strategy 接口不可用', true);
                return;
            }
            bridge.save_strategy(name, code, 0).then(function(jsonStr) {
                var res = JSON.parse(jsonStr);
                if (res.success) {
                    showToast('' + name + ' 保存成功');
                    codeEditorAddLog('success', '策略已保存: ' + name);
                } else {
                    showToast('保存失败: ' + (res.error || '未知错误'), true);
                    codeEditorAddLog('error', '保存失败: ' + (res.error || '未知错误'));
                }
            }).catch(function(err) {
                showToast('保存失败: ' + (err.message || err), true);
                codeEditorAddLog('error', '保存失败: ' + (err.message || err));
            });
        });
    }

    // API Help button
    var apiHelpBtn = document.getElementById('codeEditorApiHelpBtn');
    if (apiHelpBtn) {
        apiHelpBtn.addEventListener('click', function() {
            var navEl = document.querySelector('.nav-item[data-page="api"]');
            if (navEl) navEl.click();
        });
    }

    // Clear log button
    var clearBtn = document.getElementById('codeEditorClearLogBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', function() {
            codeEditorLogger.clearLog();
        });
    }

    // Export log button
    var exportBtn = document.getElementById('codeEditorExportLogBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', function() {
            codeEditorLogger.exportLog();
        });
    }

    // Auto-fill from global variables
    if (window.currentStrategyCode) {
        var textareaEl = document.getElementById('codeEditorTextarea');
        if (textareaEl) textareaEl.value = window.currentStrategyCode;
        var nameInputEl = document.getElementById('codeEditorName');
        if (nameInputEl && window.currentStrategyName) nameInputEl.value = window.currentStrategyName;
    }
}

function escapeHtmlForTextarea(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function codeEditorAddLog(level, msg) {
    if (codeEditorLogger) codeEditorLogger.addLog(level, msg);
}

// ---- Backtest Modal ----

var SLIPPAGE_OPTIONS = [
    { value: 'close', label: '收盘价成交（回测默认）' },
    { value: 'next_open', label: '次日开盘价成交' },
    { value: 'half_spread', label: '半价差偏移（仅K线图标记）' }
];

function slippageLabel(value) {
    for (var i = 0; i < SLIPPAGE_OPTIONS.length; i++) {
        if (SLIPPAGE_OPTIONS[i].value === value) return SLIPPAGE_OPTIONS[i].label;
    }
    return '收盘价成交（回测默认）';
}

function showBacktestModalForCodeEditor() {
    if (!bridge) { showToast('Bridge 未连接', true); return; }

    var code = document.getElementById('codeEditorTextarea').value;
    if (!code.trim()) {
        showToast('请输入策略代码', true);
        return;
    }

    var startDt = codeEditorStartDate;
    var endDt = codeEditorEndDate;
    var cash = codeEditorCapital;
    var slippage = codeEditorSlippage;

    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;';

    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1a2135;border:1px solid #4f7eff;border-radius:12px;padding:24px;min-width:440px;max-width:540px;z-index:10000;color:#fff;';

    var title = document.createElement('div');
    title.style.cssText = 'color:#fff;font-weight:600;font-size:16px;margin-bottom:16px;padding-left:12px;border-left:4px solid #4f7eff;';
    title.textContent = '🎯 回测参数';

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✖';
    closeBtn.style.cssText = 'position:absolute;top:8px;right:12px;background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;';
    closeBtn.onclick = function() { overlay.remove(); modal.remove(); };

    var body = document.createElement('div');

    // Date info
    var dateInfo = document.createElement('div');
    dateInfo.style.cssText = 'color:#9aa9cc;font-size:13px;margin-bottom:12px;';
    dateInfo.textContent = '回测区间：' + startDt + ' ~ ' + endDt;

    // Date edit row
    var dateEditRow = document.createElement('div');
    dateEditRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:10px;';
    dateEditRow.innerHTML =
        '<span style="color:#9aa9cc;font-size:12px;">修改：</span>' +
        '<input type="text" id="modalStartDate" class="datepicker-input" value="' + startDt + '" readonly ' +
        'style="width:110px;background:#0e1220;border:1px solid #323d5a;border-radius:8px;color:#fff;padding:4px 8px;font-size:12px;">' +
        '<span style="color:#9aa9cc;">~</span>' +
        '<input type="text" id="modalEndDate" class="datepicker-input" value="' + endDt + '" readonly ' +
        'style="width:110px;background:#0e1220;border:1px solid #323d5a;border-radius:8px;color:#fff;padding:4px 8px;font-size:12px;">';

    // Index quick-select
    var indexRow = document.createElement('div');
    indexRow.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:10px;flex-wrap:wrap;';
    var indexLabel = document.createElement('span');
    indexLabel.style.cssText = 'color:#9aa9cc;font-size:12px;';
    indexLabel.textContent = '常用指数：';
    indexRow.appendChild(indexLabel);

    var indexDefs = [
        { label: '沪深300', code: '000300.XSHG' },
        { label: '中证500', code: '000905.XSHG' },
        { label: '中证1000', code: '000852.XSHG' },
        { label: '创业板', code: '399006.XSHE' },
        { label: '科创50', code: '000688.XSHG' }
    ];

    var stockArea = document.createElement('textarea');
    stockArea.rows = 3;
    stockArea.style.cssText = 'width:100%;background:#0e1220;border:1px solid #323d5a;border-radius:12px;color:#fff;padding:8px;font-family:monospace;box-sizing:border-box;';
    stockArea.value = '';
    stockArea.placeholder = '输入股票代码，每行一个或用逗号分隔';

    indexDefs.forEach(function(idx) {
        var btn = document.createElement('button');
        btn.textContent = idx.label;
        btn.style.cssText = 'background:#2a3a5a;border:none;padding:3px 10px;border-radius:20px;color:#fff;font-size:12px;cursor:pointer;';
        btn.onclick = function(e) {
            e.preventDefault();
            if (bridge && typeof bridge.get_index_stocks === 'function') {
                bridge.get_index_stocks(idx.code).then(function(jsonStr) {
                    var codes = JSON.parse(jsonStr);
                    if (Array.isArray(codes) && codes.length > 0) {
                        stockArea.value = codes.join(',');
                    }
                });
            }
        };
        indexRow.appendChild(btn);
    });

    var stockLabel = document.createElement('div');
    stockLabel.style.cssText = 'color:#9aa9cc;margin-bottom:4px;font-size:13px;';
    stockLabel.textContent = '股票池（每行一个或用逗号分隔）：';

    // Capital row
    var capitalRow = document.createElement('div');
    capitalRow.style.cssText = 'display:flex;gap:12px;align-items:center;margin-top:12px;';
    var capitalInput = document.createElement('input');
    capitalInput.type = 'number';
    capitalInput.value = cash;
    capitalInput.min = 10000;
    capitalInput.max = 2000000;
    capitalInput.step = 10000;
    capitalInput.style.cssText = 'width:130px;background:#0e1220;border:1px solid #323d5a;border-radius:8px;color:#fff;padding:4px 8px;font-size:13px;';
    capitalInput.addEventListener('change', function() { cash = Number(this.value) || 1000000; });
    capitalRow.innerHTML = '<span style="color:#9aa9cc;font-size:13px;">初始资金：</span>';
    capitalRow.appendChild(capitalInput);

    // Slippage row
    var slippageRow = document.createElement('div');
    slippageRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:10px;margin-bottom:8px;';
    var slLabel = document.createElement('span');
    slLabel.style.cssText = 'color:#9aa9cc;font-size:13px;';
    slLabel.textContent = '成交价：';
    slippageRow.appendChild(slLabel);

    SLIPPAGE_OPTIONS.forEach(function(opt) {
        var slBtn = document.createElement('button');
        slBtn.textContent = opt.label;
        var isActive = slippage === opt.value;
        slBtn.style.cssText = 'background:' + (isActive ? '#4f7eff' : '#2a3a5a') + ';border:none;padding:4px 10px;border-radius:20px;color:#fff;font-size:12px;cursor:pointer;';
        slBtn.setAttribute('data-sl-value', opt.value);
        slBtn.addEventListener('click', function() {
            slippage = opt.value;
            slippageRow.querySelectorAll('button').forEach(function(b) {
                b.style.background = '#2a3a5a';
            });
            slBtn.style.background = '#4f7eff';
        });
        slippageRow.appendChild(slBtn);
    });

    // Status
    var statusDiv = document.createElement('div');
    statusDiv.style.cssText = 'color:#9aa9cc;font-size:12px;margin-top:12px;min-height:18px;';

    // Buttons
    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:12px;justify-content:flex-end;margin-top:16px;';

    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.style.cssText = 'background:transparent;border:1px solid #323d5a;color:#9aa9cc;padding:6px 18px;border-radius:30px;cursor:pointer;';
    cancelBtn.onclick = function() { overlay.remove(); modal.remove(); };

    var runBtn = document.createElement('button');
    runBtn.textContent = '开始回测';
    runBtn.style.cssText = 'background:#4f7eff;border:none;padding:6px 18px;border-radius:30px;color:#fff;font-weight:600;cursor:pointer;';
    runBtn.onclick = function() {
        if (runBtn.disabled) return;
        runBtn.disabled = true;
        runBtn.textContent = '⏳ 回测中...';
        statusDiv.textContent = '正在执行回测...';

        var raw = stockArea.value || '';
        var codes = [];
        raw.split(/[\n,]+/).forEach(function(part) {
            var c = part.trim();
            if (c) codes.push(c);
        });
        codes = codes.filter(function(v, i, a) { return a.indexOf(v) === i; });
        if (codes.length === 0) {
            statusDiv.textContent = '请输入至少一个股票代码';
            statusDiv.style.color = '#ff4c4c';
            runBtn.disabled = false;
            runBtn.textContent = '开始回测';
            return;
        }

        // Read date edits
        var startInput = document.getElementById('modalStartDate');
        var endInput = document.getElementById('modalEndDate');
        var start = startInput ? startInput.value : startDt;
        var end = endInput ? endInput.value : endDt;
        var cashVal = cash;
        var slippageType = slippage;

        // Persist to state
        codeEditorStartDate = start;
        codeEditorEndDate = end;
        codeEditorCapital = cashVal;
        codeEditorSlippage = slippageType;

        var sName = document.getElementById('codeEditorName');
        var strategyName = (sName ? sName.value.trim() : '') || '未命名策略';
        var userCode = code;

        window.currentStrategyCode = userCode;
        window.currentStrategyName = strategyName;
        window._slippageMode = slippageType;

        // Clear log
        codeEditorLogger.clearLog();

        codeEditorAddLog('info', '开始回测 ' + codes.length + ' 只股票：' + codes.map(function(c) { return c.split('.')[0]; }).join(', '));
        codeEditorAddLog('info', '回测参数 | 初始资金: ¥' + cashVal.toLocaleString() + ' | 区间: ' + start + ' ~ ' + end);
        codeEditorAddLog('info', '成交价模式: ' + slippageLabel(slippageType));

        var startTime = Date.now();

        // Detail button
        var detailBtn = document.getElementById('codeEditorDetailBtn');
        if (detailBtn) detailBtn.style.display = 'none';

        // ── Shared: render backtest result into globals and UI ──
        function renderBacktestResult(result, elapsed) {
            var signals = result.signals || [];
            var equityCurve = result.equity_curve || [];
            var metrics = result.metrics || {};
            var stockPerformance = result.stock_performance || [];

            var finalResult = {
                success: true,
                signals: signals,
                equity_curve: equityCurve,
                metrics: metrics,
                stock_performance: stockPerformance
            };
            window._lastBacktestResult = finalResult;
            window.strategySignals = signals;
            window._lastBacktestError = null;
            window.strategyStartDate = start;
            window.strategyEndDate = end;

            // topPositionCodes
            var posMap = {};
            signals.forEach(function(s) {
                var c = s.code || '';
                if (!posMap[c]) posMap[c] = 0;
                if (s.type === 'buy') posMap[c] += (s.price || 0) * (s.shares || 0);
                else posMap[c] -= (s.price || 0) * (s.shares || 0);
            });
            var posEntries = Object.keys(posMap).map(function(k) { return { code: k, value: posMap[k] }; });
            posEntries.sort(function(a, b) { return b.value - a.value; });
            window.topPositionCodes = posEntries.slice(0, 6).map(function(e) { return e.code; });

            logMetrics(metrics);

            if (result.logs && result.logs.length > 0) {
                result.logs.slice(-15).forEach(function(l) {
                    var lv = 'info';
                    if (l.indexOf('[ERROR]') !== -1) lv = 'error';
                    else if (l.indexOf('[WARN]') !== -1) lv = 'warn';
                    codeEditorAddLog(lv, '[后端] ' + l.replace(/^\[(INFO|ERROR|WARN)\]\s*/, ''));
                });
            }

            codeEditorAddLog('success', '✅ 回测完成，总信号 ' + signals.length + ' 个，耗时 ' + elapsed + ' 秒');
            if (signals.length === 0) codeEditorAddLog('warn', '回测区间内无信号产生，请检查条件参数或回测区间是否合理');
            codeEditorAddLog('info', '💡 请前往【策略详情】查看详细结果，或切换至【买卖点成交图】查看K线信号');

            if (detailBtn) {
                detailBtn.style.display = 'inline-block';
                detailBtn.onclick = function() {
                    var navEl = document.querySelector('.nav-item[data-page="detail"]');
                    if (navEl) navEl.click();
                };
            }
        }

        // ── Polling helper: wait for job, then fetch + render result ──
        function pollBacktestResult(jobId, isMulti) {
            var pollInterval = setInterval(function() {
                bridge.get_backtest_progress(jobId).then(function(progStr) {
                    var prog = JSON.parse(progStr);
                    if (prog.status === 'finished') {
                        clearInterval(pollInterval);
                        bridge.get_backtest_result(jobId).then(function(resStr) {
                            var res = JSON.parse(resStr);
                            var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                            runBtn.disabled = false;
                            runBtn.textContent = '开始回测';
                            bridge.cleanup_backtest(jobId);

                            if (!res.ready) {
                                codeEditorAddLog('error', '获取回测结果失败');
                                overlay.remove();
                                modal.remove();
                                return;
                            }

                            var result = res.result;
                            if (!result.success && result.error) {
                                codeEditorAddLog('error', '回测失败: ' + result.error);
                                overlay.remove();
                                modal.remove();
                                return;
                            }

                            renderBacktestResult(result, elapsed);
                            overlay.remove();
                            modal.remove();
                            var stockLabel = isMulti ? (codes.length + '只股票 | ') : '';
                            showToast('✅ 回测完成 | ' + stockLabel + '耗时' + elapsed + '秒 | 信号' + (result.signals || []).length + '个', false);
                        });
                    } else if (prog.status === 'cancelling' || prog.status === 'not_found') {
                        clearInterval(pollInterval);
                        runBtn.disabled = false;
                        runBtn.textContent = '开始回测';
                        codeEditorAddLog('warn', '回测已取消');
                    } else if (prog.status === 'running') {
                        var pct = prog.total > 0 ? Math.round(prog.current / prog.total * 100) : 0;
                        // Update status div with progress
                        if (statusDiv) {
                            statusDiv.textContent = '回测中... ' + prog.current + '/' + prog.total + ' (' + pct + '%)';
                        }
                    }
                });
            }, 500);
        }

        if (codes.length > 1) {
            // ---- 多股回测（异步） ----
            var multiParams = { code: userCode, stocks: codes, start: start, end: end, cash: cashVal, slippage: slippageType };
            bridge.run_multi_backtest(JSON.stringify(multiParams)).then(function(jsonStr) {
                var res = JSON.parse(jsonStr);
                if (!res.success) {
                    runBtn.disabled = false;
                    runBtn.textContent = '开始回测';
                    codeEditorAddLog('error', '启动多股回测失败: ' + (res.error || '未知错误'));
                    return;
                }
                codeEditorAddLog('info', '回测已启动 (ID: ' + res.job_id + ')，请等待...');
                pollBacktestResult(res.job_id, true);
            }).catch(function(err) {
                runBtn.disabled = false;
                runBtn.textContent = '开始回测';
                codeEditorAddLog('error', '请求失败: ' + (err.message || err));
            });
        } else {
            // ---- 单股回测（异步） ----
            var stock = codes[0];
            var cleanCode = userCode.replace(/"STOCK_CODE_PLACEHOLDER"/g, '"' + stock + '"');
            cleanCode = cleanCode.replace(/'STOCK_CODE_PLACEHOLDER'/g, "'" + stock + "'");
            var params = { code: cleanCode, stock: stock, start: start, end: end, cash: cashVal, slippage: slippageType };

            bridge.run_custom_backtest(JSON.stringify(params)).then(function(jsonStr) {
                var res = JSON.parse(jsonStr);
                if (!res.success) {
                    runBtn.disabled = false;
                    runBtn.textContent = '开始回测';
                    codeEditorAddLog('error', '启动回测失败: ' + (res.error || '未知错误'));
                    return;
                }
                codeEditorAddLog('info', '回测已启动 (ID: ' + res.job_id + ')，请等待...');
                pollBacktestResult(res.job_id, false);
            }).catch(function(err) {
                runBtn.disabled = false;
                runBtn.textContent = '开始回测';
                codeEditorAddLog('error', '请求失败: ' + (err.message || err));
            });
        }
    };

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(runBtn);

    // Assemble modal
    body.appendChild(dateInfo);
    body.appendChild(dateEditRow);
    body.appendChild(indexRow);
    body.appendChild(stockLabel);
    body.appendChild(stockArea);
    body.appendChild(capitalRow);
    body.appendChild(slippageRow);
    body.appendChild(statusDiv);
    body.appendChild(btnRow);

    modal.appendChild(closeBtn);
    modal.appendChild(title);
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Bind date pickers
    var sdInput = document.getElementById('modalStartDate');
    var edInput = document.getElementById('modalEndDate');
    if (sdInput) bindDatePicker(sdInput, 'top');
    if (edInput) bindDatePicker(edInput, 'top');
}

function logMetrics(metrics) {
    if (!metrics) return;
    var m = metrics;
    codeEditorAddLog('info', '──────── 绩效摘要 ────────');
    if (m.total_return !== undefined) codeEditorAddLog('info', '累计收益率: ' + (m.total_return >= 0 ? '+' : '') + m.total_return.toFixed(2) + '%');
    if (m.annual_return !== undefined) codeEditorAddLog('info', '年化收益率: ' + (m.annual_return >= 0 ? '+' : '') + m.annual_return.toFixed(2) + '%');
    if (m.max_drawdown !== undefined) codeEditorAddLog('info', '最大回撤: ' + m.max_drawdown.toFixed(2) + '%');
    if (m.sharpe_ratio !== undefined) codeEditorAddLog('info', '夏普比率: ' + m.sharpe_ratio.toFixed(2));
    if (m.win_rate !== undefined) codeEditorAddLog('info', '胜率: ' + m.win_rate.toFixed(1) + '%');
    if (m.total_trades !== undefined) codeEditorAddLog('info', '交易次数: ' + m.total_trades);
}
