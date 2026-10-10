// 입력 화면 렌더링, 상태 저장(IndexedDB), 색 설정, 탭 전환
const emptyMu = () => ({ worry: '', likeDesc: '', dislikeDesc: '', dislike: [], like: [] });
const DEFAULT_STATE = {
  basic: { date: '', groom: '', bride: '' },
  studio: { kind: '스튜디오', name: '', photographer: '', link: '', total: '토탈', start: '', end: '' },
  makeup: { name: '', teacher: '', link: '', start: '', end: '' },
  mu: { groom: emptyMu(), bride: emptyMu() },
  hair: { groom: [], bride: [] },
  dress: [],
  bouquet: [],
  boutonniere: [],
  props: [],
  shots: [],
  pointColor: '#6d93bd',
};
const IMG_W = 900;
const IMG_H = 1200;
const SAVE_DELAY = 400;

// GA4 이벤트. 입력 내용은 보내지 않고 어느 기능을 썼는지만 (경로의 칸 번호도 뺌)
const track = (name, params = {}) => window.gtag?.('event', name, params);
const section = (path) => path.replace(/\.\d+/g, '');

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const NEW_ITEM = {
  hair: () => ({ id: uid(), imgs: [], name: '', desc: '' }),
  dress: () => ({ id: uid(), imgs: [], name: '', desc: '' }),
  bouquet: () => ({ id: uid(), imgs: [], name: '', desc: '' }),
  boutonniere: () => ({ id: uid(), imgs: [], name: '', desc: '' }),
  props: () => ({ id: uid(), imgs: [], name: '', desc: '' }),
  shots: () => ({ id: uid(), name: '', hairBride: '', hairGroom: '', place: '', dress: '', bouquet: '', boutonniere: '', props: [], dislike: [], like: [] }),
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
const LISTS = ['hair.bride', 'hair.groom', 'dress', 'bouquet', 'boutonniere', 'props', 'shots'];
const newItem = (list) => NEW_ITEM[list.split('.')[0]]();
const isBlank = (x) => Object.entries(x).every(([k, v]) => k === 'id' || (Array.isArray(v) ? !v.length : !v));
const withOneEach = (s) => LISTS.reduce((acc, p) => (getIn(acc, p).length ? acc : setIn(acc, toPath(p), [newItem(p)])), s);
const withoutBlanks = (s) => LISTS.reduce((acc, p) => setIn(acc, toPath(p), getIn(acc, p).filter((x) => !isBlank(x))), s);

// 예전 저장본은 헤어 사진이 img 한 장이었음
const hairToImgs = (s) => ({
  ...s,
  hair: Object.fromEntries(Object.entries(s.hair).map(([side, list]) => [side, list.map(({ img, ...h }) => ({ ...h, imgs: h.imgs ?? (img ? [img] : []) }))])),
});

// 예전 저장본의 촬영 시안은 헤어 변형이 신부·신랑 구분 없이 hair 하나였음
const splitShotHair = (s) => ({
  ...s,
  shots: s.shots.map(({ hair, ...x }) => ({
    ...x,
    hairBride: x.hairBride ?? (s.hair.bride.some((h) => h.id === hair) ? hair : ''),
    hairGroom: x.hairGroom ?? (s.hair.groom.some((h) => h.id === hair) ? hair : ''),
  })),
});

// 예전 저장본의 '원하는 느낌'은 좋아요 설명으로 옮김
// merge 전에 적용해야 함 (merge 는 DEFAULT_STATE 에 없는 키를 버림)
const wantToLikeDesc = (s) => (s.mu ? {
  ...s,
  mu: Object.fromEntries(Object.entries(s.mu).map(([side, { want, ...m }]) => [side, { ...m, likeDesc: m.likeDesc || want || '' }])),
} : s);
const restore = (saved) => withOneEach(splitShotHair(hairToImgs(merge(DEFAULT_STATE, wantToLikeDesc(saved)))));

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
    saveTimer = null; // 로그아웃이 남은 저장을 알 수 있게
    try {
      await idb('readwrite', (s) => s.put(state, 'current'));
      await syncDraft(state); // account.js
      setStatus('저장됨');
    } catch (e) {
      console.error('save failed', e);
      setStatus(`임시 저장 실패 (${e?.name || e})`, true);
    }
  }, SAVE_DELAY);
}

// ── 사진: 크롭 창에서 3:4 영역을 골라 JPEG data URL 로 ──
const cropDlg = document.getElementById('crop');
const cropStage = document.getElementById('crop-stage');
const cropCv = document.getElementById('crop-cv');
const cropBox = document.getElementById('crop-box');
const cropCount = document.getElementById('crop-count');
const cropOk = document.getElementById('crop-ok');
const cropX = document.getElementById('crop-x');
const cropSkip = document.getElementById('crop-skip');
const cropPrev = document.getElementById('crop-prev');
const cropForm = cropDlg.querySelector('form');
const cropLoad = document.getElementById('crop-load');
const cropLoadMsg = document.getElementById('crop-load-msg');
const CROP_ABORT = Symbol('abort');
const abortCrop = (e) => {
  e.preventDefault();
  if (!confirm('선택한 사진이 사라집니다. 닫으시겠습니까?')) return;
  cropRun?.abort(); // close 이벤트는 늦게 오므로 그 사이 새로 시작한 실행까지 멈추지 않게 여기서 바로 멈춘다
  cropDlg.close();
};
cropX.addEventListener('click', abortCrop);
cropDlg.addEventListener('cancel', abortCrop);
// 지금 돌고 있는 addImages 의 취소 신호
// ponytail: cancel 없이 브라우저가 바로 닫는 경우(Chrome 의 Esc 연타)는 다음 사진 추가 때 정리된다
let cropRun = null;

