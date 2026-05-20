# Local Dev Startup Design

## Goal

Provide a quick Windows startup path for the MES project that opens the backend and frontend dev servers in two separate terminal windows.

## Approach

Create a root-level PowerShell script that starts two `cmd.exe` windows. The backend window activates the `fastapi` conda environment and runs `scripts\run_local.py`; the frontend window runs Vite from `frontend`.

Add a root-level batch wrapper so the user can double-click without changing PowerShell execution policy manually. The wrapper invokes the PowerShell script with `-ExecutionPolicy Bypass` for this run only.

## Behavior

- Backend starts with `python scripts\run_local.py --reload --host 0.0.0.0 --port 8000`.
- Frontend starts with `npm run dev -- --host 0.0.0.0`.
- Each service has its own terminal window and keeps the window open after failures.
- The frontend window waits for `http://127.0.0.1:8000/api/storage` before starting Vite, preventing early proxy connection-refused noise while the backend is still booting.
- The PowerShell script resolves the project root from its own file location.
- The backend command resolves `conda.bat` from the current environment, PATH, or common Anaconda/Miniconda install paths.
- `-DryRun` prints the resolved backend and frontend commands without opening windows.

## Verification

- PowerShell parser check for `start-dev.ps1`.
- Dry-run check for expected backend/frontend commands.
- Batch file content check for expected script invocation.
- Git status review before final response.
