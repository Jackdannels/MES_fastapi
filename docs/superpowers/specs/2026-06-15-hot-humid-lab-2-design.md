# 高低温湿热二室保留说明

## 当前规则

高低温湿热二室（`LAB_HOT_HUMID_2`）没有上位机。该试验间仅使用 mock 模式（hostless 本地模拟），用于本地完成夹具就绪和实验开始的等效推进。

除高低温湿热二室外，所有试验间均仅使用 MQTT 模式，不再保留 mock 模式入口。

## 不要误删

- 不要删除 `frontend/src/lib/labHostInterfaceCapabilities.js` 中对 `LAB_HOT_HUMID_2 / 高低温湿热二室` 的 hostless 判断。
- 不要删除 `frontend/src/modules/laboratory/useLaboratoryPage.js` 中二室的 hostless fixture-ready 和 start 定时器。
- 不要删除 `frontend/src/modules/process/useProcessLabs.js` 中二室 hostless MQTT 提示。
- 清理 mock 残留时，必须把高低温湿热二室的 hostless 本地模拟视为刻意保留的例外。

## 行为边界

二室的本地模拟只替代物理上位机接口边界。任务、托盘、排程、实验 run、完成规则和 UI 可见状态仍必须复用共享业务规则，不能维护一套独立流程。
