# 当前项目旧接口与未使用能力审查

日期：2026-11-09（Asia/Shanghai）。源码基线：81c01be23ab4be1bf2bb73d8844d906de02e8aab，加工作区中已完成的 SHARED-RESET、STAB-SALT-02、STAB-SALT-03 修复和盐雾 abnormal 分支下线修改。

## 审查方式与结论

按用户要求启用 3 个 agent，分别审查 HTTP 业务接口、MQTT/上位机控制链、前端调用关系；主 agent 核对注册入口并验证生产配置下的旧 CRUD。审查当前源码和隔离内存请求，没有运行应用 lifespan，没有访问实际数据库、broker、设备或现场 HTTP 服务，没有修改生产代码。

“正常不使用”指本仓库当前页面、模拟器、后台 worker 的可追踪调用关系；未采集已部署系统流量，不能排除仓库外的旧客户端。无调用不等于必须删除，以下明确区分状态变更、只读闲置、已被守卫封死和正常联调入口。

确认仍有 **5 类有效遗留能力**；其中 4 类可改变实际业务流程/记录，1 类只修改无业务关联的旧内存占位数据。此外有 1 项只读闲置接口。

| 编号 | 当前有效但正常调用链不需要的用途 | 已核实的结果 | 建议 |
| --- | --- | --- | --- |
| L-01 | MQTT STARTED/ENDED 省略 run_no 的旧回退 | 旧任务无批次结束报文会被绑定到实验室当前新批次；内存复现调用结束 RUN-NEW | 现行协议要求批次编号；拒绝无编号开始/结束。若外部有旧设备，明确迁移后关闭兼容 |
| L-02 | payload.message_type/event 覆盖 MQTT Topic | 结果 Topic 带 EXPERIMENT_ENDED 字段会执行结束，而非保存结果 | Topic 决定事件；旧类型字段有冲突则拒绝，不能覆盖分派 |
| L-03 | 通用 PUT /api/storage 直接改样品/托盘实验终态 | HTTP 200；样品/托盘已完成，而运行批次仍进行中；没有共享 completion/MQTT 副作用 | 保留接口，禁止通用写入直接跨实验生命周期，收敛到专用命令和共享校验 |
| L-04 | 通用 storage 公共写入口接受后台专用集合 | 可直接覆盖或传 [] 清空 LIMS inbox/outbox/completions 和盐雾 pause；真实 MySQL pause replacer 空列表会整表删除 | 内部存储 key 与公共可写 key 分开；后台专用集合只允许服务端业务更新 |
| L-05 | 19 组旧通用 CRUD、95 个方法/路径组合 | prod 配置下仍可调用；仅写 InMemoryStore，与正式 MES 数据脱节 | 取消生产注册或明确开发隔离，避免客户端误认为写入真实业务 |

其中 L-01、L-03、L-04 应优先处理。L-02 也应明确协议分派规则。L-05 主要是接口清理和避免误接入，不能描述为已修改正式设备、权限或排程。

## 主 agent 对旧通用 CRUD 的核实

- 注册点：app/modules/registry.py 的 MODULES；app/main.py:97-98 无环境条件地注册 API_ROUTERS。
- 实现点：app/api/routes/crud_factory.py:7-40，InMemoryStore 定义于 app/core/store.py:7，注释明确为 dev-only storage。
- 共 19 组、每组 list/detail/create/update/delete 5 个路由，合计 95 个方法/路径组合：
  `/person`、`/customer`、`/companydepartment`、`/permissions`、`/workflows`、`/technologies`、`/yt_file`、`/yt_timesheet`、`/yt_log`、`/warehouse`、`/productcatalog`、`/yt_report`、`/quality`、`/manufactureplan`、`/report`、`/device`、`/material`、`/yt_barcode`、`/yt_object`。
- 当前前端、桌面工具和正式 worker 未找到调用；测试明确称其 placeholder routes。
- 隔离构造 create_app(Settings(APP_ENV='prod', DEBUG=False))，TestClient 不进入上下文、不启动 lifespan。对 `/device`、`/workflows`、`/permissions` 分别验证 GET 200、POST 201、PUT 200、detail GET 200、DELETE 204。每组测试后的内存列表恢复原值。
- 这些请求没有持久化到 MySQL；也没有正式业务校验。不能用 `/device` 的成功响应判断正式设备台账已修改，也不能用 `/permissions` 判断真实权限已更新。

