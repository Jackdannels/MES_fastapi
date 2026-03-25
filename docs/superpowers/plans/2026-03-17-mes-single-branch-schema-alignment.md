# MES Single Branch Schema Alignment Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 `mes_single_branch` 的数据库结构，使其能够承接当前前端模块所需的核心业务字段和缺失业务表。

**Architecture:** 保留现有主表，使用增量方式补字段和补表。种子 SQL 与真实库同步演进：先定义目标结构，再通过增量 SQL 将现有库升级到相同版本。

**Tech Stack:** MySQL 9.6, SQL DDL, PowerShell, MySQL CLI

---

### Task 1: 固化目标结构文档

**Files:**
- Create: `docs/superpowers/specs/2026-03-17-mes-single-branch-schema-alignment-design.md`
- Modify: `docs/superpowers/plans/2026-03-17-mes-single-branch-schema-alignment.md`

- [ ] **Step 1: 记录当前缺口**

Run:

```powershell
& 'C:\Program Files\MySQL\MySQL Server 9.6\bin\mysql.exe' -uroot -p580231 -D mes_single_branch -e "DESC biz_task; DESC biz_sample; DESC md_equipment; DESC sys_role;"
```

Expected: 看到缺失的任务受理字段、样品字段、采集开关字段和角色权限字段。

- [ ] **Step 2: 写入设计文档**

记录新增字段、表、外键、索引和兼容策略。

- [ ] **Step 3: 保存实施计划**

确保计划文件与设计文档一致。

### Task 2: 更新种子 SQL

**Files:**
- Modify: `C:/Users/12051/Desktop/mes_single_branch_schema_seed.sql`

- [ ] **Step 1: 在 seed 中补现有表字段**

修改：

- `biz_task`
- `biz_sample`
- `md_equipment`
- `sys_role`

- [ ] **Step 2: 在 seed 中新增缺失业务表**

新增：

- `biz_schedule`
- `biz_data_stream`
- `md_equipment_connection`
- `md_equipment_point`
- `biz_sample_event`
- `sys_config`

- [ ] **Step 3: 补充必要索引和外键**

确保按业务键和外键字段建立索引。

### Task 3: 生成增量补库 SQL

**Files:**
- Create: `scripts/sql/2026-03-17-mes-single-branch-schema-alignment.sql`

- [ ] **Step 1: 写缺字段补齐 SQL**

使用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 风格逐项补齐。

- [ ] **Step 2: 写缺表补齐 SQL**

使用 `CREATE TABLE IF NOT EXISTS` 创建新增业务表。

- [ ] **Step 3: 写索引和外键补齐 SQL**

按新表和新字段补充索引/唯一约束/外键。

### Task 4: 将增量 SQL 应用到真实库

**Files:**
- Use: `scripts/sql/2026-03-17-mes-single-branch-schema-alignment.sql`

- [ ] **Step 1: 执行增量 SQL**

Run:

```powershell
& 'C:\Program Files\MySQL\MySQL Server 9.6\bin\mysql.exe' -uroot -p580231 -D mes_single_branch < scripts/sql/2026-03-17-mes-single-branch-schema-alignment.sql
```

Expected: 无 DDL 错误。

- [ ] **Step 2: 校验新增表**

Run:

```powershell
& 'C:\Program Files\MySQL\MySQL Server 9.6\bin\mysql.exe' -uroot -p580231 -D mes_single_branch -e "SHOW TABLES LIKE 'biz_schedule'; SHOW TABLES LIKE 'biz_data_stream'; SHOW TABLES LIKE 'biz_sample_event';"
```

Expected: 返回新增表。

- [ ] **Step 3: 校验新增字段**

Run:

```powershell
& 'C:\Program Files\MySQL\MySQL Server 9.6\bin\mysql.exe' -uroot -p580231 -D mes_single_branch -e "DESC biz_task; DESC biz_sample; DESC md_equipment; DESC sys_role;"
```

Expected: 返回全部新增字段。

### Task 5: 结构回归验证

**Files:**
- Verify: `C:/Users/12051/Desktop/mes_single_branch_schema_seed.sql`
- Verify: `scripts/sql/2026-03-17-mes-single-branch-schema-alignment.sql`

- [ ] **Step 1: 运行缺口检查 SQL**

Expected: 先前确认的缺表/缺字段列表为空。

- [ ] **Step 2: 对比 seed 与真实库目标结构**

确认 seed 与增量 SQL 的目标结构一致。

- [ ] **Step 3: 记录验证结果**

在最终说明中列出新增表、补齐字段和执行结果。
