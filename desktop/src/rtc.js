// Malha WebRTC P2P para voz + compartilhamento de tela.
// O servidor só repassa SDP/ICE (signaling). Mídia vai direto entre os pares.
import { loadAudio, saveAudio, micConstraints } from "./audio.js";

const ICE_CONFIG = {
  iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }],
};

export class VoiceSession extends EventTarget {
  constructor(gateway, channelId, localUserId) {
    super();
    this.gw = gateway;
    this.channelId = channelId;
    this.myId = localUserId;
    this.peers = new Map(); // userId -> { pc, videoStream, audioEl }
    this.localStream = null;
    this.screenStream = null;
    this.muted = false;
    this.deafened = false;
    this.settings = loadAudio();
    this.pttHeld = false;
    this.level = 0;

    this._audioBox = document.createElement("div");
    this._audioBox.style.display = "none";
    document.body.append(this._audioBox);

    this._bound = this._onSignal.bind(this);
    this._peersB = this._onPeers.bind(this);
    this._joinB = this._onPeerJoin.bind(this);
    this._leaveB = this._onPeerLeave.bind(this);
    this._keyDown = (e) => { if (this._isPtt(e)) this._setPtt(true); };
    this._keyUp = (e) => { if (this._isPtt(e)) this._setPtt(false); };
  }

  on(type, cb) { this.addEventListener(type, (e) => cb(e.detail)); }
  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async start() {
    this.localStream = await navigator.mediaDevices.getUserMedia(micConstraints(this.settings));
    this._setupVad();
    this._applyGate();

    window.addEventListener("keydown", this._keyDown);
    window.addEventListener("keyup", this._keyUp);
    this.gw.addEventListener("rtc_signal", this._bound);
    this.gw.addEventListener("rtc_peers", this._peersB);
    this.gw.addEventListener("rtc_peer_join", this._joinB);
    this.gw.addEventListener("rtc_peer_leave", this._leaveB);
    this.gw.rtcJoin(this.channelId);
    this._emit("state", this.snapshot());
  }

  leave() {
    this.gw.rtcLeave(this.channelId);
    window.removeEventListener("keydown", this._keyDown);
    window.removeEventListener("keyup", this._keyUp);
    this.gw.removeEventListener("rtc_signal", this._bound);
    this.gw.removeEventListener("rtc_peers", this._peersB);
    this.gw.removeEventListener("rtc_peer_join", this._joinB);
    this.gw.removeEventListener("rtc_peer_leave", this._leaveB);
    for (const { pc, audioEl } of this.peers.values()) {
      pc.close();
      audioEl?.remove();
    }
    this.peers.clear();
    this._teardownVad();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.localStream = this.screenStream = null;
    this._audioBox.remove();
    this._emit("state", this.snapshot());
  }

  // -- microfone / gate ------------------------------------------------
  _micTrack() { return this.localStream?.getAudioTracks()[0] || null; }

  _shouldTransmit() {
    if (this.muted || this.deafened) return false;
    if (this.settings.mode === "ptt") return this.pttHeld;
    if (this.settings.mode === "vad") return this.level >= this.settings.threshold;
    return true;
  }

  _applyGate() {
    const t = this._micTrack();
    if (t) t.enabled = this._shouldTransmit();
  }

  _setupVad() {
    try {
      this._ac = new (window.AudioContext || window.webkitAudioContext)();
      this._an = this._ac.createAnalyser();
      this._an.fftSize = 512;
      this._ac.createMediaStreamSource(this.localStream).connect(this._an);
      this._buf = new Uint8Array(this._an.fftSize);
      const tick = () => {
        if (!this._an) return;
        this._an.getByteTimeDomainData(this._buf);
        let sum = 0;
        for (const v of this._buf) { const x = (v - 128) / 128; sum += x * x; }
        this.level = Math.sqrt(sum / this._buf.length);
        this._applyGate();
        this._emit("level", this.level);
        this._raf = requestAnimationFrame(tick);
      };
      tick();
    } catch { /* sem WebAudio: modo open sempre */ }
  }

  _teardownVad() {
    cancelAnimationFrame(this._raf);
    this._an = null;
    this._ac?.close().catch(() => {});
    this._ac = null;
  }

  _isPtt(e) {
    return this.settings.mode === "ptt" && this.settings.pttKey && e.code === this.settings.pttKey;
  }
  _setPtt(v) {
    if (this.pttHeld === v) return;
    this.pttHeld = v;
    this._applyGate();
    this._emit("state", this.snapshot());
  }

