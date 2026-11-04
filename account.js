// 로그인 · 마이페이지 · 촬영 시안 여러 개 저장
// 로그인 없이도 모든 기능을 쓰고, 로그인하면 지금 작업을 시안으로 저장해 이어서 할 수 있음

// 로그인 = Supabase Auth(카카오), 시안 = drafts 테이블, 사진 = photos 버킷 (supabase/schema.sql)
// 공개(publishable) 키라 브라우저에 있어도 됨. 접근 제한은 RLS 정책이 맡음
const sb = supabase.createClient('https://yucqtbuefqjdoszhavzb.supabase.co', 'sb_publishable_BUsTCR2Q9rQx6W8D4otopg_s4ooALX-');
const BUCKET = 'photos';
const LOGIN_FLAG = 'wr-login';
const ASKED_FLAG = 'wr-login-asked';
const SKIP_DAY = 'wr-login-ask-skip'; // '오늘 하루 보지 않기' 누른 날짜
const MAX_DRAFTS = 2; // 서버 용량 때문에 계정당 시안 수 제한
const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};

// 사진: 시안 안의 data URL 을 버킷 경로('sb:<사용자 id>/<sha256>.jpg')로 바꿔 저장. 같은 사진은 한 번만 올림
const pathOf = new Map(); // data URL → Promise<경로>
const dataOf = new Map(); // 경로 → data URL
const mapStrings = async (o, f) => (typeof o === 'string' ? f(o)
  : Array.isArray(o) ? Promise.all(o.map((v) => mapStrings(v, f)))
  : o && typeof o === 'object' ? Object.fromEntries(await Promise.all(Object.entries(o).map(async ([k, v]) => [k, await mapStrings(v, f)])))
  : o);
const photoPaths = (o) => (typeof o === 'string' ? (o.startsWith('sb:') ? [o.slice(3)] : [])
  : o && typeof o === 'object' ? Object.values(o).flatMap(photoPaths) : []);
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const blobToUrl = (blob) => new Promise((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok(r.result);
  r.onerror = () => fail(r.error);
  r.readAsDataURL(blob);
});

async function upload(uid, url) {
  const blob = await (await fetch(url)).blob();
  const path = `${uid}/${hex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))}.jpg`;
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
  if (error && !/exists|duplicate/i.test(error.message)) throw error; // 이미 올라간 같은 사진이면 그대로 씀
  dataOf.set(path, url);
  return path;
}
const toRemote = (uid, data) => mapStrings(data, async (s) => {
  if (!s.startsWith('data:image')) return s;
  // 남의 공유본에서 가져온 사진은 그 사람 폴더 경로가 캐시돼 있으므로 내 폴더로 다시 올림
  const isMine = pathOf.has(s) && (await pathOf.get(s).catch(() => '')).startsWith(`${uid}/`);
  if (!isMine) pathOf.set(s, upload(uid, s).catch((e) => { pathOf.delete(s); throw e; }));
  return `sb:${await pathOf.get(s)}`;
});
const toLocal = (data) => mapStrings(data, async (s) => {
  if (!s.startsWith('sb:')) return s;
  const path = s.slice(3);
  if (!dataOf.has(path)) {
    const url = await blobToUrl(must(await sb.storage.from(BUCKET).download(path)));
    dataOf.set(path, url);
    pathOf.set(url, Promise.resolve(path));
  }
  return dataOf.get(path);
});

const COLS = 'id,name,updated_at,data';
const fromRow = (r) => ({ id: r.id, name: r.name, updatedAt: Date.parse(r.updated_at), data: r.data });
const toUser = (session) => {
  if (!session) return null;
  const m = session.user.user_metadata || {};
  return { id: session.user.id, name: m.name || m.full_name || m.nickname || '이름 없음', avatar: m.avatar_url || m.picture };
};

