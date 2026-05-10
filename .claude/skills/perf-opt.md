```markdown
---
name: perf-opt
description: 优化 K 线数据加载速度、缓存管理、减少重渲染
---

# 性能优化

## 涉及文件
- `backend/data_feed.py` – K 线缓存、二分查找
- `backend/db.py` – 数据库查询优化
- `js/chartRenderer.js` – ECharts 渲染优化
- `js/kline.js` – 均线计算、数据更新

## 优化方向

### 1. 数据加载
- K 线数据已通过 `DataFeed._kline_cache` 缓存，二次查询无需访问数据库
- `_slice_by_date_range` 使用二分查找，避免全量遍历
- 个股详情页默认 limit=500，买卖点成交图 limit=2000

### 2. 图表渲染
- 图表实例销毁前调用 `dispose()`，避免内存泄漏
- 均线计算在 JS 侧完成，不依赖后端

### 3. 回测引擎
- 回测主循环为纯 Python，数据在内存中为 DataFrame，无 I/O 瓶颈
- 多股票回测使用 `Promise.all` 并行执行，总耗时约等于单只股票耗时

## 常见性能问题
| 问题 | 原因 | 修复 |
|------|------|------|
| 个股详情页加载慢 | 未使用 limit，加载了全量数据 | 检查 `bridge.get_kline_data` 的 limit 参数 |
| 图表缩放卡顿 | dataZoom 事件频繁重绘 | 检查是否在 `datazoom` 事件中执行了复杂计算 |
| 回测长时间无响应 | 策略代码复杂，或数据范围过大 | 减小回测区间或优化策略逻辑 |