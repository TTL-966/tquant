// js/strategyBuilder.js
// Strategy Factory: visual card-based strategy builder

import { bridge } from './bridge.js';
import { bindDatePicker } from './datepicker.js';
import { escapeHtml } from './main.js';
import { generateCardId, CARD_TYPE_META, STRATEGY_TEMPLATES, createDefaultCard } from './strategyTemplates.js';
import { generateCode, serializeConfig, deserializeConfig, validateCards } from './strategyUtils.js';
import { stockNameMap, fetchStockName } from './stockData.js';
import { Logger } from './logger.js';
import { showCompareBacktestModal } from './compareStrategy.js';

// ---- State ----
var cards = [];
var strategyName = '';
var strategyId = null;
var initialCapital = window._initialCapital || 100000;
var startDate = '2025-01-01';
var endDate = new Date().toISOString().slice(0, 10);
var stockPool = '';
var slippage = 'close';
var logContainer = null;
var codeExpanded = false;
var logExpanded = true;
var strategyLogger = null;

// ---- Custom Select Panel ----

function showCustomSelect(input, options, callback) {
    closeCustomSelect();
    if (!options || options.length === 0) return;

    var panel = document.createElement('div');
    panel.className = 'custom-select-panel';
    panel.style.cssText = 'position:fixed; z-index:99999; background:#1a2135; border:1px solid #4f7eff; border-radius:12px; padding:6px 0; max-height:250px; overflow-y:auto; min-width:260px; box-shadow:0 8px 20px rgba(0,0,0,0.5);';

    options.forEach(function(opt) {
        var item = document.createElement('div');
        item.style.cssText = 'padding:8px 16px; cursor:pointer; color:#fff; font-size:13px; transition:background 0.15s; white-space:nowrap;';
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

// ---- Logging & Toast ----

function addLog(level, text) {
    if (strategyLogger) strategyLogger.addLog(level, text);
}

function clearLog() {
    if (strategyLogger) strategyLogger.clearLog();
}

function showToast(msg, isError, duration) {
    var tip = document.createElement('div');
    tip.style.cssText = 'position:fixed;top:20%;left:50%;transform:translateX(-50%);background:' +
        (isError ? '#ff4c4c' : '#4cff4c') + ';color:#000;padding:10px 20px;border-radius:8px;z-index:99999;font-weight:600;';
    tip.textContent = msg;
    document.body.appendChild(tip);
    setTimeout(function() { tip.remove(); }, duration || 2000);
}

// ---- Card Rendering ----

function buildParamSummary(card) {
    var meta = CARD_TYPE_META[card.type];
    if (!meta) return '';
    var parts = [];
    meta.paramFields.forEach(function(f) {
        var val = card.params[f.key];
        if (val === undefined || val === null) return;
        var display = val;
        if (f.type === 'select' && f.options) {
            var opt = f.options.find(function(o) { return o.value === val; });
            display = opt ? opt.label : val;
        }
        parts.push('<span style="color:#9aa9cc;">' + f.label + ':</span> ' +
            '<span style="color:#fff;">' + display + '</span>');
    });
    return parts.join(' &nbsp;|&nbsp; ');
}

function buildActionBadge(card) {
    if (card.type === 'position') {
        return '<span style="color:#f2c94c;">⚖️ 仓位设置</span>';
    }
    if (card.type === 'stop_loss_profit') {
        return '<span style="color:#ff6b6b;">🛡️ 风控</span>';
    }
    if (card.action === 'buy') {
        return '<span style="color:#4cff4c;">🟢 买入</span>';
    }
    if (card.action === 'sell') {
        return '<span style="color:#ff4c4c;">🔴 卖出</span>';
    }
    return '';
}

function renderSingleCard(card, index) {
    var meta = CARD_TYPE_META[card.type];
    if (!meta) return '';
    return '<div class="strategy-card" draggable="true" data-card-index="' + index + '" ' +
        'style="background:#0e1220;border:1px solid #323d5a;border-radius:12px;padding:12px 14px;margin-bottom:8px;cursor:grab;transition:border-color 0.2s;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;">' +
        '<div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">' +
        '<span style="color:#4f7eff;cursor:grab;font-size:16px;" class="drag-handle">≡</span>' +
        '<span style="font-size:18px;">' + meta.icon + '</span>' +
        '<span style="color:#fff;font-weight:600;white-space:nowrap;">' + meta.label + '</span>' +
        '<span style="color:#9aa9cc;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
        buildParamSummary(card) + '</span>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">' +
        '<span style="font-size:12px;margin-right:4px;">' + buildActionBadge(card) + '</span>' +
        (index > 0 ? '<button class="card-btn card-up" data-idx="' + index + '" title="上移">⬆</button>' : '<span style="width:28px;"></span>') +
        (index < cards.length - 1 ? '<button class="card-btn card-down" data-idx="' + index + '" title="下移">⬇</button>' : '<span style="width:28px;"></span>') +
        '<button class="card-btn card-edit" data-idx="' + index + '" title="编辑">✏️</button>' +
        '<button class="card-btn card-delete" data-idx="' + index + '" title="删除">🗑️</button>' +
        '</div></div></div>';
}

function renderCards() {
    var container = document.getElementById('cardList');
    if (!container) return;
    if (cards.length === 0) {
        container.innerHTML = '<div style="color:#9aa9cc;text-align:center;padding:32px 0;border:2px dashed #323d5a;border-radius:12px;">还没有添加条件卡片<br><span style="font-size:12px;">点击下方按钮开始构建策略</span></div>';
    } else {
        container.innerHTML = cards.map(function(c, i) { return renderSingleCard(c, i); }).join('');
    }
    bindCardEvents();
    updateCodePreview();
}

function bindCardEvents() {
    // Drag events
    var cardEls = document.querySelectorAll('.strategy-card');
    cardEls.forEach(function(el) {
        el.addEventListener('dragstart', function(e) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', el.getAttribute('data-card-index'));
            el.style.opacity = '0.5';
        });
        el.addEventListener('dragend', function() {
            el.style.opacity = '1';
            document.querySelectorAll('.strategy-card').forEach(function(c) { c.style.borderColor = '#323d5a'; });
        });
        el.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            el.style.borderColor = '#4f7eff';
        });
        el.addEventListener('dragleave', function() {
            el.style.borderColor = '#323d5a';
        });
        el.addEventListener('drop', function(e) {
            e.preventDefault();
            el.style.borderColor = '#323d5a';
            var fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
            var toIdx = parseInt(el.getAttribute('data-card-index'));
            if (!isNaN(fromIdx) && !isNaN(toIdx) && fromIdx !== toIdx) {
                moveCard(fromIdx, toIdx);
            }
        });
    });

    // Up/down buttons
    document.querySelectorAll('.card-up').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var idx = parseInt(this.getAttribute('data-idx'));
            if (idx > 0) moveCard(idx, idx - 1);
        });
    });
    document.querySelectorAll('.card-down').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var idx = parseInt(this.getAttribute('data-idx'));
            if (idx < cards.length - 1) moveCard(idx, idx + 1);
        });
    });

    // Edit
    document.querySelectorAll('.card-edit').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var idx = parseInt(this.getAttribute('data-idx'));
            showEditCardModal(cards[idx], idx);
        });
    });

    // Delete
    document.querySelectorAll('.card-delete').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var idx = parseInt(this.getAttribute('data-idx'));
            deleteCard(idx);
        });
    });
}

// ---- Card CRUD ----

