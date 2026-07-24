# 阶段四、阶段五重构交接文档

## 使用方式

在同一项目中打开新的聊天界面，发送：

> 请读取 `docs/refactor-stage4-stage5-handoff.md`，按照文档直接完成阶段四和阶段五。先检查当前工作区与智能体状态，不要重复或撤销已完成任务。

项目路径：`C:\Users\12051\Desktop\MES_fastapi`

## 当前基线

任务1～8已经完成。阶段二任务9～12应由执行它们的新对话完成后，再开始本文档任务；开始前必须检查工作区和实际测试结果，不能只依赖本文件的旧数字。

任务8验证基线：

- 前端：130个测试文件、1658项测试通过。
- 后端：664项测试通过。
- 前端 lint：通过。
- 前端生产构建：通过。
- `git diff --check`：通过。
- 非阻断提示：MQTT客户端旧回调API弃用警告、测试环境 `/api/mq/interface-mode` 相对URL提示、前端主JS约1,011 kB。

阶段四当前候选文件规模：

| 文件 | 当前行数 | 任务 |
|---|---:|---|
| `app/services/attendance_service.py` | 1355 | 任务15 |
| `app/api/routes/storage.py` | 1114 | 任务16 |
| `app/core/storage_backend.py` | 980 | 任务16 |
| `app/services/mq_event_processor.py` | 965 | 任务17 |
| `app/api/routes/laboratory.py` | 963 | 任务17 |
| `app/services/laboratory_completion.py` | 858 | 任务17 |

## 强制执行规则

1. 第一项操作调用 `list_agents`，关闭当前任务树中已完成的历史智能体。
2. 启动3个新智能体：
   - 智能体A：只读分析任务15～17的后端职责边界、API、事务和测试覆盖。
   - 智能体B：只读分析任务18的Vite分包、路由加载和构建基线。
   - 智能体C：独立行为一致性审核，只读，不得修改生产代码或验收测试。
3. 智能体C必须在第一次生产代码编辑前启动，最终返回明确的 `APPROVE` 或 `REJECT`。
4. 所有生产代码由主智能体使用 `apply_patch` 直接修改，后台智能体不得编辑文件。
5. 不得使用Node、Python或PowerShell脚本生成、切分或回写生产代码，确保完整差异显示在主线程编辑卡片中。
6. 修改前冻结确定性基线、关键文件哈希、公开API、HTTP响应和必要数据库快照。
7. 不删除、跳过、放宽或用实现细节替换已有回归断言。
8. 只在职责真正混杂时拆分，不能单纯为了降低行数机械拆分。
9. 不创建提交、不推送、不切换分支、不创建worktree。
10. 保留当前工作区所有未提交改动；无关文件不修改、不撤销、不纳入任务。
11. 严格遵守根目录 `AGENTS.md` 和 `C:\Users\12051\.codex\RTK.md`，所有shell命令使用 `rtk`。

## 并行工作安排

阶段四和阶段五按两条工作线推进：

| 工作线A：后端治理 | 工作线B：前端构建优化 |
|---|---|
| 任务15：考勤服务 | 任务18：路由懒加载与Vite分包 |
| 任务16：存储路由与后端 | 构建体积、加载行为和结构测试 |
| 任务17：MQTT与实验室后端 | 不改变任何业务页面行为 |

两条工作线可以并行分析、基线和专项验证；任务19最终集成必须等待任务15～18全部完成。任务20在最终集成通过后执行。

## 任务15：考勤服务治理

目标文件：`app/services/attendance_service.py`

先检查职责是否混杂，再按以下方向提取内部模块：

- 登录身份和密码/二维码认证。
- 实验室考勤会话读取与失效。
- 上班、工作开始、登出和持续时间计算。
- 考勤记录查询、统计和系统页面视图。
- 角色、实验室权限和中文错误信息。

必须保持：

- HTTP状态码和响应体完全一致。
- 用户名密码、二维码登录和错误提示一致。
- 登录、工作开始、登出业务时间一致。
- 并发、重复登录和会话覆盖规则一致。
- 账号 `321` 等既有登录回归场景继续通过。

专项测试：

```powershell
rtk proxy .\.venv\Scripts\python.exe -m pytest -q tests/api/test_attendance.py
```

若服务测试散落在其他测试文件中，使用 `rtk rg` 定位直接消费者并扩展专项，不新增无关全量运行。

## 任务16：存储路由与后端治理

目标文件：

- `app/api/routes/storage.py`
- `app/core/storage_backend.py`

优先边界：

- 路由参数和HTTP错误转换。
- 暂存、实验后暂存和外观检测房间动作。
- 入库、出库、厂家收回和目的实验室资格。
- 存储快照读取、替换、事件和事务编排。
- 内存后端与MySQL后端的共享契约。

