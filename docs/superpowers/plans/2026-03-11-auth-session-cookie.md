# Auth Session Cookie Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move login state from frontend-only `localStorage` trust to a backend-issued `HttpOnly` session cookie plus `/auth/session` verification.

**Architecture:** Keep the existing demo username/password flow, but let FastAPI sign a compact session payload and store it in a cookie. Frontend login writes only a normalized session cache after successful backend login or session refresh, while router/auth checks rely on the backend `/auth/session` endpoint to validate and hydrate the current session.

**Tech Stack:** FastAPI, Starlette responses, `itsdangerous`, Vue 3, Vue Router, Vitest, Pytest

---

## Chunk 1: Backend Session Cookie

### Task 1: Add backend session settings and signing helpers

**Files:**
- Modify: `app/core/config.py`
- Modify: `.env.example`
- Modify: `requirements.txt`
- Create: `app/api/auth_session.py`
- Test: `tests/api/test_auth.py`

- [ ] **Step 1: Write the failing test**

```python
def test_login_sets_session_cookie(client):
    response = client.post(
        "/auth/login",
        json={"username": "admin", "password": "123", "module": "visual"},
    )

    assert response.cookies.get("mes_session")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.\.venv\Scripts\python.exe -m pytest tests\api\test_auth.py::test_login_sets_session_cookie -v`
Expected: FAIL because the response does not set a `mes_session` cookie yet.

- [ ] **Step 3: Write minimal implementation**

```python
class Settings(BaseSettings):
    SESSION_COOKIE_NAME: str = "mes_session"
    SESSION_SECRET_KEY: str = "change-me"
```

```python
def dump_auth_session(session: dict) -> str:
    return URLSafeSerializer(settings.SESSION_SECRET_KEY, salt="auth-session").dumps(session)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.\.venv\Scripts\python.exe -m pytest tests\api\test_auth.py::test_login_sets_session_cookie -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/core/config.py .env.example requirements.txt app/api/auth_session.py tests/api/test_auth.py
git commit -m "feat: add signed auth session cookies"
```

### Task 2: Expose backend session read/clear endpoints

**Files:**
- Modify: `app/api/routes/auth.py`
- Modify: `tests/api/test_auth.py`

- [ ] **Step 1: Write the failing tests**

```python
def test_session_returns_user_from_cookie(client):
    login = client.post("/auth/login", json={"username": "admin", "password": "123", "module": "visual"})

    response = client.get("/auth/session", cookies=login.cookies)

    assert response.status_code == 200
    assert response.json()["module"] == "visual"


def test_logout_clears_session_cookie(client):
    login = client.post("/auth/login", json={"username": "admin", "password": "123", "module": "central"})

    response = client.post("/auth/logout", cookies=login.cookies)

    assert response.status_code == 204
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests\api\test_auth.py -v`
Expected: FAIL because `/auth/session` and `/auth/logout` do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```python
@router.get("/session")
def read_session(session = Depends(require_auth_session)):
    return session


@router.post("/logout", status_code=204)
def logout(response: Response):
    clear_auth_cookie(response)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\.venv\Scripts\python.exe -m pytest tests\api\test_auth.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/routes/auth.py tests/api/test_auth.py
git commit -m "feat: add auth session and logout endpoints"
```

## Chunk 2: Frontend Session Validation

### Task 3: Route frontend auth helpers through backend session verification

**Files:**
- Modify: `frontend/src/auth.js`
- Modify: `frontend/src/auth.test.js`

- [ ] **Step 1: Write the failing tests**

```js
test("fetchAuthSession hydrates session from backend", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({ username: "admin", module: "visual", logged_at: "2026-03-11T00:00:00Z" }),
  })));

  const session = await fetchAuthSession();

  expect(session.module).toBe("visual");
  expect(readAuthSession()).toEqual(session);
});

test("fetchAuthSession clears malformed local cache when backend rejects", async () => {
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ username: "admin", module: "visual", logged_at: "x" }));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ detail: "Unauthorized" }) })));

  const session = await fetchAuthSession();

  expect(session).toBeNull();
  expect(readAuthSession()).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test:run -- src/auth.test.js`
Expected: FAIL because `fetchAuthSession` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```js
async function fetchAuthSession() {
  const response = await fetch("/auth/session", { headers: { Accept: "application/json" } });
  if (!response.ok) {
    clearAuthSession();
    return null;
  }
  const payload = normalizeAuthSession(await response.json());
  writeAuthSession(payload);
  return payload;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test:run -- src/auth.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/auth.js frontend/src/auth.test.js
git commit -m "feat: fetch auth session from backend"
```

### Task 4: Make login and router bootstrap use backend-validated sessions

**Files:**
- Modify: `frontend/src/composables/useLoginForm.js`
- Modify: `frontend/src/lib/authRouting.js`
- Modify: `frontend/src/router/index.js`
- Modify: `frontend/src/pages/LoginPage.vue` (only if wiring changes require it)
- Modify: `frontend/src/lib/authRouting.test.js`
- Modify: `frontend/src/router/index.structure.test.js`

- [ ] **Step 1: Write the failing tests**

```js
test("buildRouteAccessDecision can await backend hydration before guarding", async () => {
  const decision = await buildRouteAccessDecision({
    getSession: async () => ({ module: "visual" }),
    to: { fullPath: "/visualization", meta: { module: "visual" } },
  });

  expect(decision).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test:run -- src/lib/authRouting.test.js src/router/index.structure.test.js`
Expected: FAIL because the router helper is synchronous and cannot hydrate backend session.

- [ ] **Step 3: Write minimal implementation**

```js
router.beforeEach(async (to) => {
  return buildRouteAccessDecision({
    getSession: async () => readAuthSession() || fetchAuthSession(),
    to,
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test:run -- src/lib/authRouting.test.js src/router/index.structure.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/composables/useLoginForm.js frontend/src/lib/authRouting.js frontend/src/router/index.js frontend/src/lib/authRouting.test.js frontend/src/router/index.structure.test.js
git commit -m "feat: validate router auth state against backend session"
```

## Chunk 3: Full Verification and Docs

### Task 5: Refresh docs and run full verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update auth documentation**

Document `/auth/login`, `/auth/session`, `/auth/logout`, the `HttpOnly` cookie behavior, and the frontend verification flow.

- [ ] **Step 2: Run backend verification**

Run: `.\.venv\Scripts\python.exe -m pytest -v`
Expected: PASS

- [ ] **Step 3: Run frontend verification**

Run: `cd frontend && npm run lint`
Expected: PASS

Run: `cd frontend && npm run test:run`
Expected: PASS

Run: `cd frontend && npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document backend auth session flow"
```
