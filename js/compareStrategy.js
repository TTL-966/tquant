// js/compareStrategy.js
// 多策略对比回测：基于策略工厂卡片配置，无需手写代码

import { bridge, bridgeReady } from './bridge.js';
import { searchStockSuggestions } from './stockData.js';
import { CARD_TYPE_META } from './strategyTemplates.js';
import { generateCode } from './strategyUtils.js';

var COMPARE_PALETTE = ['#4f7eff', '#f2c94c', '#eb5757', '#6fcf97', '#bb86fc'];
var stockPoolArray = [];

function showToast(msg, isError, duration) {
    var tip = document.createElement('div');
    tip.style.cssText = 'position:fixed;top:20%;left:50%;transform:translateX(-50%);background:' +
        (isError ? '#ff4c4c' : '#4cff4c') + ';color:#000;padding:10px 20px;border-radius:8px;z-index:99999;font-weight:600;';
    tip.textContent = msg;
    document.body.appendChild(tip);
    setTimeout(function() { tip.remove(); }, duration || 2000);
}

/**
 * 解析股票代码输入，支持逗号、换行、空格分隔
 * @param {string} raw - 原始输入字符串
 * @returns {string[]} 去重去后缀的纯数字代码数组
 */
function parseStockList(raw) {
    if (!raw || !raw.trim()) return [];
    var codes = [];
    raw.split(/[\n,;\s]+/).forEach(function(part) {
        var c = part.trim();
        if (c) {
            c = c.split('.')[0];  // 去除交易所后缀
            codes.push(c);
        }
    });
    // 去重
    var seen = {};
    return codes.filter(function(c) { return seen[c] ? false : (seen[c] = true); });
}

export function getComparePalette() {
    return COMPARE_PALETTE;
}

/**
 * 从卡片数组中提取所有可调数值参数
 * 返回 [{cardIndex, cardType, cardAction, key, label, value, min, max, step}, ...]
 */
function extractCardParams(cards) {
    var params = [];
    if (!cards || cards.length === 0) return params;

    for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var meta = CARD_TYPE_META[card.type];
        if (!meta || !meta.paramFields) continue;

        var actionLabel = card.action === 'buy' ? '【买入】' : (card.action === 'sell' ? '【卖出】' : '');
        var cardLabel = (meta.label || card.type) + actionLabel;

        meta.paramFields.forEach(function(field) {
            if (field.type !== 'number') return; // 只调节数值参数
            params.push({
                cardIndex: i,
                cardType: card.type,
                cardLabel: cardLabel,
                key: field.key,
                label: field.label,
                value: (card.params && card.params[field.key] != null) ? card.params[field.key] : field.default,
                min: field.min,
                max: field.max,
                step: field.step || 1
            });
        });
    }
    return params;
}

/**
 * 深拷贝 cards 数组
 */
function cloneCards(cards) {
    return JSON.parse(JSON.stringify(cards));
}

/**
 * 为单个变体生成最终策略代码
 * @param {Object} variant - { name, params: {"0_fastPeriod": 5, ...} }
 * @param {Array} cards - 原始卡片配置
 * @param {string} finalStock - 纯数字股票代码（如 "000001"）
 * @returns {{ name: string, code: string }}
 */
function generateVariantCode(variant, cards, finalStock) {
    var clonedCards = cloneCards(cards);
    var vParams = variant.params || {};
    for (var ci = 0; ci < clonedCards.length; ci++) {
        var card = clonedCards[ci];
        if (!card.params) card.params = {};
        var meta = CARD_TYPE_META[card.type];
        if (!meta || !meta.paramFields) continue;
        meta.paramFields.forEach(function(field) {
            if (field.type !== 'number') return;
            var kk = ci + '_' + field.key;
            if (vParams[kk] != null) {
                card.params[field.key] = vParams[kk];
            }
        });
    }
    var code = generateCode(clonedCards);
    // 多股模式下保留占位符，由 MultiBacktestExecutor 内部对每只股票独立替换
    if (finalStock) {
        code = code.replace(/"STOCK_CODE_PLACEHOLDER"/g, '"' + finalStock + '"')
                   .replace(/'STOCK_CODE_PLACEHOLDER'/g, "'" + finalStock + "'");
    }
    return { name: variant.name, code: code };
}

