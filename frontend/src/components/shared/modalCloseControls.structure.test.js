import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const readSource = (path) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("modal close controls", () => {
  test("keeps ordinary AppModal dismissal in the header only", () => {
    const sources = [
      "src/components/shared/TrayErrorSampleDialog.vue",
      "src/modules/devices/page.vue",
      "src/modules/laboratory/page.vue",
      "src/modules/system/page.vue",
    ].map(readSource).join("\n");

    expect(sources).not.toMatch(/<button[^>]*@click="(?:handleClose|closeConfirmed|closeDeviceDrawer|closeEmployeeDrawer|closeEmployeeQrModal|closeEmployeeOperationLogs)"[^>]*>关闭<\/button>/);
  });
});
