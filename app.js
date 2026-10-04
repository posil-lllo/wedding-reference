// 입력 화면 렌더링, 상태 저장(IndexedDB), 색 설정, 탭 전환
const emptyMu = () => ({ worry: '', want: '', dislike: [], like: [] });
const DEFAULT_STATE = {
  basic: { date: '', groom: '', bride: '' },
  studio: { name: '', total: '토탈', start: '', end: '' },
  makeup: { name: '', teacher: '', link: '', start: '', end: '' },
  mu: { groom: emptyMu(), bride: emptyMu() },
  hair: { groom: [], bride: [] },
  dress: [],
  shots: [],
  pointColor: '#6d93bd',
};
const IMG_W = 900;
const IMG_H = 1200;
const SAVE_DELAY = 400;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const NEW_ITEM = {
  hair: () => ({ id: uid(), img: '', name: '', desc: '' }),
  dress: () => ({ id: uid(), imgs: [], name: '', desc: '' }),
  shots: () => ({ id: uid(), hair: '', place: '', dress: '', dislike: [], like: [] }),
};

// ── 불변 경로 갱신 ──
const toPath = (p) => p.split('.');
const getIn = (obj, path) => toPath(path).reduce((o, k) => o?.[k], obj);
function setIn(obj, [k, ...rest], v) {
  const val = rest.length ? setIn(obj[k], rest, v) : v;
  return Array.isArray(obj) ? obj.map((x, i) => (i === +k ? val : x)) : { ...obj, [k]: val };
}
// 저장본에 없는 필드는 기본값으로 채움 (배열은 저장본 그대로)
const merge = (d, s) => (d && typeof d === 'object' && !Array.isArray(d) && s && typeof s === 'object'
  ? Object.fromEntries(Object.keys(d).map((k) => [k, merge(d[k], s[k])]))
  : s ?? d);

// 목록은 늘 칸 1개 이상 보이게 하고, 빈 칸은 결과·선택지에서 뺌
const LISTS = ['hair.bride', 'hair.groom', 'dress', 'shots'];
const newItem = (list) => NEW_ITEM[list.split('.')[0]]();
const isBlank = (x) => Object.entries(x).every(([k, v]) => k === 'id' || (Array.isArray(v) ? !v.length : !v));
const withOneEach = (s) => LISTS.reduce((acc, p) => (getIn(acc, p).length ? acc : setIn(acc, toPath(p), [newItem(p)])), s);
const withoutBlanks = (s) => LISTS.reduce((acc, p) => setIn(acc, toPath(p), getIn(acc, p).filter((x) => !isBlank(x))), s);

let state = withOneEach(DEFAULT_STATE);
const get = (path) => getIn(state, path);
function update(path, v) {
  state = setIn(state, toPath(path), v);
  scheduleSave();
}

