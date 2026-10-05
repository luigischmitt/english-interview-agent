// Animation engine of the toucan interviewer (framework-free; no window/document access at module scope).
// Ported from the approved standalone prototype: critically damped springs, value-noise idle motion, a tanh limiter,
// a skinned head/neck/back silhouette and bib, blinks, gaze, four states (idle / speaking / listening / thinking),
// an offline beak envelope computed from the decoded interviewer audio, "empty mouth" (style D) and head-only yes-nods
// driven by the candidate's microphone level. The DOM is only touched through `createToucanEngine` (SVG attributes).

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** Smooth saturation instead of a hard clip: |sat(x, L)| < L for every finite x. */
export const sat = (x, L) => (L > 1e8 ? x : L * Math.tanh(x / L));

/** Critically damped spring (no overshoot at z=1); retargeting keeps the velocity, so it is interruptible. */
export class Spring {
  constructor(value, omega, zeta = 1) { this.x = value; this.v = 0; this.t = value; this.w = omega; this.z = zeta; }
  step(dt) {
    const n = 4;
    const h = dt / n;
    for (let i = 0; i < n; i += 1) {
      const a = -this.w * this.w * (this.x - this.t) - 2 * this.z * this.w * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
  }
}

/* Slow smooth value noise (cubic-interpolated random keypoints, three incommensurate octaves): no mechanical sinusoids. */
const hash = (n, s) => { const x = Math.sin(n * 127.1 + s * 311.7) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; };
export const valueNoise = (t, s) => {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  return hash(i, s) * (1 - u) + hash(i + 1, s) * u;
};
export const noise = (t, s) => 0.62 * valueNoise(t / 2.9, s) + 0.28 * valueNoise(t / 1.3, s + 7) + 0.10 * valueNoise(t / 0.61, s + 13);

/* ------------------------------------------------------------------ beak */

export const JAW = { omega: 28, zeta: 0.7, attack: 0.035, release: 0.11, chatter: 0.025, chatterHz: 9.2, lookahead: 0.06, maxAngle: 10 };

/**
 * Offline analysis of a whole decoded channel (5 ms hop): loudness envelope, a zero-crossing proxy for hiss
 * (fricatives like s/f/sh have a high ZCR, so they open the beak less), syllable segmentation with a random
 * per-syllable gain, stressed-syllable onsets and pauses. Because the entire buffer is known, playback can look ahead.
 */
export function analyseSamples(data, sampleRate, rng = Math.random) {
  const hop = Math.max(1, Math.round(sampleRate * 0.005));
  const win = Math.max(2, Math.round(sampleRate * 0.024));
  const n = Math.floor(data.length / hop);
  const rms = new Float32Array(n);
  const fq = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const c = i * hop;
    const s = Math.max(0, Math.floor(c - win / 2)); // integer bounds: `win` is odd at 22.05 kHz
    const e = Math.min(data.length, Math.floor(c + win / 2));
    let sum = 0;
    let cr = 0;
    let last = 0;
    for (let k = s; k < e; k += 1) {
      const v = data[k];
      sum += v * v;
      const sg = v > 0.004 ? 1 : v < -0.004 ? -1 : 0;
      if (sg && last && sg !== last) cr += 1;
      if (sg) last = sg;
    }
    rms[i] = Math.sqrt(sum / (e - s));
    fq[i] = (cr * sampleRate) / (2 * (e - s));
  }
  const sorted = Array.from(rms).sort((a, b) => a - b);
  const p98 = sorted[Math.floor(n * 0.98)] || 0.1;
  const smooth = (arr, r) => arr.map((_, i) => {
    let s = 0;
    let c = 0;
    for (let k = Math.max(0, i - r); k <= Math.min(arr.length - 1, i + r); k += 1) { s += arr[k]; c += 1; }
    return s / c;
  });
  const env = smooth(Array.from(rms, (v) => clamp((v / p98 - 0.05) / 0.95, 0, 1)), 2);
  const fqs = smooth(Array.from(fq), 4);
  const cons = new Float32Array(n);
  const gain = new Float32Array(n);
  const events = [];
  let inSyllable = false;
  let g = 1;
  let start = 0;
  let peak = 0;
  for (let i = 0; i < n; i += 1) {
    cons[i] = smoothstep(1800, 4200, fqs[i]);
    if (!inSyllable && env[i] > 0.28) { inSyllable = true; start = i; peak = 0; g = 0.78 + rng() * 0.36; }
    else if (inSyllable && env[i] < 0.14) { inSyllable = false; events.push({ t: (start * hop) / sampleRate, s: peak }); }
    if (inSyllable) peak = Math.max(peak, env[i]);
    gain[i] = g;
  }
  if (inSyllable) events.push({ t: (start * hop) / sampleRate, s: peak });
  const pauses = [];
  let run = 0;
  for (let i = 0; i < n; i += 1) {
    if (env[i] < 0.08) run += 1;
    else {
      if ((run * hop) / sampleRate >= 0.22 && ((i - run) * hop) / sampleRate > 0.2) pauses.push({ t0: ((i - run) * hop) / sampleRate, t1: (i * hop) / sampleRate });
      run = 0;
    }
  }
  return { env, cons, gain, events, pauses, dur: data.length / sampleRate, hopT: hop / sampleRate, n };
}