function addCard(typeKey, action, params) {
    var meta = CARD_TYPE_META[typeKey];
    if (!meta) return;
    var card = {
        id: generateCardId(),
        type: typeKey,
        action: action !== undefined ? action : meta.defaultAction,
        params: params ? JSON.parse(JSON.stringify(params)) : JSON.parse(JSON.stringify(meta.defaultParams))
    };
    cards.push(card);
    renderCards();
}

function deleteCard(index) {
    if (index < 0 || index >= cards.length) return;
    cards.splice(index, 1);
    renderCards();
}

function moveCard(fromIdx, toIdx) {
    if (fromIdx < 0 || fromIdx >= cards.length || toIdx < 0 || toIdx >= cards.length) return;
    var item = cards.splice(fromIdx, 1)[0];
    cards.splice(toIdx, 0, item);
    renderCards();
}

// ---- Modals ----

function showAddCardModal() {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;';
    overlay.onclick = function() { overlay.remove(); modal.remove(); };

    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1a2135;border:1px solid #4f7eff;border-radius:12px;padding:24px;min-width:680px;z-index:10000;color:#fff;';

    var title = document.createElement('div');
    title.style.cssText = 'font-weight:600;font-size:16px;margin-bottom:16px;';
    title.textContent = '选择条件类型';

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✖';
    closeBtn.style.cssText = 'position:absolute;top:8px;right:12px;background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;';
    closeBtn.onclick = function() { overlay.remove(); modal.remove(); };

    var grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(5, 1fr);gap:6px;';

    var typeKeys = ['ma_cross', 'rsi', 'macd', 'bollinger', 'bollinger_width', 'kdj', 'volume', 'volume_contraction', 'day_of_week', 'sar', 'obv', 'hammer_hanging', 'williams_r', 'roc', 'psy', 'atr_breakout', 'cci', 'ma_alignment', 'stop_loss_profit', 'position', 'price_limit', 'pe_below', 'pb_below', 'roe_above'];
    typeKeys.forEach(function(key) {
        var meta = CARD_TYPE_META[key];
        var item = document.createElement('div');
        item.style.cssText = 'background:#0e1220;border:1px solid #323d5a;border-radius:10px;padding:8px 6px;cursor:pointer;text-align:center;transition:background 0.2s;';
        item.title = meta.description;
        item.innerHTML = '<div style="font-size:24px;">' + meta.icon + '</div>' +
            '<div style="color:#fff;font-weight:600;font-size:13px;margin-top:3px;">' + meta.label + '</div>';
        item.onmouseenter = function() { item.style.background = '#1a2540'; };
        item.onmouseleave = function() { item.style.background = '#0e1220'; };
        item.onclick = function() {
            overlay.remove();
            modal.remove();
            if (key === 'position') {
                addCard(key, null);
            } else if (key === 'stop_loss_profit') {
                addCard(key, 'sell');
            } else {
                // Show action picker inline
                showActionPicker(key);
            }
        };
        grid.appendChild(item);
    });

    modal.appendChild(closeBtn);
    modal.appendChild(title);
    modal.appendChild(grid);
    document.body.appendChild(overlay);
    document.body.appendChild(modal);
}

function showActionPicker(typeKey) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:10001;';
    overlay.onclick = function() { overlay.remove(); picker.remove(); };

    var picker = document.createElement('div');
    picker.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1a2135;border:1px solid #4f7eff;border-radius:12px;padding:24px;z-index:10002;color:#fff;text-align:center;';

    var meta = CARD_TYPE_META[typeKey];
    picker.innerHTML = '<div style="font-size:28px;margin-bottom:8px;">' + meta.icon + '</div>' +
        '<div style="font-weight:600;margin-bottom:12px;">' + meta.label + '</div>' +
        '<div style="color:#9aa9cc;margin-bottom:16px;">选择交易方向</div>';

    var buyBtn = document.createElement('button');
    buyBtn.textContent = '🟢 买入';
    buyBtn.style.cssText = 'background:#2a4a2a;border:1px solid #4cff4c;color:#4cff4c;padding:8px 24px;border-radius:8px;cursor:pointer;margin-right:8px;font-size:14px;';
    buyBtn.onclick = function() { overlay.remove(); picker.remove(); addCard(typeKey, 'buy'); };

    var sellBtn = document.createElement('button');
    sellBtn.textContent = '🔴 卖出';
    sellBtn.style.cssText = 'background:#4a2a2a;border:1px solid #ff4c4c;color:#ff4c4c;padding:8px 24px;border-radius:8px;cursor:pointer;font-size:14px;';
    sellBtn.onclick = function() { overlay.remove(); picker.remove(); addCard(typeKey, 'sell'); };

    picker.appendChild(buyBtn);
    picker.appendChild(sellBtn);
    document.body.appendChild(overlay);
    document.body.appendChild(picker);
}

