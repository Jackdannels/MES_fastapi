/* Simulator-owned inbox: display MES snapshots without recalculating business totals. */
(() => {
  const byId = (id) => document.getElementById(id);
  const pageSize = 20;
  let offset = 0;
  let query = "";
  let generation = 0;
  let rendered = "";
  const labels = {
    "mes.external-intake.received.v1": "MES 已接收",
    "mes.external-intake.accepted.v1": "MES 已受理",
    "mes.external-intake.failed.v1": "MES 接收失败",
    "mes.experiment.completion.v1": "托盘试验完成",
  };
  const textNode = (tag, text) => {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  };
  const value = (item) => item === null || item === undefined || ["", "未知"].includes(String(item).trim()) ? "无" : String(item);
  const objects = (items) => Array.isArray(items) ? items.filter((item) => item && typeof item === "object" && !Array.isArray(item)) : [];
  const codes = (items) => Array.isArray(items) && items.length ? items.map(value).join("、") : "无";
  const seconds = (amount) => typeof amount === "number" && Number.isFinite(amount) && amount >= 0 ? `${amount} 秒` : "无";
  const beijingFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  function timestamp(input) {
    if (typeof input !== "string" || !input.trim()) return null;
    // Unzoned MES timestamps already represent Beijing time, not browser-local time.
    const normalized = input.trim().replace(" ", "T");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/i.test(normalized)) return null;
    const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}+08:00`);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  function beijingTime(input) {
    const date = timestamp(input);
    if (!date) return "无";
    const parts = Object.fromEntries(beijingFormatter.formatToParts(date).map(({ type, value }) => [type, value]));
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
  }
  const timeRange = (start, end) => `${beijingTime(start)} → ${beijingTime(end)}`;
  function sessionExit(session, payload) {
    // Attendance-display cutoff only; never change the persisted logout event.
    const dates = [session.logged_out_at, session.cutoff_at, payload.completed_at].map(timestamp).filter(Boolean);
    return dates.length ? beijingTime(new Date(Math.min(...dates.map((date) => date.getTime()))).toISOString()) : "无";
  }
  function executionTraySamples(execution, payload) {
    const group = document.createElement("dl");
    group.className = "completion-fields completion-tray-samples";
    const wrapper = document.createElement("div");
    wrapper.append(textNode("dt", "涉及托盘及样品"));
    const detail = document.createElement("dd");
    const list = document.createElement("ul");
    const trayCodes = Array.isArray(execution.tray_codes) ? [...new Set(execution.tray_codes.filter((code) => typeof code === "string" && code.trim()))] : [];
    for (const code of trayCodes) {
      const samples = [...new Set(objects(payload.trays).filter((tray) => tray.tray_code === code)
        .flatMap((tray) => objects(tray.samples).map((sample) => sample.sample_code))
        .filter((sample) => typeof sample === "string" && sample.trim()))];
      samples.sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
      const row = document.createElement("li");
      row.append(textNode("strong", `${code}：`), textNode("span", codes(samples)));
      list.append(row);
    }
    detail.append(trayCodes.length ? list : textNode("span", "无"));
    wrapper.append(detail);
    group.append(wrapper);
    return group;
  }
  function fields(pairs) {
    const list = document.createElement("dl");
    list.className = "completion-fields";
    for (const [label, content] of pairs) {
      const group = document.createElement("div");
      group.append(textNode("dt", label), textNode("dd", value(content)));
      list.append(group);
    }
    return list;
  }
  function section(title, items, render, emptyText) {
    const detail = document.createElement("details");
    detail.className = "completion-section";
    detail.append(textNode("summary", `${title}（${items.length}）`));
    const list = document.createElement("ul");
    list.className = "completion-records";
    for (const item of items) {
      const row = document.createElement("li");
      render(row, item);
      list.append(row);
    }
    detail.append(items.length ? list : textNode("p", emptyText));
    return detail;
  }
  function dataLink(url, label) {
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("unsafe URL");
      const link = textNode("a", label);
      link.href = parsed.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.className = "completion-link";
      return link;
    } catch {
      return textNode("span", `${label}：${url ? "链接不可用（仅支持 HTTP/HTTPS）" : "无"}`);
    }
  }
  function completionContent(payload) {
    const content = document.createElement("div");
    content.className = "completion-content";
    content.append(fields([
      ["试验", `${value(payload.experiment_name)} · ${value(payload.experiment_code)}`],
      ["任务名称 / 来源", `${value(payload.task_name)} / ${value(payload.task_source)}`],
      ["LIMS 请求号", payload.lims_request_id],
      ["完成记录 / 版本", `${value(payload.completion_id)} / v${value(payload.revision)}`],
      ["试验完成时间", beijingTime(payload.completed_at)],
      ["本次新完成托盘", codes(payload.tray_codes)],
    ]));
    content.append(section("人员登录与考勤", objects(payload.personnel), (row, person) => {
      row.append(fields([
        ["人员姓名", person.employee_name],
        ["考勤时长", seconds(person.attendance_seconds)],
        ["其中轴间调整工时", seconds(person.between_axis_work_seconds)],
        ["登录覆盖时长", seconds(person.login_seconds)],
      ]));
      row.append(section("登录会话", objects(person.sessions), (entry, session) => {
        entry.append(fields([
          ["登录人员", person.employee_name], ["会话编号", session.session_id],
          ["登录时间", beijingTime(session.logged_in_at)],
          ["退出时间（考勤截止）", sessionExit(session, payload)],
          ["统计截止时间", beijingTime(session.cutoff_at || payload.completed_at)],
        ]));
      }, "无"));
      row.append(section("考勤区间", objects(person.work_intervals), (entry, interval) => {
        entry.append(fields([
          ["区间编号 / 批次", `${value(interval.interval_id)} / ${value(interval.run_no)}`],
          ["考勤区间", timeRange(interval.started_at, interval.ended_at)], ["时长", seconds(interval.seconds)],
        ]));
      }, "无"));
    }, "无"));
    content.append(section("设备运行与执行阶段", objects(payload.executions), (row, execution) => {
      row.append(fields([
        ["执行编号", execution.execution_id], ["批次 / 子试验 / 轴向", `${value(execution.run_no)} / ${value(execution.sub_experiment_code)} / ${value(execution.axis_code)}`],
        ["设备 / 实验室", `${value(execution.device_name)}（${value(execution.device_code)}） / ${value(execution.lab_code)}`],
        ["起止时间", timeRange(execution.started_at, execution.ended_at)],
        ["实际运行时长", seconds(execution.running_seconds)], ["自然经过时长", seconds(execution.elapsed_seconds)],
        ["时长来源", execution.duration_source === "mqtt_events" ? "MQTT 设备事件计算" : execution.duration_source],
        ["数据完整性", execution.data_quality],
      ]), executionTraySamples(execution, payload));
    }, "无"));
    const trays = section("托盘与对应样品", objects(payload.trays), (row, tray) => {
      row.append(textNode("h4", `托盘 ${value(tray.tray_code)}`));
      for (const sample of objects(tray.samples)) {
        row.append(fields([["样品编号", sample.sample_code], ["样品名称", sample.sample_name], ["样品类型", sample.sample_type]]));
      }
      if (!objects(tray.samples).length) row.append(textNode("p", "无"));
    }, "无");
    trays.open = true;
    content.append(trays);
    const data = payload.data && typeof payload.data === "object" ? payload.data : {};
    const files = section("实验数据文件", objects(data.files), (row, file) => {
      row.append(fields([
        ["文件", file.file_name || file.export_key], ["样品 / 批次 / 轴向", `${value(file.sample_code)} / ${value(file.run_no)} / ${value(file.axis_code)}`],
        ["文件状态", file.status],
      ]), dataLink(file.url, "打开实验数据文件"));
    }, "无");
    files.open = true;
    const status = { pending: "待生成", partial: "部分就绪", ready: "已就绪" };
    files.append(fields([["数据状态", status[data.status] || value(data.status)], ["待补齐文件数", data.missing_count]]), dataLink(data.url, "打开本次完成数据"));
    content.append(files);
    if (Array.isArray(payload.data_quality) && payload.data_quality.length) {
      const note = textNode("p", `数据质量说明：${payload.data_quality.map(value).join("；")}`);
      note.className = "completion-quality";
      content.append(note);
    }
    return content;
  }
  function navigate() {
    const interactions = location.hash === "#interactions";
    const communication = location.hash === "#communication";
    byId("dispatchPage").hidden = interactions || communication;
    byId("interactionPage").hidden = !interactions;
    byId("communicationPage").hidden = !communication;
    for (const [id, active] of [["dispatchTab", !interactions && !communication], ["interactionTab", interactions], ["communicationTab", communication]]) {
      if (active) byId(id).setAttribute("aria-current", "page");
      else byId(id).removeAttribute("aria-current");
    }
    if (interactions) refresh();
  }
  async function refresh() {
    const requestGeneration = ++generation;
    byId("refreshInteractions").disabled = true;
    try {
      const params = new URLSearchParams({ task_code: query, limit: pageSize, offset });
      const [response, stateResponse] = await Promise.all([fetch(`/api/interactions?${params}`), fetch("/api/state")]);
      if (!response.ok || !stateResponse.ok) throw new Error("读取失败，请检查模拟器服务后重试。");
      const [data, state] = await Promise.all([response.json(), stateResponse.json()]);
      if (requestGeneration !== generation) return;
      const signature = JSON.stringify(data);
      if (signature !== rendered) {
        const list = byId("interactions");
        list.replaceChildren();
        for (const item of data.items) {
          const event = item.event;
          const card = document.createElement("article");
          card.className = "interaction-card";
          const heading = document.createElement("div");
          heading.className = "interaction-heading";
          heading.append(textNode("h3", event.payload.code || event.payload.task_code || event.correlation_id || "未关联任务"));
          const badge = textNode("span", labels[event.type] || "MES 通知");
          badge.className = "badge";
          heading.append(badge);
          card.append(heading, textNode("p", `接收时间：${beijingTime(item.received_at)} · HTTP POST`));
          card.append(textNode("p", `事件：${event.type}`));
          if (event.payload.detail) card.append(textNode("p", String(event.payload.detail)));
          if (event.type === "mes.experiment.completion.v1") card.append(completionContent(event.payload));
          const details = document.createElement("details");
          details.append(textNode("summary", "查看原始报文"), textNode("pre", JSON.stringify(event, null, 2)));
          card.append(details);
          list.append(card);
        }
        if (!data.items.length) {
          const empty = textNode("p", query ? "未找到该任务的通知，请检查编号或重置查询。" : "尚未收到 MES 通知。下发任务后，MES 的接收和受理回执会显示在这里。");
          empty.className = "empty";
          list.append(empty);
        }
        rendered = signature;
      }
      byId("receivedCount").textContent = state.http_receiver.received_count;
      byId("receiverAuth").textContent = state.http_receiver.auth_required ? "Bearer Token" : "仅本机回调";
      byId("receiverUrl").textContent = `${location.origin}${state.http_receiver.path}`;
      byId("interactionFeedback").textContent = `共 ${data.total} 条业务记录（完成记录仅计最新版本） · 每 5 秒自动刷新`;
      byId("interactionFeedback").classList.remove("is-error");
      byId("interactionPageInfo").textContent = `第 ${Math.floor(offset / pageSize) + 1} / ${Math.max(1, Math.ceil(data.total / pageSize))} 页`;
      byId("previousInteractions").disabled = offset === 0;
      byId("nextInteractions").disabled = offset + pageSize >= data.total;
    } catch (error) {
      if (requestGeneration !== generation) return;
      byId("interactionFeedback").textContent = `${error.message} 已有记录保留，可点击刷新重试。`;
      byId("interactionFeedback").classList.add("is-error");
    } finally {
      if (requestGeneration === generation) byId("refreshInteractions").disabled = false;
    }
  }
  byId("interactionFilter").addEventListener("submit", (event) => {
    event.preventDefault(); query = byId("interactionTaskCode").value.trim(); offset = 0; refresh();
  });
  byId("clearInteractionFilter").addEventListener("click", () => {
    byId("interactionTaskCode").value = ""; query = ""; offset = 0; refresh();
  });
  byId("previousInteractions").addEventListener("click", () => { offset = Math.max(0, offset - pageSize); refresh(); });
  byId("nextInteractions").addEventListener("click", () => { offset += pageSize; refresh(); });
  byId("refreshInteractions").addEventListener("click", refresh);
  window.addEventListener("hashchange", navigate);
  navigate();
  setInterval(() => { if (!byId("interactionPage").hidden && !byId("refreshInteractions").disabled) refresh(); }, 5000);
})();
