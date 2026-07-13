# Device Reset and MES Launcher Control Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reset laboratory availability with demo tasks and turn the desktop launcher into an industrial-themed MES lifecycle controller.

**Architecture:** The reset snapshot normalizes device runtime fields while retaining device identity. A PowerShell controller owns process state, start/stop/restart operations, and a dedicated browser window; the WinForms launcher presents the selected command-list UI and invokes the controller.

**Tech Stack:** Python/FastAPI, pytest, PowerShell/Pester, C# WinForms.

---

### Task 1: Reset laboratory runtime state

**Files:**
- Modify: `app/core/demo_data_reset.py`
- Modify: `app/api/routes/tasks.py`
- Test: `tests/core/test_storage_backend.py`

- [ ] Write a failing reset-snapshot test for maintenance and disabled devices.
- [ ] Run the focused pytest test and confirm the old device state remains.
- [ ] Preserve device master fields while resetting runtime status to `可用` and clearing maintenance fields.
- [ ] Publish `mes.devices` with the task reset update and rerun focused tests.

### Task 2: Launcher lifecycle controller

**Files:**
- Create: `scripts/mes-service-control.ps1`
- Modify: `start-dev.ps1`
- Modify: `tools/launcher/MesLauncher.cs`
- Test: `tests/launcher/MesServiceControl.Tests.ps1`

- [ ] Write failing Pester tests for no-process stop, duplicate start, and state-file process tracking.
- [ ] Run Pester and confirm missing controller behavior.
- [ ] Add controller actions for status/start/stop/restart, dedicated web-window tracking, and child-process termination.
- [ ] Capture backend and frontend command-window PIDs in `start-dev.ps1`.
- [ ] Replace the launcher’s immediate startup with the selected command-list menu, confirmations, status labels, and industrial palette.
- [ ] Run Pester and compile the launcher with `scripts/build_launcher.ps1`.
