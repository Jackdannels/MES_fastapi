import json

import pytest

from app.core.config import Settings
from app.services.lims_rabbitmq import INTAKE_MESSAGE_TYPE, LimsRabbitRuntime


def test_lims_rabbitmq_decodes_versioned_intake_envelope():
    envelope = {
        "message_id": "MSG-1",
        "correlation_id": "LIMS-1",
        "type": INTAKE_MESSAGE_TYPE,
        "schema_version": 1,
        "payload": {"lims_request_id": "LIMS-1", "code": "TASK-1"},
    }

    decoded, payload = LimsRabbitRuntime._decode_envelope(json.dumps(envelope).encode())

    assert decoded["message_id"] == "MSG-1"
    assert payload["code"] == "TASK-1"


@pytest.mark.parametrize(
    "patch",
    [
        {"type": "unsupported.v1"},
        {"schema_version": 2},
        {"message_id": ""},
        {"payload": []},
    ],
)
def test_lims_rabbitmq_rejects_invalid_envelopes(patch):
    envelope = {
        "message_id": "MSG-1",
        "type": INTAKE_MESSAGE_TYPE,
        "schema_version": 1,
        "payload": {"code": "TASK-1"},
        **patch,
    }

    with pytest.raises(ValueError):
        LimsRabbitRuntime._decode_envelope(json.dumps(envelope).encode())


def test_lims_rabbitmq_is_disabled_by_default_for_isolated_tests():
    runtime = LimsRabbitRuntime(Settings(_env_file=None))

    assert runtime.status()["enabled"] is False
    assert runtime.status()["connected"] is False
