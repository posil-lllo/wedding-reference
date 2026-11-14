// 결혼 예정일 달력. 날짜와 오차(미정 / 정확한 날짜 / ±1개월 / ±3개월)를 함께 고르고 완료를 눌러야 반영됨
// 제목을 누르면 연도, 월 순서로 고를 수 있음. 오늘 이전은 고를 수 없음. 화면 전환은 onToggle(open), 완료 뒤 처리는 onDone(value) 을 받는 쪽이 함
const chev = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const CHEV_L = chev('M15 6l-6 6 6 6');
const CHEV_R = chev('M9 6l6 6-6 6');
// 공휴일 이름 (홈 달력·날짜 팝업 공용). 양력은 고정, 설날·추석(앞뒤 하루 포함)·부처님오신날은 브라우저 내장 단기(음력) 달력으로 계산
// ponytail: 대체공휴일·선거일은 안 넣음. 필요하면 공공데이터포털 특일 정보 API 로
const SOLAR = { '01-01': '신정', '03-01': '삼일절', '05-05': '어린이날', '06-06': '현충일', '08-15': '광복절', '10-03': '개천절', '10-09': '한글날', '12-25': '성탄절' };
const LUNAR = { '1-1': '설날', '8-15': '추석' };
const lunarFmt = new Intl.DateTimeFormat('ko-KR-u-ca-dangi', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Seoul' });
const lunarOf = (y, m, d) => { const p = lunarFmt.formatToParts(new Date(Date.UTC(y, m, d, 3))); return `${p.find((x) => x.type === 'month').value}-${p.find((x) => x.type === 'day').value}`; };
const holidayOf = (y, m, d) => SOLAR[`${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`]
  || (lunarOf(y, m, d) === '4-8' && '부처님오신날')
  || [0, 1, -1].map((k) => LUNAR[lunarOf(y, m, d + k)]).find(Boolean) || '';

function datePicker(btn, panel, { onToggle = () => {}, onDone = () => {} } = {}) {
  const WEEK = '일월화수목금토';
  const RANGES = [['', '미정'], ['0', '정확한 날짜'], ['1', '±1개월'], ['3', '±3개월']];
  const NONE = { date: '', range: null }; // range: 오차(개월), 0 은 정확한 날짜, 날짜가 없으면 null
  const pad = (n) => String(n).padStart(2, '0');
  const isoOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const parse = (iso) => iso.split('-').map(Number);
  // n 달 뒤 같은 날. 그 달에 없는 날(31일 등)이면 그 달 마지막 날
  const addMonths = (iso, n) => {
    const [y, m, d] = parse(iso);
    const first = new Date(y, m - 1 + n, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    return isoOf(first.getFullYear(), first.getMonth(), Math.min(d, last));
  };
  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth();
  const today = isoOf(thisYear, thisMonth, now.getDate());
  const placeholder = btn.textContent;
  let value = NONE; // 완료로 확정된 값
  let draft = NONE; // 달력에서 고르는 중인 값
  let view = { y: thisYear, m: thisMonth };
  let mode = 'day'; // day: 날짜, year: 연도 12개, month: 월 12개

  const label = () => {
    if (!value.date) return placeholder;
    const [y, m, d] = parse(value.date);
    return `${y}년 ${m}월 ${d}일 (${WEEK[new Date(y, m - 1, d).getDay()]})${value.range ? ` ±${value.range}개월` : ''}`;
  };
  const showValue = () => {
    btn.textContent = label();
    btn.classList.toggle('empty', !value.date);
  };
  const cell = (data, text, { off = false, on = false, cls = '' } = {}) =>
    `<button type="button" ${data}${off ? ' disabled' : ''}${cls ? ` class="${cls}"` : ''} aria-pressed="${on}">${text}</button>`;
  const head = (title, step, unit, prevOff) =>
    `<div class="cal-h"><button type="button" data-step="-${step}" aria-label="이전 ${unit}"${prevOff ? ' disabled' : ''}>${CHEV_L}</button>`
    + `${title}<button type="button" data-step="${step}" aria-label="다음 ${unit}">${CHEV_R}</button></div>`;
  const grids = {
    day: ({ y, m }) => {
      const { date, range } = draft;
      const back = date && range ? addMonths(date, -range) : '';
      const [from, to] = back ? [back < today ? today : back, addMonths(date, range)] : []; // 범위는 오늘부터
      let cells = WEEK.split('').map((w) => `<i>${w}</i>`).join('') + '<span></span>'.repeat(new Date(y, m, 1).getDay());
      for (let d = 1, last = new Date(y, m + 1, 0).getDate(); d <= last; d++) {
        const v = isoOf(y, m, d);
        const cls = [v === today && 'today', from && v >= from && v <= to && 'in-range',
          v === from && 'range-start', v === to && 'range-end'].filter(Boolean).join(' ');
        const hol = holidayOf(y, m, d);
        cells += cell(`data-d="${v}"${hol ? ` title="${hol}"` : ''}`, hol ? `${d}<small>${hol}</small>` : d, { off: v < today, on: v === date, cls: [cls, hol && 'hol'].filter(Boolean).join(' ') });
      }
      const title = `<button type="button" class="cal-t" data-mode="year">${y}년 ${m + 1}월</button>`;
      return head(title, 1, '달', y * 12 + m <= thisYear * 12 + thisMonth) + `<div class="cal-g days">${cells}</div>`;
    },
    year: ({ y }) => {
      const start = thisYear + Math.floor((y - thisYear) / 12) * 12;
      const cells = Array.from({ length: 12 }, (_, i) => cell(`data-y="${start + i}"`, start + i, { on: start + i === y })).join('');
      return head(`<b class="cal-t">${start} - ${start + 11}</b>`, 12, '연도', start <= thisYear) + `<div class="cal-g wide">${cells}</div>`;
    },
    month: ({ y, m }) => {
      const cells = Array.from({ length: 12 }, (_, i) => cell(`data-m="${i}"`, `${i + 1}월`, { off: y === thisYear && i < thisMonth, on: i === m })).join('');
      return head(`<button type="button" class="cal-t" data-mode="year">${y}년</button>`, 1, '해', y <= thisYear) + `<div class="cal-g wide">${cells}</div>`;
    },
  };
  const render = () => {
    const picked = draft.range === null ? '' : String(draft.range);
    const tags = RANGES.map(([r, text]) => cell(`data-r="${r}"`, text, { on: r === picked })).join('');
    panel.innerHTML = grids[mode](view)
      + `<div class="pills cal-r" role="group" aria-label="날짜 정확도">${tags}</div>`
      + '<button type="button" class="btn cal-done" data-done>완료</button>';
  };
  const open = () => {
    draft = value.date ? value : { date: '', range: 0 }; // 아직 안 정했으면 '정확한 날짜'가 골라진 채로 열림
    mode = 'day';
    view = draft.date ? { y: parse(draft.date)[0], m: parse(draft.date)[1] - 1 } : { y: thisYear, m: thisMonth };
    render();
    btn.setAttribute('aria-expanded', 'true');
    onToggle(true);
    panel.querySelector('.cal-t').focus();
  };
  const close = () => {
    btn.setAttribute('aria-expanded', 'false');
    onToggle(false);
  };

  btn.addEventListener('click', open);
  panel.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || t.disabled) return;
    const ds = t.dataset;
    let focus = '.cal-t';
    if ('done' in ds) {
      value = draft.date ? draft : NONE;
      showValue();
      close();
      btn.focus();
      return onDone(value);
    }
    if (ds.step) {
      const n = Number(ds.step);
      const d = mode === 'day' ? new Date(view.y, view.m + n, 1) : new Date(view.y + n, view.m, 1);
      view = { y: d.getFullYear(), m: d.getMonth() };
    } else if (ds.mode) {
      mode = ds.mode;
    } else if (ds.y) {
      view = { y: Number(ds.y), m: view.m };
      mode = 'month';
    } else if (ds.m) {
      view = { y: view.y, m: Number(ds.m) };
      mode = 'day';
    } else if (ds.d) {
      draft = { date: ds.d, range: draft.range ?? 0 }; // 미정이었으면 정확한 날짜로
      focus = `[data-d="${ds.d}"]`;
    } else if ('r' in ds) {
      draft = ds.r === '' ? NONE : { date: draft.date, range: Number(ds.r) };
      focus = `[data-r="${ds.r}"]`;
    }
    render();
    panel.querySelector(focus)?.focus();
  });

  return {
    get value() { return value; },
    set value(v) {
      value = v?.date ? { date: v.date, range: v.range ?? 0 } : NONE;
      showValue();
      close();
    },
  };
}

