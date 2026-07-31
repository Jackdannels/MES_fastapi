# 高低温湿热二室当前维护说明

该文件保留为历史计划入口的当前状态说明。

高低温湿热二室（`LAB_HOT_HUMID_2`）当前采用混合物理接口。安装样品及 `fixture-ready` 继续使用 hostless 本地模拟；确认准备就绪、实验开始和实验结束改为通过上位机 MQTT 传输，即 `READY / EXPERIMENT_STARTED / END_REQUEST / EXPERIMENT_ENDED` 均走 MQTT。

维护要求：

- 所有试验间的准备、启动和结束均使用 MQTT 模式。
- 不要删除二室安装样品和夹具就绪的 hostless 本地模拟逻辑，也不要把该本地例外扩展到实验启动或结束。
- 不要为其他试验间恢复 mock 模式、mock 开始实验或 mock 完成实验入口。
- 二室本地模拟必须继续复用共享业务规则，不能复制独立状态机。
