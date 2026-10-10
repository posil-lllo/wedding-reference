// 날짜 하나를 고르는 달력. 브라우저 기본 달력 대신 화면 톤에 맞춘 것. 오늘 이전 날짜는 고를 수 없음
function datePicker(btn, panel, onChange = () => {}) {
  const WEEK = '일월화수목금토';
  const pad = (n) => String(n).padStart(2, '0');
  const isoOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const now = new Date();
  const today = isoOf(now.getFullYear(), now.getMonth(), now.getDate());
  const placeholder = btn.textContent;
  let value = '';
  let view = { y: now.getFullYear(), m: now.getMonth() };

  const label = () => {
    if (!value) return placeholder;
    const [y, m, d] = value.split('-').map(Number);
    return `${y}년 ${m}월 ${d}일 (${WEEK[new Date(y, m - 1, d).getDay()]})`;
  };
  const showValue = () => {
    btn.textContent = label();
    btn.classList.toggle('empty', !value);
  };
  const render = () => {
    const { y, m } = view;
    let cells = '<span></span>'.repeat(new Date(y, m, 1).getDay());
    for (let d = 1, last = new Date(y, m + 1, 0).getDate(); d <= last; d++) {
      const v = isoOf(y, m, d);
      cells += `<button type="button" data-d="${v}"${v < today ? ' disabled' : ''}${v === today ? ' class="today"' : ''} aria-pressed="${v === value}">${d}</button>`;
    }
    panel.innerHTML = `<div class="cal-h"><button type="button" data-m="-1" aria-label="이전 달">‹</button><b>${y}년 ${m + 1}월</b><button type="button" data-m="1" aria-label="다음 달">›</button></div>`
      + `<div class="cal-g">${[...WEEK].map((w) => `<i>${w}</i>`).join('')}${cells}</div>`
      + '<button type="button" class="cal-clear" data-d="">선택 안 함</button>';
  };
  const toggle = (open) => {
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) render();
  };

  btn.addEventListener('click', () => toggle(panel.hidden));
  panel.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.m) {
      const d = new Date(view.y, view.m + Number(t.dataset.m), 1);
      view = { y: d.getFullYear(), m: d.getMonth() };
      return render();
    }
    value = t.dataset.d;
    showValue();
    toggle(false);
    onChange(value);
  });

  return {
    get value() { return value; },
    set value(v) {
      value = v || '';
      if (value) view = { y: Number(value.slice(0, 4)), m: Number(value.slice(5, 7)) - 1 };
      showValue();
      toggle(false);
      onChange(value);
    },
  };
}
