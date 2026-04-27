# 中控导航、流程图实时刷新与分页优化设计

## 背景

本次调整集中在中控模块的信息架构和若干状态展示细节：

- 中控总览的任务统计文案需要更贴近当前口径。
- 任务流程图和统一托盘流程图在跨页面修改进度后，当前依赖手动刷新或本页重新加载才能同步。
- 中控侧边导航需要新增两个入口，并调整已有模块名称。
- 样品流转列表页码过多时会挤满工具栏，需要用省略号收敛。
- 预接驳能力目前嵌在样品管理页面里，需要成为侧边栏中的独立入口。

## 目标

1. 将中控总览 KPI 文案 `今日受理` 改为 `已受理任务`。
2. 让任务流程图和统一托盘流程图在样品/托盘进度变化后自动更新，不需要手动刷新页面。
3. 在中控导航栏 `系统信息` 下方新增 `历史任务数据`。
4. 样品流转与状态分页在总页数超过 10 页时使用 C 方案省略号；10 页及以内继续完整显示全部页码。
5. 将 `样品/托盘管理` 更名为 `样品/托盘信息`。
6. 在 `任务/托盘总览` 和 `排程看板` 之间新增 `样品预接驳` 导航入口。

## 方案

### 1. 文案与导航

- 直接更新 `frontend/src/modules/dashboard/page.vue` 中控总览 KPI 文案。
- 更新 `frontend/src/modules/samples/index.js` 的 route title 和 subtitle，使页面标题、侧边栏、文档标题统一显示 `样品/托盘信息`。
- 在模块注册顺序中将 `样品预接驳` 放在 `任务/托盘总览` 后、`排程看板` 前。
- 将 `历史任务数据` 放在 `系统信息` 后。

### 2. 样品预接驳独立入口

- 新增模块 `frontend/src/modules/sample-pre-allocation/`。
- 页面复用现有 `TransferWorkbench`，传入 `mode="pre-allocation"`。
- 该页面不额外引入新的业务模型，避免和现有样品/托盘页面产生双写逻辑。
- 现有 `样品/托盘信息` 页面中嵌入的预接驳面板暂时保留，避免破坏已有操作入口。

### 3. 历史任务数据入口

- 新增模块 `frontend/src/modules/task-history/`。
- 首版使用现有任务 API 和存储快照，展示历史任务数据表。
- 若当前数据没有独立归档字段，先按任务状态、更新时间、任务号等现有字段组织展示，不新增后端表结构。
- 页面保持只读，避免在“历史”入口里引入任务编辑行为。

### 4. 流程图实时更新

- 当前进度变更会通过 `SAMPLES_UPDATED_EVENT` 广播，多个页面已经写入该事件但并未全部监听。
- 为流程图相关页面补齐监听：
  - `frontend/src/modules/process/useProcessLabs.js`
  - `frontend/src/modules/laboratory/useLaboratoryPage.js`
  - `frontend/src/modules/samples/useSamplesFlow.js` 已监听，继续作为样品/托盘信息页的数据来源。
- 当收到 `mes:samples-updated` 时重新加载快照，并保持当前已选任务/托盘尽量不变。
- 同时为实验室页和过程管控页保留现有计时器逻辑，不把倒计时刷新和数据快照刷新耦合在一起。

### 5. 分页 C 方案

- 修改共享组件 `frontend/src/components/shared/AppPagination.vue`。
- 当 `pageCount <= 10`：
  - 保持当前行为，显示全部页码。
- 当 `pageCount > 10`：
  - 中间页显示：`1 ... current-2 current-1 current current+1 current+2 ... last`。
  - 靠近首页时显示：`1 2 3 4 5 ... last`。
  - 靠近末页时显示：`1 ... last-4 last-3 last-2 last-1 last`。
  - 省略号不可点击，使用稳定 key，避免 Vue 列表渲染冲突。

## 涉及文件

- `frontend/src/App.runtime.test.js`
- `frontend/src/modules/index.js`
- `frontend/src/modules/dashboard/page.vue`
- `frontend/src/modules/samples/index.js`
- `frontend/src/modules/sample-pre-allocation/index.js`
- `frontend/src/modules/sample-pre-allocation/page.vue`
- `frontend/src/modules/task-history/index.js`
- `frontend/src/modules/task-history/page.vue`
- `frontend/src/modules/process/useProcessLabs.js`
- `frontend/src/modules/process/useProcessLabs.test.js`
- `frontend/src/modules/laboratory/useLaboratoryPage.js`
- `frontend/src/modules/laboratory/page.runtime.test.js`
- `frontend/src/components/shared/AppPagination.vue`
- `frontend/src/components/shared/AppPagination.test.js`

## 验证

- 中控总览显示 `已受理任务`。
- 中控侧边栏顺序包含：`任务/托盘总览`、`样品预接驳`、`排程看板`。
- 中控侧边栏中 `系统信息` 后显示 `历史任务数据`。
- 页面标题和导航均显示 `样品/托盘信息`。
- 总页数为 10 时分页显示 1 到 10；总页数为 23 且当前页为 15 时显示 `1 ... 13 14 15 16 17 ... 23`；当前页为 21 时显示 `1 ... 19 20 21 22 23`。
- 实验室或过程管控修改样品/托盘进度后，相关流程图在事件广播后自动刷新。