// 날짜·시간 칸 공용 팝업. <input data-pick="date|range|time" readonly> 를 누르면 열림 (체크리스트 본식일·일정, 시안 촬영 날짜·시간)
// 값은 기본 입력과 같은 YYYY-MM-DD / HH:MM 이고, range 는 두 번 눌러 'YYYY-MM-DD ~ YYYY-MM-DD' (같은 날이거나 하나만 고르고 닫으면 YYYY-MM-DD).
// 고르면 고르면 input·change 이벤트를 보내 기존 저장 코드가 그대로 받음
// 넓은 화면은 칸 아래 카드, 좁은 화면은 아래에서 올라오는 시트 (위치는 CSS 가 --x/--y 로 잡음)
(() => {
  const WEEK = '일월화수목금토';
  const pad = (n) => String(n).padStart(2, '0');
  const isoOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const pop = document.createElement('div');
  pop.className = 'cal pick';
  pop.popover = 'auto';
  pop.setAttribute('role', 'dialog');
  document.body.append(pop);
  let input = null;
  let view = { y: 0, m: 0 };
  let mode = 'day'; // day / year / month / time
  let from = null; // range: 먼저 고른 날. 끝나는 날을 고르는 중

  const btn = (data, text, on = false, cls = '') =>
    `<button type="button" ${data}${cls ? ` class="${cls}"` : ''} aria-pressed="${on}">${text}</button>`;
  const head = (title, step, unit) => `<div class="cal-h"><button type="button" data-step="-${step}" aria-label="이전 ${unit}">${CHEV_L}</button>`
    + `${title}<button type="button" data-step="${step}" aria-label="다음 ${unit}">${CHEV_R}</button></div>`;
  const foot = (left, right) => `<div class="cal-f">${left}${right}</div>`;
  const now = new Date();
  const today = isoOf(now.getFullYear(), now.getMonth(), now.getDate());

  const views = {
    day: ({ y, m }) => {
      const isRange = input.dataset.pick === 'range';
      const [a, b = a] = from ? [from] : isRange ? input.value.split(' ~ ') : [input.value];
      let cells = WEEK.split('').map((w) => `<i>${w}</i>`).join('') + '<span></span>'.repeat(new Date(y, m, 1).getDay());
      for (let d = 1, last = new Date(y, m + 1, 0).getDate(); d <= last; d++) {
        const v = isoOf(y, m, d);
        const cls = [v === today && 'today', a !== b && v >= a && v <= b && 'in-range', a !== b && v === a && 'range-start', a !== b && v === b && 'range-end'];
        const hol = holidayOf(y, m, d);
        cells += btn(`data-d="${v}"${hol ? ` title="${hol}"` : ''}`, hol ? `${d}<small>${hol}</small>` : d, v === a || v === b, [...cls, hol && 'hol'].filter(Boolean).join(' '));
      }
      return head(`<button type="button" class="cal-t" data-mode="year">${y}년 ${m + 1}월</button>`, 1, '달')
        + `<div class="cal-g days">${cells}</div>`
        + (isRange ? `<p class="cal-l" aria-live="polite">${from ? '종료 날짜를 고르세요. 하루만이면 확인을 누르세요' : '기간이면 시작 날짜와 종료 날짜를 차례로 고르세요'}</p>` : '')
        + foot('<button type="button" class="cal-x" data-d="">초기화</button>', '<button type="button" class="cal-x cal-ok" data-close>확인</button>');
    },
    year: ({ y }) => {
      const start = y - (((y % 12) + 12) % 12);
      const cells = Array.from({ length: 12 }, (_, i) => btn(`data-y="${start + i}"`, start + i, start + i === y)).join('');
      return head(`<b class="cal-t">${start} - ${start + 11}</b>`, 12, '연도') + `<div class="cal-g wide">${cells}</div>`;
    },
    month: ({ y, m }) => {
      const cells = Array.from({ length: 12 }, (_, i) => btn(`data-m="${i}"`, `${i + 1}월`, i === m)).join('');
      return head(`<button type="button" class="cal-t" data-mode="year">${y}년</button>`, 1, '해') + `<div class="cal-g wide">${cells}</div>`;
    },
    time: () => {
      const [h, min] = input.value ? input.value.split(':').map(Number) : [null, null];
      const pm = h !== null && h >= 12;
      const ampm = ['오전', '오후'].map((t, i) => btn(`data-ap="${i}"`, t, h !== null && pm === !!i)).join('');
      const hours = Array.from({ length: 12 }, (_, i) => btn(`data-h="${i + 1}"`, i + 1, h !== null && (h % 12 || 12) === i + 1)).join('');
      const mins = Array.from({ length: 12 }, (_, i) => btn(`data-min="${i * 5}"`, pad(i * 5), min === i * 5)).join('');
      return `<div class="cal-h"><b class="cal-t">${input.value ? `${pm ? '오후' : '오전'} ${h % 12 || 12}:${pad(min)}` : '시간 선택'}</b></div>`
        + `<div class="cal-ap" role="group" aria-label="오전 오후">${ampm}</div>`
        + `<p class="cal-l">시</p><div class="cal-g quad">${hours}</div>`
        + `<p class="cal-l">분</p><div class="cal-g quad">${mins}</div>`
        + foot('<button type="button" class="cal-x" data-clear>초기화</button>', '<button type="button" class="cal-x cal-ok" data-close>완료</button>');
    },
  };
  const render = (focus) => {
    pop.innerHTML = views[mode](view);
    (pop.querySelector(focus || '[aria-pressed="true"]') || pop.querySelector('.cal-t, button')).focus();
  };
  const set = (v) => {
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const close = () => pop.hidePopover(); // 포커스는 아래 toggle 에서 돌려줌
  // 값이 바뀌면 체크리스트가 항목을 다시 그려 칸이 새 요소가 됨. 그때 같은 칸을 다시 찾는 선택자
  const keyOf = (el) => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.dataset.path) return `[data-path="${CSS.escape(el.dataset.path)}"]`;
    const id = el.closest('[data-id]')?.dataset.id;
    return id && el.dataset.k ? `[data-id="${CSS.escape(id)}"] [data-k="${CSS.escape(el.dataset.k)}"]` : null;
  };
  let key = null;

  const open = (el) => {
    input = el;
    key = keyOf(el);
    from = null;
    mode = el.dataset.pick === 'time' ? 'time' : 'day';
    const [y, m] = (el.value || today).slice(0, 10).split('-').map(Number);
    view = { y, m: m - 1 };
    pop.setAttribute('aria-label', el.dataset.pick === 'time' ? '시간 선택' : '날짜 선택');
    pop.innerHTML = views[mode](view);
    pop.showPopover();
    // 칸 아래에 두고, 아래가 모자라면 위로. 오른쪽 끝을 넘지 않게
    const r = el.getBoundingClientRect();
    const { width: w, height: h } = pop.getBoundingClientRect();
    pop.style.setProperty('--x', `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`);
    pop.style.setProperty('--y', `${r.bottom + 6 + h > innerHeight && r.top - 6 - h > 0 ? r.top - 6 - h : r.bottom + 6}px`);
    render();
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('input[data-pick]');
    if (el && !el.disabled) open(el);
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.matches?.('input[data-pick]') && ['Enter', ' ', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      open(e.target);
    }
  });
  // 페이지가 스크롤되면 칸과 떨어지므로 닫음 (시트 모양일 때는 그대로)
  addEventListener('scroll', (e) => {
    if (pop.matches(':popover-open') && !pop.contains(e.target) && matchMedia('(min-width: 561px)').matches) pop.hidePopover();
  }, true);

  // 시작일만 고르고 닫으면 그날 하루로
  // Esc·바깥 클릭으로 닫혀도 연 칸으로 포커스를 돌려줌. 바깥의 다른 칸을 눌러 닫았으면 그 칸을 둠
  pop.addEventListener('toggle', (e) => {
    if (e.newState !== 'closed') return;
    if (from) { set(from); from = null; }
    const a = document.activeElement;
    if (a && a !== document.body && !pop.contains(a)) return;
    const el = input.isConnected ? input : key && document.querySelector(key);
    el?.focus({ preventScroll: true });
  });

  pop.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const ds = t.dataset;
    if ('d' in ds && input.dataset.pick === 'range' && ds.d) {
      if (!from) return (from = ds.d), render(`[data-d="${ds.d}"]`);
      const [a, b] = [from, ds.d].sort();
      from = null;
      return set(a === b ? a : `${a} ~ ${b}`), close();
    }
    if ('d' in ds) return set(ds.d), close();
    if ('close' in ds) return close();
    if ('clear' in ds) return set(''), close();
    if (ds.step) {
      const n = Number(ds.step);
      const d = mode === 'day' ? new Date(view.y, view.m + n, 1) : new Date(view.y + n, view.m, 1);
      view = { y: d.getFullYear(), m: d.getMonth() };
      return render(`[data-step="${ds.step}"]`);
    }
    if (ds.mode) mode = ds.mode;
    else if (ds.y) { view = { y: Number(ds.y), m: view.m }; mode = 'month'; }
    else if (ds.m) { view = { y: view.y, m: Number(ds.m) }; mode = 'day'; }
    else if (mode === 'time') {
      // 시를 먼저 고르면 분은 00, 오전·오후는 지금 값을 따름. 분까지 고르면 닫힘
      const [h, min] = input.value ? input.value.split(':').map(Number) : [9, 0];
      const pm = 'ap' in ds ? ds.ap === '1' : h >= 12;
      const h12 = ds.h ? Number(ds.h) % 12 : h % 12;
      set(`${pad(h12 + (pm ? 12 : 0))}:${pad(ds.min ? Number(ds.min) : min)}`);
      if (ds.min) return close();
    }
    render();
  });
})();