  async setInputDevice(deviceId) {
    this.settings.micId = deviceId;
    saveAudio(this.settings);
    if (!this.localStream) return;
    const fresh = await navigator.mediaDevices.getUserMedia(micConstraints(this.settings));
    const newTrack = fresh.getAudioTracks()[0];
    for (const { pc } of this.peers.values()) {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === "audio");
      if (sender) await sender.replaceTrack(newTrack);
    }
    this._micTrack()?.stop();
    this.localStream = fresh;
    this._teardownVad();
    this._setupVad();
    this._applyGate();
  }

  async setOutputDevice(deviceId) {
    this.settings.outId = deviceId;
    saveAudio(this.settings);
    for (const { audioEl } of this.peers.values()) {
      if (audioEl?.setSinkId && deviceId) await audioEl.setSinkId(deviceId).catch(() => {});
    }
  }

  setMode(mode) { this.settings.mode = mode; saveAudio(this.settings); this._applyGate(); this._emit("state", this.snapshot()); }
  setThreshold(v) { this.settings.threshold = v; saveAudio(this.settings); }
  setPttKey(code) { this.settings.pttKey = code; saveAudio(this.settings); }
  setProcessing(patch) { Object.assign(this.settings, patch); saveAudio(this.settings); }

  setUserVolume(userId, vol) {
    this.settings.volumes[userId] = vol;
    saveAudio(this.settings);
    const p = this.peers.get(userId);
    if (p?.audioEl) p.audioEl.volume = this.deafened ? 0 : vol;
  }

  toggleMute() {
    this.muted = !this.muted;
    this._applyGate();
    this._emit("state", this.snapshot());
    return this.muted;
  }

  toggleDeafen() {
    this.deafened = !this.deafened;
    if (this.deafened) this.muted = true;
    for (const [uid, p] of this.peers.entries()) {
      if (p.audioEl) p.audioEl.volume = this.deafened ? 0 : (this.settings.volumes[uid] ?? 1);
    }
    this._applyGate();
    this._emit("state", this.snapshot());
    return this.deafened;
  }

  // -- tela ----------------------------------------------------------
  async startScreenShare() {
    this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
    const track = this.screenStream.getVideoTracks()[0];
    track.onended = () => this.stopScreenShare();
    for (const { pc } of this.peers.values()) pc.addTrack(track, this.screenStream);
    this._renegotiateAll();
    this._emit("state", this.snapshot());
  }

  stopScreenShare() {
    if (!this.screenStream) return;
    const track = this.screenStream.getVideoTracks()[0];
    for (const { pc } of this.peers.values()) {
      const sender = pc.getSenders().find((s) => s.track === track);
      if (sender) pc.removeTrack(sender);
    }
    this.screenStream.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    this._renegotiateAll();
    this._emit("state", this.snapshot());
  }

  snapshot() {
    return {
      active: !!this.localStream,
      muted: this.muted,
      deafened: this.deafened,
      mode: this.settings.mode,
      pttHeld: this.pttHeld,
      transmitting: this._shouldTransmit(),
      sharingScreen: !!this.screenStream,
      screenStream: this.screenStream,
      peers: [...this.peers.entries()].map(([id, p]) => ({
        userId: id,
        stream: p.videoStream,
        volume: this.settings.volumes[id] ?? 1,
      })),
    };
  }

  // -- internals --------------------------------------------------
  _makePeer(userId) {
    if (this.peers.has(userId)) return this.peers.get(userId);
    const pc = new RTCPeerConnection(ICE_CONFIG);
    const audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    audioEl.volume = this.deafened ? 0 : (this.settings.volumes[userId] ?? 1);
    this._audioBox.append(audioEl);
    if (audioEl.setSinkId && this.settings.outId) audioEl.setSinkId(this.settings.outId).catch(() => {});

    const entry = { pc, videoStream: new MediaStream(), audioEl };
    this.peers.set(userId, entry);

    this.localStream.getTracks().forEach((t) => pc.addTrack(t, this.localStream));
    if (this.screenStream) this.screenStream.getTracks().forEach((t) => pc.addTrack(t, this.screenStream));

    pc.onicecandidate = (e) => {
      if (e.candidate) this.gw.rtcSignal(this.channelId, userId, { kind: "candidate", candidate: e.candidate });
    };
    pc.ontrack = (e) => {
      const track = e.track;
      if (track.kind === "audio") {
        const s = audioEl.srcObject instanceof MediaStream ? audioEl.srcObject : new MediaStream();
        s.addTrack(track);
        audioEl.srcObject = s;
        audioEl.play().catch(() => {});
      } else {
        entry.videoStream.addTrack(track);
      }
      this._emit("state", this.snapshot());
    };
    pc.onnegotiationneeded = async () => {
      if (this.myId > userId) await this._offer(userId);
    };
    return entry;
  }

  async _offer(userId) {
    const { pc } = this._makePeer(userId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.gw.rtcSignal(this.channelId, userId, { kind: "sdp", sdp: pc.localDescription });
  }

  _renegotiateAll() {
    for (const userId of this.peers.keys()) if (this.myId > userId) this._offer(userId);
  }

  async _onPeers({ detail }) {
    if (detail.channel_id !== this.channelId) return;
    for (const userId of detail.user_ids) {
      this._makePeer(userId);
      if (this.myId > userId) await this._offer(userId);
    }
  }
  async _onPeerJoin({ detail }) {
    if (detail.channel_id !== this.channelId) return;
    this._makePeer(detail.user_id);
    if (this.myId > detail.user_id) await this._offer(detail.user_id);
  }
  _onPeerLeave({ detail }) {
    if (detail.channel_id !== this.channelId) return;
    const entry = this.peers.get(detail.user_id);
    if (entry) {
      entry.pc.close();
      entry.audioEl?.remove();
      this.peers.delete(detail.user_id);
      this._emit("state", this.snapshot());
    }
  }

  async _onSignal({ detail }) {
    if (detail.channel_id !== this.channelId) return;
    const from = detail.from_user_id;
    const { pc } = this._makePeer(from);
    const data = detail.data || {};
    if (data.kind === "sdp") {
      await pc.setRemoteDescription(data.sdp);
      if (data.sdp.type === "offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.gw.rtcSignal(this.channelId, from, { kind: "sdp", sdp: pc.localDescription });
      }
    } else if (data.kind === "candidate") {
      try { await pc.addIceCandidate(data.candidate); } catch (_) {}
    }
  }
}
