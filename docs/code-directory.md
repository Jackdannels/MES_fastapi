# 代码目录

本文档仅记录项目主要代码路径及职责，并按功能模块组织，便于定位、开发和维护。

## 项目入口与公共基础

- `app/`：FastAPI 后端应用目录。
- `app/main.py`：后端应用入口，创建 FastAPI 应用并挂载模块路由。
- `app/modules/registry.py`：后端模块、API 路由和 SPA 路径注册表。
- `frontend/`：Vue + Vite 前端应用目录。
- `frontend/src/main.js`：前端应用启动入口。
- `frontend/src/App.vue`：前端根组件和模块页面装配入口。
- `frontend/src/router/`：前端路由配置。
- `frontend/src/modules/index.js`：前端业务模块统一导出入口。
- `frontend/src/components/shared/`：弹窗、抽屉、分页、反馈提示等共享 UI 组件。
- `frontend/src/composables/`：跨模块共享的组合式函数。
- `frontend/src/composables/useStorageSnapshot.js`：存储快照读取。
- `frontend/src/composables/useStorageSnapshotRefresh.js`：存储快照刷新和事件监听。
- `frontend/src/composables/useFeedback.js`：页面反馈消息管理。
- `frontend/src/lib/`：API 地址、时间、实验室身份、存储 key、任务归档和托盘容量等共享工具。
- `frontend/src/shared/`：前端跨模块共享状态和基础能力。
- `frontend/src/assets/`：前端静态资源。

## 登录、权限与会话模块

- `app/api/auth_session.py`：后端认证会话辅助逻辑。
- `app/api/routes/auth.py`：登录和认证接口。
- `app/api/routes/permissions.py`：权限数据接口。
- `app/services/fixed_terminal_auth.py`：固定终端认证规则。
- `frontend/src/auth.js`：前端认证、会话和模块切换处理。
- `frontend/src/modules/login/`：登录页面、登录表单状态和样式。
- `tests/api/test_auth.py`：认证 API 测试。
- `frontend/src/auth.test.js`：前端认证逻辑测试。
- `frontend/src/modules/login/*.test.js`：登录页面和表单测试。

## 考勤模块

- `app/api/routes/attendance.py`：考勤登录、会话和记录接口。
- `app/services/attendance_service.py`：考勤业务服务、仓储实现和兼容入口。
- `app/services/attendance_time.py`：考勤业务时间解析、格式化和轴向完成计时规则。
- `app/services/attendance_security.py`：密码校验及二维码令牌生成、规范化和哈希。
- `scripts/sql/V004__runtime_schema_finalization.sql`：考勤及其他运行期结构扩展迁移。
- `frontend/src/modules/laboratory/useLaboratoryAttendance.js`：实验室页面的考勤会话、开工计时和登出倒计时。
- `tests/api/test_attendance.py`：考勤 API 测试。
- `tests/services/test_attendance_architecture.py`：考勤服务边界和兼容入口测试。

## 任务管理与任务历史模块

- `app/api/routes/tasks.py`：任务创建、编辑、删除和业务校验接口。
- `app/api/routes/task_history.py`：任务历史查询接口。
- `app/services/external_task_intake_service.py`：外部任务接入和任务数据转换服务。
- `frontend/src/modules/tasks/`：任务管理页面模块。
- `frontend/src/modules/tasks/model.js`：任务列表、状态和筛选模型。
- `frontend/src/modules/tasks/useTasksPage.js`：任务页面组合式状态入口。
- `frontend/src/modules/tasks/useTaskExperimentPickers.js`：实验类型、实验室和设备选择器联动。
- `frontend/src/modules/tasks/useTasksPersistence.js`：任务保存和删除的 API 持久化边界。
- `frontend/src/modules/tasks/useTasksRealtime.js`：任务快照实时刷新。
- `frontend/src/modules/tasks/useTasksTableView.js`：任务筛选、排序、分页和表格行派生。
- `frontend/src/modules/tasks/useTaskMutationWorkflow.js`：任务编辑、实验变更、样品编号同步和删除流程。
- `frontend/src/modules/task-overview/`：任务总览、任务编辑面板、样品编码和托盘汇总组件。
- `frontend/src/modules/task-history/`：任务历史页面和模型。
- `tests/api/test_tasks.py`：任务 API 测试。
- `tests/api/test_task_history.py`：任务历史 API 测试。
- `frontend/src/modules/tasks/*.test.js`：任务管理模型、运行时和结构测试。
- `frontend/src/modules/task-overview/*.test.js`：任务总览逻辑和组件测试。
- `frontend/src/modules/task-history/*.test.js`：任务历史测试。

