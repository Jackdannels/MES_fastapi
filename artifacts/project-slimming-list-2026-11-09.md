# 当前版本项目瘦身清单

日期：2026-11-09。依据当前源码及三 agent 接口审查，只考虑本版本实际页面、后台任务、上位机模拟器和 MQTT 合同，不为旧版本或旧客户端保留执行路径。用户确认后已实施 S-01 至 S-08，执行范围和验证记录见下文。

## 执行结果

| 项目 | 已实施内容 |
| --- | --- |
| S-01 | 删除 19 组占位 CRUD、独占工厂/内存存储/模型，共 22 个生产源文件、95 个方法/路径组合；保留 SPA 模块和正式业务路由。 |
| S-02 | 删除 3 个本地启动/完成/轴向就绪路由及专用请求模型、辅助函数和前端包装。 |
| S-03 | 删除不可达的本地完成与通用夹具成功回退；保留二室独立本地夹具模拟，ready/start/end 均走 MQTT。 |
| S-04 | 删除闲置考勤 GET 和 2 个只读死包装；保留工时、人员维护、遥测快照和可视化读取。 |
| S-05 | 开始/结束/结果及盐雾暂停、恢复、停止确认必须带现有 run_no；删除按实验室回退选择运行的专用查询。 |
| S-06 | 事件统一按 Topic 分派，payload 类型冲突即拒绝；无需新增 MQTT 字段或握手。 |
| S-07 | 通用 storage 禁止直接推进实验状态、改夹具确认标记或伪造/覆盖运行事实；正常信息维护与专用业务入口保留。 |
| S-08 | 四类后台专用集合禁止公共单键或批量写入，混合批次原子拒绝；内部存储和后台处理保留。 |

合计移除 **99 个 HTTP 方法/路径组合**（95 个占位 CRUD + 3 个本地实验写入 + 1 个闲置读取）。同步清理功能专用测试并补充当前合同回归；没有删除数据库表或业务数据，没有新增通讯字节，也没有提交 Git 或部署。

### 验证范围

- 当前合同回归：拒绝缺失批次身份、Topic/payload 类型冲突、公共生命周期改写、后台集合覆盖及运行事实伪造；验证正常备注/设备保存和原样回传运行快照仍成功。
- 故障恢复回归：取消后的托盘经过真实专用入库、出库和下一实验比对接口，验证能继续正常流转；通用 storage 直接改成比对成功被拒绝。
- MQTT、盐雾暂停恢复、霉菌取消、排程、任务维护和二室夹具例外由完整套件覆盖。
- 使用隔离仓储、模拟器和测试替身验证；未连接真实设备执行现场验收。
- 本轮临时修改脚本已清理，未生成逐轮测试 JSON。

### 验证结果

| 检查 | 结果 |
| --- | --- |
| 后端完整 pytest | 1776 项通过、8 项跳过、0 失败（320.59 秒） |
| 前端完整 Vitest | 193 个测试文件、2363 项测试全部通过 |
| 前端 ESLint | 通过 |
| 前端 Vite 生产构建 | 通过 |
| Git diff 空白检查 | 通过 |
| 已删除符号引用扫描 | app / tests / frontend/src 中无残留导入或调用 |

后端首轮发现 6 项人员测试依赖已移除的闲置 GET，以及 1 项托盘测试依赖直接写实验状态。均已迁移到本版本入口，其定向回归全部通过；未通过恢复旧接口或放宽状态约束消除失败。

以下保留原方案的实施依据；其中“可删除”“应收紧”的项目均已按上表落地。

## 一、可以成组删除的代码

### S-01：19 组内存占位 CRUD

正常页面、桌面工具和后台任务均不依赖。这些接口只操作 InMemoryStore，与正式 MES 台账、权限、样品、排程和报告无关联。

可删除以下 app/api/routes 下的 19 个文件及其注册：

| 文件 | 路由前缀 |
| --- | --- |
| person.py | /person |
| customer.py | /customer |
| companydepartment.py | /companydepartment |
| permissions.py | /permissions |
| workflows.py | /workflows |
| technologies.py | /technologies |
| yt_file.py | /yt_file |
| yt_timesheet.py | /yt_timesheet |
| yt_log.py | /yt_log |
| warehouse.py | /warehouse |
| productcatalog.py | /productcatalog |
| yt_report.py | /yt_report |
| quality.py | /quality |
| manufactureplan.py | /manufactureplan |
| report.py | /report |
| device.py | /device |
| material.py | /material |
| yt_barcode.py | /yt_barcode |
| yt_object.py | /yt_object |

合计减少 95 个方法/路径组合。同步修改 app/modules/registry.py 的 imports 和 api_routers，保留实际 SPA 页面注册。

仅由上述 CRUD 使用的支撑代码也可一起删除：

- app/api/routes/crud_factory.py
- app/core/store.py
- app/schemas/common.py（仅 EntityCreate / EntityUpdate / EntityOut 占位模型）

共涉及 22 个独立生产源文件。tests/api/test_crud_factory.py 是相应专用测试，可随被删功能删除；test_module_registry.py / test_router_registry.py 修改断言，不删除正常注册测试。

注意：这里删除的是 /device、/permissions 等无 /api 前缀的占位路由，正式设备管理、考勤账号权限和试验数据报告功能保留。

### S-02：三个已经不可用的本地实验写接口

app/api/routes/laboratory.py 中：

- POST /api/laboratory/tasks/{task}/experiments/{experiment}/start
- POST /api/laboratory/tasks/{task}/experiments/{experiment}/complete
- POST /api/laboratory/tasks/{task}/experiments/{experiment}/axis-adjustment-ready

