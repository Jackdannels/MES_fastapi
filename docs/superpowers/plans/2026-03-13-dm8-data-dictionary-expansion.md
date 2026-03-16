# DM8 Data Dictionary Expansion Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有达梦数据库概要设计扩写为字段级数据字典，并重新输出可交付的 `docx` 文档。

**Architecture:** 采用“结构化源数据 -> HTML 文档 -> DOCX 导出”的方式重建文档，避免在现有 HTML 上做大段手工编辑。每张表统一使用固定模板：表用途、主键/外键/约束、字段数据字典、映射说明、设计说明。

**Tech Stack:** Python 3.13、`beautifulsoup4`、`python-docx`、HTML

---

## Chunk 1: 文档结构与生成模板

**Files:**
- Modify: `docs/superpowers/specs/2026-03-13-dm8-database-design.html`
- Create/Modify: `tmp` 生成脚本（一次性执行，不纳入仓库也可）

- [ ] 梳理现有 49 张表的清单与章节归属
- [ ] 定义统一的数据字典字段模板
- [ ] 定义 HTML 输出结构和样式

## Chunk 2: 逐域扩写字段数据字典

**Files:**
- Modify: `docs/superpowers/specs/2026-03-13-dm8-database-design.html`

- [ ] 扩写系统与组织域
- [ ] 扩写主数据与工程基础域
- [ ] 扩写仓储域
- [ ] 扩写任务、样品、排程、采集域
- [ ] 扩写质量、报表、YT 扩展域

## Chunk 3: 文档导出与校验

**Files:**
- Modify: `docs/superpowers/specs/2026-03-13-dm8-database-design.docx`

- [ ] 从 HTML 重新生成 `docx`
- [ ] 校验标题、章节、表格和中文内容可读
- [ ] 向用户回报输出路径和内容覆盖范围
