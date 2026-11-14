// 홈(index.html) SPA 의 #/checklist 화면. 결혼 준비 시기별 항목 · 항목마다 일정 · 연결된 할 일 (wedding-timeline 에서 옮겨 옴)
// 항목 일정은 사용자가 직접 정한 날(date)만 씀. 본식일로 자동 계산해 채우지 않음
// 순서는 state.items 배열 순서 = 사용자가 정한 순서. 날짜로 다시 정렬하지 않음 ('순서 편집' 팝업에서 끌어서 바꿈)
// 로그인 사용자만 씀. 계정(Supabase checklists)에만 저장하고 브라우저에는 따로 두지 않음 (account.js)
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const TIPS_MAX = 1000; // 항목 메모 글자 수
  const todayIso = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
  const fmt = (iso) => iso.replaceAll('-', '.');

  // 기본 할 일을 나중에 바꾸면 여기에 한 줄 추가. 이미 쓰던 체크리스트에 한 번만 반영 (state.v 로 기록해 지운 할 일을 되살리지 않음)
  // rename: 기존 할 일 이름 → 새 이름 (메모가 비어 있으면 기본 메모도 채움) · add: 항목 제목 → 없으면 덧붙일 할 일 · remove: 뺄 할 일 이름 · title: 항목 제목 → 새 제목 · dropTips: 뺄 기본 메모 줄
  // move: 할 일 이름 → 옮길 항목 제목 (완료·메모 유지, 그 항목이 없으면 제자리) · retip: 기본 메모 줄 → 새 줄 · addItems: 없으면 같은 시기 끝(없으면 맨 뒤)에 붙일 기본 항목 제목
  // addTips: 항목 제목 → 없으면 덧붙일 기본 메모 줄 · phase: 항목 제목 → 옮길 시기 (그 시기 마지막 항목 뒤로) · removeItems: 뺄 기본 항목 제목 (날짜나 끝낸 할 일이 있으면 남김)
  const UPGRADES = [
    { rename: { '헬퍼비·수고비 현금 봉투 준비': '사례비 봉투 준비' },
      add: { 결혼식: ['결혼반지', '가방순이용 식권', '청심환', '신랑 긴양말', '아빠들 긴양말', '2부 의상', '포토테이블 사진', '사례비 봉투 챙기기', '식권'] } },
    { remove: ['체크리스트 확인하며 준비하기'] },
    { split: { '스튜디오·드레스·메이크업(스드메) 계약': ['스튜디오 선택', '드레스샵 투어 예약', '메이크업샵 선택'] } },
    { title: { '스튜디오 웨딩촬영': '웨딩촬영' } },
    { dropTips: ['원하는 사진을 캡처해 당일 작가님께 보여주기. PPT로 만들어가는 커플도 많음'] },
    { title: { '스튜디오 계약': '스튜디오 선택', '드레스샵 계약': '드레스샵 투어 예약', '메이크업샵 계약': '메이크업샵 선택' } },
    { remove: ['드레스 투어 예약', '드레스 투어 동행인 섭외', '드레스샵 선택', '메이크업샵 선택'], add: { '드레스샵 투어 예약': ['드레스 투어 동행인 섭외'] } },
    { remove: ['스드메 측에 본식 날짜 전달', '본식 당일용 체크리스트 만들기', '사회자 포함 여부 확인'],
      rename: { '웨딩 밴드 투어': '결혼반지 투어', '웨딩 밴드 구매': '결혼반지 구매', '주례·사회자에게 공유': '주례·사회자·축가자에게 공유' },
      move: { '혼수 비용 분담 논의': '혼수 리스트 작성 (가전·가구)', '잔금·서류 처리': '신혼집 인테리어/입주 준비', '입주 일정 확정': '신혼집 계약 마무리' },
      add: { '본식스냅·DVD·아이폰스냅 계약': ['식전영상 포함 여부 확인'], '드레스샵 투어 예약': ['드레스샵 리스트업·투어 예약'], '메이크업샵 선택': ['메이크업샵 비교·계약'], '신혼집 계약 마무리': ['계약서 작성·계약금 납부'] },
      title: { '주례·사회자·축가자 식순 공유': '주례·사회자·축가자 사전 점검' },
      dropTips: ['최소 2개월 전에는 청모·발송해야 하니 이때 제작하면 여유로움'],
      retip: { '본식스냅이 없으면 아이폰스냅·DVD 계약과 원판 촬영이 어려워 필수': '본식스냅 없는 경우, 아이폰스냅이나 DVD 계약 시 공유하고 괜찮은지 확인 필요',
        '예약 전에 마음에 드는 곳을 예식일에 워크인으로 둘러보고 추리는 방법을 많이 씀': '예약 전에 마음에 드는 곳을 다른 본식이 열리는 날 워크인으로 둘러보고 추리는 방법을 많이 씀' },
      addItems: ['본식 이후 정리'] },
    { rename: { '모임통장·결혼 준비용 카드 개설': '모임통장 또는 결혼 준비용 카드 개설', '웨딩홀 리스트업·암행투어': '웨딩홀 리스트업', '웨딩홀 투어 예약': '웨딩홀 상담 예약' },
      remove: ['신혼여행 환전·짐 싸기'],
      add: { '예산 & 하객 수 정하기': ['한도 제한 풀기'], '본식 드레스 셀렉': ['2부 의상 준비 (대여/구매)'] },
      addTips: { '드레스샵 투어 예약': ['드레스샵마다 2부 의상 대여·할인 혜택을 주는 곳이 있으니 투어 때 확인하기'] },
      phase: { '신혼여행 준비물 체크': 'D-7일' } },
    { add: { '웨딩홀 계약 & 날짜 확정': ['폐백 여부 정하기 (하면 폐백실·수모 포함 여부 확인)'], '본식 사회자·축가자 확정': ['가방순이 섭외'] } },
    { title: { '웨딩플래너 결정 or 셀프 준비': '웨딩플래너·셀프 준비 결정', '예산 & 하객 수 정하기': '예산·하객 수 정하기', '웨딩홀 리서치 & 투어 시작': '웨딩홀 리서치·투어 시작', '웨딩홀 계약 & 날짜 확정': '웨딩홀 계약·날짜 확정', '웨딩박람회 or 플래너 통해 스드메 정보 수집': '웨딩박람회·플래너 통해 스드메 정보 수집', '예물/예단 논의 시작': '예물·예단 논의 시작', '신혼집 인테리어/입주 준비': '신혼집 인테리어·입주 준비', '청첩장 모임, 발송 시작': '청첩장 모임·발송 시작', '사회자 멘트 & 식순 확정': '사회자 멘트·식순 확정' },
      move: { '집주인에게 이사 예정 알리기 (자취 중이면)': '신혼집 계약 마무리' } },
    { rename: { '식전영상 포함 여부 확인': '식전 영상 포함 여부 확인', '가전 견적 비교 (성지·대명장)': '가전 견적 비교', '헤메샵 이미지 상담 요청': '메이크업샵 이미지 상담 요청', '모바일 청첩장 발송 (혼주/신랑신부 버전)': '모바일 청첩장 발송 (혼주/신랑·신부 버전)', '소품·부케 챙기기': '소품 챙기기', '스드메 날짜 확정': '촬영 날짜 확정' },
      add: { '드레스샵 투어 예약': ['드레스 투어·드레스샵 계약'], '본식 사회자·축가자 확정': ['주례·축사자 섭외 (하는 경우)'], '사회자 멘트·식순 확정': ['사회자 멘트(대본) 받아 검토'], '웨딩홀 최종 점검': ['포토테이블 사진 고르기·인화'], 결혼식: ['부케 수령 (당일 아침)'] },
      title: { '신부관리 (피부·다이어트 집중)': '신부 관리 (피부·다이어트 집중)' },
      dropTips: ['설치 후 불량 체크 꼭 하기'],
      addItems: ['혼주 한복 맞춤·가봉'] },
    { removeItems: ['웨딩박람회·플래너 통해 스드메 정보 수집'],
      title: { '양가 상견례': '상견례', '본식스냅·DVD·아이폰스냅 계약': '스냅 계약', '혼수 리스트 작성 (가전·가구)': '혼수 리스트 작성', '혼수 계약 (가전·가구)': '혼수 계약' } },
  ];
  const defaultMemo = new Map(DEFAULT_PHASES.flatMap(([, , , items]) => items.flatMap(([, checks]) => checks.map((c) => [].concat(c)))));
  const newCheck = (text) => ({ id: uid(), text, memo: defaultMemo.get(text) || '', done: false });
  const defaultItem = new Map(DEFAULT_PHASES.flatMap(([, , , items]) => items.map(([title, checks, tips]) => [title, { texts: checks.map((c) => [].concat(c)[0]), tips }])));
  // split: 기존 항목 → 기본 항목 여러 개. 할 일은 기본 위치로 나뉘고, 직접 추가한 할 일은 첫 항목에 남음. 시기·날짜는 기존 항목 것을 그대로 씀
  const splitItem = (it, titles) => {
    const owner = (c) => titles.find((t) => defaultItem.get(t).texts.includes(c.text)) ?? titles[0];
    return titles.map((title, i) => ({ ...it, id: i ? uid() : it.id, title, tips: defaultItem.get(title).tips, checks: it.checks.filter((c) => owner(c) === title) }));
  };
  const freshItem = (phase, months, days, [title, checks, tips]) => ({
    id: uid(), phase, months, days, title, tips, date: '',
    checks: checks.map((c) => { const [text, memo = ''] = [].concat(c); return { id: uid(), text, memo, done: false }; }),
  });
  const defaultFull = new Map(DEFAULT_PHASES.flatMap(([phase, months, days, items]) => items.map((item) => [item[0], () => freshItem(phase, months, days, item)])));
  // move: 할 일을 빼서 모아 둔 뒤 대상 항목 끝에 붙임. 대상 항목을 사용자가 지웠으면 원래 자리에 둠
  function moveChecks(items, move) {
    const titles = new Set(items.map((it) => it.title));
    const goes = (c) => titles.has(move[c.text]);
    const moving = items.flatMap((it) => it.checks.filter(goes));
    return items.map((it) => {
      const kept = it.checks.filter((c) => !goes(c));
      const have = new Set(kept.map((c) => c.text));
      return { ...it, checks: [...kept, ...moving.filter((c) => move[c.text] === it.title && !have.has(c.text))] };
    });
  }
  function movePhase(items, phase) {
    return Object.entries(phase).reduce((list, [title, to]) => {
      const it = list.find((x) => x.title === title);
      const target = DEFAULT_PHASES.find(([p]) => p === to);
      if (!it || !target || it.phase === to) return list;
      const rest = list.filter((x) => x !== it);
      const at = rest.findLastIndex((x) => x.phase === to) + 1 || rest.length;
      return [...rest.slice(0, at), { ...it, phase: to, months: target[1], days: target[2] }, ...rest.slice(at)];
    }, items);
  }
  function upgradeStep(items, { rename = {}, add = {}, remove = [], split = {}, title = {}, dropTips = [], move = {}, retip = {}, addItems = [], addTips = {}, phase = {}, removeItems = [] }) {
    // 뺄 기본 항목은 날짜를 정했거나 끝낸 할 일이 있으면 사용자가 쓰던 것이라 남김
    const next = items.filter((it) => !(removeItems.includes(it.title) && !it.date && !it.checks.some((c) => c.done))).flatMap((it) => (split[it.title] ? splitItem(it, split[it.title]) : [it])).map((it) => {
      const checks = it.checks.filter((c) => !remove.includes(c.text)).map((c) => (rename[c.text] ? { ...c, text: rename[c.text], memo: c.memo || defaultMemo.get(rename[c.text]) || '' } : c));
      const have = new Set(checks.map((c) => c.text));
      return { ...it, title: title[it.title] || it.title, tips: [...it.tips.filter((t) => !dropTips.includes(t)).map((t) => retip[t] || t), ...(addTips[it.title] || []).filter((t) => !it.tips.includes(t))], checks: [...checks, ...(add[it.title] || []).filter((t) => !have.has(t)).map(newCheck)] };
    });
    const moved = movePhase(moveChecks(next, move), phase);
    const titles = new Set(moved.map((it) => it.title));
    // 새 기본 항목은 같은 시기 마지막 항목 뒤에, 그 시기가 없으면 맨 뒤에
    return addItems.filter((t) => !titles.has(t)).map((t) => defaultFull.get(t)()).reduce((list, it) => {
      const at = list.findLastIndex((x) => x.phase === it.phase) + 1 || list.length;
      return [...list.slice(0, at), it, ...list.slice(at)];
    }, moved);
  }
  function upgrade(s) {
    return { ...s, items: UPGRADES.slice(s.v || 0).reduce(upgradeStep, s.items), v: UPGRADES.length };
  }

  const freshState = () => ({
    v: UPGRADES.length,
    wedding: '',
    items: DEFAULT_PHASES.flatMap(([phase, months, days, items]) => items.map((item) => freshItem(phase, months, days, item))),
  });

  const current = (s) => ((s.v || 0) < UPGRADES.length ? upgrade(s) : s);

  // 로그인해야 씀. 계정에서 불러오기 전(비로그인 포함)에는 null (account.js 가 checklistSync.load 로 채움)
  let state = null;
  let mode = 'items'; // items: 항목별, checks: 할 일만
  let hideDone = false;

  // 고칠 때마다 계정에 저장 (account.js 가 1초 모아 올림)
  function save() {
    window.pushChecklist?.(state);
  }

  // 일정: date 시작일, end 끝나는 날(하루면 ''). 칸 값은 'YYYY-MM-DD ~ YYYY-MM-DD'
  // '웨딩촬영' 항목: 직접 정한 날짜가 없으면 시안의 촬영 날짜(home-cal.js shootInfo)를 씀.
  // 여기서 날짜를 고치면 지금 연 시안에도 넣을지 물어봄 (app.js setShootDate)
  const SHOOT_TITLE = '웨딩촬영';
  const shootOf = (it) => (it.title === SHOOT_TITLE && !it.date && window.shootInfo?.()) || null;
  const dated = (it) => { const sh = shootOf(it); return sh ? { ...it, date: sh.date, end: '' } : it; };
  const dateOf = (it) => dated(it).date;
  const rangeVal = (it) => (it.end ? `${it.date} ~ ${it.end}` : it.date);
  const whenText = (raw, from = 2) => {
    const it = dated(raw);
    return it.date ? fmt(it.date).slice(from) + (it.end ? ` ~ ${fmt(it.end).slice(it.end.slice(0, 4) === it.date.slice(0, 4) ? 5 : 2)}` : '') : '';
  };
  const byId = (id) => state.items.find((it) => it.id === id);
  const doneCount = (it) => it.checks.filter((c) => c.done).length;
  // 항목 상태: 케밥 메뉴에서 정한 status(done 완료 / doing 진행중)가 먼저, 없으면 할 일을 다 끝냈는지로
  const isItemDone = (it) => it.status === 'done' || (it.status !== 'doing' && it.checks.length > 0 && doneCount(it) === it.checks.length);

  function renderHero() {
    $('cl-wedding').value = state.wedding;
    const diff = state.wedding ? Math.round((Date.parse(state.wedding) - Date.parse(todayIso())) / 86400000) : null;
    $('cl-dday').textContent = diff === null ? '' : diff > 0 ? `D-${diff}` : diff === 0 ? 'D-Day' : `D+${-diff}`;
    // 진행률은 항목 기준. 케밥 메뉴의 완료 표시와 할 일을 다 끝낸 항목을 함께 셈 (isItemDone)
    const all = state.items;
    const done = all.filter(isItemDone).length;
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
    const allDone = isItemDone(it);
    const when = whenText(it);
    const checks = hideDone ? it.checks.filter((c) => !c.done) : it.checks;
    const toggle = (k, label) => `<button type="button" data-ik="${k}">${it.status === k ? `${label} 취소` : label}</button>`;
    return `<details class="cl-item${allDone ? ' done' : ''}" data-id="${it.id}"${open ? ' open' : ''}>
      <summary><span class="cl-title">${esc(it.title)}</span>${when ? `<span class="cl-when">${when}</span>` : ''}<span class="note">${n} / ${it.checks.length}</span>
        <button type="button" class="iconbtn cl-kebab" popovertarget="im-${it.id}" aria-label="${esc(it.title)} 메뉴">${KEBAB_ICON}</button>
        <nav class="help my-menu" id="im-${it.id}" popover aria-label="항목 메뉴">${toggle('done', '완료')}${toggle('doing', '진행중')}<button type="button" data-ik="rename">이름 수정</button><button type="button" data-ik="rm">삭제</button></nav></summary>
      <div class="cl-sched">
        <label>일정 <input class="in" type="text" readonly data-pick="range" placeholder="날짜·기간 선택" size="23" data-k="date" value="${rangeVal(dated(it))}"></label>
      </div>
      <ul class="cl-checks">${checks.map((c) => checkHtml(c)).join('')}</ul>
      <form class="cl-add"><input class="in" name="text" placeholder="할 일 추가" aria-label="추가할 할 일" maxlength="100"><button class="btn pill">추가</button></form>
      <div class="cl-tips">${it.tips.length ? `<ul>${it.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}<button type="button" class="cl-from" data-tips>${it.tips.length ? '메모 수정' : '메모 추가'}</button></div>
    </details>`;
  }

  // 시기가 시작하는 날: 본식일에서 months 개월·days 일 전. 그 달에 같은 날이 없으면 말일 (3.31 의 1개월 전 → 2.28)
  const phaseStart = (wedding, months, days) => {
    const [y, m, d] = wedding.split('-').map(Number);
    const last = new Date(y, m - 1 - months + 1, 0).getDate();
    const t = new Date(y, m - 1 - months, Math.min(d, last) - days);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  };

  // 날짜를 정한 항목은 그 날짜가 들어가는 시기에 보여 줌 (저장된 phase 는 그대로라 날짜를 지우면 원래 자리로).
  // D-12개월보다 이르면 D-12개월, 본식 하루 뒤~1주 안은 D-DAY, 그 뒤는 D+1주. 본식일이 없으면 원래 시기
  const phaseFor = (it, starts) => {
    const d = state.wedding && dateOf(it);
    if (!d) return it.phase;
    return (starts.findLast(([, s]) => s <= d) || starts[0])[0];
  };

  function renderItems() {
    const starts = state.wedding ? DEFAULT_PHASES.map(([p, months, days]) => [p, phaseStart(state.wedding, months, days)]) : [];
    const groups = new Map(DEFAULT_PHASES.map(([p]) => [p, []]));
    state.items.forEach((it) => { const p = phaseFor(it, starts); groups.set(p, [...(groups.get(p) || []), it]); });
    const startOf = new Map(starts);
    return [...groups].filter(([, items]) => items.length).map(([p, items]) => {
      const start = startOf.has(p) ? `<small>${fmt(startOf.get(p)).slice(2)}</small>` : '';
      return `<section class="cl-phase"><h2>${esc(p)}${start}</h2>${items.map((it) => itemHtml(it, false)).join('')}</section>`;
    }).join('');
  }

  // 할 일만: 항목 순서대로 이어 붙이고, 어느 항목의 할 일인지 옆에 표시 (누르면 그 항목으로)
  function renderChecks() {
    const rows = state.items.flatMap((it) => it.checks
      .filter((c) => !(hideDone && c.done))
      .map((c) => checkHtml(c, `<button type="button" class="cl-from" data-go="${it.id}">${esc(it.title)}${dateOf(it) ? ` · ${whenText(it, 5)}` : ''}</button>`)));
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
    phaseStart, // 홈 '다음 할 일' 이 지금 시기를 고를 때 (home-cal.js)
    // 마이페이지에서 결혼 예정 날짜를 고치면 본식일도 같이 (account.js)
    setWedding: (d) => {
      if (!state || state.wedding === d) return;
      state.wedding = d;
      save();
      if (document.body.dataset.view === 'checklist') window.renderChecklist();
    },
    // 계정에서 받아 온 값으로 채움. 계정에 없으면(처음 쓰는 사람) 기본 항목
    load: (s) => {
      state = s && Array.isArray(s.items) ? current(s) : freshState();
      if (document.body.dataset.view === 'checklist') window.renderChecklist();
    },
  };

  window.renderChecklist = () => {
    if (!state) return; // 계정에서 불러오기 전. 비로그인이면 안내 문구만 보임 (style.css .cl-guest)
    // 로그인했고 마이페이지에 결혼 예정 날짜가 있으면 그게 기준 (profile 은 account.js). 본식일을 고치면 거기도 저장됨
    if (typeof profile !== 'undefined' && profile?.wedding_date) state.wedding = profile.wedding_date;
    renderHero();
    renderList();
  };

  $('cl-wedding').addEventListener('change', (e) => {
    state.wedding = e.target.value;
    save();
    window.saveWeddingDate?.(state.wedding); // account.js. 로그인했으면 마이페이지 결혼 예정 날짜도 같이
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
      [it.date, it.end = ''] = e.target.value.split(' ~ ');
      if (it.title === SHOOT_TITLE && it.date && window.shootDate?.() !== it.date
        && confirm(`웨딩촬영 시안에서도 촬영 날짜를 ${fmt(it.date)}로 수정할까요?`)) window.setShootDate(it.date);
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
    // 항목 케밥 메뉴: 완료·진행중(다시 누르면 취소) · 이름 수정 · 삭제
    const ik = e.target.closest('[data-ik]');
    if (ik) {
      ik.closest('.my-menu').hidePopover();
      const el = ik.closest('.cl-item');
      const it = byId(el.dataset.id);
      const k = ik.dataset.ik;
      if (k === 'rm') {
        if (!confirm(`'${it.title}' 항목을 할 일까지 모두 지울까요?`)) return;
        state.items = state.items.filter((x) => x !== it);
        save();
        renderHero();
        return renderList();
      }
      if (k === 'rename') {
        const input = prompt('항목 이름 (100자까지)', it.title);
        const v = input?.trim().slice(0, 100);
        if (!v) return; // 취소했거나 비웠으면 그대로
        it.title = v;
      } else it.status = it.status === k ? '' : k;
      return changed(el);
    }
    // 할 일 케밥 메뉴. 입력 창을 띄우기 전에 메뉴부터 닫음
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
      <span>${esc(it.title)}</span>${dateOf(it) ? `<span class="note">${whenText(it)}</span>` : ''}</li>`).join('')}</ol>`).join('');
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
