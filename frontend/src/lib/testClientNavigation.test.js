import { afterEach, describe, expect, test, vi } from "vitest";
import { installTestClientNavigation, testClientTarget } from "./testClientNavigation";
import workstations from "../../../tools/desktop-client/workstations.json";

let remove = () => {};
afterEach(() => { remove(); delete window.__MES_DESKTOP__; delete window.chrome; });
const send = (detail) => window.dispatchEvent(new CustomEvent("mes-test-client-navigate", { detail }));
const request = (module = "central", extra = {}) => ({ requestId: "request-1", key: module, module, labCode: "", ...extra });
function setup(session = { username: "test-admin", module: "central" }) {
  window.__MES_DESKTOP__ = { module: "test", testClient: true, version: "1.8.0" };
  const postMessage = vi.fn(); window.chrome = { webview: { postMessage } };
  const router = { push: vi.fn(async () => undefined) };
  const switchSessionModule = vi.fn(async () => ({ ok: true }));
  remove = installTestClientNavigation({ readSession: () => session, switchSessionModule, router });
  return { router, switchSessionModule, result: () => JSON.parse(postMessage.mock.lastCall[0].slice("mes-test-client-navigation:".length)), postMessage };
}

describe("account-authenticated desktop test navigation", () => {
  test.each(workstations)("opens the canonical $folder route through the existing session switch", async (station) => {
    const client = setup();
    send(request(station.module, { key: station.labCode || station.module, labCode: station.labCode }));
    await vi.waitFor(() => expect(client.result().ok).toBe(true));
    expect(client.switchSessionModule).toHaveBeenCalledWith(station.module);
    if (station.module === "laboratory") expect(client.router.push).toHaveBeenCalledWith({ path: "/laboratory", query: { lab: station.labCode } });
  });
  test("opens central with the normal authenticated session", async () => {
    const client = setup(); send(request());
    await vi.waitFor(() => expect(client.result().ok).toBe(true));
    expect(client.router.push).toHaveBeenCalledWith("/");
  });
  test.each(["lims", "upper-computer", "unknown"])("rejects excluded page %s", async (module) => {
    const client = setup(); send(request(module));
    expect(client.result().ok).toBe(false); expect(client.switchSessionModule).not.toHaveBeenCalled();
  });
  test.each([null, { module: "laboratory", terminal_auth: true }])("requires account login, including when presented with a fixed-terminal session", (session) => {
    const client = setup(session); send(request());
    expect(client.result().ok).toBe(false); expect(client.switchSessionModule).not.toHaveBeenCalled();
  });
  test("keeps denied or expired server sessions on the current page", async () => {
    const client = setup(); client.switchSessionModule.mockResolvedValue({ ok: false, message: "session expired" }); send(request());
    await vi.waitFor(() => expect(client.result().message).toBe("session expired"));
    expect(client.router.push).not.toHaveBeenCalled();
  });
  test("restores the original module when a route guard cancels the page switch", async () => {
    const client = setup(); client.router.push.mockResolvedValue({ type: 4 }); send(request("visual"));
    await vi.waitFor(() => expect(client.result().ok).toBe(false));
    expect(client.switchSessionModule.mock.calls).toEqual([["visual"], ["central"]]);
  });
  test("selecting the current page is successful when Vue Router reports duplicate navigation", async () => {
    const client = setup(); client.router.push.mockResolvedValue({ type: 16 }); send(request());
    await vi.waitFor(() => expect(client.result().ok).toBe(true));
    expect(client.switchSessionModule).toHaveBeenCalledTimes(1);
  });
  test("does not install a page switch bridge in a production workstation", () => {
    const client = setup(); remove(); window.__MES_DESKTOP__ = { module: "laboratory", labCode: "LAB_SALT", version: "1.8.0" };
    remove = installTestClientNavigation({ readSession: () => ({}), switchSessionModule: client.switchSessionModule, router: client.router });
    send(request()); expect(client.postMessage).not.toHaveBeenCalled();
  });
  test("rejects an unknown room or mismatched navigation key", () => {
    expect(testClientTarget(request("laboratory", { key: "LAB_SALT", labCode: "LAB_UNKNOWN" }))).toBeNull();
    expect(testClientTarget(request("visual", { key: "central" }))).toBeNull();
  });
});
