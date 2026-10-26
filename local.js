// Runs the schedule page without a Claude account. The schedule comes from data.json next to this file;
// picks and your own edits stay in this browser, and a #p= link carries picks to another device.
(() => {
  'use strict';
  const KEY = 'mpw:local';
  const CODE = { live: 'l', later: 't', skip: 's' };
  const NAME = { l: 'live', t: 'later', s: 'skip' };
  const QR_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';

  function load() {
    try { const v = JSON.parse(localStorage.getItem(KEY)); if (v && typeof v === 'object') return v; } catch (e) { /* storage blocked */ }
    return {};
  }
  const local = Object.assign({ picks: {}, streams: {} }, load());
  function save() { try { localStorage.setItem(KEY, JSON.stringify(local)); } catch (e) { /* storage blocked */ } }

  // A link ending in #p=id~l,id~t,... brings picks over from another device.
  function importFromHash() {
    const hash = location.hash.match(/^#p=([\w~,.-]*)$/);
    if (!hash) return 0;
    let n = 0;
    for (const part of hash[1].split(',')) {
      const [id, c] = part.split('~');
      if (id && NAME[c]) { local.picks[id] = { choice: NAME[c], at: Date.now() }; n++; }
    }
    save();
    history.replaceState(null, '', location.pathname + location.search);
    return n;
  }
  const imported = importFromHash();

  // ---- a small stand-in for the artifact database: data.json underneath, this browser's changes on top ----
  let base = { members: {}, streams: {}, schedules: {}, meta: {} };
  const listeners = new Set();
  const fire = () => setTimeout(() => listeners.forEach(l => l()), 0);
  const ready = fetch('data.json?v=' + Date.now(), { cache: 'no-store' })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(d => { base = Object.assign(base, d); })
    .catch(e => notice('讀不到週表資料（data.json）：' + e.message));

  function docsOf(col) {
    if (col === 'picks') return local.picks;
    if (col !== 'streams') return base[col] || {};
    const out = Object.assign({}, base.streams);
    for (const id in local.streams) { if (local.streams[id] === null) delete out[id]; else out[id] = local.streams[id]; }
    return out;
  }
  const snap = (id, v) => ({ id, exists: v != null, data: () => v, metadata: { fromCache: false, hasPendingWrites: false } });

  function query(col, filters) {
    const run = () => {
      const all = docsOf(col);
      const docs = Object.keys(all).sort()
        .filter(id => col === 'picks' || filters.every(([f, , v]) => all[id] && all[id][f] === v))
        .map(id => snap(id, all[id]));
      return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: {} };
    };
    const q = {
      where: (f, op, v) => query(col, filters.concat([[f, op, v]])),
      orderBy: () => q,
      limit: () => q,
      get: () => ready.then(run),
      onSnapshot(next) { const l = () => next(run()); listeners.add(l); ready.then(l); return () => listeners.delete(l); },
      doc: id => ref(col, id)
    };
    return q;
  }

  function ref(col, id) {
    return {
      id,
      path: col + '/' + id,
      get: () => ready.then(() => snap(id, docsOf(col)[id])),
      async set(v) {
        if (col === 'picks') local.picks[id] = v;
        else if (col === 'streams') local.streams[id] = v;
        else throw { code: 'invalid_argument', message: '這份資料不能在網頁上修改' };
        save(); fire();
      },
      async delete() {
        if (col === 'picks') delete local.picks[id];
        else if (col === 'streams') { if (base.streams[id]) local.streams[id] = null; else delete local.streams[id]; }
        save(); fire();
      },
      onSnapshot(next) { const l = () => next(snap(id, docsOf(col)[id])); listeners.add(l); ready.then(l); return () => listeners.delete(l); }
    };
  }

  const db = { collection: p => query(p, []), doc: p => { const i = p.lastIndexOf('/'); return ref(p.slice(0, i), p.slice(i + 1)); } };

  const downloads = {
    async save({ filename, data }) {
      const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return { status: 'saved' };
    }
  };

  window.claude = { use: async name => (name === 'db' ? db : name === 'downloads' ? downloads : null) };

  // ---- parts of the page that only this version has ----
  const $ = s => document.querySelector(s);
  function notice(msg) { const p = document.createElement('p'); p.className = 'lnotice'; p.textContent = msg; $('.wrap').prepend(p); }
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; setTimeout(() => { t.hidden = true; }, 4000); }
  if (imported) setTimeout(() => toast(`已帶入 ${imported} 個選擇`), 400);
  window.addEventListener('hashchange', () => { const n = importFromHash(); if (n) { fire(); toast(`已帶入 ${n} 個選擇`); } });

  function transferLink() {
    const parts = Object.keys(local.picks).filter(id => CODE[local.picks[id]?.choice]).map(id => `${id}~${CODE[local.picks[id].choice]}`);
    return location.origin + location.pathname + '#p=' + parts.join(',');
  }
  function loadQr() {
    if (window.qrcode) return Promise.resolve();
    return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = QR_SRC; s.onload = ok; s.onerror = fail; document.head.append(s); });
  }

  const dlg = $('#transfer'), scrim = $('#tscrim');
  function closeTransfer() { dlg.hidden = true; scrim.hidden = true; $('#transferBtn').focus(); }
  $('#transferBtn').addEventListener('click', async () => {
    const n = Object.values(local.picks).filter(v => CODE[v?.choice]).length;
    const url = transferLink();
    $('#tCount').textContent = n ? `這台裝置有 ${n} 個選擇。` : '這台裝置還沒有任何選擇，掃了只會打開網頁。';
    $('#tLink').value = url;
    $('#tQr').textContent = '正在產生 QR code…';
    dlg.hidden = false; scrim.hidden = false; $('#tClose').focus();
    try {
      await loadQr();
      const qr = window.qrcode(0, 'L');
      qr.addData(url); qr.make();
      $('#tQr').innerHTML = qr.createSvgTag(4, 8);
    } catch (e) { $('#tQr').textContent = 'QR code 產生不出來，請改用下面的連結。'; }
  });
  $('#tCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#tLink').value); toast('已複製連結'); }
    catch (e) { $('#tLink').select(); toast('請手動複製連結'); }
  });
  $('#tClose').addEventListener('click', closeTransfer);
  scrim.addEventListener('click', closeTransfer);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !dlg.hidden) closeTransfer(); });
})();
