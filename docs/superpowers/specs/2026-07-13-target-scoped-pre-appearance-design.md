# Target-Scoped Pre-Experiment Appearance Inspection Design

## Decision

An experiment-preparation appearance inspection is unique per `(task_code, tray_code, target_experiment_code)`, not per tray. A post-experiment appearance cycle and its dispatch to staging never satisfy or block a future experiment's pre-inspection cycle.

## Event model

Appearance storage events will retain the existing `room` and `action` fields and add:

- `appearance_phase`: `pre_experiment` or `post_experiment`;
- `experiment_code`: the intended experiment for a pre-inspection stock-in.

Appearance stock-out events already carry `target_experiment_code`; they will also retain the phase. New fields are optional so existing MySQL/JSON event records remain readable.

## Validation

The repeat guard receives the requested target experiment code. It only blocks when it finds a prior non-withdrawn `pre_experiment` appearance stock-out to that same target. For legacy records without phase metadata, a target-matching appearance stock-out remains sufficient evidence; a post-inspection stock-out to staging has no target experiment code and is ignored.

## Reset and shared workflow

The storage route remains the single business-rule boundary used by REST, MQTT-triggered state, and the hostless high-low-temperature/humidity simulation. No device-interface branch is added. All data will be reset at deployment, so unscoped legacy events and history records are intentionally ignored.

## Verification

Tests cover same-target rejection, salt-to-hot-humid and generic cross-experiment allowance, withdrawn dispatch recovery, and event metadata emitted by tray actions.
