# MES FastAPI

本项目是一个基于 `FastAPI + Vue 3 + Vite` 的 MES 示例系统。

当前默认运行方式：

- 前端独立运行在 `http://127.0.0.1:5173/`
- 后端默认只提供 API，在 `http://127.0.0.1:8000/`
- 后端业务存储默认走 MySQL
- 后端健康检查地址：`http://127.0.0.1:8000/health`
- 运行期不再支持 `STORAGE_BACKEND=json`

## 最简测试流程

### 1. 准备后端环境文件

在项目根目录创建或修改 `.env`，至少写入：

```env
DEBUG=true
SERVE_WEB_APP=false
DEMO_USER=admin
DEMO_PASSWORD=123
SESSION_SECRET_KEY=local-dev-session-secret
FRONTEND_ORIGINS=http://127.0.0.1:5173,http://localhost:5173
STORAGE_BACKEND=mysql
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=
MYSQL_DATABASE=mes_single_branch
MYSQL_AUTO_INIT_SCHEMA=false
MYSQL_AUTO_SEED_DEMO=false
MQTT_ENABLED=false
MQTT_HOST=127.0.0.1
MQTT_PORT=1883
MQTT_USERNAME=guest
MQTT_PASSWORD=guest
MQTT_QOS=1
MQTT_TOPIC_PREFIX=mes/v1
```

### 2. 准备前端环境文件

在 `frontend/.env` 中写入：

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
```

### 3. 启动后端

打开第一个终端：

```powershell
conda activate fastapi
cd c:\Users\12051\Desktop\MES_fastapi
python scripts\run_local.py --reload --host 0.0.0.0 --port 8000
```

然后打开：

- `http://127.0.0.1:8000/health`

看到 `{"status":"ok"}` 即正常。

说明：

- 当前默认是 API-only
- 当前默认业务数据源是 MySQL
- MQTT 默认关闭；如需向上位机真实发送消息，需先启动 RabbitMQ 并把 `MQTT_ENABLED=true`
- 运行期只支持 MySQL 作为业务存储后端
- 所以 `http://127.0.0.1:8000/` 返回 `404` 是正常现象

### 4. 启动前端

打开第二个终端：

```powershell
cd c:\Users\12051\Desktop\MES_fastapi\frontend
npm install
npm run dev -- --host 0.0.0.0
```

然后打开：

- `http://127.0.0.1:5173/`

### 5. 登录测试

登录账号：

- 用户名：`admin`
- 密码：`123`

建议至少检查：

- 能否正常登录
- 任务/托盘总览是否正常打开
- 试验过程管控里“查看任务”是否正常弹出任务信息
- 退出登录后是否回到登录页

### 6. 跑一次后端冒烟测试

打开第三个终端执行：

```powershell
conda activate fastapi
cd c:\Users\12051\Desktop\MES_fastapi
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

## RabbitMQ / MQTT 配置

本项目通过 RabbitMQ 的 MQTT 插件向上位机/工控机发送实验室指令。RabbitMQ 作为消息中枢，MQTT 端口面向上位机，后续 LIMS 可继续通过 AMQP 或独立同步服务接入。

当前已使用的端口：

- `5672`：RabbitMQ AMQP 端口，预留给后端 worker、LIMS 同步等服务
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

### MES 发送给上位机的消息

盐雾试验室操作台当前发送两类 MQTT 消息。

安装夹具：

- 页面触发点：盐雾操作台完成托盘比对后，点击 `样品安装` 弹窗中的 `安装完成`
- 后端接口：`POST /api/mq/laboratory/fixture-install`
- MQTT topic：`mes/v1/labs/salt-spray-lab-01/commands/fixture-install`
- payload 示例：

```json
{
  "cmd": "INSTALL_FIXTURE",
  "taskId": "SYLU-2026-03-001",
  "labId": "salt-spray-lab-01",
  "sampleType": "",
  "sampleCount": 8
}
```

准备就绪：

- 页面触发点：盐雾操作台点击 `确认准备就绪` 弹窗中的 `确认准备就绪`
- 后端接口：`POST /api/mq/laboratory/ready`
- MQTT topic：`mes/v1/labs/salt-spray-lab-01/commands/experiment-ready`
- payload 示例：

```json
{
  "cmd": "READY",
  "taskId": "SYLU-2026-03-001",
  "labId": "salt-spray-lab-01"
}
```

当前规则：

- `labId` 固定为 `salt-spray-lab-01`
- `sampleType` 暂时发送空字符串
- `sampleCount` 为本次已比对托盘关联样品数之和
- MQTT 发送失败不会阻塞盐雾操作台的本地业务状态更新，失败信息会输出到前端控制台

### 上位机订阅建议

上位机可以订阅具体实验室指令：

```text
mes/v1/labs/salt-spray-lab-01/commands/#
```

也可以订阅所有 MES 下发指令：

```text
mes/v1/labs/+/commands/#
```

## 初始化与迁移

开发环境可以按配置启用自动建表或自动灌演示数据：

- `MYSQL_AUTO_INIT_SCHEMA=true` 只建议本地开发使用
- `MYSQL_AUTO_SEED_DEMO=true` 只建议本地开发使用

显式初始化 MySQL 时，使用脚本而不是依赖运行期 JSON：

```powershell
cd c:\Users\12051\Desktop\MES_fastapi
python scripts\init_mysql_storage.py
```

如需初始化后直接重建演示基线：

```powershell
cd c:\Users\12051\Desktop\MES_fastapi
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
cd c:\Users\12051\Desktop\MES_fastapi
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