/** `AudioBuffer` front end of `analyseSamples` (first channel). */
export const analyseBuffer = (buffer, rng) => analyseSamples(buffer.getChannelData(0), buffer.sampleRate, rng);

/** Beak opening target (0..1.05) and sustained-vowel chatter at playback position `pos` (seconds). */
export function beakTargetAt(features, pos, t) {
  const idx = clamp(Math.floor(pos / features.hopT), 0, features.n - 1);
  const e = features.env[idx];
  const c = features.cons[idx];
  // Soft consonants open less; the per-syllable gain adds variety.
  const raw = clamp(e * features.gain[idx] * (1 - 0.62 * c), 0, 1.05);
  const target = Math.pow(raw, 0.9);
  const chatter = Math.sin(t * 2 * Math.PI * JAW.chatterHz) * JAW.chatter * smoothstep(0.45, 0.75, e) * (1 - c);
  return { target, chatter, env: e, cons: c };
}

/** Gentle syllable-like beak motion for when the audio could not be analysed (decode failed or still pending). */
export function genericBeakTarget(t) {
  const phrase = smoothstep(-0.55, -0.2, valueNoise(t / 1.7, 23));
  const syllable = Math.max(0, valueNoise(t * 4.2, 21)) * 0.8 + Math.max(0, valueNoise(t * 9, 22)) * 0.25;
  return clamp(phrase * (0.2 + syllable), 0, 0.7);
}

/** Jaw: asymmetric level smoothing followed by a slightly underdamped spring. Output is always within 0..1.15. */
export class JawModel {
  constructor() { this.spring = new Spring(0, JAW.omega, JAW.zeta); this.level = 0; this.mouth = 0; }
  step(dt, target, chatter = 0) {
    this.level += (target - this.level) * (1 - Math.exp(-dt / (target > this.level ? JAW.attack : JAW.release)));
    this.spring.t = this.level;
    this.spring.step(dt);
    this.mouth = clamp(this.spring.x + chatter * (target > 0.2 ? 1 : 0), 0, 1.15);
    if (target === 0 && this.level < 0.01 && this.mouth < 0.015) { this.mouth = 0; this.spring.x = 0; this.spring.v = 0; this.level = 0; }
    return this.mouth;
  }
}

/* ------------------------------------------------------------------ nods */

export const NOD = {
  single: { A: 4.6, dn: 0.26, up: 0.36 },
  double: [{ A: 4.0, dn: 0.22, up: 0.28, at: 0 }, { A: 2.6, dn: 0.2, up: 0.3, at: 0.6 }],
};

/** Crisp "yes": head-only rotation, down fast then up, with a tiny ease-out settle. */
export class NodScheduler {
  constructor() { this.nods = []; this.count = 0; }
  add(t0, kind) {
    this.count += 1;
    if (kind === "double") for (const n of NOD.double) this.nods.push({ t0: t0 + n.at, A: n.A, dn: n.dn, up: n.up });
    else this.nods.push({ t0, ...NOD.single });
  }
  rotation(t) {
    this.nods = this.nods.filter((n) => t - n.t0 < n.dn + n.up + 0.3);
    let r = 0;
    for (const n of this.nods) {
      const u = t - n.t0;
      if (u < 0) continue;
      if (u < n.dn) r += n.A * smoothstep(0, 1, u / n.dn);
      else if (u < n.dn + n.up) r += n.A * (1 - smoothstep(0, 1, (u - n.dn) / n.up));
      else r -= 0.06 * n.A * Math.sin(clamp((u - n.dn - n.up) / 0.25, 0, 1) * Math.PI);
    }
    return r;
  }
}

