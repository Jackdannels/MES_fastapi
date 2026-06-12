# 代码目录

本文档按路径记录项目中主要代码文件和目录的职责，便于后续拆分、定位和维护。

## 项目根目录

- `app/`：FastAPI 后端应用目录，包含接口路由、核心存储层、服务层和模块注册。
- `frontend/`：Vue + Vite 前端应用目录，包含页面模块、共享组件、组合式函数和前端测试。
- `tests/`：后端 pytest 测试目录，覆盖 API、核心存储、Web 路由等。
- `scripts/`：项目脚本目录，包含初始化、迁移、报告等辅助脚本。
- `docs/`：项目文档目录，包含设计文档、计划文档、预览文件和本代码目录。
- `assets/`：静态资源目录。
- `tools/`：开发和运行辅助工具目录。

## 后端路径

- `app/main.py`：FastAPI 应用入口，负责创建应用并挂载路由。
- `app/api/`：后端 API 层。
- `app/api/auth_session.py`：认证会话辅助逻辑。
- `app/api/routes/`：按业务域拆分的 FastAPI 路由。
- `app/api/routes/auth.py`：登录、认证相关接口。
- `app/api/routes/storage.py`：存储快照、前端数据持久化、实时更新发布接口。
- `app/api/routes/tasks.py`：任务相关接口。
- `app/api/routes/laboratory.py`：实验室流程相关接口。
- `app/api/routes/transfer_area.py`：交接区/暂存/托盘分配相关接口和工作台业务逻辑。
- `app/api/routes/mq.py`：MQTT 管理或调试相关接口。
- `app/api/routes/master_data.py`：主数据读取接口。
- `app/api/routes/crud_factory.py`：通用 CRUD 路由工厂。
- `app/core/`：后端核心业务和基础设施。
- `app/core/config.py`：运行配置、环境变量和应用设置。
- `app/core/storage_backend.py`：统一存储后端抽象、快照归一化、mock/MySQL 后端选择。
- `app/core/mysql_storage_backend.py`：MySQL 存储后端兼容入口和数据库读写编排，并重导出拆分后的 codec、mapper、schema、master reader、snapshot、loader、replacer、sample write/load、status、status SQL helper 以保持旧导入路径可用。
- `app/core/mysql_storage_codecs.py`：MySQL 存储层纯 codec/helper，负责文本、时间、数字、布尔、meta 编解码。
- `app/core/mysql_storage_mappers.py`：MySQL 存储层纯 row mapper，负责任务、实验、实验运行、排班、设备、数据流、样品入库行、样品重建和派发目标恢复等前端数据与数据库行之间的转换。
- `app/core/mysql_storage_master_readers.py`：MySQL 存储层主数据只读 helper，负责实验类型和实验室列表查询。
- `app/core/mysql_storage_schema.py`：MySQL 存储层 schema 扩展 helper，负责兼容字段补齐、主数据表/索引初始化、默认实验类型和实验室 seed，以及 MQTT 实验事件相关表初始化。
- `app/core/mysql_storage_snapshot.py`：MySQL 存储层快照辅助函数，负责 snapshot JSON payload 编解码和按托管 key 删除缺失关系行的通用 SQL helper。
- `app/core/mysql_storage_loaders.py`：MySQL 存储层只读 loader helper，负责任务、排班、实验、实验关联、设备和数据流等简单查询的 SQL 与 row mapper 组装。
- `app/core/mysql_storage_replacers.py`：MySQL 存储层简单写入 replacer helper，负责任务、排班、实验、实验-托盘/样品关联、实验运行及运行托盘、设备和数据流的托管行替换与 upsert。
- `app/core/mysql_storage_sample_load.py`：MySQL 存储层样品读取 helper，负责样品、托盘、样品事件读取，以及 fixture ready 事件按托盘作用域恢复。
- `app/core/mysql_storage_sample_write.py`：MySQL 存储层样品写入 helper，负责样品写入编排、托管样品行准备、旧样品/托盘绑定清理、缺失托管样品/托盘删除、托盘写入状态构建、fixture ready 兼容事件和样品 history 事件写入。
- `app/core/mysql_storage_status.py`：MySQL 存储层状态派生和回填规则，负责实验/任务状态汇总、样品作用域解析和未排程时间回填。
- `app/core/mysql_storage_status_sql.py`：MySQL 存储层状态 SQL helper，负责 legacy 状态字段归一化、排班 task_id 回填、实验/任务进度状态同步 SQL 和未排程时间持久化回填。
- `app/core/master_data.py`：默认实验室、试验类型等主数据定义。
- `app/core/demo_data_reset.py`：演示数据重置逻辑。
- `app/core/legacy_fallback.py`：旧数据兜底命中记录。
- `app/core/local_run.py`：本地运行辅助。
- `app/core/store.py`：本地存储入口。
- `app/core/time_utils.py`：业务时间解析、格式化和时区处理。
- `app/db/`：数据库连接和快照仓储。
- `app/db/session.py`：数据库连接会话。
- `app/db/mysql_snapshot.py`：MySQL 快照仓储和连接设置。
- `app/services/`：后端业务服务层。
- `app/services/laboratory_start.py`：实验启动服务。
- `app/services/laboratory_completion.py`：实验完成服务。
- `app/services/mq_event_processor.py`：MQTT 事件解析、入库和实验进度处理。
- `app/services/mq_publisher.py`：MQTT 消息发布。
- `app/services/mq_runtime.py`：MQTT 运行时管理。
- `app/services/mq_subscriber.py`：MQTT 订阅。
- `app/services/upper_computer_simulator.py`：上位机模拟服务。
- `app/modules/registry.py`：后端模块注册信息。