function setCropStep(i, n, isLoading, hasPrev = false) {
  cropDlg.classList.toggle('loading', isLoading);
  cropLoad.hidden = !isLoading;
  cropOk.disabled = cropSkip.disabled = isLoading;
  cropPrev.disabled = isLoading || !hasPrev;
  cropPrev.hidden = n < 2;
  cropCount.textContent = n > 1 ? `${i + 1} / ${n}` : '';
  cropOk.textContent = i < n - 1 ? '다음' : '확인';
  cropSkip.hidden = n < 2;
  if (!isLoading) cropOk.focus(); // 로딩 중 비활성화로 잃은 포커스를 돌려준다
}
// 크기 조절 창을 열어 둔 채 로딩만 보여 준다. 사진 크기를 알면 자르기 화면과 같은 크기로, 모르면 직전 사진 영역 크기로
function showCropLoading(i, n, file, size) {
  const { width, height } = size ? stageSize(size.width, size.height) : cropStage.style;
  Object.assign(cropLoad.style, { width, height });
  cropLoadMsg.textContent = isHeic(file) ? 'HEIC 사진 변환 중입니다' : '사진을 불러오는 중입니다';
  setCropStep(i, n, true);
  if (!cropDlg.open) cropDlg.showModal();
}
const CROP_MIN = 48; // 박스 최소 너비(화면 px)
const CROP_PAD = 14; // 박스가 사진에 꽉 차도 모서리 핸들이 보이도록 사진 둘레 여백(px)

// 사진을 화면에 맞추는 배율(f)·크기(dw·dh)와 여백 포함 사진 영역 크기
function stageSize(pw, ph) {
  const f = Math.min((Math.min(innerWidth * 0.8, 360) - 2 * CROP_PAD) / pw, (innerHeight * 0.6) / ph);
  const dw = pw * f;
  const dh = ph * f;
  return { f, dw, dh, width: `${dw + 2 * CROP_PAD}px`, height: `${dh + 2 * CROP_PAD}px` };
}
// 사진 전체를 화면에 맞춰 보여 주고, 그 위 3:4 박스를 옮기거나 모서리로 크기 조절
// 확인이면 자를 영역(사진 크기 대비 0~1 비율), 빼기면 null, 이전이면 CROP_PREV, X·Esc 면 CROP_ABORT
// init 이 있으면(이전으로 돌아온 사진) 그때 박스 위치로 시작
const CROP_PREV = Symbol('prev');
const CROP_GUARD_MS = 400; // 사진이 막 바뀐 직후의 확인은 "다음" 연타로 보고 무시
function cropImage(bmp, i, n, runSignal, hasPrev, init) {
  return new Promise((resolve) => {
    const shownAt = performance.now();
    const { dw, dh, width, height } = stageSize(bmp.width, bmp.height);
    const dpr = devicePixelRatio || 1;
    Object.assign(cropStage.style, { width, height, padding: `${CROP_PAD}px` });
    Object.assign(cropCv, { width: Math.round(dw * dpr), height: Math.round(dh * dpr) });
    cropCv.getContext('2d').drawImage(bmp, 0, 0, cropCv.width, cropCv.height);

    // 처음엔 들어갈 수 있는 가장 큰 3:4 를 가운데에
    let w = init ? init.w * dw : Math.min(dw, (dh * 3) / 4);
    let h = (w * 4) / 3;
    let x = init ? init.x * dw : (dw - w) / 2;
    let y = init ? init.y * dh : (dh - h) / 2;
    const paint = () => Object.assign(cropBox.style, { left: `${x + CROP_PAD}px`, top: `${y + CROP_PAD}px`, width: `${w}px`, height: `${h}px` });

    const ac = new AbortController();
    const { signal } = ac;
    let drag = null;
    const at = (e) => { const r = cropStage.getBoundingClientRect(); return [e.clientX - r.left - CROP_PAD, e.clientY - r.top - CROP_PAD]; };
    cropStage.addEventListener('pointerdown', (e) => {
      const corner = e.target.dataset?.h;
      if (!corner && !cropBox.contains(e.target)) return;
      const [px, py] = at(e);
      const east = corner?.endsWith('e');
      const south = corner?.startsWith('s');
      // 크기 조절은 반대쪽 모서리를 고정점으로
      drag = corner ? { corner, east, south, ax: east ? x : x + w, ay: south ? y : y + h } : { ox: px - x, oy: py - y };
      cropStage.setPointerCapture(e.pointerId);
    }, { signal });
    cropStage.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const [px, py] = at(e);
      if (!drag.corner) {
        x = Math.min(dw - w, Math.max(0, px - drag.ox));
        y = Math.min(dh - h, Math.max(0, py - drag.oy));
      } else {
        const { ax, ay, east, south } = drag;
        const maxW = Math.min(east ? dw - ax : ax, ((south ? dh - ay : ay) * 3) / 4);
        w = Math.min(maxW, Math.max(CROP_MIN, Math.abs(px - ax), (Math.abs(py - ay) * 3) / 4));
        h = (w * 4) / 3;
        x = east ? ax : ax - w;
        y = south ? ay : ay - h;
      }
      paint();
    }, { signal });
    cropStage.addEventListener('pointerup', () => { drag = null; }, { signal });
    cropStage.addEventListener('pointercancel', () => { drag = null; }, { signal });
    // 확인·빼기는 창을 닫지 않는다. 다음 사진을 읽는 동안 같은 창에 로딩을 띄우고, 닫기는 addImages 가 한다
    cropForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (performance.now() - shownAt < CROP_GUARD_MS) return;
      ac.abort();
      cropOk.disabled = cropSkip.disabled = cropPrev.disabled = true; // 다음 사진이 뜰 때까지 이 사진에 대한 버튼은 막는다
      const choice = e.submitter?.value;
      if (choice === 'prev') resolve(CROP_PREV);
      else resolve(choice === 'ok' ? { x: x / dw, y: y / dh, w: w / dw, h: h / dh } : null);
    }, { signal });
    runSignal.addEventListener('abort', () => { ac.abort(); resolve(CROP_ABORT); }, { signal });

    setCropStep(i, n, false, hasPrev);
    paint();
    if (!cropDlg.open) cropDlg.showModal();
  });
}

