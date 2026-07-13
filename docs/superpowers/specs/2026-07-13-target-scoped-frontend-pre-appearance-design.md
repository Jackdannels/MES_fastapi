# Target-Scoped Frontend Pre-Appearance Design

## Goal

Allow a tray dispatched from staging toward a later appearance-required experiment to enter pre-experiment appearance inspection even when it has prior appearance records for another experiment.

## Design

- The frontend determines that a pre-inspection was already dispatched only from an appearance `stock_out` event.
- The event must have `appearance_phase: "pre_experiment"` and the same `target_experiment_code` as the current lab dispatch.
- Events for a different experiment and all post-experiment appearance events are ignored.
- The frontend snapshot writer emits the same explicit phase and target fields for appearance stock-in and stock-out actions.
- New data is reset and therefore requires explicit phase and target fields; no legacy unscoped fallback is added.

## Verification

- A salt-spray A pre/post cycle followed by a hot-humid B dispatch produces a pending pre-inspection appearance row and permits stock-in.
- A B pre-inspection already dispatched to its lab remains non-inbound.
- An A event and a B post-experiment event do not count as B pre-inspection.
