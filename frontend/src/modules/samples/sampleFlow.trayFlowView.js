import { buildTrayFlowEngine } from "./sampleFlow.trayFlowEngine";

// 公共兼容入口：参数与返回结构保持不变，流程装配委托给职责模块。
function buildTrayFlowView(input = {}) {
  return buildTrayFlowEngine(input);
}

export { buildTrayFlowView };
