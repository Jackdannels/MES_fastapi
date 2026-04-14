# 扫码流程输入框自动聚焦设计

## 背景

项目里已经有多处专门用于扫码的输入框，但当前体验不统一：

- 有的扫码流程打开后已经能直接输入
- 有的仍然需要再点击一次输入框，现场操作会多一步

这次改动的目标不是做页面级抢焦点，而是把“进入扫码流程后即可直接扫码”的行为统一下来。也就是说，只有当用户已经点开对应扫码入口时，系统才自动把光标放进该扫码输入框。

## 目标行为

1. 只改“专门用于扫码”的输入框，不改普通搜索框、筛选框、编辑框。
2. 触发时机是“用户进入扫码流程后”，不是页面一打开就抢焦点。
3. 用户进入扫码流程后，输入框自动进入输入模式，不需要再手动点击输入框本身。
4. 现有已经支持自动聚焦的扫码流程保持原行为，不回退。
5. 如果输入框未渲染、被禁用或扫码流程已关闭，则跳过聚焦，不抛错。

## 适用范围

当前纳入统一行为的扫码入口：

- 盐雾试验室 `任务比对` 弹窗里的托盘扫码输入
- 暂存间 `扫码入库 / 扫码出库` 弹窗里的托盘扫码输入
- 接驳区 `托盘扫码出库` 面板里的扫码输入

不纳入本次范围：

- 各页面搜索框
- 列表筛选输入框
- 详情页只读字段
- 普通表单输入

## 方案选择

### 方案 A：逐页面局部自动聚焦

每个扫码入口自己在打开后执行 `nextTick + focus()`。

优点：

- 改动直观
- 风险低

缺点：

- 后续容易每个页面各写一套
- 新增扫码入口时容易漏

### 方案 B：轻量公共 helper + 局部显式接入

提供一个很轻的公共 helper，只负责在目标输入框可用后执行聚焦；各扫码页面显式传入自己的输入框 ref，并在进入扫码流程后调用。

优点：

- 保持局部显式，不会误聚焦其他输入框
- 后续新扫码入口接入成本低
- 能复用暂存间现有的聚焦模式

缺点：

- 需要多一个公共文件

### 方案 C：页面级兜底查找输入框

进入扫码流程后，由页面或模块自动查找第一个可能是扫码框的元素并聚焦。

优点：

- 接入速度快

缺点：

- 依赖 DOM 猜测
- 结构变动后容易失效
- 风险最高

确认采用方案 B：轻量公共 helper + 局部显式接入。

## 设计

### 聚焦策略

- 只在“进入扫码流程”时自动聚焦一次
- 不做页面级全局自动聚焦
- 不依赖 `querySelector` 猜输入框
- 每个扫码场景显式维护自己的输入框 `ref`
- 聚焦动作统一等待 DOM 渲染完成后执行

### 盐雾试验室

- 在 `frontend/src/modules/laboratory/page.vue` 的 `任务比对` 弹窗扫码输入上绑定 `ref`
- 当用户点击 `比对任务` 打开弹窗后，自动聚焦到 `laboratory-compare-scan-input`
- 关闭弹窗后不强行回焦

### 暂存间

- 保留 `frontend/src/modules/staging-management/page.vue` 当前“打开扫码弹窗即聚焦”的交互
- 将现有 `focusScanInput` 行为收口到公共 helper，避免后续重复实现
- 现有扫码完成、取消扫码等流程不改

### 接驳区

- 在 `frontend/src/modules/transfer-workbench/TransferDispatchPanel.vue` 的 `transfer-dispatch-scan-input` 上绑定 `ref`
- 面板进入可扫码状态后自动聚焦
- 若父组件重新进入扫码态，也允许再次触发聚焦

## 实现落点

### 公共 helper

- 新增一个轻量 helper，建议放在 `frontend/src/composables/` 或 `frontend/src/lib/`
- 职责仅为：
  - 等待一次 `nextTick`
  - 检查 ref 对象是否可用
  - 调用目标输入框的 `focus()`

### 页面接入

- `frontend/src/modules/laboratory/page.vue`
- `frontend/src/modules/laboratory/useLaboratoryPage.js`
- `frontend/src/modules/staging-management/page.vue`
- `frontend/src/modules/transfer-workbench/TransferDispatchPanel.vue`
- 如需要补齐进入扫码态的触发，也可顺带调整 `frontend/src/modules/transfer-workbench/TransferWorkbench.vue`

## 测试

### 运行时测试

- 盐雾试验室：
  - 打开 `任务比对` 弹窗后，`laboratory-compare-scan-input` 成为 `document.activeElement`
- 暂存间：
  - 保持“打开扫码弹窗后，`zancun-scan-code` 自动聚焦”的断言
- 接驳区：
  - 页面进入托盘扫码出库流程后，`transfer-dispatch-scan-input` 自动聚焦

### 回归约束

- 不新增对普通搜索框的自动聚焦断言
- 不引入全局自动聚焦副作用
- 页面之间的聚焦逻辑只共享 helper，不共享具体状态

## 风险

- 若把自动聚焦做成页面级抢焦点，容易干扰现有键盘操作，因此必须坚持“进入扫码流程后再聚焦”
- 接驳区是常驻面板，不是 modal，触发时机要基于组件进入扫码态，而不是简单地每次渲染都重复抢焦点
- 暂存间当前已经有可用实现，本次应优先复用并保持行为稳定，避免为了抽象而重写
