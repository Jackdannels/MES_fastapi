"""Transport acceptance against an explicitly selected native test installation.

Creates one LIMS task and sends MQTT commands for a synthetic run. Run only on
an isolated acceptance database/broker, never a production device interface.
"""
import argparse
import json
from pathlib import Path
import threading
import time
import urllib.request
import uuid


def main(config_path):
    import paho.mqtt.client as mqtt
    cfg = json.loads(Path(config_path).read_text(encoding="utf-8"))
    ports, values = cfg["ports"], cfg["environment"]
    if not cfg["instance"].startswith(("MESPreview", "MESRestore", "MESAccept")):
        raise ValueError("Transport acceptance requires a dedicated test instance")
    def api(path, data=None):
        request = urllib.request.Request(f"http://127.0.0.1:{ports['lims']}" + path,
            data=json.dumps(data).encode() if data is not None else None,
            headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.load(response)
    task = api("/api/tasks/generate", {})
    dispatch = api("/api/tasks/send", task)
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        records = api("/api/interactions?task_code=" + task["code"])
        if records["total"]:
            break
        time.sleep(.2)
    else:
        raise AssertionError("LIMS did not receive the MES HTTP receipt")
    received, subscribed = [], threading.Event()
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="native-accept-" + uuid.uuid4().hex)
    client.username_pw_set(values["MQTT_USERNAME"], values["MQTT_PASSWORD"])
    def on_connect(client, *_args):
        client.subscribe([("mes/v1/labs/+/events/#", 1), ("mes/v1/labs/+/telemetry/snapshot", 1)])
    client.on_connect = on_connect
    client.on_subscribe = lambda *_args: subscribed.set()
    client.on_message = lambda _client, _data, packet: received.append((packet.topic, json.loads(packet.payload)))
    client.connect("127.0.0.1", ports["mqtt"])
    client.loop_start()
    try:
        assert subscribed.wait(5)
        run = "NATIVE-ACCEPT-" + uuid.uuid4().hex[:10]
        for command, event in (("fixture-install", "fixture-ready"), ("experiment-ready", "experiment-started"), ("experiment-end-request", "experiment-ended")):
            before = len(received)
            client.publish("mes/v1/labs/LAB_SALT/commands/" + command, json.dumps({"lab_code": "LAB_SALT", "run_no": run}), qos=1).wait_for_publish(5)
            deadline = time.monotonic() + 6
            while time.monotonic() < deadline:
                matches = [payload for topic, payload in received[before:] if topic.endswith("/events/" + event)]
                if matches:
                    if event != "fixture-ready":
                        assert matches[-1]["run_no"] == run
                    break
                time.sleep(.05)
            else:
                raise AssertionError("Missing MQTT reply: " + event)
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            labs = {topic.split("/")[3] for topic, _payload in received if topic.endswith("/telemetry/snapshot")}
            if len(labs) == 11:
                break
            time.sleep(.2)
        assert len(labs) == 11
        print(json.dumps(dict(lims_dispatch=dispatch["publish_status"], http_receipts=records["total"], mqtt_fixture_ready=True,
            mqtt_started=True, mqtt_ended=True, telemetry_laboratories=len(labs))))
    finally:
        client.disconnect()
        client.loop_stop()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    main(parser.parse_args().config)
