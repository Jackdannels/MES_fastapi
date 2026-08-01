import pytest

from app.core.master_data import (
    LAB_INTERFACE_HOSTLESS,
    LAB_INTERFACE_MQTT,
    LAB_INTERFACE_OPERATION_EXPERIMENT_END,
    LAB_INTERFACE_OPERATION_EXPERIMENT_END_REQUEST,
    LAB_INTERFACE_OPERATION_EXPERIMENT_READY,
    LAB_INTERFACE_OPERATION_EXPERIMENT_START,
    LAB_INTERFACE_OPERATION_FIXTURE_READY,
    LAB_INTERFACE_OPERATION_SAMPLE_INSTALL,
    laboratory_interface_for_operation,
)


@pytest.mark.parametrize(
    "operation",
    [
        LAB_INTERFACE_OPERATION_SAMPLE_INSTALL,
        LAB_INTERFACE_OPERATION_FIXTURE_READY,
    ],
)
def test_hot_humid_laboratory_two_keeps_only_fixture_operations_hostless(operation: str) -> None:
    assert laboratory_interface_for_operation(
        operation=operation,
        lab_code="LAB_HOT_HUMID_2",
        lab_name="高低温湿热二室",
    ) == LAB_INTERFACE_HOSTLESS


@pytest.mark.parametrize(
    "operation",
    [
        LAB_INTERFACE_OPERATION_EXPERIMENT_READY,
        LAB_INTERFACE_OPERATION_EXPERIMENT_START,
        LAB_INTERFACE_OPERATION_EXPERIMENT_END_REQUEST,
        LAB_INTERFACE_OPERATION_EXPERIMENT_END,
    ],
)
def test_hot_humid_laboratory_two_uses_mqtt_for_the_full_experiment_lifecycle(operation: str) -> None:
    assert laboratory_interface_for_operation(
        operation=operation,
        lab_code="LAB_HOT_HUMID_2",
        lab_name="高低温湿热二室",
    ) == LAB_INTERFACE_MQTT


@pytest.mark.parametrize("operation", ["", "future_experiment_operation"])
def test_hot_humid_laboratory_two_unknown_operations_fail_closed_to_mqtt(operation: str) -> None:
    assert laboratory_interface_for_operation(
        operation=operation,
        lab_code="LAB_HOT_HUMID_2",
    ) == LAB_INTERFACE_MQTT


def test_other_laboratories_use_mqtt_for_fixture_operations() -> None:
    assert laboratory_interface_for_operation(
        operation=LAB_INTERFACE_OPERATION_FIXTURE_READY,
        lab_code="LAB_SALT",
        lab_name="盐雾试验室",
    ) == LAB_INTERFACE_MQTT
