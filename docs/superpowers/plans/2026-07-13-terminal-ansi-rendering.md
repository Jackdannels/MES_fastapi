# Local Terminal ANSI Rendering Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve colored local-server logs in Windows Terminal and prevent ANSI escape fragments in legacy CMD fallback windows.

**Architecture:** The local launcher detects `wt.exe` at the terminal boundary. It launches the existing command strings in Windows Terminal when available. The fallback preserves the existing CMD behavior but supplies Uvicorn's no-color flag only to the backend command.

**Tech Stack:** Windows PowerShell, Windows Terminal, cmd.exe, Uvicorn, Pester.

---

## Chunk 1: Launcher selection and validation

### Task 1: Cover the terminal-launch contract

**Files:**
- Modify: `tests/launcher/MesServiceControl.Tests.ps1`
- Modify: `tests/core/test_local_run.py`
- Modify: `scripts/run_local.py`

- [ ] **Step 1: Write failing assertions**

Assert that `start-dev.ps1` detects `wt.exe`, contains a Windows Terminal backend launch, and contains a CMD fallback backend command with `--no-use-colors`. Add a subprocess regression test that invokes `scripts/run_local.py --no-use-colors --help` successfully, proving the wrapper accepts the fallback argument.

- [ ] **Step 2: Run the focused Pester test**

Run: `Invoke-Pester .\tests\launcher\MesServiceControl.Tests.ps1 -Output Detailed`

Expected: FAIL because the launcher has no Windows Terminal selection or no-color fallback.

- [ ] **Step 3: Implement the smallest launcher change**

In `start-dev.ps1`, resolve `wt.exe`; use it to open named backend/frontend tabs. Keep the existing `cmd.exe` behavior as fallback and append `--no-use-colors` only in the fallback backend command. In `scripts/run_local.py`, parse this boolean option and append the equivalent Uvicorn option.

- [ ] **Step 4: Run focused verification**

Run: `Invoke-Pester .\tests\launcher\MesServiceControl.Tests.ps1 -Output Detailed`

Expected: PASS.

- [ ] **Step 5: Parse the launcher**

Run: `[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path .\start-dev.ps1), [ref]$null, [ref]$errors)`

Expected: no parser errors.

Note: Do not create a git commit; project rules require explicit user authorization for commits.
