// 홈(index.html) SPA 의 #/checklist 화면. 결혼 준비 시기별 항목 · 항목마다 일정 · 연결된 할 일 (wedding-timeline 에서 옮겨 옴)
// 항목 일정은 사용자가 직접 정한 날(date)만 씀. 예식일로 자동 계산해 채우지 않음
// 순서는 state.items 배열 순서 = 사용자가 정한 순서. 날짜로 다시 정렬하지 않음 ('순서 편집' 팝업에서 끌어서 바꿈)
// ponytail: 이 브라우저의 localStorage 에만 저장. 기기를 바꿔도 이어 보려면 로그인 사용자용 Supabase 테이블을 붙일 것
(() => {
  const KEY = 'posil-checklist-v1';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const TIPS_MAX = 1000; // 항목 메모 글자 수
  const todayIso = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
  const fmt = (iso) => iso.replaceAll('-', '.');

  // 기본 할 일을 나중에 바꾸면 여기에 한 줄 추가. 이미 쓰던 체크리스트에 한 번만 반영 (state.v 로 기록해 지운 할 일을 되살리지 않음)
  // rename: 기존 할 일 이름 → 새 이름 (메모가 비어 있으면 기본 메모도 채움) · add: 항목 제목 → 없으면 덧붙일 할 일 · remove: 뺄 할 일 이름
  const UPGRADES = [
    { rename: { '헬퍼비·수고비 현금 봉투 준비': '사례비 봉투 준비' },
      add: { 결혼식: ['결혼반지', '가방순이용 식권', '청심환', '신랑 긴양말', '아빠들 긴양말', '2부 의상', '포토테이블 사진', '사례비 봉투 챙기기', '식권'] } },
    { remove: ['체크리스트 확인하며 준비하기'] },
  ];
  const defaultMemo = new Map(DEFAULT_PHASES.flatMap(([, , , items]) => items.flatMap(([, checks]) => checks.map((c) => [].concat(c)))));
  const newCheck = (text) => ({ id: uid(), text, memo: defaultMemo.get(text) || '', done: false });
  function upgrade(s) {
    const items = UPGRADES.slice(s.v || 0).reduce((items, { rename = {}, add = {}, remove = [] }) => items.map((it) => {
      const checks = it.checks.filter((c) => !remove.includes(c.text)).map((c) => (rename[c.text] ? { ...c, text: rename[c.text], memo: c.memo || defaultMemo.get(rename[c.text]) || '' } : c));
      const have = new Set(checks.map((c) => c.text));
      return { ...it, checks: [...checks, ...(add[it.title] || []).filter((t) => !have.has(t)).map(newCheck)] };
    }), s.items);
    return { ...s, items, v: UPGRADES.length };
  }

  const freshState = () => ({
    v: UPGRADES.length,
    wedding: '',
    items: DEFAULT_PHASES.flatMap(([phase, months, days, items]) => items.map(([title, checks, tips]) => ({
      id: uid(), phase, months, days, title, tips, date: '',
      checks: checks.map((c) => { const [text, memo = ''] = [].concat(c); return { id: uid(), text, memo, done: false }; }),
    }))),
  });

  const current = (s) => ((s.v || 0) < UPGRADES.length ? upgrade(s) : s);
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.items)) return current(s);
    } catch { /* 저장된 값이 없거나 깨졌으면 기본값으로 */ }
    return freshState();
  }

  let state = load();
  store(); // upgrade 결과를 바로 저장. 사용자가 고친 것은 아니라 at 은 그대로
  let mode = 'items'; // items: 항목별, checks: 할 일만
  let hideDone = false;

  // at: 사용자가 마지막으로 고친 시각. 로그인했으면 계정에도 저장하고(account.js), 브라우저와 계정 중 나중에 고친 쪽을 씀
  function save() {
    state = { ...state, at: Date.now() };
    store();
    window.pushChecklist?.(state);
  }
  function store() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      $('cl-err').hidden = true;
    } catch (e) {
      console.error('checklist save failed', e);
      $('cl-err').hidden = false;
    }
  }

  const dateOf = (it) => it.date;
  const byId = (id) => state.items.find((it) => it.id === id);
  const doneCount = (it) => it.checks.filter((c) => c.done).length;

  function renderHero() {
    $('cl-wedding').value = state.wedding;
    const diff = state.wedding ? Math.round((Date.parse(state.wedding) - Date.parse(todayIso())) / 86400000) : null;
    $('cl-dday').textContent = diff === null ? '' : diff > 0 ? `D-${diff}` : diff === 0 ? 'D-Day' : `D+${-diff}`;
    const all = state.items.flatMap((it) => it.checks);
    const done = all.filter((c) => c.done).length;
    const pct = all.length ? Math.round((done / all.length) * 100) : 0;
    $('cl-total').textContent = `${done} / ${all.length} 완료 (${pct}%)`;
    $('cl-bar').style.width = `${pct}%`;
  }

  // 할 일 줄 오른쪽 케밥 메뉴 (마이페이지 시안 메뉴와 같은 my-menu popover. 위치는 account.js 의 beforetoggle 이 잡음)
  // account.js 가 못 떠도 체크리스트는 돌게 아이콘은 따로 둠
  const KEBAB_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5.5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="18.5" r="1.6"/></svg>';
  const checkHtml = (c, meta = '') => `<li data-cid="${c.id}"${c.done ? ' class="on"' : ''}>
    <label><input type="checkbox"${c.done ? ' checked' : ''}><span>${esc(c.text)}</span></label>${meta}
    <button type="button" class="iconbtn cl-kebab" popovertarget="cm-${c.id}" aria-label="${esc(c.text)} 메뉴">${KEBAB_ICON}</button>
    <nav class="help my-menu" id="cm-${c.id}" popover aria-label="할 일 메뉴"><button type="button" data-ck="rename">이름 수정</button><button type="button" data-ck="memo">${c.memo ? '메모 수정' : '메모 추가'}</button><button type="button" data-ck="rm">삭제</button></nav>
    ${c.memo ? `<p class="cl-memo">${esc(c.memo)}</p>` : ''}</li>`;

  function itemHtml(it, open) {
    const n = doneCount(it);
    const allDone = it.checks.length > 0 && n === it.checks.length;
    const d = dateOf(it);
    const checks = hideDone ? it.checks.filter((c) => !c.done) : it.checks;
    return `<details class="cl-item${allDone ? ' done' : ''}" data-id="${it.id}"${open ? ' open' : ''}>
      <summary><span class="cl-title">${esc(it.title)}</span>${d ? `<span class="cl-when">${fmt(d).slice(2)}</span>` : ''}<span class="note">${n} / ${it.checks.length}</span></summary>
      <div class="cl-sched">
        <label>일정 <input class="in" type="text" readonly data-pick="date" placeholder="날짜 선택" data-k="date" value="${d}"></label>
      </div>
      <ul class="cl-checks">${checks.map((c) => checkHtml(c)).join('')}</ul>
      <form class="cl-add"><input class="in" name="text" placeholder="할 일 추가" aria-label="추가할 할 일" maxlength="100"><button class="btn pill">추가</button></form>
      <div class="cl-tips">${it.tips.length ? `<ul>${it.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}<button type="button" class="cl-from" data-tips>${it.tips.length ? '메모 수정' : '메모 추가'}</button></div>
    </details>`;
  }

  function renderItems() {
    const phases = [...new Set(state.items.map((it) => it.phase))];
    return phases.map((p) => {
      const items = state.items.filter((it) => it.phase === p);
      return `<section class="cl-phase"><h2>${esc(p)}</h2>${items.map((it) => itemHtml(it, false)).join('')}</section>`;
    }).join('');
  }

  // 할 일만: 항목 순서대로 이어 붙이고, 어느 항목의 할 일인지 옆에 표시 (누르면 그 항목으로)
  function renderChecks() {
    const rows = state.items.flatMap((it) => it.checks
      .filter((c) => !(hideDone && c.done))
      .map((c) => checkHtml(c, `<button type="button" class="cl-from" data-go="${it.id}">${esc(it.title)}${dateOf(it) ? ` · ${fmt(dateOf(it)).slice(5)}` : ''}</button>`)));
    return rows.length ? `<ul class="cl-checks cl-flat">${rows.join('')}</ul>` : '<p class="note cl-empty">남은 할 일이 없어요.</p>';
  }

  function renderList() {
    document.querySelectorAll('[data-cl-mode]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.clMode === mode)));
    $('cl-list').innerHTML = mode === 'items' ? renderItems() : renderChecks();
  }

  // 항목별 보기에서는 펼친 항목이 접히지 않게 그 항목만 다시 그림
  function changed(el) {
    save();
    renderHero();
    const item = el.closest('.cl-item');
    if (mode === 'items' && item) item.outerHTML = itemHtml(byId(item.dataset.id), item.open);
    else renderList();
  }

  const findCheck = (cid) => {
    for (const it of state.items) {
      const c = it.checks.find((x) => x.id === cid);
      if (c) return [it, c];
    }
    return [];
  };

  // 계정에 저장된 체크리스트 (account.js 가 로그인 확인 뒤 부름)
  window.checklistSync = {
    get: () => state,
    set: (s) => {
      state = current(s);
      store();
      if (document.body.dataset.view === 'checklist') window.renderChecklist();
    },
  };

  window.renderChecklist = () => {
    // 예식일을 아직 안 정했으면 마이페이지에 적은 결혼 예정 날짜로 (profile 은 account.js)
    if (!state.wedding && typeof profile !== 'undefined' && profile?.wedding_date) state.wedding = profile.wedding_date;
    renderHero();
    renderList();
  };

  $('cl-wedding').addEventListener('change', (e) => {
    state.wedding = e.target.value;
    save();
    window.renderChecklist();
  });
  $('cl-hide-done').addEventListener('change', (e) => { hideDone = e.target.checked; renderList(); });
  document.querySelector('#view-checklist [role="tablist"]').addEventListener('click', (e) => {
    const t = e.target.closest('[data-cl-mode]');
    if (!t) return;
    mode = t.dataset.clMode;
    renderList();
  });

  const list = $('cl-list');
  list.addEventListener('change', (e) => {
    if (e.target.dataset.k === 'date') {
      const it = byId(e.target.closest('.cl-item').dataset.id);
      it.date = e.target.value;
      return changed(e.target);
    }
    const li = e.target.closest('[data-cid]');
    if (!li || e.target.type !== 'checkbox') return;
    findCheck(li.dataset.cid)[1].done = e.target.checked;
    changed(li);
  });
  list.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) {
      mode = 'items';
      renderList();
      const el = list.querySelector(`[data-id="${go.dataset.go}"]`);
      el.open = true;
      el.scrollIntoView({ block: 'center' });
      return;
    }
    // 항목 메모: 한 줄이 한 점. 수정 칸으로 바꿔 끼움
    const tips = e.target.closest('[data-tips]');
    if (tips) {
      const it = byId(tips.closest('.cl-item').dataset.id);
      const box = tips.closest('.cl-tips');
      box.innerHTML = `<form class="cl-tips-form"><textarea class="in" name="tips" rows="${Math.max(3, it.tips.length + 1)}" maxlength="${TIPS_MAX}" aria-label="${esc(it.title)} 메모, 한 줄에 하나씩">${esc(it.tips.join('\n'))}</textarea>
        <div class="crop-btns"><button type="button" class="btn soft" data-tips-x>취소</button><button class="btn">저장</button></div></form>`;
      box.querySelector('textarea').focus();
      return;
    }
    const x = e.target.closest('[data-tips-x]');
    if (x) {
      const item = x.closest('.cl-item');
      item.outerHTML = itemHtml(byId(item.dataset.id), true);
      return;
    }
    // 케밥 메뉴. 입력 창을 띄우기 전에 메뉴부터 닫음
    const act = e.target.closest('[data-ck]');
    if (!act) return;
    act.closest('.my-menu').hidePopover();
    const li = act.closest('[data-cid]');
    const [it, c] = findCheck(li.dataset.cid);
    const k = act.dataset.ck;
    if (k === 'rm') {
      if (!confirm(`'${c.text}' 할 일을 지울까요?`)) return;
      it.checks = it.checks.filter((x) => x !== c);
    }
    else {
      const isMemo = k === 'memo';
      const input = prompt(isMemo ? '메모 (200자까지, 비우면 지워요)' : '할 일 이름 (100자까지)', (isMemo ? c.memo : c.text) || '');
      if (input === null) return;
      const v = input.trim().slice(0, isMemo ? 200 : 100);
      if (!isMemo && !v) return; // 이름은 비울 수 없음 (지우려면 삭제)
      it.checks = it.checks.map((x) => (x === c ? { ...x, [isMemo ? 'memo' : 'text']: v } : x));
    }
    changed(li);
  });
  list.addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.target.tips) {
      const it = byId(e.target.closest('.cl-item').dataset.id);
      it.tips = e.target.tips.value.split('\n').map((t) => t.trim()).filter(Boolean);
      return changed(e.target);
    }
    const text = e.target.text.value.trim();
    if (!text) return;
    const it = byId(e.target.closest('.cl-item').dataset.id);
    it.checks = [...it.checks, { id: uid(), text, done: false }];
    changed(e.target);
    list.querySelector(`[data-id="${it.id}"] .cl-add input`).focus(); // 이어서 여러 개 넣기 편하게
  });

  // 순서 편집 팝업: 손잡이를 끌거나(마우스·터치 모두 Pointer Events) 손잡이에서 ↑/↓ 키로 옮김. 놓는 즉시 저장
  const orderDlg = $('cl-order');
  const orderList = $('cl-order-list');
  // 시기는 기본 시기 목록(DEFAULT_PHASES) 그대로 모두 보여 줌. 비어 있는 시기에도 옮겨 넣을 수 있게
  function renderOrder() {
    orderList.innerHTML = DEFAULT_PHASES.map(([p], i) => `<h3>${esc(p)}</h3><ol data-phase="${i}">${state.items.filter((it) => it.phase === p).map((it) => `<li data-id="${it.id}">
      <button type="button" class="cl-grip" aria-label="${esc(it.title)} 옮기기, 위아래 화살표 키로도 옮겨요">⠿</button>
      <span>${esc(it.title)}</span>${dateOf(it) ? `<span class="note">${fmt(dateOf(it)).slice(2)}</span>` : ''}</li>`).join('')}</ol>`).join('');
  }
  // 팝업의 순서·시기를 그대로 저장
  function commitOrder() {
    const items = [...orderList.querySelectorAll('ol')].flatMap((ol) => {
      const [phase, months, days] = DEFAULT_PHASES[ol.dataset.phase];
      return [...ol.children].map((li) => ({ ...byId(li.dataset.id), phase, months, days }));
    });
    state = { ...state, items };
    save();
    renderList();
    // 팝업을 다시 그림 (끌던 손잡이에 포커스 유지)
    const id = document.activeElement?.closest?.('#cl-order-list li')?.dataset.id;
    renderOrder();
    if (id) orderList.querySelector(`[data-id="${id}"] .cl-grip`).focus();
  }
  // 순서·시기만 처음대로. 체크한 내용·추가한 할 일·직접 정한 날은 그대로 둠
  // ponytail: 기본 항목을 제목으로 찾음. 항목 추가 기능이 생기면 항목에 기본 위치 키를 저장할 것
  $('cl-order-reset').addEventListener('click', () => {
    if (!confirm('항목 순서를 처음 상태로 되돌릴까요? 체크한 내용과 일정은 그대로예요.')) return;
    const home = new Map(DEFAULT_PHASES.flatMap(([phase, months, days, items], pi) => items.map(([title], ii) => [title, { pi, ii, phase, months, days }])));
    const pos = (it) => home.get(it.title) ?? { pi: Infinity, ii: 0 }; // 기본에 없는 항목은 맨 뒤, 시기는 그대로
    const items = [...state.items]
      .sort((a, b) => pos(a).pi - pos(b).pi || pos(a).ii - pos(b).ii)
      .map((it) => { const h = home.get(it.title); return h ? { ...it, phase: h.phase, months: h.months, days: h.days } : it; });
    state = { ...state, items };
    save();
    renderList();
    renderOrder();
  });
  $('cl-order-open').addEventListener('click', () => { renderOrder(); orderDlg.showModal(); });
  $('cl-order-x').addEventListener('click', () => orderDlg.close());

  let drag = null; // { li: 끌고 있는 줄 }
  orderList.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('.cl-grip');
    if (!grip) return;
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    drag = { li: grip.closest('li') };
    drag.li.classList.add('dragging');
  });
  orderList.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const box = orderList.getBoundingClientRect(); // 가장자리로 끌면 목록을 굴림
    if (e.clientY < box.top + 40) orderList.scrollTop -= 12;
    else if (e.clientY > box.bottom - 40) orderList.scrollTop += 12;
    // 손가락 위치보다 위에서 시작하는 마지막 시기 목록으로 (시기 제목 높이만큼 여유를 둠)
    const ols = [...orderList.querySelectorAll('ol')];
    const ol = ols.findLast((o) => o.getBoundingClientRect().top - 28 <= e.clientY) || ols[0];
    const next = [...ol.children].find((li) => li !== drag.li && e.clientY < li.getBoundingClientRect().top + li.offsetHeight / 2);
    if (ol !== drag.li.parentElement || next !== drag.li.nextElementSibling) ol.insertBefore(drag.li, next || null);
  });
  const endDrag = () => {
    if (!drag) return;
    drag.li.classList.remove('dragging');
    drag = null;
    commitOrder();
  };
  orderList.addEventListener('pointerup', endDrag);
  orderList.addEventListener('pointercancel', endDrag);
  orderList.addEventListener('keydown', (e) => {
    const grip = e.target.closest('.cl-grip');
    if (!grip || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const li = grip.closest('li');
    const up = e.key === 'ArrowUp';
    const sib = up ? li.previousElementSibling : li.nextElementSibling;
    if (sib) up ? sib.before(li) : sib.after(li);
    else { // 시기의 맨 끝이면 옆 시기로 넘어감
      const ols = [...orderList.querySelectorAll('ol')];
      const to = ols[ols.indexOf(li.parentElement) + (up ? -1 : 1)];
      if (!to) return;
      up ? to.append(li) : to.prepend(li);
    }
    grip.focus();
    commitOrder();
  });

  $('cl-reset').addEventListener('click', () => {
    if (!confirm('일정·체크한 내용·추가한 할 일을 모두 지우고 처음 상태로 되돌릴까요?')) return;
    state = { ...freshState(), wedding: state.wedding };
    save();
    window.renderChecklist();
  });
})();