function showEditCardModal(card, index) {
    var meta = CARD_TYPE_META[card.type];
    if (!meta) return;

    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;';
    overlay.onclick = function() { closeCustomSelect(); overlay.remove(); modal.remove(); };

    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1a2135;border:1px solid #4f7eff;border-radius:12px;padding:24px;min-width:380px;max-width:460px;z-index:10000;color:#fff;';

    var title = document.createElement('div');
    title.style.cssText = 'font-weight:600;font-size:16px;margin-bottom:16px;';
    title.textContent = '编辑 - ' + meta.label;

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✖';
    closeBtn.style.cssText = 'position:absolute;top:8px;right:12px;background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;';
    closeBtn.onclick = function() { closeCustomSelect(); overlay.remove(); modal.remove(); };

    var body = document.createElement('div');

    // Build form fields
    var formData = {};
    meta.paramFields.forEach(function(f) {
        formData[f.key] = card.params[f.key] !== undefined ? card.params[f.key] : f.default;

        var row = document.createElement('div');
        row.style.cssText = 'margin-bottom:12px;overflow:hidden;';

        var label = document.createElement('div');
        label.style.cssText = 'color:#9aa9cc;font-size:12px;margin-bottom:4px;';
        label.textContent = f.label;
        row.appendChild(label);

        if (f.type === 'select' && f.options) {
            var currentValue = formData[f.key];
            var currentLabel = currentValue;
            var foundOpt = f.options.find(function(opt) { return opt.value === currentValue; });
            if (foundOpt) currentLabel = foundOpt.label;

            var input = document.createElement('input');
            input.type = 'text';
            input.setAttribute('data-field', f.key);
            input.setAttribute('data-value', currentValue);
            input.setAttribute('readonly', 'readonly');
            input.value = currentLabel;
            input.style.cssText = 'width:260px; background:#1e253b; border:1px solid #323d5a; border-radius:30px; color:#fff; padding:6px 10px; font-size:13px; box-sizing:border-box; cursor:pointer;';

            input.addEventListener('click', function(e) {
                e.stopPropagation();
                showCustomSelect(input, f.options, function(selectedValue) {});
            });

            row.appendChild(input);
        } else if (f.type === 'number') {
            var input = document.createElement('input');
            input.type = 'number';
            input.setAttribute('data-field', f.key);
            if (f.min !== undefined) input.min = f.min;
            if (f.max !== undefined) input.max = f.max;
            if (f.step !== undefined) input.step = f.step;
            input.value = formData[f.key];
            input.style.cssText = 'width:100%;background:#0e1220;border:1px solid #323d5a;border-radius:8px;color:#fff;padding:8px;font-size:13px;box-sizing:border-box;';
            row.appendChild(input);
        }

        body.appendChild(row);
    });

    // Action toggle for non-position, non-stop-loss cards
    if (card.type !== 'position' && card.type !== 'stop_loss_profit') {
        var actionRow = document.createElement('div');
        actionRow.style.cssText = 'margin-top:16px;display:flex;gap:8px;align-items:center;';
        actionRow.innerHTML = '<span style="color:#9aa9cc;font-size:12px;">交易方向：</span>';

        var buyToggle = document.createElement('button');
        buyToggle.textContent = '🟢 买入';
        buyToggle.setAttribute('data-action', 'buy');
        buyToggle.style.cssText = 'padding:6px 16px;border-radius:20px;border:1px solid;cursor:pointer;' +
            (card.action === 'buy' ? 'background:#2a4a2a;border-color:#4cff4c;color:#4cff4c;' : 'background:transparent;border-color:#323d5a;color:#9aa9cc;');
        buyToggle.onclick = function() {
            buyToggle.style.cssText = 'padding:6px 16px;border-radius:20px;border:1px solid;cursor:pointer;background:#2a4a2a;border-color:#4cff4c;color:#4cff4c;';
            sellToggle.style.cssText = 'padding:6px 16px;border-radius:20px;border:1px solid;cursor:pointer;background:transparent;border-color:#323d5a;color:#9aa9cc;';
            buyToggle.setAttribute('data-selected', 'true');
            sellToggle.setAttribute('data-selected', 'false');
        };

        var sellToggle = document.createElement('button');
        sellToggle.textContent = '🔴 卖出';
        sellToggle.setAttribute('data-action', 'sell');
        sellToggle.style.cssText = 'padding:6px 16px;border-radius:20px;border:1px solid;cursor:pointer;' +
            (card.action === 'sell' ? 'background:#4a2a2a;border-color:#ff4c4c;color:#ff4c4c;' : 'background:transparent;border-color:#323d5a;color:#9aa9cc;');
        sellToggle.setAttribute('data-selected', card.action === 'sell' ? 'true' : 'false');
        buyToggle.setAttribute('data-selected', card.action === 'buy' ? 'true' : 'false');
        sellToggle.onclick = function() {
            sellToggle.style.cssText = 'padding:6px 16px;border-radius:20px;border:1px solid;cursor:pointer;background:#4a2a2a;border-color:#ff4c4c;color:#ff4c4c;';
            buyToggle.style.cssText = 'padding:6px 16px;border-radius:20px;border:1px solid;cursor:pointer;background:transparent;border-color:#323d5a;color:#9aa9cc;';
            sellToggle.setAttribute('data-selected', 'true');
            buyToggle.setAttribute('data-selected', 'false');
        };

        actionRow.appendChild(buyToggle);
        actionRow.appendChild(sellToggle);
        body.appendChild(actionRow);
    }

    // Save button
    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:12px;margin-top:20px;';

    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.style.cssText = 'background:transparent;border:1px solid #323d5a;color:#9aa9cc;padding:6px 18px;border-radius:30px;cursor:pointer;';
    cancelBtn.onclick = function() { closeCustomSelect(); overlay.remove(); modal.remove(); };

    var saveBtn = document.createElement('button');
    saveBtn.textContent = '保存';
    saveBtn.style.cssText = 'background:#4f7eff;border:none;padding:6px 18px;border-radius:30px;color:#fff;font-weight:600;cursor:pointer;';
    saveBtn.onclick = function() {
        var newParams = {};
        meta.paramFields.forEach(function(f) {
            var el = modal.querySelector('[data-field="' + f.key + '"]');
            if (el) {
                var val;
                if (f.type === 'select') {
                    val = el.getAttribute('data-value') || el.value;
                } else if (f.type === 'number') {
                    val = parseFloat(el.value);
                    if (isNaN(val)) val = f.default;
                    if (f.min !== undefined && val < f.min) val = f.min;
                    if (f.max !== undefined && val > f.max) val = f.max;
                } else {
                    val = el.value;
                }
                newParams[f.key] = val;
            }
        });
        // Get action
        var newAction = card.action;
        var buyEl = modal.querySelector('[data-action="buy"]');
        var sellEl = modal.querySelector('[data-action="sell"]');
        if (buyEl && sellEl) {
            if (buyEl.getAttribute('data-selected') === 'true') newAction = 'buy';
            if (sellEl.getAttribute('data-selected') === 'true') newAction = 'sell';
        }
        card.params = newParams;
        card.action = newAction;
        renderCards();
        overlay.remove();
        modal.remove();
    };

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(saveBtn);
    modal.appendChild(closeBtn);
    modal.appendChild(title);
    modal.appendChild(body);
    modal.appendChild(btnRow);
    document.body.appendChild(overlay);
    document.body.appendChild(modal);
}

function showTemplateModal() {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;';
    overlay.onclick = function() { overlay.remove(); modal.remove(); };

    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1a2135;border:1px solid #4f7eff;border-radius:12px;padding:24px;min-width:420px;max-width:500px;max-height:70vh;overflow-y:auto;z-index:10000;color:#fff;';

    var title = document.createElement('div');
    title.style.cssText = 'font-weight:600;font-size:16px;margin-bottom:16px;';
    title.textContent = '📂 策略模板';

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✖';
    closeBtn.style.cssText = 'position:absolute;top:8px;right:12px;background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;';
    closeBtn.onclick = function() { overlay.remove(); modal.remove(); };

    var list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:10px;';

    STRATEGY_TEMPLATES.forEach(function(tpl) {
        var item = document.createElement('div');
        item.style.cssText = 'background:#0e1220;border:1px solid #323d5a;border-radius:10px;padding:14px;cursor:pointer;';
        item.innerHTML = '<div style="color:#fff;font-weight:600;">' + escapeHtml(tpl.name) + '</div>' +
            '<div style="color:#9aa9cc;font-size:12px;margin-top:4px;">' + escapeHtml(tpl.description) + '</div>' +
            '<div style="color:#4f7eff;font-size:11px;margin-top:4px;">' + tpl.cards.length + ' 张卡片</div>';
        item.onmouseenter = function() { item.style.background = '#1a2540'; };
        item.onmouseleave = function() { item.style.background = '#0e1220'; };
        item.onclick = function() {
            cards = tpl.cards.map(function(c) {
                return {
                    id: generateCardId(),
                    type: c.type,
                    action: c.action,
                    params: JSON.parse(JSON.stringify(c.params))
                };
            });
            strategyName = tpl.name;
            var nameInput = document.getElementById('strategyNameInput');
            if (nameInput) nameInput.value = strategyName;
            if (tpl.defaultStock) {
                window._defaultStockFromTemplate = tpl.defaultStock;
            }
            renderCards();
            overlay.remove();
            modal.remove();
            showToast('已加载模板: ' + tpl.name, false);
        };
        list.appendChild(item);
    });

    modal.appendChild(closeBtn);
    modal.appendChild(title);
    modal.appendChild(list);
    document.body.appendChild(overlay);
    document.body.appendChild(modal);
}

