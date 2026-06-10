// NFR-9: costUsd = ceil(durationMin) × 0.006

import { describe, expect, it } from "vitest";
import { costUsd } from "../cost";

describe("costUsd", () => {
  it("charges one full minute for a 1 s post", () => {
    expect(costUsd(1)).toBe(0.006);
  });
  it("charges one minute for exactly 60 s", () => {
    expect(costUsd(60)).toBe(0.006);
  });
  it("rounds 61 s up to two minutes", () => {
    expect(costUsd(61)).toBe(0.012);
  });
  it("handles a 15-min post (the cap)", () => {
    expect(costUsd(900)).toBe(0.09);
  });
  it("produces float-dust-free values", () => {
    expect(costUsd(170)).toBe(0.018); // 3 min — naive 3*0.006 = 0.018000000000000002
  });
  it("returns 0 for zero/negative/NaN durations", () => {
    expect(costUsd(0)).toBe(0);
    expect(costUsd(-5)).toBe(0);
    expect(costUsd(Number.NaN)).toBe(0);
  });
});
