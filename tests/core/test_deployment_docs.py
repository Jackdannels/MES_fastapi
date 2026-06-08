from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def test_env_example_documents_mqtt_and_upper_computer_settings():
    env_example = (REPO_ROOT / ".env.example").read_text(encoding="utf-8")

    assert "MQTT_ENABLED=false" in env_example
    assert "MQTT_TOPIC_PREFIX=mes/v1" in env_example
    assert "UPPER_COMPUTER_SIMULATOR_AUTO_ENABLE=false" in env_example
    assert "UPPER_COMPUTER_SIMULATOR_URL=http://127.0.0.1:8899" in env_example
    assert "C:\\Users\\12051" not in env_example


def test_readme_avoids_machine_specific_desktop_paths():
    readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")

    assert "C:\\Users\\12051" not in readme
    assert "start-dev.bat" in readme
    assert "npm run serve:public" in readme
    assert "lab_code" in readme
    assert "run_no" in readme
