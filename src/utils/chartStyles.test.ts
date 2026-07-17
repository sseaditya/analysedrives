import { describe, expect, it } from "vitest";
import { chartAxisLabel, chartAxisTick } from "@/utils/chartStyles";

describe("chart axis theme styles", () => {
  it("uses the foreground theme token for ticks and labels", () => {
    expect(chartAxisTick.fill).toBe("hsl(var(--foreground))");
    expect(chartAxisLabel.fill).toBe("hsl(var(--foreground))");
  });
});