## 排程与实验进度模块

- `app/api/routes/workflows.py`：工作流相关基础接口。
- `app/api/routes/technologies.py`：工艺数据接口。
- `app/api/routes/manufactureplan.py`：生产计划数据接口。
- `frontend/src/modules/schedule/`：排班页面模块。
- `frontend/src/modules/schedule/model.js`：排班模型兼容入口。
- `frontend/src/modules/schedule/sharedModel.js`：时段、时间、重叠判断和甘特槽等共享规则。
- `frontend/src/modules/schedule/formModel.js`：排程表单、时长和时间解析模型。
- `frontend/src/modules/schedule/scheduleFoundationModel.js`：排程状态、轴向、设备锁定和维护冲突规则。
- `frontend/src/modules/schedule/scheduleLifecycleModel.js`：任务及排程生命周期和托盘状态证据派生。
- `frontend/src/modules/schedule/scheduleRecordModel.js`：排程增删改、冲突检测和流记录更新。
- `frontend/src/modules/schedule/scheduleViewModel.js`：排程表格、甘特图、选项和统计视图构建。
- `frontend/src/modules/schedule/useSchedulePage.js`：排班页面组合式状态入口。
- `frontend/src/modules/schedule/useScheduleFormState.js`：排程表单联动状态。
- `frontend/src/modules/schedule/useScheduleRealtime.js`：排程页面实时刷新。
- `frontend/src/modules/experiment-progress/`：跨页面复用的实验进度和轴向进度模型。
- `frontend/src/modules/schedule/*.test.js`：排程模型、页面运行时和实时刷新测试。
- `frontend/src/modules/experiment-progress/*.test.js`：实验进度模型测试。

## 接驳间、预分配与转运模块

- `app/api/routes/transfer_area.py`：接驳间、暂存和托盘分配 API 入口。
- `app/api/routes/transfer_area_schemas.py`：接驳间请求和响应模型。
- `app/api/routes/transfer_area_commands.py`：接驳间写操作和业务命令。
- `app/api/routes/transfer_area_read_views.py`：接驳间只读状态、工作区和派发查询视图。
- `app/api/routes/transfer_area_views.py`：接驳间响应视图组装。
- `frontend/src/modules/handover-system/`：接驳间入口页面和条码能力。
- `frontend/src/modules/sample-pre-allocation/`：样品预分配入口，复用转运工作台。
- `frontend/src/modules/transfer-workbench/TransferWorkbench.vue`：接驳间和预分配共用工作台。
- `frontend/src/modules/transfer-workbench/TransferDispatchPanel.vue`：托盘派发面板。
- `frontend/src/modules/transfer-workbench/transferTrayLayoutModel.js`：托盘布局、样品排序、容量重排和分配载荷规则。
- `frontend/src/modules/transfer-workbench/useTransferTrayAssignment.js`：托盘容量、实验分配、拖拽和保存校验状态。
- `frontend/src/modules/transfer-workbench/useTransferWorkspacePersistence.js`：工作区加载、保存、确认入库和重载。
- `frontend/src/modules/transfer-workbench/useTransferDispatch.js`：托盘派发流程。
- `frontend/src/modules/transfer-workbench/useTransferBarcodePrinting.js`：条码预览、批量打印和打印确认。
- `frontend/src/modules/transfer-workbench/useTransferWorkbenchOverview.js`：任务总览筛选、分页和统计。
- `frontend/src/modules/transfer-workbench/useTransferWorkbenchRealtime.js`：工作台实时刷新和样品事件监听。
- `frontend/src/modules/transfer-workbench/useTransferWorkbenchExit.js`：工作台退出确认和模块切换。
- `tests/api/test_transfer_area.py`：接驳间和托盘派发 API 测试。
- `frontend/src/modules/transfer-workbench/*.test.js`：转运工作台运行时、结构和实时刷新测试。

