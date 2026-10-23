// BPM 자동 감지 엔진. 브라우저(마이크)와 Node(테스트) 양쪽에서 같은 코드로 동작한다.
// 흐름: 원음 → 3개 대역(킥/스네어/하이햇) → 홉 단위 로그 에너지 증가분(온셋)
//       → 대역별 자기상관 → 가중 합산 → 배수 관계까지 고려한 템포 선택
(function (root) {
  'use strict';

  // 듣는 환경별 설정. w는 [킥, 스네어, 하이햇] 대역 비중, windowSec는 분석하는 최근 구간 길이
  var ENVIRONMENTS = {
    home: { label: '집', desc: '조용한 방', lowHz: 160, w: [1.0, 0.6, 0.45], windowSec: 6, minConf: 0.4 },
    club: { label: '클럽', desc: '큰 음량·저음 울림', lowHz: 130, w: [0.5, 1.0, 0.6], windowSec: 8, minConf: 0.35 },
    bar: { label: '바', desc: '대화 소리가 많은 곳', lowHz: 120, w: [1.0, 0.15, 0.1], windowSec: 10, minConf: 0.35 }
  };

  // DJ가 다루는 범위. 이 밖의 곡은 ½배·2배 후보로 보여준다
  var MIN_BPM = 70, MAX_BPM = 190;

  // RBJ 쿡북 2차 필터
  function Biquad(type, freq, q, sr) {
    var w = 2 * Math.PI * freq / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q), b0, b1, b2;
    if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
    else { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
    var a0 = 1 + al;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = -2 * cs / a0; this.a2 = (1 - al) / a0;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
  Biquad.prototype.run = function (x) {
    var y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  };

  function BpmDetector(sampleRate, envKey) {
    this.sr = sampleRate;
    this.hop = Math.max(128, Math.round(sampleRate / 187.5)); // 약 5.3ms 간격
    this.fr = sampleRate / this.hop;                           // 온셋 프레임레이트
    this.maxFrames = Math.ceil(this.fr * 12);
    this.setEnvironment(envKey || 'home');
  }

  BpmDetector.prototype.setEnvironment = function (key) {
    var e = ENVIRONMENTS[key] || ENVIRONMENTS.home, sr = this.sr;
    this.envKey = ENVIRONMENTS[key] ? key : 'home';
    this.env = e;
    this.f = [
      [new Biquad('lp', e.lowHz, 0.707, sr), new Biquad('lp', e.lowHz, 0.707, sr)],     // 킥
      [new Biquad('hp', 180, 0.707, sr), new Biquad('lp', 1200, 0.707, sr)],             // 스네어 몸통
      [new Biquad('hp', 5000, 0.707, sr), new Biquad('hp', 5000, 0.707, sr)]             // 하이햇
    ];
    // 대역별 에너지 평활 계수. 저음은 한 주기(수십 ms)보다 길게 봐야 파형 출렁임이 온셋으로 오인되지 않는다
    this.k = [20, 10, 5].map(function (ms) { return 1 - Math.exp(-1000 / (ms * sr)); });
    this.reset();
  };

  BpmDetector.prototype.reset = function () {
    var M = this.maxFrames;
    this.onset = [new Float32Array(M), new Float32Array(M), new Float32Array(M)];
    this.level = new Float32Array(M);
    this.n = 0;
    this.acc = 0; this.e = [0, 0, 0]; this.eA = 0;
    this.prev = [0, 0, 0];
    this.history = [];
  };

  // 오디오 샘플 블록 입력
  BpmDetector.prototype.push = function (buf) {
    var f = this.f, e = this.e, k = this.k;
    for (var i = 0; i < buf.length; i++) {
      var x = buf[i];
      var a = f[0][1].run(f[0][0].run(x)), b = f[1][1].run(f[1][0].run(x)), c = f[2][1].run(f[2][0].run(x));
      e[0] += k[0] * (a * a - e[0]); e[1] += k[1] * (b * b - e[1]); e[2] += k[2] * (c * c - e[2]);
      this.eA += x * x;
      if (++this.acc === this.hop) this._frame();
    }
  };

  BpmDetector.prototype._frame = function () {
    var hop = this.hop, idx = this.n % this.maxFrames;
    // 로그 에너지의 증가분만 본다: 음량과 무관하게 '때리는 순간'에 반응
    for (var k = 0; k < 3; k++) {
      var L = Math.log(1e-8 + this.e[k]);
      this.onset[k][idx] = Math.max(0, L - this.prev[k]);
      this.prev[k] = L;
    }
    this.level[idx] = Math.sqrt(this.eA / hop);
    this.eA = 0; this.acc = 0;
    this.n++;
  };

  BpmDetector.prototype._recent = function (arr, count) {
    count = Math.min(count, this.n, this.maxFrames);
    var out = new Float32Array(count), start = this.n - count;
    for (var i = 0; i < count; i++) out[i] = arr[(start + i) % this.maxFrames];
    return out;
  };

  BpmDetector.prototype.seconds = function () { return this.n / this.fr; };

  // 화면 파형용: 최근 sec초를 bins개 막대 최대값으로
  BpmDetector.prototype.levels = function (sec, bins) {
    var a = this._recent(this.level, Math.round(sec * this.fr)), out = new Float32Array(bins), per = a.length / bins;
    for (var b = 0; b < bins; b++) {
      var m = 0;
      for (var i = Math.floor(b * per); i < Math.floor((b + 1) * per); i++) if (a[i] > m) m = a[i];
      out[b] = m;
    }
    return out;
  };

  // 국소 평균을 빼고(지속음·잔향 제거) 평균 0으로 맞춘 뒤 정규화 자기상관
  function bandAC(x, fr, maxLag) {
    var N = x.length, i, l, win = Math.round(fr * 0.12), pre = new Float64Array(N + 1), y = new Float32Array(N);
    for (i = 0; i < N; i++) pre[i + 1] = pre[i] + x[i];
    for (i = 0; i < N; i++) {
      var lo = Math.max(0, i - win), hi = Math.min(N, i + win + 1);
      y[i] = Math.max(0, x[i] - (pre[hi] - pre[lo]) / (hi - lo));
    }
    var mean = 0; for (i = 0; i < N; i++) mean += y[i]; mean /= N;
    for (i = 0; i < N; i++) y[i] -= mean;
    var ac = new Float32Array(maxLag + 1);
    for (l = 0; l <= maxLag; l++) {
      var s = 0; for (i = 0; i + l < N; i++) s += y[i] * y[i + l];
      ac[l] = s / (N - l);
    }
    var a0 = ac[0] || 1;
    for (l = 0; l <= maxLag; l++) ac[l] /= a0;
    return ac;
  }

  function at(ac, L) { // 소수 지연값 선형 보간
    var i = Math.floor(L), f = L - i;
    if (i + 1 >= ac.length) return 0;
    return ac[i] * (1 - f) + ac[i + 1] * f;
  }

  // 템포 추정. 데이터가 부족하면 null
  BpmDetector.prototype.estimate = function () {
    var fr = this.fr, W = Math.round(this.env.windowSec * fr), w = this.env.w, i, l, k;
    if (this.n < fr * 2.5) return null;
    var lagMin = Math.floor(60 * fr / MAX_BPM), lagMax = Math.ceil(60 * fr / MIN_BPM);
    var N = Math.min(W, this.n, this.maxFrames), maxLag = Math.min(N - 1, lagMax * 2 + 2);

    // 대역별 자기상관을 비중대로 합친다
    var ac = new Float32Array(maxLag + 1), wsum = 0;
    for (k = 0; k < 3; k++) {
      var b = bandAC(this._recent(this.onset[k], W), fr, maxLag);
      for (l = 0; l <= maxLag; l++) ac[l] += w[k] * b[l];
      wsum += w[k];
    }
    for (l = 0; l <= maxLag; l++) ac[l] /= wsum;

    // 박 간격 L 후보 점수: L 자체 + 2L(마디 반복) + L/2(8분음표)
    // 2/3배·3/2배 오인식을 줄이기 위해 L/2 성분을 같이 본다
    var best = -Infinity, bestL = 0, sc = new Float32Array(lagMax + 2);
    for (l = lagMin; l <= lagMax; l++) {
      var bpmL = 60 * fr / l;
      var v = ac[l] + 0.5 * at(ac, 2 * l) + 0.35 * at(ac, l / 2);
      var prior = Math.exp(-0.5 * Math.pow(Math.log2(bpmL / 120) / 0.9, 2));
      v *= 0.7 + 0.3 * prior;
      sc[l] = v;
      if (v > best) { best = v; bestL = l; }
    }
    if (bestL <= lagMin || bestL >= lagMax) return null;

    // 포물선 보간으로 프레임 사이 값까지 정밀화
    var a = sc[bestL - 1], bb = sc[bestL], c = sc[bestL + 1], den = a - 2 * bb + c;
    var off = den < 0 ? 0.5 * (a - c) / den : 0;
    var lag = bestL + Math.max(-0.5, Math.min(0.5, off));
    var bpm = 60 * fr / lag;

    // 신뢰도: 주기성 세기 + 최근 결과들의 일치도
    var periodic = Math.max(0, Math.min(1, ac[bestL] * 2));
    this.history.push(bpm); if (this.history.length > 12) this.history.shift();
    var close = this.history.filter(function (h) { return Math.abs(h / bpm - 1) < 0.012; }).sort(function (p, q) { return p - q; });
    var stable = close.length / Math.max(6, this.history.length);
    var conf = Math.max(0, Math.min(1, 0.45 * periodic + 0.55 * stable));
    var smooth = close[Math.floor(close.length / 2)];

    // 마지막 박이 언제였는지(파형 위 박자 표시용)
    var x = this._recent(this.onset[0], W), xn = x.length, bestPh = 0, bestS = -Infinity;
    for (var ph = 0; ph < lag; ph++) {
      var s = 0; for (var t = xn - 1 - ph; t >= 0; t -= lag) s += x[Math.round(t)] || 0;
      if (s > bestS) { bestS = s; bestPh = ph; }
    }

    return {
      bpm: smooth,
      raw: bpm,
      confidence: conf,
      ok: conf >= this.env.minConf,
      beatPeriodSec: lag / fr,
      lastBeatAgoSec: bestPh / fr
    };
  };

  var api = { BpmDetector: BpmDetector, ENVIRONMENTS: ENVIRONMENTS, MIN_BPM: MIN_BPM, MAX_BPM: MAX_BPM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BpmCore = api;
})(typeof self !== 'undefined' ? self : this);
