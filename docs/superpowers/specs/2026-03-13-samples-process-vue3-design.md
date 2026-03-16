# 样品流程管理 / 托盘分装 / 编码打印 Vue3 迁移设计

**目标**

将 `样品管理` 页面中的 `样品流程管理 / 托盘分装 / 编码打印` 从 legacy DOM 脚本迁移为原生 Vue3 状态驱动，同时保持任务联动、托盘分装、入库确认、编码打印的现有业务语义不变。

**范围**

- 迁移 `frontend/src/pages/SamplesPage.vue` 中以下区域：
  - `样品流程管理`
  - `样品分装`
  - `托盘编号预览`
  - `确认入库`
  - `编码打印`
- 暂不迁移：
  - `样品登记`
  - `样品流转与状态`
  - `暂存间`
  - `样品全生命周期追踪`

**现状**

- 任务选择、样品编号生成、托盘草稿、拖拽、预览、确认入库与打印按钮状态，当前都由 `frontend/src/legacy/runtime/render.js` 和 `frontend/src/legacy/runtime/actions.js` 直接操作 DOM。
- `确认入库` 会同时更新 `samples` 与 `tasks` 存储，并维护 `sample.history`、`sample.trays`、`task.tray_codes`。
- `编码打印` 依赖 `taskCode + trayCodes` 打开打印窗口，未引入后端接口。

**设计决策**

## 1. 拆分纯模型与页面状态

新增纯模型 `frontend/src/lib/samplesProcessModel.js`：
- 负责构建任务选项、任务样品编号列表、托盘草稿归一化、托盘均衡、预览文本、确认入库结果、打印 payload。
- 不依赖 DOM，不直接读写 localStorage。

新增状态层 `frontend/src/composables/useSamplesProcess.js`：
- 负责从快照载入 `tasks` / `samples`。
- 持有当前任务、托盘草稿、warning、打印状态。
- 暴露任务切换、统一上限调整、新增托盘、拖拽入托盘、确认入库、编码打印等动作。

页面 `frontend/src/pages/SamplesPage.vue`：
- 用 Vue 渲染任务选择、样品数量、样品编号、托盘卡片、托盘预览、按钮状态。
- 不再依赖该区域的 `data-action / id / dataset` 约定。

## 2. 保持现有业务语义

- 选任务后自动加载该任务样品、计划样品数与既有托盘信息。
- 默认统一上限为 `5`，默认至少保留 `2` 个托盘的分装体验。
- 托盘拖拽后仍按当前任务样品集合做合法化与重平衡。
- `确认入库` 仍校验：
  - 未选任务
  - 未配置默认入库位置
  - 请求样品不属于当前任务
  - 缺少托盘分装配置
- 入库后仍写回：
  - `sample.task_code`
  - `sample.location`
  - `sample.status`
  - `sample.flow_status`
  - `sample.trays`
  - `sample.history`
  - `task.tray_codes`
- `编码打印` 继续沿用当前弹窗打印语义，只把触发改成 Vue 事件。

## 3. 与 legacy 并存边界

- 本轮只移除 `样品流程管理 / 托盘分装 / 编码打印` 这一块的 legacy 接管。
- 其余 `SamplesPage` 区块暂时继续保留 legacy，实现局部渐进迁移。
- 若 legacy runtime 仍会整体接管 `/samples` 页面，需要在下一阶段再把 route 白名单按子区域彻底解除；本轮优先保证核心流程先由 Vue 接管。

## 4. 测试策略

- 模型测试：`frontend/src/lib/samplesProcessModel.test.js`
  - 任务选择后的样品编号生成
  - 托盘归一化与均衡
  - 确认入库写回 `samples/tasks`
  - 打印 payload
- 页面运行时测试：`frontend/src/pages/SamplesPage.runtime.test.js`
  - 选任务联动
  - 托盘新增与分装
  - 确认入库
  - 打印按钮启用与触发

**受影响文件**

- Create: `frontend/src/lib/samplesProcessModel.js`
- Create: `frontend/src/lib/samplesProcessModel.test.js`
- Create: `frontend/src/composables/useSamplesProcess.js`
- Create: `frontend/src/pages/SamplesPage.runtime.test.js`
- Modify: `frontend/src/pages/SamplesPage.vue`

**不做的事**

- 不重写整个 `样品管理` 页面
- 不更改打印窗口版式
- 不新增后端 API
- 不调整 `样品登记 / 暂存间 / 生命周期追踪` 的业务语义
