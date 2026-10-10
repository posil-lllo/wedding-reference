// 날짜 하나를 고르는 달력. 제목을 누르면 연도, 월 순서로 고를 수 있음. 오늘 이전은 고를 수 없음
// 달력을 보이고 숨기는 일은 onToggle(open) 을 받는 쪽이 함
function datePicker(btn, panel, { onChange = () => {}, onToggle = () => {} } = {}) {
  const WEEK = '일월화수목금토';
  const pad = (n) => String(n).padStart(2, '0');
  const isoOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth();
  const today = isoOf(thisYear, thisMonth, now.getDate());
  const placeholder = btn.textContent;
  let value = '';
  let view = { y: thisYear, m: thisMonth };
  let mode = 'day'; // day: 날짜, year: 연도 12개, month: 월 12개

  const label = () => {
    if (!value) return placeholder;
    const [y, m, d] = value.split('-').map(Number);
    return `${y}년 ${m}월 ${d}일 (${WEEK[new Date(y, m - 1, d).getDay()]})`;
  };
  const showValue = () => {
    btn.textContent = label();
    btn.classList.toggle('empty', !value);
  };
  const cell = (data, text, { off = false, on = false, cls = '' } = {}) =>
    `<button type="button" ${data}${off ? ' disabled' : ''}${cls ? ` class="${cls}"` : ''} aria-pressed="${on}">${text}</button>`;
  const head = (title, step, unit, prevOff) =>
    `<div class="cal-h"><button type="button" data-step="-${step}" aria-label="이전 ${unit}"${prevOff ? ' disabled' : ''}>‹</button>`
    + `${title}<button type="button" data-step="${step}" aria-label="다음 ${unit}">›</button></div>`;
  const grids = {
    day: ({ y, m }) => {
      let cells = WEEK.split('').map((w) => `<i>${w}</i>`).join('') + '<span></span>'.repeat(new Date(y, m, 1).getDay());
      for (let d = 1, last = new Date(y, m + 1, 0).getDate(); d <= last; d++) {
        const v = isoOf(y, m, d);
        cells += cell(`data-d="${v}"`, d, { off: v < today, on: v === value, cls: v === today ? 'today' : '' });
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
    panel.innerHTML = grids[mode](view)
      + '<div class="cal-f"><button type="button" data-d="">선택 안 함</button><button type="button" data-back>이전으로</button></div>';
  };
  const open = () => {
    mode = 'day';
    view = value ? { y: Number(value.slice(0, 4)), m: Number(value.slice(5, 7)) - 1 } : { y: thisYear, m: thisMonth };
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
    if ('back' in ds) {
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
    } else if ('d' in ds) {
      value = ds.d;
      showValue();
      close();
      onChange(value);
      return btn.focus();
    }
    render();
    panel.querySelector('.cal-t').focus();
  });

  return {
    get value() { return value; },
    set value(v) {
      value = v || '';
      showValue();
      close();
      onChange(value);
    },
  };
}