## 样品与托盘流转模块

- `app/api/routes/warehouse.py`：仓储业务数据接口。
- `app/api/routes/productcatalog.py`：产品目录数据接口。
- `app/api/routes/quality.py`：质量数据接口。
- `frontend/src/modules/samples/`：样品列表、托盘管理和全流程状态模块。
- `frontend/src/modules/samples/useSamplesFlow.js`：样品页面组合式状态入口。
- `frontend/src/modules/samples/SamplesManagementPanel.vue`：样品管理面板。
- `frontend/src/modules/samples/TrayManagementPanel.vue`：托盘管理面板。
- `frontend/src/modules/samples/samplesFlowModel.js`：样品流转模型公共兼容入口。
- `frontend/src/modules/samples/sampleFlow.constants.js`：流程步骤、实验室、外观检测和状态常量。
- `frontend/src/modules/samples/sampleFlow.shared.js`：样品流转共享底层规则。
- `frontend/src/modules/samples/sampleFlow.status.js`：样品生命周期状态归一化和状态反推。
- `frontend/src/modules/samples/sampleFlow.trayScope.js`：任务、托盘和实验条目作用域解析。
- `frontend/src/modules/samples/sampleFlow.sampleCollection.js`：样品集合克隆、历史追加和批量状态同步。
- `frontend/src/modules/samples/sampleFlow.commands.js`：接样、样品更新、托盘更新和暂存派发命令。
- `frontend/src/modules/samples/sampleFlow.sampleTableHelpers.js`：样品列表状态、排序和任务过滤规则。
- `frontend/src/modules/samples/sampleFlow.samplesListView.js`：样品列表筛选、分页和展示字段构建。
- `frontend/src/modules/samples/sampleFlow.trayOverviewView.js`：托盘总览聚合、任务关联和搜索视图。
- `frontend/src/modules/samples/sampleFlow.stagingView.js`：暂存视图筛选、分页、勾选和实验室选项构建。
- `frontend/src/modules/samples/sampleFlow.experimentHelpers.js`：实验身份、展示名、目的地和历史解析。
- `frontend/src/modules/samples/sampleFlow.experimentOrder.js`：实验筛选、排序和目标实验室解析。
- `frontend/src/modules/samples/sampleFlow.experimentRuns.js`：实验运行及运行托盘状态解析。
- `frontend/src/modules/samples/sampleFlow.experimentEvents.js`：实验历史事件映射和状态优先级。
- `frontend/src/modules/samples/sampleFlow.runtimeEvidence.js`：运行、部分轴向、撤回和派发目标证据解析。
- `frontend/src/modules/samples/sampleFlow.trayExperimentFlow.js`：托盘多实验流程和延续信息构建。
- `frontend/src/modules/samples/sampleFlow.flowTimeHelpers.js`：流程时间去重、选择和未到达时间隐藏规则。
- `frontend/src/modules/samples/sampleFlow.flowTimeMap.js`：托盘流程步骤时间映射。
- `frontend/src/modules/samples/sampleFlow.trayLifecycle.js`：托盘有效生命周期和厂家收回判定。
- `frontend/src/modules/samples/sampleFlow.trayFlowView.js`：托盘流程视图公共入口。
- `frontend/src/modules/samples/sampleFlow.trayFlowEngine.js`：托盘生命周期、实验路线和步骤排序编排。
- `frontend/src/modules/samples/sampleFlow.trayFlowSingle.js`：单实验托盘流程构建。
- `frontend/src/modules/samples/sampleFlow.trayFlowCompleted.js`：部分轴向和全部实验完成流程构建。
- `frontend/src/modules/samples/sampleFlow.trayFlowStepHelpers.js`：流程步骤、标签和时间选择规则。
- `frontend/src/modules/samples/sampleEvents.js`：样品事件处理。
- `frontend/src/modules/samples/samplesFlowModel.test.js`：样品流转模型核心测试。
- `frontend/src/modules/samples/trayFlowConsistency.test.js`：样品、托盘和实验室跨页面状态一致性测试。
- `frontend/src/modules/samples/*.test.js`：样品页面、托盘面板和流转规则测试。

