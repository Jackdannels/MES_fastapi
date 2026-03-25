# 任务总览头部布局调整设计

## 背景

`任务/托盘总览` 页顶部工具栏当前将 `任务总览`、`托盘总览` 切换按钮放在右侧筛选区开头。用户希望这两个按钮紧跟在顶部统计卡右侧，使左侧信息分组更符合阅读顺序。

## 目标

- 桌面端将切换按钮移动到左侧标题与统计区域内，并紧邻统计卡显示。
- 窄屏下允许左侧统计区与按钮组自然换行，避免压缩右侧搜索和筛选控件。
- 不改变按钮交互、搜索筛选逻辑与刷新行为。

## 方案

### 结构调整

- 在 `frontend/src/modules/task-overview/TaskOverviewToolbar.vue` 中，将视图切换按钮组从 `.task-overview-actions` 移入 `.task-overview-heading`。
- 新增一层统计区容器，用于把统计卡和按钮组作为同一视觉分组对齐。

### 样式调整

- 在 `frontend/src/modules/task-overview/styles.css` 中，为头部容器开启换行能力。
- 左侧标题区保留横向排列；统计卡与按钮组共享同一行，在空间不足时自然换行。
- 右侧筛选区保持右对齐；小屏时切回左对齐并独占整行，优先保证输入框和筛选器可用。

### 验证

- 补充 `TaskOverviewToolbar` 结构测试，断言按钮组位于 `.task-overview-heading` 而非 `.task-overview-actions`。
- 运行该组件的 Vitest 定向测试，确认结构和原有事件发射行为都正常。
