// js/strategy.js
import { bridge } from './bridge.js';

export function renderStrategyPage(container) {
    container.innerHTML = `
        <div class="card">
            <div class="card-title">✍️ 策略编辑器</div>
            <div class="metric-row">
                <span>策略名称:</span>
                <input type="text" id="strategyNameInput" value="新策略">
                <span>策略列表:</span>
                <select id="strategyList">
                    <option value="">-- 选择策略 --</option>
                </select>
            </div>
            <div>
                <button id="newStrategyBtn">📄 新建</button>
                <button id="saveStrategyBtn">💾 保存</button>
                <button id="deleteStrategyBtn">🗑 删除</button>
                <button id="runStrategyBtn">▶ 运行回测 (模拟)</button>
            </div>
            <textarea id="strategyTextArea" rows="9">def initialize(context):
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
            <div class="log-box" id="runLogConsole">
                [系统] 就绪，点击运行回测或从左侧历史回测加载策略代码。<br>
            </div>
        </div>
    `;

    var strategyList = document.getElementById('strategyList');
    var nameInput = document.getElementById('strategyNameInput');
    var textarea = document.getElementById('strategyTextArea');
    var newBtn = document.getElementById('newStrategyBtn');
    var saveBtn = document.getElementById('saveStrategyBtn');
    var deleteBtn = document.getElementById('deleteStrategyBtn');
    var runBtn = document.getElementById('runStrategyBtn');
    var logDiv = document.getElementById('runLogConsole');
    var currentId = 0;

    function loadStrategyList() {
        bridge.list_strategies().then(function(jsonStr) {
            var strategies = JSON.parse(jsonStr);
            strategyList.innerHTML = '<option value="">-- 选择策略 --</option>';
            strategies.forEach(function(s) {
                var opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = s.name;
                strategyList.appendChild(opt);
            });
        }).catch(function(err) {
            console.error('获取策略列表失败', err);
        });
    }

    strategyList.addEventListener('change', function() {
        var id = parseInt(this.value);
        if (!id) {
            currentId = 0;
            nameInput.value = '新策略';
            textarea.value = '';
            return;
        }
        bridge.load_strategy(id).then(function(jsonStr) {
            var obj = JSON.parse(jsonStr);
            if (obj && obj.id) {
                currentId = obj.id;
                nameInput.value = obj.name;
                textarea.value = obj.code;
            }
        }).catch(function(err) {
            console.error('加载策略失败', err);
        });
    });

    newBtn.addEventListener('click', function() {
        currentId = 0;
        nameInput.value = '新策略';
        textarea.value = '';
        strategyList.value = '';
    });

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
                logDiv.innerHTML += '<div>✅ 保存策略成功 ID=' + result.id + '</div>';
                loadStrategyList();
                strategyList.value = result.id;
            } else {
                logDiv.innerHTML += '<div>❌ 保存失败: ' + (result.message || '') + '</div>';
            }
        }).catch(function(err) {
            console.error('保存策略失败', err);
            logDiv.innerHTML += '<div>❌ 保存失败: ' + err.message + '</div>';
        });
    });

    deleteBtn.addEventListener('click', function() {
        if (!currentId) {
            alert('请先选择要删除的策略');
            return;
        }
        if (!confirm('确认删除策略 ID=' + currentId + ' 吗？')) return;
        bridge.delete_strategy(currentId).then(function(jsonStr) {
            var result = JSON.parse(jsonStr);
            if (result.success) {
                logDiv.innerHTML += '<div>🗑 删除策略 ID=' + currentId + ' 成功</div>';
                currentId = 0;
                nameInput.value = '新策略';
                textarea.value = '';
                loadStrategyList();
            } else {
                logDiv.innerHTML += '<div>❌ 删除失败: ' + (result.message || '') + '</div>';
            }
        }).catch(function(err) {
            console.error('删除失败', err);
        });
    });

    runBtn.addEventListener('click', function() {
        logDiv.innerHTML += '<div>🚀 回测运行中... 基于当前策略产生买卖信号: 2026-01-05 买入 000001 800股@12.35, 2026-01-12 卖出 @13.68</div>';
        logDiv.scrollTop = logDiv.scrollHeight;
        alert("回测模拟完成，买卖点已记录，可前往买卖点成交图查看最新K线标识。");
    });

    loadStrategyList();
}