## 前端路径

- `frontend/package.json`：前端依赖和脚本入口。
- `frontend/vite.config.js`：Vite 构建和测试配置。
- `frontend/src/App.vue`：前端根组件。
- `frontend/src/main.js`：前端应用启动入口。
- `frontend/src/router/`：前端路由配置。
- `frontend/src/auth.js`：前端认证、模块切换和会话处理。
- `frontend/src/components/shared/`：共享 UI 组件，如弹窗、抽屉、分页、反馈提示。
- `frontend/src/composables/`：共享组合式函数。
- `frontend/src/composables/useStorageSnapshot.js`：读取存储快照。
- `frontend/src/composables/useStorageSnapshotRefresh.js`：存储快照刷新和事件监听。
- `frontend/src/composables/useFeedback.js`：页面反馈消息管理。
- `frontend/src/lib/`：前端共享工具和业务基础函数。
- `frontend/src/lib/apiBase.js`：API 地址解析。
- `frontend/src/lib/dateTime.js`：前端时间格式化。
- `frontend/src/lib/labIdentity.js`：实验室身份和匹配规则。
- `frontend/src/lib/storageKeys.js`：前端存储 key 定义。
- `frontend/src/lib/taskArchive.js`：任务归档和返回状态判断。
- `frontend/src/lib/trayCapacity.js`：托盘容量常量。

## 前端业务模块

