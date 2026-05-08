// js/strategy.js
import { bridge } from './bridge.js';
import { formatStockNameOnly, populateStockDatalist, profitClass, escapeHtml } from './main.js';

export function renderStrategyPage(container) {
    // 清空容器
    container.innerHTML = '';

    // 构建 HTML 结构（精简版：只保留代码编辑器、策略名称、新建/保存/删除按钮）
    var html = `
        <div class="card">
            <div class="card-title">✍️ 策略编辑器</div>

            <!-- 策略名称 -->
            <div class="metric-row" style="margin-top:8px;">
                <span>策略名称：</span>
                <input type="text" id="strategyNameInput" value="新策略"
                       style="width:200px; background:#1e253b; border:1px solid #323d5a; border-radius:30px; color:#fff; padding:6px 10px;">
            </div>

            <!-- 代码编辑器 -->
            <textarea id="strategyTextArea" rows="12" style="width:100%; margin-top:12px; background:#0e1220; border:1px solid #323d5a; border-radius:16px; color:#fff; padding:12px; box-sizing:border-box; font-family:monospace;">def initialize(context):
    context.stock = "000001.SZ"
    context.short_win = 5
    context.long_win = 20

def handle_bar(context, bar_dict):
    short_ma = history_bars(context.stock, context.short_win, '1d', 'close').mean()
    long_ma = history_bars(context.stock, context.long_win, '1d', 'close').mean()
    if short_ma > long_ma:
        order_target_percent(context.stock, 1.0)
        log.info("买入信号")
    elif short_ma < long_ma:
        order_target_percent(context.stock, 0)
        log.info("卖出信号")</textarea>

            <!-- 按钮组 -->
            <div style="margin:12px 0;">
                <button id="newStrategyBtn">📄 新建</button>
                <button id="saveStrategyBtn">💾 保存</button>
                <button id="deleteStrategyBtn">🗑 删除</button>
            </div>
        </div>
    `;
    container.innerHTML = html;

    // ---------- 获取 DOM 元素 ----------
    var nameInput = document.getElementById('strategyNameInput');
    var textarea = document.getElementById('strategyTextArea');
    var newBtn = document.getElementById('newStrategyBtn');
    var saveBtn = document.getElementById('saveStrategyBtn');
    var deleteBtn = document.getElementById('deleteStrategyBtn');

    // ---------- 变量 ----------
    var currentId = null;          // 当前加载的策略 ID（用于保存/删除）

    // ---------- 新建 ----------
    newBtn.addEventListener('click', function() {
        currentId = null;
        nameInput.value = '新策略';
        textarea.value = '';
        window.currentStrategyName = undefined;
        window.currentStrategyCode = undefined;
    });

    // ---------- 保存 ----------
    saveBtn.addEventListener('click', function() {
        var name = nameInput.value.trim();
        var code = textarea.value;
        if (!name) {
            alert('请输入策略名称');
            return;
        }
        if (!code) {
            if (!confirm('策略代码为空，是否继续保存？')) return;
        }
        bridge.save_strategy(name, code, currentId).then(function(jsonStr) {
            var result = JSON.parse(jsonStr);
            if (result.success) {
                currentId = result.id;
                // 将当前策略存储到全局，供回测使用
                window.currentStrategyName = name;
                window.currentStrategyCode = code;
                alert('保存成功 ID=' + result.id);
            } else {
                alert('保存失败: ' + (result.message || ''));
            }
        }).catch(function(err) {
            console.error('保存策略失败', err);
            alert('保存失败: ' + err.message);
        });
    });

    // ---------- 删除 ----------
    deleteBtn.addEventListener('click', function() {
        if (!currentId) {
            alert('请先保存策略再删除');
            return;
        }
        if (!confirm('确认删除策略 ID=' + currentId + ' 吗？')) return;
        bridge.delete_strategy(currentId).then(function(jsonStr) {
            var result = JSON.parse(jsonStr);
            if (result.success) {
                alert('删除成功');
                currentId = null;
                nameInput.value = '新策略';
                textarea.value = '';
                window.currentStrategyName = undefined;
                window.currentStrategyCode = undefined;
            } else {
                alert('删除失败: ' + (result.message || ''));
            }
        }).catch(function(err) {
            console.error('删除失败', err);
        });
    });
}
