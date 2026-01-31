/* FILE: ui.js
 * Binds generic UI behaviors (modal, drawer, filter, sort, tabs).
 */
// Modal open/close behavior.
function attachModalHandlers() {
  if (document.body?.dataset.modalBound === "1") {
    return;
  }
  document.addEventListener("click", (event) => {
    const openBtn = event.target.closest("[data-modal-open]");
    if (openBtn) {
      const target = openBtn.getAttribute("data-modal-open");
      const modal = document.getElementById(target);
      if (!modal) {
        return;
      }
      event.preventDefault();
      modal.classList.add("is-open");
      return;
    }
    const closeBtn = event.target.closest("[data-modal-close]");
    if (closeBtn) {
      event.preventDefault();
      const target = closeBtn.getAttribute("data-modal-close");
      const modal = document.getElementById(target);
      if (modal) {
        modal.classList.remove("is-open");
      }
      return;
    }
    if (event.target.classList.contains("modal-backdrop")) {
      const modal = event.target.closest(".modal");
      if (modal) {
        modal.classList.remove("is-open");
      }
    }
  });
  document.body.dataset.modalBound = "1";

  const hashTarget = window.location.hash?.slice(1);
  if (hashTarget) {
    const modal = document.getElementById(hashTarget);
    if (modal && modal.classList.contains("modal")) {
      modal.classList.add("is-open");
    }
  }
}

// Drawer open/close behavior.
function attachDrawerHandlers() {
  if (document.body?.dataset.drawerBound === "1") {
    return;
  }
  document.addEventListener("click", (event) => {
    const openBtn = event.target.closest("[data-drawer-open]");
    if (openBtn) {
      event.preventDefault();
      const target = openBtn.getAttribute("data-drawer-open");
      const drawer = document.getElementById(target);
      if (drawer) {
        drawer.classList.add("is-open");
      }
      return;
    }
    const closeBtn = event.target.closest("[data-drawer-close]");
    if (closeBtn) {
      event.preventDefault();
      const target = closeBtn.getAttribute("data-drawer-close");
      const drawer = document.getElementById(target);
      if (drawer) {
        drawer.classList.remove("is-open");
      }
    }
  });
  document.body.dataset.drawerBound = "1";
}

// Table filter input behavior.
function attachFilterHandlers() {
  document.querySelectorAll("[data-filter-input]").forEach((input) => {
    const targetSelector = input.getAttribute("data-filter-input");
    const table = document.querySelector(targetSelector);
    if (!table) {
      return;
    }
    input.addEventListener("input", () => {
      const query = input.value.trim().toLowerCase();
      table.querySelectorAll("tbody tr").forEach((row) => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(query) ? "" : "none";
      });
    });
  });
}

// Table header sort behavior.
function attachSortHandlers() {
  document.querySelectorAll("table[data-sortable]").forEach((table) => {
    const headers = table.querySelectorAll("th[data-sort]");
    headers.forEach((th) => {
      th.addEventListener("click", () => {
        const index = Array.from(th.parentNode.children).indexOf(th);
        const currentDir = th.getAttribute("data-sort-dir") || "none";
        const nextDir = currentDir === "asc" ? "desc" : "asc";

        headers.forEach((h) => h.removeAttribute("data-sort-dir"));
        th.setAttribute("data-sort-dir", nextDir);

        const rows = Array.from(table.querySelectorAll("tbody tr"));
        rows.sort((a, b) => {
          const aText = a.children[index]?.textContent.trim() || "";
          const bText = b.children[index]?.textContent.trim() || "";
          if (aText === bText) {
            return 0;
          }
          const result = aText.localeCompare(bText, "zh-Hans-CN", { numeric: true });
          return nextDir === "asc" ? result : -result;
        });
        const tbody = table.querySelector("tbody");
        rows.forEach((row) => tbody.appendChild(row));
      });
    });
  });
}

// Tabs switch active panel visibility.
function attachTabHandlers() {
  document.querySelectorAll('[data-tab-role="tabs"]').forEach((tabs) => {
    if (tabs.dataset.bound === "1") {
      return;
    }
    const group = tabs.dataset.tabGroup || "";
    const panels = document.querySelectorAll(`[data-tab-panel][data-tab-group="${group}"]`);
    tabs.addEventListener("click", (event) => {
      const button = event.target.closest("[data-tab-btn]");
      if (!button) {
        return;
      }
      const target = button.getAttribute("data-tab-btn");
      tabs.querySelectorAll("[data-tab-btn]").forEach((btn) => {
        btn.classList.toggle("active", btn === button);
      });
      panels.forEach((panel) => {
        panel.classList.toggle("is-hidden", panel.getAttribute("data-tab-panel") !== target);
      });
    });
    tabs.dataset.bound = "1";
  });
}

export { attachModalHandlers, attachDrawerHandlers, attachFilterHandlers, attachSortHandlers, attachTabHandlers };
