@C:\Users\12051\.codex\RTK.md

# Project Rules

- Do not create git commits, push branches, or submit git changes unless the user explicitly asks for that exact git operation.
- The project uses MQTT mode for all laboratories except 高低温湿热二室.
- 高低温湿热二室 has no upper computer. This laboratory only uses mock mode via hostless local simulation; do not remove or "clean up" this exception by mistake.
- Keep task, tray, laboratory, process, storage, and device workflow business rules shared between MQTT events and any local hostless simulation. The only allowed difference is the physical device interface boundary for 高低温湿热二室.

# Agent Usage

- Use at most five concurrently active agents for project tasks, including the primary agent.
- Behavior-parity or consistency-review agents are not required unless the user explicitly requests one for a specific task.

# Risk-Proportional Verification

- Do not run full backend and full frontend suites after every local change. Default to the smallest deterministic test set that covers the changed behavior and its direct consumers.
- For presentation-only UI, styles, copy, isolated components, and local utilities, run focused component or module tests and frontend lint when relevant. Do not run backend tests when no backend contract or behavior is affected.
- For a localized business-rule fix, run the named regression scenario, the affected module suite, and directly related API or service tests. A dedicated intentional-behavior-change test is required.
- Run full backend tests, full frontend tests, and frontend lint only for broad or cross-cutting refactors; shared workflow, state-transition, storage, schema, concurrency, transaction, MQTT, or hostless-simulation changes; or at an explicit merge, release, or final integration boundary.
- If a change affects only one side of the application, do not run the untouched side's full suite unless an interface contract, shared fixture, or end-to-end workflow creates a credible regression path.
- Avoid duplicate verification across agents. Assign one owner for each full-suite run and run independent suites in parallel when useful.
- Do not rerun an already passing full suite unless production code, shared fixtures, test infrastructure, or relevant acceptance tests changed after that run.
- Treat test failures, uncertain impact, or evidence of wider coupling as escalation signals: expand from targeted tests to the relevant module suite, then to full suites only when the broader risk is substantiated.