// ── IndexedDB 저장 ──
// iOS Safari 는 앱 전환 뒤 연결이 끊기는 일이 있어, 실패하면 새로 열어 한 번 더 시도
let dbReady = null;
const openDb = () => (dbReady = new Promise((resolve, reject) => {
  const req = indexedDB.open('wedding-ref', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('state');
  req.onsuccess = () => {
    req.result.onclose = () => { dbReady = null; };
    resolve(req.result);
  };
  req.onerror = () => reject(req.error);
}));
const runTx = (mode, fn) => (dbReady || openDb()).then((db) => new Promise((resolve, reject) => {
  const tx = db.transaction('state', mode);
  const req = fn(tx.objectStore('state'));
  tx.oncomplete = () => resolve(req.result);
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
}));
const idb = (mode, fn) => runTx(mode, fn).catch((e) => {
  console.warn('idb retry', e);
  dbReady = null;
  return runTx(mode, fn);
});

const statusEl = document.getElementById('status');
const setStatus = (msg, isErr = false) => {
  statusEl.textContent = msg;
  statusEl.classList.toggle('err', isErr);
  document.getElementById('save-info').hidden = !isErr;
};
let saveTimer;
function scheduleSave() {
  clearTimeout(saveTimer);
  setStatus('저장 중…');
  saveTimer = setTimeout(async () => {
    try {
      await idb('readwrite', (s) => s.put(state, 'current'));
      setStatus('저장됨');
    } catch (e) {
      console.error('save failed', e);
      setStatus(`임시 저장 실패 (${e?.name || e})`, true);
    }
  }, SAVE_DELAY);
}

// ── 사진: 가운데 기준 3:4 로 잘라 JPEG data URL ──
async function toThreeFour(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.max(IMG_W / bmp.width, IMG_H / bmp.height);
  const w = bmp.width * scale;
  const h = bmp.height * scale;
  const canvas = Object.assign(document.createElement('canvas'), { width: IMG_W, height: IMG_H });
  canvas.getContext('2d').drawImage(bmp, (IMG_W - w) / 2, (IMG_H - h) / 2, w, h);
  bmp.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}

async function addImages(input) {
  const files = [...input.files];
  const { imgPath, mode } = input.dataset;
  input.value = '';
  if (!files.length) return;
  setStatus('사진 처리 중…');
  const results = await Promise.allSettled(files.map(toThreeFour));
  const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (ok.length) update(imgPath, mode === 'one' ? ok[0] : [...get(imgPath), ...ok]);
  else setStatus('');
  renderEditor();
  const failed = results.length - ok.length;
  if (failed) alert(`${failed}장은 열 수 없는 형식이라 건너뛰었어요. (HEIC 사진이면 JPG로 바꿔서 올려 주세요)`);
}

// ── 입력 화면 마크업 ──
const input = (path, label, type = 'text', extra = '') =>
  `<label class="f"><span>${label}</span><input class="in" type="${type}" data-path="${path}" value="${esc(get(path))}" ${extra}></label>`;
const area = (path, label) => `<label class="f">${label}<textarea class="in" data-path="${path}">${esc(get(path))}</textarea></label>`;
const bare = (path, ph) => `<input class="in" data-path="${path}" value="${esc(get(path))}" placeholder="${ph}" aria-label="${ph}">`;
const addBtn = (path, one = false) =>
  `<label class="add-img">+<input type="file" accept="image/*" ${one ? 'data-mode="one"' : 'multiple'} data-img-path="${path}" aria-label="사진 추가"></label>`;
const thumb = (src, path, i) =>
  `<div class="thumb"><img src="${src}" alt=""><button class="x" data-rm-img="${path}" ${i === undefined ? '' : `data-i="${i}"`} aria-label="사진 삭제">✕</button></div>`;
const thumbs = (path) => `<div class="thumbs">${get(path).map((src, i) => thumb(src, path, i)).join('')}${addBtn(path)}</div>`;
const drop = (path, kind, label) => `<div class="drop ${kind}"><span class="lbl">${label}</span>${thumbs(path)}</div>`;
const likePair = (base) => `<div class="pair">${drop(`${base}.dislike`, 'dislike', '싫어요 · 여러 장')}${drop(`${base}.like`, 'like', '좋아요 · 여러 장')}</div>`;
const card = (id, no, title, body, note = '') =>
  `<section class="card" id="${id}"><header><span class="no">${no}</span><h2>${title}</h2>${note ? `<span class="note">${note}</span>` : ''}</header>${body}</section>`;
const delBtn = (list, i) => `<button class="del" data-del="${list}" data-i="${i}" aria-label="삭제">✕</button>`;
const option = (value, label, sel) => `<option value="${esc(value)}"${value === sel ? ' selected' : ''}>${esc(label)}</option>`;

const hairOptions = (sel) => '<option value="">선택 안 함</option>' + [['bride', '신부'], ['groom', '신랑']]
  .filter(([side]) => state.hair[side].some((h) => !isBlank(h)))
  .map(([side, label]) => `<optgroup label="${label}">${state.hair[side].filter((h) => !isBlank(h)).map((h) => option(h.id, h.name || '(이름 없음)', sel)).join('')}</optgroup>`)
  .join('');
const dressOptions = (sel) => '<option value="">선택 안 함</option>' + state.dress.filter((d) => !isBlank(d)).map((d) => option(d.id, d.name || '(이름 없음)', sel)).join('');
const OPTIONS = { hair: hairOptions, dress: dressOptions };
const select = (path, label, kind) =>
  `<label class="f">${label}<select class="in" data-path="${path}" data-opts="${kind}">${OPTIONS[kind](get(path))}</select></label>`;

function basicCard() {
  return card('s-basic', 'i', '기본정보', `<div class="grid basic">${input('basic.date', '촬영 날짜', 'date')}${input('basic.groom', '신랑 이름')}${input('basic.bride', '신부 이름')}</div>`);
}

function scheduleCard() {
  const total = get('studio.total');
  const seg = `<div class="f">진행 방식<div class="seg" role="radiogroup" aria-label="진행 방식">${['토탈', '비토탈']
    .map((v) => `<label><input type="radio" name="total" value="${v}" data-path="studio.total"${v === total ? ' checked' : ''}>${v}</label>`).join('')}</div></div>`;
  return card('s-sched', 'ii', '일정', `
    <div class="sub">스튜디오</div>
    <div class="grid sched">${input('studio.name', '스튜디오 이름')}${seg}${input('studio.start', '시작 시간', 'time')}${input('studio.end', '종료 시간', 'time')}</div>
    <div class="sub">메이크업샵</div>
    <div class="grid sched">${input('makeup.name', '메이크업샵 이름')}${input('makeup.teacher', '메이크업 선생님')}${input('makeup.link', '링크 <span class="opt">(선택)</span>', 'url', 'placeholder="https://"')}${input('makeup.start', '시작 시간', 'time')}${input('makeup.end', '종료 시간', 'time')}</div>`);
}

const muCard = (side, no, label) => card(`s-mu-${side}`, no, `메이크업 시안 · ${label}`, `
  <div class="pair">${area(`mu.${side}.worry`, '고민인 부분')}${area(`mu.${side}.want`, '원하는 느낌')}</div>
  ${likePair(`mu.${side}`)}`);

function hairCard(side, no, label) {
  const items = get(`hair.${side}`).map((h, i) => {
    const p = `hair.${side}.${i}`;
    return `<div class="item">
      <div class="thumbs one">${h.img ? thumb(h.img, `${p}.img`) : addBtn(`${p}.img`, true)}</div>
      <div class="fields">${bare(`${p}.name`, '이름')}<textarea class="in" data-path="${p}.desc" placeholder="설명" aria-label="설명">${esc(h.desc)}</textarea></div>
      ${delBtn(`hair.${side}`, i)}</div>`;
  }).join('');
  return card(`s-hair-${side}`, no, `헤어 시안 · ${label}`, `${items}<button class="btn dashed" data-add="hair.${side}">+ 헤어 추가</button>`);
}

function dressCard() {
  const items = state.dress.map((d, i) => `<div class="item wide">
    <div class="fields">${thumbs(`dress.${i}.imgs`)}${bare(`dress.${i}.name`, '이름')}<textarea class="in" data-path="dress.${i}.desc" placeholder="설명" aria-label="설명">${esc(d.desc)}</textarea></div>
    ${delBtn('dress', i)}</div>`).join('');
  return card('s-dress', 'vii', '드레스', `${items}<button class="btn dashed" data-add="dress">+ 드레스 추가</button>`);
}

function shotCard() {
  const items = state.shots.map((_, i) => `<div class="shot">
    <div class="shot-h">컷 ${i + 1} ${delBtn('shots', i)}</div>
    <div class="grid">${select(`shots.${i}.hair`, '헤어 변형', 'hair')}${input(`shots.${i}.place`, '장소')}${select(`shots.${i}.dress`, '드레스', 'dress')}</div>
    ${likePair(`shots.${i}`)}</div>`).join('');
  return card('s-shot', 'viii', '촬영 시안', `${items}<button class="btn dashed" data-add="shots">+ 촬영 시안 추가</button>`);
}

const TOC = [['s-basic', '기본정보'], ['s-sched', '일정'], ['s-mu-bride', '메이크업 · 신부'], ['s-mu-groom', '메이크업 · 신랑'],
  ['s-hair-bride', '헤어 · 신부'], ['s-hair-groom', '헤어 · 신랑'], ['s-dress', '드레스'], ['s-shot', '촬영 시안']];

const editorEl = document.getElementById('editor');
function renderEditor() {
  editorEl.innerHTML = `<nav class="toc" aria-label="섹션">${TOC.map(([id, l]) => `<a href="#${id}">${l}</a>`).join('')}</nav>
  <div class="forms">
    ${basicCard()}${scheduleCard()}
    ${muCard('bride', 'iii', '신부')}${muCard('groom', 'iv', '신랑')}
    ${hairCard('bride', 'v', '신부')}${hairCard('groom', 'vi', '신랑')}
    ${dressCard()}${shotCard()}
    <div style="display:flex;justify-content:space-between;gap:8px"><button class="btn danger" data-reset>전체 지우기</button><button class="btn" data-view="view">시안 완성하기 →</button></div>
  </div>`;
}

// 헤어·드레스 이름이 바뀌면 촬영 시안 선택지만 갱신 (전체를 다시 그리면 입력 포커스가 끊김)
function refreshShotSelects() {
  editorEl.querySelectorAll('select[data-opts]').forEach((sel) => {
    sel.innerHTML = OPTIONS[sel.dataset.opts](get(sel.dataset.path));
  });
}

editorEl.addEventListener('input', (e) => {
  const { path } = e.target.dataset;
  if (!path || e.target.type === 'radio' || e.target.tagName === 'SELECT') return;
  update(path, e.target.value);
  if (/^(hair\.\w+|dress)\.\d+\.name$/.test(path)) refreshShotSelects();
});
editorEl.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.imgPath) return addImages(t);
  if (t.dataset.path && (t.type === 'radio' || t.tagName === 'SELECT')) update(t.dataset.path, t.value);
});
editorEl.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const { add, del, rmImg, i } = b.dataset;
  if (add) {
    update(add, [...get(add), newItem(add)]);
  } else if (del) {
    if (!confirm('이 항목을 삭제할까요?')) return;
    const rest = get(del).filter((_, j) => j !== +i);
    update(del, rest.length ? rest : [newItem(del)]);
  } else if ('reset' in b.dataset) {
    if (!confirm('입력한 내용과 사진을 모두 지울까요?')) return;
    state = withOneEach({ ...DEFAULT_STATE, pointColor: state.pointColor });
  } else if (rmImg) {
    update(rmImg, i === undefined ? '' : get(rmImg).filter((_, j) => j !== +i));
  } else return;
  if ('reset' in b.dataset) scheduleSave();
  renderEditor();
});

