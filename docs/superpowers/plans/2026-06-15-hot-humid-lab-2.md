# 高低温湿热二室 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add “高低温湿热二室” as a second high/low temperature humid heat lab, with normal mock behavior and MQTT-only local auto confirmation/start because it has no host computer.

**Architecture:** Register the new lab in backend master data and frontend static fallbacks, then keep workflow behavior shared through existing laboratory services. Add a backend start endpoint that reuses `start_storage_laboratory_experiment`, and make the frontend treat `LAB_HOT_HUMID_2` as hostless only in MQTT mode.

**Tech Stack:** FastAPI, Pydantic, Pytest, Vue 3 Composition API, Vitest, local storage snapshot APIs.

---

## File Structure

- Modify `app/core/master_data.py`: add `LAB_HOT_HUMID_2`.
- Modify `tests/api/test_master_data.py`: assert the new lab is exposed with `GDW`.
- Modify `frontend/src/lib/labs.js`: add the second lab to static lab locations and test-type mapping.
- Modify `frontend/src/lib/moduleCatalog.js`: add the lab to login/module switching options.
- Modify `frontend/src/modules/process/model.js`: add the lab to process card fallback labs.
- Modify `frontend/src/modules/laboratory/useLaboratoryPage.js`: add static lab code mapping and MQTT-only hostless behavior.
- Create `frontend/src/lib/labHostInterfaceCapabilities.js`: central hostless capability helper.
- Modify `frontend/src/lib/laboratoryApi.js`: add a start-experiment API client.
- Modify `app/api/routes/laboratory.py`: add a start-experiment endpoint that calls `start_storage_laboratory_experiment`.
- Modify `tests/api/test_laboratory.py`: cover the new start endpoint and hot humid lab two state updates.
- Modify relevant frontend tests:
  - `frontend/src/components/shared/ModuleExitDialog.test.js`
  - `frontend/src/modules/schedule/model.test.js`
  - `frontend/src/modules/process/model.test.js`
  - `frontend/src/modules/process/useProcessLabs.test.js`
  - `frontend/src/modules/laboratory/page.runtime.test.js`
  - `frontend/src/modules/laboratory/model.test.js`

## Chunk 1: Register 高低温湿热二室

### Task 1: Backend Master Data

**Files:**
- Modify: `app/core/master_data.py`
- Test: `tests/api/test_master_data.py`
- Test: `tests/core/test_mysql_storage_backend.py`

- [ ] **Step 1: Write failing master data test**

Add an assertion to the labs API test:

```python
def test_master_labs_include_hot_humid_lab_two(client):
    response = client.get("/api/master/labs")
    assert response.status_code == 200
    labs = response.json()
    hot_humid_two = next((lab for lab in labs if lab["code"] == "LAB_HOT_HUMID_2"), None)
    assert hot_humid_two == {
        "id": hot_humid_two["id"],
        "code": "LAB_HOT_HUMID_2",
        "name": "高低温湿热二室",
        "type": "实验室",
        "testTypeId": hot_humid_two["testTypeId"],
        "testTypeCode": "GDW",
        "testTypeName": "高低温湿热试验",
        "capacity": 4,
        "locationDesc": "",
        "status": 1,
        "remark": "FRONTEND_MASTER_DATA",
    }
```

- [ ] **Step 2: Run RED**

Run:

```bash
rtk .\.venv\Scripts\python.exe -m pytest tests\api\test_master_data.py -k "hot_humid_lab_two" -v
```

Expected: FAIL because `LAB_HOT_HUMID_2` is not present.

- [ ] **Step 3: Add backend default lab**

Add to `DEFAULT_LABS` after `LAB_HOT_HUMID`:

```python
{"lab_code": "LAB_HOT_HUMID_2", "lab_name": "高低温湿热二室", "lab_type": "实验室", "test_type_code": "GDW", "capacity": 4, "location_desc": "", "status": 1, "remark": "FRONTEND_MASTER_DATA"},
```

- [ ] **Step 4: Update schema seed count tests**

If `tests/core/test_mysql_storage_backend.py` asserts the number of default lab seed statements, update the expected count from 15 to 16.

- [ ] **Step 5: Run GREEN**

Run:

```bash
rtk .\.venv\Scripts\python.exe -m pytest tests\api\test_master_data.py tests\core\test_mysql_storage_backend.py -k "master_labs or INSERT INTO md_lab" -v
```

Expected: PASS.

### Task 2: Frontend Static Lab Fallbacks