- `frontend/src/modules/dashboard/`：首页和统计看板模块。
- `frontend/src/modules/data/`：数据管理模块。
- `frontend/src/modules/devices/`：设备管理模块。
- `frontend/src/modules/devices/useDevicesPage.js`：设备页面状态和交互逻辑。
- `frontend/src/modules/experiment-progress/`：实验进度公共模型。
- `frontend/src/modules/handover-system/`：交接系统入口页面和条码能力。
- `frontend/src/modules/laboratory/`：实验室工作台模块。
- `frontend/src/modules/laboratory/model.js`：实验室流程状态、动作和视图模型。
- `frontend/src/modules/laboratory/useLaboratoryPage.js`：实验室页面组合式状态。
- `frontend/src/modules/login/`：登录模块。
- `frontend/src/modules/process/`：过程控制模块。
- `frontend/src/modules/process/model.js`：过程控制基础模型。
- `frontend/src/modules/process/useProcessLabs.js`：过程控制实验室卡片、开始实验、详情抽屉和实时刷新逻辑。
- `frontend/src/modules/sample-pre-allocation/`：样品预分配页面，复用转运工作台。
- `frontend/src/modules/samples/`：样品流转和托盘管理模块。
- `frontend/src/modules/samples/samplesFlowModel.js`：样品流转兼容入口，聚合并导出流转视图、托盘视图、暂存和命令函数，并委托 tray scope、experiment helper、status 和 constants 子模块承载基础逻辑。
- `frontend/src/modules/samples/sampleFlow.constants.js`：样品流转常量，包含流程步骤、实验室集合、外观检测状态和状态选项。
- `frontend/src/modules/samples/sampleFlow.trayScope.js`：样品流转托盘作用域 helper，负责数组/时间/文本基础归一化、task/tray/experiment entry 字段解析、托盘号匹配、托盘条目合并排序和 `getSampleTrayList`。
- `frontend/src/modules/samples/sampleFlow.experimentHelpers.js`：样品流转实验 helper，负责实验身份/展示名/实验室目的地解析、实验历史解析、撤回恢复目标解析、实验运行时间和多实验路线判断。
- `frontend/src/modules/samples/sampleFlow.experimentOrder.js`：样品流转实验顺序 helper，负责按任务/托盘/排班筛选实验、排序实验、解析实验展示字段和目标实验室。
- `frontend/src/modules/samples/sampleFlow.experimentRuns.js`：样品流转实验运行 helper，负责实验运行记录与运行-托盘关系合并、按任务/托盘/实验解析运行状态，以及实验完成运行时间提取。
- `frontend/src/modules/samples/sampleFlow.experimentEvents.js`：样品流转实验事件 helper，负责实验历史事件映射、实验别名事件匹配、实验状态优先级和单实验状态展示标签。
- `frontend/src/modules/samples/sampleFlow.sampleTableHelpers.js`：样品流转列表 helper，负责列表状态 class、排序比较和按活跃任务过滤样品。
- `frontend/src/modules/samples/sampleFlow.sampleCollection.js`：样品集合命令 helper，负责按位置反推样品状态、追加样品历史、克隆样品集合，以及按托盘号批量同步样品/托盘状态。
- `frontend/src/modules/samples/sampleFlow.commands.js`：样品流转命令函数，负责批量接样、样品详情更新、托盘状态更新和暂存样品派发。
- `frontend/src/modules/samples/sampleFlow.samplesListView.js`：样品流转列表视图 builder，负责样品列表筛选、排序、分页、托盘编号摘要和状态样式派生。
- `frontend/src/modules/samples/sampleFlow.trayOverviewView.js`：样品流转托盘总览视图 builder，负责按托盘聚合样品、关联任务信息、过滤已收回托盘和托盘管理搜索。
- `frontend/src/modules/samples/sampleFlow.stagingView.js`：样品流转暂存视图 builder，负责前置/实验后暂存样品过滤、搜索分页、勾选状态、托盘摘要和实验室选项输出。
- `frontend/src/modules/samples/sampleFlow.flowTimeHelpers.js`：样品流转时间线 helper，负责历史状态标签归一化、时间历史去重、步骤最新时间选择和未到达步骤时间隐藏。
- `frontend/src/modules/samples/sampleFlow.trayLifecycle.js`：样品流转托盘生命周期 helper，负责厂家收回/已处置状态识别、托盘/历史记录收回判定，以及按任务和托盘解析有效生命周期状态。
- `frontend/src/modules/samples/sampleFlow.shared.js`：样品流转共享底层 helper。
- `frontend/src/modules/samples/sampleFlow.status.js`：样品生命周期状态归一化、样品记录归一化和状态反推。
- `frontend/src/modules/samples/useSamplesFlow.js`：样品页面组合式状态。
- `frontend/src/modules/samples/SamplesManagementPanel.vue`：样品管理面板。
- `frontend/src/modules/samples/TrayManagementPanel.vue`：托盘管理面板。
- `frontend/src/modules/schedule/`：排班模块。
- `frontend/src/modules/schedule/model.js`：排班模型兼容入口和业务编排，负责排班状态、甘特图、冲突、任务状态派生和排班增删改。
- `frontend/src/modules/schedule/sharedModel.js`：排班共享基础 helper，负责暂存设备识别、时段常量、文本/时间格式化、日期偏移、重叠判断和甘特槽状态。
- `frontend/src/modules/schedule/formModel.js`：排班表单模型，负责手动排程默认状态、时段选项、编辑/重排表单、计划时长归一化和排程时间解析。
- `frontend/src/modules/schedule/useSchedulePage.js`：排班页面组合式状态。
- `frontend/src/modules/staging-management/`：暂存间管理模块。
- `frontend/src/modules/staging-management/model.js`：暂存间库存、扫描、指标和动作模型。
- `frontend/src/modules/system/`：系统设置模块。
- `frontend/src/modules/task-history/`：任务历史模块。
- `frontend/src/modules/task-overview/`：任务总览模块。
- `frontend/src/modules/tasks/`：任务管理模块。
- `frontend/src/modules/tasks/model.js`：任务列表、状态和筛选模型。
- `frontend/src/modules/tasks/useTasksPage.js`：任务页面组合式状态。
- `frontend/src/modules/transfer-workbench/`：转运工作台共享模块。
- `frontend/src/modules/transfer-workbench/TransferWorkbench.vue`：交接/预分配共用工作台页面组件。
- `frontend/src/modules/transfer-workbench/TransferDispatchPanel.vue`：托盘派发面板。
- `frontend/src/modules/transfer-workbench/useTransferDispatch.js`：派发流程组合式逻辑。
- `frontend/src/modules/visualization/`：可视化大屏模块。
- `frontend/src/modules/visualization/model.js`：可视化数据模型兼容入口，重导出实验室面板、三日排班和暂存展示 builder。
- `frontend/src/modules/visualization/sharedModel.js`：可视化模型共享 helper，负责文本/时间/数量归一化、任务/实验/托盘字段解析和实验索引构建。
- `frontend/src/modules/visualization/experimentCompletionModel.js`：可视化实验完成判定 helper，负责实验历史解析、运行托盘完成状态、厂家收回和托盘实验完成判定。
- `frontend/src/modules/visualization/labProcessModel.js`：可视化实验室流程面板 builder，负责实验室设备健康、实验室托盘行、流程步骤和实验室面板汇总。
- `frontend/src/modules/visualization/scheduleThreeDayModel.js`：可视化三日排班 builder，负责三日窗口、甘特行、冲突数量和实验室负载摘要。
- `frontend/src/modules/visualization/stagingSamplesModel.js`：可视化暂存展示 builder，负责暂存/外观/实验后暂存托盘分类、容量统计和任务分组。
- `frontend/src/modules/visualization/flowStepState.js`：可视化流程步骤状态展示辅助。
- `frontend/src/modules/visualization/page.vue`：可视化页面组件。
- `frontend/src/modules/visualization/styles.css`：可视化页面样式。

