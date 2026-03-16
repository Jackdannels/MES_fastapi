import { describe, expect, test } from "vitest";

import { useTabState } from "./useTabState";

describe("useTabState", () => {
  test("switches active tab by key", () => {
    const { activeTab, setActiveTab } = useTabState("unpacking");

    setActiveTab("retention");

    expect(activeTab.value).toBe("retention");
  });
});
