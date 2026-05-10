```markdown
---
name: add-feature
description: 在策略工厂中新增条件卡片类型，或在其他页面中添加新功能模块
---

# 添加新功能

## 涉及文件
- `js/strategyTemplates.js` – 卡片元数据定义（`CARD_TYPE_META`）
- `js/strategyUtils.js` – 代码生成器（`genXxx` 函数）
- `js/strategyBuilder.js` – UI 交互（编辑弹窗、保存逻辑）

## 添加新卡片的步骤

### 1. 在 `CARD_TYPE_META` 中注册
```javascript
my_type: {
    type: 'my_type',
    label: '新卡片',
    icon: '📊',
    description: '描述',
    defaultAction: 'buy',  // buy / sell / null
    defaultParams: { fast: 5, slow: 20 },
    paramFields: [
        { key: 'fast', label: '快线周期', type: 'number', min: 2, max: 250, default: 5 },
        { key: 'slow', label: '慢线周期', type: 'number', min: 3, max: 500, default: 20 },
        { key: 'dir', label: '方向', type: 'select', options: [
            { value: 'up', label: '向上' },
            { value: 'down', label: '向下' }
        ], default: 'up' }
    ]
}
2. 在 strategyUtils.js 中添加代码生成器
在 rebuildOutput 的 switch 中添加 case 'my_type': genResult = genMyType(card, i); break;

实现 genMyType 函数，返回 { code: lines, cond: condition_string }

所有参数通过 ctxParam(idx, key) 引用（自动加 context. 前缀）

3. 在 showAddCardModal 的 typeKeys 中添加 'my_type'
添加其他页面功能
新页面路由在 js/navigation.js 的 loadPage 中增加分支

新图表在 js/chartRenderer.js 中添加渲染函数

新数据查询在 backend/web_bridge.py 中添加 @Slot

注意事项
修改后必须测试：加载模板、编辑卡片、保存/加载策略、运行回测

CSS 有大量 !important，新 UI 元素要避免被全局规则覆盖