// 맥·윈도우 Chrome 등은 HEIC 를 못 읽는다. 그때만 변환 라이브러리(약 3MB, 압축 전송)를 받아 읽는다
const HEIC_LIB = './vendor/heic-to.js'; // heic-to@1.5.2 (LGPL-3.0, vendor/heic-to.LICENSE). 외부 CDN 코드가 이 페이지 권한으로 돌지 않게 같은 출처에 둔다
const isHeic = (file) => /^image\/hei[cf]/.test(file.type) || /\.hei[cf]$/i.test(file.name);
let heicLib;
const loadHeic = () => (heicLib ||= import(HEIC_LIB).catch((e) => { heicLib = null; throw e; }));
// 64×64 HEIC (libheif 가 이보다 작은 건 못 읽음). 사진 고르는 동안 이걸로 HEIC 지원 여부를 보고, 못 읽는 브라우저면 라이브러리를 받아 wasm 까지 데워 둔다
const TINY_HEIC = 'data:image/heic;base64,AAAAJGZ0eXBoZWljAAAAAG1pZjFNaVBybWlhZk1pSEJoZWljAAABwm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAADnBpdG0AAAAAAAEAAAA4aWluZgAAAAAAAgAAABVpbmZlAgAAAAABAABodmMxAAAAABVpbmZlAgAAAQACAABFeGlmAAAAABppcmVmAAAAAAAAAA5jZHNjAAIAAQABAAAA5WlwcnAAAADEaXBjbwAAABNjb2xybmNseAACAAIABoAAAAAMY2xsaQDLAEAAAAAUaXNwZQAAAAAAAABAAAAAQAAAAAlpcm90AAAAABBwaXhpAAAAAAMICAgAAABwaHZjQwEDcAAAALAAAAAAAB7wAPz9+PgAAAsDoAABABdAAQwB//8DcAAAAwCwAAADAAADAB5wJKEAAQAiQgEBA3AAAAMAsAAAAwAAAwAeoBQgQcGPiHuRZVNwICBgCKIAAQAJRAHAYXLIQFMkAAAAGWlwbWEAAAAAAAAAAQABBoECA4QFhgAAACxpbG9jAAAAAEQAAAIAAQAAAAEAAAJEAAADGwACAAAAAQAAAfYAAABOAAAAAW1kYXQAAAAAAAADeQAAAAZFeGlmAABNTQAqAAAACAABh2kABAAAAAEAAAAaAAAAAAADoAEAAwAAAAEAAQAAoAIABAAAAAEAAABAoAMABAAAAAEAAABAAAAAAAAAAxcoAa+hOkgat6OR8c28t2GMoP1ioeaf00Q0yYbrxQA5qoxwavDhfcPKvrN/oTFgtycGdOev2ttP14O5l09y1NVAzBhZj5BJGDj7UYXPFN4bnrtQs64bHMBq1m/iss6g6Dv4BjGtYG+Vrn4HGgPe36k6DNSm/5KiZUaeMGxwqO3hn8wlOp6U+lrWo3ICtQGpCBPCNX8WO26/8H1eUp2u1j5RUzIZj/ovoqtVDpT5kTIoaQ8HT+cSLNIaQnoz/C/+jedO6iCfx3usTnuJhOMTuB5PQE5BBOXwKiC46Afbnvsz30qPitfVqu/gp05brd1h7xH9uw2KBYGJXsJY+92Ckj8Z/OCoJ6ZpA1bwJRBJyzW4NGKrJ5zpfQgx/Kuv1659TdUr+LmN+TQOtO/mHj1/lyBt1vwHR2MPq7h7HqgWjFOJ9KPkMHbY+qsrid72+12Uu1DYxCoek30dtGr/o6n4gl2eY+weX6s38/1wxyBRfvF0sMssPlUAkQtImxq7NSO/5Bw7SKAf66VPmDiTEZii05tElmYH4XTifZVR436sMff//+yB/8Snf+eCIz+gGQzW2rqzP+6vKXxbdPVkw00f/2hZczTCdphyWvqy0RdB2oP7QQeX47zenCjKwEVg9HS48HScBS2AvJketVv8F629QJJUPz5HA8mtS8VWHp4PhRWC55GYwttVSlwekuxsY0SHMrgTKP2Fvo55z1x3aUIzkC8tDpC28R+jmnfLnybq6Url40P48TW24yEMs6MJfHBCHOv2odeU4azG08gxnzd0Ct/MLdzxDfC4RKwUwcsBxyWVhvmDFy2nqZR7r9L2KsQLY2XTun7c5VJEAy6c9Rkv4RaEeDGy6qhNs43hnxKlJxKbRX1wGM9PncebPebNuch9Vi9ROpZNiB5pllAAMkYuJQ1D+noyAdSF9zQVeFDscR6KUMS8xmkz1tJ6fXjHCRVW0NrSU7aKHAc2eeklS39Mct+NAsUI2fIBaTcKS28XSsWdCeinneXPJoCzWhylsTP5Ganm4LbRUM//eCq00Cn2AKUBK3JjU+PN4A==';
let heicWarm;
const warmHeic = () => (heicWarm ||= fetch(TINY_HEIC).then((r) => r.blob()).then((blob) =>
  createImageBitmap(blob).then((b) => b.close(), async () => {
    const { heicTo } = await loadHeic();
    (await heicTo({ blob, type: 'bitmap' })).close();
  })).catch((e) => console.warn('heic warm-up failed', e)));
