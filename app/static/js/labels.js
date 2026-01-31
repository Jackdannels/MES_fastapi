/* FILE: labels.js
 * Reads UI labels from <body data-*> attributes.
 */
// Read labels from <body data-*> attributes.
function getLabels() {
  const data = document.body?.dataset || {};
  return {
    sourceExternal: data.labelSourceExternal || "External",
    sourceInternal: data.labelSourceInternal || "Internal",
    statusAccepted: data.labelStatusAccepted || "Accepted",
    statusWaiting: data.labelStatusWaiting || "Waiting",
    statusScheduled: data.labelStatusScheduled || "Scheduled",
    statusRunning: data.labelStatusRunning || "Running",
    statusRetention: data.labelStatusRetention || "\u6682\u5b58\u95f4\u5b58\u653e",
    sampleReceived: data.labelSampleReceived || "Received",
    sampleTesting: data.labelSampleTesting || "Testing",
    sampleStored: data.labelSampleStored || "Stored",
    sampleDisposed: data.labelSampleDisposed || "Disposed",
    dataStreaming: data.labelDataStreaming || "Streaming",
    dataGap: data.labelDataGap || "Gap",
    dataComplete: data.labelDataComplete || "Complete",
    deviceIdle: data.labelDeviceIdle || "Idle",
    deviceInUse: data.labelDeviceInUse || "In Use",
    deviceMaintenance: data.labelDeviceMaintenance || "Maintenance",
    edit: data.labelEdit || "Edit",
    detail: data.labelDetail || "Detail",
    view: data.labelView || "View",
    alertGap: data.labelAlertGap || "Alert",
    alertNone: data.labelAlertNone || "No alerts",
    maintenancePrefix: data.labelMaintenancePrefix || "Maintenance",
    maintenanceSuffix: data.labelMaintenanceSuffix || "",
    gapRecorded: data.labelGapRecorded || "Gap recorded",
    gapNone: data.labelGapNone || "No gaps",
    conflictOverlap: data.labelConflictOverlap || "Overlap",
    conflictDelay: data.labelConflictDelay || "Delay",
    conflictReschedule: data.labelConflictReschedule || "Reschedule",
    unassignedDevice: data.labelUnassignedDevice || "Unassigned",
    intakeLocation: data.labelIntakeLocation || "Intake Desk",
    unpackingLocation: data.labelUnpackingLocation || "Unpacking Area",
    retentionLocation: data.labelRetentionLocation || "Retention",
    taskNameRequired: data.labelTaskNameRequired || "Task name is required.",
    scheduleSelectRequired: data.labelScheduleSelectRequired || "Select task and lab.",
    scheduleCustomTimeRequired: data.labelScheduleCustomTimeRequired || "Custom time required.",
    scheduleTimeInvalid: data.labelScheduleTimeInvalid || "Invalid schedule time.",
    scheduleConflictTemplate:
      data.labelScheduleConflictTemplate || "Schedule conflict: {device} {start}-{end} {task}.",
    scheduleTaskConflictTemplate:
      data.labelScheduleTaskConflictTemplate || "Task conflict: {task} {start}-{end}.",
    scheduleSuggestPrefix: data.labelScheduleSuggestPrefix || "Suggestion: ",
    scheduleSuggestNone: data.labelScheduleSuggestNone || "No available slots.",
    slotMorning: data.labelSlotMorning || "AM",
    slotAfternoon: data.labelSlotAfternoon || "PM",
  };
}

export { getLabels };