## 测试路径

- `frontend/src/**/*.test.js`：前端单元、运行时和结构测试。
- `frontend/src/modules/samples/samplesFlowModel.test.js`：样品流转模型核心测试。
- `frontend/src/modules/samples/trayFlowConsistency.test.js`：托盘流转与实验室工作台一致性测试。
- `frontend/src/modules/process/useProcessLabs.test.js`：过程控制实验室逻辑测试。
- `frontend/src/modules/visualization/model.test.js`：可视化模型测试。
- `tests/api/`：后端 API 测试。
- `tests/api/test_transfer_area.py`：交接区/托盘派发 API 测试。
- `tests/api/test_storage.py`：存储 API 测试。
- `tests/core/`：后端核心逻辑测试。
- `tests/core/test_mysql_storage_backend.py`：MySQL 存储后端映射、codec/mapper/schema/master reader/snapshot/loader/replacer/sample write/load/status/status SQL re-export、schema 扩展、状态和兼容入口测试。
- `tests/core/test_storage_backend.py`：统一存储后端测试。
- `tests/web/`：Web/SPA 路由测试。

## 文档和辅助路径

- `docs/code-directory.md`：当前代码目录说明。
- `docs/superpowers/specs/`：功能设计文档。
- `docs/superpowers/plans/`：实施计划文档。
- `docs/design-previews/`：设计预览文件。
- `docs/mqtt-interface-definition.json`：MQTT 接口定义。
- `frontend/scripts/legacy-fallback-snapshot-report.mjs`：旧数据兜底扫描报告脚本。
- `scripts/init_mysql_storage.py`：MySQL 存储初始化脚本。