## 只读闲置与不应误删项

- `GET /api/attendance/users` 仍有效，但当前人员页面使用 `/api/attendance/work-times`。这是低风险只读闲置，不是流程旁路；可先删除死客户端包装，后台是否下线需确认外部合同。
- `/api/laboratory/.../start`、`/complete`、`/axis-adjustment-ready` 代码仍在，但当前全部实验间的 start/end 必须 MQTT，hostless guard 返回 422。这些是可清理残留，并非目前有效的旧写入入口。
- `listLaboratoryTelemetry()` 是死包装；底层遥测读取 API 当前仍被可视化调用，不能一并删除。
- MQTT HTTP 事件注入在 prod 强制 404，非 prod 还需开关；前端模拟暂停按钮仅 DEV。属于受限联调入口。
- 高低温湿热二室 installation/fixture-ready 本地模拟是明确业务例外，必须保留；ready/start/end 仍为 MQTT。
- 任务重置、错误样品撤回派送、试验数据目录设置及导出等都有当前正常调用，不属于本次遗留发现。
- 盐雾 abnormal 执行分支已下线；历史异常终态保护只读，不是可重新创建旧流程的入口。
- 缺省 message_id 的生成仍被当前模拟器正常回传使用，不能当作无人使用的旧分支直接删除。
- 接口文档“结果缺 run_no 仍兼容”的文字已过时：当前 RESULT 实际强制 run_no。这是文档问题，不是仍有效的结果回退。

## 验证边界

- 主 agent：19/95 注册清点，3 组完整 prod 本地内存 CRUD 生命周期验证。
- MQTT agent：3 个内存事件分派复现，4 项已有定向回归通过。复现证明结束处理被调用，未声称已在真库结束现场实验。
- HTTP agent：FakeStorage + TestClient 复现样品/运行状态分裂、4 个后台集合直接覆盖和批量 [] 清空；真实 MySQL 落盘路径静态核对，未在现场数据库执行。
- 前端 agent：14 个 API 模块、76 个导出名称及直接请求/模拟分支核对；7 项接口边界回归通过。
- 本轮只读审查，没有改动产品实现，不需要重复完整前后端测试；临时脚本及中间报告清理后只保留本报告。

---

## 附录 A：HTTP agent 逐项证据

# HTTP 业务接口审查（只读，2026-11-09）

审查者：legacy_http_audit。未修改生产代码，未运行应用 lifespan，未连接实际数据库、MQTT 或设备。隔离检查使用现有 `tests/api/test_storage.py:11` 的 FakeStorage、FastAPI TestClient；只在当前 Python 进程内替换 storage getter 与更新通知。

## HTTP-01：通用快照接口仍接受绕过 MQTT 的实验终态修改

