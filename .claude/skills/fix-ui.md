markdown
---
name: fix-ui
description: 修复下拉框宽度异常、显示英文值、图表标记样式、布局错乱等界面问题
---

# 修复 UI 问题

## 涉及文件
- `Tquant.html` – CSS 规则 `.metric-row input[type="text"]`, `select`
- `js/strategyBuilder.js` – `showEditCardModal`, `renderStrategyPage`
- `js/chartRenderer.js` – `renderKlineWithSignals`
- `js/navigation.js` – 各页面渲染函数

## 常见问题

### 1. 下拉框无限拉伸 / 宽度被压缩为 130px
**根源**：CSS 规则 `.metric-row input[type="text"]` 强制 `width: 130px !important`。
**修复**：
```css
.metric-row input[type="text"]:not([list]) { width: 130px !important; }
.metric-row input[type="text"][list] { width: auto; min-width: 150px; max-width: 200px; }
2. 编辑弹窗下拉框显示英文值（golden/fixed）
根源：input 的 value 设置为原始数据值，应显示中文标签。
修复：

初始化时：currentLabel = foundOpt ? foundOpt.label : formData[f.key]

datalist 的 <option> 用 value="标签"，data-value="原始值"

保存时从 data-value 取真实值

3. 买卖点标记标签遮挡 K 线
修复：已改为 label.show: false，鼠标悬停通过 #signalInfoCard 显示。

4. 成交价选择器宽度不对
修复：改为 input[list] 并用 .metric-row input[type="text"][list] 控制宽度。

标准操作
修改任何下拉框时，先检查 Tquant.html 的 CSS 是否有全局 !important 覆盖

编辑弹窗字段的 data-field 属性必须保留，保存时用它取值