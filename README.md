# MES FastAPI

本项目是一个基于 `FastAPI + Vue 3 + Vite` 的 MES 示例系统。

当前默认运行方式：

- 前端独立运行在 `http://127.0.0.1:5173/`
- 后端默认只提供 API，在 `http://127.0.0.1:8000/`
- 后端健康检查地址：`http://127.0.0.1:8000/health`

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
