# Laboratory Attendance And Role Maintenance Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-laboratory employee login, attendance tracking, completion logout prompting, and System-page role/employee maintenance.

**Architecture:** Add a focused backend attendance router with in-memory development storage matching the project's existing lightweight CRUD style. Frontend integration is split between a small attendance API client, laboratory page state/guarding, and System page table/form updates. Protected laboratory actions use a single guard so mock and MQTT UI flows share the same business rule.

**Tech Stack:** FastAPI, Pydantic, Vue 3 composition API, Vitest, pytest.

---

## File Structure

- Create `app/api/routes/attendance.py`: attendance employee/session API.
- Modify `app/api/routes/__init__.py` or `app/main.py`: include attendance router if needed.
- Create `tests/api/test_attendance.py`: backend API behavior.
- Create `frontend/src/lib/attendanceApi.js`: frontend API client.
- Create `frontend/src/lib/attendanceApi.test.js`: API request behavior.
- Modify `frontend/src/modules/laboratory/useLaboratoryPage.js`: lab session state, login guard, logout prompt timer.
- Modify `frontend/src/modules/laboratory/page.vue`: fixed header login/status slot and login/logout modals.
- Modify `frontend/src/modules/laboratory/styles.css`: project-theme attendance styles.
- Modify `frontend/src/modules/laboratory/useLaboratoryPage.test.js`: guard and logout prompt behavior.
- Modify `frontend/src/modules/system/model.js`, `useSystemPage.js`, `page.vue`, `styles.css`: role information maintenance and work-time display.
- Modify or add `frontend/src/modules/system/page.runtime.test.js`: System page employee rows.

## Task 1: Backend Attendance API

- [ ] Write failing pytest coverage for seeded users, lab login, wrong password, lab restriction, logout, work-time summary, and user creation.
- [ ] Run the attendance API tests and confirm they fail because the router does not exist.
- [ ] Implement the attendance router with password hashing, seeded demo users, active session tracking, and work-time summaries.
- [ ] Register the router.
- [ ] Re-run the attendance API tests and confirm they pass.

## Task 2: Frontend API Client

- [ ] Write failing Vitest coverage for attendance API calls and request payloads.
- [ ] Implement `attendanceApi.js`.
- [ ] Re-run the client tests and confirm they pass.

## Task 3: Laboratory UI Integration

- [ ] Add failing tests for fixed unauthenticated identity slot and protected action login guard.
- [ ] Add failing tests for completion logout prompt timing behavior where feasible.
- [ ] Implement session loading, login modal state, pending-action continuation, manual logout, and completion logout prompt.
- [ ] Render the fixed header action controls before the existing "显示弹窗" action.
- [ ] Keep protected step button labels unchanged.
- [ ] Re-run focused laboratory tests.

## Task 4: System Page Role Maintenance

- [ ] Add failing tests for replacing "角色权限矩阵" with "角色信息维护" and rendering employee work time.
- [ ] Load users/work-time rows from attendance API with a static fallback for offline tests.
- [ ] Update create/edit forms to support employee display name, account, password, role, allowed labs, and status.
- [ ] Re-run focused System page tests.

## Task 5: Verification

- [ ] Run backend attendance tests.
- [ ] Run focused frontend tests for attendance API, laboratory, and System page.
- [ ] Run broader affected frontend tests if focused tests pass.
- [ ] Report exact commands and results.
