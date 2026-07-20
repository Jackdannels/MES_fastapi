@C:\Users\12051\.codex\RTK.md

# Project Rules

- Do not create git commits, push branches, or submit git changes unless the user explicitly asks for that exact git operation.
- The project uses MQTT mode for all laboratories except 高低温湿热二室.
- 高低温湿热二室 has no upper computer. This laboratory only uses mock mode via hostless local simulation; do not remove or "clean up" this exception by mistake.
- Keep task, tray, laboratory, process, storage, and device workflow business rules shared between MQTT events and any local hostless simulation. The only allowed difference is the physical device interface boundary for 高低温湿热二室.

# Ponytail Mode Routing

- Use Ponytail `lite` by default.
- Codex may automatically apply Ponytail `full` for a single low-risk task when the work is limited to ordinary CRUD, presentation-only UI, small utilities or scripts, formatting, or removal of duplication that has no business-semantic effect.
- Before automatically applying `full`, state the temporary mode choice in a short progress update. Return to `lite` for the next task; do not persist `full` as the default.
- Keep `lite` for MQTT behavior, device integration or control, laboratory workflows, task/tray/process/storage state transitions, concurrency, transactions, authentication or authorization, security boundaries, data migrations, and any change involving 高低温湿热二室 or hostless local simulation.
- If task risk or business impact is uncertain, keep `lite`.
- Never use Ponytail `ultra` unless the user explicitly requests it for the current task.
- Ponytail must not simplify away project business rules, validation, error handling, observability, recovery behavior, hardware calibration, or tests needed in proportion to risk. Project rules always take precedence over Ponytail's preference for shorter code.