// ── 결과 슬라이드 포인트 컬러 (슬라이드에만 적용) ──
const parseHex = (raw) => {
  const v = raw.trim().replace(/^#?/, '#').toLowerCase();
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(v)) return null;
  return v.length === 4 ? '#' + [...v.slice(1)].map((c) => c + c).join('') : v;
};
const pointPicker = document.getElementById('point-color');
const pointHex = document.getElementById('point-hex');
function applyPointColor(c) {
  document.getElementById('deck').style.setProperty('--accent-text', c);
  pointPicker.value = c;
  if (pointHex !== document.activeElement) pointHex.value = c;
}
function setPointColor(c) {
  update('pointColor', c);
  applyPointColor(c);
}
pointPicker.addEventListener('input', () => setPointColor(pointPicker.value));
pointHex.addEventListener('input', () => {
  const hex = parseHex(pointHex.value); // 'fffcef', '#fffcef', 'fc0' 모두 받음
  pointHex.setAttribute('aria-invalid', String(!hex));
  if (hex) setPointColor(hex);
});
document.getElementById('point-reset').addEventListener('click', () => setPointColor(DEFAULT_STATE.pointColor));
pointHex.addEventListener('blur', () => {
  pointHex.value = state.pointColor;
  pointHex.removeAttribute('aria-invalid');
});