// HEIC 앞부분의 ispe(가로·세로)·irot(회전) 상자만 훑어 사진 크기를 미리 안다. 변환 전 로딩 창 크기를 맞추는 데만 쓴다
async function heicSize(file) {
  const b = new Uint8Array(await file.slice(0, 1 << 16).arrayBuffer());
  const v = new DataView(b.buffer);
  const at = (tag, from) => b.findIndex((_, k) => k >= from && tag.every((c, j) => b[k + j] === c.charCodeAt(0)));
  let best = null;
  for (let k = at([...'ispe'], 0); k >= 0; k = at([...'ispe'], k + 4)) { // 타일·썸네일도 있어 가장 큰 것이 원본
    const w = v.getUint32(k + 8);
    const h = v.getUint32(k + 12);
    if (w && h && (!best || w * h > best.width * best.height)) best = { width: w, height: h };
  }
  const r = at([...'irot'], 0);
  if (best && r >= 0 && b[r + 4] & 1) best = { width: best.height, height: best.width };
  return best;
}
// 미리 읽어 둔 사진이 장당 원본 약 48MB(12MP)씩 메모리를 잡지 않게 긴 변을 줄여 들고 있는다
// 1600 이면 기본 3:4 박스가 출력 900×1200 을 채운다. 박스를 줄여 확대했을 때만 원본을 다시 읽어 자른다
const DECODE_MAX = 1600;
async function shrink(bmp) {
  const k = DECODE_MAX / Math.max(bmp.width, bmp.height);
  if (k >= 1) return { bmp, isShrunk: false };
  try {
    return { bmp: await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * k), resizeHeight: Math.round(bmp.height * k), resizeQuality: 'high' }), isShrunk: true };
  } finally {
    bmp.close();
  }
}
const toJpeg = (src, r) => {
  const out = Object.assign(document.createElement('canvas'), { width: IMG_W, height: IMG_H });
  out.getContext('2d').drawImage(src, r.x * src.width, r.y * src.height, r.w * src.width, r.h * src.height, 0, 0, IMG_W, IMG_H);
  return out.toDataURL('image/jpeg', 0.85);
};
async function readImage(file) {
  const options = { imageOrientation: 'from-image' };
  try {
    return await createImageBitmap(file, options);
  } catch (e) {
    if (!isHeic(file)) throw e;
    const { heicTo } = await loadHeic();
    return heicTo({ blob: file, type: 'bitmap', options });
  }
}

const SPIN_DELAY_MS = 150; // 이보다 빨리 끝나면 로딩을 띄우지 않는다 (Safari 처럼 바로 읽는 경우 깜빡임 방지)
// 끝날 때까지 기다리되, 오래 걸리면 크기 조절 창에 로딩을 띄운다
async function waitWithSpinner(p, i, n, file, signal) {
  let isDone = false;
  p.then(() => { isDone = true; }, () => { isDone = true; });
  await Promise.race([p.catch(() => {}), new Promise((r) => setTimeout(r, SPIN_DELAY_MS))]);
  if (!isDone) {
    const size = isHeic(file) ? await heicSize(file).catch(() => null) : null;
    if (!isDone && !signal.aborted) showCropLoading(i, n, file, size); // 기다리는 사이 닫혔으면 다시 열지 않는다
  }
  return p;
}
const errLabel = (e) => (e?.message ? `${e.name}: ${e.message}` : String(e)).slice(0, 100);

