# Sample Text Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move legacy sample text sanitization into backend persistence so historical garbled text is migrated at the storage layer.

**Architecture:** Add a backend sanitizer for `mes.samples` inside `JsonFileStorage`, apply it on read and write, and auto-persist cleaned content when old data is detected. Keep the current frontend compatibility layer in place for this round.

**Tech Stack:** FastAPI, Python, JSON file storage, Pytest, Vitest

---

### Task 1: Add Backend Migration Tests

**Files:**
- Create: `tests/core/test_storage_backend.py`
- Modify: `app/core/storage_backend.py`

- [ ] **Step 1: Write failing tests for read-time sanitization**
- [ ] **Step 2: Run targeted pytest to confirm the tests fail for the expected reason**
- [ ] **Step 3: Write minimal backend sanitization implementation**
- [ ] **Step 4: Re-run targeted pytest to confirm the tests pass**

### Task 2: Cover Write-Time Sanitization

**Files:**
- Modify: `tests/core/test_storage_backend.py`
- Modify: `app/core/storage_backend.py`

- [ ] **Step 1: Write failing tests for write/write_many sanitization**
- [ ] **Step 2: Run targeted pytest to confirm failure**
- [ ] **Step 3: Extend backend implementation to sanitize writes**
- [ ] **Step 4: Re-run targeted pytest to confirm pass**

### Task 3: Verify No Regressions

**Files:**
- Test: `tests/core/test_storage_backend.py`
- Test: `tests/api`
- Test: `frontend`

- [ ] **Step 1: Run targeted backend tests**
- [ ] **Step 2: Run broader backend regression tests**
- [ ] **Step 3: Run `npm run test:run` in `frontend/`**