**Files:**
- Modify: `frontend/src/lib/labs.js`
- Modify: `frontend/src/lib/moduleCatalog.js`
- Modify: `frontend/src/modules/process/model.js`
- Modify: `frontend/src/modules/laboratory/useLaboratoryPage.js`
- Test: `frontend/src/components/shared/ModuleExitDialog.test.js`
- Test: `frontend/src/modules/process/model.test.js`

- [ ] **Step 1: Write failing frontend fallback tests**

Update tests to expect `"高低温湿热二室"` in:

```js
LABORATORY_OPTIONS.map((option) => option.label)
```

Add or update a process model test:

```js
test("includes hot humid lab two in process fallback labs", () => {
  const cards = buildProcessLabCards(
    PROCESS_LABS,
    [],
    [],
    [],
    Date.now(),
    [],
    [],
    [],
    [],
    [],
  );
  expect(cards.map((card) => card.name)).toContain("高低温湿热二室");
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
rtk powershell -NoProfile -Command "cd frontend; npm test -- src/components/shared/ModuleExitDialog.test.js src/modules/process/model.test.js"
```

Expected: FAIL because the frontend static lists do not include the second lab.

- [ ] **Step 3: Add static mappings**

Add `"高低温湿热二室"` to:

```js
LAB_LOCATIONS
LABORATORY_OPTIONS
PROCESS_LABS
STATIC_LAB_CODES_BY_NAME
```

Add mapping:

```js
高低温湿热二室: "高低温湿热试验"
"高低温湿热二室": "LAB_HOT_HUMID_2"
```

- [ ] **Step 4: Run GREEN**

Run:

```bash
rtk powershell -NoProfile -Command "cd frontend; npm test -- src/components/shared/ModuleExitDialog.test.js src/modules/process/model.test.js"
```

Expected: PASS.

### Task 3: Schedule Candidate Coverage

**Files:**
- Modify: `frontend/src/modules/schedule/model.test.js`
- Possibly modify: `frontend/src/modules/schedule/model.js`

- [ ] **Step 1: Write failing schedule test**

Add a test that `buildLabOptions` or the current lab candidate builder returns both high humid labs for `高低温湿热试验` when master labs are unavailable:

```js
test("buildLabOptions falls back to both hot humid labs", () => {
  const options = buildLabOptions({
    experiments: [{ required_device: "高低温湿热试验" }],
    masterLabs: [],
    selectedExperiment: { required_device: "高低温湿热试验" },
  });
  expect(options.map((option) => option.label || option)).toEqual(
    expect.arrayContaining(["高低温湿热一室", "高低温湿热二室"]),
  );
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
rtk powershell -NoProfile -Command "cd frontend; npm test -- src/modules/schedule/model.test.js -t \"hot humid\""
```

Expected: FAIL before static mapping is wired everywhere.

- [ ] **Step 3: Implement minimal schedule support**

If Chunk 1 Task 2 did not already make this pass, update `resolveLabCandidates` dependencies so `getLabsForTestType("高低温湿热试验")` returns both labs.

- [ ] **Step 4: Run GREEN**

Run:

```bash
rtk powershell -NoProfile -Command "cd frontend; npm test -- src/modules/schedule/model.test.js -t \"hot humid\""
```

Expected: PASS.

## Chunk 2: Shared Backend Start Endpoint

### Task 4: Add Start Endpoint Tests

**Files:**
- Modify: `tests/api/test_laboratory.py`
- Modify: `app/api/routes/laboratory.py`
- Modify: `frontend/src/lib/laboratoryApi.js`

- [ ] **Step 1: Write failing API test**

Add a test that posts to the new endpoint for a ready high humid lab two experiment:

