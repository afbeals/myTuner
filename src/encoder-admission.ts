import { DomainError, invariant } from "./domain.js";

type Priority = "interactive" | "background";
interface Waiting {
  priority: Priority;
  signal: AbortSignal;
  admit: () => void;
  reject: (error: unknown) => void;
  abort: () => void;
}
/** Non-preemptive process admission; running optional work finishes at a task boundary. */
export class EncoderAdmission {
  private active = 0;
  private background = 0;
  private interactiveBurst = 0;
  private waiting: Waiting[] = [];
  private stopped = false;
  constructor(readonly total = 3) {
    invariant(
      Number.isInteger(total) && total >= 2 && total <= 8,
      500,
      "Encoder concurrency must be between 2 and 8",
    );
  }
  snapshot() {
    return {
      total: this.total,
      active: this.active,
      background: this.background,
      waitingInteractive: this.waiting.filter(
        (w) => w.priority === "interactive",
      ).length,
      waitingBackground: this.waiting.filter((w) => w.priority === "background")
        .length,
    };
  }
  async run<T>(
    priority: Priority,
    signal: AbortSignal,
    authorize: () => void,
    execute: () => Promise<T>,
    onWaiting?: (waiting: boolean) => void,
  ): Promise<T> {
    signal.throwIfAborted();
    invariant(!this.stopped, 503, "Encoder admission is stopping");
    authorize();
    invariant(
      this.waiting.length < 100,
      429,
      "Encoder queue is full; retry shortly",
    );
    let admitted = false;
    try {
      await new Promise<void>((resolve, reject) => {
        const waiter: Waiting = {
          priority,
          signal,
          reject,
          abort: () => {},
          admit: () => {
            admitted = true;
            this.active++;
            if (priority === "background") {
              this.background++;
              this.interactiveBurst = 0;
            } else this.interactiveBurst++;
            resolve();
          },
        };
        waiter.abort = () => {
          this.waiting = this.waiting.filter((w) => w !== waiter);
          reject(signal.reason);
          this.pump();
        };
        signal.addEventListener("abort", waiter.abort, { once: true });
        this.waiting.push(waiter);
        this.pump();
        if (!admitted) onWaiting?.(true);
      });
      onWaiting?.(false);
      signal.throwIfAborted();
      invariant(!this.stopped, 503, "Encoder admission is stopping");
      authorize();
      return await execute();
    } finally {
      if (admitted) {
        this.active--;
        if (priority === "background") this.background--;
      }
      onWaiting?.(false);
      this.pump();
    }
  }
  private pump() {
    while (!this.stopped && this.active < this.total && this.waiting.length) {
      const interactive = this.waiting.findIndex(
        (w) => w.priority === "interactive",
      );
      const background =
        this.background < this.total - 1
          ? this.waiting.findIndex((w) => w.priority === "background")
          : -1;
      // After eight interactive admissions, allow one optional task when another
      // slot remains reserved for interactive work. Never interrupt an encoder.
      const fair = this.interactiveBurst >= 8;
      const index =
        background >= 0 && (interactive < 0 || fair) ? background : interactive;
      if (index < 0) return;
      const waiter = this.waiting.splice(index, 1)[0]!;
      waiter.signal.removeEventListener("abort", waiter.abort);
      if (waiter.signal.aborted) {
        waiter.reject(waiter.signal.reason);
        continue;
      }
      waiter.admit();
    }
  }
  stop() {
    this.stopped = true;
    for (const waiter of this.waiting.splice(0)) {
      waiter.signal.removeEventListener("abort", waiter.abort);
      waiter.reject(new DomainError(503, "Encoder admission is stopping"));
    }
  }
}
