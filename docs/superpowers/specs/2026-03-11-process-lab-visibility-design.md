# Process Lab Visibility Design

**Goal**

收紧“试验过程管控”页面的实验室展示范围，只显示仍然值得关注的实验室卡片。

**Current Context**

当前 `ProcessPage` 通过 `useProcessLabs()` 读取 `buildProcessLabCards()` 的结果，页面会把所有实验室都渲染出来，包括：

- 没有任何排期的实验室
- 很久之前已经结束实验的实验室

这会让页面被“空闲”或“已完成很久”的卡片占满，和过程管控的使用场景不符。

**Decision**

把“实验室是否可见”的规则集中放在 `frontend/src/lib/processLabModel.js` 的 `buildProcessLabCards()` 里处理。

临时完成判定规则如下：

- 没有任何排期的实验室：隐藏
- 存在进行中的排期：显示
- 存在未来排期：显示
- 只有历史排期时：
  - 最近一条排期结束时间距离当前时间不超过 24 小时：显示
  - 最近一条排期结束时间距离当前时间超过 24 小时：隐藏

后续如果增加“固定完成状态”，替换这条临时规则即可，页面和 composable 不需要感知细节。

**Architecture**

- `buildProcessLabCards()` 继续作为唯一的实验室卡片建模入口
- `useProcessLabs()` 保持只负责加载和暴露状态
- `ProcessPage.vue` 保持纯渲染层，不引入额外的 `v-if` 业务过滤

**Testing**

在 `frontend/src/lib/processLabModel.test.js` 补充模型层测试，覆盖：

- 无排期实验室被隐藏
- 已结束超过 24 小时的实验室被隐藏
- 已结束但仍在 24 小时窗口内的实验室保留
- 未来排期实验室保留
- 进行中实验室保留