const backend = {
  session: async () => toUser(must(await sb.auth.getSession()).session),
  // 카카오 로그인 페이지로 이동했다가 이 주소로 돌아옴
  login: async () => must(await sb.auth.signInWithOAuth({
    provider: 'kakao',
    options: { redirectTo: location.origin + location.pathname, scopes: 'profile_nickname profile_image' },
  })),
  logout: async () => {
    const { error } = await sb.auth.signOut();
    if (error) throw error;
  },
  list: async () => must(await sb.from('drafts').select(COLS).order('updated_at', { ascending: false })).map(fromRow),
  get: async (uid, id) => {
    const r = must(await sb.from('drafts').select(COLS).eq('id', id).maybeSingle());
    return r && fromRow(r);
  },
  put: async (uid, d) => must(await sb.from('drafts').upsert({
    user_id: uid, id: d.id, name: d.name, updated_at: new Date(d.updatedAt).toISOString(), data: await toRemote(uid, d.data),
  })),
  // 시안을 지우면 다른 시안·공유본에서 안 쓰는 사진도 같이 지움 (지운 시안의 공유본은 DB 가 같이 지움)
  remove: async (uid, id) => {
    const [all, shares] = await Promise.all([backend.list(), backend.shares()]);
    must(await sb.from('drafts').delete().eq('id', id));
    const kept = new Set([...all.filter((d) => d.id !== id), ...shares.filter((x) => x.draft_id !== id)].flatMap((d) => photoPaths(d.data)));
    const orphans = [...new Set(photoPaths(all.find((d) => d.id === id)?.data))].filter((p) => !kept.has(p));
    if (orphans.length) must(await sb.storage.from(BUCKET).remove(orphans));
  },
  // 공유본(shares): 공유하기를 누른 순간의 시안. 신랑·신부 이름과 촬영일(basic)은 빼고 올림
  shares: async () => must(await sb.from('shares').select('draft_id,shared_at,data')),
  share: async (uid, d) => must(await sb.from('shares').upsert({
    user_id: uid, draft_id: d.id, shared_at: new Date().toISOString(), data: (({ basic, ...rest }) => rest)(d.data),
  })),
  unshare: async (id) => must(await sb.from('shares').delete().eq('draft_id', id)),
  // 남의 공유본. 내가 공유한 것이 없으면 서버가 'share required' 로 거부
  sharedList: async () => must(await sb.rpc('shared_drafts')),
  // 마이페이지 카드용 1시간짜리 서명 URL
  signedUrls: async (paths) => (paths.length
    ? Object.fromEntries(must(await sb.storage.from(BUCKET).createSignedUrls(paths, 3600)).map((x) => [x.path, x.signedUrl]))
    : {}),
};

let user = null;
let profile = null; // profiles 테이블의 내 행 { nickname, role, character }
let draftId = null;
// syncedAt: 이 브라우저가 마지막으로 불러오거나 저장한 서버 시각. 서버 값과 다르면 다른 창·기기가 그 뒤에 저장한 것
let syncedAt = 0;
// 에디터 맨 위 제목 (로그인해서 시안에 저장 중일 때만 보임)
const renderDraftName = (name) => {
  document.getElementById('ed-name').textContent = name;
  document.getElementById('ed-title').hidden = !(user && draftId && name);
};
const setDraftId = (id, at = 0, name = '') => {
  draftId = id;
  syncedAt = at;
  renderDraftName(name);
  if (id) {
    localStorage.setItem('wr-draft', id);
    localStorage.setItem('wr-synced', String(at));
  } else {
    localStorage.removeItem('wr-draft');
    localStorage.removeItem('wr-synced');
  }
};

const defaultName = (s) => [s.basic.groom, s.basic.bride].filter(Boolean).join(' · ') || '이름 없는 시안';
const hasContent = (s) => JSON.stringify(withoutBlanks(s)) !== JSON.stringify(withoutBlanks({ ...DEFAULT_STATE, pointColor: s.pointColor }));

// scheduleSave 가 로컬 저장 뒤 부름. 로그인 상태면 작업 중인 시안에도 저장
// 앞 저장이 끝난 뒤에 다음 저장을 시작함 (겹치면 자기 저장을 다른 창의 수정으로 잘못 봄)
let syncing = Promise.resolve();
function syncDraft(s) {
  const run = syncing.then(() => syncOnce(s));
  syncing = run.catch(() => {});
  return run;
}
async function syncOnce(s) {
  if (!user || !draftId) return;
  const prev = await backend.get(user.id, draftId);
  if (prev && prev.updatedAt !== syncedAt
    && confirm('다른 창이나 기기에서 이 시안이 수정됐어요.\n최신 내용을 불러올까요? 취소하면 지금 화면 내용으로 저장해요.')) return openDraft(prev);
  // 직접 바꾼 이름은 유지, 자동 이름이면 입력한 신랑·신부 이름을 따라감
  const isAutoName = !prev || prev.name === defaultName(prev.data);
  const d = { id: draftId, name: isAutoName ? defaultName(s) : prev.name, updatedAt: Date.now(), data: s };
  await backend.put(user.id, d);
  setDraftId(d.id, d.updatedAt, d.name);
}

// 시안이 이미 MAX_DRAFTS 개면 안내만 하고 false (서버 트리거도 같은 제한)
async function createDraft(s) {
  if ((await backend.list()).length >= MAX_DRAFTS) {
    alert(`서버 용량 문제로 현재는 계정당 시안을 ${MAX_DRAFTS}개까지만 만들 수 있어요.\n마이페이지에서 기존 시안을 삭제하면 새로 만들 수 있어요.`);
    return false;
  }
  const d = { id: uid(), name: defaultName(s), updatedAt: Date.now(), data: s };
  await backend.put(user.id, d);
  setDraftId(d.id, d.updatedAt, d.name);
  return true;
}

