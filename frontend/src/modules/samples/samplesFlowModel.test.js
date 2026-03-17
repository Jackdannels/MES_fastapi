import { describe, expect, test } from "vitest";

import {
  buildSamplesFlowView,
  buildSamplesStagingView,
  dispatchStagingSamples,
  submitSamplesBatchIntake,
  updateSampleDetail,
} from "./samplesFlowModel";

describe("samplesFlowModel", () => {
  test("buildSamplesFlowView filters sorts and paginates samples", () => {
    const view = buildSamplesFlowView({
      samples: [
        { code: "SP-002", task_code: "SZH-2", status: "到货", location: "接驳区", owner: "张三", trays: [] },
        { code: "SP-001", task_code: "SZH-1", status: "已到达实验室", location: "振动一室", owner: "李四", trays: [] },
      ],
      filters: { query: "SP-00", taskCode: "", status: "" },
      sort: { key: "code", direction: "asc" },
      page: 1,
      pageSize: 8,
    });

    expect(view.rows).toHaveLength(2);
    expect(view.rows[0].code).toBe("SP-001");
    expect(view.rows[1].code).toBe("SP-002");
    expect(view.totalPages).toBe(1);
  });

  test("submitSamplesBatchIntake writes location owner and status to matching samples", () => {
    const result = submitSamplesBatchIntake({
      samples: [{ code: "SP-001", task_code: "SZH-1", status: "运输中", location: "", owner: "" }],
      payload: { location: "接驳区", owner: "王工", codes: "SP-001" },
      labels: { intakeLocation: "接驳区", sampleReceived: "已接收", sampleStored: "已入库" },
      now: "2026-03-13T10:00:00.000Z",
    });

    expect(result.error).toBe("");
    expect(result.samples[0].location).toBe("接驳区");
    expect(result.samples[0].owner).toBe("王工");
    expect(result.samples[0].status).toBe("到货");
    expect(result.samples[0].flow_status).toBe("到货");
  });

  test("updateSampleDetail persists status and remark into history", () => {
    const result = updateSampleDetail({
      sample: {
        id: "sample-1",
        code: "SP-001",
        status: "到货",
        location: "接驳区",
        owner: "王工",
        history: [],
      },
      payload: { status: "工装夹具安装", remark: "进入实验前检查完成" },
      now: "2026-03-13T10:00:00.000Z",
    });

    expect(result.sample.status).toBe("工装夹具安装");
    expect(result.sample.flow_status).toBe("工装夹具安装");
    expect(result.sample.history[0].detail).toBe("进入实验前检查完成");
  });

  test("buildSamplesStagingView only returns samples still waiting in pre-retention area", () => {
    const view = buildSamplesStagingView({
      samples: [
        { code: "SP-001", task_code: "SZH-1", location: "恒温恒湿间（暂存间）", status: "已到达暂存间", owner: "张三" },
        { code: "SP-002", task_code: "SZH-1", location: "振动一室", status: "已到达实验室", owner: "李四" },
      ],
      query: "",
      selectedCodes: ["SP-001"],
    });

    expect(view.rows).toHaveLength(1);
    expect(view.rows[0].code).toBe("SP-001");
    expect(view.rows[0].selected).toBe(true);
  });

  test("dispatchStagingSamples moves staging samples to target lab and appends history", () => {
    const result = dispatchStagingSamples({
      samples: [
        { code: "SP-001", task_code: "SZH-1", location: "恒温恒湿间（暂存间）", status: "已到达暂存间", owner: "张三", history: [] },
      ],
      payload: { targetLab: "振动一室", owner: "王工", codes: "" },
      selectedCodes: ["SP-001"],
      now: "2026-03-13T10:00:00.000Z",
    });

    expect(result.error).toBe("");
    expect(result.samples[0].location).toBe("振动一室");
    expect(result.samples[0].owner).toBe("王工");
    expect(result.samples[0].status).toBe("已到达实验室");
    expect(result.samples[0].flow_status).toBe("已到达实验室");
    expect(result.samples[0].history[0].action).toBe("暂存间派发");
  });
});
