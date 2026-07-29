# P0 性能观测与容量基线

P0 只增加观测和可重复容量工具，不改变任务、托盘、实验室、存储、MQTT 或 hostless 业务规则。

## 后端观测

默认启用低开销观测：

```env
PERFORMANCE_MONITOR_ENABLED=true
PERFORMANCE_LOG_ALL_REQUESTS=false
PERFORMANCE_SLOW_REQUEST_MS=500
READ_SNAPSHOT_CACHE_TTL_SECONDS=5.0
```

每个 HTTP 响应包含：

- `X-Request-ID`：请求关联标识；
- `Server-Timing`：应用、数据库查询、连接池等待、存储读取和写锁阶段耗时；
- `X-MES-Response-Bytes`：能够从 `Content-Length` 获取时的未压缩响应字节数。
- `X-MES-DB-Queries`：当前请求执行的SQL批次数。

超过阈值或返回 5xx 的请求写入 `mes.performance` JSON 日志。临时诊断所有请求时可设置
`PERFORMANCE_LOG_ALL_REQUESTS=true`，完成诊断后应恢复为 `false`。

只读快照响应使用5秒进程内单飞缓存；任何MQTT、hostless模拟或HTTP业务写入发布存储更新时都会立即递增版本并失效缓存，
浏览器若检测到事件版本跳号或EventSource重连则执行全量校准。

## 前端观测

开发模式默认采集以下数据到浏览器内存，不上传：

- API Resource Timing；
- 超过浏览器 long-task 阈值的主线程任务；
- 应用首次渲染；
- 存储快照请求与 JSON 解析。

浏览器控制台读取：

```js
window.__MES_PERFORMANCE_ENTRIES__
```

生产构建需要显式设置 `VITE_PERFORMANCE_MONITOR_ENABLED=true`。设置
`window.__MES_PERFORMANCE_ENABLED__ = false` 并刷新页面可在单个终端停用采集。

## 固定容量数据

先只生成 JSON，不写数据库：

```powershell
rtk proxy C:\ProgramData\anaconda3\envs\fastapi\python.exe scripts\generate_p0_capacity_fixture.py
```

固定规模为33个任务、3200个样品、132个实验和4800条实验样品关系。其中前10个任务各有99个样品，
其余23个任务分摊剩余2210个样品（2个任务各97个，21个任务各96个），确保任何任务都不超过99个样品。

写入数据库是破坏性操作，只允许使用已经预置基础 MES 表结构、且名称以 `_perf`、`_capacity`、
`_benchmark` 或 `_test` 结尾的隔离数据库：

```powershell
$env:MYSQL_DATABASE="mes_p0_capacity"
rtk proxy C:\ProgramData\anaconda3\envs\fastapi\python.exe scripts\generate_p0_capacity_fixture.py --apply --confirm-replace REPLACE_CAPACITY_DATABASE --expected-host 127.0.0.1 --expected-port 3337 --expected-database mes_p0_capacity
```

生成器会拒绝 `mes_single_branch` 等非隔离数据库名称。

## 只读基线

后端重启并加载新的观测中间件后执行：

```powershell
rtk proxy C:\ProgramData\anaconda3\envs\fastapi\python.exe scripts\run_p0_baselines.py --base-url http://127.0.0.1:18000 --expected-host 127.0.0.1 --expected-port 3337 --expected-database mes_p0_capacity --duration 60 --repeats 3 --quiet
```

工具预热后依次运行5用户和10用户场景，各执行3轮并汇总中位数；报告写入 `artifacts/performance/`。报告包括P50/P95/P99、
平均响应字节、`Server-Timing` 各阶段P95、数据集合计数、身份签名和完整内容签名。如果两轮之间业务数据
内容发生变化，整组基线判定失败，避免使用漂移数据比较版本。

## 5用户读写混合基线

该场景只允许对已经加载固定容量数据的隔离数据库执行。它使用4个只读用户和1个低频遥测流写入用户，
不会调用MQTT或高低温湿热二室 hostless 操作：

```powershell
rtk proxy C:\ProgramData\anaconda3\envs\fastapi\python.exe scripts\run_p0_mixed_baseline.py --duration 60 --confirm-isolated-write REPLACE_CAPACITY_DATABASE
```

工具会先通过 `/health` 校验数据库名称和固定任务/样品数量，不满足条件时拒绝写入。

## P0 验收线

- 5用户、10用户和混合场景错误率为0；
- 读取接口P95不超过500ms；
- 隔离数据库的低频写入P95不超过1000ms；
- 任一超过500ms的请求都能看到请求ID、响应大小、SQL累计耗时、连接池等待和锁等待；
- 前端可以区分网络、JSON解析、首次渲染和主线程长任务。

## 2026-07-29 只读烟测观察

使用关闭 MQTT、RabbitMQ 和上位机模拟器的临时后端，对当前运行库执行了10秒5用户和10秒10用户烟测。
该结果不是正式容量基线，因为测试期间数据从41个任务、1598个样品增长为42个任务、1697个样品，
内容签名发生变化，工具已将整组报告判定为失败。

仍可用于验证观测链路和定位方向：

| 场景 | 总体P95 | 样品P95 | 样品SQL累计P95 | 样品平均响应 |
| --- | ---: | ---: | ---: | ---: |
| 5用户 | 545ms | 627ms | 508ms | 约1.01MB |
| 10用户 | 1562ms | 1811ms | 1681ms | 约1.03MB |

两轮均未出现连接池等待阶段；慢请求时间主要集中在数据库查询和关系存储读取，支持优先实施页面专用读取、
减少全量数据和SQL优化，而不是直接增加线程数。

## 2026-07-29 P1 优化后固定容量基线

隔离环境使用33个任务、3200个样品、10个99样品任务（单任务最大99），5用户和10用户各执行3轮60秒测试并取中位数。
所有轮次错误率为0，内容签名保持一致。最终报告位于
`artifacts/performance/p0-formal-after-final/p0-baseline-summary.json`。

| 场景/接口 | P0 P95 | P1 P95 | 延迟下降 |
| --- | ---: | ---: | ---: |
| 5用户总体 | 3427.54ms | 823.60ms | 76.0% |
| 5用户样品 | 3934.82ms | 958.05ms | 75.7% |
| 5用户总览 | 3038.53ms | 724.44ms | 76.2% |
| 5用户接驳区 | 3349.18ms | 853.63ms | 74.5% |
| 5用户可视化 | 3256.11ms | 746.85ms | 77.1% |
| 10用户总体 | 6976.95ms | 716.53ms | 89.7% |
| 10用户样品 | 7753.39ms | 802.70ms | 89.6% |
| 10用户总览 | 6226.90ms | 599.36ms | 90.4% |
| 10用户接驳区 | 6479.36ms | 692.63ms | 89.3% |
| 10用户可视化 | 6428.78ms | 643.84ms | 90.0% |

缓存稳定命中时，5用户总体P50为21.11ms，10用户总体P50为23.36ms；P95仍由缓存失效后的首次全量关系重建决定，
因此本轮未通过最终阈值。下一阶段应实现样品列表服务端分页、样品详情/历史按需读取，以及接驳区数据库摘要读取器，
而不应继续延长缓存TTL来掩盖首次加载成本。
