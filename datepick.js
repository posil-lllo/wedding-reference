// 결혼 예정일 달력. 날짜와 오차(미정 / 정확한 날짜 / ±1개월 / ±3개월)를 함께 고르고 완료를 눌러야 반영됨
// 제목을 누르면 연도, 월 순서로 고를 수 있음. 오늘 이전은 고를 수 없음. 화면 전환은 onToggle(open) 을 받는 쪽이 함
function datePicker(btn, panel, { onToggle = () => {} } = {}) {
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
    `<div class="cal-h"><button type="button" data-step="-${step}" aria-label="이전 ${unit}"${prevOff ? ' disabled' : ''}>‹</button>`
    + `${title}<button type="button" data-step="${step}" aria-label="다음 ${unit}">›</button></div>`;
  const grids = {
    day: ({ y, m }) => {
      const { date, range } = draft;
      const [from, to] = date && range ? [addMonths(date, -range), addMonths(date, range)] : [];
      let cells = WEEK.split('').map((w) => `<i>${w}</i>`).join('') + '<span></span>'.repeat(new Date(y, m, 1).getDay());
      for (let d = 1, last = new Date(y, m + 1, 0).getDate(); d <= last; d++) {
        const v = isoOf(y, m, d);
        const cls = [v === today && 'today', from && v >= from && v <= to && 'in-range'].filter(Boolean).join(' ');
        cells += cell(`data-d="${v}"`, d, { off: v < today, on: v === date, cls });
      }
      const title = `<button type="button" class="cal-t" data-mode="year">${y}년 ${m + 1}월</button>`;
      return head(title, 1, '달', y * 12 + m <= thisYear * 12 + thisMonth) + `<div class="cal-g">${cells}</div>`;
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
    draft = value;
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
      return btn.focus();
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
