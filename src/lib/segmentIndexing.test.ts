import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: mocks.getSession } },
}));

import { indexSegmentEfforts } from "@/lib/segmentIndexing";

describe("indexSegmentEfforts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: "token" } } });
  });

  it("returns a partial success when usable matches were persisted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        checked: 5,
        matched: 2,
        failures: 1,
        failureDetails: ["legacy/missing.gpx: Object not found"],
      }),
    }));

    await expect(indexSegmentEfforts({ segmentId: "segment-1" })).resolves.toMatchObject({
      matched: 2,
      failures: 1,
    });
  });

  it("still rejects when every attempted persisted match failed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        checked: 5,
        matched: 0,
        failures: 3,
        failureDetails: ["Object not found"],
      }),
    }));

    await expect(indexSegmentEfforts({ segmentId: "segment-1" }))
      .rejects.toThrow("3 inaccessible drives. Object not found");
  });
});
