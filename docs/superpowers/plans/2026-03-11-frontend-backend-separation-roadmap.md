# Frontend Backend Separation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保持同一台 PC 可部署的前提下，把当前一体化 `FastAPI + Vue` 工程迁移为“前端独立部署、后端只提供 API”的完全分离形态。

**Architecture:** 前端保留在 `frontend/` 内独立构建和部署，后端保留在 `app/` 内只提供 API 与认证能力。迁移顺序采用“先去除构建耦合，再去除静态资源耦合，最后移除 SPA 托管”的低风险路径，确保每一步都可回滚、可验证。

**Tech Stack:** Vue 3, Vite, FastAPI, Vitest, Python, dotenv

---

## Chunk 1: 解除构建产物耦合

### Task 1: 让前端产物输出到前端目录

**Files:**
- Modify: `frontend/vite.config.js`
- Modify: `README.md`

- [ ] **Step 1: 修改前端构建目录**
- [ ] **Step 2: 将 `outDir` 从 `../app/static/dist` 改为 `dist` 或类似前端私有目录**
- [ ] **Step 3: 调整 README，区分“前端独立构建”和“后端 API 启动”**
- [ ] **Step 4: 运行 `cd frontend && npm run build`**
- [ ] **Step 5: 确认前端构建不再写入 `app/static/dist`**

### Task 2: 去掉依赖后端路径的前端 base 假设

**Files:**
- Modify: `frontend/vite.config.js`
- Modify: `frontend/src/lib/devServerProxy.js`
- Test: `frontend/src/lib/devServerProxy.test.js`

- [ ] **Step 1: 写失败测试，固定 dev/prod 下的资源路径行为**
- [ ] **Step 2: 跑 `cd frontend && npm run test:run -- src/lib/devServerProxy.test.js` 确认红灯**
- [ ] **Step 3: 调整 `base`，避免写死 `/static/dist/`**
- [ ] **Step 4: 跑测试确认转绿**
- [ ] **Step 5: 重新运行 `cd frontend && npm run build`**

---

## Chunk 2: 解除静态资源与样式耦合

### Task 3: 把前端样式迁回 `frontend`

**Files:**
- Modify: `frontend/src/assets/app.css`
- Create/Modify: `frontend/src/assets/*.css`
- Possibly Modify: `app/static/app.css`

- [ ] **Step 1: 识别前端当前依赖的后端样式片段**
- [ ] **Step 2: 把前端实际使用的样式复制或拆分到 `frontend/src/assets/`**
- [ ] **Step 3: 移除 `@import "../../../app/static/app.css"` 这类跨目录依赖**
- [ ] **Step 4: 运行 `cd frontend && npm run build`**
- [ ] **Step 5: 运行 `cd frontend && npm run lint`**

### Task 4: 明确 legacy 静态资源去向

**Files:**
- Modify: `frontend/src/lib/devServerProxy.js`
- Modify: `app/static/js/main.js`
- Modify: `frontend/src/legacy/*`
- Test: `frontend/src/legacy/legacyMainBoot.test.js`

- [ ] **Step 1: 盘点哪些页面仍依赖 `app/static/js/*`**
- [ ] **Step 2: 决定是迁入 `frontend` 还是彻底淘汰**
- [ ] **Step 3: 对保留部分建立明确加载边界**
- [ ] **Step 4: 跑 `cd frontend && npm run test:run -- src/legacy/legacyMainBoot.test.js`**
- [ ] **Step 5: 确认前端即使独立部署也能拿到必要资源**

---

## Chunk 3: 让后端只保留 API 职责

### Task 5: 移除后端 SPA 托管路径

**Files:**
- Modify: `app/web/routes.py`
- Modify: `app/main.py`
- Test: `tests/web/test_spa_routes.py`
- Modify: `README.md`

- [ ] **Step 1: 写失败测试，明确后端未来不再承担 SPA 页面返回**
- [ ] **Step 2: 跑 `python -m pytest tests/web/test_spa_routes.py -v` 确认红灯**
- [ ] **Step 3: 移除或隔离 SPA 回退路由**
- [ ] **Step 4: 保留纯 API 与必要静态文件职责**
- [ ] **Step 5: 跑测试确认后端只保留 API 行为**

### Task 6: 用环境变量统一前端 API 地址

**Files:**
- Modify: `frontend/src/auth.js`
- Modify: `frontend/src/lib/storageApi.js`
- Modify: `frontend/src/lib/devServerProxy.js`
- Create/Modify: `frontend/.env.example`
- Modify: `README.md`

- [ ] **Step 1: 抽出前端 API 基地址配置**
- [ ] **Step 2: 让 dev/prod 都通过环境变量指向后端**
- [ ] **Step 3: 更新登录、存储、session 校验等请求入口**
- [ ] **Step 4: 跑 `cd frontend && npm run test:run`**
- [ ] **Step 5: 用本机 `5173 -> 8000` 联调确认正常**

---

## Chunk 4: 部署与交付收口

### Task 7: 提供分离后的本机部署说明

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Create/Modify: `frontend/.env.example`

- [ ] **Step 1: 补齐“同一台 PC、两个独立服务”的启动说明**
- [ ] **Step 2: 明确前端访问地址与后端 API 地址**
- [ ] **Step 3: 明确 CORS、cookie、代理的配置方式**
- [ ] **Step 4: 写清开发环境和生产环境的差异**
- [ ] **Step 5: 人工按 README 走一遍启动流程**

### Task 8: 做最终回归验证

**Files:**
- Verify only

- [ ] **Step 1: 运行 `cd frontend && npm run lint`**
- [ ] **Step 2: 运行 `cd frontend && npm run test:run`**
- [ ] **Step 3: 运行 `cd frontend && npm run build`**
- [ ] **Step 4: 运行 `python -m pytest -v`**
- [ ] **Step 5: 人工验证登录、试验过程、任务总览、登出链路**