- 入口：`PUT /api/storage` 和 `PUT /api/storage/{key}`。这些接口本身仍在正常使用，问题是其接受的生命周期修改能力没有随专用实验流程收敛，不能整体删除接口。
- 证据：`app/api/routes/storage.py:1105`、`:1120` 允许所有 `STORAGE_KEYS`，请求类型为 Any / dict，无操作枚举与实验接口边界校验。`:751-805` 只验证部分排程、位置、实验顺序与维修规则；`:550` 对不属于 `LAB_SEQUENCE_CONTROLLED_STATUSES` 的下一状态直接跳过顺序验证。`:115-122` 的集合未包含“实验已完成”。
- 当前正常完成链：`frontend/src/modules/laboratory/useLaboratoryCompletionFlow.js:88-109` 经 `requestMqttExperimentEnd` 请求设备确认；`frontend/src/lib/labHostInterfaceCapabilities.js:14-15` 所有实验间的实验开始/结束固定 MQTT。旧 `/complete` 本地入口在 `app/api/routes/laboratory.py:1027` 由 hostless guard 拦截；通用快照写入未复用该边界与共享 completion 服务。
- 隔离复现：FakeStorage 中 T/E/R 的盐雾样品和托盘处于“实验进行中”；仅通过 `PUT /api/storage` 提交 `mes.samples`，把样品 status、flow_status 和托盘 status 改成“实验已完成”。响应 **200 {ok:true}**；保存后样品/托盘为 **实验已完成**，`mes.experiment_runs` 仍为 **实验进行中**。
- 正常 UI 不走这一用途：实验结束页面走上面的 MQTT 链。通用接口目前用于样品维护、排程和配置等，不能把“路由有正常调用者”误解为“任意实验终态修改用途都有正常调用者”。
- 生产可达：注册过程 `app/main.py:97-98` 不按环境区分；storage 路由无 dev-only 开关。MySQL `app/core/mysql_storage_backend.py:563-567` 真实落盘 samples，`:793-806` 允许这些 key；`app/core/mysql_storage_status_sql.py:273-363` 同步的是 experiment/schedule/task 进度，不会把 sample 状态还原成运行状态。因此非 Fake 专属拒绝缺失。实际生产库未执行复现。
- 后果：直接调用、遗留客户端或脚本可使托盘/样品与 run/排程不一致，同时不执行正常 completion 的时间、报告、LIMS 等副作用。
- 建议：**收敛用途**。保留正常快照写入，对实验开始/暂停/继续/完成/取消等受管字段使用共享 transition 校验，拒绝通用写入直接跨生命周期；相关专用命令继续处理跨表业务副作用。不要删除所有 `mes.samples` 写能力，因为当前页面仍使用。
- 置信度：高（HTTP 接受与分裂状态已隔离实证；MySQL 写入路径静态确认）。归类为通用旧能力残留，不能声称已证明某一具体发布版本的历史切换点。

## HTTP-02：后台专用集合被通用 HTTP 写白名单公开，可整批覆盖/清空

- 入口：同上两个 PUT 路由；参数 key：`mes.lims_inbox`、`mes.lims_outbox`、`mes.lims_completions`、`mes.experiment_run_pauses`。
- 证据：`app/core/storage_contract.py:12-34` 同时承担内部存储 key 列表与公共写白名单。`app/api/routes/storage.py:1107-1115` / `:1127-1135` 只按该列表过滤，并不区分只读、服务端私有或页面可写。`:770-771` 不含 samples 的 payload 会跳过后续样品业务校验。`app/services/storage_atomic.py:314-323` 不对上述四类集合做 keyed merge，因此 `[]` 可清空。
- 这些是当前后台流程，并非后台存储本身无用：`app/services/external_task_intake_service.py:33-34` 管理 external intake/inbox；`app/services/lims_http.py:3-4` 明确 outbox 由业务服务随事务追加，`:83-114` 后台读取与标记发送结果；`app/services/lims_completion_model.py:14` 是完成意图集合；pause 由盐雾 MQTT/服务流程管理。
- 正常调用者：前端未发现这些集合的公开写用途。前端只读取 pause，`frontend/src/lib/storageKeys.js:7` 及 laboratory/samples/visualization 使用该只读快照。task-overview 的删除兼容写入 `frontend/src/modules/task-overview/useTaskOverviewEditor.js:594-604` 涵盖 runs/run_trays/run_steps，但**不含 pause 或三类 LIMS key**。因此此结论不是仅查不到一段 URL 字符串，而是比对了 storage helper、persistSnapshot 调用与对应写入对象。
- 隔离复现 A：逐个 `PUT /api/storage/{key}` 传任意数组，四类均 **200** 并保存。
- 隔离复现 B：上述四类各预置 1 行，`PUT /api/storage` 一次提交四个 `[]`，返回 **200 {ok:true}**，四类剩余行数均 **0**。
- 生产持久化：`app/core/mysql_storage_backend.py:176-185` 三类 LIMS 为 snapshot storage，`:592-603` 直接写快照表；`:576-577` pause 进入真实关系表替换；`app/core/mysql_storage_replacers.py:517-525` 明确先执行无 WHERE 的 `DELETE FROM biz_experiment_run_pause`，传空数组就直接返回，因此 pause 清空风险并非仅 Fake 行为；`:793-806` 并无公共调用来源限制。
- 后果：遗留全量快照脚本或手工调用可抹掉盐雾暂停证据、LIMS 待发送事件或幂等/完成记录，导致恢复流程与通讯记录不一致。调用者需显式提交这些 key；正常页面按钮当前未发现会提交，因此不应说普通操作必然触发。
- 建议：**禁用这些 key 的公共写用途**，把内部 STORAGE_KEYS 和 PUBLIC_WRITABLE_STORAGE_KEYS 分开。保留后台服务直接写 storage 的能力；如需维护工具，使用有独立授权和校验的维护命令。
- 置信度：高（HTTP与内存数据清空已复现；MySQL落盘静态确认；外部未知客户端未采集流量，无法证明其绝不存在）。