function showStrategyListModal() {
    if (!bridge) { showToast('Bridge 未连接', true); return; }

    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;';
    overlay.onclick = function() { overlay.remove(); popup.remove(); };

    var popup = document.createElement('div');
    popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1a2135;border:1px solid #4f7eff;border-radius:12px;padding:24px;min-width:400px;max-height:60vh;overflow-y:auto;z-index:10000;color:#fff;';

    var title = document.createElement('div');
    title.style.cssText = 'font-weight:600;font-size:16px;margin-bottom:16px;';
    title.textContent = '📂 我的策略';

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✖';
    closeBtn.style.cssText = 'position:absolute;top:8px;right:12px;background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;';
    closeBtn.onclick = function() { overlay.remove(); popup.remove(); };

    var listDiv = document.createElement('div');

    bridge.list_strategies().then(function(jsonStr) {
        var arr = JSON.parse(jsonStr);
        if (!Array.isArray(arr) || arr.length === 0) {
            listDiv.innerHTML = '<div style="color:#9aa9cc;padding:20px;text-align:center;">暂无保存的策略</div>';
            return;
        }
        var html = '';
        arr.forEach(function(item) {
            html += '<div class="strategy-list-item" data-id="' + item.id + '" ' +
                'style="padding:10px;margin-bottom:6px;background:#0e1220;border-radius:8px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;">' +
                '<div><strong>' + escapeHtml(item.name) + '</strong> <span style="color:#9aa9cc;font-size:12px;">ID: ' + item.id + '</span></div>' +
                '<div><button class="load-strategy-btn" data-id="' + item.id + '" style="background:#2a3a5a;border:none;color:#fff;padding:4px 10px;border-radius:12px;cursor:pointer;font-size:11px;margin-right:4px;">加载</button>' +
                '<button class="del-strategy-btn" data-id="' + item.id + '" style="background:#4a2a2a;border:none;color:#ff6b6b;padding:4px 10px;border-radius:12px;cursor:pointer;font-size:11px;">删除</button></div>' +
                '</div>';
        });
        listDiv.innerHTML = html;

        listDiv.querySelectorAll('.load-strategy-btn').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                loadStrategyById(parseInt(this.getAttribute('data-id')));
                overlay.remove();
                popup.remove();
            });
        });
        listDiv.querySelectorAll('.del-strategy-btn').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var id = parseInt(this.getAttribute('data-id'));
                if (confirm('确认删除策略 ID=' + id + ' 吗？')) {
                    bridge.delete_strategy(id).then(function() {
                        showToast('已删除', false);
                        overlay.remove();
                        popup.remove();
                    });
                }
            });
        });
    }).catch(function() {
        listDiv.innerHTML = '<div style="color:#ff6b6b;padding:20px;text-align:center;">加载失败</div>';
    });

    popup.appendChild(closeBtn);
    popup.appendChild(title);
    popup.appendChild(listDiv);
    document.body.appendChild(overlay);
    document.body.appendChild(popup);
}