/**
 * Watches the candidate's voice level while the interviewer listens. When a phrase of at least 1.6 s ends (level
 * below the threshold for 350 ms) it answers, 90% of the time, with a single nod (50%), a double nod (35%) or a
 * small head tilt (15%) landing just after the phrase ends.
 */
export class PhraseListener {
  constructor(rng = Math.random) { this.rng = rng; this.active = false; this.t0 = 0; this.low = 0; }
  update(t, level, listening) {
    if (!listening) { this.active = false; this.low = 0; return null; }
    if (level > 0.15) {
      if (!this.active) { this.active = true; this.t0 = t; }
      this.low = 0;
      return null;
    }
    if (!this.active) return null;
    if (!this.low) this.low = t;
    if (t - this.low <= 0.35) return null;
    let reaction = null;
    if (t - this.t0 > 1.6 && this.rng() < 0.9) {
      const r = this.rng();
      reaction = r < 0.5 ? { kind: "single", at: t + 0.1 } : r < 0.85 ? { kind: "double", at: t + 0.1 } : { kind: "tilt", at: t + 0.1, a: (this.rng() < 0.5 ? -1 : 1) * 3.6 };
    }
    this.active = false;
    this.low = 0;
    return reaction;
  }
}

/* ----------------------------------------------------------------- state */

export const TOUCAN_STATES = ["idle", "speaking", "listening", "thinking"];

/**
 * Room phase -> avatar state. The interviewer talks while it has audio to play; the candidate answering is "listening";
 * deciding the next turn (including clarification decisions) is "thinking"; everything else is "idle".
 */
export function toucanStateFor({ phase, audioPlaying = true }) {
  if (phase === "introducing" || phase === "speaking" || phase === "closing") return audioPlaying ? "speaking" : "idle";
  if (phase === "answering") return "listening";
  if (phase === "advancing") return "thinking";
  return "idle";
}

/** The clock reading of a media element is coarse on some browsers: interpolate between changes (resync on drift). */
export function createClockInterpolator(maxExtrapolation = 0.1) {
  let lastRaw = Number.NaN;
  let lastAt = 0;
  return (raw, now) => {
    if (!Number.isFinite(raw)) return 0;
    if (raw !== lastRaw) { lastRaw = raw; lastAt = now; return raw; }
    return raw + clamp(now - lastAt, 0, maxExtrapolation);
  };
}

/* ----------------------------------------------------------- speech feed */

let sharedDecoder = null;
/** Decodes an audio blob with one shared (offline, 22.05 kHz mono) context: enough for an envelope, never makes sound. */
export async function decodeBlobToBuffer(blob) {
  if (!sharedDecoder) {
    const Offline = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
    if (!Offline) throw new Error("no OfflineAudioContext");
    sharedDecoder = new Offline(1, 1, 22_050);
  }
  const bytes = await blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    // Safari supports the promise form; the callback form covers older WebKit.
    const result = sharedDecoder.decodeAudioData(bytes, resolve, reject);
    if (result && typeof result.then === "function") result.then(resolve, reject);
  });
}

/**
 * Receives the interviewer's audio chunks (see `onChunkAudio` in speech-playback.mjs), analyses each one offline as soon
 * as it arrives and tells the avatar, every frame, which chunk is playing and where. Never touches playback.
 */
export function createSpeechFeed({ decode = decodeBlobToBuffer, rng = Math.random, maxEntries = 6 } = {}) {
  let entries = [];
  let serial = 0;

  const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

  const analyse = async (entry) => {
    try {
      const { info } = entry;
      const buffer = typeof info.decodeAudio === "function" ? await info.decodeAudio() : await decode(info.blob);
      entry.features = analyseBuffer(buffer, rng);
    } catch {
      entry.failed = true;
    }
  };

  return {
    /** Register a chunk. Safe to pass as the `onChunkAudio` callback. */
    push(info) {
      if (!info) return;
      if (info.chunkIndex === 0) entries = [];
      const entry = { id: ++serial, info, features: null, failed: false, seenPlaying: false, interpolate: createClockInterpolator() };
      entries.push(entry);
      if (entries.length > maxEntries) entries.shift();
      void analyse(entry);
    },
    reset() { entries = []; },
    /** The chunk that is playing now (or null): its features (null while analysing / if failed) and position in seconds. */
    sample(now) {
      entries = entries.filter((e) => !(e.seenPlaying && !safe(() => e.info.isPlaying(), false)));
      for (const entry of entries) {
        if (!safe(() => entry.info.isPlaying(), false)) continue;
        entry.seenPlaying = true;
        const pos = entry.interpolate(safe(() => Number(entry.info.clock()), 0), now);
        return { id: entry.id, features: entry.features, failed: entry.failed, pos, endsWithQuestion: Boolean(entry.info.endsWithQuestion) };
      }
      return null;
    },
    get size() { return entries.length; },
  };
}

