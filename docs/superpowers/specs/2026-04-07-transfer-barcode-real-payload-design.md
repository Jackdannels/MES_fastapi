# 托盘条码真实编码统一设计

## 背景

当前接驳区/预分装条码预览与打印使用的是 `TRAY|TASK:...|LOAD:...` 这类拼接文本作为 Code128 的真实编码值。页面上虽然能看到托盘编号，但实际条码图形编码内容与业务对象编号不一致，导致扫码结果、数据库保存值、预览内容三者口径分裂。

## 目标

统一项目内托盘条码规则，确保：

- 条码图形实际编码值始终等于托盘编号
- 后端返回的条码内容、前端生成的 SVG 条码、打印预览与打印文档完全一致
- 说明文字只显示业务摘要，不混入条码真实编码值

## 统一规则

### 1. 真实条形码定义

托盘条码的真实编码值只能是托盘编号，例如：

- `SYLU-2026-03-001-TP-001`

`barcodeNo` 与 `barcodeContent` 在托盘条码场景下统一为同一个值，即托盘编号本身。

### 2. 人眼可读说明

条码下方不再显示：

- `TRAY|TASK:...|LOAD:...`
- 样品编号长串列表

改为仅显示一行：

- `任务编号 | 样品数量：x`

这行只用于人眼阅读，不参与条码编码。

### 3. 作用范围

本次统一覆盖所有托盘条码预览/打印入口：

- 接驳区工作台
- 样品预分装工作台
- 交接区条码预览与打印

样品条码若未来存在，遵循同一原则：真实编码值必须等于样品编号本身。

## 实现设计

### 后端

文件：

- `app/api/routes/transfer_area.py`

调整：

- `build_barcode_payload(...)` 返回的 `barcodeContent` 改为托盘编号
- 已打印托盘回读时，不再把 `barcodeContent` 改写为 `TRAY|TASK:...|LOAD:...`
- 存入数据库/快照的 `barcode_content` 统一保存托盘编号

### 前端

文件：

- `frontend/src/modules/transfer-workbench/TransferWorkbench.vue`
- `frontend/src/modules/handover-system/barcode.js`

调整：

- `buildCode128Svg(...)` 输入统一使用托盘编号
- 预览中的“内容”文本改为 `任务编号 | 样品数量：x`
- 打印文档中的“内容”文本同步改为相同格式
- 删除样品编号长串作为打印主内容的展示

### 测试

文件：

- `tests/api/test_transfer_area.py`
- `frontend/src/modules/transfer-workbench/TransferWorkbench.runtime.test.js`
- `frontend/src/modules/handover-system/page.runtime.test.js`

验证：

- 后端返回的 `barcodeContent` 等于托盘编号
- 预览 SVG 的 `aria-label` 等于托盘编号
- 打印 HTML 中的条码 `aria-label` 等于托盘编号
- 人眼可读文本仅显示 `任务编号 | 样品数量：x`

## 非目标

- 不修改托盘编号生成规则
- 不新增新的条码类型
- 不调整条码样式算法，只统一编码值和说明文本