function showBacktestModal() {
    if (!bridge) { showToast('Bridge 未连接', true); return; }

    var validation = validateCards(cards);
    if (!validation.valid) {
        showToast(validation.errors[0], true);
        return;
    }

    var code = generateCode(cards);
    window.currentStrategyCode = code;

    var stockInput = document.getElementById('stockPoolInput');
    var pageStockPoolInput = document.getElementById('strategyStockPool');
    var savedStockPool = pageStockPoolInput ? pageStockPoolInput.value.trim() : '';
    var defaultStock = savedStockPool || (window._defaultStockFromTemplate) || '000001';

    var pageStartInput = document.getElementById('strategyStartDate');
    var pageEndInput = document.getElementById('strategyEndDate');
    var startDt = pageStartInput ? pageStartInput.value : startDate;
    var endDt = pageEndInput ? pageEndInput.value : endDate;
    var capitalInput = document.getElementById('initialCapitalInput');
    var cash = capitalInput ? (Number(capitalInput.value) || 1000000) : initialCapital;

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

    var dateInfo = document.createElement('div');
    dateInfo.style.cssText = 'color:#9aa9cc;font-size:13px;margin-bottom:12px;';
    dateInfo.textContent = '回测区间：' + startDt + ' ~ ' + endDt;

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
    stockArea.setAttribute('id', 'modalStockInput');
    stockArea.style.cssText = 'width:100%;background:#0e1220;border:1px solid #323d5a;border-radius:12px;color:#fff;padding:8px;font-family:monospace;box-sizing:border-box;';
    stockArea.value = defaultStock;
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

    var capitalRow = document.createElement('div');
    capitalRow.style.cssText = 'display:flex;gap:12px;align-items:center;margin-top:12px;';
    capitalRow.innerHTML = '<span style="color:#9aa9cc;font-size:13px;">初始资金：</span>' +
        '<span style="color:#4f7eff;font-weight:600;">¥' + Number(cash).toLocaleString() + '</span>';

    var statusDiv = document.createElement('div');
    statusDiv.style.cssText = 'color:#9aa9cc;font-size:12px;margin-top:12px;min-height:18px;';

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

        var start = startDt;
        var end = endDt;
        var cashVal = cash;
        var sName = strategyName || '未命名策略';
        var userCode = generateCode(cards);

        window.currentStrategyCode = userCode;
        window.currentStrategyName = sName;

        clearLog();
        addLog('info', '开始回测 ' + codes.length + ' 只股票：' + codes.map(function(c) { return c.split('.')[0]; }).join(', '));
        addLog('info', '回测参数 | 初始资金: ¥' + cashVal.toLocaleString() + ' | 区间: ' + start + ' ~ ' + end);

        var slippageInput = document.getElementById('slippageInput');
        var slippageType = slippageInput ? (slippageInput.getAttribute('data-value') || 'close') : 'close';
        window._slippageMode = slippageType;

        var startTime = Date.now();

        function processSingleStockResults(results, elapsed) {
            var mergedSignals = [];
            var equityMap = {};
            var positionMap = {};

            results.forEach(function(r) {
                if (!r) return;
                if (r.signals) {
                    r.signals.forEach(function(s) {
                        var code = s.code || '';
                        mergedSignals.push({ date: s.date, code: code, type: s.type, price: s.price, shares: s.shares, reason: s.reason });
                        if (!positionMap[code]) positionMap[code] = 0;
                        if (s.type === 'buy') {
                            positionMap[code] += (s.price || 0) * (s.shares || 0);
                        } else {
                            positionMap[code] -= (s.price || 0) * (s.shares || 0);
                        }
                    });
                }
                if (r.equity_curve) {
                    r.equity_curve.forEach(function(ec) {
                        if (equityMap[ec.date] === undefined) equityMap[ec.date] = 0;
                        equityMap[ec.date] += ec.value;
                    });
                }
            });

            var unknownCodes = [];
            var seenCodes = {};
            mergedSignals.forEach(function(s) {
                var c = s.code || '';
                if (c && !stockNameMap[c] && !seenCodes[c]) {
                    seenCodes[c] = true;
                    unknownCodes.push(c);
                }
            });

            function buildFinalResult() {
                var mergedEquityCurve = Object.keys(equityMap).sort().map(function(date) {
                    return { date: date, value: equityMap[date] };
                });

                var firstMetrics = (results.length > 0 && results[0] && results[0].metrics) ? results[0].metrics : {};
                var mergedResult = { success: true, signals: mergedSignals, equity_curve: mergedEquityCurve, metrics: firstMetrics, stock_performance: null};
                for (var i = 0; i < results.length; i++) {
                    if (results[i] && results[i].stock_performance) { mergedResult.stock_performance = results[i].stock_performance; break; }
                }

                window._lastBacktestResult = mergedResult;
                window.strategySignals = mergedSignals;
                window._lastBacktestError = null;
                window.strategyStartDate = start;
                window.strategyEndDate = end;

                var posEntries = Object.keys(positionMap).map(function(k) { return { code: k, value: positionMap[k] }; });
                posEntries.sort(function(a, b) { return b.value - a.value; });
                window.topPositionCodes = posEntries.slice(0, 6).map(function(e) { return e.code; });

                addLog('success', '✅ 回测完成，总信号 ' + mergedSignals.length + ' 个，耗时 ' + elapsed + ' 秒');
                if (mergedSignals.length === 0) {
                    addLog('warn', '回测区间内无信号产生，请检查条件参数或回测区间是否合理');
                }
                addLog('info', '💡 请前往【策略详情】查看详细结果，或切换至【买卖点成交图】查看K线信号');

                overlay.remove();
                modal.remove();
                showToast('✅ 回测完成 | ' + codes.length + '只股票 | 耗时' + elapsed + '秒 | 信号' + mergedSignals.length + '个', false);
            }

            if (unknownCodes.length > 0) {
                addLog('info', '正在加载 ' + unknownCodes.length + ' 只股票的名称...');
                var namePromises = unknownCodes.map(function(c) { return fetchStockName(c, bridge); });
                Promise.all(namePromises).then(function() {
                    buildFinalResult();
                });
            } else {
                buildFinalResult();
            }
        }

        function finalizeError(err) {
            addLog('error', '回测整体失败: ' + err.message);
            window._lastBacktestError = err.message;
            statusDiv.textContent = '回测整体失败: ' + err.message;
            statusDiv.style.color = '#ff4c4c';
            runBtn.disabled = false;
            runBtn.textContent = '开始回测';
        }

        if (codes.length > 1) {
            // ---- 多股组合回测：共享资金池 ----
            addLog('info', '🚀 启动多股组合回测（共享资金池），共 ' + codes.length + ' 只股票');
            // 发送原始代码（含 STOCK_CODE_PLACEHOLDER），后端逐个替换
            var commission = parseFloat(document.getElementById('commissionRate').value) || 0.0003;
            var stampTax = parseFloat(document.getElementById('stampTaxRate').value) || 0.001;
            var slippageCostTypeVal = document.getElementById('slippageCostType').getAttribute('data-value') || 'percent';
            var slippageCostValueVal = parseFloat(document.getElementById('slippageCostValue').value) || 0.1;
            var multiParams = { code: userCode, stocks: codes, start: start, end: end, cash: cashVal, slippage: slippageType,
                commission_rate: commission, stamp_tax_rate: stampTax,
                slippage_cost_type: slippageCostTypeVal, slippage_cost_value: slippageCostValueVal };
            bridge.run_multi_backtest(JSON.stringify(multiParams)).then(function(jsonStr) {
                var res = JSON.parse(jsonStr);
                var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                if (!res.success) {
                    addLog('error', '多股回测失败: ' + (res.error || '未知错误'));
                    finalizeError(new Error(res.error || '未知错误'));
                    return;
                }
                if (res.logs && res.logs.length > 0) {
                    res.logs.slice(-30).forEach(function(l) {
                        if (l.indexOf('[WARN]') !== -1) {
                            addLog('warn', '[后端] ' + l.replace('[WARN] ', ''));
                        } else if (l.indexOf('[ERROR]') !== -1) {
                            addLog('error', '[后端] ' + l.replace('[ERROR] ', ''));
                        } else {
                            addLog('info', '[后端] ' + l.replace('[INFO] ', ''));
                        }
                    });
                }

                var signals = res.signals || [];
                var equityCurve = res.equity_curve || [];
                var metrics = res.metrics || {};
                var stockPerformance = res.stock_performance || [];

                // 多股回测直接使用后端组合结果，不再经过 processSingleStockResults 合并
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

                // 计算 topPositionCodes（用于买卖点成交图下拉框排序）
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

                // 加载未知股票名称
                var unknownCodes = [];
                var seenCodes = {};
                signals.forEach(function(s) {
                    var c = s.code || '';
                    if (c && !stockNameMap[c] && !seenCodes[c]) {
                        seenCodes[c] = true;
                        unknownCodes.push(c);
                    }
                });
                if (unknownCodes.length > 0) {
                    addLog('info', '正在加载 ' + unknownCodes.length + ' 只股票的名称...');
                    var namePromises = unknownCodes.map(function(c) { return fetchStockName(c, bridge); });
                    Promise.all(namePromises).then(function() {
                        addLog('success', '✅ 回测完成，总信号 ' + signals.length + ' 个，耗时 ' + elapsed + ' 秒');
                        if (signals.length === 0) addLog('warn', '回测区间内无信号产生，请检查条件参数或回测区间是否合理');
                        addLog('info', '💡 请前往【策略详情】查看详细结果，或切换至【买卖点成交图】查看K线信号');
                        overlay.remove();
                        modal.remove();
                        showToast('✅ 回测完成 | ' + codes.length + '只股票 | 耗时' + elapsed + '秒 | 信号' + signals.length + '个', false);
                    });
                } else {
                    addLog('success', '✅ 回测完成，总信号 ' + signals.length + ' 个，耗时 ' + elapsed + ' 秒');
                    if (signals.length === 0) addLog('warn', '回测区间内无信号产生，请检查条件参数或回测区间是否合理');
                    addLog('info', '💡 请前往【策略详情】查看详细结果，或切换至【买卖点成交图】查看K线信号');
                    overlay.remove();
                    modal.remove();
                    showToast('✅ 回测完成 | ' + codes.length + '只股票 | 耗时' + elapsed + '秒 | 信号' + signals.length + '个', false);
                }
            }).catch(function(err) {
                finalizeError(err);
            });
        } else {
            // ---- 单股回测：使用原有接口 ----
            var stock = codes[0];
            var cleanCode = userCode.replace(/"STOCK_CODE_PLACEHOLDER"/g, '"' + stock + '"');
            var commission2 = parseFloat(document.getElementById('commissionRate').value) || 0.0003;
            var stampTax2 = parseFloat(document.getElementById('stampTaxRate').value) || 0.001;
            var slippageCostTypeVal2 = document.getElementById('slippageCostType').getAttribute('data-value') || 'percent';
            var slippageCostValueVal2 = parseFloat(document.getElementById('slippageCostValue').value) || 0.1;
            var params = { code: cleanCode, stock: stock, start: start, end: end, cash: cashVal, slippage: slippageType,
                commission_rate: commission2, stamp_tax_rate: stampTax2,
                slippage_cost_type: slippageCostTypeVal2, slippage_cost_value: slippageCostValueVal2 };
            bridge.run_custom_backtest(JSON.stringify(params)).then(function(jsonStr) {
                var res = JSON.parse(jsonStr);
                var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                if (!res.success) {
                    addLog('error', stock + ' 回测失败: ' + (res.error || '未知'));
                    finalizeError(new Error(res.error || '未知错误'));
                    return;
                }
                var sigCount = (res.signals && res.signals.length) || 0;
                addLog('success', stock + ' 回测完成，信号 ' + sigCount + ' 个');
                if (res.logs && res.logs.length > 0) {
                    res.logs.slice(-10).forEach(function(l) {
                        if (l.indexOf('[WARN]') !== -1) {
                            addLog('warn', '[后端] ' + l.replace('[WARN] ', ''));
                        } else if (l.indexOf('[ERROR]') !== -1) {
                            addLog('error', '[后端] ' + l.replace('[ERROR] ', ''));
                        } else {
                            addLog('info', '[后端] ' + l.replace('[INFO] ', ''));
                        }
                    });
                }
                processSingleStockResults([res], elapsed);
            }).catch(function(err) {
                finalizeError(err);
            });
        }
    };

    body.appendChild(dateInfo);
    body.appendChild(indexRow);
    body.appendChild(stockLabel);
    body.appendChild(stockArea);
    body.appendChild(capitalRow);
    body.appendChild(statusDiv);
    body.appendChild(btnRow);
    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(runBtn);

    modal.appendChild(closeBtn);
    modal.appendChild(title);
    modal.appendChild(body);
    document.body.appendChild(overlay);
    document.body.appendChild(modal);
}

