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

  function events() {
    let cl = {};
    try { cl = JSON.parse(localStorage.getItem('posil-checklist-v1')) || {}; } catch { /* 체크리스트를 아직 안 열었으면 없음 */ }
    const list = [];
    const wedding = cl.wedding || (typeof profile !== 'undefined' && profile?.wedding_date) || '';
    if (wedding) list.push({ date: wedding, title: '예식', kind: 'wedding', go: 'checklist' });
    const b = state.basic; // 지금 시안 (app.js)
    if (b.date) {
      const times = [['메이크업', state.makeup.start], [state.studio.kind, state.studio.start]].filter(([, t]) => t).map(([k, t]) => `${k} ${t}`);
      list.push({ date: b.date, title: '웨딩촬영', sub: times.join(' · '), kind: 'shoot', go: 'edit' });
    }
    (cl.items || []).filter((it) => it.date).forEach((it) => list.push({ date: it.date, title: it.title, kind: 'todo', go: 'checklist' }));
    return list.sort((a, c) => a.date.localeCompare(c.date));
  }

  function render() {
    const { y, m } = view;
    const all = events();
    const month = all.filter((e) => e.date.startsWith(`${y}-${pad(m + 1)}-`));
    const today = isoOf(now.getFullYear(), now.getMonth(), now.getDate());
    let cells = WEEK.split('').map((w) => `<i>${w}</i>`).join('') + '<span></span>'.repeat(new Date(y, m, 1).getDay());
    for (let d = 1, last = new Date(y, m + 1, 0).getDate(); d <= last; d++) {
      const v = isoOf(y, m, d);
      const kinds = [...new Set(month.filter((e) => e.date === v).map((e) => e.kind))];
      cells += `<span class="${v === today ? 'today' : ''}">${d}${kinds.length ? `<b>${kinds.map((k) => `<em class="${k}"></em>`).join('')}</b>` : ''}</span>`;
    }
    const rows = month.map((e) => {
      const [, mm, dd] = e.date.split('-').map(Number);
      const w = WEEK[new Date(y, mm - 1, dd).getDay()];
      return `<li><button type="button" data-view="${e.go}"><span class="hc-d">${mm}.${dd} (${w})</span><em class="${e.kind}"></em><span class="hc-t">${esc(e.title)}${e.sub ? `<small>${esc(e.sub)}</small>` : ''}</span></button></li>`;
    }).join('');
    const empty = all.length
      ? '이번 달에는 일정이 없어요.'
      : '체크리스트에 날짜를 정하거나 시안에 촬영 날짜를 넣으면 여기에 보여요.';
    el.innerHTML = `<h2>내 일정</h2><div class="hc-body">
      <div class="cal">
        <div class="cal-h"><button type="button" data-step="-1" aria-label="이전 달">${CHEV_L}</button><span class="cal-t">${y}년 ${m + 1}월</span><button type="button" data-step="1" aria-label="다음 달">${CHEV_R}</button></div>
        <div class="cal-g days">${cells}</div>
      </div>
      ${rows ? `<ul class="hc-list">${rows}</ul>` : `<p class="note hc-empty">${empty}</p>`}
    </div>`;
  }

  el.addEventListener('click', (e) => {
    const s = e.target.closest('[data-step]');
    if (!s) return; // 일정 줄은 data-view 버튼이라 app.js 의 화면 이동이 처리함
    const t = new Date(view.y, view.m + Number(s.dataset.step), 1);
    view = { y: t.getFullYear(), m: t.getMonth() };
    render();
  });

  window.renderHomeCal = render;
})();
