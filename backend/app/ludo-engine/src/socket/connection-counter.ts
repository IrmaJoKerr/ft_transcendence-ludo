// Per-user connection cap. The engine accepts a handful of sockets per account (a tab
// each, a hotseat seat rebind, a reconnect before the old socket is reaped), but not an
// unbounded number. Kept as a plain counter so the rule is testable without a socket.
export class ConnectionCounter {
  private open = new Map<string, number>();

  // True when this user may open one more socket; a yes also counts it.
  acquire(userId: string, cap: number): boolean {
    const now = this.open.get(userId) ?? 0;
    if (now >= cap) return false;
    this.open.set(userId, now + 1);
    return true;
  }

  // One socket closed. A count that reaches zero leaves no entry behind.
  release(userId: string): void {
    const now = this.open.get(userId) ?? 0;
    if (now <= 1) this.open.delete(userId);
    else this.open.set(userId, now - 1);
  }

  count(userId: string): number {
    return this.open.get(userId) ?? 0;
  }
}
