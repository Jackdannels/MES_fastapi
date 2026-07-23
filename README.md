# MES FastAPI

本项目是一个基于 `FastAPI + Vue 3 + Vite` 的 MES 示例系统。

开发工具版本：MES 启动器 `v1.2`、上位机模拟器 `v2.0`、LIMS 模拟器 `v1.0`。各模拟器通过后端版本常量和状态接口向页面提供版本号。

当前默认运行方式：

- 前端独立运行在 `http://192.168.110.15:5173/`（本机也可使用 `http://127.0.0.1:5173/`）
- 后端默认只提供 API，在 `http://127.0.0.1:8000/`
- 后端业务存储默认走 MySQL
- 后端健康检查地址：`http://127.0.0.1:8000/health`
- 开发用 LIMS 模拟器：`http://127.0.0.1:8900/`
- 运行期不再支持 `STORAGE_BACKEND=json`

## 本地开发启动

### 1. 准备环境文件

复制样例配置：

```powershell
Copy-Item .env.example .env
Copy-Item frontend\.env.example frontend\.env
```

然后按当前电脑修改 `.env` 中的机器相关配置：

- `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_USER` / `MYSQL_PASSWORD`
- `MQTT_ENABLED` / `MQTT_HOST` / `MQTT_PORT`
- `UPPER_COMPUTER_SIMULATOR_*`
- `FRONTEND_ORIGINS`

上位机模拟器路径通常不需要写死。未设置 `UPPER_COMPUTER_SIMULATOR_DIR` 时，后端默认查找：

```text
<当前用户桌面>\MES_upper_computer_simulator
```

### 2. 一键开发启动

Windows 下可直接双击：

```text
start-dev.bat
```

或执行：

```powershell
.\start-dev.ps1
```

该脚本会启动：

- 后端：`http://127.0.0.1:8000`
- 前端 Vite 开发服务：`http://192.168.110.15:5173`
- LIMS 模拟器：`http://127.0.0.1:8900`

脚本会统一启动并跟踪三个服务，关闭或重启 MES 时也会同步关闭或重启 LIMS 模拟器。
服务准备完成后会打开 MES 页面和 LIMS 模拟器页面。
通过桌面启动器运行时，MES 后端和前端使用可见终端窗口输出日志；LIMS 模拟器继续在后台隐藏运行。

### 3. 手动启动后端

```powershell
conda activate fastapi
python scripts\run_local.py --reload --host 0.0.0.0 --port 8000
```

健康检查：

```text
http://127.0.0.1:8000/health
```

看到 `{"status":"ok"}` 即正常。

说明：

- 后端默认是 API-only
- 业务数据源只支持 MySQL
- `http://127.0.0.1:8000/` 返回 `404` 是正常现象

### 4. 手动启动前端开发服务

```powershell
cd frontend
npm install
npm run dev -- --host 0.0.0.0 --port 5173
```

本机访问：

```text
http://192.168.110.15:5173/
```

局域网访问时，其他电脑访问：

```text
http://<MES电脑局域网IP>:5173/
```

## 公网穿透访问

公网穿透不要直接暴露 Vite 开发服务。请使用构建后的公网前端服务：

```powershell
cd frontend
npm run build
npm run serve:public -- --host 0.0.0.0 --port 5173
```

该服务会：

- 提供 `frontend/dist` 中的静态页面
- 将 `/api` 和 `/auth` 代理到 `http://127.0.0.1:8000`
- 避免公网访问 Vite dev 的 `@vite/client` 和本机绝对路径模块

花生壳等内网穿透软件只需要映射前端端口 `5173`。后端仍保持本机 `127.0.0.1:8000`。

## 登录测试

登录账号：

- 用户名：`admin`
- 密码：`123`

建议至少检查：

- 能否正常登录
- 任务/托盘总览是否正常打开
- 试验过程管控里“查看任务”是否正常弹出任务信息
- 退出登录后是否回到登录页

## 后端冒烟测试

打开终端执行：

```powershell
conda activate fastapi
python scripts\trial_run.py --port 8021
```

预期关键结果：

- `health_status_code` 为 `200`
- `serve_web_app` 为 `false`
- `root_status_code` 为 `404`
- `login_status_code` 为 `200`
- `session_status_code` 为 `200`
- `logout_status_code` 为 `204`
- `post_logout_session_status_code` 为 `401`

## 固定工作台终端监听与远程控制

使用 `scripts\build_workstation_configurator.ps1` 构建并在各终端运行 `MES工作台设置_v1.6.exe`。设置程序除 MES 地址和固定操作台外，还可配置：

