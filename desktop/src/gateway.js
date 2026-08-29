// Cliente WebSocket do gateway em tempo real.
// Emite eventos via .on(tipo, handler). Reconecta sozinho.
// Eventos extra: "conn" ({state, latency}), "latency" (ms).

export class Gateway extends EventTarget {
  constructor(baseUrl, token) {
    super();
    this.wsUrl = baseUrl.replace(/^http/, "ws").replace(/\/+$/, "") + "/gateway";
    this.token = token;
    this.ws = null;
    this._hb = null;
    this._closedByUser = false;
    this._backoff = 1000;
    this.state = "connecting"; // connecting | open | reconnecting | closed
    this.latency = null;
    this.attempt = 0;
  }

  _setState(s) {
    this.state = s;
    this.dispatchEvent(new CustomEvent("conn", { detail: { state: s, latency: this.latency } }));
  }

  connect() {
    this._closedByUser = false;
    this._setState(this.attempt ? "reconnecting" : "connecting");
    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = () => {
      this.attempt = 0;
      this._backoff = 1000;
      this._send({ op: "identify", token: this.token });
      this._setState("open");
      this._ping();
      this._hb = setInterval(() => this._ping(), 20000);
    };

    this.ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t === "heartbeat_ack") {
        if (msg.ts) {
          this.latency = Date.now() - msg.ts;
          this.dispatchEvent(new CustomEvent("latency", { detail: this.latency }));
          this.dispatchEvent(new CustomEvent("conn", { detail: { state: this.state, latency: this.latency } }));
        }
        return;
      }
      if (msg.t) {
        this.dispatchEvent(new CustomEvent(msg.t, { detail: msg }));
        this.dispatchEvent(new CustomEvent("*", { detail: msg }));
      }
    };

    this.ws.onclose = () => {
      clearInterval(this._hb);
      this.dispatchEvent(new CustomEvent("disconnected"));
      if (!this._closedByUser) {
        this.attempt++;
        this._setState("reconnecting");
        setTimeout(() => this.connect(), this._backoff);
        this._backoff = Math.min(this._backoff * 1.6, 15000);
      } else {
        this._setState("closed");
      }
    };
  }

  reconnectNow() {
    this._backoff = 1000;
    this.attempt = 1;
    try { this.ws && this.ws.close(); } catch {}
  }

  on(type, cb) { this.addEventListener(type, (e) => cb(e.detail)); }

  _ping() { this._send({ op: "heartbeat", ts: Date.now() }); }

  _send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  sendMessage(channelId, content) { this._send({ op: "send_message", channel_id: channelId, content }); }
  typing(channelId) { this._send({ op: "typing", channel_id: channelId }); }
  rtcJoin(channelId) { this._send({ op: "rtc_join", channel_id: channelId }); }
  rtcLeave(channelId) { this._send({ op: "rtc_leave", channel_id: channelId }); }
  rtcSignal(channelId, toUserId, data) {
    this._send({ op: "rtc_signal", channel_id: channelId, to_user_id: toUserId, data });
  }

  close() {
    this._closedByUser = true;
    clearInterval(this._hb);
    if (this.ws) this.ws.close();
  }
}
