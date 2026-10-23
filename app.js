(function () {
  'use strict';
  var BpmDetector = BpmCore.BpmDetector, ENVIRONMENTS = BpmCore.ENVIRONMENTS;
  var $ = function (id) { return document.getElementById(id); };

  var el = {
    pad: $('pad'), bpm: $('bpm'), ring: $('ring'), dots: $('dots').children, status: $('status'),
    wave: $('wave'), conf: $('conf'), confBar: $('conf-bar'), confText: $('conf-text'),
    mTap: $('m-tap'), mAuto: $('m-auto'), envs: $('envs'), half: $('half'), double: $('double'), main: $('main'),
    wake: $('wake'), video: $('keepawake')
  };

  function load(key, def) { try { return localStorage.getItem(key) || def; } catch (e) { return def; } }
  function save(key, v) { try { localStorage.setItem(key, v); } catch (e) { /* 저장 불가 환경은 무시 */ } }
  function f1(x) { return x == null || !isFinite(x) ? '—' : x.toFixed(1); }

  var state = {
    mode: 'tap',            // 'tap' | 'auto'
    env: load('env', 'home'),
    mult: 1,                // ÷2, ×2 버튼 누적 배율
    value: null             // 배율 적용 전 BPM
  };
  if (!ENVIRONMENTS[state.env]) state.env = 'home';

  // ───────── 화면 꺼짐 방지 ─────────
  // Wake Lock API를 우선 쓰고, 홈 화면 앱(구형 iOS 버그)이나 미지원 환경에서는 무음 영상 재생으로 보완
  var Wake = {
    lock: null, want: false, timer: 0,
    hold: function (ms) {
      this.want = true;
      clearTimeout(this.timer);
      if (ms) this.timer = setTimeout(function () { Wake.release(); }, ms);
      this.acquire();
    },
    acquire: function () {
      var self = this;
      if (!this.lock && 'wakeLock' in navigator) {
        navigator.wakeLock.request('screen').then(function (l) {
          self.lock = l;
          l.addEventListener('release', function () { self.lock = null; self.show(); });
          self.show();
        }).catch(function () { self.playVideo(); });
      }
      if (!('wakeLock' in navigator) || navigator.standalone) this.playVideo();
      this.show();
    },
    playVideo: function () {
      if (!this.want) return;
      var p = el.video.play();
      if (p && p.catch) p.catch(function () {});
    },
    release: function () {
      this.want = false;
      clearTimeout(this.timer);
      if (this.lock) { this.lock.release().catch(function () {}); this.lock = null; }
      el.video.pause();
      this.show();
    },
    show: function () { el.wake.hidden = !this.want; }
  };
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && Wake.want) Wake.acquire();
  });

  // ───────── 표시 ─────────
  function showValue(v, dim) {
    state.value = v;
    el.bpm.textContent = f1(v == null ? null : v * state.mult);
    el.bpm.classList.toggle('dim', !!dim);
  }
  function setMult(m) {
    if (state.value == null) return;
    var next = state.mult * m, shown = state.value * next;
    if (shown < 30 || shown > 400) return;
    state.mult = next;
    showValue(state.value, el.bpm.classList.contains('dim'));
  }

  // ───────── 탭 모드 ─────────
  var taps = [], lastTapAt = 0;
  function tapCalc() {
    var n = taps.length;
    if (n < 2) return { bpm: null, n: n, stab: '' };
    // 최소제곱 기울기: 개별 탭의 흔들림에 강하다
    var sx = 0, sy = 0, sxx = 0, sxy = 0, i;
    for (i = 0; i < n; i++) { sx += i; sy += taps[i]; sxx += i * i; sxy += i * taps[i]; }
    var slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    var mean = (taps[n - 1] - taps[0]) / (n - 1), v = 0;
    for (i = 1; i < n; i++) v += Math.pow(taps[i] - taps[i - 1] - mean, 2);
    var cv = Math.sqrt(v / (n - 1)) / mean;
    var stab = n < 4 ? '' : cv < 0.03 ? '안정적' : cv < 0.07 ? '조금 흔들림' : '많이 흔들림';
    return { bpm: 60000 / slope, n: n, stab: stab };
  }
  function onTap(t) {
    if (state.mode === 'auto') { setMode('tap'); }
    if (taps.length && t - taps[taps.length - 1] > 2000) { taps = []; state.mult = 1; }
    taps.push(t); if (taps.length > 24) taps.shift();
    lastTapAt = t;
    el.ring.classList.remove('go'); void el.ring.offsetWidth; el.ring.classList.add('go');
    var r = tapCalc();
    for (var i = 0; i < 4; i++) el.dots[i].className = i < Math.min(r.n, 4) ? 'on' : '';
    if (r.bpm) showValue(r.bpm, r.n < 4);
    el.status.innerHTML = r.n === 1 ? '계속 탭하세요'
      : r.n < 4 ? '<b>' + r.n + '번</b> 탭 · 4번 이상 탭하면 정확해져요'
      : '<b>' + r.n + '번</b> 탭 · ' + r.stab + (state.mult !== 1 ? ' · 배율 ' + (state.mult > 1 ? '×' + state.mult : '÷' + (1 / state.mult)) : '');
    Wake.hold(3 * 60 * 1000);
  }
  function resetTap() {
    taps = []; state.mult = 1; showValue(null);
    for (var i = 0; i < 4; i++) el.dots[i].className = '';
    el.status.textContent = '화면 아무 곳이나 박자에 맞춰 탭하세요';
  }
  // 2초 넘게 쉬면 다음 탭부터 새 측정이라는 걸 미리 알려준다
  setInterval(function () {
    if (state.mode === 'tap' && taps.length >= 2 && performance.now() - lastTapAt > 2000 && !el.status.dataset.idle) {
      el.status.dataset.idle = '1';
      el.status.innerHTML = '측정 완료 · 다시 탭하면 <b>새로 측정</b>해요';
    }
    if (performance.now() - lastTapAt <= 2000) delete el.status.dataset.idle;
  }, 300);

  el.pad.addEventListener('pointerdown', function (e) {
    if (e.button > 0) return;
    onTap(e.timeStamp || performance.now());
  });
  el.pad.addEventListener('keydown', function (e) {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onTap(performance.now()); }
  });

  // ───────── 오토 모드 ─────────
  var audio = { ctx: null, stream: null, node: null, det: null, timer: 0, raf: 0, listening: false, last: null };

  function startListening() {
    if (audio.listening) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      el.status.innerHTML = '이 브라우저에서는 마이크를 쓸 수 없어요.<br>Safari에서 https 주소로 열어주세요.';
      return;
    }
    var Ctx = window.AudioContext || window.webkitAudioContext;
    // 사용자 동작 안에서 오디오를 깨워야 iOS가 막지 않는다
    if (!audio.ctx) audio.ctx = new Ctx();
    audio.ctx.resume();
    el.status.textContent = '마이크 권한을 확인하고 있어요';
    setListeningUI(true);
    navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    }).then(function (stream) {
      if (state.mode !== 'auto') { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      audio.stream = stream;
      audio.det = new BpmDetector(audio.ctx.sampleRate, state.env);
      var src = audio.ctx.createMediaStreamSource(stream);
      var mute = audio.ctx.createGain(); mute.gain.value = 0;
      return connectCapture(src).then(function (node) {
        audio.node = node;
        node.connect(mute); mute.connect(audio.ctx.destination);
        audio.listening = true;
        audio.started = performance.now();
        audio.last = null;
        showValue(null);
        el.status.innerHTML = '<b>듣는 중…</b> 킥 드럼을 찾고 있어요';
        audio.timer = setInterval(analyze, 250);
        audio.raf = requestAnimationFrame(draw);
        Wake.hold(0);
      });
    }).catch(function (err) {
      setListeningUI(false);
      var denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      el.status.innerHTML = denied
        ? '마이크 권한이 꺼져 있어요.<br><b>설정 › Safari › 마이크</b>에서 허용해주세요.'
        : '마이크를 열지 못했어요. 다시 시도해주세요.';
    });
  }

  function connectCapture(src) {
    var ctx = audio.ctx;
    function onBlock(buf) { if (audio.det) audio.det.push(buf); }
    if (ctx.audioWorklet) {
      return ctx.audioWorklet.addModule('capture-worklet.js').then(function () {
        var node = new AudioWorkletNode(ctx, 'capture');
        node.port.onmessage = function (e) { onBlock(e.data); };
        src.connect(node);
        return node;
      });
    }
    // 구형 Safari 대비
    var sp = ctx.createScriptProcessor(1024, 1, 1);
    sp.onaudioprocess = function (e) { onBlock(new Float32Array(e.inputBuffer.getChannelData(0))); };
    src.connect(sp);
    return Promise.resolve(sp);
  }

  function stopListening(keepValue) {
    clearInterval(audio.timer); cancelAnimationFrame(audio.raf);
    if (audio.node) { try { audio.node.disconnect(); } catch (e) {} audio.node = null; }
    if (audio.stream) { audio.stream.getTracks().forEach(function (t) { t.stop(); }); audio.stream = null; }
    var was = audio.listening;
    audio.listening = false;
    setListeningUI(false);
    Wake.release();
    if (was && keepValue) {
      el.status.innerHTML = state.value != null ? '<b>멈춤</b> · 마지막 결과를 보여주고 있어요' : '<b>멈춤</b> · 박자를 찾지 못했어요';
    }
  }

  function analyze() {
    var r = audio.det && audio.det.estimate();
    var secs = audio.det ? audio.det.seconds() : 0;
    if (!r) {
      setConf(Math.min(0.15, secs / 20));
      return;
    }
    audio.last = r;
    setConf(r.confidence);
    if (r.ok) {
      showValue(r.bpm, false);
      el.status.innerHTML = r.confidence > 0.75 ? '<b>박자를 잡았어요</b> · 멈추면 값이 고정돼요' : '<b>듣는 중</b> · 거의 맞췄어요';
    } else {
      showValue(r.raw, true);
      el.status.innerHTML = '<b>듣는 중…</b> 소리가 더 또렷해야 해요';
    }
  }

  function setConf(c) {
    el.confBar.style.width = Math.round(c * 100) + '%';
    el.confText.textContent = '신뢰도 ' + Math.round(c * 100) + '%';
  }

  // 파형: 최근 4초 음량을 막대로, 추정한 박 위치에 표시
  var WAVE_SEC = 4;
  var peakNorm = 0.02;
  function draw() {
    audio.raf = requestAnimationFrame(draw);
    var cv = el.wave, dpr = window.devicePixelRatio || 1;
    var w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    var g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!audio.det) return;
    var bins = Math.max(24, Math.floor(w / 6)), bw = w / bins;
    var lv = audio.det.levels(WAVE_SEC, bins), mx = 0;
    for (var i = 0; i < bins; i++) if (lv[i] > mx) mx = lv[i];
    peakNorm = Math.max(mx, peakNorm * 0.995, 0.005); // 화면용 자동 음량 맞춤
    var mid = h / 2 - 8;
    for (i = 0; i < bins; i++) {
      var v = Math.min(1, lv[i] / peakNorm);
      var bh = Math.max(2, v * (h - 24));
      g.fillStyle = 'rgba(255,176,32,' + (0.22 + 0.6 * v) + ')';
      g.fillRect(i * bw + 1.5, mid - bh / 2, Math.max(1, bw - 3), bh);
    }
    // 박 표시: 추정 박 간격으로 오른쪽(현재)에서 거슬러 찍는다
    var r = audio.last;
    if (r && r.ok) {
      var sinceAnalyze = 0.125; // 분석 주기 절반만큼 보정
      g.fillStyle = '#FFB020';
      for (var t = r.lastBeatAgoSec + sinceAnalyze; t < WAVE_SEC; t += r.beatPeriodSec) {
        var x = w - (t / WAVE_SEC) * w;
        g.beginPath(); g.arc(x, h - 6, 3, 0, Math.PI * 2); g.fill();
      }
    }
    g.fillStyle = '#2C2C30';
    g.fillRect(0, h - 6.5, w, 1);
  }

  function setListeningUI(on) {
    el.main.textContent = on ? '멈추기' : '듣기 시작';
    el.main.classList.toggle('listening', on);
  }

  // ───────── 모드·환경 ─────────
  function setMode(m, noStart) {
    if (state.mode === m) return;
    state.mode = m;
    save('mode', m);
    el.mTap.setAttribute('aria-pressed', m === 'tap');
    el.mAuto.setAttribute('aria-pressed', m === 'auto');
    var auto = m === 'auto';
    el.envs.hidden = !auto; el.wave.hidden = !auto; el.conf.hidden = !auto;
    $('dots').hidden = auto;
    el.pad.setAttribute('aria-label', auto ? '탭하면 탭 모드로 바뀝니다' : '박자에 맞춰 탭');
    if (auto) {
      taps = []; state.mult = 1;
      setConf(0);
      showValue(null);
      if (noStart) {
        setListeningUI(false);
        el.status.innerHTML = '<b>듣기 시작</b>을 누르면 마이크로 BPM을 찾아요';
      } else {
        startListening();
      }
    } else {
      stopListening(false);
      el.main.textContent = '초기화';
      el.main.classList.remove('listening');
      el.status.textContent = '화면 아무 곳이나 박자에 맞춰 탭하세요';
      for (var i = 0; i < 4; i++) el.dots[i].className = '';
    }
  }

  function renderEnvs() {
    el.envs.innerHTML = '';
    Object.keys(ENVIRONMENTS).forEach(function (k) {
      var e = ENVIRONMENTS[k], b = document.createElement('button');
      b.setAttribute('aria-pressed', k === state.env);
      b.innerHTML = '<b></b><small></small>';
      b.firstChild.textContent = e.label; b.lastChild.textContent = e.desc;
      b.addEventListener('click', function () {
        state.env = k; save('env', k); renderEnvs();
        if (audio.det) { audio.det.setEnvironment(k); audio.last = null; setConf(0); el.status.innerHTML = '<b>' + e.label + '</b> 환경으로 다시 듣는 중…'; }
      });
      el.envs.appendChild(b);
    });
  }

  el.mTap.addEventListener('click', function () { setMode('tap'); });
  el.mAuto.addEventListener('click', function () { setMode('auto'); });
  el.half.addEventListener('click', function () { setMult(0.5); });
  el.double.addEventListener('click', function () { setMult(2); });
  el.main.addEventListener('click', function () {
    if (state.mode === 'tap') { resetTap(); return; }
    if (audio.listening) stopListening(true); else startListening();
  });

  renderEnvs();
  if (load('mode', 'tap') === 'auto') {
    // 오토 모드는 마이크를 켜야 하므로 첫 화면에서는 버튼만 준비해 둔다
    setMode('auto', true);
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
