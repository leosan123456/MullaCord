// Configurações de áudio (microfone / saída / modo de voz) + medidor de nível.
// Guardado por dispositivo no localStorage.

const KEY = "mula.audio";

export const DEFAULTS = {
  micId: "",
  outId: "",
  mode: "open",       // open | vad | ptt
  threshold: 0.06,    // sensibilidade (RMS 0..1) para o modo vad
  pttKey: "",         // ex.: "KeyV"
  ec: true,           // echoCancellation
  ns: true,           // noiseSuppression
  agc: true,          // autoGainControl
  volumes: {},        // userId -> 0..1
};

export function loadAudio() {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) || "{}")) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveAudio(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}

export async function listDevices() {
  let devs = [];
  try { devs = await navigator.mediaDevices.enumerateDevices(); } catch {}
  return {
    inputs: devs.filter((d) => d.kind === "audioinput"),
    outputs: devs.filter((d) => d.kind === "audiooutput"),
  };
}

export function micConstraints(s) {
  const a = { echoCancellation: s.ec, noiseSuppression: s.ns, autoGainControl: s.agc };
  if (s.micId) a.deviceId = { exact: s.micId };
  return { audio: a, video: false };
}

// Medidor de nível independente (para a tela de configurações fora de uma call).
export async function createMeter(deviceId) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: deviceId ? { deviceId: { exact: deviceId } } : true,
  });
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const src = ac.createMediaStreamSource(stream);
  const an = ac.createAnalyser();
  an.fftSize = 512;
  src.connect(an);
  const buf = new Uint8Array(an.fftSize);
  return {
    read() {
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) { const x = (v - 128) / 128; sum += x * x; }
      return Math.sqrt(sum / buf.length);
    },
    stop() {
      stream.getTracks().forEach((t) => t.stop());
      ac.close().catch(() => {});
    },
  };
}
