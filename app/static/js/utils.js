/* FILE: utils.js
 * Shared helpers (formatting, status classes, form data).
 */
function generateId(prefix) {
  const rand = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${prefix}-${Date.now()}-${rand}`;
}

function formatDateTime(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}





// Map status text to CSS classes.
function statusClass(value, labels) {
  const normalized = (value || "").trim();
  const matches = (target) => target && normalized === target;
  if (matches(labels.statusExperimenting) || matches(labels.statusRunning) || normalized === "???") {
    return "status running";
  }
  if (matches(labels.statusCompleted)) {
    return "status completed";
  }
  if (matches(labels.statusRetention) || normalized == "暂存间存放") {
    return "status retention";
  }
  if (matches(labels.statusScheduled) || normalized === "???") {
    return "status scheduled";
  }
  if (matches(labels.statusAccepted) || normalized === "???") {
    return "status accepted";
  }
  if (matches(labels.statusWaiting) || normalized === "???" || matches(labels.dataGap)) {
    return "status warn";
  }
  if (matches(labels.deviceMaintenance)) {
    return "status alert";
  }
  return "status";
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = value;
  }
}

// Serialize form inputs into a plain object.
function getFormData(rootSelector) {
  const root = typeof rootSelector === "string" ? document.querySelector(rootSelector) : rootSelector;
  if (!root) {
    return {};
  }
  const data = {};
  root.querySelectorAll("[name]").forEach((input) => {
    if (input.type === "checkbox") {
      data[input.name] = input.checked;
      return;
    }
    data[input.name] = input.value.trim();
  });
  return data;
}

export { generateId, formatDateTime, statusClass, setText, getFormData };