## 暂存与外观检测模块

- `app/services/appearance_inspection.py`：外观检测业务服务。
- `app/services/storage_staging_policy.py`：暂存入库、出库和位置变更规则。
- `app/services/storage_appearance_policy.py`：外观检测相关存储规则。
- `app/services/storage_return_policy.py`：厂家收回相关存储规则。
- `frontend/src/modules/staging-management/`：暂存间和外观检测共用业务模块。
- `frontend/src/modules/staging-management/model.js`：暂存管理模型公共兼容入口。
- `frontend/src/modules/staging-management/stagingStorageModel.js`：暂存、实验后暂存和外观检测库存证据解析。
- `frontend/src/modules/staging-management/stagingExperimentModel.js`：实验完成、部分轴向、目标实验室和允许去向派生。
- `frontend/src/modules/staging-management/stagingRowsModel.js`：暂存托盘行聚合和终态清理。
- `frontend/src/modules/staging-management/stagingViewModel.js`：库存分区、指标、总览和扫码详情视图。
- `frontend/src/modules/staging-management/stagingActionModel.js`：入库、出库、外观流转和厂家收回动作。
- `frontend/src/modules/appearance-inspection/`：外观检测页面入口，复用暂存管理实现。
- `tests/services/test_storage_staging_policy.py`：暂存存储规则测试。
- `frontend/src/modules/staging-management/*.test.js`：暂存页面、模型、结构和实时刷新测试。

## 实验室作业模块

