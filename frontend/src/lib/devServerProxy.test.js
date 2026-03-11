import { describe, expect, it } from "vitest";

import { devServerProxy } from "./devServerProxy.js";

describe("devServerProxy", () => {
  it("routes only backend API surfaces to the backend during local development", () => {
    expect(devServerProxy).toMatchObject({
      "/auth": {
        target: "http://127.0.0.1:8000",
      },
      "/api": {
        target: "http://127.0.0.1:8000",
      },
    });
    expect(devServerProxy).not.toHaveProperty("/static");
  });
});
