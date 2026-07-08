@C:\Users\12051\.codex\RTK.md

# Project Rules

- Do not create git commits, push branches, or submit git changes unless the user explicitly asks for that exact git operation.
- The project uses MQTT mode for all laboratories except 高低温湿热二室.
- 高低温湿热二室 has no upper computer. This laboratory only uses mock mode via hostless local simulation; do not remove or "clean up" this exception by mistake.
- Keep task, tray, laboratory, process, storage, and device workflow business rules shared between MQTT events and any local hostless simulation. The only allowed difference is the physical device interface boundary for 高低温湿热二室.