## 已核实应排除的误报

- `/api/laboratory/.../start`、`/complete`、`/axis-adjustment-ready`：仍注册，但所有实验间 start/end 均 MQTT，`app/core/master_data.py:64-74` + `require_laboratory_interface:77-89` 对这些 hostless 操作拒绝。属于已封死残留，不是目前有效的旧流程入口。高低温湿热二室仅 installation/fixtureReady 的本地例外保持有效且正常使用。
- `fixtureReady` HTTP operation：二室是明确保留规则，`frontend/src/modules/laboratory/useLaboratoryOperationPersistence.js:217-236` 有实际调用，不应删除。
- 任务 reset：`frontend/src/App.vue:60-66` 通过 `showTaskResetAction`（`:235`，中控 tasks 页）可见，`useTasksPage.js:821` 实际调用 `POST /api/tasks/reset`。是当前功能，不属于 UI 已停用的旧接口（其权限风险是另一个议题）。
- `withdraw-dispatch`：`frontend/src/composables/useTrayErrorSampleHandling.js:29/41` 有生产调用，仍是全局错误样品处理功能。
- test_data `/settings`、`/select-directory`、`/exports`、`/retry-failed`：`frontend/src/modules/data/useDataPage.js:93/154/196/214` 实际使用；目录选择还有 `app/api/routes/test_data.py:245-259` loopback 限制。
- `GET /api/storage/{key}`：除测试外 `scripts/run_p0_mixed_baseline.py:54` 仍读 `/api/storage/mes.streams`，可作为诊断合同保留；不要与应收敛的公共写能力一起删除。
- 通用 InMemory CRUD 19 组 95 路由由 root 负责报告与 prod 隔离验证，本报告不重复。
- 本次未重复报告已删除的盐雾 abnormal stop 执行分支。

## 核查范围和限制

核查 laboratory/tasks/storage/transfer-area/test-data 等 HTTP route、前端 API helper 与 composable/模块调用、storage backend 落盘路径和 MQTT 完成边界。只读审查不需要全量测试。未采集真实生产访问日志，也未访问真实库；“正常项目不使用”指仓库内当前生产调用链，无法排除未纳入仓库的外部脚本。


---

## 附录 B：MQTT agent 逐项证据

# MQTT / 上位机链审查（只读，2026-11-09）

## 结论

当前命令表没有发现已移除 UI 但仍可用的盐雾 abnormal 同类命令；不过接收端仍有 **2 组旧协议活动兼容分支**，当前正常前端和模拟器不需要它们，生产 MQTT 仍会接受并可触发业务状态变更。

所有复现均使用内存仓储替身，未连接 MySQL、broker 或设备，未修改生产文件。替身复现验证接收端分派和状态变更调用，实际托盘持久化影响由所调用的现有共享服务决定。

## MQ-LEGACY-01：缺 run_no 的开始/结束报文仍能创建或完成当前批次