// view 를 null 로 주면 지금 화면은 그대로 두고 내용만 바꿈
function loadIntoEditor(data, view = 'edit') {
  state = restore(data);
  applyPointColor(state.pointColor);
  renderEditor();
  if (view) show(view);
  // 불러오기만 한 것은 이 기기에만 저장 (서버에 다시 올리면 다른 창에서 '수정됨'으로 보임)
  clearTimeout(saveTimer);
  saveTimer = null;
  setStatus('');
  idb('readwrite', (s) => s.put(state, 'current')).catch((e) => console.error('local save failed', e));
}

// ── 화면 ──
const loginTop = document.getElementById('login-top');
const loginCta = document.getElementById('login-cta');
const myBtn = document.getElementById('my-btn');
const draftsEl = document.getElementById('drafts');

function renderAuth() {
  loginTop.hidden = Boolean(user);
  loginCta.hidden = Boolean(user);
  myBtn.hidden = !user;
  document.body.classList.toggle('authed', Boolean(user));
}

const fmtSaved = (t) => new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const KEBAB = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5.5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="18.5" r="1.6"/></svg>';

// 대표 이미지: 시안에 첨부한 사진 중 처음 나오는 것
const draftCard = (d, img, sharedAt) => {
  const isCur = d.id === draftId;
  const shareBtns = sharedAt
    ? `<button data-share="${esc(d.id)}">공유 다시 하기</button><button data-unshare="${esc(d.id)}">공유 내리기</button>`
    : `<button data-share="${esc(d.id)}">공유하기</button>`;
  return `<article class="dcard${isCur ? ' cur' : ''}">
    <button class="dcard-img" data-open="${esc(d.id)}" aria-label="${esc(d.name)} 이어서 작업">${img ? `<img src="${esc(img)}" alt="">` : '<span>사진 없음</span>'}${isCur ? '<em>작업 중</em>' : ''}${sharedAt ? '<em class="shared">공유 중</em>' : ''}</button>
    <p class="dcard-name">${esc(d.name)}</p>
    <div class="dcard-f"><small>${fmtSaved(d.updatedAt)}</small><button class="iconbtn" popovertarget="dm-${esc(d.id)}" aria-label="시안 메뉴">${KEBAB}</button></div>
    <nav class="help my-menu" id="dm-${esc(d.id)}" popover aria-label="시안 메뉴"><button data-rename="${esc(d.id)}">이름 수정</button>${shareBtns}${isCur ? '' : `<button data-rm="${esc(d.id)}">시안 삭제</button>`}</nav>
  </article>`;
};

// 프로필 사진이 없을 때 쓰는 기본 이미지: 가운데 네잎클로버
const LEAF = 'M50 47C35 37 29 20 38 13C45 8 50 14 50 19C50 14 55 8 62 13C71 20 65 37 50 47Z';
const DEFAULT_AVATAR = `<svg class="avatar-def" viewBox="0 0 100 100" aria-hidden="true">${[45, 135, 225, 315]
  .map((r) => `<path d="${LEAF}" transform="rotate(${r} 50 50)"/>`).join('')}<path class="stem" d="M50 52q1 22 16 40"/></svg>`;

// app.js 의 show('my') 가 부름
async function renderMyPage() {
  const [list, shares] = await Promise.all([backend.list(), backend.shares()]);
  const sharedAt = Object.fromEntries(shares.map((x) => [x.draft_id, x.shared_at]));
  const covers = await backend.signedUrls([...new Set(list.map((d) => photoPaths(d.data)[0]).filter(Boolean))]);
  document.getElementById('my-avatar').innerHTML = user.avatar ? `<img src="${esc(user.avatar)}" alt="">` : DEFAULT_AVATAR;
  showProfile();
  draftsEl.innerHTML = list.map((d) => draftCard(d, covers[photoPaths(d.data)[0]], sharedAt[d.id])).join('') || '<p class="note">저장된 시안이 없어요</p>';
}

// ── 레퍼런스 공유 ──
// 공유본은 공유하기를 누른 순간의 시안. 사진이 SHARE_MIN_PHOTOS 장 이상이어야 공유되고, 공유한 사람만 남의 공유본을 봄
// 서버(schema.sql share_data_ok)도 같은 기준으로 막음. 바꾸면 둘 다 바꿀 것
const SHARE_MIN_PHOTOS = 10;
const countPhotos = (data) => new Set(photoPaths(data)).size;

