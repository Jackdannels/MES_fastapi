# Demo Auth Config Hardening Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove fixed demo credentials from repository defaults while keeping demo login available when explicitly configured.

**Architecture:** Backend config stops shipping `DEMO_USER` / `DEMO_PASSWORD` defaults. The auth route returns `503` when demo auth is not configured, and tests inject dedicated demo credentials through the test environment instead of relying on `admin/123`.

**Tech Stack:** FastAPI, pydantic-settings, Pytest

---

### Task 1: Replace default demo credentials with explicit configuration

**Files:**
- Modify: `tests/api/test_auth.py`
- Modify: `tests/conftest.py`
- Modify: `app/core/config.py`
- Modify: `app/api/routes/auth.py`
- Modify: `.env.example`

- [ ] **Step 1: Write the failing test for unconfigured demo auth**
- [ ] **Step 2: Run `.\.venv\Scripts\python.exe -m pytest tests\api\test_auth.py -v` and verify it fails**
- [ ] **Step 3: Remove config defaults, return `503` when demo auth is not configured, and inject test credentials via test env**
- [ ] **Step 4: Re-run `.\.venv\Scripts\python.exe -m pytest tests\api\test_auth.py -v` and verify it passes**

### Task 2: Full verification

**Files:**
- Modify: `README.md` only if auth setup docs need a note

- [ ] **Step 1: Run `cd frontend && npm run lint`**
- [ ] **Step 2: Run `cd frontend && npm run test:run`**
- [ ] **Step 3: Run `cd frontend && npm run build`**
- [ ] **Step 4: Run `.\.venv\Scripts\python.exe -m pytest -v`**