/**
 * 显示对比回测弹窗（基于策略工厂卡片，支持编辑共享参数）
 */
export function showCompareBacktestModal(cards, defaultStock, startDate, endDate, cash, slippage,
                                          commissionRate, stampTaxRate, slippageCostType, slippageCostValue) {
    if (!bridge) { showToast('Bridge 未连接', true); return; }
    if (!cards || cards.length === 0) {
        showToast('没有可用的策略卡片，请先在策略工厂中添加条件卡片', true);
        return;
    }

    var cardParams = extractCardParams(cards);

    if (cardParams.length === 0) {
        showToast('当前卡片配置中没有可调节的数值参数。请添加均线交叉、RSI 等含数值参数的条件卡片。', true, 4000);
        return;
    }

    // ---- Editable shared state (close over in modal) ----
    var sharedCash = cash || 100000;
    var sharedSlippage = slippage || 'close';
    var sharedCommission = commissionRate != null ? commissionRate : 0.0003;
    var sharedStampTax = stampTaxRate != null ? stampTaxRate : 0.001;
    var sharedSlippageCostType = slippageCostType || 'percent';
    var sharedSlippageCostValue = slippageCostValue != null ? slippageCostValue : 0.1;

    var stockCode = (defaultStock || '000001').split('.')[0];

    // ---- Overlay + Modal ----
    var overlay = document.createElement('div');
    overlay.className = 'compare-backtest-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;overflow-y:auto;';

    var modal = document.createElement('div');
    modal.className = 'compare-backtest-modal';
    modal.style.cssText = 'position:relative;margin:30px auto 60px;background:#1a2135;border:1px solid #4f7eff;border-radius:12px;padding:24px;max-width:660px;z-index:10000;color:#fff;';

    // ---- Build HTML ----
    var html = '';

    // Header
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">';
    html += '<div style="color:#fff;font-weight:600;font-size:16px;padding-left:12px;border-left:4px solid #4f7eff;">🔬 对比回测模式</div>';
    html += '<button id="compareModalClose" style="background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;">✖</button>';
    html += '</div>';

    // Param summary hint
    html += '<div style="background:#0e1220;border:1px solid #323d5a;border-radius:8px;padding:8px 12px;margin-bottom:14px;color:#9aa9cc;font-size:12px;">';
    html += '检测到 <b style="color:#4f7eff;">' + cardParams.length + '</b> 个可调参数，来自 <b style="color:#f2c94c;">' +
        (function() { var seen = {}; cardParams.forEach(function(p) { seen[p.cardLabel] = true; }); return Object.keys(seen).length; })() +
        '</b> 个条件卡片。为每个变体设置不同的参数值，系统将自动生成策略代码并并行回测。</div>';

    // ---- Stock pool (multi-stock) ----
    html += '<div style="background:#0e1220;border:1px solid #323d5a;border-radius:8px;padding:8px 12px;margin-bottom:14px;color:#9aa9cc;font-size:12px;">';
    html += '多股对比回测将使用<b style="color:#4f7eff;">共享资金池</b>，对所有股票统一执行策略，计算<b style="color:#f2c94c;">组合权益曲线</b>和<b style="color:#f2c94c;">组合绩效</b>。';
    html += '</div>';

    html += '<div style="margin-bottom:10px;">';
    html += '<div style="color:#9aa9cc;font-size:13px;margin-bottom:4px;">股票池（每行一个或用逗号分隔）：</div>';
    html += '<textarea id="compareStockInput" rows="3" placeholder="输入股票代码，每行一个或用逗号分隔" ';
    html += 'style="width:100%;background:#0e1220;border:1px solid #323d5a;border-radius:8px;color:#fff;padding:8px;font-family:monospace;font-size:13px;box-sizing:border-box;resize:vertical;">' + stockCode + '</textarea>';
    html += '</div>';

    // Quick-fill index buttons
    html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;flex-wrap:wrap;">';
    html += '<span style="color:#9aa9cc;font-size:12px;">快速填仓：</span>';
    var indexDefs = [
        { label: '沪深300', code: '000300.XSHG' },
        { label: '中证500', code: '000905.XSHG' },
        { label: '中证1000', code: '000852.XSHG' },
        { label: '创业板', code: '399006.XSHE' },
        { label: '科创50', code: '000688.XSHG' }
    ];
    indexDefs.forEach(function(idx) {
        html += '<button class="compare-fill-index" data-index="' + idx.code + '" style="background:#2a3a5a;border:none;padding:3px 10px;border-radius:20px;color:#fff;font-size:12px;cursor:pointer;">' + idx.label + '</button>';
    });
    html += '</div>';
    html += '<div id="compareStockSuggestions" style="position:absolute;z-index:10001;background:#1a2135;border:1px solid #4f7eff;border-radius:8px;max-height:180px;overflow-y:auto;display:none;min-width:200px;"></div>';

    // ---- Shared parameters (editable) ----
    html += '<div style="background:#0e1220;border:1px solid #323d5a;border-radius:10px;padding:12px;margin-bottom:14px;">';
    html += '<div style="color:#fff;font-weight:600;font-size:13px;margin-bottom:8px;">⚙️ 公共参数（所有变体共享）</div>';

    // Row 1: cash + slippage
    html += '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:8px;">';
    html += '<div><span style="color:#9aa9cc;font-size:12px;">初始资金：</span>';
    html += '<input type="number" id="compareCash" value="' + sharedCash + '" min="10000" max="10000000" step="10000" ';
    html += 'style="width:100px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 8px;font-size:12px;"></div>';

    html += '<div><span style="color:#9aa9cc;font-size:12px;">成交价：</span>';
    html += '<select id="compareSlippage" style="background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 8px;font-size:12px;">';
    html += '<option value="close"' + (sharedSlippage === 'close' ? ' selected' : '') + '>收盘价成交</option>';
    html += '<option value="next_open"' + (sharedSlippage === 'next_open' ? ' selected' : '') + '>次日开盘价</option>';
    html += '<option value="half_spread"' + (sharedSlippage === 'half_spread' ? ' selected' : '') + '>半价差偏移</option>';
    html += '</select></div>';
    html += '</div>';

    // Row 2: commission + stamp tax
    html += '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:8px;">';
    html += '<div><span style="color:#9aa9cc;font-size:12px;">佣金率：</span>';
    html += '<input type="number" id="compareCommission" value="' + sharedCommission + '" min="0" max="0.01" step="0.0001" ';
    html += 'style="width:80px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 8px;font-size:12px;"></div>';

    html += '<div><span style="color:#9aa9cc;font-size:12px;">印花税率：</span>';
    html += '<input type="number" id="compareStampTax" value="' + sharedStampTax + '" min="0" max="0.01" step="0.0001" ';
    html += 'style="width:80px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 8px;font-size:12px;"></div>';
    html += '</div>';

    // Row 3: slippage cost type + value
    html += '<div style="display:flex;gap:16px;flex-wrap:wrap;">';
    html += '<div><span style="color:#9aa9cc;font-size:12px;">滑点类型：</span>';
    html += '<select id="compareSlippageCostType" style="background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 8px;font-size:12px;">';
    html += '<option value="percent"' + (sharedSlippageCostType === 'percent' ? ' selected' : '') + '>百分比</option>';
    html += '<option value="fixed"' + (sharedSlippageCostType === 'fixed' ? ' selected' : '') + '>固定点数</option>';
    html += '</select></div>';

    html += '<div><span style="color:#9aa9cc;font-size:12px;">滑点值：</span>';
    html += '<input type="number" id="compareSlippageCostValue" value="' + sharedSlippageCostValue + '" min="0" max="1" step="0.01" ';
    html += 'style="width:80px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 8px;font-size:12px;"></div>';
    html += '</div>';

    html += '<div style="color:#9aa9cc;font-size:11px;margin-top:4px;">区间：' + startDate + ' ~ ' + endDate + '</div>';
    html += '</div>';

    // ---- Variants ----
    html += '<div style="margin-bottom:10px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
    html += '<span style="color:#fff;font-weight:600;font-size:14px;">📋 参数变体</span>';
    html += '<button id="compareAddVariant" style="background:#2d3a5e;border:none;padding:4px 14px;border-radius:20px;color:#fff;font-size:12px;cursor:pointer;">+ 添加变体</button>';
    html += '</div>';
    html += '<div id="compareVariantsContainer"></div>';
    html += '</div>';

    // Error + Status + Buttons
    html += '<div id="comparePartialError" style="display:none;background:#3a1a1a;border:1px solid #eb5757;border-radius:8px;padding:8px 12px;margin-bottom:10px;color:#eb5757;font-size:12px;"></div>';
    html += '<div id="compareStatus" style="color:#9aa9cc;font-size:12px;margin-bottom:10px;min-height:18px;"></div>';
    html += '<div style="display:flex;gap:12px;justify-content:flex-end;">';
    html += '<button id="compareCancelBtn" style="background:transparent;border:1px solid #323d5a;color:#9aa9cc;padding:6px 18px;border-radius:30px;cursor:pointer;">取消</button>';
    html += '<button id="compareExportBtn" style="background:transparent;border:1px solid #6fcf97;color:#6fcf97;padding:6px 16px;border-radius:30px;cursor:pointer;font-size:13px;">📄 导出代码</button>';
    html += '<button id="compareRunBtn" style="background:#4f7eff;border:none;padding:6px 18px;border-radius:30px;color:#fff;font-weight:600;cursor:pointer;">🚀 开始对比</button>';
    html += '</div>';

    modal.innerHTML = html;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // ---- Variant state: each variant stores param overrides { "0_fastPeriod": 5, ... } ----
    // Key format: "cardIndex_key"
    function defaultParamValues() {
        var vals = {};
        cardParams.forEach(function(p) {
            vals[p.cardIndex + '_' + p.key] = p.value;
        });
        return vals;
    }

    var variants = [
        { name: '默认参数', params: defaultParamValues() },
        { name: '变体2', params: defaultParamValues() }
    ];

    // ---- Build variant card DOM ----
    function buildVariantCard(index, vName, paramValues) {
        var card = document.createElement('div');
        card.className = 'compare-variant-card';
        card.setAttribute('data-variant-index', index);
        card.style.cssText = 'background:#0e1220;border:1px solid #323d5a;border-radius:10px;padding:12px;margin-bottom:8px;';

        // Header row
        var header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
        header.innerHTML =
            '<span style="color:#4f7eff;font-weight:600;font-size:13px;">#' + (index + 1) + '</span>' +
            '<input type="text" class="compare-variant-name" value="' + (vName || '') + '" placeholder="变体名称" ' +
            'style="width:140px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:4px 8px;font-size:12px;">' +
            '<button class="compare-delete-variant" style="background:transparent;border:1px solid #eb5757;color:#eb5757;border-radius:50%;width:22px;height:22px;cursor:pointer;font-size:11px;line-height:1;">✕</button>';
        card.appendChild(header);

        // Params - grouped by cardLabel
        var groups = {};
        cardParams.forEach(function(p) {
            if (!groups[p.cardLabel]) groups[p.cardLabel] = [];
            groups[p.cardLabel].push(p);
        });

        var groupNames = Object.keys(groups);
        groupNames.forEach(function(groupName) {
            var gParams = groups[groupName];

            var groupTitle = document.createElement('div');
            groupTitle.style.cssText = 'color:#f2c94c;font-size:11px;margin:6px 0 4px;padding-left:4px;border-left:2px solid #f2c94c;';
            groupTitle.textContent = groupName;
            card.appendChild(groupTitle);

            var row = document.createElement('div');
            row.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;';

            gParams.forEach(function(p) {
                var wrap = document.createElement('div');
                wrap.style.cssText = 'display:flex;align-items:center;gap:3px;';

                var label = document.createElement('span');
                label.style.cssText = 'color:#9aa9cc;font-size:11px;';
                label.textContent = p.label + ':';

                var input = document.createElement('input');
                input.type = 'number';
                input.className = 'compare-param-input';
                input.setAttribute('data-card-index', p.cardIndex);
                input.setAttribute('data-key', p.key);
                var val = (paramValues && paramValues[p.cardIndex + '_' + p.key] != null)
                    ? paramValues[p.cardIndex + '_' + p.key] : p.value;
                input.value = val;
                if (p.min != null) input.min = p.min;
                if (p.max != null) input.max = p.max;
                if (p.step != null) input.step = p.step;
                input.style.cssText = 'width:58px;background:#1e253b;border:1px solid #323d5a;border-radius:6px;color:#fff;padding:3px 4px;font-size:11px;';

                wrap.appendChild(label);
                wrap.appendChild(input);
                row.appendChild(wrap);
            });

            card.appendChild(row);
        });

        return card;
    }

    function refreshVariants() {
        var container = document.getElementById('compareVariantsContainer');
        if (!container) return;
        container.innerHTML = '';

        variants.forEach(function(v, i) {
            var dom = buildVariantCard(i, v.name, v.params);
            container.appendChild(dom);

            // Delete handler
            dom.querySelector('.compare-delete-variant').addEventListener('click', function() {
                if (variants.length <= 2) { showToast('至少需要 2 个变体', true); return; }
                variants.splice(i, 1);
                refreshVariants();
            });

            // Name change
            dom.querySelector('.compare-variant-name').addEventListener('input', function() {
                variants[i].name = this.value || ('变体' + (i + 1));
            });
        });

        // Bind param inputs
        container.querySelectorAll('.compare-param-input').forEach(function(inp) {
            inp.addEventListener('change', function() {
                var cardIdx = this.getAttribute('data-card-index');
                var key = this.getAttribute('data-key');
                var vIdx = parseInt(this.closest('.compare-variant-card').getAttribute('data-variant-index'));
                if (!variants[vIdx]) return;
                if (!variants[vIdx].params) variants[vIdx].params = {};
                variants[vIdx].params[cardIdx + '_' + key] = parseFloat(this.value) || 0;
            });
        });
    }

    refreshVariants();

    // ---- Event bindings ----
    document.getElementById('compareModalClose').onclick = function() { overlay.remove(); };
    document.getElementById('compareCancelBtn').onclick = function() { overlay.remove(); };
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

    // Add variant
    document.getElementById('compareAddVariant').onclick = function() {
        if (variants.length >= 5) { showToast('最多支持 5 个变体', true); return; }
        // New variant starts with default params (same as card defaults)
        var defVals = {};
        cardParams.forEach(function(p) { defVals[p.cardIndex + '_' + p.key] = p.value; });
        variants.push({ name: '变体' + (variants.length + 1), params: defVals });
        refreshVariants();
    };

    // Index quick-fill buttons
    var fillBtns = modal.querySelectorAll('.compare-fill-index');
    fillBtns.forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            var indexCode = this.getAttribute('data-index');
            if (bridge && typeof bridge.get_index_stocks === 'function') {
                bridge.get_index_stocks(indexCode).then(function(jsonStr) {
                    var codes = JSON.parse(jsonStr);
                    if (Array.isArray(codes) && codes.length > 0) {
                        var stockInput = document.getElementById('compareStockInput');
                        if (stockInput) stockInput.value = codes.join(',');
                        stockPoolArray = codes.slice();
                    }
                });
            }
        });
        btn.addEventListener('mouseenter', function() { this.style.background = '#3a5a8a'; });
        btn.addEventListener('mouseleave', function() { this.style.background = '#2a3a5a'; });
    });

    // Export variants code
    document.getElementById('compareExportBtn').onclick = function() {
        // Collect latest DOM state
        var varCards = document.querySelectorAll('.compare-variant-card');
        varCards.forEach(function(cardDom, i) {
            var nameEl = cardDom.querySelector('.compare-variant-name');
            if (nameEl) variants[i].name = nameEl.value.trim() || ('变体' + (i + 1));
            var params = {};
            cardDom.querySelectorAll('.compare-param-input').forEach(function(inp) {
                var cardIdx = inp.getAttribute('data-card-index');
                var key = inp.getAttribute('data-key');
                params[cardIdx + '_' + key] = parseFloat(inp.value) || 0;
            });
            variants[i].params = params;
        });

        var scInput = document.getElementById('compareStockInput');
        var rawCodes = (scInput ? scInput.value.trim() : '') || stockCode;
        var stockList = parseStockList(rawCodes);
        var isMultiStock = stockList.length > 1;
        var exportStock = stockList.length > 0 ? stockList.join(',') : '000001';

        var parts = [];
        var timestamp = new Date().toISOString().slice(0, 10);
        parts.push('# Tquant 对比回测 - 变体策略代码');
        parts.push('# 导出时间: ' + new Date().toLocaleString());
        parts.push('# 股票池: ' + exportStock);
        parts.push('# 模式: ' + (isMultiStock ? '多股组合回测（共享资金池）' : '单股回测'));
        parts.push('# 变体数量: ' + variants.length);
        parts.push('');

        variants.forEach(function(v, i) {
            try {
                // 多股模式保留占位符，单股模式替换
                var stockForGen = isMultiStock ? null : stockList[0];
                var result = generateVariantCode(v, cards, stockForGen);
                parts.push('# ===== ' + '='.repeat(60));
                parts.push('# 变体 #' + (i + 1) + ': ' + result.name);
                parts.push('# ===== ' + '='.repeat(60));
                parts.push('');
                parts.push(result.code);
                parts.push('');
                parts.push('');
            } catch (e) {
                parts.push('# 变体 #' + (i + 1) + ': ' + v.name + ' — 生成失败: ' + e.message);
                parts.push('');
            }
        });

        var suggestedName = 'compare_variants_' + (isMultiStock ? 'pool' : exportStock) + '_' + timestamp + '.txt';
        bridge.save_text_file(parts.join('\n'), suggestedName).then(function(jsonStr) {
            var res = JSON.parse(jsonStr);
            if (res.cancelled) return;
            if (res.success) {
                showToast('已导出到: ' + res.path, false);
            } else {
                showToast('导出失败: ' + (res.error || '未知错误'), true);
            }
        });
    };

    // Run compare
    document.getElementById('compareRunBtn').onclick = function() {
        var runBtn = document.getElementById('compareRunBtn');
        if (runBtn.disabled) return;

        // Collect params from DOM to make sure we have latest values
        var varCards = document.querySelectorAll('.compare-variant-card');
        varCards.forEach(function(cardDom, i) {
            var nameEl = cardDom.querySelector('.compare-variant-name');
            if (nameEl) variants[i].name = nameEl.value.trim() || ('变体' + (i + 1));
            var params = {};
            cardDom.querySelectorAll('.compare-param-input').forEach(function(inp) {
                var cardIdx = inp.getAttribute('data-card-index');
                var key = inp.getAttribute('data-key');
                params[cardIdx + '_' + key] = parseFloat(inp.value) || 0;
            });
            variants[i].params = params;
        });

        // Read shared params
        var scInput = document.getElementById('compareStockInput');
        var rawCodes = (scInput ? scInput.value.trim() : '') || stockCode;
        var stockList = parseStockList(rawCodes);

        if (stockList.length === 0) {
            showToast('请输入至少一个股票代码', true);
            return;
        }
        stockPoolArray = stockList;
        var isMultiStock = stockList.length > 1;

        var cashEl = document.getElementById('compareCash');
        var finalCash = cashEl ? (Number(cashEl.value) || 100000) : sharedCash;

        var slEl = document.getElementById('compareSlippage');
        var finalSlippage = slEl ? slEl.value : sharedSlippage;

        var commEl = document.getElementById('compareCommission');
        var finalCommission = commEl ? (Number(commEl.value) || 0.0003) : sharedCommission;

        var stEl = document.getElementById('compareStampTax');
        var finalStampTax = stEl ? (Number(stEl.value) || 0.001) : sharedStampTax;

        var slctEl = document.getElementById('compareSlippageCostType');
        var finalSlCt = slctEl ? slctEl.value : sharedSlippageCostType;

        var slcvEl = document.getElementById('compareSlippageCostValue');
        var finalSlCv = slcvEl ? (Number(slcvEl.value) || 0.1) : sharedSlippageCostValue;

        // Generate code for each variant
        // 多股模式不替换占位符，由 MultiBacktestExecutor 内部处理
        var genStock = isMultiStock ? null : stockList[0];
        var variations = [];
        var genErrors = [];
        variants.forEach(function(v) {
            try {
                var result = generateVariantCode(v, cards, genStock);
                variations.push(result);
            } catch (e) {
                genErrors.push({ name: v.name, error: '代码生成失败: ' + e.message });
            }
        });

        if (variations.length < 2) {
            showToast('至少需要 2 个有效变体（当前: ' + variations.length + '）', true);
            return;
        }

        // Show partial errors from code generation
        if (genErrors.length > 0) {
            var errDiv = document.getElementById('comparePartialError');
            if (errDiv) {
                errDiv.style.display = 'block';
                errDiv.innerHTML = '⚠ 部分变体代码生成失败：<br>' +
                    genErrors.map(function(e) { return '· ' + e.name + ': ' + e.error; }).join('<br>');
            }
        }

        // Disable and show loading
        runBtn.disabled = true;
		runBtn.textContent = '⏳ 对比中...';
		var statusDiv = document.getElementById('compareStatus');
		var modeLabel = isMultiStock ? ('多股组合(' + stockList.length + '只)') : '单股';
		statusDiv.innerHTML = '<span class="compare-spinner"></span> 正在并行执行 ' + variations.length + ' 个变体回测 (' + modeLabel + ')... 请耐心等待（计算量较大，可能需要数十秒）';
		statusDiv.style.cssText = 'color:#f2c94c; font-weight:600; margin-bottom:10px;';

		
        var requestData = {
            stock_pool: stockList,
            start: startDate,
            end: endDate,
            cash: finalCash,
            slippage: finalSlippage,
            commission_rate: finalCommission,
            stamp_tax_rate: finalStampTax,
            slippage_cost_type: finalSlCt,
            slippage_cost_value: finalSlCv,
            variations: variations,
            benchmark_code: (document.getElementById('benchmarkSelect') ? document.getElementById('benchmarkSelect').getAttribute('data-value') || null : null)
        };

        bridge.run_compare_backtest(JSON.stringify(requestData)).then(function(jsonStr) {
            var startRes = JSON.parse(jsonStr);
            if (!startRes.success) {
                runBtn.disabled = false;
                runBtn.textContent = '🚀 开始对比';
                statusDiv.textContent = '';
                showToast('启动对比失败: ' + (startRes.error || '未知错误'), true);
                return;
            }

            var jobId = startRes.job_id;
            var totalVars = variations.length;

            var pollInterval = setInterval(function() {
                bridge.get_backtest_progress(jobId).then(function(progStr) {
                    var prog = JSON.parse(progStr);
                    if (prog.status === 'finished') {
                        clearInterval(pollInterval);
                        bridge.get_backtest_result(jobId).then(function(resStr) {
                            var res = JSON.parse(resStr);
                            runBtn.disabled = false;
                            runBtn.textContent = '🚀 开始对比';

                            if (!res.ready) {
                                statusDiv.textContent = '';
                                showToast('获取对比结果失败', true);
                                return;
                            }

                            var result = res.result;

                            // Merge partial errors from backend
                            if (result.errors && result.errors.length > 0) {
                                var errDiv2 = document.getElementById('comparePartialError');
                                if (errDiv2) {
                                    var existing = errDiv2.style.display !== 'none' ? errDiv2.innerHTML : '';
                                    errDiv2.style.display = 'block';
                                    errDiv2.innerHTML = existing + '<br>⚠ 执行错误：<br>' +
                                        result.errors.map(function(e) { return '· ' + e.name + ': ' + e.error; }).join('<br>');
                                }
                            }

                            var totalResults = (result.results || []).length;
                            statusDiv.textContent = '✅ 完成：' + totalResults + '/' + totalVars + ' 个变体成功';

                            // Store globally
                            window._lastCompareResult = {
                                success: true,
                                results: result.results || [],
                                errors: (genErrors.concat(result.errors || [])),
                                stock_pool: stockList,
                                is_multi_stock: isMultiStock,
                                start_date: startDate,
                                end_date: endDate
                            };

                            // Backward compat
                            if (result.results && result.results.length > 0) {
                                var first = result.results[0];
                                window._lastBacktestResult = {
                                    success: true,
                                    signals: first.signals || [],
                                    equity_curve: first.equity_curve || [],
                                    metrics: first.metrics || {}
                                };
                                window.strategySignals = first.signals || [];
                                window.strategyStartDate = startDate;
                                window.strategyEndDate = endDate;
                            }

                            overlay.remove();
                            showToast('✅ 对比完成 | ' + totalResults + '/' + totalVars + ' 个变体成功', false);

                            bridge.cleanup_backtest(jobId);

                            // Navigate to detail page
                            setTimeout(function() {
                                var navEl = document.querySelector('.nav-item[data-page="detail"]');
                                if (navEl) navEl.click();
                            }, 300);
                        });
                    } else if (prog.status === 'cancelling' || prog.status === 'not_found') {
                        clearInterval(pollInterval);
                        runBtn.disabled = false;
                        runBtn.textContent = '🚀 开始对比';
                        statusDiv.textContent = '已取消';
                    } else if (prog.status === 'running') {
                        statusDiv.innerHTML = '<span class="compare-spinner"></span> '
                            + prog.current + '/' + prog.total + ' 个变体完成 (' + modeLabel + ')';
                    }
                });
            }, 500);
        }).catch(function(err) {
            runBtn.disabled = false;
            runBtn.textContent = '🚀 开始对比';
            statusDiv.textContent = '';
            showToast('请求失败: ' + (err.message || err), true);
        });
    };
}

/**
 * 从策略代码中提取 {{param}} 占位符（保留给代码编辑器模式使用）
 */
export function extractParamsFromCode(code) {
    var re = /\{\{(\w+)\}\}/g;
    var params = [];
    var seen = {};
    var match;
    while ((match = re.exec(code)) !== null) {
        var name = match[1];
        if (!seen[name]) { seen[name] = true; params.push(name); }
    }
    return params;
}
