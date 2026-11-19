(() => {
  'use strict';
  const VER = '20261119f';   // 배포할 때마다 바꿔 브라우저 캐시를 피한다 (index.html의 ?v= 와 같이)

  const CAT = {
    bf:  { label: '무장애나눔길', short: '무장애나눔길' },
    kid: { label: '유아숲체험원', short: '유아숲' },
    rec: { label: '자연휴양림',   short: '휴양림' },
    mtn: { label: '등산코스 (100대 명산)', short: '등산코스' },
    trail: { label: '숲길·둘레길', short: '숲길·둘레길' },
    ridge: { label: '종주길 (백두대간·정맥)', short: '종주길' },
  };
  const hasCourses = (p) => Array.isArray(p.courses);
  const LEVEL = { easy: '쉬움', mid: '보통', hard: '힘듦' };
  const LEVEL_ORDER = { easy: 0, mid: 1, hard: 2 };
  const NEAR_KM = 10;        // "내 주변" 요약 반경
  const PAGE = 50;           // 목록 한 번에 보여줄 개수

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장 불가 환경 무시 */ } },
  };

  const state = { places: [], cats: new Set(['bf', 'kid', 'rec', 'mtn', 'trail', 'ridge']), q: '', stayOnly: false, easyOnly: false, me: null, sel: null, limit: PAGE, recSort: 'near', recLimit: 5 };
  const REC_KM = 20;         // 추천 코스: 출발점이 이 거리 안에 있는 코스
  const markers = new Map();

  // ── 글자 크게 ──
  const btnFont = $('#btnFont');
  const applyFont = (on) => { document.documentElement.classList.toggle('big', on); btnFont.setAttribute('aria-pressed', String(on)); };
  applyFont(store.get('big') === '1');
  btnFont.addEventListener('click', () => { const on = !document.documentElement.classList.contains('big'); applyFont(on); store.set('big', on ? '1' : '0'); setTimeout(() => map.invalidateSize(), 50); });

  // ── 소개 ──
  const about = $('#about');
  $('#btnAbout').addEventListener('click', () => about.showModal());

  // ── 지도 ──
  const map = L.map('map', { zoomControl: true, minZoom: 6, maxZoom: 18, attributionControl: true }).setView([36.35, 127.8], 7);
  // 휴대폰: 아래 목록(바텀시트)에 가리지 않게 남한 전체를 시트 위 공간에 맞춘다
  if (matchMedia('(max-width: 760px)').matches) {
    map.fitBounds([[33.1, 125.0], [38.6, 129.6]], { paddingTopLeft: [8, 8], paddingBottomRight: [8, $('#panel').offsetHeight + 8] });
    map.attributionControl.setPosition('topright'); // 아래쪽은 목록·팝업과 겹치므로 출처 표시는 오른쪽 위로
  }
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  const cluster = L.markerClusterGroup({
    // 유아숲은 읍면동 단위 대략 위치라 같은 좌표가 겹친다 → 확대해도 겹친 핀은 묶어 두고 눌렀을 때 펼친다
    showCoverageOnHover: false, spiderfyOnMaxZoom: true, maxClusterRadius: (z) => (z >= 13 ? 8 : 45),
    iconCreateFunction: (c) => {
      const n = c.getChildCount();
      const size = n < 10 ? 34 : n < 50 ? 40 : 48;
      return L.divIcon({ className: 'clu', html: `<div>${n}</div>`, iconSize: [size, size] });
    },
  });
  map.addLayer(cluster);
  let meMarker = null;

  // ── 거리 ──
  const toRad = (d) => d * Math.PI / 180;
  function km(a, b) {
    const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(h));
  }
  // 코스가 있는 곳(산·숲길·종주길)은 가장 가까운 코스 출발점까지의 거리
  function dist(o, p) {
    let d = km(o, p);
    if (hasCourses(p)) for (const c of p.courses) d = Math.min(d, km(o, { lat: c.start[0], lon: c.start[1] }));
    return d;
  }
  const fmtKm = (d) => d < 1 ? `${Math.round(d * 1000)}m` : d < 10 ? `${d.toFixed(1)}km` : `${Math.round(d)}km`;
  const fmtLen = (m) => m >= 1000 ? `${(m / 1000).toFixed(m % 1000 ? 1 : 0)}km` : `${m}m`;

  // ── 필터 ──
  function matches(p) {
    if (!state.cats.has(p.cat)) return false;
    if (state.stayOnly && p.cat === 'rec' && !p.stay) return false;
    if (state.easyOnly && hasCourses(p) && !p.courses.some((c) => c.level === 'easy')) return false;
    if (state.q) {
      const extra = p.courses ? p.courses.map((c) => c.from || '').join(' ') : '';
      const hay = `${p.name} ${p.addr} ${p.org || ''} ${extra}`.toLowerCase();
      if (!state.q.split(/\s+/).every((t) => hay.includes(t))) return false;
    }
    return true;
  }

  // ── 등산코스 ──
  // 산은 쉬운 코스부터, 숲길·종주길은 원래 구간 순서대로
  const sortedCourses = (p) => p.cat === 'mtn'
    ? [...p.courses].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.km - b.km)
    : p.courses;
  const courseName = (p, c) => p.cat === 'mtn'
    ? (c.from ? `${c.from} 출발` : `${p.name} ${c.id.split('-')[1]}코스`)
    : (c.from || `${c.id.split('-')[1]}코스`);
  // 코스마다 다른 색 (초록 지도 위에서 잘 보이는 색 위주, 목록 순서대로 배정)
  const PALETTE = ['#e6194b', '#2f6fde', '#f58231', '#911eb4', '#0aa3b5', '#d6249f', '#8c5a1e', '#1b2a8a', '#c9a100', '#7a0019', '#3a8f84', '#ff6f91'];
  const courseColor = (i) => PALETTE[i % PALETTE.length];

  function mountainPopupHtml(p) {
    const nm = encodeURIComponent(p.name);
    const rows = sortedCourses(p).map((c, i) => {
      const tags = [c.park && '주차', c.toilet && '화장실', c.bus && '대중교통'].filter(Boolean).join(' · ');
      return `<li><button type="button" class="course" data-route="${c.id}" data-mtn="${p.id}" style="--cc:${courseColor(i)}">
        <span class="lv ${c.level}">${LEVEL[c.level]}</span>
        <span class="cname">${esc(courseName(p, c))}</span>
        <span class="cmeta">${c.km}km${c.rise != null ? ` · 약 ${c.rise}m 오름` : ''}${tags ? ` · ${tags}` : ''}</span>
      </button></li>`;
    }).join('');
    const distHtml = state.me ? `<p class="pdist">내 위치에서 ${p.cat === 'mtn' ? '가장 가까운 출발점까지 ' : '가장 가까운 구간 출발점까지 '}${esc(fmtKm(dist(state.me, p)))}</p>` : '';
    const total = p.courses.reduce((s, c) => s + c.km, 0);
    const intro = p.cat === 'mtn' ? '' : `<p class="pdist" style="color:var(--ink-2)">${p.src ? esc(p.src) + ' · ' : ''}${p.courses.length}개 구간 · 총 약 ${Math.round(total)}km</p>`;
    const go = p.cat === 'mtn'
      ? `<a class="go" href="https://map.kakao.com/link/to/${nm},${p.lat},${p.lon}" target="_blank" rel="noopener">정상까지 길찾기</a>`
      : `<a class="go" href="https://map.kakao.com/link/to/${nm},${p.lat},${p.lon}" target="_blank" rel="noopener">첫 구간 출발점 길찾기</a>`;
    return `<div class="pop ${p.cat}">
      <div class="kind"><i class="dot ${p.cat}"></i>${CAT[p.cat].label}</div>
      <h4>${esc(p.name)}</h4>${intro}${distHtml}
      <p class="hint">지도에 코스 ${p.courses.length}개를 색으로 표시했어요. 코스를 누르면 그 길만 강조돼요. 난이도는 거리와 높이차로 계산한 참고값이에요.</p>
      <ul class="courses">${rows}</ul>
      <div class="acts">${go}</div>
    </div>`;
  }

  let routesCache = null;
  let keepRoute = false;
  let drawn = { mtn: null, lines: {} };
  const routeLayer = L.layerGroup().addTo(map);
  const startLayer = L.layerGroup().addTo(map);
  const routeBar = $('#routeBar');
  function clearRoute() { routeLayer.clearLayers(); startLayer.clearLayers(); drawn = { mtn: null, lines: {} }; routeBar.hidden = true; routeBar.dataset.mtn = ''; }

  async function loadRoutes() {
    if (!routesCache) routesCache = await fetch('data/routes.json?v=' + VER).then((r) => r.json());
    return routesCache;
  }

  // 산의 모든 코스를 각각 다른 색으로 그린다
  async function drawCourses(mtnId) {
    try { await loadRoutes(); } catch { return false; }
    if (drawn.mtn === mtnId) return true;
    routeLayer.clearLayers(); startLayer.clearLayers();
    drawn = { mtn: mtnId, lines: {} };
    const p = state.places.find((x) => x.id === mtnId);
    sortedCourses(p).forEach((c, i) => {
      const pts = routesCache[c.id]; if (!pts) return;
      const color = courseColor(i);
      const casing = L.polyline(pts, { color: '#fff', weight: 7, opacity: 0.8, interactive: false }).addTo(routeLayer);
      const line = L.polyline(pts, { color, weight: 4, opacity: 0.95, interactive: false }).addTo(routeLayer);
      // 가는 선은 누르기 어려워서, 보이지 않는 굵은 선을 위에 겹쳐 클릭·툴팁을 받는다
      const hit = L.polyline(pts, { color, weight: 18, opacity: 0, className: 'route-hit' }).addTo(routeLayer);
      hit.bindTooltip(`${LEVEL[c.level]} · ${courseName(p, c)} · ${c.km}km`, { sticky: true });
      hit.on('click', (e) => { L.DomEvent.stop(e); showRoute(mtnId, c.id); });
      drawn.lines[c.id] = { casing, line, hit, color };
    });
    return true;
  }

  // courseId 하나를 강조하고 나머지는 흐리게 (null이면 모두 같은 굵기)
  function highlight(courseId) {
    for (const [id, l] of Object.entries(drawn.lines)) {
      if (!courseId) { l.casing.setStyle({ weight: 7, opacity: 0.8 }); l.line.setStyle({ weight: 4, opacity: 0.95 }); continue; }
      if (id === courseId) { l.casing.setStyle({ weight: 11, opacity: 1 }); l.line.setStyle({ weight: 6, opacity: 1 }); }
      else { l.casing.setStyle({ weight: 0, opacity: 0 }); l.line.setStyle({ weight: 3, opacity: 0.3 }); }
    }
    if (courseId && drawn.lines[courseId]) { drawn.lines[courseId].casing.bringToFront(); drawn.lines[courseId].line.bringToFront(); drawn.lines[courseId].hit.bringToFront(); }
  }

  // 팝업을 닫았을 때: 코스 전체 보기 막대
  function showOverview(mtnId) {
    const p = state.places.find((x) => x.id === mtnId);
    highlight(null); startLayer.clearLayers();
    routeBar.innerHTML = `
      <div class="rb-main"><div><b>${esc(p.name)} · 코스 ${p.courses.length}개</b>
        <small>색깔 선을 누르면 그 코스 정보가 나와요</small></div></div>
      <div class="rb-acts">
        <button type="button" data-act="list">코스 목록</button>
        <button type="button" data-act="close" aria-label="등산로 닫기">닫기</button>
      </div>`;
    routeBar.dataset.mtn = mtnId;
    routeBar.hidden = false;
    // 코스 전체가 한눈에 보이게 지도 맞추기 (둘레길·종주길처럼 긴 길에 특히 필요)
    const ls = Object.values(drawn.lines);
    if (ls.length) {
      const b = ls.reduce((acc, l) => acc.extend(l.line.getBounds()), L.latLngBounds(ls[0].line.getBounds()));
      map.fitBounds(b, { paddingTopLeft: [30, 30], paddingBottomRight: [30, routeBar.offsetHeight + 30], maxZoom: 14 });
    }
  }

  // opts.include: 함께 보이게 할 지점(내 위치), opts.keepSheet: 모바일 목록 크기 유지
  async function showRoute(mtnId, courseId, opts = {}) {
    if (!(await drawCourses(mtnId))) return;
    const l = drawn.lines[courseId]; if (!l) return;
    const p = state.places.find((x) => x.id === mtnId);
    const c = p.courses.find((x) => x.id === courseId);
    // 팝업이 등산로를 가리지 않도록 닫고, 코스 정보는 지도 아래 막대로 보여 준다
    keepRoute = true; markers.get(mtnId).closePopup(); keepRoute = false;
    highlight(courseId);
    startLayer.clearLayers();
    L.circleMarker(c.start, { radius: 7, color: '#fff', weight: 3, fillColor: l.color, fillOpacity: 1 })
      .bindTooltip('출발', { direction: 'top', permanent: true, className: 'start-tip' }).addTo(startLayer);
    const line = l.line;
    const tags = [c.park && '주차장', c.toilet && '화장실', c.bus && '대중교통'].filter(Boolean).join(' · ');
    routeBar.innerHTML = `
      <div class="rb-main">
        <i class="swatch" style="background:${l.color}"></i>
        <span class="lv ${c.level}">${LEVEL[c.level]}</span>
        <div><b>${esc(p.name)} · ${esc(courseName(p, c))}</b>
        <small>${c.km}km${c.rise != null ? ` · 출발점보다 약 ${c.rise}m 높이 오름` : ''}${tags ? ` · ${tags}` : ''}</small></div>
      </div>
      <div class="rb-acts">
        <a class="go" href="https://map.kakao.com/link/to/${encodeURIComponent(courseName(p, c))},${c.start[0]},${c.start[1]}" target="_blank" rel="noopener">출발점 길찾기</a>
        <button type="button" data-act="list">코스 목록</button>
        <button type="button" data-act="close" aria-label="등산로 닫기">닫기</button>
      </div>`;
    routeBar.dataset.mtn = mtnId;
    routeBar.hidden = false;
    if (mobile() && !opts.keepSheet) setSheet('min');
    const b = L.latLngBounds(line.getBounds());
    if (opts.include) b.extend(opts.include);
    map.fitBounds(b, { paddingTopLeft: [40, 40], paddingBottomRight: [40, routeBar.offsetHeight + 40], maxZoom: 15 });
    state.recOn = courseId;   // 목록이 다시 그려져도 선택 표시 유지
    listEl.querySelectorAll('.rcm.on').forEach((el) => el.classList.remove('on'));
    listEl.querySelector(`.rcm[data-cid="${courseId}"]`)?.classList.add('on');
  }

  // ── 내 주변 추천 코스 ──
  // 산·숲길·종주길의 모든 코스를 '출발점까지 거리'로 줄 세운다
  function nearbyCourses() {
    if (!state.me) return { list: [], within: false };
    const all = [];
    for (const p of state.places) {
      if (!hasCourses(p) || !matches(p)) continue;
      for (const c of p.courses) {
        if (state.easyOnly && c.level !== 'easy') continue;
        all.push({ p, c, d: km(state.me, { lat: c.start[0], lon: c.start[1] }) });
      }
    }
    all.sort((a, b) => a.d - b.d);
    let list = all.filter((x) => x.d <= REC_KM);
    const within = list.length > 0;
    if (!within) list = all.slice(0, 5);
    if (state.recSort === 'easy') list = [...list].sort((a, b) => LEVEL_ORDER[a.c.level] - LEVEL_ORDER[b.c.level] || a.d - b.d);
    return { list, within, nearest: all[0] };
  }

  function recsHtml() {
    const { list, within, nearest } = nearbyCourses();
    if (!list.length) return '';
    const items = list.slice(0, state.recLimit).map((x, i) => {
      const best = nearest && x.c.id === nearest.c.id;
      return `<li><button type="button" class="rcm${best ? ' best' : ''}${state.recOn === x.c.id && !routeBar.hidden ? ' on' : ''}" data-pid="${x.p.id}" data-cid="${x.c.id}">
        <span class="rk">${i + 1}</span>
        <span class="rinfo"><b>${esc(courseName(x.p, x.c))}</b>
          <small><i class="dot ${x.p.cat}"></i>${esc(x.p.name)} · 코스 ${x.c.km}km${best ? ' · <em>가장 가까운 출발점</em>' : ''}</small></span>
        <span class="rside"><span class="lv ${x.c.level}">${LEVEL[x.c.level]}</span><span class="rdist">${fmtKm(x.d)}</span></span>
      </button></li>`;
    }).join('');
    const more = list.length > state.recLimit ? `<button type="button" class="more more-recs">추천 코스 ${list.length - state.recLimit}개 더 보기</button>` : '';
    const sub = within ? `출발점까지 거리 기준 · ${REC_KM}km 안에 ${list.length}개 코스` : `${REC_KM}km 안에는 코스가 없어 가장 가까운 코스를 보여 드려요`;
    return `<li class="recs">
      <div class="recs-head"><b>내 주변 추천 코스</b>
        <div class="seg" role="group" aria-label="추천 코스 정렬">
          <button type="button" data-sort="near" aria-pressed="${state.recSort === 'near'}">가까운 순</button>
          <button type="button" data-sort="easy" aria-pressed="${state.recSort === 'easy'}">쉬운 순</button>
        </div></div>
      <p class="recs-sub">${sub}</p>
      <ol class="rec-list">${items}</ol>${more}
    </li>`;
  }
  routeBar.addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act; if (!act) return;
    if (act === 'close') { clearRoute(); return; }
    const m = markers.get(drawn.mtn);
    keepRoute = true; cluster.zoomToShowLayer(m, () => { m.openPopup(); keepRoute = false; });
  });
  // Leaflet 팝업은 클릭 전파를 막으므로 열릴 때 버튼에 직접 연결
  map.on('popupopen', (e) => {
    e.popup.getElement().querySelectorAll('.course').forEach((b) =>
      b.addEventListener('click', (ev) => { ev.preventDefault(); showRoute(b.dataset.mtn, b.dataset.route); }));
  });

  // ── 팝업 ──
  function popupHtml(p) {
    if (hasCourses(p)) return mountainPopupHtml(p);
    const rows = [];
    const row = (k, v) => { if (v) rows.push(`<dt>${esc(k)}</dt><dd>${v}</dd>`); };
    row('주소', esc(p.addr) + (p.approx ? ' <span class="badge warn">대략 위치</span>' : ''));
    if (p.cat === 'bf') {
      row('길이', esc(fmtLen(p.len)));
      row('조성', `${esc(p.year)}년`);
      row('관리', esc(p.org));
    } else if (p.cat === 'kid') {
      row('운영', esc(p.period));
      row('참여', esc(p.how));
      row('문의', p.tel ? `<a href="tel:${esc(p.tel)}">${esc(p.tel)}</a>` : '');
    } else {
      row('구분', esc(p.own) + (p.stay ? ' · 숙박 가능' : ' · 당일 이용'));
      row('시설', esc(p.fac));
      row('입장료', esc(p.fee));
      row('문의', p.tel ? `<a href="tel:${esc(p.tel)}">${esc(p.tel)}</a>` : '');
    }
    if (state.me) row('거리', `내 위치에서 ${esc(fmtKm(dist(state.me, p)))}`);
    const nm = encodeURIComponent(p.name);
    const acts = [
      `<a class="go" href="https://map.kakao.com/link/to/${nm},${p.lat},${p.lon}" target="_blank" rel="noopener">길찾기</a>`,
      `<a href="https://map.kakao.com/link/map/${nm},${p.lat},${p.lon}" target="_blank" rel="noopener">카카오맵</a>`,
    ];
    if (p.url) acts.push(`<a href="${esc(/^https?:/i.test(p.url) ? p.url : 'http://' + p.url)}" target="_blank" rel="noopener">홈페이지</a>`);
    return `<div class="pop ${p.cat}">
      <div class="kind"><i class="dot ${p.cat}"></i>${CAT[p.cat].label}</div>
      <h4>${esc(p.name)}</h4>
      <dl>${rows.join('')}</dl>
      <div class="acts">${acts.join('')}</div>
    </div>`;
  }

  function icon(p, on) {
    return L.divIcon({ className: '', html: `<div class="pin ${p.cat}${p.approx ? ' approx' : ''}${on ? ' on' : ''}"></div>`, iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -10] });
  }

  function buildMarkers() {
    for (const p of state.places) {
      const m = L.marker([p.lat, p.lon], { icon: icon(p, false), title: p.name, keyboard: true });
      m.bindPopup(() => popupHtml(p), { maxWidth: 320, autoPanPadding: [24, 24] });
      m.on('click', () => select(p.id, false));
      m.on('popupclose', () => {
        if (keepRoute) return;
        if (state.sel === p.id) select(null, false);
        if (hasCourses(p) && drawn.mtn === p.id) showOverview(p.id);
      });
      m.on('popupopen', () => {
        if (drawn.mtn && drawn.mtn !== p.id) clearRoute();
        if (hasCourses(p)) {
          routeBar.hidden = true; startLayer.clearLayers();
          drawCourses(p.id).then((ok) => { if (ok) highlight(null); });
        }
      });
      markers.set(p.id, m);
    }
  }

  function refreshMarkers() {
    const show = [];
    for (const p of state.places) if (matches(p)) show.push(markers.get(p.id));
    cluster.clearLayers();
    cluster.addLayers(show);
    const rm = drawn.mtn && state.places.find((x) => x.id === drawn.mtn);
    if (rm && !matches(rm)) clearRoute();
  }

  // ── 목록 ──
  const listEl = $('#list');
  const summaryEl = $('#summary');

  function currentList() {
    const origin = state.me || (() => { const c = map.getCenter(); return { lat: c.lat, lon: c.lng }; })();
    const bounds = map.getBounds();
    let arr = state.places.filter(matches);
    if (!state.q) arr = arr.filter((p) => bounds.contains([p.lat, p.lon]));
    return arr.map((p) => ({ p, d: dist(origin, p) })).sort((a, b) => a.d - b.d);
  }

  function renderSummary(arr) {
    if (state.me) {
      const near = Object.fromEntries(Object.keys(CAT).map((c) => [c, 0]));
      for (const p of state.places) if (matches(p) && dist(state.me, p) <= NEAR_KM) near[p.cat]++;
      const parts = Object.keys(CAT).filter((c) => state.cats.has(c) && near[c]).map((c) => `${CAT[c].short} <strong>${near[c]}</strong>곳`);
      const total = Object.values(near).reduce((a, b) => a + b, 0);
      summaryEl.innerHTML = total
        ? `내 위치 ${NEAR_KM}km 안에 ${parts.join(' · ')}`
        : `내 위치 ${NEAR_KM}km 안에는 아직 없어요. 가까운 순으로 보여 드릴게요.`;
    } else if (state.q) {
      summaryEl.innerHTML = `“${esc(state.q)}” 검색 결과 <strong>${arr.length}</strong>곳`;
    } else {
      summaryEl.innerHTML = `지도에 보이는 숲 <strong>${arr.length}</strong>곳 · 지도를 움직이면 목록이 바뀌어요`;
    }
  }

  function renderList() {
    const arr = currentList();
    renderSummary(arr);
    const recs = state.me ? recsHtml() : '';
    if (!arr.length) {
      listEl.innerHTML = recs + `<li class="empty">${state.q ? '검색 결과가 없어요. 다른 이름이나 지역으로 찾아보세요.' : '이 지역에는 표시할 숲이 없어요. 지도를 축소하거나 옮겨 보세요.'}</li>`;
      return;
    }
    const showDist = !!state.me;
    const html = arr.slice(0, state.limit).map(({ p, d }) => {
      const meta = [];
      if (p.cat === 'bf') meta.push(`데크길 ${fmtLen(p.len)}`, `${p.year}년 조성`);
      if (p.cat === 'kid') { if (p.period) meta.push(`운영 ${p.period}`); if (p.approx) meta.push('<span class="badge warn">대략 위치</span>'); }
      if (p.cat === 'rec') meta.push(p.stay ? '숙박 가능' : '당일 이용', p.own);
      if (p.cat === 'mtn') {
        const ks = p.courses.map((c) => c.km);
        const easy = p.courses.filter((c) => c.level === 'easy').length;
        const lo = Math.min(...ks), hi = Math.max(...ks);
        meta.push(`코스 ${p.courses.length}개`, lo === hi ? `${lo}km` : `${lo}~${hi}km`);
        if (easy) meta.push(`쉬운 코스 ${easy}개`);
      } else if (hasCourses(p)) {
        const total = Math.round(p.courses.reduce((s, c) => s + c.km, 0));
        meta.push(p.courses.length > 1 ? `${p.courses.length}개 구간` : '한 줄기 전 구간', `총 약 ${total}km`);
        if (p.src) meta.push(p.src);
      }
      if (p.addr) meta.push(esc(p.addr));
      return `<li class="item${state.sel === p.id ? ' on' : ''}" data-id="${p.id}" tabindex="0" role="button" aria-label="${esc(CAT[p.cat].label)} ${esc(p.name)}${showDist ? ', ' + fmtKm(d) : ''}">
        <i class="dot ${p.cat}"></i><h3>${esc(p.name)}</h3>${showDist ? `<span class="dist">${fmtKm(d)}</span>` : '<span></span>'}
        <div class="meta">${meta.map((m) => `<span>${m.startsWith('<') ? m : esc(m)}</span>`).join('')}</div>
      </li>`;
    }).join('');
    const more = arr.length > state.limit ? `<li><button class="more" type="button" id="more">${arr.length - state.limit}곳 더 보기</button></li>` : '';
    const head = recs ? `<li class="list-head">가까운 숲 · 장소</li>` : '';
    listEl.innerHTML = recs + head + html + more;
  }

  function renderAll() { refreshMarkers(); renderList(); }

  // ── 선택 ──
  const panel = $('#panel');
  const mobile = () => matchMedia('(max-width: 760px)').matches;

  function select(id, fromList) {
    const prev = state.sel && markers.get(state.sel);
    if (prev) { const pp = state.places.find((x) => x.id === state.sel); prev.setIcon(icon(pp, false)); prev.setZIndexOffset(0); }
    state.sel = id;
    if (!id) { history.replaceState(null, '', location.pathname); renderList(); return; }
    const p = state.places.find((x) => x.id === id);
    const m = markers.get(id);
    m.setIcon(icon(p, true));
    m.setZIndexOffset(900);
    history.replaceState(null, '', `#p=${id}`);
    if (fromList) {
      if (mobile()) setSheet('min');
      const open = () => cluster.zoomToShowLayer(m, () => m.openPopup());
      if (map.getZoom() < 13) { map.once('moveend', open); map.setView([p.lat, p.lon], 13); } else open();
    }
    listEl.querySelectorAll('.item.on').forEach((el) => el.classList.remove('on'));
    const el = listEl.querySelector(`[data-id="${id}"]`);
    if (el) { el.classList.add('on'); if (!fromList) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }

  listEl.addEventListener('click', (e) => {
    if (e.target.closest('#more')) { state.limit += PAGE; renderList(); return; }
    if (e.target.closest('.more-recs')) { state.recLimit += 10; renderList(); return; }
    const sortBtn = e.target.closest('[data-sort]');
    if (sortBtn) { state.recSort = sortBtn.dataset.sort; state.recLimit = 5; renderList(); return; }
    const rec = e.target.closest('.rcm');
    if (rec) { showRoute(rec.dataset.pid, rec.dataset.cid, { include: state.me ? [state.me.lat, state.me.lon] : null }); return; }
    const li = e.target.closest('.item'); if (li) select(li.dataset.id, true);
  });
  listEl.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('item')) { e.preventDefault(); select(e.target.dataset.id, true); }
  });

  // ── 컨트롤 ──
  const stayWrap = $('#stayWrap');
  const easyWrap = $('#easyWrap');
  $('#chips').addEventListener('change', (e) => {
    const v = e.target.value; if (!v) return;
    e.target.checked ? state.cats.add(v) : state.cats.delete(v);
    stayWrap.hidden = !state.cats.has('rec');
    easyWrap.hidden = !['mtn', 'trail', 'ridge'].some((c) => state.cats.has(c));
    state.limit = PAGE; renderAll();
  });
  $('#stayOnly').addEventListener('change', (e) => { state.stayOnly = e.target.checked; state.limit = PAGE; renderAll(); });
  $('#easyOnly').addEventListener('change', (e) => { state.easyOnly = e.target.checked; state.limit = PAGE; renderAll(); });

  let qTimer;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      state.q = e.target.value.trim().toLowerCase(); state.limit = PAGE; renderAll();
      if (state.q) {
        const hits = state.places.filter(matches);
        if (hits.length) map.fitBounds(L.latLngBounds(hits.map((p) => [p.lat, p.lon])).pad(0.15), { maxZoom: 13 });
      }
    }, 250);
  });

  let moveTimer;
  map.on('moveend', () => { clearTimeout(moveTimer); moveTimer = setTimeout(() => { if (!state.q) { state.limit = PAGE; renderList(); } }, 120); });

  // ── 내 위치 ──
  const btnLocate = $('#btnLocate');
  btnLocate.addEventListener('click', () => {
    if (!navigator.geolocation) { summaryEl.textContent = '이 브라우저에서는 위치를 확인할 수 없어요. 검색이나 지도 이동으로 찾아보세요.'; return; }
    btnLocate.classList.add('busy'); btnLocate.querySelector('span').textContent = '위치 확인 중…';
    navigator.geolocation.getCurrentPosition((pos) => {
      btnLocate.classList.remove('busy');
      setMe(pos.coords.latitude, pos.coords.longitude, '내 위치');
    }, (err) => {
      btnLocate.classList.remove('busy'); btnLocate.querySelector('span').textContent = '내 주변 숲 찾기';
      summaryEl.textContent = err.code === 1 ? '위치 권한이 꺼져 있어요. 브라우저 설정에서 허용하거나, 검색으로 찾아보세요.' : '위치를 가져오지 못했어요. 잠시 후 다시 시도해 주세요.';
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  });

  // 위치가 정해지면: 내 위치 표시 → 추천 코스 목록 → 가장 가까운 코스를 지도에 바로 띄움
  function setMe(lat, lon, label) {
    state.me = { lat, lon };
    if (meMarker) meMarker.remove();
    meMarker = L.marker([lat, lon], { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }), title: label, zIndexOffset: 1000 })
      .bindTooltip(label, { direction: 'bottom', offset: [0, 12], permanent: true, className: 'me-label' }).addTo(map);
    btnLocate.querySelector('span').textContent = '내 위치 다시 찾기';
    state.limit = PAGE; state.recLimit = 5; state.recSort = 'near';
    if (mobile()) setSheet('mid');
    const { nearest } = nearbyCourses();
    if (nearest && nearest.d <= 10) {
      showRoute(nearest.p.id, nearest.c.id, { include: [lat, lon], keepSheet: true });
    } else {
      map.setView([lat, lon], 12);
    }
    renderList();
    listEl.scrollTop = 0;
  }

  // ── 모바일 바텀시트 ──
  function setSheet(mode) {
    panel.classList.remove('min', 'max');
    if (mode !== 'mid') panel.classList.add(mode);
    setTimeout(() => map.invalidateSize(), 280);
  }
  const grip = $('#grip');
  let dragY = null;
  grip.addEventListener('pointerdown', (e) => { dragY = e.clientY; grip.setPointerCapture(e.pointerId); });
  grip.addEventListener('pointerup', (e) => {
    if (dragY === null) return;
    const dy = e.clientY - dragY; dragY = null;
    const cur = panel.classList.contains('max') ? 'max' : panel.classList.contains('min') ? 'min' : 'mid';
    if (Math.abs(dy) < 8) setSheet(cur === 'min' ? 'mid' : cur === 'mid' ? 'max' : 'min');
    else if (dy < 0) setSheet(cur === 'min' ? 'mid' : 'max');
    else setSheet(cur === 'max' ? 'mid' : 'min');
  });

  // ── 시작 ──
  fetch('data/places.json?v=' + VER)
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(({ meta, places }) => {
      state.places = places;
      for (const c of Object.keys(CAT)) {
        const n = places.filter((p) => p.cat === c).length;
        const b = document.querySelector(`[data-count="${c}"]`); if (b) b.textContent = n;
      }
      $('#sources').innerHTML = meta.sources.map((s) =>
        `<li><i class="dot ${s.cat}"></i> <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a> · 기준 ${esc(s.ref)} · 공공데이터포털</li>`).join('');
      buildMarkers();
      renderAll();
      // ?near=위도,경도 : 그 지점을 기준 위치로 (시연·공유용)
      const near = (new URLSearchParams(location.search).get('near') || '').split(',').map(Number);
      if (near.length === 2 && near.every(Number.isFinite)) { setMe(near[0], near[1], '기준 위치'); return; }
      const m = location.hash.match(/^#p=(\w+)/);
      if (m && markers.has(m[1])) select(m[1], true);
    })
    .catch(() => { summaryEl.textContent = '데이터를 불러오지 못했어요. 새로고침해 주세요.'; });
})();
