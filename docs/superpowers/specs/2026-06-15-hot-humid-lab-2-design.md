# 高低温湿热二室保留说明

## 当前规则

高低温湿热二室（`LAB_HOT_HUMID_2`）现采用混合接口：本地模拟只完成夹具就绪；准备、启动和结束通过上位机 MQTT 完成。

所有试验间的准备、启动和结束均使用 MQTT；只有高低温湿热二室的安装样品和夹具就绪保留 hostless 入口。

## 不要误删

- 不要删除 `frontend/src/lib/labHostInterfaceCapabilities.js` 中对 `LAB_HOT_HUMID_2 / 高低温湿热二室` 的本地 fixture-ready 判断。
- 不要删除 `frontend/src/modules/laboratory/useLaboratoryPage.js` 中二室的 hostless fixture-ready 定时器。
- 二室不得恢复本地 start 或本地 completion 定时推进；这些状态只接受 MQTT 上位机信号。
- 清理 mock 残留时，必须把高低温湿热二室的夹具本地模拟视为刻意保留的例外。

## 行为边界

二室的本地模拟只替代安装样品和夹具就绪的物理接口边界。任务、托盘、排程、实验 run、完成规则和 UI 可见状态仍必须复用共享业务规则，不能维护一套独立流程。
