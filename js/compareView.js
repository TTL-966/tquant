// js/compareView.js
// 对比回测结果渲染：多曲线权益图、指标对比表格、信号切换查看

import { bridge } from './bridge.js';
import { escapeHtml, profitClass, formatStockNameOnly } from './main.js';
import { stockNameMap } from './stockData.js';
import { getComparePalette } from './compareStrategy.js';

function showToast(msg, isError) {
    var tip = document.createElement('div');
    tip.style.cssText = 'position:fixed;top:20%;left:50%;transform:translateX(-50%);background:' +
        (isError ? '#eb5757' : '#4f7eff') + ';color:#fff;padding:10px 20px;border-radius:8px;z-index:99999;font-weight:600;font-size:13px;';
    tip.textContent = msg;
    document.body.appendChild(tip);
    setTimeout(function() { tip.remove(); }, 2000);
}

var PALETTE = getComparePalette();

// ---- Custom Select Panel ----
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

/**
 * 渲染对比回测结果页面
 * @param {HTMLElement} container - 渲染容器
 * @param {Object} compareResult - { success, results, errors, stock_code, start_date, end_date }
 */
export function renderCompareView(container, compareResult) {
    var results = compareResult.results || [];
    var errors = compareResult.errors || [];
    var stockPool = compareResult.stock_pool || [];
    var isMultiStock = compareResult.is_multi_stock || (stockPool.length > 1);
    var stockDisplay = isMultiStock
        ? stockPool.join(', ')
        : (stockPool.length === 1 ? stockPool[0] : (compareResult.stock_code || '--'));
    var startDt = compareResult.start_date || '--';
    var endDt = compareResult.end_date || '--';

    var strategyName = window.currentStrategyName || '未命名策略';

    // Error banner
    var errorBannerHtml = '';
    if (errors && errors.length > 0) {
        errorBannerHtml = '<div style="background:#3a1a1a;border:1px solid #eb5757;border-radius:8px;padding:10px 14px;margin-bottom:16px;color:#eb5757;font-size:13px;">' +
            '<strong>⚠ 部分变体执行失败：</strong><br>' +
            errors.map(function(e) { return '· <b>' + escapeHtml(e.name) + '</b>: ' + escapeHtml(e.error); }).join('<br>') +
            '</div>';
    }

    if (results.length === 0) {
        container.innerHTML = '<div class="card"><div class="card-title">📊 策略对比回测报告</div>' +
            errorBannerHtml +
            '<div style="color:#9aa9cc;text-align:center;padding:60px;">所有变体均执行失败，请检查策略代码和参数配置</div></div>';
        return;
    }

    // ---- Build metrics comparison table ----
    var metricKeys = [
        { key: 'total_return', label: '累计收益率(%)', format: 'pct', better: 'higher' },
        { key: 'annual_return', label: '年化收益率(%)', format: 'pct', better: 'higher' },
        { key: 'max_drawdown', label: '最大回撤(%)', format: 'pct_abs', better: 'lower' },
        { key: 'sharpe_ratio', label: '夏普比率', format: 'num2', better: 'higher' },
        { key: 'win_rate', label: '胜率(%)', format: 'pct', better: 'higher' },
        { key: 'total_trades', label: '交易次数', format: 'int', better: 'neutral' },
        { key: 'excess_return', label: '超额收益(%)', format: 'pct', better: 'higher' },
        { key: 'beta', label: 'Beta', format: 'num2', better: 'neutral' },
        { key: 'outperform', label: '跑赢大盘', format: 'outperform', better: 'neutral' }
    ];

    // Pre-compute best/worst for highlighting
    var highlights = {};
    metricKeys.forEach(function(mk) {
        if (mk.better === 'neutral') return;
        var values = results.map(function(r) {
            var v = r.metrics ? r.metrics[mk.key] : null;
            return (v != null && !isNaN(v)) ? v : null;
        }).filter(function(v) { return v !== null; });

        if (values.length === 0) return;

        if (mk.better === 'higher') {
            var best = Math.max.apply(null, values);
            var worst = Math.min.apply(null, values);
            highlights[mk.key] = { best: best, worst: worst };
        } else if (mk.better === 'lower') {
            var bestLow = Math.min.apply(null, values);
            var worstHigh = Math.max.apply(null, values);
            highlights[mk.key] = { best: bestLow, worst: worstHigh };
        }
    });

    function fmtMetric(val, fmt) {
        if (val === undefined || val === null || isNaN(val)) return 'N/A';
        if (fmt === 'pct') return (val >= 0 ? '+' : '') + val.toFixed(2) + '%';
        if (fmt === 'pct_abs') return val.toFixed(2) + '%';
        if (fmt === 'num2') return val.toFixed(2);
        if (fmt === 'int') return Math.round(val);
        if (fmt === 'outperform') {
            if (val === true) return '✅ 是';
            if (val === false) return '❌ 否';
            return '-';
        }
        return val;
    }

    function cellStyle(mk, val) {
        var hl = highlights[mk.key];
        if (!hl) return '';
        if (mk.better === 'higher') {
            if (val === hl.best) return 'background:#1a3a1a;color:#4cff4c;font-weight:700;';
            if (val === hl.worst) return 'background:#3a1a1a;color:#ff4c4c;';
        } else if (mk.better === 'lower') {
            if (val === hl.best) return 'background:#1a3a1a;color:#4cff4c;font-weight:700;';
            if (val === hl.worst) return 'background:#3a1a1a;color:#ff4c4c;';
        }
        return '';
    }

    var tableHeadHtml = '<tr><th style="text-align:left;padding:10px;">策略名称</th>';
    metricKeys.forEach(function(mk) {
        tableHeadHtml += '<th style="text-align:right;padding:10px;">' + mk.label + '</th>';
    });
    tableHeadHtml += '</tr>';

    var tableBodyHtml = '';
    results.forEach(function(r) {
        var m = r.metrics || {};
        tableBodyHtml += '<tr><td style="text-align:left;padding:8px 10px;font-weight:600;color:#fff;">' + escapeHtml(r.name) + '</td>';
        metricKeys.forEach(function(mk) {
            var raw = m[mk.key];
            var display = fmtMetric(raw, mk.format);
            var style = '';
            if (raw != null && !isNaN(raw)) {
                style = cellStyle(mk, raw);
            }
            tableBodyHtml += '<td style="text-align:right;padding:8px 10px;' + style + '">' + display + '</td>';
        });
        tableBodyHtml += '</tr>';
    });

    var legendHtml = '<div style="display:flex;gap:16px;margin-top:8px;font-size:11px;color:#9aa9cc;">' +
        '<span>🟢 绿色 = 该列最优</span><span>🔴 红色 = 该列最差</span></div>';

    // ---- Signal dropdown options ----
    var signalOptionsHtml = '';
    results.forEach(function(r, i) {
        signalOptionsHtml += '<option value="' + i + '">' + escapeHtml(r.name) + '</option>';
    });

    // ---- Build full page ----
    var variantCountBadge = results.length > 1
        ? '<span style="background:#4f7eff;color:#fff;padding:2px 8px;border-radius:12px;font-size:11px;margin-left:8px;">对比回测 ' + results.length + ' 个变体</span>'
        : '';

    var stockLabel = isMultiStock ? '股票池' : '股票代码';
    container.innerHTML =
        '<div class="card">' +
        '  <div class="card-title">📊 策略对比回测报告' + variantCountBadge +
        '  <button id="compareExportReportBtn" style="background:#4f7eff;border:none;padding:4px 14px;border-radius:30px;color:#fff;font-weight:600;cursor:pointer;font-size:12px;margin-left:12px;">📄 导出报告</button>' +
        '  </div>' +
        '  <div style="display:flex;gap:24px;margin-bottom:8px;color:#9aa9cc;font-size:13px;flex-wrap:wrap;">' +
        '    <span>策略名称：<span style="color:#fff;font-weight:600;">' + escapeHtml(strategyName) + '</span></span>' +
        '    <span>' + stockLabel + '：<span style="color:#4f7eff;">' + escapeHtml(stockDisplay) + (isMultiStock ? ' <span style="font-size:10px;color:#9aa9cc;">(' + stockPool.length + '只, 共享资金池)</span>' : '') + '</span></span>' +
        '    <span>回测区间：<span style="color:#4f7eff;">' + escapeHtml(startDt) + ' ~ ' + escapeHtml(endDt) + '</span></span>' +
        '  </div>' +
        errorBannerHtml +

        // Tab bar
        '  <div class="backtest-tabs" style="display:flex;gap:4px;margin-bottom:16px;border-bottom:1px solid #323d5a;padding-bottom:0;">' +
        '    <button class="tab-btn compare-tab active" data-tab="compare-curve" style="padding:8px 18px;border:none;border-radius:8px 8px 0 0;cursor:pointer;font-size:13px;font-weight:500;background:#1a2540;color:#4f7eff;border-bottom:2px solid #4f7eff;">📈 权益曲线对比</button>' +
        '    <button class="tab-btn compare-tab" data-tab="compare-metrics" style="padding:8px 18px;border:none;border-radius:8px 8px 0 0;cursor:pointer;font-size:13px;font-weight:500;background:transparent;color:#9aa9cc;border-bottom:2px solid transparent;">📊 指标对比</button>' +
        '    <button class="tab-btn compare-tab" data-tab="compare-signals" style="padding:8px 18px;border:none;border-radius:8px 8px 0 0;cursor:pointer;font-size:13px;font-weight:500;background:transparent;color:#9aa9cc;border-bottom:2px solid transparent;">📋 交易信号</button>' +
        '  </div>' +

        // Tab content: equity curves
        '  <div id="compare-tab-curve" class="tab-content" style="display:block;">' +
        '    <div id="compareMultiCurveContainer" style="height:320px;width:100%;margin-bottom:16px;"></div>' +
        '  </div>' +

        // Tab content: metrics table
        '  <div id="compare-tab-metrics" class="tab-content" style="display:none;">' +
        '    <div class="scrollable-table" style="margin-bottom:8px;">' +
        '      <table>' +
        '        <thead>' + tableHeadHtml + '</thead>' +
        '        <tbody>' + tableBodyHtml + '</tbody>' +
        '      </table>' +
        '    </div>' +
        legendHtml +
        '  </div>' +

        // Tab content: signals
        '  <div id="compare-tab-signals" class="tab-content" style="display:none;">' +
        '    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">' +
        '      <span style="color:#9aa9cc;font-size:13px;">选择变体：</span>' +
        '      <select id="compareSignalSelect" style="display:none;">' +
        signalOptionsHtml +
        '      </select>' +
        '      <input id="compareSignalSelectInput" type="text" readonly value="' + escapeHtml(results[0] ? results[0].name : '') + '" style="background:#1e253b;border:1px solid #323d5a;border-radius:8px;color:#fff;padding:6px 10px;font-size:13px;cursor:pointer;min-width:120px;">' +
        '      <span id="compareSignalCount" style="color:#9aa9cc;font-size:12px;"></span>' +
        '    </div>' +
        '    <div class="scrollable-table">' +
        '      <table>' +
        '        <thead><tr><th>日期</th><th>股票</th><th>类型</th><th>价格</th><th>手数</th><th>原因</th></tr></thead>' +
        '        <tbody id="compareSignalBody"></tbody>' +
        '      </table>' +
        '    </div>' +

        // Stock performance panel (multi-stock only)
        '    <div id="compareStockPerfPanel" style="margin-top:16px;display:none;">' +
        '      <div id="compareStockPerfToggle" style="display:flex;align-items:center;gap:8px;cursor:pointer;background:#0e1220;border:1px solid #323d5a;border-radius:8px;padding:8px 12px;">' +
        '        <span id="compareStockPerfArrow" style="color:#9aa9cc;font-size:12px;">▶</span>' +
        '        <span style="color:#f2c94c;font-size:13px;font-weight:600;">📋 个股绩效归因</span>' +
        '        <span id="compareStockPerfCount" style="color:#9aa9cc;font-size:12px;"></span>' +
        '      </div>' +
        '      <div id="compareStockPerfBody" style="display:none;">' +
        '        <div class="scrollable-table" style="margin-top:8px;">' +
        '          <table>' +
        '            <thead><tr><th>股票代码</th><th>名称</th><th>累计盈亏(元)</th><th>交易次数</th><th>胜率(%)</th></th></tr></thead>' +
        '            <tbody id="compareStockPerfTableBody"></tbody>' +
        '          </table>' +
        '        </div>' +
        '      </div>' +
        '    </div>' +
        '  </div>' +

        '  <button id="compareClearResultBtn" style="margin-top:12px;background:transparent;border:1px solid #eb5757;color:#eb5757;padding:6px 18px;border-radius:30px;cursor:pointer;font-size:12px;">🗑 清除对比结果</button>' +
        '</div>';

    // ---- Post-render setup (setTimeout for DOM readiness) ----
    setTimeout(function() {

    	//报告导出
    	var exportBtn = document.getElementById('compareExportReportBtn');
		if (exportBtn) {
		    exportBtn.addEventListener('click', function() {
		        try {
		            if (!bridge || typeof bridge.export_report !== 'function') {
		                showToast('当前环境不支持导出功能', true);
		                return;
		            }

		            // 获取当前选中的变体
		            var select = document.getElementById('compareSignalSelect');
		            var idx = select ? parseInt(select.value) : 0;
		            var variant = results[idx];
		            if (!variant) variant = results[0];

		            var reportData = {
		                strategyName: window.currentStrategyName || '对比回测',
		                periodStart: compareResult.start_date || '--',
		                periodEnd: compareResult.end_date || '--',
		                equityCurve: variant.equity_curve || [],
		                metrics: variant.metrics || [],
		                signals: variant.signals || [],
		                stockPerformance: variant.stock_performance || []
		            };

		            exportBtn.disabled = true;
		            exportBtn.textContent = '⏳ 生成中...';

		            bridge.export_report(JSON.stringify(reportData)).then(function(jsonStr) {
		                exportBtn.disabled = false;
		                exportBtn.textContent = '📄 导出报告';
		                var res = JSON.parse(jsonStr);
		                if (res.success) {
		                    showToast('报告已导出到: ' + (res.excel || ''), false);
		                } else if (res.cancelled) {
		                    showToast('已取消导出', false);
		                } else {
		                    showToast('导出失败: ' + (res.error || '未知错误'), true);
		                }
		            }).catch(function(err) {
		                console.error('[CompareView] 导出失败:', err);
		                exportBtn.disabled = false;
		                exportBtn.textContent = '📄 导出报告';
		                showToast('导出异常: ' + (err.message || err), true);
		            });
		        } catch (err) {
		            console.error('[CompareView] 导出失败:', err);
		            showToast('导出失败: ' + err.message, true);
		        }
		    });
		}
        // --- Draw multi-curve equity chart ---
        var curveDom = document.getElementById('compareMultiCurveContainer');
        if (curveDom && typeof echarts !== 'undefined') {
            drawCompareEquityCurves(curveDom, results);
        }

        // --- Tab switching ---
        var tabBtns = container.querySelectorAll('.compare-tab');
        tabBtns.forEach(function(btn) {
            btn.addEventListener('mouseenter', function() {
                if (!this.classList.contains('active')) this.style.background = '#151c2c';
            });
            btn.addEventListener('mouseleave', function() {
                if (!this.classList.contains('active')) this.style.background = 'transparent';
            });
            btn.addEventListener('click', function() {
                var tabName = this.getAttribute('data-tab');
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

                document.querySelectorAll('.tab-content').forEach(function(tc) {
                    tc.style.display = 'none';
                });
                var target = document.getElementById('compare-tab-' + tabName.replace('compare-', ''));
                if (target) {
                    target.style.display = 'block';
                    if (tabName === 'compare-curve' && curveDom) {
                        var instance = echarts.getInstanceByDom(curveDom);
                        if (instance) instance.resize();
                    }
                }
            });
        });

        // --- Signal viewer ---
        var signalSelect = document.getElementById('compareSignalSelect');
        var signalBody = document.getElementById('compareSignalBody');
        var signalCount = document.getElementById('compareSignalCount');

        function renderSignalTable(variantIndex) {
            var r = results[variantIndex];
            if (!r) return;
            var signals = r.signals || [];
            signalCount.textContent = '共 ' + signals.length + ' 条信号';
            if (signals.length === 0) {
                signalBody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#9aa9cc;">无交易信号</td></tr>';
            } else {
                signalBody.innerHTML = signals.map(function(s) {
                    var typeText = s.type === 'buy' ? '买入' : '卖出';
                    var code = s.code || '';
                    var stockName = (formatStockNameOnly(code) || '').trim();
                    var nameDisplay = code ? (stockName && stockName !== code ? stockName + '(' + code + ')' : code) : '--';
                    var shares = s.shares != null ? s.shares : 0;
                    var lotDisplay = shares < 100 ? '不足1手' : Math.floor(shares / 100) + '手';
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

            // Render stock performance panel (multi-stock only)
            renderStockPerformance(r);
        }

        function renderStockPerformance(r) {
            var panel = document.getElementById('compareStockPerfPanel');
            if (!panel) return;
            var perf = r.stock_performance || [];
            if (perf.length === 0) {
                panel.style.display = 'none';
                return;
            }
            panel.style.display = 'block';

            var countEl = document.getElementById('compareStockPerfCount');
            if (countEl) countEl.textContent = '(' + perf.length + ' 只)';

            var tbody = document.getElementById('compareStockPerfTableBody');
				if (!tbody) return;
				tbody.innerHTML = perf.map(function(s) {
				    var code = s.code || '--';
				    var name = s.name || '';
				    var profit = s.total_profit != null ? s.total_profit : 0;
				    var profitDisplay = (profit >= 0 ? '+' : '') + profit.toFixed(2);
				    var profitColor = profit >= 0 ? '#4cff4c' : '#ff4c4c';
				    var trades = s.total_trades != null ? s.total_trades : 0;
				    var winRate = s.win_rate != null ? s.win_rate : 0;
				    var wrDisplay = (typeof winRate === 'number' ? winRate.toFixed(1) : winRate) + '%';
				    return '<tr>' +
				        '<td>' + escapeHtml(code) + '</td>' +
				        '<td>' + escapeHtml(name) + '</td>' +
				        '<td style="color:' + profitColor + ';">' + profitDisplay + ' 元</td>' +
				        '<td>' + trades + '</td>' +
				        '<td>' + wrDisplay + '</td>' +
				        '</tr>';
				}).join('');
            // Toggle handler
            var toggle = document.getElementById('compareStockPerfToggle');
            var body = document.getElementById('compareStockPerfBody');
            var arrow = document.getElementById('compareStockPerfArrow');
            if (toggle && body && arrow) {
                toggle.onclick = function() {
                    var isOpen = body.style.display !== 'none';
                    body.style.display = isOpen ? 'none' : 'block';
                    arrow.textContent = isOpen ? '▶' : '▼';
                };
            }
        }

        var signalSelectInput = document.getElementById('compareSignalSelectInput');

        if (signalSelect && signalBody) {
            renderSignalTable(0);
            signalSelect.addEventListener('change', function() {
                var idx = parseInt(this.value);
                renderSignalTable(idx);
                // 同步自定义输入框显示
                if (signalSelectInput && results[idx]) {
                    signalSelectInput.value = results[idx].name;
                }
            });
        }

        // 自定义下拉点击
        if (signalSelectInput && signalSelect) {
            signalSelectInput.addEventListener('click', function(e) {
                e.stopPropagation();
                var opts = [];
                var sel = document.getElementById('compareSignalSelect');
                if (sel) {
                    for (var i = 0; i < sel.options.length; i++) {
                        opts.push({ value: sel.options[i].value, label: sel.options[i].textContent });
                    }
                }
                showCustomSelect(signalSelectInput, opts, function(value) {
                    if (sel) {
                        sel.value = value;
                        sel.dispatchEvent(new Event('change'));
                    }
                });
            });
        }

        // --- Batch load missing stock names ---
        var allCodesSet = {};
        results.forEach(function(r) {
            (r.signals || []).forEach(function(s) { if (s.code) allCodesSet[s.code] = true; });
            (r.stock_performance || []).forEach(function(s) { if (s.code) allCodesSet[s.code] = true; });
        });
        var missingCodes = Object.keys(allCodesSet).filter(function(c) { return !stockNameMap[c]; });

        if (missingCodes.length > 0 && bridge && typeof bridge.search_stock === 'function') {
            var batchSize = 20;
            var loadedCount = 0;

            function loadBatch(startIdx) {
                var endIdx = Math.min(startIdx + batchSize, missingCodes.length);
                var batch = missingCodes.slice(startIdx, endIdx);

                Promise.all(batch.map(function(c) {
                    return bridge.search_stock(c).then(function(jsonStr) {
                        try {
                            var items = JSON.parse(jsonStr);
                            if (items && items.length > 0 && items[0].name) {
                                stockNameMap[c] = items[0].name;
                            }
                        } catch(e) {}
                    }).catch(function() {});
                })).then(function() {
                    loadedCount += batch.length;
                    if (endIdx < missingCodes.length) {
                        loadBatch(endIdx);
                    } else {
                        // All loaded, re-render
                        if (signalSelect) renderSignalTable(parseInt(signalSelect.value));
                        var activeVariantIdx = signalSelect ? parseInt(signalSelect.value) : 0;
                        var currentVariant = results[activeVariantIdx];
                        if (currentVariant) renderStockPerformance(currentVariant);
                    }
                });
            }

            loadBatch(0);
        }

        // --- Clear button ---
        var clearBtn = document.getElementById('compareClearResultBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', function() {
                delete window._lastCompareResult;
                delete window._lastBacktestResult;
                // Re-render static detail
                var navEl = document.querySelector('.nav-item[data-page="detail"]');
                if (navEl) navEl.click();
            });
        }
    }, 100);
}

/**
 * 绘制多曲线对比权益图
 */
function drawCompareEquityCurves(dom, results) {
    if (dom.clientHeight === 0) {
        setTimeout(function() { drawCompareEquityCurves(dom, results); }, 200);
        return;
    }

    // Collect all unique dates across all variants and sort them
    var dateSet = {};
    results.forEach(function(r) {
        (r.equity_curve || []).forEach(function(pt) {
            dateSet[pt.date] = true;
        });
    });
    var allDates = Object.keys(dateSet).sort();

    if (allDates.length === 0) {
        dom.innerHTML = '<div style="color:#9aa9cc; padding:40px; text-align:center;">暂无权益曲线数据</div>';
        return;
    }

    // Build aligned series data (converted to cumulative return %)
    var series = results.map(function(r, i) {
        var curveMap = {};
        (r.equity_curve || []).forEach(function(pt) {
            curveMap[pt.date] = pt.value;
        });

        // Get initial cash for this variant
        var initCash = (r.initial_cash) || (r.equity_curve && r.equity_curve.length > 0 ? r.equity_curve[0].value : 1000000);
        if (initCash <= 0) initCash = 1000000;

        var color = PALETTE[i % PALETTE.length];
        var data = allDates.map(function(d) {
            if (curveMap[d] != null) return (curveMap[d] / initCash - 1) * 100;
            return null;
        });

        return {
            name: r.name,
            type: 'line',
            data: data,
            smooth: true,
            lineStyle: { color: color, width: 2 },
            itemStyle: { color: color },
            areaStyle: {
                color: hexToRgba(color, 0.1)
            },
            symbol: 'none',
            connectNulls: true
        };
    });

    var chart = echarts.init(dom);
    chart.setOption({
        tooltip: {
            trigger: 'axis',
            formatter: function(params) {
                var html = '<b>' + params[0].axisValue + '</b><br>';
                params.forEach(function(p) {
                    var val = p.value != null ? p.value.toFixed(2) + '%' : '--';
                    html += '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' +
                        p.color + ';margin-right:6px;"></span>' + p.seriesName + ': ' + val + '<br>';
                });
                return html;
            }
        },
        legend: {
            data: results.map(function(r) { return r.name; }),
            textStyle: { color: '#9aa9cc' },
            top: 0
        },
        grid: { left: 80, right: 20, top: 40, bottom: 30, containLabel: true },
        xAxis: {
            type: 'category',
            data: allDates,
            axisLabel: { color: '#9aa9cc', rotate: 30 }
        },
        yAxis: {
            type: 'value',
            name: '累计收益率 (%)',
            axisLabel: {
                color: '#9aa9cc',
                formatter: function(v) { return v.toFixed(1) + '%'; }
            }
        },
        series: series
    });
}

function hexToRgba(hex, alpha) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var r = parseInt(hex.substring(0, 2), 16);
    var g = parseInt(hex.substring(2, 4), 16);
    var b = parseInt(hex.substring(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}
