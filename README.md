MES FastAPI starter (Dameng/DM)

Modules:
- person
- customer
- companydepartment
- permissions
- workflows
- technologies
- yt_file
- yt_timesheet
- yt_log
- warehouse
- productcatalog
- yt_report
- quality
- manufactureplan
- report
- device
- material
- yt_barcode
- yt_object

Implemented CRUD (in-memory for now, via shared router factory):
- person
- customer
- companydepartment
- permissions
- workflows
- technologies
- yt_file
- yt_timesheet
- yt_log
- warehouse
- productcatalog
- yt_report
- quality
- manufactureplan
- report
- device
- material
- yt_barcode
- yt_object

Endpoints for CRUD modules:
- GET /<module>
- GET /<module>/{id}
- POST /<module>
- PUT /<module>/{id}
- DELETE /<module>/{id}

Special routes:
- POST /auth/login
- GET /auth/session
- POST /auth/logout
- GET /health
- GET /health/db
- GET/PUT /api/storage

Requirements:
- Python 3.10+
- Dameng client libs installed
- dmPython driver (or adjust app/db/session.py)
- Debug mode is disabled by default unless you opt in via `DEBUG=true`; the provided `.env.example` opts in for local plain-HTTP development.

Quick start:
1) python -m venv .venv
2) .venv\Scripts\activate
3) pip install -r requirements.txt
4) copy .env.example to .env and update values
   - Set `DEMO_USER` / `DEMO_PASSWORD` only if you want local demo login enabled
   - Set `SESSION_SECRET_KEY` to a non-empty random value before using auth routes
   - Leave `SESSION_COOKIE_SECURE` unset unless you need to override the default policy
5) cd frontend
6) npm install
7) npm run build
8) cd ..
9) .venv\Scripts\python.exe scripts\run_local.py --reload --host 0.0.0.0 --port 8000
10) Optional smoke check: .venv\Scripts\python.exe scripts\trial_run.py

Frontend dev (optional):
1) cd frontend
2) npm install
3) npm run dev

Frontend runtime boundary:
- Legacy static JS is bridged only for `/`, `/tasks`, `/schedule`, `/samples`, `/devices`, `/data`, and `/system`; `/login`, `/task-overview`, `/process`, `/visualization`, and `/staging-management` stay on the Vue-only path.
- Auth now uses a backend-issued `HttpOnly` cookie (`mes_session` by default). `POST /auth/login` both returns the normalized session payload and sets the cookie, `GET /auth/session` validates the cookie, refreshes the idle timer, and `POST /auth/logout` clears it.
- Session cookies default to `Secure` when `DEBUG=false`; you can override that with `SESSION_COOKIE_SECURE=true|false` if a deployment proxy needs a different policy.
- Demo login is optional. If `DEMO_USER` or `DEMO_PASSWORD` is not configured, `POST /auth/login` returns `503` instead of falling back to a repository default password.
- Signed session cookies also require `SESSION_SECRET_KEY`; if it is missing, auth endpoints fail closed with `503`.
- Session expiry is enforced on the backend: idle sessions expire after `30` minutes by default, and every session has an absolute `8` hour maximum lifetime even if it stays active.
- The frontend router validates login state through `/auth/session`; `localStorage` only keeps a cached copy of the normalized session payload for UI hydration and is cleared when the backend rejects the cookie.
- Use `scripts/run_local.py` for local startup when your machine already has conflicting environment variables; it loads `.env` and explicitly overrides inherited values for the spawned `uvicorn` process.
- Use `scripts/trial_run.py` if you want a one-command local smoke test that starts the server, checks `/health`, `/`, login, session refresh, and logout, then shuts the server down.
- Verify with `.venv\Scripts\python.exe -m pytest -v`, `cd frontend && npm run lint`, `cd frontend && npm run test:run`, and `cd frontend && npm run build`.

UI pages:
- http://127.0.0.1:8000/ (dashboard)
- http://127.0.0.1:8000/tasks
- http://127.0.0.1:8000/schedule
- http://127.0.0.1:8000/samples
- http://127.0.0.1:8000/process
- http://127.0.0.1:8000/devices
- http://127.0.0.1:8000/data
- http://127.0.0.1:8000/system

Health check:
- http://127.0.0.1:8000/health
- http://127.0.0.1:8000/health/db
