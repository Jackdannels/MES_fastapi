# Session Secret Hardening Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the repository default session secret and leave the project in a locally runnable state with explicit `.env` configuration.

**Architecture:** Treat `SESSION_SECRET_KEY` like the demo credentials: no committed default, fail closed when auth routes need it and it is missing, and provide a local untracked `.env` with explicit development values so the app can be trial-run immediately.

**Tech Stack:** FastAPI, pydantic-settings, Pytest, Vite build output, Uvicorn

---

### Task 1: Remove committed session secret default

**Files:**
- Modify: `tests/api/test_auth.py`
- Modify: `tests/conftest.py`
- Modify: `app/core/config.py`
- Modify: `app/api/auth_session.py`
- Modify: `.env.example`

- [ ] **Step 1: Write the failing test for missing `SESSION_SECRET_KEY`**
- [ ] **Step 2: Run `.\.venv\Scripts\python.exe -m pytest tests\api\test_auth.py -v` and verify it fails**
- [ ] **Step 3: Remove the config default, fail closed with `503`, and inject a test secret in the test environment**
- [ ] **Step 4: Re-run `.\.venv\Scripts\python.exe -m pytest tests\api\test_auth.py -v` and verify it passes**

### Task 2: Make local trial run explicit and verify startup

**Files:**
- Create: `.env`
- Modify: `README.md`

- [ ] **Step 1: Create an untracked local `.env` with explicit dev auth values**
- [ ] **Step 2: Run `cd frontend && npm run lint`**
- [ ] **Step 3: Run `cd frontend && npm run test:run`**
- [ ] **Step 4: Run `cd frontend && npm run build`**
- [ ] **Step 5: Run `.\.venv\Scripts\python.exe -m pytest -v`**
- [ ] **Step 6: Start `uvicorn app.main:app` locally, hit a couple of endpoints, and stop it cleanly**