```python
def test_start_current_experiment_endpoint_uses_shared_start_service(client, monkeypatch):
    storage = FakeStorage({
        "mes.tasks": [{"code": "TASK-HH2", "status": "任务进行中"}],
        "mes.experiments": [{"task_code": "TASK-HH2", "experiment_code": "EXP-HH", "experiment_name": "高低温湿热试验"}],
        "mes.schedules": [{"id": "SCH-HH2", "task_code": "TASK-HH2", "experiment_code": "EXP-HH", "device": "高低温湿热二室", "planned_hours": 2}],
        "mes.experiment_runs": [],
        "mes.experiment_run_trays": [],
        "mes.experiment_trays": [{"task_code": "TASK-HH2", "experiment_code": "EXP-HH", "tray_code": "TP-HH2"}],
        "mes.experiment_samples": [{"task_code": "TASK-HH2", "experiment_code": "EXP-HH", "sample_code": "SP-HH2"}],
        "mes.samples": [{
            "code": "SP-HH2",
            "task_code": "TASK-HH2",
            "status": "实验准备就绪",
            "flow_status": "实验准备就绪",
            "location": "高低温湿热二室",
            "trays": [{"tray_code": "TP-HH2", "status": "实验准备就绪", "quantity": 1, "target_experiment_code": "EXP-HH", "target_lab": "高低温湿热二室"}],
            "history": [],
        }],
    })
    monkeypatch.setattr(laboratory_route, "get_storage_backend", lambda: storage)

    response = client.post(
        "/api/laboratory/tasks/TASK-HH2/experiments/EXP-HH/start",
        json={"labName": "高低温湿热二室", "trayCodes": ["TP-HH2"], "startedAt": "2026-06-15 10:00:03"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["samples"][0]["trays"][0]["status"] == "实验进行中"
    assert body["experimentRuns"][0]["device"] == "高低温湿热二室"
    assert body["schedules"][0]["status"] == "实验进行中"
```

- [ ] **Step 2: Run RED**

Run:

```bash
rtk .\.venv\Scripts\python.exe -m pytest tests\api\test_laboratory.py -k "start_current_experiment_endpoint" -v
```

Expected: FAIL with 404 or missing endpoint.

- [ ] **Step 3: Implement request model and endpoint**

Add request model:

```python
class LaboratoryStartRequest(BaseModel):
    lab_code: str = Field(default="", alias="labCode")
    lab_name: str = Field(default="", alias="labName")
    run_no: str = Field(default="", alias="runNo")
    started_at: str = Field(default="", alias="startedAt")
    tray_codes: list[str] = Field(default_factory=list, alias="trayCodes")

    model_config = ConfigDict(populate_by_name=True)
```

Add `write_start_snapshot(result)` writing:

```python
{
    "mes.tasks": result["tasks"],
    "mes.samples": result["samples"],
    "mes.schedules": result["schedules"],
    "mes.experiments": result["experiments"],
    "mes.experiment_runs": result["experimentRuns"],
    "mes.experiment_run_trays": result["experimentRunTrays"],
}
```

Add route:

```python
@router.post("/tasks/{task_code}/experiments/{experiment_code}/start")
def start_current_experiment(task_code: str, experiment_code: str, request: LaboratoryStartRequest = Body(default_factory=LaboratoryStartRequest)):
    ...
```

Inside the route:

- Normalize task and experiment code.
- Read initial tray codes from request or `experiment_tray_codes`.
- Lock lab/tray resources plus `experiment:{task}:{experiment}`.
- Re-read snapshot inside locks.
- Resolve schedule by task, experiment, and lab name/code.
- Call `start_storage_laboratory_experiment`.
- Write and publish update keys.

- [ ] **Step 4: Add client function**

In `frontend/src/lib/laboratoryApi.js`, add:

```js
async function startLaboratoryExperiment({ taskCode, experimentCode, ...payload }) {
  const response = await fetch(buildApiUrl(`/api/laboratory/tasks/${encodeURIComponent(taskCode)}/experiments/${encodeURIComponent(experimentCode)}/start`, API_BASE_URL), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Failed to start laboratory experiment: ${response.status} ${response.statusText}`);
  }
  return response.json();
}
```

- [ ] **Step 5: Run GREEN**

Run:

```bash
rtk .\.venv\Scripts\python.exe -m pytest tests\api\test_laboratory.py -k "start_current_experiment_endpoint" -v
```

Expected: PASS.

## Chunk 3: MQTT-Only Hostless Behavior

### Task 5: Add Capability Helper

**Files:**
- Create: `frontend/src/lib/labHostInterfaceCapabilities.js`
- Test: `frontend/src/lib/labHostInterfaceCapabilities.test.js`

- [ ] **Step 1: Write failing helper tests**

```js
import { hostlessLabInMqtt, hostlessLabTiming } from "./labHostInterfaceCapabilities";

test("marks only hot humid lab two as hostless in MQTT", () => {
  expect(hostlessLabInMqtt({ labCode: "LAB_HOT_HUMID_2", mode: "mqtt" })).toBe(true);
  expect(hostlessLabInMqtt({ labCode: "LAB_HOT_HUMID", mode: "mqtt" })).toBe(false);
  expect(hostlessLabInMqtt({ labCode: "LAB_HOT_HUMID_2", mode: "mock" })).toBe(false);
});

