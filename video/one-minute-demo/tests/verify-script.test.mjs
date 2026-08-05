import {readFileSync} from "node:fs";
import {describe, expect, it} from "vitest";

describe("render verification script", () => {
  it("checks the required video, audio, duration, and review frames", () => {
    const source = readFileSync("scripts/verify-render.ps1", "utf8");
    for (const required of ["h264", "aac", "1920", "1080", "59.9", "60.1", "final-04.png", "final-58_5.png"]) {
      expect(source).toContain(required);
    }
  });
});
