# Auth Session Expiry Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add idle timeout and absolute lifetime enforcement to the backend auth session cookie while keeping the frontend guard flow unchanged.

**Architecture:** Keep all expiry rules on the backend. Signed session payloads will carry `logged_at`, `last_seen_at`, and `expires_at`; `/auth/session` will validate both idle and absolute deadlines, refresh `last_seen_at` when valid, and reissue the cookie. The frontend will continue trusting only `/auth/session` responses and clear cached state on `401`.

**Tech Stack:** FastAPI, signed cookie helpers, Pytest, Vue 3, Vitest

---

### Task 1: Add backend expiry semantics to signed auth sessions

**Files:**
- Modify: `app/core/config.py`
- Modify: `.env.example`
- Modify: `app/api/auth_session.py`
- Modify: `app/api/routes/auth.py`
- Test: `tests/api/test_auth.py`

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run `.\.venv\Scripts\python.exe -m pytest tests\api\test_auth.py -v` and verify expiry tests fail**
- [ ] **Step 3: Implement idle timeout (`30` minutes), absolute lifetime (`8` hours), and `/auth/session` refresh-on-read**
- [ ] **Step 4: Re-run `.\.venv\Scripts\python.exe -m pytest tests\api\test_auth.py -v` and verify it passes**

### Task 2: Refresh docs and run full verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document backend expiry and refresh semantics**
- [ ] **Step 2: Run `cd frontend && npm run lint`**
- [ ] **Step 3: Run `cd frontend && npm run test:run`**
- [ ] **Step 4: Run `cd frontend && npm run build`**
- [ ] **Step 5: Run `.\.venv\Scripts\python.exe -m pytest -v`**