- 分类：旧协议活动兼容；高优先级，代码判断与隔离分派复现均高置信度。
- `app/services/mq_event_processor.py:1337` 读取 run_no，但仅 RESULT 在 `1343-1344` 强制必填。
- 结束事件 `1346-1347` 在没有 run_no 时调用 `find_active_run_by_lab(lab_code)`；生产 SQL `387-425` 从当前物理驻留实验室的活跃批次选一条，包含准备、运行、暂停并以运行/暂停优先。随后 `1442-1458` 使用该批次拥有的任务/实验作为权威上下文，最后 `1508-1511` 执行 `mark_run_ended`。
- 开始事件 `1354`、`1372-1375` 缺 run_no 时仍按实验室当前 READY 上下文创建运行；真实仓储 `1009` 会生成新 run_no，而非强制回传 MES 已下发的 run_no。
- 现行正常链：`app/api/routes/mq.py:530` READY 总是带 run_no；`frontend/src/modules/laboratory/useLaboratoryCompletionFlow.js:89-96` 结束命令带 runningRunNo；模拟器 `tools/upper_computer_simulator/app.py:617-619` 阻止缺 lab/run 的结束，`728-752` 回传 READY 的 run_no。
- 文档 `MES与上位机MQTT接口定义V2.0.md:130,296,327` 要求原样回传 run_no；`401` 明确说明结束的缺 run_no 只是旧协议兼容。
- 触发：旧上位机、旧脚本或人工报文只带 lab_code，尤其前一批次的迟到普通结束发生在新批次运行期间。缺 run_no 的结束不会先解析旧任务，而是直接选新批次。若新批次没有待确认取消等阻断条件，就会被正常完成；轴向运行另要求 axis_code。
- 生产范围：`app/services/mq_subscriber.py:49-66` 订阅 `labs/+/events/#` 并直接交给同一处理器，没有 prod 特殊屏蔽。HTTP 注入入口是否开放与该 MQTT 路径无关。
- 内存复现 1：新批次 `RUN-NEW/TASK-NEW` 正在盐雾室；发送旧任务 `TASK-OLD/EXP-OLD` 的普通 ENDED 且不带 run_no，返回 PROCESSED，执行 `ended=[('RUN-NEW',...)]`，消息绑定 TASK-NEW。
- 内存复现 2：有当前 READY 上下文；STARTED 不带 run_no，返回 PROCESSED，调用创建运行，替身返回 `RUN-CREATED-FROM-LAB`。真实实现生成新编号（1009）。
- 建议：开始、结束统一要求 run_no；开始应核对 MES READY 下发的运行身份；拒绝旧无 run_no 事件，不删除正常开始/结束事件本身。若外部上位机仍部署旧协议需做明确迁移，但本仓库现行正常链不依赖该兼容。

## MQ-LEGACY-02：payload.message_type / event 仍可覆盖 Topic 事件类型

- 分类：旧 payload 活动兼容；中优先级，代码与隔离分派复现高置信度。
- `app/services/mq_event_processor.py:1286` 优先取 payload 的 message_type 或 event，只有两者为空才按 Topic 推断。`1287` 仅检查最终事件是否受支持，不核对 Topic 与字段一致。
- 当前合同：`MES与上位机MQTT接口定义V2.0.md:63` 明确事件类型由 Topic 决定、不再额外传 payload 类型；仓库模拟器正常 `publish()`（`tools/upper_computer_simulator/app.py:788-808`）按 event_name 构建 Topic，没有主动写入这两个旧字段。
- 触发：旧报文封装/旧客户端保留 event 或 message_type，且与实际 Topic 不一致。当前 UI 的正常流程本身不会构造这种报文。
- 内存复现：在 `.../events/experiment-result` Topic 发送有效 run_no，并附 `message_type='EXPERIMENT_ENDED'`，不传 result_package。处理器返回 PROCESSED、执行 mark_run_ended、没有写结果。也即结果 Topic 可以被当作结束处理。
- 生产范围：正常 MQTT subscriber 直接使用同一处理器且订阅 events/#；没有环境限制。
- 建议：Topic 为唯一事件类型；若保留这两个字段用于旧报文观测，则遇到与 Topic 不一致直接拒绝并记录，不能覆盖业务分派。不需要新增通讯字节。

## 已排除，不应误删

