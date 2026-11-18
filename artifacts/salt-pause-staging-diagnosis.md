# 盐雾暂停后“送至暂存间”变灰：复现与修复

## 修复结果

已在共享前端展示模型中修复。当前转运段的真实入库记录可以证明前置派送已完成，派送时间保持为空；真实派送记录存在时优先保留其时间。原运行开始及原盐雾派送时间限制证据范围，防止恢复阶段的记录填充原转运段。

修复后，下述脚本执行验收断言，输出 `artifacts/salt-pause-staging-fixed.json`。原始复现输出 `artifacts/salt-pause-staging-repro.json` 保留作为修复前对照。

- 盐雾历史专项：62 项通过（新增 30 项）。
- 包含托盘模型、统一流程、托盘组件及实验室可视化的相关前端测试：6 个文件、319 项通过。
- 前端 lint 通过。
- 独立复现脚本验收通过，输入对象未被修改。

以下为修复前的定位记录，行号对应修复前源码。

## 复现范围

按截图的时间及数据形态构造输入，直接运行项目生产代码 `buildTrayFlowView`，未操作在线实验、未修改业务数据或生产代码。

```powershell
rtk proxy node artifacts/salt-pause-staging-repro.mjs
```

输入顺序：四综合试验完成（20:08:34）→ 暂存间扫码入库（20:08:40）→ 出库至盐雾室（20:08:55）→ 到达、安装、准备就绪、开始（20:09:11）→ 暂停（20:10:00）。其中有入库记录，没有独立的“送至暂存间”历史记录。

## 结果

| 场景 | 送至暂存间 | 已到达暂存间 |
| --- | --- | --- |
| 暂停前 | reached=true，时间为空 | reached=true，20:08:40 |
| 暂停后的底层流程引擎 | reached=true，时间为空 | reached=true，20:08:40 |
| 暂停后的最终展示模型 | reached=false，时间为空 | reached=true，20:08:40 |
| 补充真实派送记录的对照 | reached=true，20:08:36 | reached=true，20:08:40 |

还验证了首项直接进行盐雾的两个对照：有独立派送记录时保留已完成；缺少派送记录时同样变灰。触发条件是历史证据的组合，并非只要盐雾排在后面就必然发生。复现脚本同时断言输入对象未被修改。

完整输出：`artifacts/salt-pause-staging-repro.json`。

## 原因链

1. `app/services/storage_tray_actions.py:55` 允许已完成实验的托盘直接暂存间扫码入库。`build_stock_in_updates` 在 854–874 行记录入库历史和 stock_in 事件，没有补写独立的派送事件。因此“有到达记录，没有派送记录”是业务允许产生的数据。
2. `frontend/src/modules/samples/sampleFlow.trayFlowEngine.js:572` 在实验进行中时把前面的路线节点标为 reached。派送没有独立时间时，节点显示为已完成，时间为 `-`，与第一张截图一致。
3. `frontend/src/modules/samples/sampleFlow.trayFlowView.js:26` 在最终展示阶段调用 `presentSaltSprayPauseHistory`。该函数从盐雾暂停开始生效，也会作用于后续恢复阶段。
4. `frontend/src/modules/samples/sampleFlow.saltPauseHistory.js:66` 将 stock_in 仅作为“已到达暂存间”的证据；第 67 行仅将明确以暂存间为目标的 stock_out 作为“送至暂存间”的证据。它没有用本转运段真实入库事实保留前序派送节点的推断完成状态。
5. 同文件第 74 行以 `reached: Boolean(times)` 覆盖原状态。派送证据为空时将 true 覆盖为 false；`TrayManagementPanel.vue:160` 因此移除 reached 样式，节点变灰。

第三张截图中的首项盐雾具有独立派送时间 20:02:42，能够通过上述校验，因此暂停后仍是绿色。第二张截图中的盐雾派送、到达、安装、准备就绪变橙色属于现有暂停准备步骤重置；暂存派送变灰来自这里单独的历史校验逻辑。

## 已有验证及缺口

`rtk npm run test:run -- src/modules/samples/saltSprayResumeHistory.test.js`：32 项通过。

既有多试验用例在前序实验完成后同时补入“派送”和“到达”记录；缺少本次“仅有入库记录”的合法路径，所以未拦截此显示问题。

## 建议修正方向

在当前盐雾转运段范围内，用确凿的普通暂存间入库记录保留前序派送的推断完成状态，时间仍为空。继续排除前序实验之前的暂存记录、其他任务/托盘、暂停后的新记录、实验后留样暂存记录。无需为此伪造派送时间或扩大设备接口例外。
