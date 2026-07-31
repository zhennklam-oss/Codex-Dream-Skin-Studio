export interface RuntimePollingOptions {
  probe(): Promise<unknown>;
  shouldContinue(): boolean;
  intervalMs?: number;
}

export function startSingleFlightPolling({
  probe,
  shouldContinue,
  intervalMs = 1000,
}: RuntimePollingOptions): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (stopped || !shouldContinue()) return;

    timer = setTimeout(async () => {
      timer = null;
      if (stopped || !shouldContinue()) return;

      try {
        await probe();
      } catch {
        // Runtime reconciliation owns user-facing error reporting.
      } finally {
        schedule();
      }
    }, intervalMs);
  };

  schedule();

  return () => {
    stopped = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