// ── 탭 · 결과 ──
const deckEl = document.getElementById('deck');
function show(view) {
  document.getElementById('view-edit').hidden = view !== 'edit';
  document.getElementById('view-view').hidden = view !== 'view';
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === view)));
  if (view === 'view') deckEl.innerHTML = renderDeck(withoutBlanks(state));
  scrollTo(0, 0);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (b) show(b.dataset.view);
});

document.getElementById('pdf').addEventListener('click', async (e) => {
  if (!window.jspdf || !window.html2canvas) {
    alert('PDF 도구를 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.');
    return;
  }
  const btn = e.currentTarget;
  const overlay = document.getElementById('overlay');
  btn.disabled = true;
  overlay.hidden = false;
  try {
    const names = [state.basic.groom, state.basic.bride].filter(Boolean).join('_');
    await exportPdf(deckEl, `웨딩촬영레퍼런스${names ? '_' + names : ''}.pdf`);
  } catch (err) {
    console.error('pdf export failed', err);
    alert('PDF를 만들지 못했어요. 사진 수를 줄이거나 다시 시도해 주세요.');
  } finally {
    btn.disabled = false;
    overlay.hidden = true;
  }
});

// ── 시작 ──
(async () => {
  try {
    const saved = await idb('readonly', (s) => s.get('current'));
    if (saved) state = withOneEach(merge(DEFAULT_STATE, saved));
  } catch (e) {
    console.error('load failed', e);
    setStatus('저장된 내용을 불러오지 못했어요', true);
  }
  applyPointColor(state.pointColor);
  renderEditor();
})();
