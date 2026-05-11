markdown
---
name: fix-custom-select-qtwebengine
description: >
  修复 Tquant 量化工作站中策略编辑弹窗的下拉框在 QtWebEngine 中不显示完整选项（无反向选择）或拉伸问题。
  用自定义下拉面板替代原生 <select> 或 input+datalist，实现类似日期选择器的交互。
trigger:
  - "下拉框没有反向选择"
  - "select选项不全"
  - "策略工厂下拉框拉伸"
  - "修复编辑弹窗下拉框"
---

# 修复策略工厂编辑弹窗下拉框

## 问题诊断
在 PySide6 QtWebEngine 环境中，原生 `<select>` 或 `input+datalist` 可能出现：
- 下拉选项只显示当前值，缺少反向选项（如均线交叉只有“金叉”没有“死叉”）
- 弹出层往右无限拉伸，撑大弹窗
- 选项列表无法正常展开

## 解决方案
用自定义下拉面板（类似日期选择器）替代原生的 select 控件。

## 操作步骤

### 1. 在 `js/strategyBuilder.js` 中添加自定义下拉函数
在文件顶部（State 声明之后，Logging 之前）插入以下代码：

```javascript
function showCustomSelect(input, options, callback) {
    closeCustomSelect();
    if (!options || options.length === 0) return;

    var panel = document.createElement('div');
    panel.className = 'custom-select-panel';
    panel.style.cssText = 'position:fixed; z-index:99999; background:#1a2135; border:1px solid #4f7eff; border-radius:12px; padding:6px 0; max-height:250px; overflow-y:auto; min-width:260px; box-shadow:0 8px 20px rgba(0,0,0,0.5);';

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
2. 修改 showEditCardModal 中的表单字段构建
找到 if (f.type === 'select' && f.options) 分支，替换为：

javascript
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
        showCustomSelect(input, f.options, null);
    });

    row.appendChild(input);
}
3. 调整保存按钮中的取值逻辑
在保存按钮的 onclick 中，找到 if (f.type === 'select') 分支，改为：

javascript
if (f.type === 'select') {
    var el = modal.querySelector('[data-field="' + f.key + '"]');
    if (el) {
        val = el.getAttribute('data-value') || el.value;
    }
}
4. 确保弹窗关闭时清理面板
在 overlay.onclick、closeBtn.onclick、cancelBtn.onclick 中添加 closeCustomSelect()：

javascript
overlay.onclick = function() { closeCustomSelect(); overlay.remove(); modal.remove(); };
closeBtn.onclick = function() { closeCustomSelect(); overlay.remove(); modal.remove(); };
cancelBtn.onclick = function() { closeCustomSelect(); overlay.remove(); modal.remove(); };
5. 清理冗余代码
删除 Tquant.html 中 .card-edit-select 样式规则（如果有）

删除 strategyBuilder.js 中之前尝试的 wrapper 或 datalist 相关代码（如果存在）

验证
进入策略工厂，编辑任意卡片的下拉选项，点击输入框应弹出面板，显示所有正向/反向选项

选择后输入框显示中文标签，保存后再编辑仍正确

面板不会拉伸弹窗，点击外部或关闭弹窗后面板消失

仓位管理下拉应包含“固定仓位”和“凯利公式”