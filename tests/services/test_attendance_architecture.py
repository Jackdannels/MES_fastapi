def test_attendance_compatibility_facade_reexports_leaf_services():
    from app.services import attendance_security, attendance_time
    from app.services import attendance_service

    assert attendance_service.hash_password is attendance_security.hash_password
    assert attendance_service.verify_password is attendance_security.verify_password
    assert attendance_service.build_qr_payload is attendance_security.build_qr_payload
    assert attendance_service.parse_business_datetime is attendance_time.parse_business_datetime