// ---- Persistence ----

function saveCurrentStrategy() {
    if (!bridge) { showToast('Bridge 未连接', true); return; }
    var nameInput = document.getElementById('strategyNameInput');
    var name = nameInput ? nameInput.value.trim() : '';
    if (!name) {
        showToast('请输入策略名称', true);
        if (nameInput) { nameInput.classList.add('error'); setTimeout(function() { nameInput.classList.remove('error'); }, 2000); }
        return;
    }
    var capitalInput = document.getElementById('initialCapitalInput');
    var cap = capitalInput ? (Number(capitalInput.value) || 1000000) : initialCapital;
    var startInput = document.getElementById('strategyStartDate');
    var endInput = document.getElementById('strategyEndDate');
    var sDate = startInput ? startInput.value : startDate;
    var eDate = endInput ? endInput.value : endDate;
    var stockPoolInput = document.getElementById('strategyStockPool');
    var sp = stockPoolInput ? stockPoolInput.value.trim() : (stockPool || '');
    var spInput = document.getElementById('slippageInput');
    var sl = spInput ? (spInput.getAttribute('data-value') || 'close') : (slippage || 'close');
    var commission = parseFloat(document.getElementById('commissionRate').value) || 0.0003;
    var stampTax = parseFloat(document.getElementById('stampTaxRate').value) || 0.001;
    var slippageCostType = document.getElementById('slippageCostType').getAttribute('data-value') || 'percent';
    var slippageCostValue = parseFloat(document.getElementById('slippageCostValue').value) || 0.1;
    var jsonConfig = serializeConfig(cards, cap, sDate, eDate, sp, sl, commission, stampTax, slippageCostType, slippageCostValue);

    var saveBtn = document.getElementById('saveStrategyBtn');
    var currentId = saveBtn && saveBtn.dataset.currentId ? parseInt(saveBtn.dataset.currentId) : null;

    bridge.save_strategy(name, jsonConfig, currentId || 0).then(function(jsonStr) {
        var result = JSON.parse(jsonStr);
        if (result.success) {
            strategyId = result.id;
            strategyName = name;
            if (saveBtn) saveBtn.dataset.currentId = result.id;
            window.currentStrategyName = name;
            showToast('✅ 已保存 ID=' + result.id, false);
        } else {
            showToast('保存失败: ' + (result.message || ''), true);
        }
    }).catch(function(err) {
        showToast('保存失败: ' + err.message, true);
    });
}

function loadStrategyById(id) {
    if (!bridge) { showToast('Bridge 未连接', true); return; }
    bridge.load_strategy(id).then(function(jsonStr) {
        var obj = JSON.parse(jsonStr);
        if (obj.error) { showToast('加载失败: ' + obj.error, true); return; }
        var config = deserializeConfig(obj.code);
        if (!config) {
            showToast('此策略为旧版代码格式，无法在策略工厂中加载', true);
            return;
        }
        cards = config.cards;
        strategyName = obj.name;
        strategyId = obj.id;
        initialCapital = config.capital || 1000000;
        startDate = config.startDate || '2010-01-01';
        endDate = config.endDate || new Date().toISOString().slice(0, 10);
        stockPool = config.stockPool || '';
        slippage = config.slippage || 'close';
        window.currentStrategyName = obj.name;

        var nameInput = document.getElementById('strategyNameInput');
        if (nameInput) nameInput.value = obj.name;
        var capitalInput = document.getElementById('initialCapitalInput');
        if (capitalInput) capitalInput.value = initialCapital;
        var startInput = document.getElementById('strategyStartDate');
        if (startInput) startInput.value = startDate;
        var endInput = document.getElementById('strategyEndDate');
        if (endInput) endInput.value = endDate;
        var spInput = document.getElementById('strategyStockPool');
        if (spInput) spInput.value = stockPool;
        var slInput = document.getElementById('slippageInput');
        if (slInput) {
            var slOpts = { close: '收盘价成交（回测默认）', next_open: '次日开盘价成交', half_spread: '半价差偏移（仅K线图标记）' };
            slInput.value = slOpts[slippage] || '收盘价成交（回测默认）';
            slInput.setAttribute('data-value', slippage || 'close');
        }
        if (config.commission_rate !== undefined) {
            var commEl = document.getElementById('commissionRate');
            if (commEl) commEl.value = config.commission_rate;
            var stEl = document.getElementById('stampTaxRate');
            if (stEl) stEl.value = config.stamp_tax_rate;
            var sctEl = document.getElementById('slippageCostType');
            if (sctEl) {
                var sctVal = config.slippage_cost_type || 'percent';
                sctEl.value = sctVal === 'fixed' ? '固定点数(元)' : '百分比';
                sctEl.setAttribute('data-value', sctVal);
            }
            var scvEl = document.getElementById('slippageCostValue');
            if (scvEl) scvEl.value = config.slippage_cost_value;
        }
        var saveBtn = document.getElementById('saveStrategyBtn');
        if (saveBtn) saveBtn.dataset.currentId = obj.id;

        renderCards();
        showToast('已加载策略: ' + obj.name, false);
    }).catch(function(err) {
        showToast('加载失败: ' + err.message, true);
    });
}

function newStrategy() {
    cards = [];
    strategyName = '';
    strategyId = null;
    stockPool = '';
    slippage = 'close';
    window.currentStrategyName = undefined;
    window.currentStrategyCode = undefined;
    window._defaultStockFromTemplate = undefined;
    var nameInput = document.getElementById('strategyNameInput');
    if (nameInput) nameInput.value = '';
    var spInput = document.getElementById('strategyStockPool');
    if (spInput) spInput.value = '';
    var slInput = document.getElementById('slippageInput');
    if (slInput) {
        slInput.value = '收盘价成交（回测默认）';
        slInput.setAttribute('data-value', 'close');
    }
    var commEl = document.getElementById('commissionRate');
    if (commEl) commEl.value = '0.0003';
    var stEl = document.getElementById('stampTaxRate');
    if (stEl) stEl.value = '0.001';
    var sctEl = document.getElementById('slippageCostType');
    if (sctEl) { sctEl.value = '百分比'; sctEl.setAttribute('data-value', 'percent'); }
    var scvEl = document.getElementById('slippageCostValue');
    if (scvEl) scvEl.value = '0.1';
    var saveBtn = document.getElementById('saveStrategyBtn');
    if (saveBtn) saveBtn.dataset.currentId = '';
    renderCards();
    showToast('已新建空白策略', false);
}

// ---- Code Preview ----

function toggleCodePreview() {
    codeExpanded = !codeExpanded;
    var preview = document.getElementById('codePreviewArea');
    var toggleBtn = document.getElementById('toggleCodePreviewBtn');
    if (preview) preview.style.display = codeExpanded ? 'block' : 'none';
    if (toggleBtn) toggleBtn.textContent = codeExpanded ? '🔼 隐藏代码' : '📝 预览代码';
}

