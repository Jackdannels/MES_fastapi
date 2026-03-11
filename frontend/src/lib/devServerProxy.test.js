import { describe, expect, it } from "vitest";

import { devServerProxy } from "./devServerProxy.js";

describe("devServerProxy", () => {
  it("routes auth, api, and legacy static asset calls to the backend during local development", () => {
    expect(devServerProxy).toMatchObject({
      "/auth": {
        target: "http://127.0.0.1:8000",
      },
      "/api": {
        target: "http://127.0.0.1:8000",
      },
      "/static": {
        target: "http://127.0.0.1:8000",
      },
    });
  });
});