必须保持：

- 托盘入库、出库、撤回和厂家收回行为。
- 部分轴向完成后的允许去向。
- 已排程实验室过滤和具体实验室锁定。
- 一个周期内外观检测间只能进入一次。
- 盐雾、霉菌、冲击、振动等历史缺陷回归场景。
- HTTP状态、响应体、数据库状态、事件和业务时间一致。

专项测试：

```powershell
rtk proxy .\.venv\Scripts\python.exe -m pytest -q tests/api/test_storage.py tests/services/test_storage_staging_policy.py tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py
```

## 任务17：MQTT与实验室后端治理

目标文件：

- `app/services/mq_event_processor.py`
- `app/api/routes/laboratory.py`
- `app/services/laboratory_completion.py`

优先边界：

- MQTT消息解析、标准化、幂等和错误处理。
- 实验室API参数和响应映射。
- 比对、安装、准备就绪、开始、完成和撤回服务。
- 部分轴向累计、最终完成整合和历史时间。
- 上位机事件与本地hostless模拟的设备接口边界。

强制保留：

- 除高低温湿热二室外，所有实验室使用MQTT。
- 高低温湿热二室没有上位机，只使用hostless本地模拟。
- MQTT和hostless复用完全相同的业务服务、状态转换和持久化规则。
- 只允许物理设备接口边界不同。
- 比对后排程删除锁定、部分轴向续做、撤回恢复、实验完成时间和跨页面展示一致。

专项测试：

```powershell
rtk proxy .\.venv\Scripts\python.exe -m pytest -q tests/api/test_laboratory.py tests/api/test_mq.py tests/services/test_laboratory_services.py
```

## 任务18：前端构建分包优化

目标：降低当前约1,011 kB的主JS包体，不改变页面行为或业务加载顺序。

优先措施：

- 检查路由级页面是否可以使用动态导入。
- 将低频可视化、数据管理和大型页面模块按路由拆包。
- 仅在收益明确时配置 `build.rollupOptions.output.manualChunks`。
- 保持共享状态、事件监听、MQTT模式同步和CSS加载完整。
- 不通过简单提高 `chunkSizeWarningLimit` 隐藏问题。

开始前记录：

- 当前入口JS文件大小和gzip大小。
- 当前chunk清单。
- 首屏和关键路由的加载方式。
- `src/lib/viteConfig.test.js` 和模块结构测试结果。

专项验证：

```powershell
rtk npm --prefix frontend run test:run -- src/lib/viteConfig.test.js src/modules/modules.structure.test.js src/App.runtime.test.js
rtk npm --prefix frontend run lint
rtk npm --prefix frontend run build
```

验收标准：

- 构建通过。
- 主入口包体有可量化下降，或提供证据说明进一步拆分会破坏当前架构/收益不足。
- 页面路由、样式、事件和API行为不变。
- 不引入循环依赖或重复打包关键业务模块。

## 阶段性汇报要求

每个任务完成后汇报：

- 修改和新增文件。
- 原文件与拆分后行数。
- 新模块职责和依赖方向。
- 红测证据与修复原因。
- 专项绿测命令及数量。
- HTTP、数据库、历史、时间或构建产物对比。
- 未解决风险。

不要在每个局部修改后运行全量测试；按风险从专项扩展到模块套件，只在任务19运行最终全量。

## 任务19：项目最终集成验收

任务15～18全部完成后执行。

前端全量：

```powershell
rtk npm --prefix frontend run test:run
```

前端 lint 与生产构建：

```powershell
rtk npm --prefix frontend run lint
rtk npm --prefix frontend run build
```

后端全量：

```powershell
rtk proxy .\.venv\Scripts\python.exe -m pytest -q
```

最终差异检查：

```powershell
rtk git diff --check
```

一致性复核必须覆盖：

- `frontend/src/modules/samples/trayFlowConsistency.test.js`
- 任务、排程、暂存、实验室、交接工作台相关测试。
- MQTT与高低温湿热二室hostless专项。
- HTTP状态和响应体。
- 数据库状态、实验运行、托盘关系和历史事件。
- 跨页面托盘状态、目标位置和业务时间。
- 公开API和兼容入口。
- 前后端模块循环依赖。
- 构建chunk及入口包体对比。

最终测试数量不得少于开始任务15前重新冻结的实际基线。若测试数量减少，必须解释并恢复被删除或遗漏的测试。

## 任务20：文档和最终报告

更新：

- `docs/code-directory.md`
- 本交接文档中的最终状态或新增独立验证报告。
- 新模块职责、依赖方向和兼容入口。
- 前后端全量测试命令和数量。
- 构建前后chunk大小。
- 独立行为一致性审核结论。
- 剩余非阻断技术债。

最终报告必须包含：

