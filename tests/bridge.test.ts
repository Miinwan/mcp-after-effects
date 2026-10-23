import { describe, expect, it } from "vitest";

const { getOp } = await import("../src/registry.js");
await import("../src/operations/index.js");
const { compPlan } = await import("../src/operations/bridge.js");

const base = {
  version: 1 as const,
  id: "t1",
  status: "sent",
  premiere: {
    sequenceName: "S",
    clipName: "A010/cut",
    timelineStart: 10,
    timelineEnd: 12.5,
    fps: 25,
    width: 1920,
    height: 1080,
  },
  source: {
    mediaPath: "/x.mov",
    inPoint: 3,
    outPoint: 5.5,
    handles: 1,
    speed: 1,
    motion: { position: [0.5, 0.5], scale: 110, rotation: 0 },
  },
};

describe("Premiere → After Effects comp plan", () => {
  it("lines the cut up with handles on both sides", () => {
    const p = compPlan(base);
    expect(p.duration).toBe(4.5);
    expect(p.handleIn).toBe(1);
    expect(p.layerStart).toBe(-2); // comp 0 shows source 2.0 = in − handle
    expect(p.position).toEqual([960, 540]);
    expect(p.compName).toBe("PR A010 cut");
  });

  it("keeps handles on whole frames at 23.976 fps", () => {
    const p = compPlan({ ...base, premiere: { ...base.premiere, fps: 23.976 } });
    expect(p.handleIn * 23.976).toBeCloseTo(23, 4);
  });

  it("shrinks the head handle when the cut starts near the media start", () => {
    const p = compPlan({ ...base, source: { ...base.source, inPoint: 0.4 } });
    expect(p.handleIn).toBe(0.4);
    expect(p.layerStart).toBeCloseTo(0);
  });

  it("keeps pixel positions from older Premiere builds and handles speed", () => {
    const p = compPlan({
      ...base,
      source: {
        ...base.source,
        speed: 2,
        motion: { position: [800, 500], scale: null, rotation: null },
      },
    });
    expect(p.position).toEqual([800, 500]);
    expect(p.stretch).toBe(50);
  });

  it("both ops run on the server side and refuse unknown handoffs", async () => {
    for (const n of ["bridge.from_premiere", "bridge.to_premiere"]) {
      expect(getOp(n)!.run).toBeDefined();
      const r = (await getOp(n)!.run!({ handoff: "khong-co" }, {} as never)) as {
        ok: boolean;
        error: string;
      };
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/no handoff/);
    }
  });
});
