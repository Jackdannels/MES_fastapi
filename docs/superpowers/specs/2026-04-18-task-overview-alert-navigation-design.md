# 任务总览红点导航与未排程计时展示设计

## 背景

当前中控侧边栏的 `任务/托盘总览` 已能根据“已入库、未正式排程、超 24 小时”的实验显示红点，但点击导航后不会直接定位到对应任务。  
同时，中控总览里的“未排程实验计时”仍展示实验序号行，且超时时只把计时染红，不够聚焦。

## 目标

1. 当 `任务/托盘总览` 导航红点亮起时，点击该导航项应直接跳转到任务总览中“最小任务号”的红色待排程任务。
2. 任务总览页只滚动到该任务卡片并做边框闪烁提醒，不改变选中态。
3. 中控总览里的未排程实验计时去掉 `SYLU-xxxxx-A/B/C` 行，超时时让 `任务号 / 实验名` 与计时一起变红。

## 方案

### 1. 导航跳转

- 在前端提取任务总览告警 helper，统一复用“红点是否显示”和“应跳转到哪个任务”的判断口径。
- 当侧边栏点击 `任务/托盘总览` 且当前存在红点时，导航改为跳到：
  - `/task-overview?highlightTask=<最小任务号>`
- 这里的“最小任务号”按任务号字符串排序得到。

### 2. 任务总览页高亮

- 任务总览页监听路由 query 中的 `highlightTask`。
- 若对应任务卡片已出现在当前筛选结果中：
  - 滚动到可见区域
  - 给卡片增加一次短暂闪烁边框 class
  - 闪烁结束后移除 class
- 该过程不改 `selectedTaskCode`，不打开编辑态。
- 完成处理后立即移除 URL 中的 `highlightTask`，避免刷新或二次进入时重复闪烁。

### 3. 未排程实验计时展示

- 删除计时列表中的实验序号行，只保留：
  - `任务号 / 实验名`
  - `计时`
- 当实验超时后：
  - `任务号 / 实验名` 变红
  - 计时继续保持红色

## 涉及文件

- `frontend/src/App.vue`
- `frontend/src/lib/taskOverviewAlerts.js`
- `frontend/src/lib/taskOverviewAlerts.test.js`
- `frontend/src/modules/task-overview/useTaskOverview.js`
- `frontend/src/modules/task-overview/useTaskOverview.test.js`
- `frontend/src/modules/task-overview/styles.css`
- `frontend/src/modules/dashboard/page.vue`
- `frontend/src/modules/dashboard/styles.css`
- `frontend/src/modules/dashboard/page.runtime.test.js`

## 验证

- 侧边栏红点点击后跳转到带 `highlightTask` 的任务总览路由。
- 任务总览收到 `highlightTask` 后滚动并闪烁，不进入选中态。
- 中控总览计时列表不再显示 `SYLU-xxxxx-A/B/C`。
- 超时项目的标题与计时一起变红。
