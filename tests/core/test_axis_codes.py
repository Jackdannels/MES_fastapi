from app.core.axis_codes import (
    IMPACT_AXIS_CODES,
    VIBRATION_AXIS_CODES,
    normalize_axis_codes_for_experiment_type,
    sort_axis_codes,
)


def test_axis_sequences_match_impact_and_vibration_business_rules() -> None:
    assert IMPACT_AXIS_CODES == ("x+", "x-", "y+", "z+", "y-", "z-")
    assert VIBRATION_AXIS_CODES == ("x", "y+", "z+", "y-", "z-")
    assert sort_axis_codes(["z-", "y-", "z+", "y+", "x-", "x+"]) == list(IMPACT_AXIS_CODES)


def test_vibration_accepts_only_directionless_x_and_directional_y_z_codes() -> None:
    assert normalize_axis_codes_for_experiment_type(
        ["z-", "x", "y-", "z+", "y+"],
        "振动试验",
    ) == list(VIBRATION_AXIS_CODES)
    assert normalize_axis_codes_for_experiment_type(["x+", "x-"], "振动试验") == []
