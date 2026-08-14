"""Public storage backend contract and runtime-level keys."""

from typing import Any, Dict, Iterable


STORAGE_META_KEY = "mes.meta"
CURRENT_SCHEMA_VERSION = 2
MYSQL_HEALTHCHECK_TIMEOUT_SECONDS = 3
RUNTIME_STORAGE_BACKEND = "mysql"
UNSUPPORTED_RUNTIME_BACKEND_DETAIL = "Only mysql runtime storage is supported"

STORAGE_KEYS: Iterable[str] = (
    "mes.tasks",
    "mes.external_task_intakes",
    "mes.lims_inbox",
    "mes.lims_outbox",
    "mes.schedules",
    "mes.experiments",
    "mes.experiment_runs",
    "mes.experiment_run_pauses",
    "mes.experiment_run_trays",
    "mes.experiment_run_steps",
    "mes.experiment_trays",
    "mes.experiment_samples",
    "mes.samples",
    "mes.staging_events",
    "mes.devices",
    "mes.maintenance_records",
    "mes.streams",
    "mes.conflicts",
    "mes.test_data_settings",
    "mes.test_data_exports",
)


class StorageBackend:
    """Minimal contract shared by runtime and isolated test backends."""

    def read_all(self) -> Dict[str, Any]:
        raise NotImplementedError

    def read(self, key: str) -> Any:
        raise NotImplementedError

    def write(self, key: str, value: Any) -> None:
        raise NotImplementedError

    def write_many(self, updates: Dict[str, Any]) -> None:
        raise NotImplementedError