- 上报在线状态和当前页面：启用后，常驻启动器每 5 秒上报一次心跳；浏览器同时上报当前真实路由和页面标题
- 允许管理端刷新界面：中控可关闭并重新打开该终端的专用 Edge 工作台
- 允许管理端关机/重启：中控可向该 Windows 终端执行系统关机或重启命令；默认关闭，须在终端本机明确勾选

终端管理面板是独立 Windows 程序，不嵌入 MES 网页。执行 `scripts\build_terminal_manager.ps1` 会在桌面生成 `MES终端管理_v1.1.exe`。打开后填写 MES 地址和中控管理员账号，即可查看终端 IP、在线状态、当前页面、最后心跳和权限，并执行单台刷新/关机/重启，以及全部关机/全部重启。批量操作只会命中当前在线且已在本机授权的终端。

终端密钥使用 Windows 当前用户 DPAPI 加密保存；控制接口不接收任意 IP 作为命令目标，而是按已注册的终端 ID 下发，终端每次领取命令时都会重新校验密钥。更新旧版终端时，重新运行 v1.6 设置程序并保存一次即可启用常驻监听。

## LIMS 外部委托开发联调

LIMS 模拟器位于 `tools/lims_simulator`，通过 RabbitMQ AMQP 向 MES 下发外部委托，不调用 MES 接收 HTTP API，也不直接写数据库：

```text
Exchange: lims.mes.commands
Routing Key: lims.external-intake.created.v1
Queue: mes.external-intake.v1
```

MES 通过 `mes.lims.events` Exchange 回传 `received`、`accepted`、`failed` 状态。消息采用持久化投递、Publisher Confirm、手动 ACK、Inbox 幂等和 Outbox 状态发布。MES 页面内部使用的待受理查询与同意受理 HTTP 接口继续保留。

任务受理页点击“外部受理”可以查看待确认委托。只有点击“同意受理”后，MES 才会生成正式任务、样品和实验记录。任务重置会生成 8 条待确认外部委托作为开发基线。

模拟器默认由 `start-dev.ps1`、`mes-service-control.ps1` 和桌面启动器统一管理。单独调试方法见 `tools/lims_simulator/README.md`。

## RabbitMQ / MQTT / 上位机配置

本项目通过 RabbitMQ 的 MQTT 插件向上位机/工控机发送实验室指令，并通过原生 AMQP 队列承载 LIMS 外部委托业务消息。

当前已使用的端口：

- `5672`：RabbitMQ AMQP 端口，供 MES 与 LIMS 使用
- `15672`：RabbitMQ 管理后台，默认地址 `http://127.0.0.1:15672/`
- `1883`：RabbitMQ MQTT 插件端口，上位机/工控机连接该端口

默认账号：

```text
guest / guest
```

后端 `.env` 中的 MQ 配置项如下：

```env
MQTT_ENABLED=false
MQTT_HOST=127.0.0.1
MQTT_PORT=1883
MQTT_USERNAME=guest
MQTT_PASSWORD=guest
MQTT_QOS=1
MQTT_TOPIC_PREFIX=mes/v1
```

配置说明：

- `MQTT_ENABLED=false`：默认不真实发送 MQTT，页面流程仍可正常执行
- `MQTT_ENABLED=true`：开启真实 MQTT 发送，要求 RabbitMQ 服务已启动且 MQTT 插件已启用
- `MQTT_HOST` / `MQTT_PORT`：RabbitMQ MQTT 插件地址，开发环境通常是 `127.0.0.1:1883`
- `MQTT_USERNAME` / `MQTT_PASSWORD`：MQTT 登录账号，开发环境默认 `guest/guest`
- `MQTT_QOS=1`：至少一次投递；上位机侧需能接受重复消息或按任务状态幂等处理
- `MQTT_TOPIC_PREFIX=mes/v1`：MQTT topic 前缀，后续接口升级时可通过版本号区分

模拟上位机自动联动配置：

```env
UPPER_COMPUTER_SIMULATOR_AUTO_ENABLE=false
UPPER_COMPUTER_SIMULATOR_AUTO_START=true
# UPPER_COMPUTER_SIMULATOR_DIR=C:\Users\<your-user>\Desktop\MES_upper_computer_simulator
UPPER_COMPUTER_SIMULATOR_HOST=127.0.0.1
UPPER_COMPUTER_SIMULATOR_PORT=8899
UPPER_COMPUTER_SIMULATOR_URL=http://127.0.0.1:8899
UPPER_COMPUTER_SIMULATOR_DEFAULT_LAB_CODE=LAB_SALT
UPPER_COMPUTER_SIMULATOR_START_TIMEOUT_SECONDS=8
```

