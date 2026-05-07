// js/strategy.js
import { bridge } from './bridge.js';

export function renderStrategyPage(container) {
    container.innerHTML = `
        <div class="card">
            <div class="card-title">✍️ 策略编辑器</div>
            <div class="metric-row">
                <span>策略名称:</span>
                <input type="text" id="strategyNameInput" value="新策略"
                       style="width:200px; background:#1e253b; border:1px solid #323d5a; border-radius:30px; color:#fff; padding:6px 12px;">
                <span>选择策略:</span>
                <input type="text" id="strategySelectorInput" list="strategyList"
                       placeholder="选择策略"
                       style="width:160px; background:#1e253b; border:1px solid #323d5a; border-radius:30px; color:#fff; padding:6px 10px; box-sizing:border-box;">
                <datalist id="strategyList"></datalist>
            </div>
            <div style="margin:12px 0;">
                <button id="newStrategyBtn">📄 新建</button>
                <button id="saveStrategyBtn">💾 保存</button>
                <button id="deleteStrategyBtn">🗑 删除</button>
                <button id="runStrategyBtn">▶ 运行回测 (模拟)</button>
            </div>
            <textarea id="strategyTextArea" rows="12">def initialize(context):
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

    var strategyListDL = document.getElementById('strategyList');
    var selectorInput = document.getElementById('strategySelectorInput');
    var nameInput = document.getElementById('strategyNameInput');
    var textarea = document.getElementById('strategyTextArea');
    var newBtn = document.getElementById('newStrategyBtn');
    var saveBtn = document.getElementById('saveStrategyBtn');
    var deleteBtn = document.getElementById('deleteStrategyBtn');
    var runBtn = document.getElementById('runStrategyBtn');
    var logDiv = document.getElementById('runLogConsole');
    var currentId = 0;

    // -----------------------------------------------------------------
    // 1) 刷新策略列表（填充 datalist）
    function refreshStrategyList() {
        bridge.list_strategies().then(function(jsonStr) {
            var strategies = JSON.parse(jsonStr);
            strategyListDL.innerHTML = '';
            strategies.forEach(function(s) {
                var opt = document.createElement('option');
                opt.value = s.id;
                opt.label = s.name + ' (' + s.id + ')';
                strategyListDL.appendChild(opt);
            });
        }).catch(function(err) {
            console.error('获取策略列表失败', err);
        });
    }

    // 2) 选择策略（change 事件）
    selectorInput.addEventListener('change', function() {
        var val = this.value;
        var options = strategyListDL.options;
        var foundId = null;
        for (var i = 0; i < options.length; i++) {
            var opt = options[i];
            if (opt.label === val || opt.value == val) {
                foundId = parseInt(opt.value);
                break;
            }
        }
        if (foundId) {
            bridge.load_strategy(foundId).then(function(jsonStr) {
                var obj = JSON.parse(jsonStr);
                if (obj && obj.id) {
                    currentId = obj.id;
                    nameInput.value = obj.name;
                    textarea.value = obj.code;
                    // 将输入框内容设为对应的 label，方便用户看到
                    selectorInput.value = obj.name + ' (' + obj.id + ')';
                }
            }).catch(function(err) {
                console.error('加载策略失败', err);
            });
        } else {
            // 未匹配到已知策略，清空编辑器
            currentId = 0;
            nameInput.value = '新策略';
            textarea.value = '';
        }
    });

    // 3) 新建
    newBtn.addEventListener('click', function() {
        currentId = 0;
        nameInput.value = '新策略';
        textarea.value = '';
        selectorInput.value = '';
        refreshStrategyList();   // 刷新列表（以便下次立即看到新策略）
    });

    // 4) 保存
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
                refreshStrategyList();   // 刷新下拉列表
                // 更新输入框显示
                selectorInput.value = name + ' (' + result.id + ')';
            } else {
                logDiv.innerHTML += '<div>❌ 保存失败: ' + (result.message || '') + '</div>';
            }
        }).catch(function(err) {
            console.error('保存策略失败', err);
            logDiv.innerHTML += '<div>❌ 保存失败: ' + err.message + '</div>';
        });
    });

    // 5) 删除
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
                selectorInput.value = '';
                refreshStrategyList();   // 刷新下拉列表
            } else {
                logDiv.innerHTML += '<div>❌ 删除失败: ' + (result.message || '') + '</div>';
            }
        }).catch(function(err) {
            console.error('删除失败', err);
        });
    });

    // 6) 运行回测（模拟）
    runBtn.addEventListener('click', function() {
        logDiv.innerHTML += '<div>🚀 回测模拟运行中……（阶段二将接入真实执行引擎）</div>';
        logDiv.scrollTop = logDiv.scrollHeight;
        alert("回测功能将在阶段二实现。");
    });

    // 7) 页面初始化时立即加载策略列表
    refreshStrategyList();
}