- `app/api/routes/laboratory.py`：实验室作业 HTTP 接口、物理接口校验和业务编排入口。
- `app/services/laboratory_start.py`：实验启动服务。
- `app/services/laboratory_completion.py`：实验完成状态变换兼容入口。
- `app/services/laboratory_completion_rules.py`：托盘完成、轴向规范化和部分完成规则。
- `app/services/laboratory_operations.py`：实验室通用操作编排。
- `app/services/laboratory_run_lifecycle.py`：实验运行生命周期管理。
- `app/services/laboratory_axis_steps.py`：实验轴向步骤处理。
- `app/services/laboratory_withdrawal.py`：实验室任务撤回处理。
- `app/services/laboratory_snapshot_adapter.py`：实验室快照及开始、完成更新的存储映射。
- `app/services/experiment_segments.py`：实验分段和轴向片段规则。
- `app/services/fixture_installations.py`：夹具安装状态处理。
- `app/services/storage_lab_arrival_policy.py`：实验室到达和入场存储规则。
- `frontend/src/modules/laboratory/`：实验室工作台页面模块。
- `frontend/src/modules/laboratory/model.js`：实验室模型公共入口。
- `frontend/src/modules/laboratory/laboratoryConfig.js`：实验室配置。
- `frontend/src/modules/laboratory/laboratoryConstants.js`：实验室状态、流程节点和共享集合。
- `frontend/src/modules/laboratory/laboratoryDeviceInterface.js`：按物理操作区分 MQTT/hostless 能力；高低温湿热二室仅在样品安装和夹具就绪环节使用 hostless，本实验室的准备、启动和结束仍使用 MQTT。
- `frontend/src/modules/laboratory/workflowState.js`：比对、安装和确认等工作流状态转换。
- `frontend/src/modules/laboratory/laboratoryTrayEligibility.js`：托盘派发资格、操作锁和部分轴向作用域判断。
- `frontend/src/modules/laboratory/laboratoryTrayState.js`：托盘状态聚合和当前实验状态恢复。
- `frontend/src/modules/laboratory/laboratoryTrayRows.js`：实验室托盘行聚合和生命周期展示字段构建。
- `frontend/src/modules/laboratory/laboratoryScheduleRow.js`：排程、运行、轴向进度和托盘状态行构建。
- `frontend/src/modules/laboratory/laboratoryWorkbenchSelection.js`：任务候选、续轴排程和工作台选择规则。
- `frontend/src/modules/laboratory/laboratoryTaskFlow.js`：任务流程节点和当前实验上下文派生。
- `frontend/src/modules/laboratory/laboratoryAxisEvidence.js`：托盘级轴向历史和可继续托盘证据。
- `frontend/src/modules/laboratory/laboratoryAxisContinuation.js`：轴向完成和同排程继续条件。
- `frontend/src/modules/laboratory/laboratoryRunIndex.js`：实验运行与托盘关系索引。
- `frontend/src/modules/laboratory/laboratoryHistory.js`：撤回使用的历史和位置快照解析。
- `frontend/src/modules/laboratory/laboratoryPresentation.js`：计划时长、业务时间、倒计时和展示数据派生。
- `frontend/src/modules/laboratory/laboratoryComparisonFeedback.js`：托盘比对失败反馈生成。
- `frontend/src/modules/laboratory/scheduleCompletion.js`：排程完成状态处理。
- `frontend/src/modules/laboratory/useLaboratoryPage.js`：实验室页面组合式状态入口。
- `frontend/src/modules/laboratory/useLaboratoryOperationPersistence.js`：比对、安装、就绪和完成的持久化编排。
- `frontend/src/modules/laboratory/useLaboratoryCompletionFlow.js`：实验完成、轴向继续和完成弹窗流程。
- `frontend/src/modules/laboratory/useLaboratoryResetFlow.js`：任务撤回确认和响应落地流程。
- `frontend/src/modules/laboratory/useLaboratoryFixtureConfirmation.js`：夹具确认、MQTT 等待和 hostless 自动确认计时。
- `frontend/src/modules/laboratory/useLaboratoryRunningModal.js`：运行弹窗恢复和自动关闭计时。
- `frontend/src/modules/laboratory/useLaboratoryRealtimeRefresh.js`：实验室快照和样品事件实时刷新。
- `tests/api/test_laboratory.py`：实验室 API、MQTT 和 hostless 接口路径测试。
- `tests/services/test_laboratory_services.py`：实验室服务测试。
- `tests/services/test_laboratory_architecture.py`：实验室服务边界和兼容入口测试。
- `frontend/src/modules/laboratory/*.test.js`：实验室模型、页面、配置、结构和实时刷新测试。

## 过程管控模块

- `frontend/src/modules/process/`：实验室过程监控、任务详情和运行状态模块。
- `frontend/src/modules/process/page.vue`：过程管控页面入口和组件装配。
- `frontend/src/modules/process/useProcessLabs.js`：过程页组合式状态和实时刷新入口。
- `frontend/src/modules/process/processLabCatalog.js`：实验室目录、位置、时间和接口模式提示。
- `frontend/src/modules/process/processScheduleSelection.js`：实验室排程匹配、完成过滤和任务选择。
- `frontend/src/modules/process/processTrayProjection.js`：托盘、样品、运行状态和剩余工作投影。
- `frontend/src/modules/process/processTaskProjection.js`：任务详情、实验室卡片和可启动排程组合。
- `frontend/src/modules/process/useProcessTaskDialogs.js`：任务详情、完整清单和任务选择弹窗状态。
- `frontend/src/modules/process/ProcessTaskDetailModal.vue`：任务详情弹窗。
- `frontend/src/modules/process/ProcessTaskTrayPanel.vue`：任务托盘面板。
- `frontend/src/modules/process/ProcessTaskFullListModal.vue`：完整托盘和样品清单弹窗。
- `frontend/src/modules/process/ProcessTaskSelectionModal.vue`：任务和实验选择弹窗。
- `frontend/src/modules/process/*.test.js`：过程管控模型、页面、结构和实时刷新测试。

