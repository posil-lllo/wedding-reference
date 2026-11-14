// 홈의 '내 일정' 달력. 예식일 · 촬영일(지금 시안) · 체크리스트에서 날짜를 정한 항목을 한 달씩 보여 줌
// 일정은 새로 저장하지 않고 각 화면에 저장된 값을 읽기만 함 (체크리스트 localStorage, 시안 state, 마이페이지 profile)
(() => {
  const el = document.getElementById('home-cal');
  const WEEK = '일월화수목금토';
  const pad = (n) => String(n).padStart(2, '0');
  const isoOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = new Date();
  let view = { y: now.getFullYear(), m: now.getMonth() };
  let mode = 'day'; // day / year / month. 제목을 누르면 연도 → 달 순으로 골라 이동 (시안 날짜 팝업과 같은 방식)

  // 촬영 날짜: 지금 연 시안(app.js state, 저장 전 값까지)과 계정의 다른 시안들(account.js draftShoots). 시안 이름·시간은 안 붙임
  const shoots = () => {
    const cur = typeof draftId === 'undefined' ? null : draftId;
    const out = (window.draftShoots?.() || []).filter((d) => d.date && d.id !== cur).map((d) => ({ date: d.date, go: 'my' })); // 다른 시안은 마이페이지 목록에서 고름
    if (state.basic.date) out.push({ date: state.basic.date, go: 'edit' });
    return out.sort((x, y) => x.date.localeCompare(y.date));
  };
  // 체크리스트 위쪽: 오늘 이후 가장 가까운 촬영일, 없으면 가장 최근 것
  window.shootInfo = () => {
    const all = shoots();
    const t = new Date();
    const today = isoOf(t.getFullYear(), t.getMonth(), t.getDate());
    return all.find((s) => s.date >= today) || all.at(-1) || null;
  };

  function events() {
    let cl = {};
    try { cl = JSON.parse(localStorage.getItem('posil-checklist-v1')) || {}; } catch { /* 체크리스트를 아직 안 열었으면 없음 */ }
    const list = [];
    // 예식일은 로그인했으면 마이페이지 결혼 예정 날짜가 기준 (체크리스트 예식일과 서로 맞춰 둠, checklist/app.js · account.js)
    const wedding = (typeof profile !== 'undefined' && profile?.wedding_date) || cl.wedding || '';
    if (wedding) list.push({ date: wedding, title: '예식', kind: 'wedding', go: 'checklist' });
    const sh = shoots();
    sh.forEach((x) => list.push({ ...x, title: '웨딩촬영', kind: 'shoot' }));
    // 체크리스트 '웨딩촬영' 항목이 시안 촬영일과 같은 날이면 겹쳐 넣지 않음 (checklist/app.js shootOf)
    (cl.items || []).filter((it) => it.date && !(it.title === '웨딩촬영' && sh.some((x) => x.date === it.date))).forEach((it) => list.push({ date: it.date, end: it.end || it.date, title: it.title, kind: 'todo', go: 'checklist' }));
    return list.sort((a, c) => a.date.localeCompare(c.date));
  }

  const head = (title, step, unit) => `<div class="cal-h"><button type="button" data-step="-${step}" aria-label="이전 ${unit}">${CHEV_L}</button>`
    + `${title}<button type="button" data-step="${step}" aria-label="다음 ${unit}">${CHEV_R}</button></div>`;
  const pick = (data, text, on) => `<button type="button" ${data} aria-pressed="${on}">${text}</button>`;
  const grids = {
    year: ({ y }) => {
      const start = y - (((y % 12) + 12) % 12);
      return head(`<b class="cal-t">${start} - ${start + 11}</b>`, 12, '연도')
        + `<div class="cal-g wide">${Array.from({ length: 12 }, (_, i) => pick(`data-y="${start + i}"`, start + i, start + i === y)).join('')}</div>`;
    },
    month: ({ y, m }) => head(`<button type="button" class="cal-t" data-mode="year">${y}년</button>`, 1, '해')
      + `<div class="cal-g wide">${Array.from({ length: 12 }, (_, i) => pick(`data-m="${i}"`, `${i + 1}월`, i === m)).join('')}</div>`,
  };

  const NEXT_MAX = 3;
  const row = (e) => {
    const [yy, mm, dd] = e.date.split('-').map(Number); // 기간이 지난달부터 걸치면 시작일은 다른 달·해
    const w = WEEK[new Date(yy, mm - 1, dd).getDay()];
    const year = yy === now.getFullYear() ? '' : `${yy}.`; // 다음 일정은 해가 다를 수 있음
    const until = e.end && e.end !== e.date ? ` ~ ${e.end.split('-').slice(1).map(Number).join('.')}` : '';
    return `<li><button type="button" data-view="${e.go}"><span class="hc-d">${year}${mm}.${dd} (${w})${until}</span><em class="${e.kind}"></em><span class="hc-t">${esc(e.title)}</span></button></li>`;
  };

  function render() {
    const { y, m } = view;
    const all = events();
    const on = (e, v) => e.date <= v && v <= (e.end || e.date); // 기간 일정은 걸친 날마다 점
    const month = all.filter((e) => e.date <= isoOf(y, m, 31) && (e.end || e.date) >= isoOf(y, m, 1));
    const today = isoOf(now.getFullYear(), now.getMonth(), now.getDate());
    let cells = WEEK.split('').map((w) => `<i>${w}</i>`).join('') + '<span></span>'.repeat(new Date(y, m, 1).getDay());
    for (let d = 1, last = new Date(y, m + 1, 0).getDate(); d <= last; d++) {
      const v = isoOf(y, m, d);
      const kinds = [...new Set(month.filter((e) => on(e, v)).map((e) => e.kind))];
      const hol = holidayOf(y, m, d);
      cells += `<span class="${[v === today && 'today', hol && 'hol'].filter(Boolean).join(' ')}">${d}${hol ? `<small>${hol}</small>` : ''}${kinds.length ? `<b>${kinds.map((k) => `<em class="${k}"></em>`).join('')}</b>` : ''}</span>`;
    }
    // 보는 달에 일정이 없으면 오늘 이후 다가오는 일정을 대신 보여 줌
    const upcoming = month.length ? [] : all.filter((e) => (e.end || e.date) >= today).slice(0, NEXT_MAX);
    const rows = (month.length ? month : upcoming).map(row).join('');
    const list = rows ? `${upcoming.length ? '<p class="hc-next">다음 일정</p>' : ''}<ul class="hc-list">${rows}</ul>` : `<p class="note hc-empty">${all.length ? '다가오는 일정이 없어요.' : '체크리스트에 날짜를 정하거나 시안에 촬영 날짜를 넣으면 여기에 보여요.'}</p>`;
    el.innerHTML = `<h2>내 일정</h2><div class="hc-body">
      <div class="cal">
        ${mode === 'day' ? `${head(`<button type="button" class="cal-t" data-mode="year">${y}년 ${m + 1}월</button>`, 1, '달')}
        <div class="cal-g days">${cells}</div>` : grids[mode](view)}
      </div>
      <div>${list}</div>
    </div>`;
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('.cal button');
    if (!b) return; // 일정 줄은 data-view 버튼이라 app.js 의 화면 이동이 처리함
    const { step, mode: to, y, m } = b.dataset;
    let focus = '.cal [aria-pressed="true"]';
    if (step) {
      const n = Number(step);
      const t = mode === 'day' ? new Date(view.y, view.m + n, 1) : new Date(view.y + n, view.m, 1);
      view = { y: t.getFullYear(), m: t.getMonth() };
      focus = `[data-step="${step}"]`;
    } else if (to) mode = to;
    else if (y) { view = { y: Number(y), m: view.m }; mode = 'month'; }
    else if (m) { view = { y: view.y, m: Number(m) }; mode = 'day'; focus = '.cal-t'; }
    else return;
    render();
    (el.querySelector(focus) || el.querySelector('.cal-t')).focus(); // 다시 그려도 키보드 위치 유지
  });

  window.renderHomeCal = render;
})();