async function addImages(input) {
  const files = [...input.files];
  const { imgPath } = input.dataset;
  input.value = '';
  if (!files.length) return;
  cropRun?.abort();
  const run = new AbortController();
  cropRun = run;
  const isAborted = () => run.signal.aborted;
  const n = files.length;
  const outs = []; // 사진별 잘라 낸 JPEG
  const rects = []; // 사진별 마지막 박스 위치 (이전으로 돌아왔을 때 복원)
  const errs = []; // 사진별 읽기 오류
  // 첫 장을 자르는 동안 나머지도 순서대로 미리 읽어 둔다 (wasm 변환이 몰리지 않게 한 장씩)
  // 이전으로 돌아갈 수 있게 읽은 사진은 끝날 때까지 들고 있다
  let prev = Promise.resolve();
  const jobs = files.map((file) => (prev = prev.then(() => (isAborted() ? {} : readImage(file).then(shrink)))
    .catch((e) => ({ e }))));
  // 남아 있는 사진 순번. 빼기·읽기 실패는 여기서 지워 진행 표시(2 / 4)의 전체 장수에서도 빠진다
  const order = files.map((_, i) => i);
  try {
    for (let pos = 0; pos < order.length;) {
      const i = order[pos];
      const file = files[i];
      const { bmp, isShrunk, e } = await waitWithSpinner(jobs[i], pos, order.length, file, run.signal);
      if (isAborted()) return;
      if (e) {
        errs[i] = errLabel(e);
        console.error('image read failed', file.name, file.type, e);
        track('photo_fail', { type: file.type || file.name.split('.').pop(), error: errs[i] });
      }
      if (!bmp) { order.splice(pos, 1); continue; }
      const rect = await cropImage(bmp, pos, order.length, run.signal, pos > 0, rects[i]);
      if (rect === CROP_ABORT || isAborted()) return;
      if (rect === CROP_PREV) { pos -= 1; continue; }
      if (!rect) { // 빼기: 마지막 사진이었으면 앞 사진으로 돌아간다
        order.splice(pos, 1);
        if (pos === order.length) pos -= 1;
        continue;
      }
      rects[i] = rect;
      // 줄여 둔 사진에서 박스가 출력보다 작으면(확대해서 자름) 원본을 다시 읽어 자른다
      const isBlurry = isShrunk && rect.w * bmp.width < IMG_W;
      const full = isBlurry ? await waitWithSpinner(readImage(file), pos, order.length, file, run.signal).catch(() => null) : null;
      if (isAborted()) return full?.close();
      outs[i] = toJpeg(full || bmp, rect);
      full?.close();
      pos += 1;
    }
  } finally {
    jobs.forEach((j) => j.then((r) => r.bmp?.close()));
    if (cropRun === run) { // 새 실행이 창을 넘겨받았으면 건드리지 않는다
      cropRun = null;
      if (cropDlg.open) cropDlg.close();
    }
  }
  const ok = order.map((i) => outs[i]);
  const failed = errs.filter(Boolean);
  if (ok.length) {
    update(imgPath, [...get(imgPath), ...ok]);
    track('add_photo', { section: section(imgPath), count: ok.length });
  }
  renderEditor();
  if (failed.length) alert(`${failed.length}장은 사진을 읽지 못해 건너뛰었어요. JPG·PNG로 바꿔서 다시 올려 주세요.\n(오류: ${[...new Set(failed)].join(', ')})`);
}

// ── 입력 화면 마크업 ──
const input = (path, label, type = 'text', extra = '') =>
  `<label class="f"><span>${label}</span><input class="in" type="${type}" data-path="${path}" value="${esc(get(path))}" ${extra}></label>`;
const area = (path, label) => `<label class="f">${label}<textarea class="in" data-path="${path}">${esc(get(path))}</textarea></label>`;
const bare = (path, ph) => `<input class="in" data-path="${path}" value="${esc(get(path))}" placeholder="${ph}" aria-label="${ph}">`;
const addBtn = (path) =>
  `<label class="add-img">+<input type="file" accept="image/*" multiple data-img-path="${path}" aria-label="사진 추가"></label>`;
const thumb = (src, path, i) =>
  `<div class="thumb"><img src="${src}" alt=""><button class="x" data-rm-img="${path}" data-i="${i}" aria-label="사진 삭제">✕</button></div>`;
