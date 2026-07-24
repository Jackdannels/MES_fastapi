def test_storage_compatibility_facades_reexport_policy_and_contract():
    from app.api.routes import storage
    from app.core import storage_backend, storage_contract
    from app.services import storage_schedule_lock_policy

    assert storage._validate_fixture_locked_schedules is storage_schedule_lock_policy.validate_fixture_locked_schedules
    assert storage_backend.StorageBackend is storage_contract.StorageBackend
    assert storage_backend.STORAGE_KEYS is storage_contract.STORAGE_KEYS