## 设备与终端控制模块

- `app/api/routes/device.py`：设备数据接口。
- `app/api/routes/terminal_control.py`：终端状态、管理列表和远程命令接口。
- `app/services/terminal_control.py`：终端心跳、在线状态、命令队列和权限判定。
- `app/services/storage_maintenance_policy.py`：设备维护相关存储规则。
- `frontend/src/modules/devices/`：设备管理页面模块。
- `frontend/src/modules/devices/useDevicesPage.js`：设备页面公共入口。
- `frontend/src/modules/devices/useDevicesPageEngine.js`：设备页面状态、弹窗、持久化和实时刷新编排。
- `frontend/src/modules/devices/deviceMaintenanceRules.js`：维保类型、状态、时间和记录生成规则。
- `frontend/src/modules/devices/deviceMaintenanceSchedule.js`：维保排程冲突和设备联合投影。
- `frontend/src/modules/devices/deviceRunningRepair.js`：运行中设备维修、重排回滚和完成处理。
- `frontend/src/modules/devices/useDeviceClock.js`：服务端业务时钟和维保计时器。
- `scripts/client/MESWorkstationConfigurator.cs`：固定工作台注册、开机启动、心跳和远程命令客户端。
- `scripts/client/MESTerminalManager.cs`：Windows 终端状态与远程控制管理面板。
- `scripts/build_terminal_manager.ps1`：终端管理面板构建脚本。
- `tests/api/test_terminal_control.py`：终端控制 API 测试。
- `frontend/src/modules/devices/*.test.js`：设备模型、页面和实时刷新测试。

## MQTT、上位机与外部消息模块

- `app/api/routes/mq.py`：MQTT 管理、状态和调试接口。
- `app/services/mq_runtime.py`：MQTT 运行时生命周期管理。
- `app/services/mq_subscriber.py`：MQTT 消息订阅。
- `app/services/mq_publisher.py`：MQTT 消息发布。
- `app/services/mq_event_processor.py`：MQTT 事件入库、幂等处理和实验进度编排。
- `app/services/mq_event_protocol.py`：topic、事件类型、消息字段、运行号、时间和数值解析规则。
- `app/services/upper_computer_simulator.py`：本地上位机模拟接口；业务规则仍与 MQTT 路径共用。
- `app/services/lims_rabbitmq.py`：LIMS RabbitMQ 消息集成。
- `docs/mqtt-interface-definition.json`：MQTT 机器可读接口定义。
- `MES与上位机MQTT接口定义V2.0.md`：MQTT 接口说明文档。
- `tests/api/test_mq.py`：MQTT API 测试。
- `tests/services/test_lims_rabbitmq.py`：LIMS RabbitMQ 集成测试。

## 存储与状态规则模块

