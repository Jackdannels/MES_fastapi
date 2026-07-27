(() => {
  const steps = [
    ["样品运输中", "done"],
    ["到货", "done"],
    ["送至暂存间", "warning"],
    ["已到达暂存间", "warning"],
    ["送至霉菌试验室", "done"],
    ["已到达实验室", "done"],
    ["工装夹具安装", "done"],
    ["实验准备就绪", "done"],
    ["霉菌试验进行中", "current"],
    ["冲击试验未完成", "pending"],
    ["温度冲击试验未完成", "pending"],
    ["振动试验未完成", "pending"],
    ["高低温湿热试验未完成", "pending"],
    ["四综合试验未完成", "pending"],
    ["厂家收回", "pending"],
  ];

  const columns = Number(document.body.dataset.columns) || 5;
  const canvas = document.querySelector("[data-flow-canvas]");
  if (!canvas) return;

  for (let offset = 0, rowIndex = 0; offset < steps.length; offset += columns, rowIndex += 1) {
    const row = document.createElement("div");
    row.className = "flow-row";
    row.setAttribute("aria-label", `流程第 ${rowIndex + 1} 行`);
    const chunk = steps.slice(offset, offset + columns);
    chunk.forEach(([label, state], index) => {
      const step = document.createElement("div");
      step.className = `flow-step is-${state}`;
      if (rowIndex % 2 === 1) {
        step.style.gridColumn = String(columns - index);
      }
      step.innerHTML = `<span class="flow-dot" aria-hidden="true"></span><span class="flow-label">${label}</span>`;
      row.appendChild(step);
    });
    canvas.appendChild(row);
  }
})();
