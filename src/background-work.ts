import { DomainError, invariant } from "./domain.js";

interface Waiting {
  kind: string;
  signal: AbortSignal | undefined;
  start: () => void;
  reject: (error: unknown) => void;
  abort: () => void;
}

/** One optional filesystem workload at a time. Running encoders finish their task. */
export class BackgroundWork {
  private active: string | null = null;
  private waiting: Waiting[] = [];
  private paused = false;
  private admitted = 0;
  private completed = 0;
  private stopped = false;
  private resumes = new Set<() => void>();
  constructor(private readonly capacity = 32) {}
  snapshot() {
    return {
      active: this.active,
      waiting: this.waiting.length,
      paused: this.paused,
      admitted: this.admitted,
      completed: this.completed,
    };
  }
  setPaused(paused: boolean) {
    this.paused = paused;
    if (!paused) {
      for (const resume of [...this.resumes]) resume();
      this.pump();
    }
  }
  private async checkpoint(signal?: AbortSignal) {
    signal?.throwIfAborted();
    invariant(!this.stopped, 503, "Background work is stopping");
    while (this.paused) {
      await new Promise<void>((resolve, reject) => {
        const resume = () => {
          this.resumes.delete(resume);
          signal?.removeEventListener("abort", abort);
          if (this.stopped)
            reject(new DomainError(503, "Background work is stopping"));
          else resolve();
        };
        const abort = () => {
          this.resumes.delete(resume);
          signal?.removeEventListener("abort", abort);
          reject(signal?.reason);
        };
        this.resumes.add(resume);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
      signal?.throwIfAborted();
    }
    invariant(!this.stopped, 503, "Background work is stopping");
  }
  async run<T>(
    kind: string,
    signal: AbortSignal | undefined,
    work: (checkpoint: () => Promise<void>) => Promise<T>,
  ): Promise<T> {
    signal?.throwIfAborted();
    invariant(!this.stopped, 503, "Background work is stopping");
    invariant(
      this.waiting.length < this.capacity,
      429,
      "Background queue is full; retry shortly",
    );
    await new Promise<void>((resolve, reject) => {
      const waiter: Waiting = {
        kind,
        signal,
        reject,
        abort: () => {},
        start: () => {
          this.active = kind;
          this.admitted++;
          resolve();
        },
      };
      waiter.abort = () => {
        this.waiting = this.waiting.filter((entry) => entry !== waiter);
        signal?.removeEventListener("abort", waiter.abort);
        reject(signal?.reason);
        this.pump();
      };
      this.waiting.push(waiter);
      signal?.addEventListener("abort", waiter.abort, { once: true });
      this.pump();
    });
    try {
      await this.checkpoint(signal);
      return await work(() => this.checkpoint(signal));
    } finally {
      this.active = null;
      this.completed++;
      this.pump();
    }
  }
  private pump() {
    if (this.active || this.paused || this.stopped) return;
    const waiter = this.waiting.shift();
    if (!waiter) return;
    waiter.signal?.removeEventListener("abort", waiter.abort);
    if (waiter.signal?.aborted) {
      waiter.reject(waiter.signal.reason);
      this.pump();
    } else waiter.start();
  }
  stop() {
    this.stopped = true;
    for (const waiter of this.waiting.splice(0)) {
      waiter.signal?.removeEventListener("abort", waiter.abort);
      waiter.reject(new DomainError(503, "Background work is stopping"));
    }
    for (const resume of [...this.resumes]) resume();
  }
}