test("returns the configured three second timings", () => {
  expect(hostlessLabTiming("LAB_HOT_HUMID_2")).toEqual({
    fixtureReadyDelayMs: 3000,
    experimentStartDelayMs: 3000,
  });
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
rtk powershell -NoProfile -Command "cd frontend; npm test -- src/lib/labHostInterfaceCapabilities.test.js"
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement helper**

```js
const HOSTLESS_MQTT_LABS = Object.freeze({
  LAB_HOT_HUMID_2: {
    fixtureReadyDelayMs: 3000,
    experimentStartDelayMs: 3000,
  },
});

const normalizeText = (value) => String(value ?? "").trim();

function hostlessLabTiming(labCode) {
  return HOSTLESS_MQTT_LABS[normalizeText(labCode)] || {
    fixtureReadyDelayMs: 0,
    experimentStartDelayMs: 0,
  };
}

function hostlessLabInMqtt({ labCode = "", mode = "" } = {}) {
  return normalizeText(mode) === "mqtt" && Boolean(HOSTLESS_MQTT_LABS[normalizeText(labCode)]);
}

export { hostlessLabInMqtt, hostlessLabTiming };
```

- [ ] **Step 4: Run GREEN**

Run:

```bash
rtk powershell -NoProfile -Command "cd frontend; npm test -- src/lib/labHostInterfaceCapabilities.test.js"
```

Expected: PASS.

### Task 6: Auto Fixture Ready in Laboratory Page

**Files:**
- Modify: `frontend/src/modules/laboratory/useLaboratoryPage.js`
- Test: `frontend/src/modules/laboratory/page.runtime.test.js`

- [ ] **Step 1: Write failing runtime test**

Use fake timers and set host mode to MQTT. Mount the lab page for `高低温湿热二室`, click install, advance timers by 3000 ms, and assert `/api/laboratory/operations` is called with:

```js
expect.objectContaining({
  operationType: "fixtureReady",
  labCode: "LAB_HOT_HUMID_2",
  labName: "高低温湿热二室",
})
```

Also assert the mock-mode version does not take the hostless MQTT path.

- [ ] **Step 2: Run RED**

Run:

```bash
rtk powershell -NoProfile -Command "cd frontend; npm test -- src/modules/laboratory/page.runtime.test.js -t \"hot humid lab two fixture\""
```

Expected: FAIL.

- [ ] **Step 3: Implement hostless fixture-ready branch**

In `useLaboratoryPage.js`:

- Import `hostlessLabInMqtt` and `hostlessLabTiming`.
- Track a timeout handle for hostless fixture confirmation.
- Add cleanup in `closeFullInteractionState` and `onBeforeUnmount`.
- In `startFixtureConfirmCountdown`, if current lab is hostless in MQTT:
  - Show the same waiting modal/countdown or a hostless-specific message.
  - Use `window.setTimeout` for `fixtureReadyDelayMs`.
  - Call `persistFixtureReadyForTask({ taskCode, trayCodes })`.
  - Then show fixture success modal.
- Keep existing mock and normal MQTT behavior unchanged.

- [ ] **Step 4: Run GREEN**

Run:

```bash
rtk powershell -NoProfile -Command "cd frontend; npm test -- src/modules/laboratory/page.runtime.test.js -t \"hot humid lab two fixture\""
```

Expected: PASS.

### Task 7: Auto Start After Ready in MQTT

**Files:**
- Modify: `frontend/src/modules/laboratory/useLaboratoryPage.js`
- Modify: `frontend/src/lib/laboratoryApi.js`
- Test: `frontend/src/modules/laboratory/page.runtime.test.js`
- Test: `tests/api/test_laboratory.py`

- [ ] **Step 1: Write failing runtime test**

For `LAB_HOT_HUMID_2` in MQTT mode:

1. Start with tray status `工装夹具安装` and `fixtureReady: true`.
2. Click “确认准备就绪”.
3. Assert ready operation is posted.
4. Advance timers by 3000 ms.
5. Assert start endpoint is called:

```js
expect(fetch).toHaveBeenCalledWith(
  expect.stringContaining("/api/laboratory/tasks/TASK-HH2/experiments/EXP-HH/start"),
  expect.objectContaining({
    method: "POST",
    body: expect.stringContaining("高低温湿热二室"),
  }),
);
```

Add a companion test for `LAB_HOT_HUMID` in MQTT mode that confirms no start endpoint call is made.

- [ ] **Step 2: Run RED**

Run:

```bash
rtk powershell -NoProfile -Command "cd frontend; npm test -- src/modules/laboratory/page.runtime.test.js -t \"auto start\""
```

Expected: FAIL.

- [ ] **Step 3: Implement auto start scheduling**

In `confirmReady`:

- After successful ready operation, if `hostlessLabInMqtt({ labCode: laboratoryConfig.value.labCode, mode: readHostInterfaceMode() })`:
  - Schedule `window.setTimeout` for `experimentStartDelayMs`.
  - Call `startLaboratoryExperiment`.
  - Apply returned `samples`, `experiments`, `experimentRuns`, `experimentRunTrays`, `schedules`, and `tasks` to local refs.
  - Dispatch `SAMPLES_UPDATED_EVENT`.
  - Clear retry/confirmed modal state as needed.

Use current task fields:

```js
{
  labCode: laboratoryConfig.value.labCode,
  labName: laboratoryConfig.value.labName,
  startedAt: formatLocalDateTime(),
  trayCodes: getCurrentTaskTrayCodesByStatus(LAB_READY_STATUS),
}
```

- [ ] **Step 4: Run GREEN**

Run:

```bash
rtk powershell -NoProfile -Command "cd frontend; npm test -- src/modules/laboratory/page.runtime.test.js -t \"auto start\""
```

Expected: PASS.

## Chunk 4: Process Page and Regression

### Task 8: Process Page MQTT Text

**Files:**
- Modify: `frontend/src/modules/process/useProcessLabs.js`
- Test: `frontend/src/modules/process/useProcessLabs.test.js`

- [ ] **Step 1: Write failing process test**

In MQTT mode, create a ready `高低温湿热二室` card and assert:

```js
expect(card.startDisabledReason).not.toBe("MQTT模式下等待上位机发送实验开始信号");
```

Prefer:

```js
expect(card.startDisabledReason).toBe("试验间将在准备就绪后自动开始实验");
```

Also keep the existing one-room MQTT test expecting the old waiting message.

- [ ] **Step 2: Run RED**

Run:

```bash
rtk powershell -NoProfile -Command "cd frontend; npm test -- src/modules/process/useProcessLabs.test.js -t \"MQTT\""
```

Expected: FAIL for the new二室 expectation.

- [ ] **Step 3: Implement process card branch**

Import `hostlessLabInMqtt`. In `enrichLabCard`, when `mqttMode && actionState.canStartExperiment`:

- If hostless lab: set `canStartExperiment: false` and `startDisabledReason: "试验间将在准备就绪后自动开始实验"`.
- Otherwise: preserve `MQTT_START_DISABLED_REASON`.

Do not make the process page manually start二室 in MQTT; the laboratory ready action owns the auto start trigger.

- [ ] **Step 4: Run GREEN**

Run:

```bash
rtk powershell -NoProfile -Command "cd frontend; npm test -- src/modules/process/useProcessLabs.test.js -t \"MQTT\""
```

Expected: PASS.

### Task 9: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run backend tests**

Run:

```bash
rtk .\.venv\Scripts\python.exe -m pytest tests\api\test_master_data.py tests\api\test_laboratory.py tests\services\test_laboratory_services.py -v
```

Expected: PASS.

- [ ] **Step 2: Run frontend targeted tests**

Run:

```bash
rtk powershell -NoProfile -Command "cd frontend; npm test -- src/lib/labHostInterfaceCapabilities.test.js src/components/shared/ModuleExitDialog.test.js src/modules/schedule/model.test.js src/modules/process/model.test.js src/modules/process/useProcessLabs.test.js src/modules/laboratory/page.runtime.test.js src/modules/laboratory/model.test.js"
```

Expected: PASS.

- [ ] **Step 3: Run status check**

Run:

```bash
rtk git status --short
```

Expected: only intentional implementation files are modified.

- [ ] **Step 4: Manual smoke check**

Start the app using the repo’s normal dev command, then verify:

- Login/module switch lists “高低温湿热二室”.
- Schedule page offers both high humid labs.
- mock mode二室 behaves like other labs.
- MQTT mode二室 auto-confirms fixture after 3 seconds and auto-starts after ready plus 3 seconds.
- MQTT mode一室 still waits for host events.

## Execution Notes

- Use @superpowers:test-driven-development for each implementation chunk.
- Use @superpowers:systematic-debugging if any test fails unexpectedly.
- Use @superpowers:verification-before-completion before reporting completion.
- Do not create or switch branches without explicit user approval.
- Keep mock and MQTT business state transitions shared except at the host communication boundary.