配置说明：

- `UPPER_COMPUTER_SIMULATOR_AUTO_ENABLE=false`：默认不自动启动模拟上位机
- `UPPER_COMPUTER_SIMULATOR_AUTO_ENABLE=true`：切换到 MQTT 模式时自动启动模拟上位机并切到自动模式
- `UPPER_COMPUTER_SIMULATOR_DIR`：可不写；不写时默认使用当前用户桌面下的 `MES_upper_computer_simulator`
- `UPPER_COMPUTER_SIMULATOR_URL`：MES 调用模拟器 HTTP 接口的地址，默认 `http://127.0.0.1:8899`

当 `MQTT_ENABLED=true` 且 `UPPER_COMPUTER_SIMULATOR_AUTO_ENABLE=true` 时，MES 登录页切换到 MQTT 模式后会自动：

- 启动模拟上位机服务
- 打开模拟上位机页面
- 调用模拟器 `/api/connect`
- 设置自动模式
- 订阅所有试验间指令：

```text
mes/v1/labs/+/commands/#
```

### RabbitMQ 服务检查

打开终端执行：

```powershell
Get-Service RabbitMQ
Test-NetConnection 127.0.0.1 -Port 15672
Test-NetConnection 127.0.0.1 -Port 1883
```

预期：

- `RabbitMQ` 服务状态为 `Running`
- `15672` 返回 `TcpTestSucceeded: True`
- `1883` 返回 `TcpTestSucceeded: True`

如果插件未启用，可在 RabbitMQ 安装目录执行：

```powershell
$env:ERLANG_HOME = "C:\Program Files\Erlang OTP"
$env:Path = "C:\Program Files\Erlang OTP\bin;$env:Path"
& "C:\Program Files\RabbitMQ Server\rabbitmq_server-4.3.0\sbin\rabbitmq-plugins.bat" enable rabbitmq_management rabbitmq_mqtt
Restart-Service RabbitMQ
```

### 实验室 MQTT 接口协议

当前 MQTT 精确匹配以 `lab_code` 和 `run_no` 为核心。完整接口定义见：

```text
MES与上位机MQTT接口定义V2.0.md
```

MES 发送给上位机：

```text
mes/v1/labs/{lab_code}/commands/fixture-install
mes/v1/labs/{lab_code}/commands/experiment-ready
```

上位机发送给 MES：

```text
mes/v1/labs/{lab_code}/events/fixture-ready
mes/v1/labs/{lab_code}/events/experiment-started
mes/v1/labs/{lab_code}/events/experiment-ended
mes/v1/labs/{lab_code}/events/experiment-result
```

上位机可订阅所有试验间指令：

```text
mes/v1/labs/+/commands/#
```

## 初始化与迁移

开发环境可以按配置启用自动建表或自动灌演示数据：

- `MYSQL_AUTO_INIT_SCHEMA=true` 只建议本地开发使用
- `MYSQL_AUTO_SEED_DEMO=true` 只建议本地开发使用

显式初始化 MySQL 时，使用脚本而不是依赖运行期 JSON：

```powershell
python scripts\init_mysql_storage.py
```

如需初始化后直接重建演示基线：

```powershell
python scripts\init_mysql_storage.py --seed-demo
```

说明：

- `scripts\init_mysql_storage.py` 会先创建数据库和 `app_storage_snapshot` 表，再对已有 MES 主表做结构对齐
- 该脚本要求基础 MES 主表已存在；当前仓库不包含 `biz_task`、`biz_sample`、`biz_tray`、`biz_tray_item`、`md_equipment`、`sys_role` 的完整建表种子 SQL
- 后端运行期只支持 MySQL 存储，不再支持 `STORAGE_BACKEND=json`
- `init_mysql_storage.py` 不会隐式从其他持久化介质导入业务数据

## 演示数据整库重置

如需清空当前业务演示数据并重新生成一套干净基线，可执行：

```powershell
python scripts\reset_demo_data.py
```

该操作是破坏性的，会删除当前任务、样品、实验、排程、托盘分配、冲突记录，并重新生成：

- `SYLU-2026-03-001` 到 `SYLU-2026-03-020` 共 20 个任务
- `001-010` 为 `外部委托`
- `011-020` 为 `内部新增`
- 每个任务 3 个随机试验
- 每个任务样品数大于 4
- 所有任务初始状态统一为全新任务状态

设备定义会保留，不会随这次重置被删除。

补充说明：

- `scripts\reset_demo_data.py` 会先校验并补齐当前 MySQL 存储扩展，再重置业务演示数据
- `scripts\reset_demo_data.py` 只重置当前 MySQL 业务数据
