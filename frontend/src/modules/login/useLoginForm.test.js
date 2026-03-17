import { describe, expect, test, vi } from "vitest";

import { useLoginForm } from "./useLoginForm";

describe("useLoginForm", () => {
  test("starts blank and redirects to the explicit redirect path on success", async () => {
    const login = vi.fn(async () => ({ module: "visual", ok: true }));
    const navigate = vi.fn();
    const resolveHome = vi.fn(() => "/visualization");
    const form = useLoginForm({
      login,
      navigate,
      redirectPath: "/process",
      resolveModuleHome: resolveHome,
    });

    expect(form.username.value).toBe("");
    expect(form.password.value).toBe("");
    expect(form.moduleKey.value).toBe("central");
    expect(form.submitting.value).toBe(false);

    form.username.value = "admin";
    form.password.value = "123";

    await form.submitLogin();

    expect(login).toHaveBeenCalledWith("admin", "123", "central");
    expect(resolveHome).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/process");
    expect(form.submitting.value).toBe(false);
    expect(form.errorMessage.value).toBe("");
  });

  test("surfaces backend errors and does not navigate on failure", async () => {
    const login = vi.fn(async () => ({ ok: false, message: "Invalid credentials" }));
    const navigate = vi.fn();
    const form = useLoginForm({
      login,
      navigate,
      redirectPath: "",
      resolveModuleHome: vi.fn(() => "/"),
    });

    form.username.value = "bad";
    form.password.value = "bad";

    await form.submitLogin();

    expect(navigate).not.toHaveBeenCalled();
    expect(form.errorMessage.value).toBe("Invalid credentials");
    expect(form.submitting.value).toBe(false);
  });
});