const thumbs = (path) => `<div class="thumbs">${get(path).map((src, i) => thumb(src, path, i)).join('')}${addBtn(path)}</div>`;
const descArea = (path) => `<textarea class="in" data-path="${path}" placeholder="설명" aria-label="설명">${esc(get(path))}</textarea>`;
const drop = (path, kind, label, descPath) => `<div class="drop ${kind}"><span class="lbl">${label}</span>${thumbs(path)}${descPath ? descArea(descPath) : ''}</div>`;
const likePair = (base, hasDesc = false) => `<div class="pair">${drop(`${base}.like`, 'like', '좋아요', hasDesc && `${base}.likeDesc`)}${drop(`${base}.dislike`, 'dislike', '싫어요 <span class="opt">(선택)</span>', hasDesc && `${base}.dislikeDesc`)}</div>`;
const card = (id, no, title, body, aside = '') =>
  `<section class="card" id="${id}"><header><span class="no">${no}</span><h2>${title}</h2>${aside}</header>${body}</section>`;
const delBtn = (list, i) => `<button class="del" data-del="${list}" data-i="${i}" aria-label="삭제">✕</button>`;
const option = (value, label, sel) => `<option value="${esc(value)}"${value === sel ? ' selected' : ''}>${esc(label)}</option>`;

const listOptions = (key) => (sel) => '<option value="">선택 안 함</option>' + get(key).filter((d) => !isBlank(d)).map((d) => option(d.id, d.name || '(이름 없음)', sel)).join('');
const OPTIONS = { hairBride: listOptions('hair.bride'), hairGroom: listOptions('hair.groom'), dress: listOptions('dress'), bouquet: listOptions('bouquet'), boutonniere: listOptions('boutonniere') };
// 소품은 여러 개 고르므로 체크박스 칩. 예전 저장본의 촬영 시안엔 props 가 없음
const propChips = (path) => {
  const sel = get(path) ?? [];
  const items = state.props.filter((d) => !isBlank(d));
  return items.length
    ? items.map((d) => `<label><input type="checkbox" value="${esc(d.id)}"${sel.includes(d.id) ? ' checked' : ''}>${esc(d.name || '(이름 없음)')}</label>`).join('')
    : '<span class="none">웨딩 소품을 먼저 추가하세요</span>';
};
const multi = (path, label) => `<div class="f"><span>${label}</span><div class="chips" data-multi="${path}">${propChips(path)}</div></div>`;
const select = (path, label, kind) =>
  `<label class="f">${label}<select class="in" data-path="${path}" data-opts="${kind}">${OPTIONS[kind](get(path))}</select></label>`;

function basicCard() {
  return card('s-basic', 'i', '기본정보', `<div class="grid basic">${input('basic.date', '촬영 날짜', 'date')}${input('basic.groom', '신랑 이름')}${input('basic.bride', '신부 이름')}</div>`);
}

const seg = (path, values, label, cls = '') => `<div class="seg ${cls}" role="radiogroup" aria-label="${label}">${values
  .map((v) => `<label><input type="radio" name="${path}" value="${v}" data-path="${path}"${v === get(path) ? ' checked' : ''}>${v}</label>`).join('')}</div>`;

function scheduleCard() {
  const isSnap = get('studio.kind') === '스냅';
  const second = isSnap
    ? input('studio.photographer', '작가님 이름')
    : `<div class="f">진행 방식${seg('studio.total', ['토탈', '비토탈'], '진행 방식')}</div>`;
  return card('s-sched', 'ii', '일정', `
    <div class="sub">${isSnap ? '스냅' : '스튜디오'}</div>
    <div class="grid sched">${input('studio.name', isSnap ? '스냅 업체 이름' : '스튜디오 이름')}${second}${input('studio.link', '링크 <span class="opt">(선택)</span>', 'url', 'placeholder="https://"')}${input('studio.start', '시작 시간', 'time')}${input('studio.end', '종료 시간', 'time')}</div>
    <div class="sub">메이크업샵</div>
    <div class="grid sched">${input('makeup.name', '메이크업샵 이름')}${input('makeup.teacher', '메이크업 선생님')}${input('makeup.link', '링크 <span class="opt">(선택)</span>', 'url', 'placeholder="https://"')}${input('makeup.start', '시작 시간', 'time')}${input('makeup.end', '종료 시간', 'time')}</div>`,
  seg('studio.kind', ['스튜디오', '스냅'], '촬영 방식', 'kind'));
}

const muCard = (side, no, label) => card(`s-mu-${side}`, no, `메이크업 시안 · ${label}`, `
  ${area(`mu.${side}.worry`, '고민인 부분')}
  ${likePair(`mu.${side}`, true)}`);

function hairCard(side, no, label) {
  const items = get(`hair.${side}`).map((h, i) => {
    const p = `hair.${side}.${i}`;
    return `<div class="item wide">
      <div class="fields">${thumbs(`${p}.imgs`)}${bare(`${p}.name`, '이름')}<textarea class="in" data-path="${p}.desc" placeholder="설명" aria-label="설명">${esc(h.desc)}</textarea></div>
      ${delBtn(`hair.${side}`, i)}</div>`;
  }).join('');
  return card(`s-hair-${side}`, no, `헤어 시안 · ${label}`, `${items}<button class="btn dashed" data-add="hair.${side}">+ 헤어 추가</button>`);
}

