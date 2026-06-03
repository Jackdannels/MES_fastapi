@C:\Users\12051\.codex\RTK.md

# Project Rules

- When changing task, tray, laboratory, process, storage, or device workflow behavior, consider both mock mode and MQTT mode in the same change.
- Keep mock and MQTT behavior identical except for the physical device interface boundary. Domain state transitions, completion rules, tray scoping, schedule/task status derivation, and UI-visible data must use the same shared method or the same business-service pattern wherever practical.
- Prefer extracting one shared implementation over duplicating logic in mock-specific and MQTT-specific paths; do not maintain two independent versions of the same business rule.
- Add or update tests for both paths when a behavior can be reached through both mock/API flows and MQTT events.
- If a change intentionally differs between mock and MQTT, document the reason in the code or test name.
