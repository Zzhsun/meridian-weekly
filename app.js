(() => {
  'use strict';
  const OFF = 8 * 3600e3, DAY_START = 6, HOUR = 80;
  const WD = ['一', '二', '三', '四', '五', '六', '日'];
  const SHI = { 23: '子', 1: '丑', 3: '寅', 5: '卯', 7: '辰', 9: '巳', 11: '午', 13: '未', 15: '申', 17: '酉', 19: '戌', 21: '亥' };
  const PICKS = [['live', '看直播', '看'], ['later', '晚點補檔', '補'], ['skip', '跳過', '略']];
  const PF = { youtube: 'YouTube', twitch: 'Twitch' };
  const DURS = [60, 90, 120, 150, 180, 240];

  const S = {
    db: null, dl: null, members: new Map(), streams: new Map(), picks: new Map(), sched: new Map(), meta: null,
    week: '', mode: 'all', view: 'grid', hidden: new Set(), ready: { members: false, week: false },
    unsub: [], sheet: null, q: new Map(), h0: DAY_START, h1: DAY_START + 24, fatal: '', today: ''
  };

  const store = {
    get(k, d) { try { const v = localStorage.getItem('mpw:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('mpw:' + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }
  };

  const $ = s => document.querySelector(s);
  function h(tag, props, ...kids) {
    const n = document.createElement(tag);
    if (props) for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids.flat(3)) {
      if (c == null || c === false || c === '') continue;
      n.append(c instanceof Node ? c : String(c));
    }
    return n;
  }

  // ---- time (everything is Taiwan time, UTC+8, no DST) ----
  const pad = n => String(n).padStart(2, '0');
  function tw(ms) { const d = new Date(ms + OFF); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() }; }
  const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  function utc(s) { const p = s.split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); }
  function addDays(s, n) { const t = new Date(utc(s) + n * 864e5); return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
  function diffDays(a, b) { return Math.round((utc(b) - utc(a)) / 864e5); }
  function weekday(s) { return (new Date(utc(s)).getUTCDay() + 6) % 7; }
  function mondayOf(s) { return addDays(s, -weekday(s)); }
  // A viewing day runs 06:00 to 06:00, so a 01:00 stream sits under the evening it belongs to.
  function displayToday() { const p = tw(Date.now() - DAY_START * 3600e3); return ymd(p.y, p.m, p.d); }
  function nowMin() { const p = tw(Date.now()); let m = p.h * 60 + p.mi; if (p.h < DAY_START) m += 1440; return m; }
  function md(s) { const p = s.split('-').map(Number); return `${p[1]}/${p[2]}`; }
  function hm(min) { return `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`; }
  function stamp(v) { const ms = typeof v === 'number' ? v : Date.parse(v); if (!isFinite(ms)) return ''; const p = tw(ms); return `${p.m}/${p.d} ${pad(p.h)}:${pad(p.mi)}`; }

  // ---- members & streams ----
  function members() { return [...S.members.values()].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)); }
  function safeColor(c) { return /^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '#8a8f9c'; }
  function colorOf(k) { return safeColor(S.members.get(k)?.color); }
  function nameOf(k) { return S.members.get(k)?.name || k; }
  function hostName(st) { return S.members.has(st.host) ? nameOf(st.host) : (st.hostName || st.host || '—'); }

  function norm(id, s) {
    const st = Object.assign({}, s, { id });
    const list = (Array.isArray(s.members) ? s.members : []).filter(Boolean);
    st.members = list.length ? list : [s.host];
    const hostM = S.members.get(s.host);
    st.color = colorOf(hostM ? s.host : st.members.find(k => S.members.has(k)));
    st.dur = Number(s.dur) || hostM?.dur || 120;
    st.choice = S.picks.get(id)?.choice || null;
    const date = typeof s.date === 'string' ? s.date : S.week;
    st.date = date;
    if (typeof s.time === 'string' && /^\d{1,2}:\d{2}$/.test(s.time)) {
      let [hh, mm] = s.time.split(':').map(Number), d = date;
      if (hh < DAY_START) { d = addDays(d, -1); hh += 24; }
      st.day = diffDays(S.week, d); st.start = hh * 60 + mm; st.end = st.start + st.dur; st.timed = true;
    } else { st.day = diffDays(S.week, date); st.timed = false; }
    return st;
  }

  function weekList() {
    const out = [];
    for (const [id, s] of S.streams) {
      const st = norm(id, s);
      if (st.day < 0 || st.day > 6) continue;
      const tracked = st.members.filter(k => S.members.has(k));
      if (tracked.length && tracked.every(k => S.hidden.has(k))) continue;
      if (S.mode === 'mine' && st.choice !== 'live' && st.choice !== 'later') continue;
      out.push(st);
    }
    return out;
  }

  function weekNotes() {
    const days = Array.from({ length: 7 }, () => []);
    if (S.mode === 'mine') return days;
    for (const sc of S.sched.values()) {
      if (S.hidden.has(sc.member)) continue;
      for (const n of Array.isArray(sc.notes) ? sc.notes : []) {
        if (!n || typeof n.date !== 'string') continue;
        const d = diffDays(S.week, n.date);
        if (d >= 0 && d < 7) days[d].push({ type: n.type, text: String(n.text || ''), member: sc.member });
      }
    }
    return days;
  }

  // Overlapping streams share a cluster and get side-by-side lanes. Two overlapping streams that are
  // both still undecided are a clash; one "看直播" settles the pair, two "看直播" is a double booking.
  function analyze(list) {
    let pending = 0, double = 0;
    const active = x => x.choice !== 'skip' && !x.canceled;
    for (let d = 0; d < 7; d++) {
      const items = list.filter(s => s.timed && s.day === d).sort((a, b) => a.start - b.start || b.end - a.end);
      const clusters = [];
      let cl = null, end = -1;
      for (const it of items) { if (!cl || it.start >= end) { cl = []; clusters.push(cl); end = -1; } cl.push(it); end = Math.max(end, it.end); }
      clusters.forEach((c, ci) => {
        const lanes = [];
        for (const it of c) {
          let i = lanes.findIndex(e => e <= it.start);
          if (i < 0) { i = lanes.length; lanes.push(it.end); } else lanes[i] = it.end;
          Object.assign(it, { lane: i, cid: `${d}-${ci}`, csize: c.length, clash: false, dbl: false });
        }
        const root = c.map((_, i) => i);
        const find = i => (root[i] === i ? i : (root[i] = find(root[i])));
        for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) {
          const a = c[i], b = c[j];
          if (!(a.start < b.end && b.start < a.end) || !active(a) || !active(b)) continue;
          if (a.choice === 'live' && b.choice === 'live') { a.dbl = b.dbl = true; double++; }
          else if (S.mode === 'all' && !a.choice && !b.choice) { a.clash = b.clash = true; root[find(i)] = find(j); }
        }
        const groups = new Set();
        c.forEach((x, i) => { x.lanes = lanes.length; if (x.clash) groups.add(find(i)); });
        pending += groups.size;
      });
    }
    return { pending, double };
  }

  // ---- render ----
  // Coalesce redraws; the timer covers views where animation frames are paused (background tabs, hidden panes).
  let raf = 0, rto = 0;
  function render() {
    if (raf || rto) return;
    const run = () => { cancelAnimationFrame(raf); clearTimeout(rto); raf = rto = 0; draw(); };
    raf = requestAnimationFrame(run);
    rto = setTimeout(run, 80);
  }

  function draw() {
    const focusKey = document.activeElement?.getAttribute?.('data-focus');
    S.today = displayToday();
    drawWeek(); drawToolbar(); drawLegend();
    const main = $('#main');
    if (S.fatal) { main.replaceChildren(h('div', { class: 'empty' }, h('b', null, '讀不到資料'), h('p', null, S.fatal))); $('#status').replaceChildren(); $('#missing').hidden = true; return; }
    if (!S.ready.members || !S.ready.week) { main.replaceChildren(h('div', { class: 'empty' }, '正在讀取週表…')); $('#status').replaceChildren(); $('#missing').hidden = true; return; }
    const list = weekList(), an = analyze(list), notes = weekNotes();
    drawStatus(list, an);
    const view = (!list.length && !notes.some(n => n.length)) ? emptyState() : S.view === 'grid' ? drawGrid(list, notes) : drawList(list, notes);
    main.replaceChildren(view);
    if (S.view === 'grid') fitTitles();
    if (S.sheet && S.sheet.mode === 'view' && !S.sheet.editing) drawSheet();
    if (focusKey) document.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  }

  function drawWeek() {
    $('#weekRange').textContent = `${md(S.week)} – ${md(addDays(S.week, 6))}`;
    const diff = Math.round(diffDays(mondayOf(S.today), S.week) / 7);
    $('#weekTag').textContent = diff === 0 ? '本週' : diff === 1 ? '下週' : diff === -1 ? '上週' : diff > 0 ? `${diff} 週後` : `${-diff} 週前`;
  }

  function drawToolbar() {
    document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode)));
    document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === S.view)));
    $('#addBtn').disabled = !S.db || !S.ready.members;
    $('#copyBtn').disabled = !S.db;
  }

  function drawLegend() {
    const groups = new Map();
    for (const m of members()) { const g = m.group || '其他'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(m); }
    $('#legend').replaceChildren(...[...groups].map(([g, ms]) => h('div', { class: 'lgroup' }, h('span', { class: 'gname' }, g), ms.map(m => {
      const on = !S.hidden.has(m.key);
      return h('button', { type: 'button', class: 'mchip', style: `--c:${safeColor(m.color)}`, 'aria-pressed': String(on), 'data-focus': 'm:' + m.key, title: on ? '點一下隱藏她的台' : '點一下顯示她的台', onclick: () => toggleMember(m.key) },
        h('i'), m.name, S.ready.week && !S.sched.has(m.key) ? h('span', { class: 'miss' }, '未發') : null);
    }))));
  }

  function drawStatus(list, an) {
    const act = members().filter(m => m.active !== false);
    const got = act.filter(m => S.sched.has(m.key)).length;
    const missing = act.filter(m => !S.sched.has(m.key));
    const timed = list.filter(s => s.timed && !s.canceled && s.choice !== 'skip').length;
    const lives = list.filter(s => s.choice === 'live').length;
    const stat = (n, label, cls) => h('span', { class: 'stat' + (cls ? ' ' + cls : '') }, h('b', null, n), label);
    const kids = [stat(`${got}/${act.length}`, '位已發週表')];
    if (S.mode === 'all') { kids.push(stat(String(timed), '場有排時間')); kids.push(stat(String(an.pending), '組撞台待選', an.pending ? 'warn' : '')); }
    kids.push(stat(String(lives), '場要看直播'));
    if (an.double) kids.push(stat(String(an.double), '處同時段選了兩台', 'warn'));
    const failed = S.meta?.ok === false;
    kids.push(h('span', { class: 'stat upd' + (failed ? ' warn' : ''), title: S.meta?.summary || '' }, !S.meta?.lastRunAt ? '還沒有自動更新紀錄' : failed ? `自動更新失敗（${stamp(S.meta.lastRunAt)}）：${S.meta.summary || ''}` : `自動更新於 ${stamp(S.meta.lastRunAt)}`));
    $('#status').replaceChildren(...kids);
    const miss = $('#missing');
    if (missing.length && act.length) {
      const links = [];
      missing.forEach((m, i) => { if (i) links.push('、'); links.push(h('a', { href: `https://www.youtube.com/channel/${encodeURIComponent(m.yt || '')}/posts`, target: '_blank', rel: 'noopener' }, m.name)); });
      miss.replaceChildren('這週還沒抓到：', ...links, h('span', { class: 'hint' }, '。下次自動更新是週二晚上 7 點。'));
      miss.hidden = false;
    } else miss.hidden = true;
  }

  function emptyState() {
    if (S.mode === 'mine') return h('div', { class: 'empty' }, h('b', null, '還沒選任何台'), h('p', null, '切回「全部台」，點一場選「看直播」或「晚點補檔」，這裡就會變成只屬於你的週表。'));
    return h('div', { class: 'empty' }, h('b', null, '這週還沒有週表'), h('p', null, '每週二晚上 7 點會自動抓 12 位成員的 YouTube 貼文和週表待機室。臨時想記的台，可以先按「＋ 自己加一場」。'));
  }

  function tagList(st) {
    const t = [];
    if (st.platform === 'twitch') t.push('Twitch');
    if (st.membersOnly) t.push('會限');
    if (st.maybe) t.push('突發／不一定');
    if (st.changedFrom) t.push(`改時間（原定 ${st.changedFrom}）`);
    if (st.canceled) t.push('已取消');
    if (st.low) t.push('辨識待確認');
    return t;
  }
  function aria(st) {
    const c = PICKS.find(p => p[0] === st.choice);
    return `${hostName(st)}，${md(st.date)} ${st.timed ? st.time : '時間未定'}，${st.title || ''}${c ? '，已選' + c[1] : ''}`;
  }

  function drawGrid(list, notes) {
    const timed = list.filter(s => s.timed);
    let lo = 19 * 60, hi = 23 * 60;
    if (timed.length) { lo = Math.min(...timed.map(s => s.start)); hi = Math.max(...timed.map(s => s.end)); }
    const h0 = Math.max(DAY_START, Math.floor(lo / 60));
    let h1 = Math.min(DAY_START + 24, Math.ceil(hi / 60));
    if (h1 - h0 < 5) h1 = Math.min(DAY_START + 24, h0 + 5);
    S.h0 = h0; S.h1 = h1;
    const tIdx = diffDays(S.week, S.today);
    // Every side-by-side lane gets the same width, so a day with three overlapping streams is three lanes wide.
    const lanes = Array(7).fill(1);
    for (const s of timed) if (s.day >= 0 && s.day < 7) lanes[s.day] = Math.max(lanes[s.day], s.lanes || 1);
    const cols = '52px ' + lanes.map(n => `minmax(0,${n}fr)`).join(' ');
    const grid = h('div', { class: 'grid', style: `--hours:${h1 - h0};grid-template-columns:${cols}` });
    grid.append(h('div', { class: 'corner' }, '台灣', h('br'), '時間'));
    for (let d = 0; d < 7; d++) {
      grid.append(h('div', { class: 'dh' + (d === tIdx ? ' today' : '') }, h('span', { class: 'wd' }, '週' + WD[d]), h('span', { class: 'dt' }, md(addDays(S.week, d))), d === tIdx ? h('span', { class: 'tag' }, '今天') : null));
    }
    grid.append(h('div', { class: 'corner sub' }, '未定', h('br'), '休息'));
    for (let d = 0; d < 7; d++) {
      const cell = h('div', { class: 'allday' + (d === tIdx ? ' today' : '') });
      for (const st of list.filter(s => !s.timed && s.day === d)) cell.append(untimedChip(st));
      appendNotes(cell, notes[d]);
      grid.append(cell);
    }
    const rail = h('div', { class: 'rail' });
    for (let hr = h0; hr <= h1; hr++) {
      const shi = SHI[hr % 24];
      rail.append(h('div', { class: 'tick' + (hr === h0 ? ' first' : hr === h1 ? ' last' : ''), style: `top:${(hr - h0) * HOUR}px` },
        shi ? h('span', { class: 'shi' + (shi === '子' || shi === '午' ? ' zw' : ''), title: shi + '時' }, shi) : null,
        h('span', null, pad(hr % 24) + ':00')));
    }
    grid.append(rail);
    for (let d = 0; d < 7; d++) {
      const col = h('div', { class: 'col' + (d === tIdx ? ' today' : '') });
      for (const st of list.filter(s => s.timed && s.day === d)) col.append(evBlock(st, h0));
      if (d === tIdx) { const nm = nowMin(); if (nm >= h0 * 60 && nm <= h1 * 60) col.append(h('div', { class: 'now', style: `top:${(nm - h0 * 60) / 60 * HOUR}px`, 'aria-hidden': 'true' })); }
      grid.append(col);
    }
    return h('div', { class: 'gridwrap' }, grid);
  }

  function evBlock(st, h0) {
    const top = (st.start - h0 * 60) / 60 * HOUR, height = Math.max(28, st.dur / 60 * HOUR - 2);
    const others = st.members.filter(k => k !== st.host).length;
    const cls = ['ev'];
    if (st.choice) cls.push('is-' + st.choice);
    if (st.canceled) cls.push('is-canceled');
    if ((st.lanes || 1) > 1) cls.push('multi');
    if (st.clash) cls.push('clash');
    if (st.dbl) cls.push('dbl');
    const badges = [st.membersOnly ? '會限' : '', st.maybe ? '突發' : '', st.choice === 'later' ? '補檔' : ''].filter(Boolean);
    return h('button', { type: 'button', class: cls.join(' '), style: `--c:${st.color};--lane:${st.lane || 0};--lanes:${st.lanes || 1};--h:${height}px;top:${top}px`, 'data-focus': 'ev:' + st.id, 'aria-label': aria(st), title: `${hostName(st)} ${st.time} ${st.title || ''}`, onclick: () => openSheet(st.id) },
      h('span', { class: 'ev-in' },
        h('span', { class: 'who' }, st.choice === 'live' ? '★ ' : '', h('span', { class: 'nm' }, hostName(st)), h('span', { class: 'nm1' }, [...hostName(st)][0]), others ? h('span', { class: 'ft' }, ` +${others}`) : null),
        h('span', { class: 'when' }, st.clash ? h('i', { class: 'cdot', title: '撞台' }) : null, h('span', null, st.time), st.platform === 'twitch' ? h('span', { class: 'tw', title: 'Twitch' }, 'Tw') : null, badges.map(b => h('span', { class: 'badge' }, b))),
        h('span', { class: 'ttl' }, st.title || '')));
  }

  // Each title gets as many lines as its block's height allows; blocks too narrow for the full name show its first character.
  function fitTitles() {
    for (const b of document.querySelectorAll('#main .ev')) {
      b.classList.toggle('tight', b.clientWidth < 66);
      const inn = b.firstElementChild, t = inn.lastElementChild, cs = getComputedStyle(inn);
      const room = inn.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - (parseFloat(cs.rowGap) || 0) * 2
        - inn.children[0].offsetHeight - inn.children[1].offsetHeight;
      const n = Math.floor(room / (parseFloat(getComputedStyle(t).lineHeight) || 15.5));
      t.classList.toggle('none', n < 1);
      t.style.setProperty('-webkit-line-clamp', String(Math.max(1, n)));
    }
  }

  function untimedChip(st) {
    return h('button', { type: 'button', class: 'uchip' + (st.choice ? ' is-' + st.choice : '') + (st.canceled ? ' is-canceled' : ''), style: `--c:${st.color}`, 'data-focus': 'ev:' + st.id, 'aria-label': aria(st), onclick: () => openSheet(st.id) },
      st.choice === 'live' ? '★ ' : '', h('b', null, hostName(st)), ' ', h('span', { class: 'ttl' }, st.title || '時間未定'),
      st.platform === 'twitch' ? h('em', null, ' · Twitch') : null);
  }

  function appendNotes(box, arr) {
    for (const n of arr.filter(x => x.type === 'event')) box.append(h('div', { class: 'note event', title: n.text }, h('i', { class: 'dot', style: `--c:${colorOf(n.member)}` }), h('b', null, nameOf(n.member)), ' ' + n.text));
    const off = arr.filter(x => x.type !== 'event');
    if (off.length) box.append(h('div', { class: 'note', title: off.map(n => `${nameOf(n.member)}：${n.text}`).join('\n') }, '休息　' + off.map(n => nameOf(n.member)).join('、')));
  }

  function drawList(list, notes) {
    const tIdx = diffDays(S.week, S.today);
    const wrap = h('div', { class: 'list' });
    for (let d = 0; d < 7; d++) {
      const untimed = list.filter(s => !s.timed && s.day === d);
      const timed = list.filter(s => s.timed && s.day === d).sort((a, b) => a.start - b.start || a.end - b.end);
      const sec = h('section', { class: 'day' + (d === tIdx ? ' today' : '') },
        h('h3', null, '週' + WD[d], h('small', null, md(addDays(S.week, d))), d === tIdx ? h('span', { class: 'tag' }, '今天') : null));
      const groups = [], byCid = new Map();
      for (const st of timed) {
        if (st.csize > 1) { if (!byCid.has(st.cid)) { const g = []; byCid.set(st.cid, g); groups.push(g); } byCid.get(st.cid).push(st); }
        else groups.push([st]);
      }
      for (const g of groups) {
        if (g.length === 1) { sec.append(listItem(g[0])); continue; }
        const lives = g.filter(x => x.choice === 'live');
        const open = g.some(x => x.clash || x.dbl);
        const label = g.some(x => x.dbl) ? '時間重疊 · 有兩台同時選了看直播' : g.some(x => x.clash) ? '撞台 · 選要看哪一台' : lives.length ? '時間重疊 · 已選 ' + lives.map(hostName).join('、') : '時間重疊';
        sec.append(h('div', { class: 'clash' + (open ? ' open' : '') }, h('p', null, label), g.map(listItem)));
      }
      for (const st of untimed) sec.append(listItem(st));
      if (notes[d].length) { const box = h('div', { class: 'notes' }); appendNotes(box, notes[d]); sec.append(box); }
      if (!timed.length && !untimed.length && !notes[d].length) sec.append(h('p', { class: 'none' }, S.mode === 'mine' ? '沒有安排' : '沒有排直播'));
      wrap.append(sec);
    }
    return wrap;
  }

  function listItem(st) {
    const others = st.members.filter(k => k !== st.host).map(nameOf);
    const tags = tagList(st);
    return h('div', { class: 'item' + (st.choice ? ' is-' + st.choice : '') + (st.canceled ? ' is-canceled' : ''), style: `--c:${st.color}` },
      h('button', { type: 'button', class: 'item-main', 'data-focus': 'ev:' + st.id, 'aria-label': aria(st), onclick: () => openSheet(st.id) },
        h('span', { class: 'item-time' }, st.timed ? st.time : '未定'),
        h('span', { class: 'item-body' },
          h('span', { class: 'item-who' }, h('i', { class: 'dot' }), hostName(st), others.length ? h('span', { class: 'ft' }, 'ft. ' + others.join('、')) : null),
          h('span', { class: 'item-ttl' }, st.title || '（沒有標題）'),
          tags.length ? h('span', { class: 'item-tags' }, tags.join(' · ')) : null)),
      pickGroup(st));
  }

  function pickGroup(st) {
    return h('div', { class: 'pick', role: 'group', 'aria-label': '這場要怎麼看' },
      PICKS.map(([k, label, short]) => h('button', { type: 'button', 'data-pick': k, 'aria-pressed': String(st.choice === k), 'data-focus': `pick:${st.id}:${k}`, title: label, 'aria-label': label, onclick: () => setPick(st.id, st.choice === k ? null : k) }, short)));
  }

  // ---- detail sheet ----
  function showSheet() {
    if ($('#sheet').hidden) { $('#sheet').hidden = false; $('#scrim').hidden = false; requestAnimationFrame(() => $('#sheetClose').focus()); }
  }
  function closeSheet() {
    const back = S.sheet?.id ? `ev:${S.sheet.id}` : null;
    S.sheet = null; $('#sheet').hidden = true; $('#scrim').hidden = true;
    if (back) document.querySelector(`[data-focus="${CSS.escape(back)}"]`)?.focus({ preventScroll: true });
  }
  function openSheet(id) { S.sheet = { id, mode: 'view', editing: false }; drawSheet(); }
  function openAdd() { if (!S.ready.members) return; S.sheet = { id: null, mode: 'add', editing: true }; drawSheet(); }

  function watchLink(st) {
    const m = S.members.get(st.host);
    if (typeof st.videoId === 'string' && /^[\w-]{11}$/.test(st.videoId)) return { href: `https://www.youtube.com/watch?v=${st.videoId}`, label: '打開 YouTube 待機室' };
    if (st.platform === 'twitch' && m?.twitch) return { href: `https://www.twitch.tv/${encodeURIComponent(m.twitch)}`, label: '打開 Twitch 頻道' };
    if (m?.yt) return { href: `https://www.youtube.com/channel/${encodeURIComponent(m.yt)}/streams`, label: '打開 YouTube 直播頁' };
    if (typeof st.hostUrl === 'string' && /^https:\/\//.test(st.hostUrl)) return { href: st.hostUrl, label: '打開 ' + (st.hostName || '頻道') };
    return null;
  }

  function drawSheet() {
    const body = $('#sheetBody');
    const fk = document.activeElement?.closest?.('#sheet') ? document.activeElement.getAttribute('data-focus') : null;
    if (S.sheet.mode === 'text') {
      const ta = h('textarea', { id: 'f-text', readonly: true, 'aria-label': '我的週表文字' });
      ta.value = S.sheet.text;
      body.replaceChildren(h('h2', { id: 'sheetTitle' }, '我的週表文字'), h('p', { class: 'sh-sub' }, '這裡沒辦法直接複製，請全選下面的文字自己複製。'), ta);
      showSheet(); requestAnimationFrame(() => ta.select());
      return;
    }
    if (S.sheet.mode === 'add') {
      body.replaceChildren(h('h2', { id: 'sheetTitle' }, '自己加一場'), h('p', { class: 'sh-sub' }, '週表沒寫、臨時加開的台，可以先記在這裡。'), editForm(null));
      showSheet();
      return;
    }
    const raw = S.streams.get(S.sheet.id);
    if (!raw) { body.replaceChildren(h('h2', { id: 'sheetTitle' }, '這場已經不在週表上'), h('p', { class: 'sh-sub' }, '可能是週表更新後被移除了。')); showSheet(); return; }
    const st = norm(S.sheet.id, raw);
    const sc = S.sched.get(st.host) || [...S.sched.values()].find(x => st.members.includes(x.member));
    const wl = watchLink(st);
    const when = `${md(st.date)}（${WD[weekday(st.date)]}）`;
    body.replaceChildren(
      h('div', { class: 'sh-who' }, st.members.map(k => h('span', { class: 'mchip static', style: `--c:${colorOf(k)}` }, h('i'), nameOf(k)))),
      h('h2', { id: 'sheetTitle' }, st.title || '（沒有標題）'),
      st.sub ? h('p', { class: 'sh-sub' }, st.sub) : null,
      h('dl', { class: 'sh-meta' },
        h('dt', null, '時間'), h('dd', null, when, ' ', st.timed ? h('span', { class: 'mono' }, `${st.time} – ${hm(st.end)}`) : '時間未定', st.timed && !raw.dur ? h('span', { class: 'item-tags' }, '（結束時間是估的）') : null),
        h('dt', null, '在哪看'), h('dd', null, (PF[st.platform] || '未標示'), ' · ', hostName(st), ' 的頻道'),
        tagList(st).length ? [h('dt', null, '標記'), h('dd', null, tagList(st).join(' · '))] : null,
        h('dt', null, '來源'), h('dd', null, st.src === 'manual' ? '你自己加的' : st.src === 'frame' ? 'YouTube 待機室（週表上沒寫）' : sc ? (sc.kind === 'post' ? 'YouTube 貼文的週表' : '週表待機室封面') : '週表', st.edited && st.src !== 'manual' ? '（你改過）' : '')),
      st.low ? h('p', { class: 'sh-warn' }, '這場是從圖片辨識的，有些字不太確定。可以點「週表原圖」對一下，有錯就在下面修改。') : null,
      h('div', { class: 'sh-links' },
        wl ? h('a', { class: 'btn primary', href: wl.href, target: '_blank', rel: 'noopener' }, wl.label) : null,
        sc?.link ? h('a', { class: 'btn', href: sc.link, target: '_blank', rel: 'noopener' }, '週表原圖') : null),
      h('div', { class: 'sh-pick', role: 'group', 'aria-label': '這場要怎麼看' }, PICKS.map(([k, label]) => h('button', { type: 'button', class: 'btn' + (st.choice === k ? ' on' : ''), 'aria-pressed': String(st.choice === k), 'data-focus': 'sp:' + k, onclick: () => setPick(st.id, st.choice === k ? null : k) }, label))),
      h('details', { class: 'edit', ontoggle: e => { if (S.sheet) S.sheet.editing = e.target.open; } }, h('summary', null, '時間或標題不對？在這裡修改'), editForm(st))
    );
    showSheet();
    if (fk) body.querySelector(`[data-focus="${CSS.escape(fk)}"]`)?.focus({ preventScroll: true });
  }

  function field(id, label, control) { return h('div', { class: 'field' }, h('label', { for: id }, label), control); }
  function durSelect(st) {
    const cur = Number(st?.dur) || 120;
    const opts = DURS.includes(cur) ? DURS : [...DURS, cur].sort((a, b) => a - b);
    return h('select', { id: 'f-dur', name: 'dur' }, opts.map(v => h('option', { value: v, selected: v === cur }, v % 60 ? `${Math.floor(v / 60)} 小時 ${v % 60} 分` : `${v / 60} 小時`)));
  }

  function editForm(st) {
    const isAdd = !st;
    const dates = Array.from({ length: 7 }, (_, d) => addDays(S.week, d));
    const defDate = st ? st.date : dates[Math.min(6, Math.max(0, diffDays(S.week, S.today)))];
    const f = h('form', { class: 'form', onsubmit: e => { e.preventDefault(); submitEdit(st, f); } },
      isAdd ? field('f-host', '誰的台', h('select', { id: 'f-host', name: 'host' }, members().map(m => h('option', { value: m.key }, m.name)))) : null,
      h('div', { class: 'row2' },
        field('f-date', '日期', h('select', { id: 'f-date', name: 'date' }, dates.map((ds, d) => h('option', { value: ds, selected: ds === defDate }, `${md(ds)}（${WD[d]}）`)))),
        field('f-time', '開台時間（不知道就留空）', h('input', { id: 'f-time', name: 'time', type: 'time', value: st?.time || '' }))),
      h('div', { class: 'row2' },
        field('f-dur', '預計長度', durSelect(st)),
        field('f-platform', '平台', h('select', { id: 'f-platform', name: 'platform' }, [['youtube', 'YouTube'], ['twitch', 'Twitch'], ['', '其他／沒寫']].map(([v, l]) => h('option', { value: v, selected: (st ? (st.platform || '') : 'youtube') === v }, l))))),
      field('f-title', '標題', h('input', { id: 'f-title', name: 'title', type: 'text', value: st?.title || '', placeholder: '例如：【歌回】…', required: true })),
      h('label', { class: 'check' }, h('input', { id: 'f-maybe', name: 'maybe', type: 'checkbox', checked: !!st?.maybe }), '突發，不一定會開'),
      h('label', { class: 'check' }, h('input', { id: 'f-mo', name: 'mo', type: 'checkbox', checked: !!st?.membersOnly }), '會員限定'),
      h('div', { class: 'form-actions' },
        h('button', { class: 'btn primary', type: 'submit' }, isAdd ? '加進週表' : '儲存修改'),
        !isAdd ? h('button', { class: 'btn', type: 'button', onclick: () => toggleCancel(st) }, st.canceled ? '恢復這場' : '標記為取消') : null,
        !isAdd && st.src === 'manual' ? h('button', { class: 'btn danger', type: 'button', onclick: e => armDelete(e.currentTarget, st) }, '刪除') : null));
    return f;
  }

  // ---- writes ----
  function errMsg(e) { return (e && (e.message || e.code)) || String(e); }
  function queue(key, fn) { const p = (S.q.get(key) || Promise.resolve()).catch(() => {}).then(fn); S.q.set(key, p); return p; }

  async function setPick(id, choice) {
    try {
      await queue('pick:' + id, () => { const ref = S.db.collection('picks').doc(id); return choice ? ref.set({ choice, week: S.week, at: Date.now() }) : ref.delete(); });
    } catch (e) { toast('沒有存到：' + errMsg(e)); }
  }

  async function submitEdit(st, f) {
    const fd = new FormData(f);
    const title = String(fd.get('title') || '').trim();
    if (!title) { toast('請填標題'); return; }
    const time = String(fd.get('time') || '').trim();
    const date = String(fd.get('date'));
    const body = Object.assign({}, st ? S.streams.get(st.id) : {}, {
      date, time: time || null, dur: Number(fd.get('dur')) || null, title, platform: String(fd.get('platform') || ''),
      maybe: !!fd.get('maybe'), membersOnly: !!fd.get('mo'), week: S.week, edited: true, updatedAt: Date.now()
    });
    let id = st?.id;
    if (!st) {
      const host = String(fd.get('host'));
      Object.assign(body, { host, members: [host], src: 'manual' });
      id = `${host}-${date.replace(/-/g, '')}-${time ? time.replace(':', '') : 'tbd'}-m${Math.random().toString(36).slice(2, 6)}`;
    }
    try {
      await queue('s:' + id, () => S.db.collection('streams').doc(id).set(body));
      toast(st ? '已儲存修改' : '已加進週表');
      if (st) { S.sheet = { id, mode: 'view', editing: false }; drawSheet(); } else closeSheet();
    } catch (e) { toast('沒有存到：' + errMsg(e)); }
  }

  async function toggleCancel(st) {
    const body = Object.assign({}, S.streams.get(st.id), { canceled: !st.canceled, edited: true, updatedAt: Date.now() });
    try { await queue('s:' + st.id, () => S.db.collection('streams').doc(st.id).set(body)); toast(body.canceled ? '已標記為取消' : '已恢復'); S.sheet.editing = false; drawSheet(); }
    catch (e) { toast('沒有存到：' + errMsg(e)); }
  }

  function armDelete(btn, st) {
    if (btn.dataset.armed) { deleteStream(st); return; }
    btn.dataset.armed = '1'; btn.textContent = '再按一次確認刪除';
    setTimeout(() => { if (document.contains(btn)) { delete btn.dataset.armed; btn.textContent = '刪除'; } }, 4000);
  }
  async function deleteStream(st) {
    try {
      await queue('s:' + st.id, () => S.db.collection('streams').doc(st.id).delete());
      await queue('pick:' + st.id, () => S.db.collection('picks').doc(st.id).delete());
      closeSheet(); toast('已刪除');
    } catch (e) { toast('沒有刪掉：' + errMsg(e)); }
  }

  // ---- my schedule out ----
  function myLive() {
    return [...S.streams].map(([id, s]) => norm(id, s))
      .filter(st => st.choice === 'live' && st.day >= 0 && st.day < 7 && !st.canceled)
      .sort((a, b) => a.day - b.day || (a.timed ? a.start : 1e5) - (b.timed ? b.start : 1e5));
  }

  async function copyMine() {
    const lines = [];
    let cur = -1;
    for (const st of myLive()) {
      if (st.day !== cur) { cur = st.day; const ds = addDays(S.week, st.day); lines.push(`${md(ds)}（${WD[st.day]}）`); }
      lines.push(`  ${st.timed ? st.time : '未定 '}  ${hostName(st)}｜${st.title || ''}${st.platform === 'twitch' ? '（Twitch）' : ''}`);
    }
    if (!lines.length) { toast('還沒有選任何「看直播」'); return; }
    const text = `我的子午週表 ${md(S.week)}–${md(addDays(S.week, 6))}\n` + lines.join('\n');
    try { await navigator.clipboard.writeText(text); toast('已複製，可以貼到記事本或聊天室'); }
    catch (e) { S.sheet = { mode: 'text', text }; drawSheet(); }
  }

  function absDT(date, min) {
    const ds = addDays(date, Math.floor(min / 1440)), m = ((min % 1440) + 1440) % 1440, p = ds.split('-');
    const hh = Math.floor(m / 60), h12 = hh % 12 === 0 ? 12 : hh % 12;
    return { d: `${p[1]}/${p[2]}/${p[0]}`, t: `${pad(h12)}:${pad(m % 60)} ${hh >= 12 ? 'PM' : 'AM'}` };
  }
  async function exportCsv() {
    const rows = myLive().filter(st => st.timed);
    if (!rows.length) { toast('還沒有選任何有時間的「看直播」'); return; }
    const q = v => `"${String(v).replace(/"/g, '""')}"`;
    const out = ['Subject,Start Date,Start Time,End Date,End Time,Description,Location'];
    for (const st of rows) {
      const base = addDays(S.week, st.day), s = absDT(base, st.start), e = absDT(base, st.end);
      out.push([q(`${hostName(st)}｜${st.title || ''}`), s.d, s.t, e.d, e.t, q([st.sub, tagList(st).join(' · ')].filter(Boolean).join(' / ')), q(watchLink(st)?.href || '')].join(','));
    }
    try { await S.dl.save({ filename: `meridian-week-${S.week}.csv`, data: out.join('\r\n') }); toast('已匯出。在 Google 日曆的「設定 → 匯入」選這個檔案'); }
    catch (e) { if (e?.code !== 'declined') toast('沒有匯出：' + errMsg(e)); }
  }

  let toastTimer = 0;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200); }

  // ---- data ----
  function toggleMember(k) { if (S.hidden.has(k)) S.hidden.delete(k); else S.hidden.add(k); store.set('hidden', [...S.hidden]); render(); }
  function changeWeek(n) { S.week = addDays(S.week, n); if (S.sheet) closeSheet(); if (S.db) subscribeWeek(); render(); }
  function dbError(e) { toast('資料連線出了問題：' + errMsg(e)); }

  function subscribeWeek() {
    S.unsub.forEach(u => { try { u(); } catch (e) { /* already closed */ } });
    S.unsub = []; S.streams = new Map(); S.picks = new Map(); S.sched = new Map(); S.ready.week = false;
    const w = S.week, db = S.db;
    S.unsub.push(db.collection('streams').where('week', '==', w).onSnapshot(snap => { if (w !== S.week) return; S.streams = new Map(snap.docs.map(d => [d.id, d.data()])); S.ready.week = true; render(); }, dbError));
    S.unsub.push(db.collection('picks').where('week', '==', w).onSnapshot(snap => { if (w !== S.week) return; S.picks = new Map(snap.docs.map(d => [d.id, d.data()])); render(); }, dbError));
    S.unsub.push(db.collection('schedules').where('week', '==', w).onSnapshot(snap => { if (w !== S.week) return; S.sched = new Map(snap.docs.map(d => { const v = d.data(); return [v.member, v]; })); render(); }, dbError));
  }

  async function boot() {
    let db = null;
    try { db = window.claude && typeof window.claude.use === 'function' ? await window.claude.use('db') : null; } catch (e) { db = null; }
    if (!db) { S.fatal = '這個頁面要在 claude.ai 登入後打開，才讀得到週表資料。'; render(); return; }
    S.db = db;
    db.collection('members').onSnapshot(snap => { S.members = new Map(snap.docs.map(d => [d.id, Object.assign({ key: d.id }, d.data())])); S.ready.members = true; render(); }, dbError);
    db.doc('meta/status').onSnapshot(d => { S.meta = d.exists ? d.data() : null; render(); }, dbError);
    subscribeWeek();
    render();
    try { S.dl = await window.claude.use('downloads'); } catch (e) { S.dl = null; }
    $('#exportBtn').hidden = !S.dl;
  }

  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { S.mode = b.dataset.mode; store.set('mode', S.mode); render(); }));
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { S.view = b.dataset.view; render(); }));
  $('#prevWeek').addEventListener('click', () => changeWeek(-7));
  $('#nextWeek').addEventListener('click', () => changeWeek(7));
  $('#addBtn').addEventListener('click', openAdd);
  $('#copyBtn').addEventListener('click', copyMine);
  $('#exportBtn').addEventListener('click', exportCsv);
  $('#scrim').addEventListener('click', closeSheet);
  $('#sheetClose').addEventListener('click', closeSheet);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.sheet) closeSheet(); });
  let fitTimer = 0;
  const refit = () => { clearTimeout(fitTimer); fitTimer = setTimeout(() => { if (S.view === 'grid') fitTitles(); }, 60); };
  window.addEventListener('resize', refit);
  if (document.fonts) { document.fonts.ready.then(refit); document.fonts.addEventListener('loadingdone', refit); }

  S.today = displayToday();
  S.week = mondayOf(S.today);
  S.hidden = new Set(store.get('hidden', []));
  S.mode = store.get('mode', 'all') === 'mine' ? 'mine' : 'all';
  // The page always opens on the list; the week grid is the other option.
  S.view = 'list';
  render();
  boot();
  setInterval(() => {
    if (S.today !== displayToday()) { render(); return; }
    const n = document.querySelector('.now');
    if (n) n.style.top = ((nowMin() - S.h0 * 60) / 60 * HOUR) + 'px';
  }, 60000);
})();
