const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60_000;

// Global, not per IP: behind a proxy the address can't be trusted without more setup, and there is only one account.
export class LoginLimiter {
  private failures: number[] = [];
  private readonly now: () => number;

  constructor(now: () => number) {
    this.now = now;
  }

  retryAfterSeconds(): number {
    const at = this.now();
    this.failures = this.failures.filter((t) => at - t < WINDOW_MS);
    if (this.failures.length < MAX_FAILURES) return 0;
    return Math.ceil((this.failures[0]! + WINDOW_MS - at) / 1000);
  }

  // True when this failure is the one that starts a lockout.
  recordFailure(): boolean {
    this.failures.push(this.now());
    return this.failures.length === MAX_FAILURES;
  }

  reset(): void {
    this.failures = [];
  }
}