1. `/api/mq/laboratory/events/{event_name}`：`app/api/routes/mq.py:743-744` 在 prod 无条件 404，非 prod 还要求 MQTT_HTTP_EVENT_INGRESS_ENABLED；前端 `useSaltSprayPauseFlow.js:206-218` 仅 DEV 显示模拟暂停确认。属于有效联调功能。
2. `/api/mq/interface-mode`：并非孤立老 API。`frontend/src/modules/login/useLoginForm.js:23` 和 `laboratoryDeviceInterface.js:30` 正常调用；后端 `mq_runtime.py:11,42-43` 仅允许 mqtt，旧 legacy/local 模式已拒绝。
3. 高低温湿热二室：`app/core/master_data.py:67-74` 仅 sample_install、fixture_ready 使用 hostless；其余操作 MQTT，未发现扩大例外。
4. 盐雾 abnormal：公开模型、publisher 和 STOPPED 接收/仓储都检查 completion_criteria；保留的 LEGACY_ABNORMAL_TERMINATION_STATUS 仅用于拒绝改写历史终态。未发现可重新创建 abnormal 流程的活动命令。
5. RESULT 缺 run_no 的旧回退已关闭（processor 1343-1344）。接口文档 `404` 仍声称历史结果兼容/风险日志，与当前实现不符，是文档陈旧，不是活动旧接口。
6. message_id 缺省生成不能认定“正常流程不用”：模拟器当前 fixture/start/end 普通回传仍省略 message_id，正常依赖后端生成 ID。若后续改变需同步模拟器，不应当作孤立遗留代码删掉。
7. CamelCase 字段别名没有额外业务路径，仅等价解析；未发现需要按本次范围移除的状态转换分支。

## 验证

- 3 个独立 Python 内存复现：无 run 结束错绑、无 run 开始创建、旧 payload 类型覆盖 Topic，全部确认入口仍有效。
- 已有针对性测试：`tests/api/test_mq.py` 选择当前 READY 无 run 开始、非盐雾无 run 开始、按实验室选择活跃运行、开始/结束考勤四场景：**4 passed，103 deselected**。
- 没有执行全量套件，没有生成测试 JSON，没有变更生产代码。


---

## 附录 C：前端 agent 逐项证据

# Frontend → backend legacy interface audit

Date: 2026-11-09. Read-only source review, plus existing isolated API regressions. No database, MQTT, equipment, production source changes, or per-case JSON.

## Scope and result

- Inspected production JS/Vue caller references for 76 exported names across 14 `*Api.js` modules, and direct `fetch`, snapshot writes, local-storage writes, simulator and hostless branches.
- Found **one active read-only route with no current frontend caller**: `GET /api/attendance/users`.
- Found **no additional confirmed active unused write route from the frontend branch analysis**. Three old laboratory write routes remain registered but their physical-interface guard rejects current lab start/end requests; these are dead API/client residues, not an effective MQTT bypass.
- No conclusion is based on lack of frontend references alone: protected/development/historical paths are separated below.

## F-01 — unused employee-list read endpoint (low risk, high confidence)

- Endpoint remains functional: `app/api/routes/attendance.py:123` `GET /api/attendance/users`; handler calls `get_attendance_service().list_users()` at line 126.
- Client wrapper: `frontend/src/lib/attendanceApi.js:116` `listAttendanceUsers()`, exported line 189. No production JS/Vue caller anywhere in `frontend/src`; repository references outside this module are tests and historical design docs.
- Normal system-page employee list uses `loadEmployees()` at `frontend/src/modules/system/useSystemPage.js:199`, calling `listAttendanceWorkTimes()` at line 201. It maps returned account/work-time rows into the employee table, rather than using `/users`.
- Trigger: an authenticated API consumer calls `GET /api/attendance/users` directly. It remains a read-only account-list route and does not advance task/tray/laboratory workflows.
- Recommendation: optionally remove the unused frontend wrapper. Backend route can be retired after confirming no external client contract; otherwise keep as documented read API. This is not the same class of state-changing stale branch as the retired salt abnormal stop.

## F-02 — three registered local experiment routes are currently rejected (cleanup candidate, not active defect)

