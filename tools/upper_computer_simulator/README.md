# MES 上位机模拟器

这是一个独立的上位机模拟器，用于验证 MES 与试验间上位机 MQTT 接口。

当前版本：`v2.8`。版本号由 `app.py` 中的 `SIMULATOR_VERSION` 统一管理，并通过状态接口显示到页面标题区。

## 启动

双击：

```text
start.bat
```

启动后浏览器访问：

```text
http://127.0.0.1:8899
```

## 功能

- 页面分为“状态遥测”和“实验流程”两个界面；连接配置由两者共用。
- 状态遥测覆盖 11 个试验间，每 1 秒以 MQTT QoS 1 发布完整快照：
  - `mes/v1/labs/{lab_code}/telemetry/snapshot`
  - 可暂停单个试验间采集，也可修改六项模拟值后立即发送。
  - 高低温湿热二室继续提供环境和试验设备数据，并明确标记不配置搬运设备。
  - 每第 10 轮随机选择一个无活动故障的试验间：高温或低电压持续 3 秒，试验设备/搬运设备失联持续 6 秒，暂停遥测模拟数据延迟持续 7 秒，暂停遥测模拟整间上位机失联持续 20 秒。长事件不会被下一轮事件覆盖；高低温湿热二室不参与搬运设备失联事件。通信恢复由 MES 连续两次新数据确认。
- 实验流程界面保留原有安装夹具、准备就绪、实验启停和结果回传能力。

- 连接 MQTT Broker
- 订阅 MES 下发命令：
  - `mes/v1/labs/{lab_code}/commands/fixture-install`
  - `mes/v1/labs/{lab_code}/commands/experiment-ready`
  - `mes/v1/labs/{lab_code}/commands/experiment-end-request`
- 发送上位机事件：
  - `mes/v1/labs/{lab_code}/events/fixture-ready`
  - `mes/v1/labs/{lab_code}/events/experiment-started`
  - `mes/v1/labs/{lab_code}/events/experiment-ended`
  - `mes/v1/labs/{lab_code}/events/experiment-result`
- 自动模式：
  - 订阅 `mes/v1/labs/+/commands/#`
  - 收到 `fixture-install` 后延时 1 秒回传 `fixture-ready`
  - 收到 `experiment-ready` 后延时 0.1 秒回传 `experiment-started`
  - `experiment-started` 发送成功后保持运行，不会自动回传 `experiment-ended`
  - 收到 `experiment-end-request` 后立即回传一次 `experiment-ended`
  - 不自动发送 `experiment-result`
- 发送 V2.0 snake_case payload：
  - `fixture-ready`: `lab_code`, `fixture_install_id`, `success_id`, `fixture_ready_at`
  - `experiment-started`: `lab_code`, `run_no`, `started_at`；轴向实验还会携带 `sub_experiment_code`、`current_axis_code`
  - `experiment-ended`: `lab_code`, `run_no`, `ended_at`；轴向实验还会携带 `sub_experiment_code`、`axis_code`，存在下一轴向时携带 `next_axis_code`
  - `experiment-result`: `lab_code`, `run_no`, `result_at`, `result_package`
- MQTT 报文不传输排程编号或排程快照。排程关联由 MES 内部保存，模拟器不缓存或回传 `schedule_id`、`schedule_no` 及其驼峰字段。
- 收到 MES 下发的 `experiment-ready` 后会缓存 `run_no`、`sub_experiment_code` 和 `current_axis_code`。同一运行批次重新下发准备就绪并切换轴向时，会用新轴向更新缓存，延迟回传的 `experiment-started` 会携带本次准备指令对应的运行批次、子实验和当前轴向。
- 每次 `experiment-ready` 的自动回传上下文会独立快照；即使短时间内连续收到不同轴向的准备指令，各自延迟发送的 `experiment-started` 也不会串用后一个轴向。
- 轴向 `experiment-end-request` 会按请求中的 `axis_code` 结束当前轴向，并在存在后续轴向时原样回传 `next_axis_code`；同一运行批次可逐轴结束且每个轴向只回传一次。
- 当 MES 主项目切换到 MQTT 接口模式且启用自动联动配置时，MES 会自动启动本模拟器，并调用 `/api/connect` 切换为自动模式，订阅 `mes/v1/labs/+/commands/#`。
- 时间使用北京时间：
  - `YYYY-MM-DD HH:mm:ss`

## 使用步骤

1. 填写 MQTT Host、Port、Topic Prefix、试验间 `lab_code`。
2. 如需自动响应所有试验间命令，勾选“自动模式”。
3. 点击“连接并订阅”。
4. MES 发送安装夹具或准备就绪命令后，会显示在“接收 MES 命令”区域。
5. 在“发送上位机事件”区域点击按钮，模拟上位机向 MES 回传事件。
