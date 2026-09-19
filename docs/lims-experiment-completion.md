# MES → LIMS 试验完成回传

## 触发与范围

MES 后端主动 HTTP POST 到 `LIMS_HTTP_CALLBACK_URL`（模拟器 `/api/mes/events`）。任务下发仍使用 RabbitMQ；上位机试验准备、开始和结束仍使用 MQTT，高低温湿热二室的夹具例外不变。

- 每个托盘独立检查该试验全部要求轴向及子试验。一个轴向结束不发送；本次有新完成托盘才建立完成记录。
- 同一任务不同试验、同一试验不同托盘批次分别回传；不等待整个任务完成。内部及外部任务都覆盖。
- 同一托盘/试验已通知后，重复结束消息不创建第二条记录。此版本不定义同一托盘/试验的“重做轮次”；需要重做时应使用新的试验身份。
- 异常终止、故障取消和霉菌取消不当作正常完成。盐雾达到完成条件的正常结束仍经过共享完成路径。
- 不扫描上线前的历史完成任务补发；只捕获接入后的实际完成转换。

## 信封和业务载荷

沿用 HTTP 基础信封，`type=mes.experiment.completion.v1`、`schema_version=1`、`source=MES`。

| 载荷字段 | 含义 |
| --- | --- |
| `completion_id` | 本次完成业务身份，不随重试/文件补齐改变 |
| `revision` | 从 1 开始的完整快照版本；新版替代旧版，不是增量 |
| `code` / `task_code`、`task_name`、`task_source` | 任务信息 |
| `lims_request_id` | 原 LIMS 请求号，内部任务允许为空 |
| `experiment_code`、`experiment_name` | 完成的试验 |
| `completed_at` | 本次完成截止时间，带北京时间偏移 |
| `tray_codes`、`trays[].samples[]` | 本次新完成托盘及其样品编号、名称、类型快照 |
| `executions[]` | 为这些托盘完成该试验所涉及的各运行/轴向执行记录 |
| `personnel[]` | 人员登录会话、工作区间及统计秒数 |
| `data` | 本次限定范围的数据目录 URL、文件清单、生成状态 |
| `data_quality[]` | 缺失或不完整信息的显式标识，不用 0 冒充未知 |

`event_id` 由完成编号和版本确定；同一事件重试不重新计算、不修改载荷。LIMS 保存全部原始事件，业务列表只显示最高版本。旧版晚到不覆盖；同版本内容不同或完成编号跨任务/试验复用返回 409。

### 设备时长

`executions[]` 包含 `execution_id`、`run_no`、`sub_experiment_code`、`axis_code`、实验室/设备标识、`tray_codes`、起止时间、`elapsed_seconds`、`running_seconds`、`duration_source` 和 `data_quality`。

- 使用 MES 已确认的 MQTT 生命周期时间；现有链路以 MES 接收时间为业务时间。`duration_source=mqtt_events`，不是设备内部计时器读数。
- 多轴按各轴实际起止计算，排除轴间调整；盐雾扣除已记录暂停区间，包括暂停中正常结束。重叠暂停区间先合并，不重复扣除。
- 未知/无效起止时间或暂停时间，实际运行秒数为 `null`，显式标记数据不完整。
- 一个执行同时承载多个托盘，只保留一个执行记录。不同完成通知引用同一执行时使用同一 `execution_id`，LIMS 跨通知汇总应按此去重，不能按托盘倍乘。
- 设备编号仅在主数据能唯一关联时填入，缺失或歧义不猜测，标记 `device_identity_incomplete`。

### 人员登录和考勤

- 按运行批次读取工作区间及关联登录会话；保留所有换班人员，不读取“当天总工时”代替本次数据。
- `sessions[]` 给出真实登录时间、截至完成时已发生的退出时间、统计截止时间。完成时仍在线的退出时间为 `null`；不会为了回传而强制退出人员。
- `attendance_seconds` 为本次相关运行范围内工作区间的并集。包含同一运行内轴间调整的实际工作时长；`between_axis_work_seconds` 单独列出该部分，与设备运行时长分离。
- `login_seconds` 是登录会话与本次运行时间范围重叠的时长，不是整次登录总时长，也不是设备时长。
- `work_intervals[].interval_id` 为稳定切片标识，另有 `source_interval_id`。共享工时跨通知应去重，不重复累加。
- 设备起止缺失时，已知且关联运行的考勤仍保留，截到完成时间并标记质量问题。没有考勤记录则人员列表为空并标记缺失。
- 不传密码、密码哈希、二维码或会话密钥。完成时捕获人员快照，后续人员改名、退出不改变已发送内容。

