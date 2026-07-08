# Laboratory Attendance And Role Maintenance Design

## Goal

Add per-laboratory employee attendance to the laboratory console and replace the System page's static role permission matrix with role and employee account maintenance.

## Confirmed UI Rules

- The laboratory login button is shown in the page header action area, immediately to the left of the existing "显示弹窗" button.
- The login button and the employee login information slot are fixed-position header controls. When no employee is logged in, the information slot still renders as a placeholder showing "未登录 / 请先登录后操作".
- Step buttons keep their business labels. In the unauthenticated state, "比对任务", "样品安装", and "确认准备就绪" still display their original text. Clicking a protected action opens the laboratory login modal.
- After login succeeds, the previously requested action continues.
- When an experiment is completed from the laboratory running modal, the UI shows a logout prompt and automatically logs out the current laboratory employee session after 30 seconds unless the user exits earlier.
- Styling must follow the existing dark industrial MES theme: `action-btn`, `card`, `table`, `var(--bg-card-raised)`, `var(--border)`, and `var(--accent)` patterns.

## Data Model

- Employee account: username, display name, role name, password hash, allowed laboratory names, active flag.
- Laboratory attendance session: lab name, employee username/name, login time, last seen time, logout time, active flag, and optional logout reason.
- Work time summary: derived from closed sessions plus currently active session duration.

## API Shape

- `GET /api/attendance/users`
- `POST /api/attendance/users`
- `PUT /api/attendance/users/{user_id}`
- `GET /api/attendance/labs/{lab_name}/session`
- `POST /api/attendance/labs/{lab_name}/login`
- `POST /api/attendance/labs/{lab_name}/logout`
- `GET /api/attendance/work-times`

## Integration

- Laboratory UI reads the current lab employee session during page load.
- Header action teleport renders the login button and fixed status slot before "显示弹窗".
- Protected laboratory operations use one shared guard. If no active lab session exists, the guard opens login and remembers the requested operation.
- System page uses the attendance API for employee rows and work time summaries.

## Notes

- This feature is independent of the physical device interface. REST/API flows and MQTT mode continue using the same UI guard and attendance API.
- No git commit is created by this implementation because project rules require explicit user approval for commits.