async function shareDraft(id) {
  try {
    // 작업 중인 시안이면 화면 내용부터 저장해야 방금 넣은 사진까지 공유됨
    if (id === draftId && !(await saveDraft())) return;
    const d = await backend.get(user.id, id);
    const n = countPhotos((({ basic, ...rest }) => rest)(d.data));
    if (n < SHARE_MIN_PHOTOS) {
      alert(`사진이 ${SHARE_MIN_PHOTOS}장 이상 담긴 시안만 공유할 수 있어요.\n지금 ${n}장이에요. ${SHARE_MIN_PHOTOS - n}장 더 넣어 주세요.`);
      return;
    }
    if (!confirm('지금 내용 그대로 공유할까요?\n신랑·신부 이름과 촬영일은 빼고 공유돼요. 이후에 고친 내용은 \'공유 다시 하기\'를 눌러야 반영돼요.')) return;
    await backend.share(user.id, d);
    track('share_draft', { photos: n });
    alert('공유했어요. 이제 다른 분들이 공유한 레퍼런스도 볼 수 있어요.');
  } catch (err) {
    console.error('share draft failed', err);
    alert('공유하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  }
}
async function unshareDraft(id) {
  const isLast = (await backend.shares()).length === 1;
  if (!confirm(isLast ? '공유를 내릴까요?\n공유한 시안이 하나도 없으면 다른 분들의 레퍼런스도 볼 수 없어요.' : '공유를 내릴까요?')) return;
  try {
    await backend.unshare(id);
    track('unshare_draft');
  } catch (err) {
    console.error('unshare draft failed', err);
    alert('공유를 내리지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  }
}

// 공유 레퍼런스 화면: 목록 → 카드를 누르면 미리보기 → 내 시안으로 가져가기
const sharedEl = document.getElementById('shared');
const sharedPreview = document.getElementById('shared-preview');
let sharedItems = [];
let picked = null; // 미리보기 중인 공유본 { item, data(사진을 받은 data URL 판) }

const sharedCard = (x, i, img) => `<article class="dcard">
    <button class="dcard-img" data-pick="${i}" aria-label="${esc(x.nickname || '익명')}님 레퍼런스 보기">${img ? `<img src="${esc(img)}" alt="">` : '<span>사진 없음</span>'}</button>
    <p class="dcard-name">${esc(x.nickname || '익명')}님의 레퍼런스</p>
    <div class="dcard-f"><small>사진 ${countPhotos(x.data)}장 · ${fmtSaved(Date.parse(x.shared_at))} 공유</small></div>
  </article>`;

// app.js 의 show('shared') 가 부름
async function renderShared() {
  picked = null;
  sharedPreview.hidden = true;
  sharedEl.hidden = false;
  sharedEl.innerHTML = '<p class="note">불러오는 중…</p>';
  try {
    sharedItems = await backend.sharedList();
  } catch (err) {
    sharedItems = [];
    if (/share required/.test(err.message)) {
      sharedEl.innerHTML = `<div class="share-lock"><p>사진이 ${SHARE_MIN_PHOTOS}장 이상 담긴 내 시안을 공유하면<br>다른 분들이 공유한 레퍼런스를 볼 수 있어요.</p><button class="btn" data-view="my">마이페이지에서 공유하기</button></div>`;
      return;
    }
    console.error('shared list failed', err);
    sharedEl.innerHTML = '<p class="note">불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.</p>';
    return;
  }
  const covers = await backend.signedUrls([...new Set(sharedItems.map((x) => photoPaths(x.data)[0]).filter(Boolean))]).catch(() => ({}));
  sharedEl.innerHTML = sharedItems.map((x, i) => sharedCard(x, i, covers[photoPaths(x.data)[0]])).join('')
    || '<p class="note">아직 다른 분이 공유한 레퍼런스가 없어요.</p>';
  if (homePick) {
    const i = sharedItems.findIndex((x) => `${x.user_id}/${x.draft_id}` === homePick);
    homePick = null;
    if (i >= 0) pickShared(i);
  }
}

// 홈 피드. 공유 안 한 사람은 RLS 로 실제 목록을 못 받으므로 흐린 자리표시 타일 위에 안내를 띄움
const homeGrid = document.getElementById('home-grid');
const homeLock = document.getElementById('home-lock');
const HOME_FAKE_TILES = 10;
let homePick = null; // 홈에서 고른 공유본. renderShared 가 목록을 받은 뒤 열어 줌
const homeTile = (x, img) => `<button class="home-tile" data-home-pick="${esc(x.user_id)}/${esc(x.draft_id)}" aria-label="${esc(x.nickname || '익명')}님 시안 보기">
    <span class="home-img">${img ? `<img src="${esc(img)}" alt="">` : ''}</span>
    <small>${esc(x.nickname || '익명')} · 사진 ${countPhotos(x.data)}장</small>
  </button>`;
const LOCK_ICON = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

// 잠김 상태는 첫 줄만 선명하게. 열 수는 화면 폭에 따라 달라서 그리드 크기가 바뀔 때마다 다시 셈
const blurBelowFirstRow = () => {
  const cols = getComputedStyle(homeGrid).gridTemplateColumns.split(' ').length;
  const locked = homeGrid.classList.contains('locked');
  [...homeGrid.children].forEach((t, i) => t.classList.toggle('blur', locked && i >= cols));
};
new ResizeObserver(blurBelowFirstRow).observe(homeGrid);

function lockHome(body) {
  homeGrid.classList.add('locked');
  homeGrid.innerHTML = Array.from({ length: HOME_FAKE_TILES }, (_, i) => `<div class="home-tile" aria-hidden="true"><span class="home-img c${i % 5}"></span><small>&nbsp;</small></div>`).join('');
  blurBelowFirstRow();
  homeLock.innerHTML = body && `<div class="home-pop">${LOCK_ICON}${body}</div>`;
  homeLock.hidden = !body;
}

// 분류 칩: 그 분류에 사진이 있는 공유본만, 표지도 그 분류의 첫 사진으로
let homeItems = [];
let homeCat = '';
async function paintHome() {
  const pick = (x) => photoPaths(homeCat ? x.data?.[homeCat] : x.data)[0];
  const list = homeItems.filter((x) => !homeCat || pick(x));
  const covers = await backend.signedUrls([...new Set(list.map(pick).filter(Boolean))]).catch(() => ({}));
  homeGrid.innerHTML = list.map((x) => homeTile(x, covers[pick(x)])).join('')
    || `<p class="note">${homeItems.length ? '이 분류에 사진이 있는 시안이 아직 없어요.' : '아직 다른 분이 공유한 시안이 없어요.'}</p>`;
}
document.getElementById('home-chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  homeCat = b.dataset.cat;
  for (const c of e.currentTarget.children) c.setAttribute('aria-pressed', c === b);
  if (!homeGrid.classList.contains('locked')) paintHome();
});

async function renderHome() {
  if (!authChecked) return lockHome(''); // 로그인 확인 전엔 안내 없이 자리만
  if (!user) {
    return lockHome(`<strong>다른 커플의 시안을 보려면</strong><p>카카오로 로그인하고 사진 ${SHARE_MIN_PHOTOS}장 이상 담긴 내 시안을 공유하면 모두 볼 수 있어요.</p><button class="btn" data-login>카카오로 시작하기</button>`);
  }
  let items;
  try {
    items = await backend.sharedList();
  } catch (err) {
    if (!/share required/.test(err.message)) {
      console.error('home shared list failed', err);
      return lockHome('<strong>불러오지 못했어요</strong><p>잠시 뒤 다시 시도해 주세요.</p>');
    }
    const n = countPhotos((({ basic, ...rest }) => rest)(state));
    const left = SHARE_MIN_PHOTOS - n;
    return lockHome(`<strong>내 시안을 공유하면 열려요</strong>
      <p>사진 ${SHARE_MIN_PHOTOS}장 이상 담긴 시안을 하나 공유하면 다른 커플이 공유한 시안을 모두 볼 수 있어요.</p>
      <div class="home-meter"><div class="home-progress"><span style="width:${Math.min(100, (n / SHARE_MIN_PHOTOS) * 100)}%"></span></div>
      <small>지금 시안 사진 ${Math.min(n, SHARE_MIN_PHOTOS)} / ${SHARE_MIN_PHOTOS}장</small></div>
      ${left > 0 ? `<button class="btn" data-view="edit">사진 ${left}장 더 채우기</button>` : '<button class="btn" data-view="my">마이페이지에서 공유하기</button>'}`);
  }
  homeGrid.classList.remove('locked');
  homeLock.hidden = true;
  homeItems = items;
  await paintHome();
}

homeGrid.addEventListener('click', (e) => {
  const b = e.target.closest('[data-home-pick]');
  if (!b) return;
  homePick = b.dataset.homePick;
  show('shared');
});

async function pickShared(i) {
  const item = sharedItems[i];
  setStatus('레퍼런스 불러오는 중…');
  try {
    const data = await toLocal(item.data);
    picked = { item, data };
    document.getElementById('shared-who').textContent = `${item.nickname || '익명'}님의 레퍼런스`;
    document.getElementById('shared-deck').innerHTML = renderDeck(withoutBlanks(restore(data)));
    sharedEl.hidden = true;
    sharedPreview.hidden = false;
    scrollTo(0, 0);
    setStatus('');
    track('view_shared');
  } catch (err) {
    console.error('open shared failed', err);
    setStatus('레퍼런스를 불러오지 못했어요', true);
  }
}

// 가져가기: 내 새 시안으로 통째로 복사. 사진은 toRemote 가 내 폴더로 다시 올림
async function importShared() {
  if (!picked) return;
  if (!confirm('이 레퍼런스를 내 새 시안으로 가져올까요?\n가져온 시안은 자유롭게 고칠 수 있고, 원래 레퍼런스에는 영향이 없어요.')) return;
  const btn = document.getElementById('shared-import');
  btn.disabled = true;
  setStatus('가져오는 중…');
  try {
    // 지금 작업 중인 시안의 바뀐 내용부터 저장
    if (draftId && saveTimer && !(await saveDraft())) return;
    const data = restore(picked.data);
    if (!(await createDraft(data))) return setStatus('');
    loadIntoEditor(data);
    track('import_shared');
  } catch (err) {
    console.error('import shared failed', err);
    setStatus('');
    alert('가져오지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  } finally {
    btn.disabled = false;
  }
}

sharedEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-pick]');
  if (b) pickShared(Number(b.dataset.pick));
});
document.getElementById('shared-back').addEventListener('click', () => {
  picked = null;
  sharedPreview.hidden = true;
  sharedEl.hidden = false;
});
document.getElementById('shared-import').addEventListener('click', importShared);

// 비로그인으로 시안 화면에 처음 들어오면 탭마다 한 번 로그인 권유. 로그인 상태를 확인하기 전이면 확인한 뒤에 띄움
let authChecked = false;
function askLogin() {
  if (!authChecked || user || sessionStorage.getItem(ASKED_FLAG)) return;
  if (localStorage.getItem(SKIP_DAY) === new Date().toDateString()) return;
  sessionStorage.setItem(ASKED_FLAG, '1');
  document.getElementById('login-ask').showPopover();
}

// 카카오에서 돌아온 직후 한 번: 비로그인으로 작업하던 내용이 있으면 새 시안으로 저장, 없으면 마지막 시안을 이어서
// 시안이 이미 꽉 찼으면 작업 내용은 이 기기에만 두고 안내 팝업 없이 넘어감 (덮어쓰지 않음)
async function afterLogin() {
  const list = await backend.list();
  if (!hasContent(state)) {
    if (list.length) await openDraft(list[0]);
    else await createDraft(state);
  } else if (list.length < MAX_DRAFTS) await createDraft(state);
  setStatus('');
  track('login');
}

async function login() {
  try {
    sessionStorage.setItem(LOGIN_FLAG, '1');
    await backend.login();
  } catch (e) {
    sessionStorage.removeItem(LOGIN_FLAG);
    console.error('login failed', e);
    alert('로그인하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  }
}

// 사진을 다 받은 뒤에 작업 중인 시안을 바꿈 (중간에 실패하면 원래 시안 그대로)
async function openDraft(d, view = 'edit') {
  setStatus('시안 불러오는 중…');
  const data = await toLocal(d.data);
  setDraftId(d.id, d.updatedAt, d.name);
  loadIntoEditor(data, view);
}

// 메뉴를 여는 아이콘 바로 아래, 오른쪽 끝을 맞춰 드롭다운처럼
// 마이페이지 시안 카드 메뉴는 나중에 그려지므로 document 에서 capture 로 받음 (beforetoggle 은 버블링되지 않음)
document.addEventListener('beforetoggle', (e) => {
  const menu = e.target;
  if (e.newState !== 'open' || !menu.classList?.contains('my-menu')) return;
  const r = document.querySelector(`[popovertarget="${menu.id}"]`).getBoundingClientRect();
  menu.style.top = `${r.bottom + 6}px`;
  if (menu.classList.contains('main-menu')) menu.style.left = `${Math.max(8, r.left)}px`; // 왼쪽 햄버거 메뉴
  else menu.style.right = `${Math.max(8, innerWidth - r.right)}px`;
}, true);
document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.closest('.my-menu button')) t.closest('.my-menu').hidePopover();
  if (t.closest('[data-login]')) login();
  else if (t.closest('[data-save-draft]')) saveDraft(true);
  else if (t.closest('[data-new-draft]')) newDraft();
  else if (t.closest('[data-logout]')) logout();
  else if (t.closest('[data-rename-cur]')) renameDraft(draftId);
  else if (t.closest('[data-edit]')) openProfile(t.closest('[data-edit]').dataset.edit);
  else if (t.closest('[data-skip-ask]')) localStorage.setItem(SKIP_DAY, new Date().toDateString()); // 닫기는 popovertarget 이 함
  // 메뉴를 닫은 뒤 상담원 아이콘과 같은 문의 창을 띄움
  else if (t.closest('[data-fb]')) document.getElementById('fb').showPopover();
});

