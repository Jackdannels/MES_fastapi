# Staging System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the staging placeholder with the imported temporary-storage UI, while keeping the existing `staging` auth/routing contract and exposing it in the login flow as an independent temporary-storage system.

**Architecture:** Keep `staging` as the internal module key and `/staging-management` as the route, but move the `zancun.zip` page/model/tests into the existing `staging-management` module directory. Update module metadata and shared shell labeling so the module behaves like an independent standalone system while reusing the existing auth/session pipeline.

**Tech Stack:** Vue 3, Vue Router 4, Vite, Vitest, Vue Test Utils, CSS modules-by-folder pattern already used in `frontend/src/modules`

---

## Chunk 1: Documentation And Import Structure

### Task 1: Land the imported staging module file structure

**Files:**
- Create: `frontend/src/modules/staging-management/model.js`
- Create: `frontend/src/modules/staging-management/model.test.js`
- Create: `frontend/src/modules/staging-management/page.runtime.test.js`
- Modify: `frontend/src/modules/staging-management/page.vue`
- Modify: `frontend/src/modules/staging-management/styles.css`

- [ ] **Step 1: Write the failing tests**

Copy the provided `zancun.zip` tests into:

- `frontend/src/modules/staging-management/model.test.js`
- `frontend/src/modules/staging-management/page.runtime.test.js`

Adjust imports from `./model` and `./page.vue` to the `staging-management` directory so they target the real module files.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test:run -- src/modules/staging-management/model.test.js src/modules/staging-management/page.runtime.test.js
```

Expected:

- Missing `model.js`
- Existing placeholder `page.vue` does not satisfy runtime expectations

- [ ] **Step 3: Write the minimal implementation**

Add `model.js`, replace `page.vue` with the imported temporary-storage page, and replace `styles.css` with the imported styling adapted to the `staging` module path.

Required implementation detail:

- Keep `AppModal` and `AppPagination` imports via `@/components/shared/...`
- Preserve Teleport behavior to `.header-actions`
- Ensure the page remains compatible with the shared standalone shell

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm run test:run -- src/modules/staging-management/model.test.js src/modules/staging-management/page.runtime.test.js
```

Expected:

- PASS for all imported staging module model/runtime tests

## Chunk 2: Module Wiring And Shared Labels

### Task 2: Update module metadata and shared labels

**Files:**
- Modify: `frontend/src/modules/staging-management/index.js`
- Modify: `frontend/src/modules/login/page.vue`
- Modify: `frontend/src/modules/login/page.structure.test.js`
- Modify: `frontend/src/App.vue`

- [ ] **Step 1: Write the failing tests**

Extend or update assertions so they require:

- `frontend/src/modules/login/page.structure.test.js` contains `暂存间系统`
- `frontend/src/App.runtime.test.js` can render the `staging` route using the standalone module shell label

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test:run -- src/modules/login/page.structure.test.js src/App.runtime.test.js
```

Expected:

- Login page still says `暂存间管理`
- App shell does not yet cover the desired `staging` standalone-module case

- [ ] **Step 3: Write the minimal implementation**

Update:

- `staging-management/index.js` title/subtitle/module metadata
- login option label from `暂存间管理` to `暂存间系统`
- shared `moduleLabelMap.staging` in `App.vue`
- `App.vue` standalone-shell condition so `staging` follows the independent module shell rather than central navigation shell

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm run test:run -- src/modules/login/page.structure.test.js src/App.runtime.test.js
```

Expected:

- PASS for login structure and shell behavior tests

## Chunk 3: Auth And Route Contract Verification

### Task 3: Preserve the `staging` auth mapping and route access behavior

**Files:**
- Modify: `frontend/src/auth.test.js`
- Modify: `frontend/src/lib/authRouting.test.js`
- Verify: `frontend/src/auth.js`
- Verify: `frontend/src/lib/authRouting.js`

- [ ] **Step 1: Write the failing tests**

Add or update assertions to require:

- `resolveModuleHome("staging") === "/staging-management"`
- authenticated `staging` sessions stay inside `staging` routes and are redirected away from central routes

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test:run -- src/auth.test.js src/lib/authRouting.test.js
```

Expected:

- Existing coverage is incomplete for explicit staging-home verification

- [ ] **Step 3: Write the minimal implementation**

Only adjust implementation if the tests expose a real mismatch. Otherwise keep the auth and routing code unchanged and let the new tests codify the contract.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm run test:run -- src/auth.test.js src/lib/authRouting.test.js
```

Expected:

- PASS with explicit `staging` mapping coverage

## Chunk 4: Final Verification

### Task 4: Run focused end-to-end frontend verification for this change set

**Files:**
- Verify: `frontend/src/modules/staging-management/*`
- Verify: `frontend/src/modules/login/page.vue`
- Verify: `frontend/src/App.vue`
- Verify: `frontend/src/auth.js`

- [ ] **Step 1: Run the full focused test slice**

Run:

```bash
npm run test:run -- src/modules/staging-management/model.test.js src/modules/staging-management/page.runtime.test.js src/modules/login/page.structure.test.js src/App.runtime.test.js src/auth.test.js src/lib/authRouting.test.js
```

Expected:

- PASS across the staging module, login, app shell, auth, and routing coverage

- [ ] **Step 2: Build the frontend bundle**

Run:

```bash
npm run build
```

Expected:

- Successful Vite production build

- [ ] **Step 3: Review changed files**

Run:

```bash
git diff -- frontend/src/modules/staging-management frontend/src/modules/login/page.vue frontend/src/App.vue frontend/src/auth.test.js frontend/src/lib/authRouting.test.js docs/superpowers/specs/2026-03-23-staging-system-design.md docs/superpowers/plans/2026-03-23-staging-system-implementation.md
```

Expected:

- Only the intended staging-module integration, labels, tests, and docs are changed
