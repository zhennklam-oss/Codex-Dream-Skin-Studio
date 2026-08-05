import {execFileSync} from "node:child_process";
import {describe, expect, it} from "vitest";

describe("dream ambient soundtrack", () => {
  it("is a 60-second stereo 48kHz track", () => {
    const json = JSON.parse(execFileSync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=sample_rate,channels:format=duration",
      "-of",
      "json",
      "audio/dream-ambient.wav",
    ], {encoding: "utf8"}));
    const stream = json.streams[0];
    expect(stream.sample_rate).toBe("48000");
    expect(stream.channels).toBe(2);
    expect(Number(json.format.duration)).toBeGreaterThanOrEqual(59.9);
    expect(Number(json.format.duration)).toBeLessThanOrEqual(60.1);
  });
});
