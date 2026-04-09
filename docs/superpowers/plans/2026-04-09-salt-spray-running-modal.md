# 盐雾试验室运行中固定弹窗 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为盐雾试验室操作台增加实验运行中固定弹窗、倒计时和实验完成确认闭环。

**Architecture:** 在 laboratory 模块内部新增“运行中实验视图模型”，由 model 负责识别当前运行实验与倒计时，由 composable 负责弹窗状态与完成写回，页面只负责渲染固定弹窗和确认弹窗。完成操作继续复用现有样品/托盘同步写回口径，保证同托盘样品状态一致。

**Tech Stack:** Vue 3 Composition API、Vitest、现有前端 storage snapshot 持久化

---

## Chunk 1: 运行中实验模型

### Task 1: 为 laboratory model 增加运行中实验视图

**Files:**
- Modify: `frontend/src/modules/laboratory/model.js`
- Test: `frontend/src/modules/laboratory/model.test.js`

- [ ] **Step 1: 写失败测试，覆盖运行中弹窗数据**

添加测试断言：
- 当前任务存在 `实验进行中` 托盘时，生成运行中弹窗数据
- 返回任务号、实验名、运行托盘、样品编号
- 返回剩余秒数、开始时间、预计完成时间

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:run -- src/modules/laboratory/model.test.js`
Expected: FAIL，提示缺少运行中视图字段或返回为空

- [ ] **Step 3: 实现最小模型代码**

在 `frontend/src/modules/laboratory/model.js`：
- 增加运行中实验解析函数
- 识别当前盐雾实验中 `实验进行中` 的托盘
- 计算倒计时和超时态
- 将结果挂到 laboratory view 输出

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test:run -- src/modules/laboratory/model.test.js`
Expected: PASS

## Chunk 2: 页面状态与完成闭环

### Task 2: 为 laboratory composable 增加运行中弹窗和完成确认状态

**Files:**
- Modify: `frontend/src/modules/laboratory/useLaboratoryPage.js`
- Test: `frontend/src/modules/laboratory/page.runtime.test.js`

- [ ] **Step 1: 写失败测试，覆盖固定弹窗和完成确认**

添加测试断言：
- 有运行中实验时自动显示固定弹窗
- 点击 `实验完成` 弹出确认框
- 倒计时归零时自动弹出确认框

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:run -- src/modules/laboratory/page.runtime.test.js`
Expected: FAIL，提示找不到运行中弹窗或确认交互

- [ ] **Step 3: 实现最小状态管理**

在 `frontend/src/modules/laboratory/useLaboratoryPage.js`：
- 增加运行中弹窗开关
- 增加完成确认弹窗开关
- 增加倒计时归零自动触发逻辑
- 暴露页面渲染所需字段

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test:run -- src/modules/laboratory/page.runtime.test.js`
Expected: PASS

### Task 3: 实现实验完成写回

**Files:**
- Modify: `frontend/src/modules/laboratory/useLaboratoryPage.js`
- Modify: `frontend/src/modules/laboratory/model.js`
- Test: `frontend/src/modules/laboratory/model.test.js`
- Test: `frontend/src/modules/laboratory/page.runtime.test.js`

- [ ] **Step 1: 写失败测试，覆盖完成后状态写回**

添加测试断言：
- 只更新当前盐雾实验对应托盘和样品为 `实验已完成`
- 同任务其他实验托盘不变
- 完成后固定弹窗消失

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:run -- src/modules/laboratory/model.test.js src/modules/laboratory/page.runtime.test.js`
Expected: FAIL，提示状态未更新或误改了其他实验

- [ ] **Step 3: 实现最小完成写回代码**

在 `frontend/src/modules/laboratory/useLaboratoryPage.js`：
- 增加 `confirmExperimentComplete`
- 基于当前运行托盘调用现有同步状态 helper
- 持久化 `mes.samples`
- 派发 `mes:samples-updated`

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test:run -- src/modules/laboratory/model.test.js src/modules/laboratory/page.runtime.test.js`
Expected: PASS

## Chunk 3: 页面渲染与样式

### Task 4: 渲染固定运行中弹窗和确认弹窗

**Files:**
- Modify: `frontend/src/modules/laboratory/page.vue`
- Modify: `frontend/src/modules/laboratory/styles.css`
- Test: `frontend/src/modules/laboratory/page.runtime.test.js`

- [ ] **Step 1: 写失败测试，覆盖弹窗内容展示**

添加测试断言：
- 显示任务号、实验名、托盘号、样品号
- 大字号倒计时可见
- 右下角 `实验完成` 按钮可见
- 完成确认框包含托盘和样品摘要

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:run -- src/modules/laboratory/page.runtime.test.js`
Expected: FAIL，提示页面缺少对应节点

- [ ] **Step 3: 实现最小页面与样式**

在 `frontend/src/modules/laboratory/page.vue`：
- 增加固定运行中弹窗
- 增加完成确认弹窗

在 `frontend/src/modules/laboratory/styles.css`：
- 增加固定定位样式
- 增加大字号倒计时样式
- 增加超时态与完成按钮样式

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test:run -- src/modules/laboratory/page.runtime.test.js`
Expected: PASS

## Chunk 4: 回归验证

### Task 5: 跑完整相关回归

**Files:**
- Verify only

- [ ] **Step 1: 运行 laboratory 相关测试**

Run: `npm run test:run -- src/modules/laboratory/model.test.js src/modules/laboratory/page.runtime.test.js`
Expected: PASS

- [ ] **Step 2: 运行相关联流程回归**

Run: `npm run test:run -- src/modules/process/useProcessLabs.test.js src/modules/samples/samplesFlowModel.test.js src/modules/samples/page.runtime.test.js`
Expected: PASS

- [ ] **Step 3: 人工验证**

手工验证：
- 盐雾试验室进入 `实验进行中` 后自动显示固定弹窗
- 倒计时正常递减
- 点击 `实验完成` 后进入二次确认
- 确认后弹窗消失，流程更新为已完成

Plan complete and saved to `docs/superpowers/plans/2026-04-09-salt-spray-running-modal.md`. Ready to execute?
