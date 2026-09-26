/**
 * The WebSocket to the LAN server (server/lan.mjs), which also serves the game — so the socket
 * lives at the same host the page came from. Messages are small JSON objects with a `t` type.
 */
export type Msg = { t: string; [k: string]: unknown };

export class Link {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, ((m: Msg) => void)[]>();
  onClose: (() => void) | null = null;
  connected = false;

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        reject(e);
        return;
      }
      this.ws = ws;
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('timeout'));
      }, 4000);
      ws.onopen = () => {
        clearTimeout(timer);
        this.connected = true;
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        if (!this.connected) reject(new Error('no server'));
      };
      ws.onclose = () => {
        const was = this.connected;
        this.connected = false;
        if (was) this.onClose?.();
      };
      ws.onmessage = (e) => {
        let m: Msg;
        try {
          m = JSON.parse(e.data as string);
        } catch {
          return;
        }
        for (const h of this.handlers.get(m.t) ?? []) h(m);
        for (const h of this.handlers.get('*') ?? []) h(m);
      };
    });
  }

  send(m: Msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  on(t: string, fn: (m: Msg) => void) {
    let a = this.handlers.get(t);
    if (!a) this.handlers.set(t, (a = []));
    a.push(fn);
  }

  off(t: string) {
    this.handlers.delete(t);
  }

  close() {
    this.connected = false;
    this.ws?.close();
    this.ws = null;
  }
}