- 任务15～18各自结果。
- 行数和模块数量变化。
- 全量测试、lint、build和diff检查结果。
- 行为一致性审核智能体的命令、发现和明确 `APPROVE` 或 `REJECT`。
- 未提交、未推送声明。

只有任务15～20全部完成、最终验证通过且独立审核返回 `APPROVE`，阶段四和阶段五才算完成。

## 项目最终收口（阶段三后补）

实际执行顺序为阶段四/五先完成，阶段三任务13、14后补。原阶段四/五的前端130个文件1661项、后端670项结果保留为中间基线；下列阶段三之后的结果才是项目最终集成结果。

### 阶段三结果

- 任务13：过程页面从1308行降至152行，详情、托盘、完整清单和任务选择拆为独立展示组件；`useProcessLabs.js`从1156行降至335行，拆出主数据、排程选择、托盘/样品/启动条件投影和任务/卡片组合模块。兼容导出及全部ref/computed返回字段保持。
- 任务14A：`sampleFlow.trayFlowView.js`从1080行降至8行兼容门面；拆出657行多实验引擎、94行步骤/时间helper、139行单实验流程和223行部分/最终完成流程。
- 任务14B：`useDevicesPage.js`从1056行降至8行兼容门面；拆出592行页面引擎、94行维保规则、115行排程冲突投影、199行运行中维修投影和27行设备时钟。
- 结构测试只把源码读取范围扩展到新组件或引擎；原DOM、CSS、实时暂停/补刷断言均未删除、跳过或放宽。

阶段三开始前冻结四个目标文件SHA-256和19个文件416项确定性基线。任务13指定7个文件96项通过；任务14样品侧7个文件181项、设备侧4个文件61项通过。固定场景覆盖共享托盘、部分轴向、最终轴向折叠、比对/夹具时间恢复、外观周期、暂存/实验室/厂家收回、运行中维修两分支、MQTT实验室和高低温湿热二室hostless例外。

### 阶段三后最终验证

- 前端全量：`rtk npm --prefix frontend run test:run` → 130个测试文件、1661项测试通过。首轮仅 `industrialTheme.structure.test.js` 仍只读取旧 `page.vue` 而失败1项；保留原主题断言并扩展到新详情/托盘组件后，聚焦4项及全量全部通过。
- 后端全量：`rtk proxy .\.venv\Scripts\python.exe -m pytest -q` → 670项通过，保留1条Paho MQTT Callback API v1弃用警告。
- 前端静态检查：`rtk npm --prefix frontend run lint` → 通过。
- 前端生产构建：`rtk npm --prefix frontend run build` → 通过，357个模块完成转换，无超500 kB或循环依赖警告。
- 空白错误检查：`rtk git diff --check` → 通过。
- 构建仍为17个页面动态导入，未设置 `chunkSizeWarningLimit`，未配置业务目录 `manualChunks`。

最终入口 `index-B8EUPFbc.js` 为175.33 kB、gzip 63.72 kB；阶段五中间基线为175.33 kB、gzip 63.69 kB，原始体积无回升，gzip仅增加0.03 kB（约0.05%）。最大动态页面chunk仍为88.58 kB；二维码chunk仍为24.52 kB；全局入口CSS仍为250.34 kB。新增职责模块使转换模块数由335增至357，但没有造成入口或最大动态chunk异常增长。

### 独立行为一致性审核

审核代理在修改前冻结四目标哈希、19个文件416项基线及固定业务时间/标识，覆盖过程刷新门禁、托盘跨页状态/目标/时间、设备维修、MQTT与高低温湿热二室hostless例外。首次终审运行环境禁止了所有只读 `rtk` 命令，因此仅因无法取得独立执行证据返回技术性 `REJECT`；该次审核未发现代码问题，也未修改任何文件。

在启用命令访问并继续保持只读约束后重新执行终审。审核代理独立运行：

```powershell
rtk npm --prefix frontend run test:run -- src/modules/process/useProcessLabs.test.js src/modules/samples/trayFlowConsistency.test.js src/modules/devices/useDevicesPage.test.js src/modules/process/useProcessLabs.realtime.structure.test.js src/modules/devices/useDevicesPage.realtime.structure.test.js
```

结果为5个测试文件、95项测试全部通过；独立执行 `rtk git diff --check` 通过。最终差异检查确认兼容入口、参数、返回字段及ref/computed语义保持，新增模块依赖单向且无循环，结构测试仅聚合拆分后的源码、未删除或放宽原断言，17个页面动态导入和Vite配置未回退。除高低温湿热二室继续使用hostless本地模拟外，其余实验室保持MQTT模式。最终独立行为一致性结论：`APPROVE`。

本轮未创建commit、未push、未切换分支、未创建worktree；阶段四/五及此前任务的未提交改动均保留。
