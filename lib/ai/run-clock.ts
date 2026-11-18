import { AsyncLocalStorage } from "node:async_hooks";

// Time limits for agent runs that stop counting while the agent waits for the user (signing in on the cloud
// computer, solving a captcha, choosing a service). Each run (a task, an agent) adds its clock to the async
// context; `pauseRunClocks()` pauses every clock of the current run, however deeply it is nested.

export class RunClock {
  private readonly controller = new AbortController();
  private remainingMs: number;
  private startedAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pauses = 0;
  readonly signal: AbortSignal;

  constructor(readonly seconds: number, parent?: AbortSignal) {
    this.remainingMs = seconds * 1000;
    this.signal = parent ? AbortSignal.any([parent, this.controller.signal]) : this.controller.signal;
    this.start();
  }

  /** True when this clock (not the parent signal) ran out. */
  get expired() { return this.controller.signal.aborted; }

  private start() {
    this.startedAt = Date.now();
    this.timer = setTimeout(() => this.controller.abort(new DOMException(`Time limit of ${this.seconds}s reached.`, "TimeoutError")), Math.max(0, this.remainingMs));
  }

  pause() {
    if (this.pauses++ > 0 || !this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.remainingMs -= Date.now() - this.startedAt;
  }

  resume() {
    if (this.pauses === 0 || --this.pauses > 0 || this.expired) return;
    this.start();
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

const clocks = new AsyncLocalStorage<RunClock[]>();

/** Runs `fn` with `clock` added to the current run's clocks. */
export function withRunClock<T>(clock: RunClock, fn: () => Promise<T>): Promise<T> {
  return clocks.run([...(clocks.getStore() ?? []), clock], fn);
}

/** Pauses every time limit of the current run until the returned function is called. */
export function pauseRunClocks(): () => void {
  const active = clocks.getStore() ?? [];
  active.forEach((clock) => clock.pause());
  let resumed = false;
  return () => {
    if (resumed) return;
    resumed = true;
    active.forEach((clock) => clock.resume());
  };
}
