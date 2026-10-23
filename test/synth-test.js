// 합성 음원으로 BPM 엔진 정확도 점검: node test/synth-test.js
// 장르 패턴(하우스/힙합/디스코/테크노/DnB) × 듣는 환경(집/클럽/바) 소음을 섞어 측정한다.
const { BpmDetector } = require('../bpm-core.js');

const SR = 48000;
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const noise = () => rnd() * 2 - 1;

// 마이크 앞 소리를 흉내: 약간의 템포 흔들림이 있는 턴테이블 재생 + 환경 소음
function render(bpm, pattern, envKey, sec) {
  const n = Math.floor(SR * sec), out = new Float32Array(n);
  const beat = 60 / bpm, wow = 0.002; // 턴테이블 와우(±0.2%)
  let t = 0;
  const hits = [];
  for (let b = 0; t < sec; b++) {
    const bar = b % 4;
    if (pattern.kick(bar)) hits.push({ t, kind: 'kick' });
    if (pattern.snare && pattern.snare(bar)) hits.push({ t, kind: 'snare' });
    if (pattern.hat) hits.push({ t: t + beat / 2, kind: 'hat' });
    if (pattern.sixteenth) hits.push({ t: t + beat / 4, kind: 'hat2' }, { t: t + 3 * beat / 4, kind: 'hat2' });
    t += beat * (1 + wow * Math.sin(b / 7));
  }
  for (const h of hits) {
    const s0 = Math.floor(h.t * SR);
    const len = Math.floor(SR * (h.kind === 'kick' ? 0.25 : 0.12));
    let ph = 0;
    for (let i = 0; i < len && s0 + i < n; i++) {
      const tt = i / SR;
      let v = 0;
      if (h.kind === 'kick') { ph += 2 * Math.PI * (50 + 90 * Math.exp(-tt * 30)) / SR; v = Math.sin(ph) * Math.exp(-tt * 12) * 0.8; }
      else if (h.kind === 'snare') v = (noise() * 0.5 + Math.sin(2 * Math.PI * 190 * tt) * 0.3) * Math.exp(-tt * 25);
      else v = noise() * 0.2 * Math.exp(-tt * (h.kind === 'hat2' ? 80 : 50));
      out[s0 + i] += v;
    }
  }
  // 베이스라인(지속음)과 패드
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    out[i] += 0.25 * Math.sin(2 * Math.PI * 55 * tt) * (0.6 + 0.4 * Math.sin(2 * Math.PI * tt / (beat * 2)));
    out[i] += 0.08 * Math.sin(2 * Math.PI * 220 * tt + Math.sin(tt * 3));
  }
  // 환경 소음
  const { Biquad } = filters();
  const vhp = new Biquad('hp', 250, SR), vlp = new Biquad('lp', 3000, SR);
  let rv = 0, talkEnv = 0, crowd = 0;
  for (let i = 0; i < n; i++) {
    if (envKey === 'club') {
      // 방 저음 붐(약 40Hz 저역 잔향) + 관객 소음 + 마이크 과입력 클리핑
      rv = rv * 0.995 + out[i] * 0.005;
      crowd += 0.05 * (noise() - crowd);
      out[i] = Math.tanh((out[i] + rv * 4 + crowd * 0.4) * 1.8);
    } else if (envKey === 'bar') {
      // 대화: 250~3000Hz 대역 소음을 음절 속도(약 6Hz)로 무작위 변조, 가끔 잔 부딪히는 소리
      if (i % 8000 === 0) talkEnv = rnd() < 0.75 ? 0.6 + rnd() * 0.9 : 0.05;
      const syl = 0.5 + 0.5 * Math.sin(2 * Math.PI * 6 * i / SR + rnd() * 0.3);
      const talk = vlp.run(vhp.run(noise()));
      out[i] = out[i] * 0.4 + talk * talkEnv * syl * 2.2;
      if (rnd() < 0.00004) for (let k = 0; k < 2000 && i + k < n; k++) out[i + k] += Math.sin(k * 0.9) * Math.exp(-k / 300) * 0.4;
    } else {
      out[i] += noise() * 0.01;
    }
  }
  return out;
}

function filters() {
  function Biquad(type, f, sr) {
    const w = 2 * Math.PI * f / sr, cs = Math.cos(w), al = Math.sin(w) / 1.414, a0 = 1 + al;
    const b0 = (type === 'lp' ? (1 - cs) / 2 : (1 + cs) / 2) / a0, b1 = (type === 'lp' ? 1 - cs : -(1 + cs)) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    this.run = (x) => { const y = b0 * x + b1 * x1 + b0 * x2 - (-2 * cs / a0) * y1 - ((1 - al) / a0) * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
  }
  return { Biquad };
}

const PATTERNS = {
  house:  { kick: () => true, snare: (b) => b % 2 === 1, hat: true },
  techno: { kick: () => true, hat: true, sixteenth: true },
  disco:  { kick: () => true, snare: (b) => b % 2 === 1, hat: true, sixteenth: true },
  hiphop: { kick: (b) => b === 0 || b === 2, snare: (b) => b % 2 === 1, hat: true },
  dnb:    { kick: (b) => b === 0, snare: (b) => b === 2, hat: true, sixteenth: true }
};
const CASES = [
  ['house', 122], ['house', 124.5], ['techno', 132], ['techno', 138], ['disco', 116],
  ['disco', 109], ['hiphop', 92], ['hiphop', 86], ['dnb', 172], ['house', 118]
];

module.exports = { render, PATTERNS };
if (require.main === module) {
let pass = 0, octave = 0, fail = 0;
const t0 = Date.now();
for (const envKey of ['home', 'club', 'bar']) {
  console.log(`\n[환경: ${envKey}]`);
  for (const [p, bpm] of CASES) {
    const audio = render(bpm, PATTERNS[p], envKey, 14);
    const det = new BpmDetector(SR, envKey);
    let r = null, firstOk = null;
    for (let i = 0; i < audio.length; i += 2048) {
      det.push(audio.subarray(i, i + 2048));
      if ((i / 2048) % 6 === 0) { r = det.estimate() || r; if (r && r.ok && firstOk == null && Math.abs(r.bpm / bpm - 1) < 0.01) firstOk = det.seconds(); }
    }
    const err = r ? (r.bpm / bpm - 1) * 100 : NaN;
    const oct = r && [0.5, 2, 2 / 3, 1.5].some((m) => Math.abs(r.bpm / (bpm * m) - 1) < 0.01);
    const ok = Math.abs(err) < 1;
    if (ok) pass++; else if (oct) octave++; else fail++;
    console.log(`${p.padEnd(7)} 정답 ${bpm.toFixed(1).padStart(6)}  측정 ${r ? r.bpm.toFixed(1).padStart(6) : '   —  '}  오차 ${isNaN(err) ? '—' : err.toFixed(2) + '%'}  신뢰도 ${r ? Math.round(r.confidence * 100) + '%' : '—'}  ${ok ? 'OK' : oct ? '배수' : '실패'}${firstOk ? `  (${firstOk.toFixed(1)}초에 확정)` : ''}`);
  }
}
console.log(`\n정확 ${pass} / 배수 오류 ${octave} / 실패 ${fail}  (총 ${pass + octave + fail}, ${((Date.now() - t0) / 1000).toFixed(1)}초)`);
}
