import { describe, expect, it } from "vitest";
import { ECONOMIC_CORE_PACKAGE } from "../src/index.js";

describe("economic-core scaffold", () => {
  it("exports something", () => {
    expect(ECONOMIC_CORE_PACKAGE).toBe("@adasouls/economic-core");
  });
});
