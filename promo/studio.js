/* The studio page: preview player, export settings, and the render button.
   The film itself lives in film.js, the encoders and muxers in export.js. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const Film = window.AwaleFilm;
  const Exp = window.AwaleExport;
  const D = Film.DURATION;

  // Per-viewer conveniences only; the page works the same without them.
  const saved = {
    get(k, d) { try { const v = localStorage.getItem('awale-promo:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('awale-promo:' + k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  const state = {
    t: 0, playing: false, loop: true, sound: saved.get('sound', true),
    aspect: saved.get('aspect', '16:9'), lang: saved.get('lang', 'en'), url: saved.get('url', 'awale-web.vercel.app'),
    container: saved.get('container', 'mp4'), res: saved.get('res', 1080), fps: saved.get('fps', 30),
    quality: saved.get('quality', 0.14), withSound: saved.get('withSound', true), exporting: false,
  };
  const q = new URLSearchParams(location.search);
  if (q.get('aspect')) state.aspect = q.get('aspect').replace('x', ':');
  if (q.get('lang')) state.lang = q.get('lang');
  if (q.get('url') !== null) state.url = q.get('url');
  if (q.get('t')) state.t = Math.min(D, Math.max(0, parseFloat(q.get('t')) || 0));

  const RATIOS = { '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1], '4:5': [4, 5] };
  if (!RATIOS[state.aspect]) state.aspect = '16:9';
  const even = n => Math.round(n / 2) * 2;
  function dims(aspect, short) {
    const [a, b] = RATIOS[aspect];
    if (a === b) return [short, short];
    return a > b ? [even((short * a) / b), short] : [short, even((short * b) / a)];
  }
  const bitrate = () => {
    const [w, h] = dims(state.aspect, state.res);
    return Math.round(Math.min(80e6, Math.max(1.5e6, w * h * state.fps * state.quality)));
  };
  const fmtTime = t => {
    const m = Math.floor(t / 60), s = t - m * 60;
    return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
  };

  /* ------------------------------------------------------------- fonts */
  async function loadFonts() {
    const list = window.AWALE_PROMO_FONTS || [];
    await Promise.all(list.map(async ([family, weight, style, src]) => {
      try {
        const f = new FontFace(family, `url(${src})`, { weight: String(weight), style });
        await f.load();
        document.fonts.add(f);
      } catch { /* the fallback stack takes over */ }
    }));
  }

  /* ----------------------------------------------------------- preview */
  const stage = $('stage'), view = $('view');
  const vctx = view.getContext('2d', { alpha: false });
  let film = null;
  let ready = false;

  function fitStage() {
    const [a, b] = RATIOS[state.aspect];
    stage.style.setProperty('--stage-ar', `${a} / ${b}`);
    const bw = stage.clientWidth - 2, bh = stage.clientHeight - 2;
    let w = bw, h = (bw * b) / a;
    if (h > bh) { h = bh; w = (bh * a) / b; }
    w = Math.max(1, Math.floor(w)); h = Math.max(1, Math.floor(h));
    view.style.width = w + 'px';
    view.style.height = h + 'px';
    // enough pixels to look sharp, few enough to keep playback smooth
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const k = Math.min(dpr, Math.sqrt(2.2e6 / (w * h)));
    const pw = Math.round(w * k), ph = Math.round(h * k);
    if (view.width !== pw || view.height !== ph) { view.width = pw; view.height = ph; }
    draw();
  }

  function draw() {
    if (!ready || state.exporting) return;
    film.render(vctx, state.t);
    updateTransport();
  }

  /* ------------------------------------------------------------ sound */
  const audio = { ctx: null, buffer: null, building: null, src: null, startedAt: 0, offset: 0 };
  function buildSound() {
    if (!audio.building) {
      audio.building = Film.buildSoundtrack(film.plan).then(b => { audio.buffer = b; return b; }, e => { console.warn('soundtrack', e); audio.building = null; return null; });
    }
    return audio.building;
  }
  function stopAudio() {
    if (!audio.src) return;
    try { audio.src.stop(); } catch { /* already stopped */ }
    audio.src.disconnect();
    audio.src = null;
  }
  function startAudio(t) {
    stopAudio();
    if (!state.sound || !audio.buffer || !audio.ctx || !state.playing) return;
    const s = audio.ctx.createBufferSource();
    s.buffer = audio.buffer;
    s.connect(audio.ctx.destination);
    const when = audio.ctx.currentTime + 0.04;
    s.start(when, Math.min(t, D - 0.01));
    audio.src = s; audio.startedAt = when; audio.offset = t;
  }

  /* ---------------------------------------------------------- playback */
  let raf = 0, lastWall = 0;
  function tick(now) {
    raf = 0;
    if (!state.playing) return;
    let t;
    if (audio.src) t = Math.max(audio.offset, audio.ctx.currentTime - audio.startedAt + audio.offset);
    else t = state.t + Math.min(0.1, (now - lastWall) / 1000);
    lastWall = now;
    if (t >= D) {
      if (state.loop) { t = 0; if (audio.src) startAudio(0); }
      else { state.t = D; pause(); draw(); return; }
    }
    state.t = t;
    draw();
    raf = requestAnimationFrame(tick);
  }
  function play() {
    if (state.playing || state.exporting) return;
    if (state.t >= D - 0.01) state.t = 0;
    state.playing = true;
    lastWall = performance.now();
    if (state.sound) {
      try {
        if (!audio.ctx) audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
        audio.ctx.resume();
      } catch { /* no audio output */ }
      if (audio.buffer) startAudio(state.t);
      else buildSound().then(() => { if (state.playing) startAudio(state.t); });
    }
    setPlayIcon();
    raf = requestAnimationFrame(tick);
  }
  function pause() {
    state.playing = false;
    stopAudio();
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    setPlayIcon();
  }
  function seek(t) {
    state.t = Math.min(D, Math.max(0, t));
    if (state.playing && audio.src) startAudio(state.t);
    lastWall = performance.now();
    draw();
  }
  function setPlayIcon() {
    $('icon-play').hidden = state.playing;
    $('icon-pause').hidden = !state.playing;
    $('play').setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
  }

  /* ---------------------------------------------------------- transport */
  const chapters = $('chapters'), track = $('track'), scrub = $('scrub');
  Film.CHAPTERS.forEach(c => {
    const tick = document.createElement('i');
    tick.className = 'tick';
    tick.style.left = `${(c.at / D) * 100}%`;
    track.appendChild(tick);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chapter';
    b.textContent = c.label;
    b.style.left = `${(c.at / D) * 100}%`;
    b.addEventListener('click', e => { e.stopPropagation(); seek(c.at); });
    b.addEventListener('pointerdown', e => e.stopPropagation());
    chapters.appendChild(b);
  });
  // Labels that would run into their neighbour are hidden; the tick stays.
  function layoutChapters() {
    let right = -Infinity;
    chapters.querySelectorAll('.chapter').forEach(b => {
      b.style.visibility = '';
      const r = b.getBoundingClientRect();
      if (r.width && r.left < right + 8) b.style.visibility = 'hidden';
      else right = r.right;
    });
  }
  new ResizeObserver(layoutChapters).observe(scrub);
  let lastLabel = '';
  function updateTransport() {
    const p = state.t / D;
    $('fill').style.width = `${p * 100}%`;
    $('head').style.left = `${p * 100}%`;
    const label = `<b>${fmtTime(state.t)}</b> / ${fmtTime(D)}`;
    if (label !== lastLabel) { $('time').innerHTML = label; lastLabel = label; }
    $('scrub').setAttribute('aria-valuenow', state.t.toFixed(2));
    let on = 0;
    Film.CHAPTERS.forEach((c, i) => { if (state.t >= c.at) on = i; });
    chapters.querySelectorAll('.chapter').forEach((b, i) => b.classList.toggle('on', i === on));
  }
  let dragging = false, wasPlaying = false;
  const tAt = e => { const r = track.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * D; };
  scrub.addEventListener('pointerdown', e => {
    if (state.exporting) return;
    dragging = true; wasPlaying = state.playing; pause();
    scrub.setPointerCapture(e.pointerId);
    seek(tAt(e));
  });
  scrub.addEventListener('pointermove', e => { if (dragging) seek(tAt(e)); });
  const endDrag = () => { if (!dragging) return; dragging = false; if (wasPlaying) play(); };
  scrub.addEventListener('pointerup', endDrag);
  scrub.addEventListener('pointercancel', endDrag);
  scrub.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); step(e.key === 'ArrowRight' ? 1 : -1, e.shiftKey); }
  });
  function step(dir, big) { pause(); seek(state.t + dir * (big ? 1 : 1 / state.fps)); }

  $('play').addEventListener('click', () => (state.playing ? pause() : play()));
  $('loop').addEventListener('click', () => { state.loop = !state.loop; $('loop').setAttribute('aria-pressed', String(state.loop)); });
  function setSound(on) {
    state.sound = on;
    saved.set('sound', on);
    $('sound').setAttribute('aria-pressed', String(on));
    $('wave').style.display = on ? '' : 'none';
    if (!on) stopAudio();
    else if (state.playing) {
      try { if (!audio.ctx) audio.ctx = new (window.AudioContext || window.webkitAudioContext)(); audio.ctx.resume(); } catch { /* none */ }
      buildSound().then(() => { if (state.playing && state.sound) startAudio(state.t); });
    }
  }
  $('sound').addEventListener('click', () => setSound(!state.sound));
  $('full').addEventListener('click', () => {
    const el = stage;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else if (req) Promise.resolve(req.call(el)).catch(() => { /* not allowed here */ });
  });
  document.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); state.playing ? pause() : play(); }
    else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && e.target !== scrub) { e.preventDefault(); step(e.key === 'ArrowRight' ? 1 : -1, e.shiftKey); }
    else if (e.key === 'Home') { e.preventDefault(); seek(0); }
    else if (e.key === 'End') { e.preventDefault(); seek(D); }
    else if (e.key === 'f') $('full').click();
    else if (e.key === 'm') setSound(!state.sound);
  });

  /* ---------------------------------------------------------- settings */
  function bindRadio(name, key, parse) {
    document.querySelectorAll(`input[name="${name}"]`).forEach(inp => {
      inp.checked = String(state[key]) === inp.value;
      inp.addEventListener('change', () => {
        if (!inp.checked) return;
        state[key] = parse ? parse(inp.value) : inp.value;
        saved.set(key, state[key]);
        onSettings(key);
      });
    });
  }
  bindRadio('aspect', 'aspect');
  bindRadio('lang', 'lang');
  bindRadio('container', 'container');
  bindRadio('res', 'res', Number);
  bindRadio('fps', 'fps', Number);
  bindRadio('quality', 'quality', Number);
  const urlInput = $('url');
  urlInput.value = state.url;
  urlInput.addEventListener('input', () => { state.url = urlInput.value.trim(); saved.set('url', state.url); onSettings('url'); });
  const withSound = $('with-sound');
  withSound.checked = state.withSound;
  withSound.addEventListener('change', () => { state.withSound = withSound.checked; saved.set('withSound', state.withSound); onSettings('withSound'); });

  function onSettings(key) {
    if (film && (key === 'lang' || key === 'url')) { film.set({ lang: state.lang, url: state.url }); draw(); }
    if (key === 'aspect') fitStage();
    updateSpec();
  }

  let probeId = 0;
  async function updateSpec() {
    const [w, h] = dims(state.aspect, state.res);
    const br = bitrate();
    $('dims').textContent = `${w} × ${h}`;
    $('rate').textContent = `≈ ${(br / 1e6).toFixed(br < 10e6 ? 1 : 0)} Mb/s`;
    $('spec-frames').textContent = `${Math.round(D * state.fps)} at ${state.fps} fps`;
    $('spec-size').textContent = `≈ ${Math.max(1, Math.round(((br + (state.withSound ? 192000 : 0)) * D) / 8 / 1e6))} MB`;
    const id = ++probeId;
    const vEl = $('spec-video'), aEl = $('spec-audio');
    if (!Exp.supported()) {
      vEl.textContent = 'Real-time capture';
      vEl.className = '';
      aEl.textContent = state.withSound ? 'recorded with it' : 'none';
      $('render').disabled = !window.MediaRecorder;
      return;
    }
    const r = await Exp.probe(state.container, w, h, state.fps, br);
    if (id !== probeId) return;
    if (r.video) {
      vEl.textContent = r.video.label;
      vEl.className = '';
      $('render').disabled = state.exporting;
    } else {
      vEl.textContent = 'Not available here';
      vEl.className = 'warn';
      $('render').disabled = true;
    }
    aEl.textContent = !state.withSound ? 'none' : r.audio ? r.audio.label : 'not available here';
    aEl.className = state.withSound && !r.audio ? 'warn' : '';
  }

  /* ------------------------------------------------------------ export */
  let abort = null, lastUrl = null;
  const controls = () => document.querySelectorAll('aside input, #render, #still');
  function busy(on) {
    state.exporting = on;
    controls().forEach(el => { el.disabled = on; });
    $('progress').hidden = !on;
    $('badge').hidden = !on;
    $('actions').hidden = on;
    if (!on) updateSpec();
  }
  function showError(msg) { const e = $('error'); e.textContent = msg; e.hidden = !msg; }
  function fileName(ext) {
    const [w, h] = dims(state.aspect, state.res);
    return `awale-promo_${state.aspect.replace(':', 'x')}_${w}x${h}_${state.fps}fps_${state.lang}.${ext}`;
  }

  async function renderVideo() {
    if (state.exporting) return;
    pause();
    showError('');
    $('result').hidden = true;
    busy(true);
    const [w, h] = dims(state.aspect, state.res);
    const fps = state.fps;
    const exportFilm = Film.create({ lang: state.lang, url: state.url });
    abort = new AbortController();
    const bar = $('bar'), left = $('prog-left'), right = $('prog-right');
    bar.style.width = '0%';
    left.textContent = state.withSound ? 'Preparing the soundtrack…' : 'Starting…';
    right.textContent = '';
    let lastUi = 0;
    try {
      const soundtrack = state.withSound ? await Film.buildSoundtrack(exportFilm.plan) : null;
      const onProgress = (f, canvas, info) => {
        const now = performance.now();
        if (now - lastUi < 60 && f < 1) return;
        lastUi = now;
        vctx.drawImage(canvas, 0, 0, view.width, view.height);
        bar.style.width = `${(f * 100).toFixed(1)}%`;
        if (info.total) {
          left.textContent = `Frame ${info.frame} of ${info.total}`;
          const rate = info.frame / Math.max(0.001, info.elapsed);
          const rest = (info.total - info.frame) / Math.max(0.001, rate);
          right.textContent = f < 1 ? `${rate.toFixed(1)} fps · ${Math.ceil(rest)} s left` : 'Writing the file…';
        } else {
          left.textContent = 'Recording in real time';
          right.textContent = `${Math.round(f * 100)}%`;
        }
      };
      const opts = { film: exportFilm, width: w, height: h, fps, bitrate: bitrate(), container: state.container, duration: D, soundtrack, onProgress, signal: abort.signal };
      const res = Exp.supported() ? await Exp.exportVideo(opts) : await Exp.recordRealtime(opts);
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = URL.createObjectURL(res.blob);
      const ext = res.blob.type.includes('mp4') ? 'mp4' : 'webm';
      const out = $('out');
      out.src = lastUrl;
      const dl = $('download');
      dl.href = lastUrl;
      dl.download = fileName(ext);
      dl.textContent = `Download .${ext}`;
      const secs = res.seconds ? ` · rendered in ${Math.round(res.seconds)} s` : '';
      $('out-info').textContent = `${dl.download} — ${(res.blob.size / 1e6).toFixed(1)} MB · ${res.video.label}${res.audio ? ' + ' + res.audio.label : ''}${secs}`;
      $('result').hidden = false;
    } catch (e) {
      if (!e || e.name !== 'AbortError') showError((e && e.message) || String(e));
    } finally {
      abort = null;
      busy(false);
      draw();
    }
  }
  $('render').addEventListener('click', renderVideo);
  $('cancel').addEventListener('click', () => { if (abort) abort.abort(); });

  $('still').addEventListener('click', () => {
    const [w, h] = dims(state.aspect, state.res);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const f = Film.create({ lang: state.lang, url: state.url });
    f.render(c.getContext('2d', { alpha: false }), state.t);
    c.toBlob(b => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `awale-promo_${state.aspect.replace(':', 'x')}_${w}x${h}_${state.t.toFixed(2)}s_${state.lang}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, 'image/png');
  });

  /* -------------------------------------------------------------- boot */
  let embedded = false;
  try { embedded = window.self !== window.top; } catch { embedded = true; }
  $('embed-note').hidden = !embedded;
  $('loop').setAttribute('aria-pressed', 'true');
  setSound(state.sound);
  new ResizeObserver(fitStage).observe(stage);

  loadFonts().then(() => {
    film = Film.create({ lang: state.lang, url: state.url });
    ready = true;
    layoutChapters();
    $('loading').hidden = true;
    fitStage();
    updateSpec();
    if (q.has('play')) play();
  });

  // for scripted renders and tests
  window.promo = {
    get film() { return film; },
    state, seek, play, pause, dims, renderVideo,
    exportNow: opts => Exp.exportVideo(Object.assign({ film: Film.create({ lang: state.lang, url: state.url }), duration: D }, opts)),
  };
})();
