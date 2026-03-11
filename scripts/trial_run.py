import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from http.cookiejar import CookieJar
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from dotenv import dotenv_values

from app.core.local_run import build_local_run_env


TRUTHY_ENV_VALUES = {"1", "true", "yes", "on"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Start the local server and verify health plus auth endpoints. "
            "The script checks / as 404 in API-only mode, or as the frontend entry when "
            "SERVE_WEB_APP=true is set in the env file."
        ),
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8010)
    parser.add_argument(
        "--env-file",
        default=".env",
        help="Path to the env file. SERVE_WEB_APP controls whether / should be 404 or a web page.",
    )
    parser.add_argument("--module", default="central")
    return parser.parse_args()


def build_trial_run_server_env(
    base_env: dict[str, str],
    dotenv_values_map: dict[str, str | None],
) -> dict[str, str]:
    return build_local_run_env(
        base_env,
        dotenv_values_map,
        overrides={"SESSION_COOKIE_SECURE": "false"},
    )


def build_trial_run_server_command(*, host: str, port: int, env_file: str) -> list[str]:
    return [
        sys.executable,
        "scripts/run_local.py",
        "--host",
        host,
        "--port",
        str(port),
        "--env-file",
        env_file,
    ]


def should_expect_web_app(env_values_map: dict[str, str]) -> bool:
    return env_values_map.get("SERVE_WEB_APP", "").strip().lower() in TRUTHY_ENV_VALUES


def fetch_json(opener, url: str, method: str = "GET", payload: dict | None = None):
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with opener.open(request, timeout=5) as response:
        body = response.read().decode("utf-8")
        return response.status, json.loads(body) if body else None, dict(response.headers)


def fetch_text(opener, url: str):
    with opener.open(url, timeout=5) as response:
        return response.status, response.read().decode("utf-8"), dict(response.headers)


def wait_for_health(base_url: str, server: subprocess.Popen[str]):
    opener = urllib.request.build_opener()
    for _ in range(40):
        if server.poll() is not None:
            stderr = server.stderr.read() if server.stderr else ""
            raise RuntimeError(f"Server exited before becoming ready.\n{stderr}")
        try:
            return fetch_json(opener, f"{base_url}/health")
        except Exception:
            time.sleep(0.5)
    stderr = server.stderr.read() if server.stderr else ""
    raise RuntimeError(f"Server did not become ready.\n{stderr}")


def main() -> int:
    args = parse_args()
    dotenv_map = dotenv_values(REPO_ROOT / args.env_file)
    env_values = {key: value for key, value in dotenv_map.items() if value is not None}
    expect_web_app = should_expect_web_app(env_values)
    username = env_values.get("DEMO_USER")
    password = env_values.get("DEMO_PASSWORD")
    if not username or not password:
        raise SystemExit("DEMO_USER and DEMO_PASSWORD must be set in the env file for trial runs.")

    server = subprocess.Popen(
        build_trial_run_server_command(host=args.host, port=args.port, env_file=args.env_file),
        cwd=REPO_ROOT,
        env=build_trial_run_server_env(dict(os.environ), dotenv_map),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    base_url = f"http://{args.host}:{args.port}"

    try:
        health_status, health_payload, _ = wait_for_health(base_url, server)
        root_html = ""
        try:
            root_status, root_html, _ = fetch_text(urllib.request.build_opener(), f"{base_url}/")
        except urllib.error.HTTPError as exc:
            root_status = exc.code
            root_html = exc.read().decode("utf-8", errors="ignore")

        if expect_web_app and root_status != 200:
            raise RuntimeError(f"Expected web app at / but got HTTP {root_status}.")
        if not expect_web_app and root_status != 404:
            raise RuntimeError(f"Expected API-only 404 at / but got HTTP {root_status}.")

        cookies = CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))
        login_status, login_payload, _ = fetch_json(
            opener,
            f"{base_url}/auth/login",
            method="POST",
            payload={
                "username": username,
                "password": password,
                "module": args.module,
            },
        )
        session_status, session_payload, _ = fetch_json(opener, f"{base_url}/auth/session")
        logout_request = urllib.request.Request(f"{base_url}/auth/logout", data=b"", method="POST")
        with opener.open(logout_request, timeout=5) as logout_response:
            logout_status = logout_response.status
        try:
            fetch_json(opener, f"{base_url}/auth/session")
            post_logout_status = 200
        except urllib.error.HTTPError as exc:
            post_logout_status = exc.code

        print(
            json.dumps(
                {
                    "health_status_code": health_status,
                    "health_payload": health_payload,
                    "serve_web_app": expect_web_app,
                    "root_status_code": root_status,
                    "root_contains_app_shell": '<div id="app">' in root_html,
                    "login_status_code": login_status,
                    "login_username": login_payload["username"],
                    "login_module": login_payload["module"],
                    "session_status_code": session_status,
                    "session_username": session_payload["username"],
                    "session_module": session_payload["module"],
                    "logout_status_code": logout_status,
                    "post_logout_session_status_code": post_logout_status,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    finally:
        if server.poll() is None:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