### 实验数据 URL

- `data.url` 指向 `/api/test-data/completions/{token}`，只列出本次新完成托盘/样品及相关运行轴向的文件。
- 文件下载为 `/api/test-data/completions/{token}/files/{export_key}`。服务端再次验证文件属于本次完成范围，并限制到配置的报告根目录，不能通过 URL 获取其他托盘/批次文件。
- 现有输出为 MES 自动归档 PDF（试验身份及起止等信息），**不表示设备原始曲线、完整采样数据或正式检测结论已接入**。
- `data.status` 为 `pending`、`partial` 或 `ready`。文件缺失/生成失败时不编造文件 URL，后续成功补齐发送同一完成记录的新版本。
- 文件仍使用现有归档存储/保留策略；物理文件被删除后下载返回 404，而不是泄露其他文件。链接是随机令牌持有者可访问的范围授权，请仅通过可信 LIMS 渠道传递，部署使用 HTTPS。

## 持久化与恢复

1. 共享完成路径在工作流提交前构建冻结快照及待汇总意图，存到 `mes.lims_completions`。
2. MySQL 将该意图与对应工作流状态在同一事务提交，MQTT 正常完成在此提交成功后才记录消息已处理。
3. 现有 HTTP 后台每约 5 秒恢复待汇总记录、检查文件，生成新版本并与 `mes.lims_outbox` 同事务保存。
4. HTTP 成功且应答事件号匹配后，标记当前完成版本已投递，再移出 outbox；崩溃窗口最多导致重复投递，由接收端去重。
5. 文件 IO 不持有工作流提交锁。若进程在完成落库后、归档前退出，后台用冻结样品/运行信息补建缺失报告，每执行阶段失败后至少间隔 30 秒重试，每轮限制 10 个阶段。生成失败不阻止带待生成状态的通知。
6. 未配置回调 URL 时保留完成意图，配置并重启后继续处理。`/health/lims-http` 的 `completion_error` 与网络发送错误分开报告。

完成快照保留在 MES 中，不随成功投递删除；演示任务重置会清除 MES 完成快照及 outbox，LIMS 自己的接收历史不删除。现阶段沿用服务单实例/进程内工作流锁的部署方式，未新增跨多实例的分布式投递锁。

## 配置与上线

- `LIMS_HTTP_CALLBACK_URL`：LIMS 接收地址。
- `LIMS_HTTP_TOKEN`：两端一致的 Bearer Token。
- `LIMS_DATA_PUBLIC_BASE_URL`：LIMS 可访问的 MES HTTP(S) 根地址，不支持 `auto`。为空时回退到明确配置的 `TEST_DATA_PUBLIC_BASE_URL`；仍无有效地址则通知标记 `public_base_url_missing`。
- 标准 `start-dev.ps1` 自动设置本机接收地址和后端局域网下载地址，支持自定义后端端口。异机 LIMS/反向代理部署应使用明确配置和对应启动方式。
- 同时重启 MES 与 LIMS 模拟器后生效；无需新建 SQL 表，使用已有 `app_storage_snapshot` 新增键。

## 回归范围

专项测试 `tests/services/test_lims_completion.py` 覆盖：单轴不发、最后轴发送、跨运行完成、其他托盘轴向隔离、相同轴向不同子试验、部分托盘分批、重复结束、共享时长去重、暂停扣除、换班、轴间考勤、缺失时间戳、URL 范围、报告晚到与崩溃恢复。

`tests/core/test_mysql_storage_backend.py` 覆盖意图/工作流和快照/outbox 同事务提交及失败回滚；模拟器测试覆盖版本乱序与身份冲突；UI 测试覆盖安全链接和未知时长展示。