- Old client exports `startLaboratoryExperiment` (`frontend/src/lib/laboratoryApi.js:126`) and `markLaboratoryAxisAdjustmentReady` (line 187) have no production imports or calls.
- `completeLaboratoryExperiment` (line 228) is imported by `frontend/src/modules/laboratory/useLaboratoryOperationPersistence.js:3` and used in `persistRunningExperimentCompletion()` (line 155). It is only reached by the local fallback in `useLaboratoryCompletionFlow.js:111` after `usesMqttCompletion()` is false at line 88.
- Current `frontend/src/lib/hostInterfaceMode.js:7` and line 9 force MQTT. `frontend/src/lib/labHostInterfaceCapabilities.js:14` and line 15 set experiment end/start to MQTT for every lab. `useLaboratoryPage.js:576` computes `usesMqttCompletion` from those values, so normal pages do not enter the local completion fallback.
- Corresponding registered backend routes:
  - `/api/laboratory/tasks/{task}/experiments/{experiment}/axis-adjustment-ready`: `app/api/routes/laboratory.py:839`, hostless start guard line 849.
  - `.../start`: line 890, hostless start guard line 907.
  - `.../complete`: line 1015, hostless end guard line 1027.
- Shared boundary `app/core/master_data.py:52` `laboratory_interface_for_operation()` returns hostless only for high/low-temperature humid lab 2 sample installation and fixture-ready (lines 67–71), with all start/end returning MQTT (line 74). Thus these routes reject with 422 before mutation for current labs.
- A separate unreachable local fixture countdown fallback exists at `useLaboratoryFixtureConfirmation.js:104–105`; current MQTT branch returns at line 102. The allowed real hostless fixture-ready timer is separate at line 118 and remains necessary.
- Recommendation: optional client/fallback/route cleanup for clarity; preserve the shared workflow services and current fixture-ready exception. Do not report these as still-effective public write bypasses.

## F-03 — dead telemetry wrapper, live telemetry API (cleanup only)

- `frontend/src/lib/laboratoryTelemetryApi.js:18` `listLaboratoryTelemetry()` has no production caller.
- It wraps `readLaboratoryTelemetrySnapshot()` at line 5, which remains used by `frontend/src/modules/visualization/page.vue` for normal telemetry.
- Therefore only the dead wrapper is a cleanup candidate; `GET /api/telemetry/laboratories` must remain.

## Protected current development/simulation paths (do not misclassify)

- Salt pause simulation: `frontend/src/modules/laboratory/useSaltSprayPauseFlow.js:205` requires `import.meta.env.DEV`, salt lab, an outstanding pause request and its returned `pauseNo`. Handler at line 210 checks that capability again before POSTing `/api/mq/laboratory/events/experiment-paused` (line 218). Production builds cannot enable it through a hidden normal button handler alone. Backend dev ingress policy is reviewed by the MQTT agent.
- Hostless fixture simulation: `useLaboratoryPage.js:1240` selects it only through `isHostlessFixtureLab()`; `useLaboratoryFixtureConfirmation.js:118` rechecks `fixtureReadyInterface === "hostless"` before the timer. This is the deliberate high/low-temperature humid lab 2 fixture exception.
- Generic `PUT /api/storage` is **still used** by normal pages through `useStorageSnapshot.js` and staging layout persistence. It cannot be called unused simply because dedicated workflow endpoints also exist; backend key-level exposure is assigned to the HTTP audit agent.
- Browser localStorage writes in reviewed workflow modules are selected lab, presentation settings, auth/cache notifications; no experiment-start/end localStorage state bypass was found.

## Isolated verification

Command:

```powershell
rtk proxy .venv/Scripts/python.exe -m pytest -q tests/api/test_laboratory.py -k "rejects_hot_humid_second_lab_now_using_mqtt or rejects_mqtt_laboratory_hostless_endpoint or rejects_non_hostless_laboratory_before_shared_service or local_axis_adjustment_and_start_endpoints_reject_hot_humid_second_lab or fixture_ready_operation_rejects_non_hostless_laboratory or hostless_fixture_ready_operation_still_calls_shared_service"
```

Result: **7 passed, 60 deselected in 0.12 s**. Covers rejection of local start/end/axis routes, rejection of nonexception local fixture-ready, and preservation of the allowed shared-service fixture-ready behavior.
