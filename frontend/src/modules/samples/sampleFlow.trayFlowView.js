import { buildTrayFlowEngine } from "./sampleFlow.trayFlowEngine";
import { presentLaboratoryArrivals } from "./sampleFlow.arrivalPresentation";
import { presentCancellationStaging } from "./sampleFlow.cancellationStaging";
import { presentMoldReschedule } from "./sampleFlow.moldReschedule";
import { presentSaltSprayPauseHistory } from "./sampleFlow.saltPauseHistory";

const presentCurrentAppearance = (flow) => {
  const steps = flow.steps || [];
  const index = steps.findIndex((step) => step.active && step.label === "实验后外观检测间存放" && step.time);
  if (index < 0) return flow;
  const preceding = steps.slice(0, index);
  return {
    ...flow,
    steps: [
      ...preceding.filter((step) => step.reached),
      steps[index],
      ...preceding.filter((step) => !step.reached),
      ...steps.slice(index + 1),
    ],
  };
};

// 公共兼容入口：参数与返回结构保持不变，流程装配委托给职责模块。
function buildTrayFlowView(input = {}) {
  const flow = presentCurrentAppearance(presentCancellationStaging(buildTrayFlowEngine(input), input));
  return presentSaltSprayPauseHistory(presentLaboratoryArrivals(presentMoldReschedule(flow, input), input), input);
}

export { buildTrayFlowView };
