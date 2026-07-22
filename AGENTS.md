@C:\Users\12051\.codex\RTK.md

# Project Rules

- Do not create git commits, push branches, or submit git changes unless the user explicitly asks for that exact git operation.
- The project uses MQTT mode for all laboratories except 高低温湿热二室.
- 高低温湿热二室 has no upper computer. This laboratory only uses mock mode via hostless local simulation; do not remove or "clean up" this exception by mistake.
- Keep task, tray, laboratory, process, storage, and device workflow business rules shared between MQTT events and any local hostless simulation. The only allowed difference is the physical device interface boundary for 高低温湿热二室.

# Refactoring Behavior-Parity Guard

- For every refactor that touches task, tray, laboratory, process, storage, device, history, status derivation, or state transitions, reserve one additional independent agent as the behavior-parity reviewer before implementation starts. This agent must not edit production code or the acceptance tests under review.
- Before the first production-code edit, use the same deterministic fixture or isolated database snapshot to capture executable characterization tests or a reproducible baseline for the affected real scenarios. Freeze business time and generated identifiers where they affect results, then compare the same inputs and snapshot after the refactor.
- Every previously fixed real workflow defect in the affected area must remain as a named regression scenario; its assertions must not be deleted, skipped, relaxed, or replaced with implementation-detail checks.
- The parity review must cover, where applicable: HTTP status and response body, database state and event/history records, cross-page tray status/target/time derivation, and both MQTT and hostless simulation paths. Preserve the 高低温湿热二室 exception.
- Observable business behavior is zero-difference by default. Normalize only non-business transport metadata such as MQTT envelopes, acknowledgements, request IDs, and response headers; permissions, business state, event meaning, and business timestamps must remain identical. Any intentional behavior change must be identified, approved by the user, and covered by a dedicated test instead of being treated as refactoring.
- A refactor is complete only after the required risk-proportional verification passes and the behavior-parity reviewer reports the commands and an explicit `APPROVE` or `REJECT`. Reuse `frontend/src/modules/samples/trayFlowConsistency.test.js` for cross-page consistency and the existing laboratory API/service tests for MQTT and hostless simulation where applicable.

# Risk-Proportional Verification

- Do not run full backend and full frontend suites after every local change. Default to the smallest deterministic test set that covers the changed behavior and its direct consumers.
- For presentation-only UI, styles, copy, isolated components, and local utilities, run focused component or module tests and frontend lint when relevant. Do not run backend tests when no backend contract or behavior is affected.
- For a localized business-rule fix, run the named regression scenario, the affected module suite, directly related API or service tests, and cross-page consistency tests where status, target, or time derivation is involved. A dedicated intentional-behavior-change test is required.
- Run full backend tests, full frontend tests, and frontend lint only for broad or cross-cutting refactors; shared workflow, state-transition, storage, schema, concurrency, transaction, MQTT, or hostless-simulation changes; or at an explicit merge, release, or final integration boundary.
- If a change affects only one side of the application, do not run the untouched side's full suite unless an interface contract, shared fixture, or end-to-end workflow creates a credible regression path.
- Avoid duplicate verification across agents. Assign one owner for each full-suite run, run independent suites in parallel, and let the behavior-parity reviewer inspect those results plus independently execute the critical targeted scenarios before issuing `APPROVE` or `REJECT`.
- Do not rerun an already passing full suite unless production code, shared fixtures, test infrastructure, or relevant acceptance tests changed after that run.
- Treat test failures, uncertain impact, or evidence of wider coupling as escalation signals: expand from targeted tests to the relevant module suite, then to full suites only when the broader risk is substantiated.

# Agent Review Handoff

- Start the independent behavior-parity reviewer before implementation, but let it perform baseline capture, scenario mapping, and read-only risk review concurrently while the implementation agent works.
- The implementation agent must send one structured `READY_FOR_REVIEW` handoff containing the exact production and test files changed, the frozen fixture or baseline, the red-test evidence, targeted green-test commands and results, and any unresolved risk. Do not make the reviewer rediscover this information by polling the worktree.
- Assign verification ownership before commands run. The implementation agent owns red tests and focused green tests; the reviewer owns independent critical-scenario verification and any required full-suite run. The primary agent must not repeat those commands unless code changed afterward or a reported result is incomplete or suspect.
- After the handoff, the reviewer must inspect the final diff and return one final message with the commands run, material parity findings, and an explicit `APPROVE` or `REJECT`. Intermediate reviewer updates should be limited to concrete blockers or required coverage changes.
- The primary agent should wait for agent completion through agent notifications or the agent wait mechanism. Do not poll readiness with repeated `git status`, `git diff`, `rg`, no-op commands, RTK statistics, or duplicate test runs.
- If an agent has not reported within the normal communication window, request status once. Continue useful non-duplicative local work if available; otherwise wait. Escalate only when the agent reports a blocker or exceeds a reasonable task-specific timeout.
- For local fixes that do not trigger the behavior-parity reviewer rule, use one implementation owner and skip the reviewer gate unless the user explicitly requests multiple agents or independent review.
