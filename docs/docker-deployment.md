# MES Docker 隔离打包与验收

`compose.packaging.yml` 用于与当前本机 MES 并行运行的隔离验收环境。它不会读取项目根目录 `.env`，默认使用独立数据库 `mes_packaging_test`、独立 Docker 卷和仅绑定回环地址的端口。

正式外部数据库、HTTPS、文件 Secrets、离线发布及恢复流程见 `docs/production-deployment.md`；不要把本隔离 Compose 直接用于正式环境。

## 组成

- `migrate`：使用独立 DDL 账号执行 V001–V005，成功退出后才允许 API 启动。
- `api`：FastAPI，非 root 用户、单进程、单 worker，仅使用 DML 账号。
- `web`：Vue 静态文件和 Nginx，非 root 用户，通过同源路径代理 API/SSE。
- `mysql`：隔离验收数据库。
- `rabbitmq`：启用 AMQP、管理界面和 MQTT 插件。

正式运行镜像不包含测试、`.env`、数据库备份、外部开发模拟器程序、截图、本地依赖目录或压测/演示脚本；API 镜像只保留迁移入口和 V001–V005 SQL。应用内仍保留被禁用的模拟器控制边界，以支持高低温湿热二室安装和夹具就绪的 hostless 例外。

## 首次启动

复制配置模板到不提交版本库的路径，并替换全部密码：

```powershell
Copy-Item deploy\.env.compose.example .tmp\compose-packaging.env
docker compose --env-file .tmp\compose-packaging.env -f compose.packaging.yml config --quiet
docker compose --env-file .tmp\compose-packaging.env -f compose.packaging.yml up -d --build
```

默认入口：

- Web：`http://127.0.0.1:15173`
- API：`http://127.0.0.1:18000`
- MySQL：`127.0.0.1:13306`
- RabbitMQ 管理：`http://127.0.0.1:15673`
- MQTT：`127.0.0.1:11883`

这些端口不与本机开发服务的 5173、8000、3306、5672、8900 冲突。

## 验证

```powershell
docker compose --env-file .tmp\compose-packaging.env -f compose.packaging.yml ps -a
Invoke-WebRequest http://127.0.0.1:18000/health/ready -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:15173/api/storage -UseBasicParsing
```

预期：迁移容器退出码为 0，MySQL/RabbitMQ/API/Web 均为 healthy；readiness 同时报告数据库、RabbitMQ 和 MQTT 正常。

## 停止与清理

停止容器但保留数据库、RabbitMQ 和报告卷：

```powershell
docker compose --env-file .tmp\compose-packaging.env -f compose.packaging.yml down
```

只有确认目标项目名为隔离验收项目，且不再需要其中数据时，才允许显式删除卷：

```powershell
docker compose --env-file .tmp\compose-packaging.env -f compose.packaging.yml down --volumes
```

禁止把 `MYSQL_DATABASE` 改为 `mes_single_branch` 后运行此验收栈。真实数据库迁移必须使用后续正式部署配置、维护窗口和独立备份流程。

## 业务模式约束

- 普通实验室在容器中启用 MQTT。
- 容器不打包外部开发上位机模拟器程序，也不会启动它。
- 高低温湿热二室仅在安装样品和夹具就绪时使用应用内 hostless 流程；准备、启动和结束通过 MQTT，关闭开发模拟器不会删除夹具本地例外。
- 当前正式首版固定一个 API 容器和一个 Uvicorn worker。

## 受限网络

基础镜像均支持通过环境变量覆盖。默认使用 Docker Hub；Docker Hub 不可达时，可在临时环境文件中设置 `PYTHON_IMAGE`、`NODE_IMAGE`、`NGINX_IMAGE`、`MYSQL_IMAGE` 和 `RABBITMQ_IMAGE`。发布前应记录最终镜像 digest，不应依赖浮动标签。
