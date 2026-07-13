# Local Terminal ANSI Rendering Design

## Goal

Make the local development launcher preserve Uvicorn's colored log rendering while ensuring legacy-console fallback output never exposes ANSI control sequences.

## Design

- `start-dev.ps1` detects `wt.exe` before creating service terminals.
- When available, it opens dedicated Windows Terminal tabs for backend and frontend commands. Multiword tab titles are explicitly quoted because `Start-Process -ArgumentList` joins its values before Windows Terminal parses them. Windows Terminal renders ANSI colors, so Uvicorn logs remain colored and readable.
- When Windows Terminal is unavailable, it continues to use separate `cmd.exe` windows. The backend command adds Uvicorn's `--no-use-colors` option, preventing literal ANSI escape fragments.
- `scripts/run_local.py` accepts that launcher option and forwards it to Uvicorn; this keeps the launcher and its Python wrapper in the same command-line contract.
- Commands, ports, readiness checks, process-state output, and browser-launch behavior are unchanged.

## Verification

- Add Pester source-level assertions for Windows Terminal detection, its backend launch, and the fallback no-color backend command.
- Run the focused launcher Pester suite and a PowerShell syntax parse of `start-dev.ps1`.
