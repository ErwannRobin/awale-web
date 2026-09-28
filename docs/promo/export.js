/* Video export for the promo film: WebCodecs encoders feeding two small
   muxers written for this page — MP4 (ISO BMFF) and WebM (Matroska).

   Frames are rendered one at a time at exactly the requested size and frame
   rate, so an export never drops a frame and is not tied to how fast the
   machine can play the film. No library, no network: the page works from
   disk. Where WebCodecs is missing, MediaRecorder records the film in real
   time instead. */
(function (global) {
  'use strict';

  /* =============================================================== bytes */
  class Bytes {
    constructor() { this.parts = []; this.cur = new Uint8Array(256); this.len = 0; this.size = 0; }
    ensure(n) {
      if (this.len + n <= this.cur.length) return;
      const next = new Uint8Array(Math.max(this.cur.length * 2, this.len + n));
      next.set(this.cur.subarray(0, this.len));
      this.cur = next;
    }
    u8(v) { this.ensure(1); this.cur[this.len++] = v & 255; this.size++; return this; }
    u16(v) { return this.u8(v >>> 8).u8(v); }
    u24(v) { return this.u8(v >>> 16).u8(v >>> 8).u8(v); }
    u32(v) { return this.u8(v >>> 24).u8(v >>> 16).u8(v >>> 8).u8(v); }
    i16(v) { return this.u16(v & 0xffff); }
    u64(v) { const hi = Math.floor(v / 4294967296); return this.u32(hi).u32(v >>> 0); }
    f64(v) { const b = new DataView(new ArrayBuffer(8)); b.setFloat64(0, v); return this.raw(new Uint8Array(b.buffer)); }
    str(s) { for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i)); return this; }
    raw(a) { this.ensure(a.length); this.cur.set(a, this.len); this.len += a.length; this.size += a.length; return this; }
    zeros(n) { for (let i = 0; i < n; i++) this.u8(0); return this; }
    bytes() { return this.cur.slice(0, this.len); }
  }

  const toU8 = d => (d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)));

  // A minimal AV1CodecConfigurationRecord from the codec string, for encoders
  // that do not hand one over; the sequence header travels in-band anyway.
  function av1C(codec) {
    const [, prof, lvlTier, depth] = codec.split('.');
    const level = parseInt(lvlTier, 10), tier = lvlTier.endsWith('H') ? 1 : 0, high = Number(depth) > 8 ? 1 : 0;
    return new Uint8Array([0x81, (Number(prof) << 5) | level, (tier << 7) | (high << 6) | (1 << 3) | (1 << 2), 0]);
  }

  /* ================================================================= MP4 */
  // box(type, ...children): children are Uint8Arrays (already-serialised
  // boxes or payload bytes).
  function box(type, ...kids) {
    let n = 8;
    for (const k of kids) n += k.length;
    const out = new Uint8Array(n);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, n);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    let o = 8;
    for (const k of kids) { out.set(k, o); o += k.length; }
    return out;
  }
  const full = (version, flags) => new Bytes().u8(version).u24(flags).bytes();
  const bytes = fn => { const b = new Bytes(); fn(b); return b.bytes(); };
  const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];

  const COLOR = {
    primaries: { bt709: 1, bt470bg: 5, smpte170m: 6, bt2020: 9, smpte432: 12 },
    transfer: { bt709: 1, smpte170m: 6, 'iec61966-2-1': 13, linear: 8, pq: 16, hlg: 18 },
    matrix: { rgb: 0, bt709: 1, bt470bg: 5, smpte170m: 6, 'bt2020-ncl': 9 },
  };

  class Mp4Muxer {
    /** video: { kind: 'avc'|'vp9'|'av1', codec, width, height, fps }; audio: { kind: 'aac'|'opus', sampleRate, channels } | null */
    constructor(video, audio) {
      this.v = { ...video, samples: [], timescale: 90000, desc: null, color: null };
      this.a = audio ? { ...audio, samples: [], timescale: audio.sampleRate, desc: null } : null;
    }
    addVideo(chunk, meta) {
      if (meta && meta.decoderConfig) {
        if (meta.decoderConfig.description && !this.v.desc) this.v.desc = toU8(meta.decoderConfig.description);
        if (meta.decoderConfig.colorSpace && !this.v.color) this.v.color = meta.decoderConfig.colorSpace;
      }
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      this.v.samples.push({ data, ts: chunk.timestamp, key: chunk.type === 'key' });
    }
    addAudio(chunk, meta) {
      if (meta && meta.decoderConfig && meta.decoderConfig.description && !this.a.desc) this.a.desc = toU8(meta.decoderConfig.description);
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      this.a.samples.push({ data, ts: chunk.timestamp, dur: chunk.duration });
    }

    videoEntry() {
      const v = this.v;
      const fourcc = v.kind === 'avc' ? 'avc1' : v.kind === 'vp9' ? 'vp09' : 'av01';
      let config;
      if (v.kind === 'avc') config = box('avcC', v.desc);
      else if (v.kind === 'av1') config = box('av1C', v.desc || av1C(v.codec));
      else {
        const [, prof, lvl, depth] = (v.codec.split('.').map(Number));
        const c = v.color || {};
        config = box('vpcC', full(1, 0), bytes(b => {
          b.u8(prof || 0).u8(lvl || 10).u8(((depth || 8) << 4) | (1 << 1) | (c.fullRange ? 1 : 0));
          b.u8(COLOR.primaries[c.primaries] || 1).u8(COLOR.transfer[c.transfer] || 1).u8(COLOR.matrix[c.matrix] || 1).u16(0);
        }));
      }
      const kids = [config];
      if (v.color && v.kind !== 'vp9') {
        const c = v.color;
        kids.push(box('colr', bytes(b => {
          b.str('nclx').u16(COLOR.primaries[c.primaries] || 1).u16(COLOR.transfer[c.transfer] || 1).u16(COLOR.matrix[c.matrix] || 1).u8(c.fullRange ? 0x80 : 0);
        })));
      }
      kids.push(box('pasp', bytes(b => b.u32(1).u32(1))));
      return box(fourcc, bytes(b => {
        b.zeros(6).u16(1).u16(0).u16(0).zeros(12).u16(v.width).u16(v.height)
          .u32(0x00480000).u32(0x00480000).u32(0).u16(1);
        const name = 'Awale promo';
        b.u8(name.length).str(name).zeros(31 - name.length);
        b.u16(0x18).i16(-1);
      }), ...kids);
    }

    audioEntry() {
      const a = this.a;
      const head = bytes(b => { b.zeros(6).u16(1).zeros(8).u16(a.channels).u16(16).u16(0).u16(0).u32(a.sampleRate * 65536 >>> 0); });
      if (a.kind === 'opus') {
        const preSkip = a.desc && a.desc.length >= 12 ? a.desc[10] | (a.desc[11] << 8) : 312;
        const dops = box('dOps', bytes(b => b.u8(0).u8(a.channels).u16(preSkip).u32(a.sampleRate).i16(0).u8(0)));
        return box('Opus', head, dops);
      }
      // AAC: AudioSpecificConfig from the encoder, or LC at this rate/layout
      let asc = a.desc;
      if (!asc || !asc.length) {
        const idx = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000].indexOf(a.sampleRate);
        asc = new Uint8Array([(2 << 3) | (idx >> 1), ((idx & 1) << 7) | (a.channels << 3)]);
      }
      const desc = (tag, payload) => { const b = new Bytes(); b.u8(tag); b.u8(0x80).u8(0x80).u8(0x80).u8(payload.length); b.raw(payload); return b.bytes(); };
      const bitrate = a.bitrate || 192000;
      const dsi = desc(0x05, asc);
      const dcd = desc(0x04, bytes(b => { b.u8(0x40).u8(0x15).u24(0).u32(bitrate).u32(bitrate).raw(dsi); }));
      const sl = desc(0x06, new Uint8Array([0x02]));
      const esd = desc(0x03, bytes(b => { b.u16(2).u8(0).raw(dcd).raw(sl); }));
      return box('mp4a', head, box('esds', full(0, 0), esd));
    }

    finalize() {
      const tracks = [];
      const v = this.v;
      const fd = v.timescale / v.fps;
      // Presentation order comes from the timestamps; decode order is the
      // order the encoder produced. B-frames, if any, get a ctts and an edit.
      const pts = v.samples.map(s => Math.round((s.ts * v.fps) / 1e6));
      let delay = 0;
      pts.forEach((p, i) => { delay = Math.max(delay, i - p); });
      const ctts = pts.map((p, i) => (p - (i - delay)) * fd);
      const needCtts = ctts.some(c => c !== ctts[0]) || delay > 0;
      tracks.push({
        id: 1, handler: 'vide', timescale: v.timescale, entry: this.videoEntry(),
        samples: v.samples.map((s, i) => ({ data: s.data, dur: fd, key: s.key, cts: ctts[i] })),
        duration: v.samples.length * fd, needCtts, edit: needCtts ? delay * fd : 0,
        width: v.width, height: v.height,
      });
      if (this.a && this.a.samples.length) {
        const a = this.a;
        const def = a.kind === 'aac' ? 1024 : 960;
        const smp = a.samples.map(s => ({ data: s.data, dur: s.dur ? Math.round((s.dur * a.sampleRate) / 1e6) : def, key: true, cts: 0 }));
        tracks.push({
          id: 2, handler: 'soun', timescale: a.timescale, entry: this.audioEntry(), samples: smp,
          duration: smp.reduce((n, s) => n + s.dur, 0), needCtts: false, edit: 0,
        });
      }
      // Interleave in half-second chunks so players read audio and video
      // from nearby places in the file.
      const chunks = [];
      for (const tr of tracks) {
        tr.chunks = [];
        let t = 0, cur = null;
        tr.samples.forEach((s, i) => {
          const sec = t / tr.timescale;
          if (!cur || sec - cur.start >= 0.5) { cur = { tr, start: sec, first: i, samples: [] }; tr.chunks.push(cur); chunks.push(cur); }
          cur.samples.push(s);
          t += s.dur;
        });
      }
      chunks.sort((a, b) => a.start - b.start || a.tr.id - b.tr.id);
      let mdatSize = 0;
      for (const c of chunks) for (const s of c.samples) mdatSize += s.data.length;
      const large = mdatSize + 16 > 0xffffffff;
      const ftyp = box('ftyp', bytes(b => {
        b.str('isom').u32(0x200).str('isom').str('iso2').str('mp41');
        if (v.kind === 'avc') b.str('avc1');
        if (v.kind === 'av1') b.str('av01');
      }));
      const movieDur = Math.max(...tracks.map(tr => Math.round((tr.duration * 1000) / tr.timescale)));
      const build = offsets => {
        const traks = tracks.map(tr => {
          const tkhd = box('tkhd', full(0, 3), bytes(b => {
            b.u32(0).u32(0).u32(tr.id).u32(0).u32(Math.round((tr.duration * 1000) / tr.timescale)).zeros(8)
              .u16(0).u16(0).u16(tr.handler === 'soun' ? 0x0100 : 0).u16(0);
            MATRIX.forEach(m => b.u32(m));
            b.u32((tr.width || 0) * 65536).u32((tr.height || 0) * 65536);
          }));
          const edts = tr.edit ? box('edts', box('elst', full(0, 0), bytes(b => {
            b.u32(1).u32(Math.round(((tr.duration) * 1000) / tr.timescale)).u32(tr.edit).u16(1).u16(0);
          }))) : null;
          const mdhd = box('mdhd', full(0, 0), bytes(b => b.u32(0).u32(0).u32(tr.timescale).u32(tr.duration).u16(0x55c4).u16(0)));
          const hdlr = box('hdlr', full(0, 0), bytes(b => {
            b.u32(0).str(tr.handler).zeros(12);
            const name = tr.handler === 'vide' ? 'VideoHandler' : 'SoundHandler';
            b.str(name).u8(0);
          }));
          const xmhd = tr.handler === 'vide' ? box('vmhd', full(0, 1), bytes(b => b.u16(0).u16(0).u16(0).u16(0))) : box('smhd', full(0, 0), bytes(b => b.u16(0).u16(0)));
          const dinf = box('dinf', box('dref', full(0, 0), bytes(b => b.u32(1)), box('url ', full(0, 1))));
          const stsd = box('stsd', full(0, 0), bytes(b => b.u32(1)), tr.entry);
          const stts = box('stts', full(0, 0), bytes(b => {
            const runs = [];
            for (const s of tr.samples) { const r = runs[runs.length - 1]; if (r && r[1] === s.dur) r[0]++; else runs.push([1, s.dur]); }
            b.u32(runs.length); runs.forEach(([n, d]) => b.u32(n).u32(d));
          }));
          const kids = [stsd, stts];
          if (tr.needCtts) {
            kids.push(box('ctts', full(0, 0), bytes(b => {
              const runs = [];
              for (const s of tr.samples) { const r = runs[runs.length - 1]; if (r && r[1] === s.cts) r[0]++; else runs.push([1, s.cts]); }
              b.u32(runs.length); runs.forEach(([n, d]) => b.u32(n).u32(d));
            })));
          }
          if (tr.samples.some(s => !s.key)) {
            kids.push(box('stss', full(0, 0), bytes(b => {
              const keys = [];
              tr.samples.forEach((s, i) => { if (s.key) keys.push(i + 1); });
              b.u32(keys.length); keys.forEach(k => b.u32(k));
            })));
          }
          kids.push(box('stsc', full(0, 0), bytes(b => {
            const runs = [];
            tr.chunks.forEach((c, i) => { const r = runs[runs.length - 1]; if (!r || r[1] !== c.samples.length) runs.push([i + 1, c.samples.length]); });
            b.u32(runs.length); runs.forEach(([first, n]) => b.u32(first).u32(n).u32(1));
          })));
          kids.push(box('stsz', full(0, 0), bytes(b => { b.u32(0).u32(tr.samples.length); tr.samples.forEach(s => b.u32(s.data.length)); })));
          const offs = tr.chunks.map(c => offsets.get(c) || 0);
          kids.push(large
            ? box('co64', full(0, 0), bytes(b => { b.u32(offs.length); offs.forEach(o => b.u64(o)); }))
            : box('stco', full(0, 0), bytes(b => { b.u32(offs.length); offs.forEach(o => b.u32(o)); })));
          const stbl = box('stbl', ...kids);
          const mdia = box('mdia', mdhd, hdlr, box('minf', xmhd, dinf, stbl));
          return edts ? box('trak', tkhd, edts, mdia) : box('trak', tkhd, mdia);
        });
        const mvhd = box('mvhd', full(0, 0), bytes(b => {
          b.u32(0).u32(0).u32(1000).u32(movieDur).u32(0x00010000).u16(0x0100).zeros(10);
          MATRIX.forEach(m => b.u32(m));
          b.zeros(24).u32(tracks.length + 1);
        }));
        return box('moov', mvhd, ...traks);
      };
      // moov goes first (fast start), so its size decides where mdat begins
      const probe = build(new Map());
      const dataStart = ftyp.length + probe.length + (large ? 16 : 8);
      const offsets = new Map();
      let o = dataStart;
      for (const c of chunks) { offsets.set(c, o); for (const s of c.samples) o += s.data.length; }
      const moov = build(offsets);
      const head = large
        ? bytes(b => b.u32(1).str('mdat').u64(mdatSize + 16))
        : bytes(b => b.u32(mdatSize + 8).str('mdat'));
      const parts = [ftyp, moov, head];
      for (const c of chunks) for (const s of c.samples) parts.push(s.data);
      return new Blob(parts, { type: 'video/mp4' });
    }
  }

  /* ================================================================ WebM */
  // EBML element: id is the full id including its length marker.
  function idBytes(id) {
    const out = [];
    let x = id;
    while (x > 0) { out.unshift(x & 255); x = Math.floor(x / 256); }
    return out;
  }
  function vint(n) {
    let len = 1;
    while (n >= Math.pow(2, 7 * len) - 1) len++;
    const out = new Array(len);
    let x = n;
    for (let i = len - 1; i >= 0; i--) { out[i] = x & 255; x = Math.floor(x / 256); }
    out[0] |= 1 << (8 - len);
    return out;
  }
  function uintBytes(n) {
    const out = [];
    do { out.unshift(n & 255); n = Math.floor(n / 256); } while (n > 0);
    return out;
  }
  // An element is { id, v } where v is a number (uint), a string, a
  // Float64 (wrapped), Uint8Array, or an array of child elements.
  const F = v => ({ f64: v });
  function ser(el, parts) {
    const head = idBytes(el.id);
    let body;
    if (Array.isArray(el.v)) {
      const sub = [];
      let n = 0;
      for (const c of el.v) n += ser(c, sub);
      const h = new Uint8Array([...head, ...vint(n)]);
      parts.push(h);
      for (const s of sub) parts.push(s);
      return h.length + n;
    }
    if (el.v instanceof Uint8Array) body = el.v;
    else if (typeof el.v === 'string') body = new TextEncoder().encode(el.v);
    else if (el.v && el.v.f64 !== undefined) { const d = new DataView(new ArrayBuffer(8)); d.setFloat64(0, el.v.f64); body = new Uint8Array(d.buffer); }
    else body = new Uint8Array(uintBytes(el.v));
    const h = new Uint8Array([...head, ...vint(body.length)]);
    parts.push(h, body);
    return h.length + body.length;
  }
  const size = el => { const p = []; return ser(el, p); };

  class WebmMuxer {
    constructor(video, audio) {
      this.v = { ...video, frames: [], desc: null };
      this.a = audio ? { ...audio, frames: [], desc: null, t: 0 } : null;
    }
    addVideo(chunk, meta) {
      if (meta && meta.decoderConfig && meta.decoderConfig.description && !this.v.desc) this.v.desc = toU8(meta.decoderConfig.description);
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      this.v.frames.push({ data, ms: Math.round(chunk.timestamp / 1000), key: chunk.type === 'key', track: 1 });
    }
    addAudio(chunk, meta) {
      if (meta && meta.decoderConfig && meta.decoderConfig.description && !this.a.desc) this.a.desc = toU8(meta.decoderConfig.description);
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      this.a.frames.push({ data, ms: Math.round(this.a.t / 1000), key: true, track: 2 });
      this.a.t += chunk.duration || 20000;
    }
    finalize() {
      const v = this.v, a = this.a;
      const codecId = { vp9: 'V_VP9', vp8: 'V_VP8', av1: 'V_AV1' }[v.kind];
      const durMs = Math.max(v.frames.length * 1000 / v.fps, a ? a.t / 1000 : 0);
      const tracks = [{
        id: 0xae, v: [
          { id: 0xd7, v: 1 }, { id: 0x73c5, v: 1 }, { id: 0x83, v: 1 }, { id: 0x86, v: codecId },
          ...(v.kind === 'av1' ? [{ id: 0x63a2, v: v.desc || av1C(v.codec) }] : []),
          { id: 0x23e383, v: Math.round(1e9 / v.fps) },
          { id: 0xe0, v: [{ id: 0xb0, v: v.width }, { id: 0xba, v: v.height }] },
        ],
      }];
      if (a && a.frames.length) {
        let head = a.desc;
        if (!head || head.length < 19 || String.fromCharCode(...head.slice(0, 8)) !== 'OpusHead') {
          const b = new Bytes().str('OpusHead').u8(1).u8(a.channels);
          head = b.bytes();
          head = new Uint8Array([...head, 312 & 255, 312 >> 8, ...[a.sampleRate & 255, (a.sampleRate >> 8) & 255, (a.sampleRate >> 16) & 255, (a.sampleRate >> 24) & 255], 0, 0, 0]);
        }
        const preSkip = head[10] | (head[11] << 8);
        tracks.push({
          id: 0xae, v: [
            { id: 0xd7, v: 2 }, { id: 0x73c5, v: 2 }, { id: 0x83, v: 2 }, { id: 0x86, v: 'A_OPUS' },
            { id: 0x63a2, v: head }, { id: 0x56aa, v: Math.round(preSkip * 1e9 / 48000) }, { id: 0x56bb, v: 80000000 },
            { id: 0xe1, v: [{ id: 0xb5, v: F(a.sampleRate) }, { id: 0x9f, v: a.channels }] },
          ],
        });
      }
      // clusters start on video keyframes and never span more than ~5 s
      const all = v.frames.concat(a ? a.frames : []).sort((x, y) => x.ms - y.ms || x.track - y.track);
      const clusters = [];
      let cur = null;
      for (const f of all) {
        if (!cur || (f.track === 1 && f.key && f.ms > cur.ms) || f.ms - cur.ms > 5000) {
          cur = { ms: f.ms, blocks: [] };
          clusters.push(cur);
        }
        cur.blocks.push(f);
      }
      const clusterEls = clusters.map(c => ({
        id: 0x1f43b675, v: [{ id: 0xe7, v: c.ms }].concat(c.blocks.map(f => {
          const rel = f.ms - c.ms;
          const hdr = new Uint8Array([0x80 | f.track, (rel >> 8) & 255, rel & 255, f.key ? 0x80 : 0]);
          const d = new Uint8Array(hdr.length + f.data.length);
          d.set(hdr); d.set(f.data, hdr.length);
          return { id: 0xa3, v: d };
        })),
      }));
      const info = { id: 0x1549a966, v: [{ id: 0x2ad7b1, v: 1000000 }, { id: 0x4d80, v: 'Awale promo studio' }, { id: 0x5741, v: 'Awale promo studio' }, { id: 0x4489, v: F(durMs) }] };
      const tracksEl = { id: 0x1654ae6b, v: tracks };
      // Cues and SeekHead point at byte offsets inside the segment; lay the
      // segment out once with fixed-width placeholders, then fill them in.
      const pos8 = n => { const b = new Uint8Array(8); let x = n; for (let i = 7; i >= 0; i--) { b[i] = x & 255; x = Math.floor(x / 256); } return b; };
      const cuesFor = offs => ({
        id: 0x1c53bb6b, v: clusters.map((c, i) => ({ id: 0xbb, v: [{ id: 0xb3, v: c.ms }, { id: 0xb7, v: [{ id: 0xf7, v: 1 }, { id: 0xf1, v: pos8(offs[i]) }] }] })),
      });
      const seekFor = (pInfo, pTracks, pCues) => ({
        id: 0x114d9b74, v: [
          { id: 0x4dbb, v: [{ id: 0x53ab, v: new Uint8Array(idBytes(0x1549a966)) }, { id: 0x53ac, v: pos8(pInfo) }] },
          { id: 0x4dbb, v: [{ id: 0x53ab, v: new Uint8Array(idBytes(0x1654ae6b)) }, { id: 0x53ac, v: pos8(pTracks) }] },
          { id: 0x4dbb, v: [{ id: 0x53ab, v: new Uint8Array(idBytes(0x1c53bb6b)) }, { id: 0x53ac, v: pos8(pCues) }] },
        ],
      });
      const seekSize = size(seekFor(0, 0, 0));
      const infoSize = size(info), tracksSize = size(tracksEl);
      const cuesSize = size(cuesFor(clusters.map(() => 0)));
      const pInfo = seekSize, pTracks = pInfo + infoSize, pCues = pTracks + tracksSize;
      let o = pCues + cuesSize;
      const offs = clusterEls.map(c => { const at = o; o += size(c); return at; });
      const body = [seekFor(pInfo, pTracks, pCues), info, tracksEl, cuesFor(offs), ...clusterEls];
      const parts = [];
      const ebml = { id: 0x1a45dfa3, v: [{ id: 0x4286, v: 1 }, { id: 0x42f7, v: 1 }, { id: 0x42f2, v: 4 }, { id: 0x42f3, v: 8 }, { id: 0x4282, v: 'webm' }, { id: 0x4287, v: 4 }, { id: 0x4285, v: 2 }] };
      ser(ebml, parts);
      ser({ id: 0x18538067, v: body }, parts);
      return new Blob(parts, { type: 'video/webm' });
    }
  }

  /* ============================================================= codecs */
  // H.264 level from frame size and rate (Table A-1 of the spec).
  function avcLevel(w, h, fps) {
    const mbs = Math.ceil(w / 16) * Math.ceil(h / 16), rate = mbs * fps;
    const L = [[0x1f, 3600, 108000], [0x20, 5120, 216000], [0x28, 8192, 245760], [0x2a, 8704, 522240],
      [0x32, 22080, 589824], [0x33, 36864, 983040], [0x34, 36864, 2073600], [0x3c, 139264, 4177920], [0x3d, 139264, 8355840], [0x3e, 139264, 16711680]];
    for (const [lvl, fs, mbps] of L) if (mbs <= fs && rate <= mbps && Math.max(Math.ceil(w / 16), Math.ceil(h / 16)) <= Math.sqrt(fs * 8)) return lvl;
    return 0x3e;
  }
  const hex2 = n => n.toString(16).padStart(2, '0');

  function videoCandidates(container, w, h, fps) {
    const lvl = hex2(avcLevel(w, h, fps));
    const avc = ['64', '4d', '42'].map(p => ({ kind: 'avc', codec: `avc1.${p}00${lvl}`, label: `H.264 ${{ 64: 'High', '4d': 'Main', 42: 'Baseline' }[p]}` }));
    const vp9 = [{ kind: 'vp9', codec: 'vp09.00.51.08', label: 'VP9' }, { kind: 'vp9', codec: 'vp09.00.41.08', label: 'VP9' }, { kind: 'vp9', codec: 'vp09.00.10.08', label: 'VP9' }];
    const av1 = [{ kind: 'av1', codec: 'av01.0.12M.08', label: 'AV1' }, { kind: 'av1', codec: 'av01.0.08M.08', label: 'AV1' }];
    if (container === 'mp4') return [...avc, ...av1, ...vp9];
    return [...vp9, { kind: 'vp8', codec: 'vp8', label: 'VP8' }, ...av1];
  }

  async function pickVideo(container, w, h, fps, bitrate) {
    if (!global.VideoEncoder) return null;
    for (const c of videoCandidates(container, w, h, fps)) {
      for (const hw of ['prefer-hardware', 'no-preference']) {
        const cfg = { codec: c.codec, width: w, height: h, bitrate, framerate: fps, bitrateMode: 'variable', latencyMode: 'quality', hardwareAcceleration: hw };
        if (c.kind === 'avc') cfg.avc = { format: 'avc' };
        try {
          const r = await VideoEncoder.isConfigSupported(cfg);
          if (r.supported) return { ...c, config: r.config || cfg };
        } catch { /* not this one */ }
      }
    }
    return null;
  }

  async function pickAudio(container, sampleRate, channels) {
    if (!global.AudioEncoder) return null;
    const list = container === 'mp4' ? [['aac', 'mp4a.40.2', 'AAC'], ['opus', 'opus', 'Opus']] : [['opus', 'opus', 'Opus']];
    for (const [kind, codec, label] of list) {
      const cfg = { codec, sampleRate, numberOfChannels: channels, bitrate: kind === 'aac' ? 192000 : 160000 };
      try {
        const r = await AudioEncoder.isConfigSupported(cfg);
        if (r.supported) return { kind, codec, label, config: r.config || cfg };
      } catch { /* next */ }
    }
    return null;
  }

  async function probe(container, w, h, fps, bitrate) {
    const [v, a] = await Promise.all([pickVideo(container, w, h, fps, bitrate), pickAudio(container, 48000, 2)]);
    return { video: v, audio: a };
  }

  /* ============================================================= export */
  /**
   * Render and encode the whole film.
   * opts: { film, width, height, fps, bitrate, container, soundtrack (AudioBuffer|null),
   *         duration, onProgress(frac, frameCanvas), signal (AbortSignal) }
   */
  async function exportVideo(opts) {
    const { film, width, height, fps, bitrate, container, duration } = opts;
    const pick = await pickVideo(container, width, height, fps, bitrate);
    if (!pick) throw new Error(`This browser cannot encode ${container.toUpperCase()} video at ${width}×${height}. Try a smaller size or the other format.`);
    const aPick = opts.soundtrack ? await pickAudio(container, opts.soundtrack.sampleRate, opts.soundtrack.numberOfChannels) : null;
    const vInfo = { kind: pick.kind, codec: pick.codec, width, height, fps };
    const aInfo = aPick ? { kind: aPick.kind, sampleRate: opts.soundtrack.sampleRate, channels: opts.soundtrack.numberOfChannels, bitrate: aPick.config.bitrate } : null;
    const mux = container === 'mp4' ? new Mp4Muxer(vInfo, aInfo) : new WebmMuxer(vInfo, aInfo);

    let failure = null;
    const venc = new VideoEncoder({ output: (c, m) => mux.addVideo(c, m), error: e => { failure = e; } });
    venc.configure(pick.config);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    const total = Math.round(duration * fps);
    const keyEvery = Math.max(1, Math.round(fps * 2));
    const started = performance.now();

    for (let i = 0; i < total; i++) {
      if (opts.signal && opts.signal.aborted) { try { venc.close(); } catch { /* closed */ } throw new DOMException('Export cancelled', 'AbortError'); }
      if (failure) throw failure;
      film.render(ctx, i / fps);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      venc.encode(frame, { keyFrame: i % keyEvery === 0 });
      frame.close();
      while (venc.encodeQueueSize > 3) await new Promise(r => setTimeout(r, 1));
      if (opts.onProgress) opts.onProgress((i + 1) / total, canvas, { frame: i + 1, total, elapsed: (performance.now() - started) / 1000 });
      if (i % 4 === 3) await new Promise(r => setTimeout(r, 0));
    }
    await venc.flush();
    venc.close();
    if (failure) throw failure;

    if (aPick) {
      const buf = opts.soundtrack;
      const aenc = new AudioEncoder({ output: (c, m) => mux.addAudio(c, m), error: e => { failure = e; } });
      aenc.configure(aPick.config);
      const n = buf.length, sr = buf.sampleRate, ch = buf.numberOfChannels, step = 4800;
      const chans = [];
      for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
      for (let o = 0; o < n; o += step) {
        const len = Math.min(step, n - o);
        const data = new Float32Array(len * ch);
        for (let c = 0; c < ch; c++) data.set(chans[c].subarray(o, o + len), c * len);
        const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: len, numberOfChannels: ch, timestamp: Math.round((o * 1e6) / sr), data });
        aenc.encode(ad);
        ad.close();
      }
      await aenc.flush();
      aenc.close();
      if (failure) throw failure;
    }
    const blob = mux.finalize();
    return { blob, video: pick, audio: aPick, seconds: (performance.now() - started) / 1000 };
  }

  /** Real-time fallback for browsers without WebCodecs. */
  async function recordRealtime(opts) {
    const { film, width, height, fps, bitrate, duration, soundtrack } = opts;
    const types = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    const type = types.find(t => global.MediaRecorder && MediaRecorder.isTypeSupported(t));
    if (!type) throw new Error('This browser can neither encode video (WebCodecs) nor record a canvas (MediaRecorder).');
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    film.render(ctx, 0);
    const stream = canvas.captureStream(fps);
    let ac = null, src = null;
    if (soundtrack) {
      ac = new (global.AudioContext || global.webkitAudioContext)({ sampleRate: soundtrack.sampleRate });
      const dest = ac.createMediaStreamDestination();
      src = ac.createBufferSource(); src.buffer = soundtrack; src.connect(dest);
      dest.stream.getAudioTracks().forEach(tr => stream.addTrack(tr));
    }
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: bitrate });
    const parts = [];
    rec.ondataavailable = e => { if (e.data.size) parts.push(e.data); };
    const done = new Promise(r => { rec.onstop = r; });
    rec.start(250);
    const t0 = performance.now() + 50;
    if (src) src.start(ac.currentTime + 0.05);
    await new Promise((resolve, reject) => {
      const tick = () => {
        if (opts.signal && opts.signal.aborted) { reject(new DOMException('Export cancelled', 'AbortError')); return; }
        const t = (performance.now() - t0) / 1000;
        film.render(ctx, Math.max(0, t));
        if (opts.onProgress) opts.onProgress(Math.min(1, t / duration), canvas, { elapsed: t });
        if (t >= duration) resolve(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }).finally(() => { rec.stop(); if (ac) ac.close(); });
    await done;
    const blob = new Blob(parts, { type: type.split(';')[0] });
    return { blob, video: { label: 'MediaRecorder (real time)' }, audio: soundtrack ? { label: 'recorded' } : null, realtime: true };
  }

  global.AwaleExport = { exportVideo, recordRealtime, probe, Mp4Muxer, WebmMuxer, avcLevel, supported: () => !!(global.VideoEncoder && global.VideoFrame) };
})(typeof window !== 'undefined' ? window : globalThis);