function updateCodePreview() {
    var preview = document.getElementById('codePreviewArea');
    if (!preview) return;
    var code = generateCode(cards);
    preview.textContent = code;
}

// ---- Main Render ----

export function renderStrategyPage(container) {
    container.innerHTML = '';

    if (window.currentStrategyCode && cards.length === 0) {
        // Try to load from window.currentStrategyCode if it's a JSON config
        var config = deserializeConfig(window.currentStrategyCode);
        if (config) {
            cards = config.cards;
            initialCapital = config.capital || 1000000;
            startDate = config.startDate || '2010-01-01';
            endDate = config.endDate || new Date().toISOString().slice(0, 10);
            stockPool = config.stockPool || '';
            slippage = config.slippage || 'close';
        }
    }

    var capital = initialCapital;
    var today = new Date().toISOString().slice(0, 10);

    var html = '<div class="card">' +
        '<div class="card-title">🏭 策略工厂</div>' +
        '<div class="metric-row" style="margin-top:4px;">' +
        '<span>策略名称:</span>' +
        '<input type="text" id="strategyNameInput" placeholder="输入策略名称" value="' + escapeHtml(strategyName) + '" ' +
        'style="width:180px;background:#1e253b;border:1px solid #323d5a;border-radius:30px;color:#fff;padding:6px 10px;">' +
        '<button id="loadStrategyListBtn" style="background:#2a3a5a;">📂 我的策略</button>' +
        '<button id="loadTemplateBtn" style="background:#2a3a5a;">📋 模板</button>' +
        '<button id="saveStrategyBtn" style="background:#2a3a5a;">💾 保存</button>' +
        '<button id="newStrategyBtn">📄 新建</button>' +
        '<button id="deleteStrategyBtn">🗑 删除</button>' +
        '</div>' +
        '<div class="metric-row" style="margin-top:8px;">' +
        '<span>默认股票池:</span>' +
        '<textarea id="strategyStockPool" rows="2" placeholder="输入股票代码，每行一个或用逗号分隔" ' +
        'style="width:400px;background:#1e253b;border:1px solid #323d5a;border-radius:12px;color:#fff;padding:6px 10px;font-size:12px;font-family:monospace;resize:vertical;">' + escapeHtml(stockPool) + '</textarea>' +
        '</div>' +
        '<div class="metric-row" style="margin-top:8px;">' +
        '<span>初始资金:</span>' +
        '<input type="number" id="initialCapitalInput" min="0" max="2000000" step="10000" value="' + capital + '" ' +
        'style="width:150px;background:#1e253b;border:1px solid #323d5a;border-radius:30px;color:#fff;padding:6px 10px;">' +
        '<span>起始日期:</span>' +
        '<input type="text" class="datepicker-input" id="strategyStartDate" value="' + startDate + '" readonly ' +
        'style="width:120px;background:#1e253b;border:1px solid #323d5a;border-radius:30px;color:#fff;padding:6px 10px;">' +
        '<span>结束日期:</span>' +
        '<input type="text" class="datepicker-input" id="strategyEndDate" value="' + (endDate || today) + '" readonly ' +
        'style="width:120px;background:#1e253b;border:1px solid #323d5a;border-radius:30px;color:#fff;padding:6px 10px;">' +
        '<span>成交价:</span>' +
        '<input type="text" id="slippageInput" value="收盘价成交（回测默认）" readonly data-value="close" ' +
        'style="width:180px; background:#1e253b; border:1px solid #323d5a; border-radius:30px; color:#fff; padding:6px 30px 6px 10px; font-size:13px; cursor:pointer; ' +
        'background-image:url(data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%2210%22%20viewBox%3D%220%200%2010%2010%22%3E%3Cpath%20d%3D%22M0%203l5%205%205-5z%22%20fill%3D%22%239aa9cc%22%2F%3E%3C%2Fsvg%3E); background-repeat:no-repeat; background-position:right 10px center;">' +
        '</div>' +
        '<div class="metric-row" style="margin-top:8px;">' +
        '<span>佣金率:</span>' +
        '<input type="number" id="commissionRate" value="0.0003" step="0.0001" min="0" max="0.003" style="width:100px;background:#1e253b;border:1px solid #323d5a;border-radius:30px;color:#fff;padding:6px 10px;">' +
        '<span>印花税率:</span>' +
        '<input type="number" id="stampTaxRate" value="0.001" step="0.0001" min="0" max="0.003" style="width:100px;background:#1e253b;border:1px solid #323d5a;border-radius:30px;color:#fff;padding:6px 10px;">' +
        '<span>滑点类型:</span>' +
        '<input type="text" id="slippageCostType" value="百分比" readonly data-value="percent" ' +
        'style="width:120px; background:#1e253b; border:1px solid #323d5a; border-radius:30px; color:#fff; padding:6px 30px 6px 10px; font-size:13px; cursor:pointer; ' +
        'background-image:url(data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%2210%22%20viewBox%3D%220%200%2010%2010%22%3E%3Cpath%20d%3D%22M0%203l5%205%205-5z%22%20fill%3D%22%239aa9cc%22%2F%3E%3C%2Fsvg%3E); background-repeat:no-repeat; background-position:right 10px center;">' +
        '<span>滑点值:</span>' +
        '<input type="number" id="slippageCostValue" value="0.1" step="0.01" min="0" style="width:80px;background:#1e253b;border:1px solid #323d5a;border-radius:30px;color:#fff;padding:6px 10px;">' +
        '<span style="font-size:12px; color:#9aa9cc;">(买入增加成本，卖出减少收入，卖出额外加印花税)</span>' +
        '</div></div>' +

        '<div class="card" style="margin-top:12px;">' +
        '<div class="card-title">📋 策略卡片</div>' +
        '<div id="cardList"></div>' +
        '<div style="margin-top:8px;text-align:center;">' +
        '<button id="addCardBtn" style="background:#4f7eff;border:none;padding:8px 24px;border-radius:30px;color:#fff;font-weight:600;cursor:pointer;">+ 添加条件</button>' +
        '</div></div>' +

        '<div class="card" style="margin-top:12px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
        '<button id="toggleCodePreviewBtn" style="background:transparent;border:1px solid #323d5a;color:#9aa9cc;padding:6px 14px;border-radius:20px;cursor:pointer;">📝 预览代码</button>' +
        '<button id="runBacktestBtn" style="background:#4f7eff;border:none;padding:6px 18px;border-radius:30px;color:#fff;font-weight:600;cursor:pointer;">▶ 运行回测</button>' +
        '<button id="compareBacktestBtn" style="background:transparent;border:1px solid #f2c94c;padding:6px 16px;border-radius:30px;color:#f2c94c;font-weight:600;cursor:pointer;">🔬 对比回测</button>' +
        '</div>' +
        '<pre id="codePreviewArea" style="display:none;max-height:300px;overflow-y:auto;background:#0e1220;border:1px solid #323d5a;border-radius:12px;padding:12px;color:#9aa9cc;font-size:11px;font-family:monospace;white-space:pre-wrap;word-break:break-all;"></pre>' +
        '</div>' +

        '<div class="card" style="margin-top:12px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
        '<h4 style="color:#ffffff;margin:0;">📋 回测日志</h4>' +
        '<div style="display:flex;gap:8px;">' +
        '<button id="toggleLogBtn" style="background:transparent;border:1px solid #323d5a;color:#9aa9cc;">🔼 折叠</button>' +
        '<button id="exportLogBtn" style="background:transparent;border:1px solid #4f7eff;color:#4f7eff;">📄 导出</button>' +
        '<button id="clearLogBtn" style="background:transparent;border:1px solid #323d5a;color:#9aa9cc;">清除</button>' +
        '</div></div>' +
        '<div id="strategyLogWrapper">' +
        '<div id="strategyLogToolbar"></div>' +
        '<div id="strategyLogBox" style="height:200px;overflow-y:auto;background:#0e1220;border:1px solid #323d5a;border-radius:12px;padding:8px;color:#9aa9cc;font-size:12px;font-family:monospace;"></div>' +
        '</div>' +
        '</div>';

    container.innerHTML = html;

    // Reference DOM elements
    logContainer = document.getElementById('strategyLogBox');
    strategyLogger = new Logger('strategyLogBox', 'strategyLogToolbar', { maxEntries: 500 });
    strategyLogger.init();

    // Bind date pickers
    var startDateInput = document.getElementById('strategyStartDate');
    var endDateInput = document.getElementById('strategyEndDate');
    if (startDateInput) bindDatePicker(startDateInput);
    if (endDateInput) {
        if (!endDateInput.value) endDateInput.value = today;
        bindDatePicker(endDateInput);
    }

    // Capital change handler
    var capitalInput = document.getElementById('initialCapitalInput');
    if (capitalInput) {
        capitalInput.addEventListener('change', function() {
            initialCapital = Number(this.value) || 1000000;
            window._initialCapital = initialCapital;
        });
    }

    // Slippage dropdown — custom select panel (QtWebEngine does not support datalist)
    var slippageInput = document.getElementById('slippageInput');
    if (slippageInput) {
        slippageInput.addEventListener('click', function() {
            showCustomSelect(slippageInput, [
                { value: 'close', label: '收盘价成交（回测默认）' },
                { value: 'next_open', label: '次日开盘价成交' },
                { value: 'half_spread', label: '半价差偏移（仅K线图标记）' }
            ], function(selectedValue) {
                // value and data-value are already set by showCustomSelect
            });
        });
    }

    // Slippage cost type dropdown — custom select panel
    var slippageCostTypeInput = document.getElementById('slippageCostType');
    if (slippageCostTypeInput) {
        slippageCostTypeInput.addEventListener('click', function() {
            showCustomSelect(slippageCostTypeInput, [
                { value: 'percent', label: '百分比' },
                { value: 'fixed', label: '固定点数(元)' }
            ], function(selectedValue) {
                // value and data-value are already set by showCustomSelect
            });
        });
    }

    // Save button
    var saveBtn = document.getElementById('saveStrategyBtn');
    if (saveBtn && strategyId) saveBtn.dataset.currentId = strategyId;

    // Button events
    var addBtn = document.getElementById('addCardBtn');
    if (addBtn) addBtn.addEventListener('click', showAddCardModal);

    var templateBtn = document.getElementById('loadTemplateBtn');
    if (templateBtn) templateBtn.addEventListener('click', showTemplateModal);

    var listBtn = document.getElementById('loadStrategyListBtn');
    if (listBtn) listBtn.addEventListener('click', showStrategyListModal);

    var saveBtnEl = document.getElementById('saveStrategyBtn');
    if (saveBtnEl) saveBtnEl.addEventListener('click', saveCurrentStrategy);

    var newBtn = document.getElementById('newStrategyBtn');
    if (newBtn) newBtn.addEventListener('click', newStrategy);

    var deleteBtn = document.getElementById('deleteStrategyBtn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', function() {
            var id = saveBtn && saveBtn.dataset.currentId;
            if (!id) { showToast('请先保存策略再删除', true); return; }
            if (!confirm('确认删除策略 ID=' + id + ' 吗？')) return;
            bridge.delete_strategy(parseInt(id)).then(function() {
                newStrategy();
                showToast('删除成功', false);
            }).catch(function(err) {
                showToast('删除失败: ' + err.message, true);
            });
        });
    }

    var toggleCodeBtn = document.getElementById('toggleCodePreviewBtn');
    if (toggleCodeBtn) toggleCodeBtn.addEventListener('click', toggleCodePreview);

    var runBtn = document.getElementById('runBacktestBtn');
    if (runBtn) runBtn.addEventListener('click', showBacktestModal);

    var compareBtn = document.getElementById('compareBacktestBtn');
    if (compareBtn) {
        compareBtn.addEventListener('click', function() {
            var validation = validateCards(cards);
            if (!validation.valid) {
                showToast(validation.errors[0], true);
                return;
            }
            if (cards.length === 0) {
                showToast('请先添加策略卡片', true);
                return;
            }

            // Read page params
            var pageStockPoolInput = document.getElementById('strategyStockPool');
            var savedStockPool = pageStockPoolInput ? pageStockPoolInput.value.trim() : '';
            var defaultStock = savedStockPool || (window._defaultStockFromTemplate) || '000001';

            var pageStartInput = document.getElementById('strategyStartDate');
            var pageEndInput = document.getElementById('strategyEndDate');
            var startDt = pageStartInput ? pageStartInput.value : startDate;
            var endDt = pageEndInput ? pageEndInput.value : endDate;

            var capitalInput = document.getElementById('initialCapitalInput');
            var cashVal = capitalInput ? (Number(capitalInput.value) || 100000) : initialCapital;

            var slippageInput = document.getElementById('slippageInput');
            var slippageType = slippageInput ? (slippageInput.getAttribute('data-value') || 'close') : 'close';

            var commissionInput = document.getElementById('commissionRate');
            var commissionVal = commissionInput ? (Number(commissionInput.value) || 0.0003) : 0.0003;

            var stampTaxInput = document.getElementById('stampTaxRate');
            var stampTaxVal = stampTaxInput ? (Number(stampTaxInput.value) || 0.001) : 0.001;

            var slCostTypeInput = document.getElementById('slippageCostType');
            var slCostTypeVal = slCostTypeInput ? (slCostTypeInput.getAttribute('data-value') || 'percent') : 'percent';

            var slCostValueInput = document.getElementById('slippageCostValue');
            var slCostValueVal = slCostValueInput ? (Number(slCostValueInput.value) || 0.1) : 0.1;

            // Set strategy name
            window.currentStrategyName = strategyName || '未命名策略';

            showCompareBacktestModal(cards, defaultStock, startDt, endDt, cashVal, slippageType,
                commissionVal, stampTaxVal, slCostTypeVal, slCostValueVal);
        });
    }

    var clearLogBtn = document.getElementById('clearLogBtn');
    if (clearLogBtn) clearLogBtn.addEventListener('click', clearLog);

    var exportLogBtn = document.getElementById('exportLogBtn');
    if (exportLogBtn) exportLogBtn.addEventListener('click', function() {
        strategyLogger.exportLog();
    });

    var toggleLogBtn = document.getElementById('toggleLogBtn');
    if (toggleLogBtn) {
        toggleLogBtn.addEventListener('click', function() {
            logExpanded = !logExpanded;
            var wrapper = document.getElementById('strategyLogWrapper');
            if (wrapper) wrapper.style.display = logExpanded ? 'block' : 'none';
            toggleLogBtn.textContent = logExpanded ? '🔼 折叠' : '🔽 展开';
        });
    }

    // Render cards
    renderCards();
    updateCodePreview();
}