// 드레스·부케·부토니에·소품: 사진 여러 장 + 이름 + 설명 목록
const ITEM_LISTS = [['dress', 'vii', '드레스'], ['bouquet', 'viii', '부케'], ['boutonniere', 'ix', '부토니에'], ['props', 'x', '웨딩 소품']];
function listCard([key, no, title]) {
  const items = state[key].map((d, i) => `<div class="item wide">
    <div class="fields">${thumbs(`${key}.${i}.imgs`)}${bare(`${key}.${i}.name`, '이름')}<textarea class="in" data-path="${key}.${i}.desc" placeholder="설명" aria-label="설명">${esc(d.desc)}</textarea></div>
    ${delBtn(key, i)}</div>`).join('');
  return card(`s-${key}`, no, title, `${items}<button class="btn dashed" data-add="${key}">+ ${title} 추가</button>`);
}

function shotCard() {
  const items = state.shots.map((x, i) => `<div class="shot">
    <div class="shot-h"><input class="in shot-name" data-path="shots.${i}.name" value="${esc(x.name)}" placeholder="컷 ${i + 1}" aria-label="컷 이름">${delBtn('shots', i)}</div>
    ${input(`shots.${i}.place`, '장소')}
    ${likePair(`shots.${i}`)}
    <div class="grid two">${select(`shots.${i}.hairBride`, '헤어 변형 · 신부', 'hairBride')}${select(`shots.${i}.hairGroom`, '헤어 변형 · 신랑', 'hairGroom')}</div>
    <div class="grid three">${select(`shots.${i}.dress`, '드레스', 'dress')}${select(`shots.${i}.bouquet`, '부케', 'bouquet')}${select(`shots.${i}.boutonniere`, '부토니에', 'boutonniere')}</div>
    ${multi(`shots.${i}.props`, '소품 <span class="opt">(여러 개 선택 가능)</span>')}</div>`).join('');
  return card('s-shot', 'xi', '촬영 시안', `${items}<button class="btn dashed" data-add="shots">+ 촬영 시안 추가</button>`);
}

const TOC = [['s-basic', '기본정보'], ['s-sched', '일정'], ['s-mu-bride', '메이크업 · 신부'], ['s-mu-groom', '메이크업 · 신랑'],
  ['s-hair-bride', '헤어 · 신부'], ['s-hair-groom', '헤어 · 신랑'], ['s-dress', '드레스'], ['s-bouquet', '부케'], ['s-boutonniere', '부토니에'], ['s-props', '웨딩 소품'], ['s-shot', '촬영 시안']];

const editorEl = document.getElementById('editor');
function renderEditor() {
  editorEl.innerHTML = `<div class="forms">
    ${basicCard()}${scheduleCard()}
    ${muCard('bride', 'iii', '신부')}${muCard('groom', 'iv', '신랑')}
    ${hairCard('bride', 'v', '신부')}${hairCard('groom', 'vi', '신랑')}
    ${ITEM_LISTS.map(listCard).join('')}${shotCard()}
    <div class="edit-bar"><button class="btn danger" data-reset>초기화</button><button class="btn soft" data-save-draft>임시 저장하기</button><button class="btn" data-view="view">시안 완성하기</button></div>
  </div>`;
}

// 헤어·드레스 이름이 바뀌면 촬영 시안 선택지만 갱신 (전체를 다시 그리면 입력 포커스가 끊김)
function refreshShotSelects() {
  editorEl.querySelectorAll('select[data-opts]').forEach((sel) => {
    sel.innerHTML = OPTIONS[sel.dataset.opts](get(sel.dataset.path));
  });
  editorEl.querySelectorAll('[data-multi]').forEach((box) => { box.innerHTML = propChips(box.dataset.multi); });
}