/* ----------------------------------------------------------------- shape */

const E0 = [[219, 92], [272, 86], [330, 80], [372, 88]];
// The mouth ("D", an empty mouth: a faint wedge between the mandibles) follows the first 16% of the upper edge curve.
function subdivide(t) {
  const l = (a, b) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const [p0, p1, p2, p3] = E0;
  const q0 = l(p0, p1); const q1 = l(p1, p2); const q2 = l(p2, p3);
  const r0 = l(q0, q1); const r1 = l(q1, q2);
  return [p0, q0, r0, l(r0, r1)];
}
const MOUTH_TOP = subdivide(0.16);
const BIB_POINTS = [[168, 82], [180, 98], [198, 96], [220, 98], [222, 114], [216, 140], [208, 160], [205, 180], [195, 196], [180, 212], [166, 200], [150, 186], [146, 158], [143, 128], [150, 100], [168, 82]];
export const BIB_PATH_REST = "M168,82C180,98 198,96 220,98C222,114 216,140 208,160C205,180 195,196 180,212C166,200 150,186 146,158C143,128 150,100 168,82Z";

const f2 = (v) => v.toFixed(2);
const rot = (x, y, a, cx, cy) => {
  const r = (a * Math.PI) / 180;
  const c = Math.cos(r); const s = Math.sin(r);
  const dx = x - cx; const dy = y - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
};
const LIM = { r: 2.5, x: 3.7, y: 1.2, bt: 0.83, bx: 1.0, fin: 10 };

/** Pose -> point transforms for the head (rotates about the head/neck junction), neck and body. */
function transforms(p) {
  const H = (x, y) => { const q = rot(x, y, p.headRot, 165, 150); return [q[0] + p.hX, q[1] + p.hY]; };
  const Hn = (x, y) => { const q = rot(x, y, p.nT, 165, 150); return [q[0] + p.nX, q[1] + p.nY]; };
  const B = (x, y) => { const q = rot(110 + (x - 110) * p.sx, y, p.bT, 150, 236); return [q[0] + p.bX, q[1]]; };
  return { H, Hn, B };
}

// Skinned neck: nape and throat endpoints ride the head / body transforms, so the dark outline stays continuous.
function skinPath({ H, Hn, B }) {
  const Lh = H(143.4, 58); const Lb = B(118, 112); const Rh = H(208.6, 103.7); const Rb = B(208.6, 103.7);
  const a1 = Hn(133.4, 75.3); const b1 = B(133.4, 75.3); const a2 = Hn(126.6, 94); const b2 = B(126.6, 94);
  const c1 = [a1[0] * 0.7 + b1[0] * 0.3, a1[1] * 0.7 + b1[1] * 0.3];
  const c2 = [a2[0] * 0.3 + b2[0] * 0.7, a2[1] * 0.3 + b2[1] * 0.7];
  const p = (q) => `${f2(q[0])} ${f2(q[1])}`;
  return `M${p(Lh)}C${p(c1)} ${p(c2)} ${p(Lb)}L${p(B(122, 130))}L${p(B(212, 130))}L${p(Rb)}L${p(Rh)}Z`;
}

// Bib: skinned between head (top, stays glued to the beak base) and chest/body (bottom).
function bibPath({ H, B }, p) {
  const pts = BIB_POINTS.map((q) => {
    const w0 = clamp((q[1] - 84) / 128, 0, 1);
    const w = w0 * w0 * (3 - 2 * w0);
    const a = H(q[0], q[1]); const b = B(q[0], q[1]);
    const m = [a[0] * (1 - w) + b[0] * w, a[1] * (1 - w) + b[1] * w];
    return rot(m[0] - p.hX, m[1] - p.hY, -p.headRot, 165, 150);
  });
  const P = (i) => `${f2(pts[i][0])} ${f2(pts[i][1])}`;
  return `M${P(0)}C${P(1)} ${P(2)} ${P(3)}C${P(4)} ${P(5)} ${P(6)}C${P(7)} ${P(8)} ${P(9)}C${P(10)} ${P(11)} ${P(12)}C${P(13)} ${P(14)} ${P(15)}Z`;
}

