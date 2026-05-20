# Local Dev Startup Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one-click local development startup scripts for backend and frontend services.

**Architecture:** A PowerShell script owns startup logic and launches two independent `cmd.exe` windows. A batch wrapper calls the PowerShell script with execution-policy bypass for easy double-click usage.

**Tech Stack:** Windows PowerShell, cmd.exe, conda, Python/FastAPI, npm/Vite.

---

## Chunk 1: Startup Scripts

### Task 1: Add PowerShell Startup Script

**Files:**
- Create: `start-dev.ps1`

- [ ] **Step 1: Create script**

Add a root-level script that resolves the repo root, locates `conda.bat`, starts the backend command in one window, waits for backend readiness before starting the frontend command in another window, and supports `-DryRun` for non-launch verification.

- [ ] **Step 2: Verify script parses**

Run: `powershell -NoProfile -Command "$null = [System.Management.Automation.Language.Parser]::ParseFile('start-dev.ps1', [ref]$null, [ref]$errors); if ($errors.Count) { $errors | ForEach-Object { $_.Message }; exit 1 }"`

Expected: command exits successfully.

- [ ] **Step 3: Verify dry run output**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File .\start-dev.ps1 -DryRun`

Expected: output includes `Waiting for backend`, `python scripts\run_local.py --reload --host 0.0.0.0 --port 8000`, and `npm run dev -- --host 0.0.0.0`.

### Task 2: Add Double-Click Wrapper

**Files:**
- Create: `start-dev.bat`

- [ ] **Step 1: Create wrapper**

Add a root-level batch file that calls `start-dev.ps1` via PowerShell with `-ExecutionPolicy Bypass`.

- [ ] **Step 2: Verify expected references**

Run: inspect `start-dev.bat` and confirm it calls `start-dev.ps1`.

Expected: wrapper contains `powershell.exe` and `start-dev.ps1`.
