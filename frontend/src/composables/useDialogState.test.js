import { describe, expect, test } from "vitest";

import { useDialogState } from "./useDialogState";

describe("useDialogState", () => {
  test("opens editor with payload and resets on close", () => {
    const { open, payload, openWith, close } = useDialogState();

    openWith({ id: "1", name: "demo" });

    expect(open.value).toBe(true);
    expect(payload.value).toEqual({ id: "1", name: "demo" });

    close();

    expect(open.value).toBe(false);
    expect(payload.value).toBeNull();
  });
});