// 이름 바꾸기: 에디터 제목의 수정 버튼, 마이페이지 시안 메뉴의 이름 수정. 비우면 신랑·신부 이름을 따르는 자동 이름으로
async function renameDraft(id) {
  try {
    const d = await backend.get(user.id, id);
    const input = prompt('시안 이름 (40자까지)', d.name);
    if (input === null) return false;
    const name = input.trim().slice(0, 40) || defaultName(d.data);
    await backend.put(user.id, { ...d, name });
    if (id === draftId) renderDraftName(name);
    track('rename_draft');
    return true;
  } catch (err) {
    console.error('rename draft failed', err);
    alert('이름을 바꾸지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    return false;
  }
}
draftsEl.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.open) {
    try {
      const d = await backend.get(user.id, b.dataset.open);
      // 작업 중인 시안이고 그 뒤로 다른 곳에서 저장한 적이 없으면 화면만 넘김
      if (d.id === draftId && d.updatedAt === syncedAt) return show('edit');
      await openDraft(d);
      track('open_draft');
    } catch (err) {
      console.error('open draft failed', err);
      setStatus('시안을 불러오지 못했어요', true);
    }
  } else if (b.dataset.rename) {
    if (await renameDraft(b.dataset.rename)) await renderMyPage();
  } else if (b.dataset.share) {
    await shareDraft(b.dataset.share);
    await renderMyPage();
  } else if (b.dataset.unshare) {
    await unshareDraft(b.dataset.unshare);
    await renderMyPage();
  } else if (b.dataset.rm) {
    if (!confirm('이 시안을 삭제할까요?\n삭제하면 되돌릴 수 없고, 공유한 시안이면 공유도 함께 내려가요.')) return;
    try {
      await backend.remove(user.id, b.dataset.rm);
      track('delete_draft');
    } catch (err) {
      console.error('delete draft failed', err);
      alert('삭제하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    }
    await renderMyPage();
  }
});
// 작업 중인 시안에 바로 저장 (버튼은 로그인 상태에서만 보임)
// notify: 버튼으로 저장했을 때만 결과를 팝업으로 알림 (로그아웃 전 저장은 조용히)
async function saveDraft(notify = false) {
  try {
    clearTimeout(saveTimer);
    await idb('readwrite', (s) => s.put(state, 'current'));
    if (!draftId) {
      if (!(await createDraft(state))) { setStatus(''); return false; }
    } else await syncDraft(state);
    setStatus('임시 저장됨 · 마이페이지에서 볼 수 있어요');
    track('save_draft');
    if (notify) alert('임시 저장했어요.\n마이페이지에서 볼 수 있어요.');
    return true;
  } catch (e) {
    console.error('save draft failed', e);
    setStatus(`임시 저장 실패 (${e?.name || e})`, true);
    if (notify) alert('임시 저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.\n입력한 내용은 이 기기에는 남아 있어요.');
    return false;
  }
}
async function newDraft() {
  const blank = withOneEach({ ...DEFAULT_STATE, pointColor: state.pointColor });
  try {
    if (!(await createDraft(blank))) return;
    loadIntoEditor(blank);
    track('new_draft');
  } catch (e) {
    console.error('new draft failed', e);
    alert('새 시안을 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  }
}
async function logout() {
  if (!confirm('로그아웃할까요?')) return;
  // 작업 중인 시안이 있으면 그 시안에 저장부터. 로그아웃하면서 새 시안을 만들지는 않음 (시안이 꽉 찼으면 용량 안내가 뜨므로)
  if (draftId && (document.body.dataset.view === 'edit' || saveTimer)) {
    if (!(await saveDraft()) && !confirm('저장하지 못했어요. 입력한 내용은 이 기기에 남아요. 그래도 로그아웃할까요?')) return;
  }
  try {
    await backend.logout();
  } catch (e) {
    console.error('logout failed', e); // 서버 세션이 남아도 이 기기에서는 로그아웃 처리
  }
  user = null;
  profile = null;
  setDraftId(null);
  renderAuth();
  setStatus('');
  sessionStorage.setItem(ASKED_FLAG, '1'); // 방금 로그아웃한 사람에게는 다시 권하지 않음
  show('edit');
}

// ── 프로필: 로그인한 직후 닉네임이나 신랑·신부가 비어 있으면 받음 (신규·기존 사용자 모두) ──
const profileDlg = document.getElementById('profile');
const profileForm = document.getElementById('profile-form');
const profileErr = document.getElementById('profile-err');
const nickMsg = document.getElementById('nick-msg');
const setNickMsg = (text) => {
  nickMsg.textContent = text;
  nickMsg.hidden = !text;
  profileForm.nickname.toggleAttribute('aria-invalid', Boolean(text));
};
profileForm.nickname.addEventListener('input', () => setNickMsg(''));
const wdPicker = datePicker(document.getElementById('wd-btn'), document.getElementById('wd-cal'), {
  onToggle: (open) => { // 달력은 프로필 입력 대신 같은 창에 보임
    document.getElementById('profile-main').hidden = open;
    document.getElementById('wd-view').hidden = !open;
  },
  onDone: () => { // 날짜만 고치는 창은 달력에서 바로 저장
    if (profileDlg.dataset.mode === 'date') profileForm.requestSubmit();
  },
});

const weddingText = () => {
  if (!profile?.wedding_date) return '결혼 예정 날짜 미정';
  const [y, m, d] = profile.wedding_date.split('-').map(Number);
  const range = profile.wedding_date_range ? ` (±${profile.wedding_date_range}개월)` : '';
  return `결혼 예정 ${y}년 ${m}월 ${d}일${range}`;
};
const showProfile = () => {
  document.getElementById('my-name').textContent = profile?.nickname || user.name;
  document.getElementById('my-date').textContent = weddingText();
};
async function ensureProfile(ask) {
  profile = must(await sb.from('profiles').select('nickname,role,character,wedding_date,wedding_date_range').maybeSingle());
  if (profile?.nickname && profile.role) return showProfile();
  if (ask) openProfile('onboard');
}
// onboard: 처음 받기(닫을 수 없음), profile: 닉네임·신랑신부 수정, date: 결혼 예정일 수정
const PROFILE_MODES = {
  onboard: ['반가워요! 처음 한 번만 알려 주세요', '시작하기'],
  profile: ['프로필 수정', '저장'],
  date: ['결혼 예정 날짜 수정', '저장'],
};
function openProfile(mode) {
  const [title, go] = PROFILE_MODES[mode];
  profileDlg.dataset.mode = mode;
  document.getElementById('profile-h').textContent = title;
  profileForm.querySelector('.onboard-go').textContent = go;
  profileForm.nickname.value = profile?.nickname || '';
  if (profile?.role) profileForm.role.value = profile.role;
  wdPicker.value = { date: profile?.wedding_date, range: profile?.wedding_date_range };
  setNickMsg('');
  profileErr.hidden = true;
  profileDlg.showModal();
  if (mode === 'date') document.getElementById('wd-btn').click(); // 날짜만 고칠 때는 달력부터
}
profileDlg.addEventListener('cancel', (e) => { if (profileDlg.dataset.mode === 'onboard') e.preventDefault(); }); // 처음 받을 때는 Esc 로 닫히지 않게
document.querySelectorAll('#profile-x, #wd-x').forEach((b) => b.addEventListener('click', () => profileDlg.close()));
profileForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nickname = profileForm.nickname.value.trim();
  const role = profileForm.role.value;
  if (!nickname) {
    setNickMsg('닉네임을 입력해 주세요.');
    return profileForm.nickname.focus();
  }
  const btn = profileForm.querySelector('.onboard-go');
  btn.disabled = true;
  profileErr.hidden = true;
  try {
    profile = must(await sb.from('profiles').upsert({
      user_id: user.id, nickname, role,
      wedding_date: wdPicker.value.date || null,
      wedding_date_range: wdPicker.value.range, // 오차(개월), 0 은 정확한 날짜, 미정이면 null
    }).select('nickname,role,character,wedding_date,wedding_date_range').single());
    profileDlg.close();
    showProfile();
    track(profileDlg.dataset.mode === 'onboard' ? 'profile_done' : 'profile_edit', { role });
  } catch (err) {
    if (err.code === '23505') { // 닉네임 unique 위반
      setNickMsg('이미 쓰고 있는 닉네임이에요. 다른 닉네임을 입력해 주세요.');
      return profileForm.nickname.focus();
    }
    console.error('profile save failed', err);
    profileErr.textContent = '저장하지 못했어요. 잠시 뒤 다시 눌러 주세요.';
    profileErr.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

// 저장된 입력(app.js ready)을 먼저 불러온 뒤 로그인 상태를 이어 붙임
(async () => {
  await ready;
  let justLoggedIn = false;
  try {
    user = await backend.session();
    draftId = user && localStorage.getItem('wr-draft');
    syncedAt = Number(localStorage.getItem('wr-synced')) || 0;
    renderAuth();
    if (LOGIN_VIEWS.includes(viewFromHash())) {
      if (user) renderView(viewFromHash());
      else history.replaceState(null, '', urlOf('home'));
    }
    if (user && sessionStorage.getItem(LOGIN_FLAG)) {
      sessionStorage.removeItem(LOGIN_FLAG);
      justLoggedIn = true;
      await afterLogin();
    } else if (user && draftId) {
      // 다른 창·기기에서 이 시안을 더 저장했으면 그 내용으로 바꿔 둠
      const d = await backend.get(user.id, draftId);
      if (d && d.updatedAt !== syncedAt) await openDraft(d, null);
      else if (d) renderDraftName(d.name);
      setStatus('');
    }
  } catch (e) {
    console.error('auth init failed', e);
    setStatus('로그인 상태를 확인하지 못했어요', true);
  }
  // 로그인 직후에만, 닉네임·신랑신부가 비어 있으면 입력 창. 실패해도 다른 기능은 그대로 씀
  if (user) ensureProfile(justLoggedIn).catch((e) => console.error('profile load failed', e));
  authChecked = true;
  if (viewFromHash() === 'home') renderHome();
  if (viewFromHash() === 'edit') askLogin();
})();
renderAuth();
