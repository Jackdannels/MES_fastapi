# MES FastAPI 项目说明

本项目是一个基于 `FastAPI + Vue 3 + Vite` 的 MES 示例系统。

当前推荐运行方式已经调整为：

- 前端独立运行
- 后端默认只提供 API
- 前后端可以部署在同一台 PC 上，但作为两个独立服务协作

如果确实需要，后端仍可通过显式配置临时托管前端构建产物。

## 当前架构

### 前端

- 目录：`frontend/`
- 技术栈：`Vue 3`、`Vite`、`Vitest`
- 开发地址：`http://127.0.0.1:5173/`
- 生产构建输出：`frontend/dist`

### 后端

- 目录：`app/`
- 技术栈：`FastAPI`
- API 地址：`http://127.0.0.1:8000/`
- 健康检查：`http://127.0.0.1:8000/health`

### 兼容说明

- 默认情况下，后端不再托管 SPA 页面
- 默认访问 `http://127.0.0.1:8000/` 会返回 `404`
- 只有在 `.env` 中显式设置 `SERVE_WEB_APP=true` 时，后端才会从 `frontend/dist` 提供兼容页面

## 主要接口

### 认证与系统接口

- `POST /auth/login`
- `GET /auth/session`
- `POST /auth/logout`
- `GET /health`
- `GET /health/db`
- `GET /api/storage`
- `PUT /api/storage`

### 通用 CRUD 模块

以下模块已经统一接入共享 CRUD 路由：

- `person`
- `customer`
- `companydepartment`
- `permissions`
- `workflows`
- `technologies`
- `warehouse`
- `productcatalog`
- `quality`
- `manufactureplan`
- `report`
- `device`
- `material`
- `yt_barcode`
- `yt_file`
- `yt_object`
- `yt_timesheet`
- `yt_log`
- `yt_report`

每个模块均提供：

- `GET /<module>`
- `GET /<module>/{id}`
- `POST /<module>`
- `PUT /<module>/{id}`
- `DELETE /<module>/{id}`

## 环境要求

- Python `3.10+`
- Node.js 与 `npm`
- Conda 环境 `fastapi`（推荐）
- 达梦数据库驱动与客户端（如果要联调数据库）

## 环境变量

### 1. 复制环境文件

```powershell
cd c:\Users\12051\Desktop\MES_fastapi
copy .env.example .env
```

### 2. 推荐本地联调配置

将下面内容写入根目录 `.env`：

```env
APP_NAME=MES Local
DEBUG=true
SERVE_WEB_APP=false
DEMO_USER=admin
DEMO_PASSWORD=123
SESSION_COOKIE_NAME=mes_session
SESSION_SECRET_KEY=local-dev-session-secret
SESSION_IDLE_TIMEOUT_MINUTES=30
SESSION_MAX_AGE_HOURS=8
FRONTEND_ORIGINS=http://127.0.0.1:5173,http://localhost:5173
DM_HOST=127.0.0.1
DM_PORT=5236
DM_USER=SYSDBA
DM_PASSWORD=SYSDBA
DM_DATABASE=MES
```

本地 demo 登录账号：

- 用户名：`admin`
- 密码：`123`

说明：

- 未配置 `DEMO_USER` 或 `DEMO_PASSWORD` 时，`/auth/login` 会返回 `503`
- 未配置 `SESSION_SECRET_KEY` 时，认证接口会返回 `503`

### 3. 前端 API 地址配置

如果前端需要显式指向独立后端，请在 `frontend/.env` 中配置：

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
```

示例模板已提供在 [frontend/.env.example](c:/Users/12051/Desktop/MES_fastapi/frontend/.env.example)。

## 最简测试流程

如果你只是想在本地快速把前后端跑起来并完成一次登录测试，直接按下面 6 步做。

### 1. 准备后端环境文件

根目录创建或修改 `.env`，至少包含：

```env
DEBUG=true
SERVE_WEB_APP=false
DEMO_USER=admin
DEMO_PASSWORD=123
SESSION_SECRET_KEY=local-dev-session-secret
FRONTEND_ORIGINS=http://127.0.0.1:5173,http://localhost:5173
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

用浏览器打开 `http://127.0.0.1:8000/health`，看到 `{"status":"ok"}` 即正常。

注意：

- 当前默认是 API-only
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

### 5. 登录并手工测试

使用下面账号登录：

- 用户名：`admin`
- 密码：`123`

建议至少检查：

- 能否正常登录
- 任务/托盘总览是否正常打开
- 试验过程管控里“查看任务”是否正常弹出任务信息
- 退出登录后是否回到登录页

### 6. 跑一次后端冒烟测试

再开一个终端执行：

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

## 启动方式

### 后端启动

方式一，先激活 Conda 环境再启动：

