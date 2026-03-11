# MES FastAPI 项目说明

本项目是一个基于 `FastAPI + Vue + Vite` 的 MES 示例系统，后端预留达梦数据库接入能力，前端同时包含 Vue 页面和部分 legacy 静态页面桥接。

## 一、主要模块

当前仓库包含以下业务模块：

- `person`
- `customer`
- `companydepartment`
- `permissions`
- `workflows`
- `technologies`
- `yt_file`
- `yt_timesheet`
- `yt_log`
- `warehouse`
- `productcatalog`
- `yt_report`
- `quality`
- `manufactureplan`
- `report`
- `device`
- `material`
- `yt_barcode`
- `yt_object`

其中上述模块当前已经接入统一 CRUD 路由工厂，接口形态一致。

## 二、接口概览

### 1. 通用 CRUD 接口

每个 CRUD 模块均提供：

- `GET /<module>`
- `GET /<module>/{id}`
- `POST /<module>`
- `PUT /<module>/{id}`
- `DELETE /<module>/{id}`

### 2. 特殊接口

- `POST /auth/login`
- `GET /auth/session`
- `POST /auth/logout`
- `GET /health`
- `GET /health/db`
- `GET /api/storage`
- `PUT /api/storage`

## 三、环境要求

- Python `3.10+`
- Node.js 与 `npm`
- 达梦客户端库
- `dmPython` 驱动

说明：

- 默认情况下，只有在你显式设置 `DEBUG=true` 时才会启用本地明文 HTTP 开发模式。
- `.env.example` 已经按本地开发场景给出了示例配置。

## 四、推荐部署前准备

### 1. 复制环境变量文件

```powershell
cd c:\Users\12051\Desktop\MES_fastapi
copy .env.example .env
```

### 2. 推荐至少填写以下配置

```env
DEBUG=true
DEMO_USER=local-admin
DEMO_PASSWORD=local-password
SESSION_SECRET_KEY=local-dev-secret
```

如果你使用上面的示例值，那么登录账号密码就是：

- 用户名：`admin`
- 密码：`123`

说明：

- 如果没有配置 `DEMO_USER` 或 `DEMO_PASSWORD`，登录接口会返回 `503`
- 如果没有配置 `SESSION_SECRET_KEY`，鉴权接口也会返回 `503`

## 五、后端启动命令

### 方式 1：使用 `conda run`

适合没有先手动激活 Conda 环境时使用。

```powershell
cd c:\Users\12051\Desktop\MES_fastapi
C:\ProgramData\anaconda3\Scripts\conda.exe run -n fastapi python -m pip install -r requirements.txt
C:\ProgramData\anaconda3\Scripts\conda.exe run -n fastapi python scripts\run_local.py --reload --host 0.0.0.0 --port 8000
```

### 方式 2：先激活 Conda 环境再启动

```powershell
conda activate fastapi
cd c:\Users\12051\Desktop\MES_fastapi
python -m pip install -r requirements.txt
python scripts\run_local.py --reload --host 0.0.0.0 --port 8000
```

后端启动后访问：

- 首页：`http://127.0.0.1:8000/`
- 健康检查：`http://127.0.0.1:8000/health`

## 六、前端启动命令

```powershell
cd c:\Users\12051\Desktop\MES_fastapi\frontend
npm install
npm run dev -- --host 0.0.0.0
```

前端开发地址：

- `http://127.0.0.1:5173/static/dist/index.html`

说明：

- 当前 Vite 开发服务已经代理 `/auth`、`/api`、`/static`
- 因此前端开发环境下也可以正常访问后端接口和 legacy 静态脚本

## 七、前后端联调命令

联调时需要同时开启两个终端。

### 终端 A：启动后端

```powershell
conda activate fastapi
cd c:\Users\12051\Desktop\MES_fastapi
python scripts\run_local.py --reload --host 0.0.0.0 --port 8000
```

### 终端 B：启动前端

```powershell
cd c:\Users\12051\Desktop\MES_fastapi\frontend
npm run dev -- --host 0.0.0.0
```

联调时访问：

- 前端：`http://127.0.0.1:5173/static/dist/index.html`
- 后端：`http://127.0.0.1:8000/`

## 八、一键后端冒烟测试

如果你只想快速验证后端链路是否正常，可以运行：

```powershell
conda activate fastapi
cd c:\Users\12051\Desktop\MES_fastapi
python scripts\trial_run.py
```

该脚本会自动完成：

- 启动后端
- 检查 `/health`
- 检查 `/`
- 检查 `/auth/login`
- 检查 `/auth/session`
- 检查 `/auth/logout`

## 九、前端与鉴权说明

### 1. 前端运行边界

当前页面分为两类：

- Vue 原生页面：`/login`、`/task-overview`、`/process`、`/visualization`、`/staging-management`
- legacy 桥接页面：`/`、`/tasks`、`/schedule`、`/samples`、`/devices`、`/data`、`/system`

### 2. 鉴权方式

- 登录成功后，后端会签发 `HttpOnly` Cookie
- 默认 Cookie 名称为 `mes_session`
- 前端通过 `/auth/session` 判断是否已登录
- 前端本地 `localStorage` 只保存界面缓存，不作为最终鉴权依据

### 3. 会话规则

- 空闲超时默认 `30` 分钟
- 最大会话寿命默认 `8` 小时
- 当 `DEBUG=false` 时，Cookie 默认启用 `Secure`

## 十、常用页面地址

- `http://127.0.0.1:8000/`
- `http://127.0.0.1:8000/tasks`
- `http://127.0.0.1:8000/schedule`
- `http://127.0.0.1:8000/samples`
- `http://127.0.0.1:8000/process`
- `http://127.0.0.1:8000/devices`
- `http://127.0.0.1:8000/data`
- `http://127.0.0.1:8000/system`

## 十一、验证命令

如果你修改了代码，建议至少执行以下检查：

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
