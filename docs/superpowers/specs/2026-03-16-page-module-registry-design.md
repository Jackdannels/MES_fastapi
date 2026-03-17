# 前后端按页面模块归档设计

**目标**

将当前前端 `pages/composables/lib/components/assets` 与后端 `app/api/routes` 的分散结构，重组为“按页面模块聚合”的目录方式。每个页面模块拥有自己的路由定义、页面实现、页面专属函数、页面专属样式和测试；前端 router、后端 API router、后端 SPA routes 改为统一从模块注册中心汇总。

**现状**

- 前端页面组件集中在 `frontend/src/pages/`。
- 页面逻辑和模型分散在 `frontend/src/composables/` 与 `frontend/src/lib/`。
- 页面专属组件仍散落在 `frontend/src/components/task-overview/`。
- 页面样式大多堆叠在 `frontend/src/assets/mes-app.css`。
- 后端 API 通过 `app/api/routes/__init__.py` 手工维护 `API_ROUTERS`。
- 后端 SPA routes 通过 `app/web/routes.py` 中的 `SPA_ROUTES` 常量维护。

**设计原则**

1. 页面拥有自己的实现边界。页面专属组件、组合函数、模型、测试和样式应优先归属于页面目录。
2. 共享层保持最小化。仅明确跨页面复用的内容保留在 shared/core 层。
3. 注册信息单一来源。前端路由、导航元信息、后端 API routers、后端 SPA routes 都从页面模块注册中心汇总，避免重复维护。
4. 不改业务行为。此次重组以结构重排和注册改造为主，尽量不改变已有交互逻辑。

**前端结构**

新增 `frontend/src/modules/`，每个页面一个目录，例如：

- `frontend/src/modules/dashboard/`
- `frontend/src/modules/task-overview/`
- `frontend/src/modules/tasks/`
- `frontend/src/modules/schedule/`
- `frontend/src/modules/samples/`
- `frontend/src/modules/process/`
- `frontend/src/modules/devices/`
- `frontend/src/modules/data/`
- `frontend/src/modules/system/`
- `frontend/src/modules/login/`
- `frontend/src/modules/visualization/`
- `frontend/src/modules/staging-management/`

每个模块包含：

- `page.vue`：页面根组件
- `index.js`：导出 `route`、导航元信息、可选的模块样式入口
- `composables/`：页面专属组合函数
- `models/`：页面专属模型和纯函数
- `components/`：页面专属组件
- `styles.css`：页面专属样式
- `*.test.js`：页面专属测试

共享层重组为：

- `frontend/src/shared/components/`
- `frontend/src/shared/composables/`
- `frontend/src/shared/lib/`
- `frontend/src/shared/styles/`

`frontend/src/modules/index.js` 维护显式模块清单。`frontend/src/router/index.js` 从该清单汇总路由。`frontend/src/App.vue` 从该清单读取导航和当前页面元信息。

**后端结构**

新增 `app/modules/`，以页面或页面域为单位组织模块。每个模块通过 `index.py` 导出：

- `api_routers`
- `spa_routes`
- `module_key`

示例目录：

- `app/modules/auth/`
- `app/modules/dashboard/`
- `app/modules/tasks/`
- `app/modules/samples/`
- `app/modules/process/`
- `app/modules/devices/`
- `app/modules/data/`
- `app/modules/system/`
- `app/modules/webshell/`

其中：

- `auth`、`health` 这类基础入口归属于明确模块。
- 现有 `app/api/routes/*.py` 中与页面绑定明显的路由迁移到对应模块目录，或通过模块 `index.py` 聚合导出。
- `app/modules/registry.py` 维护显式模块清单并提供 `get_api_routers()` 与 `get_spa_routes()`。

`app/main.py` 改为从模块 registry 汇总 API routers。`app/web/routes.py` 改为从模块 registry 汇总 SPA routes。

**样式策略**

- 保留 `frontend/src/assets/app.css` 作为前端样式入口。
- 将 `mes-app.css` 拆分为 `shared/base.css`、`shared/shell.css` 与页面级 `styles.css`。
- 只把明显页面专属的样式块迁入对应页面模块；通用布局、按钮、表格、卡片样式保留在 shared。

**测试策略**

- 前端新增模块 registry 结构测试，验证 router 不再直接逐页 import。
- 迁移页面 runtime/structure tests 到各自模块目录，并更新导入路径。
- 后端 router registry 测试改为验证 `app.modules.registry` 汇总结果。
- SPA routes 测试继续验证入口行为，但数据来源改为模块 registry。

**风险与控制**

- 风险：大规模路径迁移导致导入断裂。
  控制：先建立 registry 测试，再分批迁移页面模块。
- 风险：样式拆分引入渲染回归。
  控制：优先迁移带页面前缀的样式块，通用类暂留 shared。
- 风险：后端路由分组语义不清。
  控制：以“当前页面消费语义”为优先，而不是强行按数据库表拆分。

**验收标准**

- 前端页面、页面函数、页面专属组件、页面样式、页面测试均能在模块目录中找到。
- 前端 router 和 `App.vue` 基于模块 registry 汇总，而不是逐页手工 import。
- 后端 API router 和 SPA routes 基于模块 registry 汇总。
- 现有关键测试通过，页面打开不报错。
