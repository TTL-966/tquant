```markdown
---
name: fix-backtest
description: 修复策略回测不产生信号、信号数据错误等问题
---

# 修复回测问题

## 涉及文件
- `js/strategyUtils.js` – 代码生成（错误参数名、缺少 handle_bar）
- `backend/backtest_executor.py` – 沙箱执行器（变量定义、数据不足）
- `js/strategyTemplates.js` – 参数 key 一致性

## 诊断流程

### 1. 查看后端日志
前端日志区会显示 `[后端]` 日志，关注：
- `name 'xxx' is not defined` → 变量未定义
- `'types.SimpleNamespace' object has no attribute 'xxx'` → context 属性不存在
- `第 N 根K线 handle_bar 出错` → handle_bar 执行异常

### 2. 检查代码生成
点击“预览代码”按钮，检查生成的 Python 代码：
- `initialize` 中所有参数是否以 `context.cX_key` 定义
- `handle_bar` 中的变量是否带 `context.` 前缀（通过 `ctxParam` 自动生成）
- 数组长度检查是否完整（数据不足时 `return`）

### 3. 使用测试脚本
```bash
python app/test_backtest.py
排除前端干扰，直接测试后端回测引擎。

4. 常见修复
错误	原因	修复
c0_fast_period not defined	参数 key 大小写不匹配	卡片 key 与生成器参数名保持一致
order_target_percent not defined	沙箱未注入函数	在 _build_sandbox 中检查注入
信号始终为 0	数据不足或策略条件太严格	检查回测区间是否包含足够历史数据
快速测试
先用“双均线模板”在单只股票 000001 上运行 → 应有约 40~100 个信号

若无信号，检查生成的代码中 stock 变量名是否正确替换了 STOCK_CODE_PLACEHOLDER