- `app/api/routes/storage.py`：快照读取、持久化、事务内更新和更新通知接口。
- `app/services/storage_atomic.py`：存储原子更新和事务辅助逻辑。
- `app/services/storage_update_bus.py`：存储更新事件发布。
- `app/services/storage_read_helpers.py`：文本、时间、托盘、任务、排程和轴范围的只读归一化。
- `app/services/storage_policies.py`：存储业务策略公共入口。
- `app/services/storage_schedule_lock_policy.py`：排程锁定和作用域判断。
- `app/services/storage_schedule_patch.py`：排程数据补丁处理。
- `app/services/storage_tray_actions.py`：托盘相关存储动作。
- `app/core/storage_contract.py`：存储 key、运行后端常量和最小存储契约。
- `app/core/storage_backend.py`：统一存储后端、快照规范化和后端选择。
- `app/core/store.py`：本地存储入口。
- `app/core/mysql_storage_backend.py`：MySQL 存储后端兼容入口和读写编排。
- `app/core/mysql_storage_codecs.py`：MySQL 文本、时间、数字、布尔和 meta 编解码。
- `app/core/mysql_storage_mappers.py`：任务、实验、排班、设备、数据流、样品和托盘行映射。
- `app/core/mysql_storage_master_readers.py`：实验类型和实验室主数据读取。
- `app/core/mysql_storage_schema.py`：Schema 扩展、索引、默认数据和 MQTT 事件表初始化。
- `app/core/mysql_storage_snapshot.py`：快照 payload 编解码和关系行清理辅助逻辑。
- `app/core/mysql_storage_loaders.py`：任务、排班、实验、设备和数据流读取。
- `app/core/mysql_storage_replacers.py`：任务、排班、实验、运行、设备和数据流写入。
- `app/core/mysql_storage_sample_load.py`：样品、托盘和样品事件读取。
- `app/core/mysql_storage_sample_write.py`：样品、托盘和历史事件写入。
- `app/core/mysql_storage_status.py`：实验、任务和样品状态派生及时间回填。
- `app/core/mysql_storage_status_sql.py`：状态归一化、关联回填和进度同步 SQL。
- `app/db/session.py`：数据库连接会话。
- `app/db/mysql_snapshot.py`：MySQL 快照仓储和连接设置。
- `app/db/schema_contract.py` / `schema_contract.json`：版本化 MySQL 完整物理结构合约与漂移检查。
- `app/db/schema_version.py`：运行期迁移版本和生产环境历史门禁。
- `app/db/mysql_credentials.py`：API 与迁移账号隔离规则。
- `app/db/readiness.py`：正式启动前数据库 readiness 校验。
- `tests/api/test_storage.py`：存储 API 测试。
- `tests/core/test_storage_backend.py`：统一存储后端测试。
- `tests/core/test_mysql_storage_backend.py`：MySQL 存储模块测试。
- `tests/services/test_storage_architecture.py`：存储服务边界和兼容入口测试。

## 看板与可视化模块

- `frontend/src/modules/dashboard/`：首页统计看板和实时数据模块。
- `frontend/src/modules/visualization/`：可视化大屏模块。
- `frontend/src/modules/visualization/model.js`：可视化模型公共入口。
- `frontend/src/modules/visualization/sharedModel.js`：任务、实验和托盘字段解析等共享规则。
- `frontend/src/modules/visualization/experimentCompletionModel.js`：实验和托盘完成判定。
- `frontend/src/modules/visualization/labProcessModel.js`：实验室流程面板数据构建。
- `frontend/src/modules/visualization/labCurrentTasksModel.js`：实验室当前任务数据构建。
- `frontend/src/modules/visualization/scheduleThreeDayModel.js`：三日排班和实验室负载数据构建。
- `frontend/src/modules/visualization/todayTaskPlanModel.js`：当日任务计划数据构建。
- `frontend/src/modules/visualization/stagingSamplesModel.js`：暂存、外观和实验后暂存展示数据构建。
- `frontend/src/modules/visualization/flowStepState.js`：流程步骤展示状态辅助逻辑。
- `frontend/src/modules/visualization/screens/`：各大屏页面的数据装配函数。
- `frontend/src/modules/dashboard/*.test.js`：首页看板测试。
- `frontend/src/modules/visualization/*.test.js`：可视化模型、页面和样式测试。

## 数据、主数据与系统模块

