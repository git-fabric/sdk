// Session manager -- tracks gateway session token and validity
import type { SessionState } from './types.js';

export class SessionManager {
  private state: SessionState = {
    session_token: null,
    connected_at: null,
    last_keepalive: null,
  };

  get token(): string | null {
    return this.state.session_token;
  }

  get isValid(): boolean {
    return this.state.session_token !== null;
  }

  refresh(token: string): void {
    const now = Math.floor(Date.now() / 1000);
    this.state = {
      session_token: token,
      connected_at: this.state.connected_at ?? now,
      last_keepalive: now,
    };
  }

  recordKeepalive(): void {
    this.state.last_keepalive = Math.floor(Date.now() / 1000);
  }

  clear(): void {
    this.state = {
      session_token: null,
      connected_at: null,
      last_keepalive: null,
    };
  }

  toJSON(): SessionState {
    return { ...this.state };
  }
}