```powershell
conda activate fastapi
cd c:\Users\12051\Desktop\MES_fastapi
python -m pip install -r requirements.txt
python scripts\run_local.py --reload --host 0.0.0.0 --port 8000
```

方式二，不手动激活环境，直接用 `conda run`：

```powershell
cd c:\Users\12051\Desktop\MES_fastapi
C:\ProgramData\anaconda3\Scripts\conda.exe run -n fastapi python -m pip install -r requirements.txt
C:\ProgramData\anaconda3\Scripts\conda.exe run -n fastapi python scripts\run_local.py --reload --host 0.0.0.0 --port 8000
```

启动后可访问：

- API 根路径：`http://127.0.0.1:8000/`（默认 `404`）
- 健康检查：`http://127.0.0.1:8000/health`

### 前端启动

```powershell
cd c:\Users\12051\Desktop\MES_fastapi\frontend
npm install
npm run dev -- --host 0.0.0.0
```

启动后可访问：

- 前端开发地址：`http://127.0.0.1:5173/`

说明：

- Vite 开发代理当前只代理 `/auth` 和 `/api`
- 前端开发环境直接使用自己的资源，不再依赖后端 `/static`

## 前后端联调

联调时需要同时打开两个终端。

终端 A，启动后端：

```powershell
conda activate fastapi
cd c:\Users\12051\Desktop\MES_fastapi
python scripts\run_local.py --reload --host 0.0.0.0 --port 8000
```

终端 B，启动前端：

```powershell
cd c:\Users\12051\Desktop\MES_fastapi\frontend
npm run dev -- --host 0.0.0.0
```

联调时访问：

- 前端：`http://127.0.0.1:5173/`
- 后端 API：`http://127.0.0.1:8000/`

## 后端兼容托管前端

如果你仍然需要让 FastAPI 在 `8000` 端口直接返回前端页面，可启用兼容模式。

### 1. 开启兼容模式

在根目录 `.env` 中设置：

```env
SERVE_WEB_APP=true
```

### 2. 构建前端

```powershell
cd c:\Users\12051\Desktop\MES_fastapi\frontend
npm run build
```

构建产物输出到：

```text
frontend/dist
```

### 3. 启动后端

```powershell
conda activate fastapi
cd c:\Users\12051\Desktop\MES_fastapi
python scripts\run_local.py --reload --host 0.0.0.0 --port 8000
```

此时后端会从：

- `frontend/dist/index.html`
- `frontend/dist/assets/`

提供兼容页面与静态资源。

## 冒烟测试

可以使用下面的命令快速检查本地后端链路：

```powershell
conda activate fastapi
cd c:\Users\12051\Desktop\MES_fastapi
python scripts\trial_run.py
```

该脚本会自动完成：

- 启动后端
- 检查 `/health`
- 根据 `SERVE_WEB_APP` 判断 `/` 应该返回 `404` 还是前端页面
- 检查 `/auth/login`
- 检查 `/auth/session`
- 检查 `/auth/logout`

## 认证说明

### 登录方式

- 登录成功后，后端签发 `HttpOnly` Cookie
- 默认 Cookie 名称为 `mes_session`
- 前端通过 `/auth/session` 判断是否已登录
- 本地 `localStorage` 只保留界面缓存，不作为最终鉴权依据

### 会话规则

- 空闲超时默认 `30` 分钟
- 最大会话寿命默认 `8` 小时
- 当 `DEBUG=false` 时，Cookie 默认启用 `Secure`

## 前端页面边界

当前页面分为两类：

- Vue 原生页面：`/login`、`/task-overview`、`/process`、`/visualization`、`/staging-management`
- legacy 桥接页面：`/`、`/tasks`、`/schedule`、`/samples`、`/devices`、`/data`、`/system`

说明：

- Vue 侧 legacy 运行时已经迁入 `frontend/src/legacy/runtime/`
- 不再通过后端 `/static/js/main.js` 加载旧脚本

## 验证命令

### 后端测试

```powershell
.\.venv\Scripts\python.exe -m pytest -v
```

### 前端检查

```powershell
cd frontend
npm run lint
npm run test:run
npm run build
```

## 当前分离进度

已经完成：

- 前端构建输出迁移到 `frontend/dist`
- 前端样式入口迁回 `frontend/src/assets/`
- Vue 侧 legacy 运行时迁回前端目录
- 前端支持通过 `VITE_API_BASE_URL` 指向独立后端
- 后端默认改为 API-only
- 兼容托管前端改为显式开关 `SERVE_WEB_APP`
- 前端开发代理不再依赖后端 `/static`

当前仍保留：

- 兼容模式下的后端前端托管能力
- 部分 legacy 页面与桥接逻辑

这表示当前项目已经不再是“必须由后端包办前端页面”的一体化结构，但还保留了有限的兼容能力，方便逐步迁移。
