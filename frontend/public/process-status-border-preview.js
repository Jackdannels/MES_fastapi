const cards = [
  { state: "idle", status: "空闲", name: "冲击二室", type: "冲击试验", task: "-", experiment: "未分配", schedule: "暂无排程", note: "当前无任务" },
  { state: "scheduled", status: "已排程", name: "冲击一室", type: "冲击试验", task: "SYLU-2026-07-002", experiment: "冲击试验", schedule: "08/01 08:00 - 08/01 11:30", note: "剩余待实验 1 个托盘" },
  { state: "idle", status: "空闲", name: "高低温湿热二室", type: "高低温湿热试验", task: "-", experiment: "未分配", schedule: "暂无排程", note: "当前无任务" },
  { state: "running", status: "实验进行中", name: "高低温湿热一室", type: "高低温湿热试验", task: "SYLU-2026-07-002", experiment: "高低温湿热试验", schedule: "07/31 08:00 - 07/31 11:30", note: "当前实验 1 个托盘" },
  { state: "scheduled", status: "已排程", name: "霉菌试验室", type: "霉菌试验", task: "SYLU-2026-07-001", experiment: "霉菌试验", schedule: "07/31 12:00 - 07/31 15:30", note: "剩余待实验 1 个托盘" },
  { state: "maintenance", status: "维修", name: "四综合实验室", type: "四综合试验", task: "-", experiment: "未分配", schedule: "暂停排程", note: "设备维修中，禁止开始实验" },
  { state: "urgent", status: "剩余 18 分钟", name: "温度冲击二室", type: "温度冲击试验", task: "SYLU-2026-07-008", experiment: "温度冲击试验", schedule: "07/31 09:00 - 07/31 12:00", note: "实验临近计划结束时间" },
  { state: "idle", status: "空闲", name: "振动一室", type: "振动试验", task: "-", experiment: "未分配", schedule: "暂无排程", note: "当前无任务" },
];

document.querySelector(".lab-grid").innerHTML = cards.map((card) => `
  <article class="lab-card state-${card.state}">
    <div class="lab-top">
      <div><div class="lab-name">${card.name}</div><div class="lab-type">${card.type}</div></div>
      <span class="status-badge">${card.status}</span>
    </div>
    <div class="facts">
      <div class="fact"><span>任务编号</span><strong>${card.task}</strong></div>
      <div class="fact"><span>目标实验</span><strong>${card.experiment}</strong></div>
      <div class="fact"><span>排程时间</span><strong>${card.schedule}</strong></div>
    </div>
    <button class="view-button" type="button" ${card.task === "-" ? "disabled" : ""}>查看任务</button>
    <div class="card-note">${card.note}</div>
  </article>
`).join("");