editorEl.addEventListener('input', (e) => {
  const { path } = e.target.dataset;
  if (!path || e.target.type === 'radio' || e.target.tagName === 'SELECT') return;
  update(path, e.target.value);
  if (/^(hair\.\w+|dress|bouquet|boutonniere|props)\.\d+\.name$/.test(path)) refreshShotSelects();
});
const warmOnAdd = (e) => e.target.closest?.('.add-img') && warmHeic();
editorEl.addEventListener('pointerdown', warmOnAdd);
editorEl.addEventListener('focusin', warmOnAdd);
editorEl.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.imgPath) return addImages(t);
  const box = t.closest('[data-multi]');
  if (box) {
    track('select_props');
    return update(box.dataset.multi, [...box.querySelectorAll(':checked')].map((x) => x.value));
  }
  if (t.dataset.path && (t.type === 'radio' || t.tagName === 'SELECT')) {
    update(t.dataset.path, t.value);
    track('select_option', { field: section(t.dataset.path) });
  }
  if (t.dataset.path === 'studio.kind') renderEditor();
});
editorEl.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const { add, del, rmImg, i } = b.dataset;
  if (add) {
    update(add, [...get(add), newItem(add)]);
    track('add_item', { list: add });
  } else if (del) {
    if (!confirm('이 항목을 삭제할까요?')) return;
    const rest = get(del).filter((_, j) => j !== +i);
    update(del, rest.length ? rest : [newItem(del)]);
    track('delete_item', { list: del });
  } else if ('reset' in b.dataset) {
    if (!confirm('입력한 내용과 사진을 모두 지울까요?')) return;
    state = withOneEach({ ...DEFAULT_STATE, pointColor: state.pointColor });
    track('reset');
  } else if (rmImg) {
    update(rmImg, get(rmImg).filter((_, j) => j !== +i));
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
pointPicker.addEventListener('change', () => track('change_color'));
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
// 화면마다 주소(#/edit 등)를 달리 둬서 새로고침·뒤로 가기에도 그 화면이 유지됨
const VIEWS = ['home', 'mbti', 'edit', 'view', 'my'];
const viewFromHash = () => {
  const v = location.hash.slice(2);
  return VIEWS.includes(v) ? v : 'home';
};
const urlOf = (view) => (view === 'home' ? location.pathname + location.search : `#/${view}`);
function show(view) {
  if (viewFromHash() !== view) history.pushState(null, '', urlOf(view));
  renderView(view);
}
function renderView(view) {
  document.body.dataset.view = view;
  VIEWS.forEach((v) => { document.getElementById(`view-${v}`).hidden = v !== view; });
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === view)));
  if (view === 'view') deckEl.innerHTML = renderDeck(withoutBlanks(state));
  if (view === 'my') renderMyPage(); // account.js
  scrollTo(0, 0);
}
addEventListener('popstate', () => {
  const v = viewFromHash();
  if (v === 'my' && !user) { // 로그아웃 뒤 마이페이지로 돌아온 경우 (user 는 account.js)
    history.replaceState(null, '', urlOf('home'));
    return renderView('home');
  }
  renderView(v);
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]'); // body 의 data-view(현재 화면 표시)는 버튼이 아님
  if (!b) return;
  show(b.dataset.view);
  if (b.dataset.view === 'my') track('open_mypage');
  if (b.dataset.view === 'view') track('view_result', { from: b.closest('.edit-bar') ? 'complete_button' : 'tab' });
});

// 목차 팝업: 고르면 입력 화면의 해당 섹션으로 이동 (바깥을 누르면 popover 가 알아서 닫힘)
const tocEl = document.getElementById('toc');
tocEl.innerHTML = TOC.map(([id, l]) => `<a href="#${id}">${l}</a>`).join('');
tocEl.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a) return;
  e.preventDefault();
  tocEl.hidePopover();
  if (document.getElementById('view-edit').hidden) show('edit');
  document.querySelector(a.getAttribute('href')).scrollIntoView();
  track('toc_jump', { section: a.getAttribute('href').slice(1) });
});

// iOS Safari 는 blob 다운로드 링크를 열지 못해 WebKitBlobResource 오류가 나므로 공유 시트로 저장
const canShareFile = (file) => matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] });
const downloadFile = (file) => {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: file.name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
};
let pendingPdf = null; // 공유 시트는 탭 직후에만 열리므로, PDF 생성이 길어지면 한 번 더 탭해서 열기

document.getElementById('pdf').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (pendingPdf) {
    const file = pendingPdf;
    pendingPdf = null;
    btn.textContent = 'PDF 내보내기';
    await navigator.share({ files: [file] }).catch((err) => err.name !== 'AbortError' && console.error('pdf share failed', err));
    return;
  }
  if (!window.jspdf || !window.html2canvas) {
    alert('PDF 도구를 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.');
    return;
  }
  const overlay = document.getElementById('overlay');
  btn.disabled = true;
  overlay.hidden = false;
  try {
    const names = [state.basic.groom, state.basic.bride].filter(Boolean).join('_');
    const file = await exportPdf(deckEl, `웨딩촬영레퍼런스${names ? '_' + names : ''}.pdf`);
    const isShare = Boolean(canShareFile(file));
    track('export_pdf', { method: isShare ? 'share' : 'download', slides: deckEl.querySelectorAll('.slide').length });
    if (!isShare) return downloadFile(file);
    try {
      await navigator.share({ files: [file] });
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        pendingPdf = file;
        btn.textContent = 'PDF 저장하기';
      } else if (err.name !== 'AbortError') throw err;
    }
  } catch (err) {
    console.error('pdf export failed', err);
    track('export_pdf_fail', { error: err?.name || 'unknown' });
    alert('PDF를 만들지 못했어요. 사진 수를 줄이거나 다시 시도해 주세요.');
  } finally {
    btn.disabled = false;
    overlay.hidden = true;
  }
});

// ── 시작 ── (account.js 가 ready 를 기다렸다가 로그인 상태를 이어 붙임)
const ready = (async () => {
  try {
    const saved = await idb('readonly', (s) => s.get('current'));
    if (saved) state = restore(saved);
  } catch (e) {
    console.error('load failed', e);
    setStatus('저장된 내용을 불러오지 못했어요', true);
  }
  applyPointColor(state.pointColor);
  renderEditor();
  if (viewFromHash() !== 'my') renderView(viewFromHash()); // 마이페이지는 로그인 확인 뒤 account.js 가 띄움
})();

document.getElementById('fb-go').addEventListener('click', () => {
  document.getElementById('fb').hidePopover();
  track('feedback_click');
});