/** Mouth wedge path for a given opening (0..1.15), hinged at (223, 94). Empty when the beak is (almost) closed. */
export function mouthWedgePath(mouth) {
  if (mouth < 0.03) return "";
  const th = (mouth * JAW.maxAngle * Math.PI) / 180;
  const cs = Math.cos(th); const sn = Math.sin(th);
  const R = (q) => { const dx = q[0] - 223; const dy = q[1] - 94; return [223 + dx * cs - dy * sn, 94 + dx * sn + dy * cs]; };
  const P = (q) => `${f2(q[0])} ${f2(q[1])}`;
  const top = MOUTH_TOP;
  const bot = top.map(R);
  const mid = top.map((q, i) => [(q[0] + bot[i][0]) / 2, (q[1] + bot[i][1]) / 2]);
  const s = top[3]; const Rs = bot[3]; const Ms = mid[3];
  const tip = [Ms[0] + 24, Ms[1]];
  const cv = (c) => `C${P(c[1])} ${P(c[2])} ${P(c[3])}`;
  const rv = (c) => `C${P(c[2])} ${P(c[1])} ${P(c[0])}`;
  return `M${P(top[0])}${cv(top)}Q${P([s[0] + 14, s[1]])} ${P(tip)}Q${P([Rs[0] + 14, Rs[1]])} ${P(Rs)}${rv(bot)}Z`;
}

const REST = { headRot: 0, hX: 0, hY: 0, nT: 0, nX: 0, nY: 0, bT: 0, bX: 0, sx: 1 };
/** Paths for the first (server) render, before the engine runs. */
export const REST_SKIN_PATH = skinPath(transforms(REST));
export const REST_BIB_PATH = BIB_PATH_REST;

/* ---------------------------------------------------------------- engine */

const ELEMENTS = ["head", "body", "tail", "beak", "upper", "lower", "mouth", "wedge", "skin", "bib", "pup", "lid", "lash"];

/**
 * @param {{ root: ParentNode, rng?: () => number, reducedMotion?: () => boolean }} options `root` contains the elements
 *   marked `data-tc="head" | "body" | ...` (see toucan-avatar.tsx).
 */
