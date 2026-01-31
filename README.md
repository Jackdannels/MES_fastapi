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

Implemented CRUD (in-memory for now):
- technologies
- workflows
- manufactureplan
- device
- material
- warehouse
- quality
- report
- yt_log
- yt_report

Endpoints for CRUD modules:
- GET /<module>
- GET /<module>/{id}
- POST /<module>
- PUT /<module>/{id}
- DELETE /<module>/{id}

Other modules currently expose:
- GET /<module>
- POST /<module>

Requirements:
- Python 3.10+
- Dameng client libs installed
- dmPython driver (or adjust app/db/session.py)

Quick start:
1) python -m venv .venv
2) .venv\Scripts\activate
3) pip install -r requirements.txt
4) copy .env.example to .env and update values
5) cd frontend
6) npm install
7) npm run build
8) cd ..
9) uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

Frontend dev (optional):
1) cd frontend
2) npm install
3) npm run dev

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