- `app/api/routes/master_data.py`：实验室和实验类型等主数据接口。
- `app/core/master_data.py`：默认实验室、实验类型等主数据定义。
- `app/api/routes/system_time.py`：系统业务时间接口。
- `app/core/time_utils.py`：后端业务时间解析、格式化和时区处理。
- `app/core/axis_codes.py`：实验轴向编码规则。
- `app/core/config.py`：运行配置、环境变量和应用设置。
- `app/core/demo_data_reset.py`：演示数据重置。
- `app/core/legacy_fallback.py`：旧数据兜底命中记录。
- `app/core/local_run.py`：本地运行辅助。
- `app/api/routes/crud_factory.py`：通用 CRUD 路由工厂。
- `app/api/routes/companydepartment.py`：公司和部门数据接口。
- `app/api/routes/customer.py`：客户数据接口。
- `app/api/routes/person.py`：人员数据接口。
- `app/api/routes/material.py`：物料数据接口。
- `app/api/routes/report.py`：报告数据接口。
- `app/api/routes/yt_barcode.py`：条码数据接口。
- `app/api/routes/yt_file.py`：文件数据接口。
- `app/api/routes/yt_log.py`：日志数据接口。
- `app/api/routes/yt_object.py`：对象数据接口。
- `app/api/routes/yt_report.py`：外部报告数据接口。
- `app/api/routes/yt_timesheet.py`：工时数据接口。
- `frontend/src/modules/data/`：数据管理页面模块。
- `frontend/src/modules/system/`：系统设置页面模块。
- `tests/api/test_master_data.py`：主数据 API 测试。
- `tests/api/test_system_time.py`：系统时间 API 测试。
- `tests/api/test_crud_factory.py`：通用 CRUD 路由测试。
- `tests/core/`：配置、主数据、本地运行和存储核心测试。
- `frontend/src/modules/data/*.test.js`：数据管理模块测试。
- `frontend/src/modules/system/*.test.js`：系统设置模块测试。

## 健康检查与模块注册测试

- `app/api/routes/health.py`：应用健康、liveness 和 readiness 接口。
- `tests/api/test_health.py`：健康检查测试。
- `tests/api/test_module_registry.py`：模块注册测试。
- `tests/api/test_router_registry.py`：API 路由注册测试。
- `tests/api/test_cors.py`：跨域配置测试。
- `tests/web/`：SPA 和 Web 路由测试。
- `frontend/src/App.runtime.test.js`：前端根应用运行时测试。
- `frontend/src/App.task-intake.integration.test.js`：任务接入集成测试。
- `frontend/src/modules/modules.structure.test.js`：前端模块结构测试。

## 脚本、文档与资源

- `tests/`：后端 pytest 测试目录。
- `frontend/src/**/*.test.js`：前端 Vitest 单元、运行时和结构测试。
- `scripts/`：初始化、构建、客户端和报告等辅助脚本。
- `scripts/init_mysql_storage.py`：MySQL 存储初始化脚本。
- `scripts/generate_schema_contract.py`：从最终基线生成可审计 Schema 合约。
- `scripts/sql/V005__terminal_collation_alignment.sql`：历史终端表字符集对齐迁移。
- `scripts/sql/mysql-production-grants.example.sql`：正式迁移/API 账号授权模板。
- `compose.packaging.yml`：MySQL、迁移、API、Web、RabbitMQ/MQTT 的隔离验收编排。
- `deploy/docker/`：后端/迁移与前端/Nginx 多阶段镜像定义。
- `deploy/nginx/`：非 root Nginx 主配置、SPA 和 API/SSE 代理配置。
- `deploy/mysql/init-users.sh`：隔离 MySQL 的迁移/API 权限拆分。
- `deploy/.env.compose.example`：不含真实密码的 Compose 环境模板。
- `docs/docker-deployment.md`：Docker 打包、验收、停止和清理手册。
- `frontend/scripts/legacy-fallback-snapshot-report.mjs`：旧数据兜底快照扫描报告脚本。
- `docs/`：项目设计、计划、接口和代码目录文档。
- `docs/code-directory.md`：当前代码目录。
- `docs/superpowers/specs/`：功能设计文档。
- `docs/superpowers/plans/`：实施计划文档。
- `docs/design-previews/`：设计预览文件。
- `assets/`：项目静态资源。
- `tools/`：开发和运行辅助工具。
- `requirements.txt`：后端 Python 依赖。
- `frontend/package.json`：前端依赖和脚本入口。
- `frontend/vite.config.js`：前端构建和测试配置。
- `start-dev.ps1`、`start-dev.bat`：本地开发启动脚本。