export function createToucanEngine({ root, rng = Math.random, reducedMotion = () => false }) {
  const el = {};
  for (const name of ELEMENTS) el[name] = root.querySelector(`[data-tc="${name}"]`);
  const written = new WeakMap();
  const attr = (node, name, value) => {
    if (!node) return;
    const key = `${name}`;
    const memo = written.get(node) ?? {};
    if (memo[key] === value) return;
    memo[key] = value;
    written.set(node, memo);
    node.setAttribute(name, value);
  };

  const rnd = (a, b) => a + rng() * (b - a);
  const M = () => (reducedMotion() ? 0 : 1);

  // Spring-driven pose channels. Chained: the head leads; neck, body and tail follow with delay.
  const S = {
    tilt: new Spring(0, 6.5), hx: new Spring(0, 6.5), hy: new Spring(0, 6.5), turn: new Spring(0, 6),
    nT: new Spring(0, 4.5), nX: new Spring(0, 4.5), nY: new Spring(0, 4.5),
    bT: new Spring(0, 3.4, 0.8), bX: new Spring(0, 3.4, 0.8),
    tl: new Spring(0, 3, 0.6),
    lookX: new Spring(0, 22), lookY: new Spring(0, 22), lid: new Spring(0, 14), beat: new Spring(0, 7), ql: new Spring(0, 7), glance: new Spring(0, 6), lr: new Spring(0, 14, 0.7), lift: new Spring(0, 20, 0.5),
  };
  const PHR = new Spring(0, 2.6);
  const PHR2 = new Spring(0, 5);
  const jaw = new JawModel();
  const nods = new NodScheduler();
  const listener = new PhraseListener(rng);

  let requested = "idle";
  let shown = "idle";
  let lastPlay = -9;
  const T = { blink: 1.5, look: 2.5, sacc: 0.4, tilt: 4 };
  let blinkStart = -9;
  let blinkDur = [0.06, 0.19];
  const blinkQueue = [];
  let lookHold = 0;
  let look = { x: 0, y: 0 };
  let sacc = { x: 0, y: 0 };
  let idleTilt = 0;
  let mouth = 0;
  let jawQuestion = 0;
  const HP = { r: 0, x: 0, y: 0 };
  let beatUntil = 0; let beatAmp = 0; let glUntil = 0; let glAmp = 0; let emphSign = 1; let lastEmph = -9;
  let tiltPulse = { t: -9, a: 0 };
  let candidateLevel = 0;
  let feed = null;
  let cur = { id: 0, ev: 0, pz: 0, ready: false };

  const applyState = (s, t) => { shown = s; lookHold = 0; T.look = t + rnd(0.5, 1.5); };

  function emphasis(t, s) {
    if (s > 0.8 && t - lastEmph > 1.5 && rng() > 0.4) {
      lastEmph = t; emphSign = rng() < 0.5 ? -1 : 1; beatUntil = t + 0.16; beatAmp = 3.2 * s; S.lr.v += 9 * s;
    }
  }
  function phraseBoundary(t, d) {
    glUntil = t + 0.25; glAmp = 3;
    if (rng() < 0.55) { lookHold = 1; look = { x: (rng() < 0.5 ? -1 : 1) * rnd(0.5, 0.9), y: rnd(-0.7, -0.15) }; T.look = t + Math.min(d + 0.1, 1.3); }
    else { lookHold = 0; look = { x: 0, y: 0 }; T.look = t + rnd(0.8, 1.6); }
  }

  function scheduleEvents(t) {
    // Blinks: quick close, slower open (~20% double); slower overall when listening.
    if (t > T.blink) {
      const slow = shown === "listening";
      blinkDur = slow ? [0.08, 0.27] : shown === "speaking" ? [0.06, 0.16] : [0.06, 0.19];
      blinkStart = t;
      if (!slow && rng() < 0.2) blinkQueue.push(t + 0.3);
      T.blink = t + (slow ? rnd(3, 5.5) : shown === "speaking" ? rnd(2.4, 5) : rnd(2.2, 5.5));
    }
    if (blinkQueue.length && t > blinkQueue[0]) { blinkQueue.shift(); blinkStart = t; }
    if (t > T.sacc) { const a = shown === "thinking" ? 0.18 : 0.1; sacc = { x: rnd(-a, a), y: rnd(-a, a) * 0.7 }; T.sacc = t + rnd(0.25, 1.1); }
    if (t > T.look) {
      if (lookHold) { lookHold = 0; look = { x: 0, y: 0 }; T.look = t + rnd(2.2, 5); }
      else if (shown === "idle") { look = { x: rnd(-1, 1) * 0.9, y: rnd(-0.2, 0.7) }; lookHold = 1; T.look = t + rnd(0.7, 1.7); }
      else if (shown === "speaking") {
        if (rng() < 0.7) { look = { x: rnd(-0.8, 0.8), y: rnd(-0.2, 0.5) }; lookHold = 1; T.look = t + rnd(0.5, 1.1); } else T.look = t + rnd(0.9, 2.2);
      }
      else if (shown === "listening") { look = { x: rnd(-0.1, 0.1), y: rnd(0, 0.08) }; T.look = t + rnd(2, 4); }
      else if (shown === "thinking") { look = { x: -rnd(0.55, 0.9), y: rnd(-1, -0.65) }; T.look = t + rnd(1.2, 2.4); }
    }
    if ((shown === "idle" || shown === "listening") && t > T.tilt) { idleTilt = rnd(-2.5, 2.5); T.tilt = t + rnd(3, 7); }
  }

  function candidateUpdate(t) {
    const reaction = listener.update(t, candidateLevel, shown === "listening");
    if (!reaction) return;
    if (reaction.kind === "tilt") tiltPulse = { t: reaction.at, a: reaction.a };
    else nods.add(reaction.at, reaction.kind);
  }

  function analyse(dt, t, fed) {
    let target = 0;
    let chatter = 0;
    jawQuestion = 0;
    if (shown === "speaking" && fed) {
      if (cur.id !== fed.id) cur = { id: fed.id, ev: 0, pz: 0, ready: false };
      if (fed.features) {
        const f = fed.features;
        const pos = fed.pos + JAW.lookahead;
        if (!cur.ready) {
          // The analysis can finish after the chunk started: do not replay what is already behind us.
          cur.ready = true;
          while (cur.ev < f.events.length && f.events[cur.ev].t <= pos - 0.25) cur.ev += 1;
          while (cur.pz < f.pauses.length && f.pauses[cur.pz].t0 <= pos - 0.25) cur.pz += 1;
        }
        if (pos >= 0) {
          const b = beakTargetAt(f, pos, t);
          target = b.target;
          chatter = b.chatter;
          // Phrase boundaries: a small head turn toward the viewer, or a brief glance aside.
          while (cur.pz < f.pauses.length && f.pauses[cur.pz].t0 <= pos) {
            const z = f.pauses[cur.pz]; cur.pz += 1;
            phraseBoundary(t, z.t1 - z.t0);
          }
          jawQuestion = fed.endsWithQuestion && pos > f.dur - 0.5 && pos < f.dur ? 1 : 0;
          // Stressed syllable onsets -> upper-mandible flick and a small beat.
          while (cur.ev < f.events.length && f.events[cur.ev].t <= pos) {
            const s = f.events[cur.ev].s; cur.ev += 1;
            if (s > 0.7 && M()) { emphasis(t, s); S.lift.v += 22 * s; }
          }
        }
      } else {
        target = genericBeakTarget(t);
      }
    }
    mouth = jaw.step(dt, target, chatter);
  }

  function pose(t, dt) {
    candidateUpdate(t);
    const m = M();
    let tilt = 0; let hx = 0; let hy = 0; let turn = 0; let lid = 0; let lookBaseX = 0; let lookBaseY = 0;
    switch (shown) {
      case "idle": tilt = idleTilt; lid = 0.2; break;
      case "listening": tilt = idleTilt * 0.5 + 1; hx = 0.8; lid = 0.2; lookBaseY = 0.04; break;
      case "thinking": tilt = -6; hx = -3; turn = 1; lid = 0.28; lookBaseX = -0.8; lookBaseY = -0.8; break;
      case "speaking": tilt = 0; hy = 0; lid = 0.22; break;
      default: break;
    }
    const gx = lookHold || shown === "thinking" ? look.x : 0;
    const gy = lookHold || shown === "thinking" ? look.y : 0;
    const nodR = nods.rotation(t);
    let tp = 0;
    if (tiltPulse.t > 0) { const p = (t - tiltPulse.t) / 1.5; if (p >= 0 && p < 1) tp = Math.sin(p * Math.PI) * tiltPulse.a; }
    S.tilt.t = (tilt + tp + gx * 3) * m; S.hx.t = (hx + gx * 4.5) * m; S.hy.t = (hy + gy * 2.2) * m; S.turn.t = turn * m;
    S.lookX.t = lookBaseX + gx * 0.85; S.lookY.t = lookBaseY + gy * 0.85; S.lid.t = lid;
    // Follow-through chain.
    const spk = shown === "speaking";
    S.tilt.w = S.hx.w = S.hy.w = spk ? 5.2 : 6.5; S.nT.w = S.nX.w = S.nY.w = spk ? 3.4 : 4.5; S.bT.w = S.bX.w = spk ? 2.6 : 3.4;
    S.nT.t = HP.r * 0.8; S.nX.t = HP.x * 0.8; S.nY.t = HP.y * 0.8; // the neck follows the head's total motion, one frame behind
    S.bT.t = S.nT.x * 0.35; S.bX.t = S.nX.x * 0.4;
    S.tl.t = (-S.bT.x * 2 + noise(t, 5) * 1.8) * m;
    S.ql.t = jawQuestion; S.beat.t = t < beatUntil ? beatAmp : 0; S.glance.t = t < glUntil ? glAmp : 0;
    for (const k in S) S[k].step(dt);
    const lv = spk ? mouth : 0;
    PHR.t = lv; PHR.step(dt); PHR2.t = lv; PHR2.step(dt);

    // Breathing: slow, asymmetric (longer exhale); moves chest + bib, not the whole bird.
    const ph = (t % 4.6) / 4.6;
    const br = ph < 0.42 ? Math.sin((ph / 0.42) * Math.PI / 2) : Math.cos(((ph - 0.42) / 0.58) * Math.PI / 2);
    const brk = clamp(br, 0, 1);
    const na = (spk ? 1.0 : 1.5) * m;
    // Everything that moves the head is summed, then smoothly saturated, so noise, gaze, phrase turns and emphasis never stack into a big excursion.
    const rawR = S.tilt.x + noise(t, 2) * 1.0 * na - PHR.x * 0.5 * m + S.beat.x * 0.5 * emphSign * m + S.ql.x * -2.2 * m + S.glance.x * 0.7 * m + (PHR2.x - 0.25) * -0.9 * m;
    const rawX = S.hx.x + noise(t, 3) * 1.2 * na + S.glance.x * 1.4 * m;
    const rawY = S.hy.x + noise(t, 4) * 0.8 * na + PHR.x * 0.4 * m + PHR2.x * 0.25 * m - S.ql.x * 1.2 * m + S.beat.x * 1.0 * m - brk * 0.5 * m;
    let headRot = sat(rawR, LIM.r);
    const hX = sat(rawX, LIM.x);
    const hY = sat(rawY, LIM.y);
    HP.r = headRot; HP.x = hX; HP.y = hY;
    headRot = sat(headRot + nodR, LIM.fin);
    const p = {
      headRot, hX, hY,
      nT: S.nT.x + nodR * 0.15, nX: S.nX.x, nY: S.nY.x,
      bT: sat(S.bT.x, LIM.bt) + nodR * 0.05, bX: sat(S.bX.x, LIM.bx),
      sx: 1 + brk * 0.014 * m,
    };
    const tl = S.tl.x;
    const tf = transforms(p);
    attr(el.head, "transform", `translate(${f2(hX)} ${f2(hY)}) rotate(${f2(headRot)} 165 150)`);
    attr(el.body, "transform", `translate(${f2(p.bX)} 0) rotate(${f2(p.bT)} 150 236) translate(110 0) scale(${p.sx.toFixed(4)} 1) translate(-110 0)`);
    attr(el.tail, "transform", `rotate(${f2(tl + p.bT)} 125 205)`);
    attr(el.skin, "d", skinPath(tf));
    // Beak: the lower mandible hinges at the gape (max ~10 deg: slim wedge); the upper lifts a touch.
    attr(el.beak, "transform", `rotate(${f2(-S.turn.x * 3.5)} 219 90)`);
    const ang = `rotate(${f2(mouth * JAW.maxAngle)} 223 94)`;
    attr(el.lower, "transform", ang);
    attr(el.mouth, "transform", ang);
    attr(el.wedge, "d", mouthWedgePath(mouth));
    const up = mouth * 1.1 + S.lift.x;
    attr(el.upper, "transform", `rotate(${f2(-up)} 213 74) translate(0 ${f2(-up * 0.3)})`);
    attr(el.bib, "d", bibPath(tf, p));
    // Eye.
    const px = (S.lookX.x + sacc.x) * 3;
    const py = (S.lookY.x + sacc.y) * 2.2;
    attr(el.pup, "transform", `translate(${f2(px)} ${f2(py)})`);
    let b = 0;
    const bt = t - blinkStart;
    const [cd, od] = blinkDur;
    if (bt >= 0 && bt < cd + od) { const q = (bt - cd) / od; b = bt < cd ? (bt / cd) ** 2 : 1 - q * q * (3 - 2 * q); }
    const cl = clamp(Math.max(b, S.lid.x - S.lr.x), 0, 1);
    attr(el.lid, "transform", `translate(0 ${f2(-9 + cl * 17)})`);
    if (el.lash) attr(el.lash, "opacity", clamp((cl - 0.8) * 5, 0, 1).toFixed(2));
  }

  let last = null;
  return {
    /** The state requested by the room; what is shown may stay "speaking" while real audio plays. */
    setState(s, t) { requested = TOUCAN_STATES.includes(s) ? s : "idle"; if (last === null) applyState(requested, t); },
    get state() { return shown; },
    setCandidateLevel(v) { candidateLevel = Number.isFinite(v) ? v : 0; },
    setFeed(f) { feed = f; },
    get nodCount() { return nods.count; },
    /** One animation step at absolute time `t` (seconds). */
    frame(t) {
      const dt = last === null ? 1 / 60 : Math.min(0.05, Math.max(0, t - last));
      last = t;
      const fed = feed ? feed.sample(t) : null;
      if (fed) lastPlay = t;
      // Real audio playing always shows the speaking pose (the room may say otherwise during a manual replay).
      const want = fed ? "speaking" : requested !== "speaking" && shown === "speaking" && t - lastPlay < 0.4 ? "speaking" : requested;
      if (want !== shown) applyState(want, t);
      scheduleEvents(t);
      analyse(dt, t, fed);
      pose(t, dt);
    },
    /** Forget the clock after the tab was hidden, so the first frame back does not jump. */
    resume() { last = null; },
  };
}
