import { afterEach, describe, expect, it, vi } from "vitest";

import { startSingleFlightPolling } from "./runtime-polling";

afterEach(() => {
  vi.useRealTimers();
});

describe("startSingleFlightPolling", () => {
  it("waits for a slow probe to resolve before scheduling the next probe", async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    const probe = vi.fn(() => new Promise<void>((resolve) => {
      release = resolve;
    }));
    const stop = startSingleFlightPolling({
      probe,
      shouldContinue: () => true,
      intervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(5000);
    expect(probe).toHaveBeenCalledTimes(1);

    release?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(999);
    expect(probe).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(probe).toHaveBeenCalledTimes(2);
    stop();
  });

  it("waits for a rejected probe before scheduling the next probe", async () => {
    vi.useFakeTimers();
    let rejectProbe: ((reason?: unknown) => void) | undefined;
    const probe = vi.fn(() => new Promise<void>((_resolve, reject) => {
      rejectProbe = reject;
    }));
    const stop = startSingleFlightPolling({
      probe,
      shouldContinue: () => true,
      intervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(5000);
    expect(probe).toHaveBeenCalledTimes(1);

    rejectProbe?.(new Error("probe failed"));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(999);
    expect(probe).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(probe).toHaveBeenCalledTimes(2);
    stop();
  });

  it("cancels a scheduled probe when stopped", async () => {
    vi.useFakeTimers();
    const probe = vi.fn().mockResolvedValue(undefined);
    const stop = startSingleFlightPolling({
      probe,
      shouldContinue: () => true,
      intervalMs: 1000,
    });

    stop();
    await vi.advanceTimersByTimeAsync(5000);

    expect(probe).not.toHaveBeenCalled();
  });

  it("does not resume polling when an in-flight probe finishes after stop", async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    const probe = vi.fn(() => new Promise<void>((resolve) => {
      release = resolve;
    }));
    const stop = startSingleFlightPolling({
      probe,
      shouldContinue: () => true,
      intervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(probe).toHaveBeenCalledOnce();

    stop();
    release?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5000);

    expect(probe).toHaveBeenCalledOnce();
  });

  it("stops when continuation is no longer requested", async () => {
    vi.useFakeTimers();
    let shouldContinue = true;
    const probe = vi.fn().mockResolvedValue(undefined);
    const stop = startSingleFlightPolling({
      probe,
      shouldContinue: () => shouldContinue,
      intervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(probe).toHaveBeenCalledOnce();

    shouldContinue = false;
    await vi.advanceTimersByTimeAsync(5000);

    expect(probe).toHaveBeenCalledOnce();
    stop();
  });
});
