import { buildTrayFlowEngine } from "./sampleFlow.trayFlowEngine";
import { presentLaboratoryArrivals } from "./sampleFlow.arrivalPresentation";
import { presentCancellationStaging } from "./sampleFlow.cancellationStaging";

// 公共兼容入口：参数与返回结构保持不变，流程装配委托给职责模块。
function buildTrayFlowView(input = {}) {
  return presentLaboratoryArrivals(presentCancellationStaging(buildTrayFlowEngine(input), input), input);
}

export { buildTrayFlowView };
