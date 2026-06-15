# 高低温湿热二室设计

## 目标

新增试验间“高低温湿热二室”，与“高低温湿热一室”同属“高低温湿热试验”。排程、流程、托盘作用域、状态推导、可视化和 UI 可见数据保持一致。差异只发生在 MQTT 模式的物理上位机通信边界：二室没有上位机通信，因此由 MES 本地定时触发等效确认和开始事件。

## 范围

- 新增实验室主数据：`LAB_HOT_HUMID_2 / 高低温湿热二室 / GDW / 高低温湿热试验`。
- 同步前端静态兜底实验间映射，保证主数据接口不可用时仍可排程和进入试验室操作台。
- 排程中“高低温湿热试验”可选择一室或二室，冲突按具体实验间隔离。
- mock 模式下二室与其他试验间一致，不引入二室专属自动开始行为。
- MQTT 模式下仅二室启用无上位机自动推进：
  - 安装夹具后 3 秒自动确认夹具完成。
  - 点击实验准备就绪后 3 秒自动开始实验。

## 非目标

- 不新增“高低温湿热试验2”等实验类型。
- 不改变高低温湿热一室或其他试验间的 MQTT 上位机确认流程。
- 不复制一套二室专用业务状态更新逻辑。

## 架构

新增一个小型实验间能力配置，按实验间 code 判断行为：

```js
LAB_HOST_INTERFACE_CAPABILITIES = {
  LAB_HOT_HUMID_2: {
    hostlessInMqtt: true,
    fixtureReadyDelayMs: 3000,
    experimentStartDelayMs: 3000,
  },
};
```

该配置只影响 MQTT 模式。mock 模式继续走现有流程。

状态推进继续复用后端共享业务服务：

- 比对、安装、夹具确认、准备就绪：复用 `apply_laboratory_task_operation`。
- 开始实验：复用 `start_storage_laboratory_experiment`。

为避免前端继续手写开始实验状态，新增一个后端 start 接口，由过程管控页和二室 MQTT 自动开始共用。接口负责读取当前快照、锁定实验间/托盘资源、解析排程与托盘作用域，并调用共享 start 服务写入任务、样品、排程、实验、实验 run 和 run_trays。

## 数据流

### 主数据和排程

1. `DEFAULT_LABS` 增加 `LAB_HOT_HUMID_2`。
2. 前端 `LAB_LOCATIONS`、`LAB_TEST_MAP`、`PROCESS_LABS`、`LABORATORY_OPTIONS`、实验室静态 code 映射同步增加二室。
3. 排程页读取主数据时，高低温湿热试验候选包含一室和二室；主数据不可用时静态兜底同样包含二室。
4. 已有冲突检测按 `device/lab` 判断，因此一室和二室互不冲突。

### mock 模式

二室不进入 hostless 分支，行为与其他试验间一致：

1. 实验室操作台完成任务比对。
2. 点击安装夹具，写入 `工装夹具安装`。
3. mock 倒计时后写入 `fixtureReady`。
4. 点击实验准备就绪，写入 `实验准备就绪`。
5. 过程管控页按现有 mock 行为手动开始实验。

### MQTT 模式：二室

1. 点击安装夹具，写入 `工装夹具安装`。
2. 不等待上位机 `fixture-ready`。
3. 3 秒后调用实验室操作接口，`operationType = fixtureReady`，写入 `fixtureReady/fixture_ready`。
4. 用户点击实验准备就绪，写入 `实验准备就绪`。
5. 不等待上位机 `experiment-started`。
6. 3 秒后调用后端 start 接口，内部复用 `start_storage_laboratory_experiment`，进入 `实验进行中`。

### MQTT 模式：其他试验间

保持现状：

- 安装夹具后等待上位机 `fixture-ready`。
- 准备就绪后等待上位机 `experiment-started`。

## UI 行为

- 二室在实验室登录/切换列表中可选。
- 排程页高低温湿热试验候选显示一室和二室。
- 过程管控页显示二室卡片，并按二室独立状态展示空闲、已排程、实验进行中。
- MQTT 模式下二室准备就绪后不显示“等待上位机发送实验开始信号”，改为自动开始倒计时或等效提示。
- mock 模式下二室仍显示现有手动开始体验。

## 错误处理

- 自动 fixtureReady 或自动 start 失败时，保留当前状态并显示错误提示。
- 自动 start 前重新读取或校验当前可开始托盘，避免用户切换任务、撤回、完成或托盘状态变化后误启动。
- 所有自动操作使用实验间和托盘资源锁，避免与 MQTT 事件、手动操作、撤回并发写入冲突。
- 自动 start 应具备幂等保护：若同一实验已进入运行中，则不重复创建 run。

## 测试

- 主数据测试：`LAB_HOT_HUMID_2` 存在，`test_type_code` 为 `GDW`。
- 排程测试：高低温湿热试验候选包含一室和二室；一室与二室不互相冲突。
- 实验室模型测试：二室与一室可按具体实验间隔离托盘流程。
- mock 前端测试：二室 mock 模式与普通试验间一致，不自动开始。
- MQTT 前端测试：二室安装夹具后 3 秒自动写入 fixtureReady；准备就绪后 3 秒触发 start。
- MQTT 回归测试：一室仍等待上位机 fixture-ready 和 experiment-started。
- 后端 start 接口测试：复用 `start_storage_laboratory_experiment`，样品、任务、排程、实验、run、run_trays 状态一致。
