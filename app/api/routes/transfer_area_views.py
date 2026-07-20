import re
from typing import Any


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def as_list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def task_code(task: dict[str, Any]) -> str:
    return normalize_text(task.get("code"))


def task_key(task: dict[str, Any]) -> str:
    return normalize_text(task.get("id")) or task_code(task)


def sample_key(sample: dict[str, Any]) -> str:
    return normalize_text(sample.get("id")) or normalize_text(sample.get("code"))


def sample_code(sample: dict[str, Any]) -> str:
    return normalize_text(sample.get("code"))


def sample_task_code(sample: dict[str, Any]) -> str:
    return normalize_text(sample.get("task_code"))


def sample_sort_key(sample: dict[str, Any]) -> tuple[str, str]:
    return (sample_code(sample), sample_key(sample))


def sample_serial_sort_key(sample: dict[str, Any]) -> tuple[int, str, str]:
    matched = re.search(r"-SP-(\d+)$", sample_code(sample))
    serial = int(matched.group(1)) if matched else 1000
    return (serial, sample_code(sample), sample_key(sample))


def build_sample_experiment_map(
    task: dict[str, Any],
    task_samples: list[dict[str, Any]],
    experiment_trays: list[dict[str, Any]],
    experiment_samples: list[dict[str, Any]],
) -> dict[str, list[str]]:
    task_code_value = task_code(task)
    sample_experiment_codes: dict[str, set[str]] = {}
    for entry in experiment_samples:
        if normalize_text(entry.get("task_code")) != task_code_value:
            continue
        sample_code_value = normalize_text(entry.get("sample_code"))
        experiment_code_value = normalize_text(entry.get("experiment_code"))
        if sample_code_value and experiment_code_value:
            sample_experiment_codes.setdefault(sample_code_value, set()).add(experiment_code_value)

    tray_experiment_codes: dict[str, set[str]] = {}
    for entry in experiment_trays:
        if normalize_text(entry.get("task_code")) != task_code_value:
            continue
        tray_code_value = normalize_text(entry.get("tray_code"))
        experiment_code_value = normalize_text(entry.get("experiment_code"))
        if tray_code_value and experiment_code_value:
            tray_experiment_codes.setdefault(tray_code_value, set()).add(experiment_code_value)

    for sample in task_samples:
        sample_code_value = sample_code(sample)
        if not sample_code_value:
            continue
        for tray in as_list(sample.get("trays")):
            tray_code_value = normalize_text(tray.get("tray_code"))
            for experiment_code_value in tray_experiment_codes.get(tray_code_value, set()):
                sample_experiment_codes.setdefault(sample_code_value, set()).add(experiment_code_value)

    return {code: sorted(values) for code, values in sample_experiment_codes.items()}


def experiment_type_label(experiment: dict[str, Any]) -> str:
    return normalize_text(experiment.get("required_device")) or normalize_text(experiment.get("experiment_name"))


def build_experiment_summary(task: dict[str, Any], experiments: list[dict[str, Any]]) -> str:
    task_code_value = task_code(task)
    labels: list[str] = []
    for experiment in experiments:
        if normalize_text(experiment.get("task_code")) != task_code_value:
            continue
        label = experiment_type_label(experiment)
        if label and label not in labels:
            labels.append(label)
    return " / ".join(labels)
