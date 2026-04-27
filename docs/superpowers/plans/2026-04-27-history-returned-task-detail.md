# History Returned Task Detail Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove duplicate pre-allocation UI and make history task data show only fully returned tasks with task/tray flow timestamps.

**Architecture:** Keep pre-allocation cleanup local to `TransferWorkbench` and `SamplesManagementPanel`. Move task-history data shaping into `task-history/model.js`, then bind the page to that model with a master-detail layout.

**Tech Stack:** Vue 3, Vitest, Vue Test Utils

---

## Tasks

- [ ] Add failing tests for pre-allocation overview text removal.
- [ ] Add failing tests for removing the embedded pre-allocation workbench from samples.
- [ ] Add failing model tests for returned task filtering and flow timestamp extraction.
- [ ] Implement the minimal UI/model changes.
- [ ] Run targeted tests and build.