所有实验间的启动和结束现均走 MQTT，这三个 hostless 路由当前被接口守卫拒绝，正常调用链不使用，可删除对应路由和只服务于它们的请求模型/辅助函数。

同步删除 frontend/src/lib/laboratoryApi.js 中的 startLaboratoryExperiment、completeLaboratoryExperiment、markLaboratoryAxisAdjustmentReady 及相关导出。

共享 start/completion/axis 服务继续被 MQTT、维修完成等当前业务使用，不得删除。laboratory.py 其他 compare/install/ready、withdraw-current、盐雾恢复准备接口保留。

### S-03：不可达的本地完成与通用夹具倒计时回退

- frontend/src/modules/laboratory/useLaboratoryCompletionFlow.js：usesMqttCompletion 为 false 后执行的旧本地完成分支。
- frontend/src/modules/laboratory/useLaboratoryOperationPersistence.js：仅供该旧分支调用的 persistRunningExperimentCompletion。
- frontend/src/modules/laboratory/useLaboratoryPage.js：上述旧分支的参数注入和无用状态连接，随依赖关系一并收敛。
- frontend/src/modules/laboratory/useLaboratoryFixtureConfirmation.js：startFixtureConfirmCountdown 中非 MQTT 时直接成功并 persistFixtureReadyForTask 的回退；当前模式恒为 MQTT，该分支不可达。

高低温湿热二室实际使用的是同文件独立的 scheduleHostlessFixtureReady，它有明确实验间能力校验，必须保留。不能整体删除 fixture confirmation 模块。

### S-04：闲置只读入口及死包装

- GET /api/attendance/users：当前人员页面使用 /api/attendance/work-times，本版本没有调用者；可删除该 GET handler 和 listAttendanceUsers 前端包装。
- listLaboratoryTelemetry：无调用者的前端包装可删除。

考勤用户创建、修改、删除、工时接口保留。readLaboratoryTelemetrySnapshot 和 GET /api/telemetry/laboratories 正常被可视化使用，保留。

## 二、可以删除的旧兼容分支

### S-05：MQTT 开始/结束缺 run_no 的回退

app/services/mq_event_processor.py 当前还允许：

- STARTED 没有 run_no 时，用实验室 READY 上下文临时创建运行编号。
- ENDED 没有 run_no 时，按实验室选当前批次并完成。

本版本 READY 已下发 run_no，模拟器也会回传，直接要求开始和结束确认携带 run_no 即可。删除的是缺失时的回退，正常 STARTED/ENDED 事件和运行创建服务保留。

generated_run_no 仍供正常 READY 创建编号等位置使用，不能因删除接收端回退就整体删除该工具函数。

### S-06：MQTT payload 类型覆盖 Topic

删除 payload.message_type / payload.event 决定业务事件类型的优先分支，统一按 Topic 分派；若报文仍携带类型且与 Topic 冲突，拒绝。现行发送端不依赖覆盖能力，不增加字段或握手。

同步修改把旧行为视为合法的测试，以及接口文档中已过时的无 run_no 兼容说明。

## 三、应收紧公共能力，不能整体删除的接口

### S-07：通用 storage 的直接实验状态写入

PUT /api/storage 和 PUT /api/storage/{key} 仍被正常页面使用，接口保留。

移除直接把样品/托盘跨越到实验开始、暂停、恢复、完成、取消等状态的公共用途，统一由当前专用业务接口、MQTT 及共享状态转换服务处理。不能删除 samples 存储、正常样品维护、排程或配置保存能力。

这是业务入口收敛，需要补直接写入被拒绝及正常编辑仍成功的回归，不能通过删除整段 storage 校验来实现瘦身。

### S-08：后台专用集合的公共写入

从公共可写 key 中移除：

- mes.lims_inbox
- mes.lims_outbox
- mes.lims_completions
- mes.experiment_run_pauses

这些数据由当前后台业务产生，正常页面没有公开写用途。保留对应数据、内部存储读写、LIMS worker 和 MQTT 暂停流程，只删除通用 HTTP 覆盖/清空能力。单独定义公共可写白名单，不删除内部 STORAGE_KEYS 项目。

## 四、当前仍需保留，不属于冗余

- 正式 MQTT 安装、ready/start/end、盐雾 pause/resume/正常 stop、设备故障取消和霉菌取消。
- 高低温湿热二室 sample-install / fixture-ready 的本地模拟例外。
- 当前上位机模拟器、DEV 暂停确认和非 prod HTTP 事件注入：本版本联调测试仍使用；可不随生产包分发，但不作为无人使用代码直接删除。
- message_id 缺省生成：当前模拟器的正常回传仍依赖，现阶段保留。
- MQTT 模式读取/同步接口：登录和实验间页面仍调用。
- 共用业务服务、数据一致性校验、幂等与终态保护：用于当前运行或既有数据，不作为旧客户端执行分支删除。
- 正常任务重置、错误样品撤回、目录选择、数据导出、维修人工完成。

## 本次实施顺序

1. S-01 + S-04：独立占位代码和无用只读包装，耦合较低。
2. S-02 + S-03：成组清理本地实验端点、前端回退和专用测试，保留共享服务和二室夹具例外。
3. S-05 + S-06：清理旧消息兼容，验证正常 MQTT 合同。
4. S-07 + S-08：收紧公共写用途，验证正常页面保存及后台任务，避免误删活跃接口。

删除功能时只移除其专用测试；正常流程、边界和防误写回归继续保留。代码删除与写入约束已实施；数据库结构和业务数据未做删除。
