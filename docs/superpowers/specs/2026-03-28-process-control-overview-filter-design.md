# Process Control Overview Filter Design

**Goal**

把“试验过程管控”页面从“仅展示已排程实验室”调整为“展示所有正式实验室，并支持顶部状态筛选”。

**Current Context**

当前 `frontend/src/modules/process/page.vue` 页头只展示 3 个统计卡片：`实验中 / 已排程 / 空闲`，它们只是数字展示，不可点击。

当前 `frontend/src/modules/process/model.js` 中的 `buildProcessLabCards()` 会直接过滤掉没有排程的实验室，因此：

- 页面默认只能看到“已有排程”的实验室
- 顶部 `空闲` 数字无法驱动真实的空闲实验室列表
- 页面没有“总览”入口，无法回到“所有实验室”视图

**Decision**

把页头统计区升级为 4 个同风格、可点击的筛选卡片，顺序固定为：

- `总览`
- `实验中`
- `已排程`
- `空闲`

默认选中 `总览`。

状态口径如下：

- `总览`：所有正式实验室，不包含暂存间
- `实验中`：当前状态为 `实验中` 的实验室
- `已排程`：所有已有排程的实验室，包含 `实验中`
- `空闲`：没有排程的实验室

页头数字与筛选口径保持一致：

- `总览` 数字 = 正式实验室总数
- `实验中` 数字 = `实验中` 实验室数量
- `已排程` 数字 = 已排程实验室数量，包含 `实验中`
- `空闲` 数字 = 未排程实验室数量

**Architecture**

- `frontend/src/modules/process/model.js`
  - 继续作为过程管控页唯一的实验室卡片建模入口
  - 不再过滤无排程实验室，而是为每个正式实验室统一产出一张卡片
  - 每张卡片的状态只落在 `实验中 / 已排程 / 空闲` 之一
- `frontend/src/modules/process/useProcessLabs.js`
  - 新增当前筛选状态管理
  - 基于同一份完整实验室卡片计算四个数字与当前可见卡片列表
- `frontend/src/modules/process/page.vue`
  - 把顶部卡片渲染为可点击筛选入口
  - 增加选中态样式与空态展示
  - 保持任务抽屉结构不变

**Interaction Notes**

- 默认进入页面时选中 `总览`
- 点击任一顶部卡片时，仅切换当前实验室卡片列表，不跳转页面
- 空闲实验室如果没有任务编号，则不允许继续点击“查看任务”
- 暂存间仍完全排除在本页之外，不参与数字，不参与卡片列表

**Testing**

补充并调整以下测试：

- `frontend/src/modules/process/model.test.js`
  - 默认产出全部正式实验室
  - 无排程实验室状态为 `空闲`
  - `已排程` 包含 `实验中`
- `frontend/src/modules/process/useProcessLabs.test.js`
  - 默认筛选为 `总览`
  - 四个计数与筛选结果一致
  - 切换筛选后返回正确实验室集合
- `frontend/src/modules/process/page.runtime.test.js`
  - 渲染 `总览 / 实验中 / 已排程 / 空闲`
  - 默认高亮 `总览`
  - 空闲实验室按钮禁用或不响应
