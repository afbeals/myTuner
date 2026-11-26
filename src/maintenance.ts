import { setImmediate } from "node:timers/promises";

type Lane = "schedules" | "housekeeping" | "refresh";
// Independent singleflight lanes: a scan cannot hold the schedule timer or
// short lifecycle housekeeping hostage. Each lane still serializes itself.
export class Maintenance {
  private active = new Map<Lane, Promise<void>>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;
  constructor(
    private readonly tasks: Record<Lane, () => Promise<void> | void>,
    private readonly failed: (lane: Lane) => void,
  ) {}
  run(lane: Lane): Promise<void> {
    if (this.stopped) return Promise.resolve();
    const pending = this.active.get(lane);
    if (pending) return pending;
    const task = Promise.resolve()
      .then(() => {
        if (!this.stopped) return this.tasks[lane]();
      })
      .catch(() => this.failed(lane))
      .finally(() => this.active.delete(lane));
    this.active.set(lane, task);
    return task;
  }
  tick() {
    for (const lane of ["schedules", "housekeeping", "refresh"] as const)
      void this.run(lane);
  }
  start(intervalMs = 30000) {
    if (this.stopped || this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.timer.unref();
  }
  get stopping() {
    return this.stopped;
  }
  async yield() {
    await setImmediate();
  }
  requestStop() {
    this.stopped = true;
    clearInterval(this.timer);
  }
  async stop() {
    this.requestStop();
    await Promise.allSettled(this.active.values());
  }
}
