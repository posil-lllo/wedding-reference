// 로그인 · 마이페이지 · 촬영 시안 여러 개 저장
// 로그인 없이도 모든 기능을 쓰고, 로그인하면 지금 작업을 시안으로 저장해 이어서 할 수 있음

// 로그인 = Supabase Auth(카카오), 시안 = drafts 테이블, 사진 = photos 버킷 (supabase/schema.sql)
// 공개(publishable) 키라 브라우저에 있어도 됨. 접근 제한은 RLS 정책이 맡음
const sb = supabase.createClient('https://yucqtbuefqjdoszhavzb.supabase.co', 'sb_publishable_BUsTCR2Q9rQx6W8D4otopg_s4ooALX-');
const BUCKET = 'photos';
const LOGIN_FLAG = 'wr-login';
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
  if (!pathOf.has(s)) pathOf.set(s, upload(uid, s).catch((e) => { pathOf.delete(s); throw e; }));
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
  // 시안을 지우면 다른 시안에서 안 쓰는 사진도 같이 지움
  remove: async (uid, id) => {
    const all = await backend.list();
    must(await sb.from('drafts').delete().eq('id', id));
    const kept = new Set(all.filter((d) => d.id !== id).flatMap((d) => photoPaths(d.data)));
    const orphans = [...new Set(photoPaths(all.find((d) => d.id === id)?.data))].filter((p) => !kept.has(p));
    if (orphans.length) must(await sb.storage.from(BUCKET).remove(orphans));
  },
  // 마이페이지 카드용 1시간짜리 서명 URL
  signedUrls: async (paths) => (paths.length
    ? Object.fromEntries(must(await sb.storage.from(BUCKET).createSignedUrls(paths, 3600)).map((x) => [x.path, x.signedUrl]))
    : {}),
};

let user = null;
let draftId = null;
const setDraftId = (id) => {
  draftId = id;
  if (id) localStorage.setItem('wr-draft', id);
  else localStorage.removeItem('wr-draft');
};

const defaultName = (s) => [s.basic.groom, s.basic.bride].filter(Boolean).join(' · ') || '이름 없는 시안';
const hasContent = (s) => JSON.stringify(withoutBlanks(s)) !== JSON.stringify(withoutBlanks({ ...DEFAULT_STATE, pointColor: s.pointColor }));

// scheduleSave 가 로컬 저장 뒤 부름. 로그인 상태면 작업 중인 시안에도 저장
async function syncDraft(s) {
  if (!user || !draftId) return;
  const prev = await backend.get(user.id, draftId);
  // 직접 바꾼 이름은 유지, 자동 이름이면 입력한 신랑·신부 이름을 따라감
  const isAutoName = !prev || prev.name === defaultName(prev.data);
  await backend.put(user.id, { id: draftId, name: isAutoName ? defaultName(s) : prev.name, updatedAt: Date.now(), data: s });
}

// 시안이 이미 MAX_DRAFTS 개면 안내만 하고 false (서버 트리거도 같은 제한)
async function createDraft(s) {
  if ((await backend.list()).length >= MAX_DRAFTS) {
    alert(`서버 용량 문제로 현재는 계정당 시안을 ${MAX_DRAFTS}개까지만 만들 수 있어요.\n마이페이지에서 기존 시안을 삭제하면 새로 만들 수 있어요.`);
    return false;
  }
  const d = { id: uid(), name: defaultName(s), updatedAt: Date.now(), data: s };
  await backend.put(user.id, d);
  setDraftId(d.id);
  return true;
}

function loadIntoEditor(data) {
  state = restore(data);
  applyPointColor(state.pointColor);
  renderEditor();
  show('edit');
  scheduleSave();
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

// 대표 이미지: 시안에 첨부한 사진 중 처음 나오는 것
const draftCard = (d, img) => {
  const isCur = d.id === draftId;
  return `<article class="dcard${isCur ? ' cur' : ''}">
    <button class="dcard-img" data-open="${esc(d.id)}" aria-label="${esc(d.name)} 이어서 작업">${img ? `<img src="${esc(img)}" alt="">` : '<span>사진 없음</span>'}${isCur ? '<em>작업 중</em>' : ''}</button>
    <input class="dcard-name" value="${esc(d.name)}" data-rename="${esc(d.id)}" maxlength="40" aria-label="시안 이름">
    <div class="dcard-f"><small>${fmtSaved(d.updatedAt)}</small>${isCur ? '' : `<button class="del" data-rm="${esc(d.id)}" aria-label="삭제">✕</button>`}</div>
  </article>`;
};

// 프로필 사진이 없을 때 쓰는 기본 이미지: 가운데 네잎클로버
const LEAF = 'M50 47C35 37 29 20 38 13C45 8 50 14 50 19C50 14 55 8 62 13C71 20 65 37 50 47Z';
const DEFAULT_AVATAR = `<svg class="avatar-def" viewBox="0 0 100 100" aria-hidden="true">${[45, 135, 225, 315]
  .map((r) => `<path d="${LEAF}" transform="rotate(${r} 50 50)"/>`).join('')}<path class="stem" d="M50 52q1 22 16 40"/></svg>`;

// app.js 의 show('my') 가 부름
async function renderMyPage() {
  const list = await backend.list();
  const covers = await backend.signedUrls([...new Set(list.map((d) => photoPaths(d.data)[0]).filter(Boolean))]);
  document.getElementById('my-avatar').innerHTML = user.avatar ? `<img src="${esc(user.avatar)}" alt="">` : DEFAULT_AVATAR;
  document.getElementById('my-name').textContent = user.name;
  document.getElementById('my-count').textContent = `촬영 시안 ${list.length}개`;
  draftsEl.innerHTML = list.map((d) => draftCard(d, covers[photoPaths(d.data)[0]])).join('') || '<p class="note">저장된 시안이 없어요</p>';
}

// 카카오에서 돌아온 직후 한 번: 비로그인으로 작업하던 내용이 있으면 새 시안으로 저장, 없으면 마지막 시안을 이어서
async function afterLogin() {
  const list = await backend.list();
  if (hasContent(state) || !list.length) await createDraft(state);
  else await openDraft(list[0]);
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

async function openDraft(d) {
  setStatus('시안 불러오는 중…');
  setDraftId(d.id);
  loadIntoEditor(await toLocal(d.data));
}

const myMenu = document.getElementById('my-menu');
// 아이콘 바로 아래, 오른쪽 끝을 맞춰 드롭다운처럼
myMenu.addEventListener('beforetoggle', (e) => {
  if (e.newState !== 'open') return;
  const r = myBtn.getBoundingClientRect();
  myMenu.style.top = `${r.bottom + 6}px`;
  myMenu.style.right = `${Math.max(8, innerWidth - r.right)}px`;
});
document.addEventListener('click', (e) => {
  const t = e.target;
  if (myMenu.contains(t) && t.closest('button')) myMenu.hidePopover();
  if (t.closest('[data-login]')) login();
  else if (t.closest('[data-save-draft]')) saveDraft();
  else if (t.closest('[data-new-draft]')) newDraft();
  else if (t.closest('[data-logout]')) logout();
});

draftsEl.addEventListener('change', async (e) => {
  const id = e.target.dataset.rename;
  if (!id) return;
  const d = await backend.get(user.id, id);
  await backend.put(user.id, { ...d, name: e.target.value.trim() || defaultName(d.data) });
  track('rename_draft');
});
draftsEl.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.open) {
    if (b.dataset.open === draftId) return show('edit');
    try {
      await openDraft(await backend.get(user.id, b.dataset.open));
      track('open_draft');
    } catch (err) {
      console.error('open draft failed', err);
      setStatus('시안을 불러오지 못했어요', true);
    }
  } else if (b.dataset.rm) {
    if (!confirm('이 시안을 삭제할까요?')) return;
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
async function saveDraft() {
  try {
    clearTimeout(saveTimer);
    await idb('readwrite', (s) => s.put(state, 'current'));
    if (!draftId) {
      if (!(await createDraft(state))) return setStatus('');
    } else await syncDraft(state);
    setStatus('임시 저장됨 · 마이페이지에서 볼 수 있어요');
    track('save_draft');
  } catch (e) {
    console.error('save draft failed', e);
    setStatus(`임시 저장 실패 (${e?.name || e})`, true);
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
  if (!confirm('로그아웃할까요? 지금 화면의 내용은 이 기기에 그대로 남아요.')) return;
  try {
    await backend.logout();
  } catch (e) {
    console.error('logout failed', e); // 서버 세션이 남아도 이 기기에서는 로그아웃 처리
  }
  user = null;
  setDraftId(null);
  renderAuth();
  setStatus('');
  show('edit');
}

// 저장된 입력(app.js ready)을 먼저 불러온 뒤 로그인 상태를 이어 붙임
(async () => {
  await ready;
  try {
    user = await backend.session();
    draftId = user && localStorage.getItem('wr-draft');
    renderAuth();
    if (viewFromHash() === 'my') {
      if (user) renderView('my');
      else history.replaceState(null, '', urlOf('home'));
    }
    if (user && sessionStorage.getItem(LOGIN_FLAG)) {
      sessionStorage.removeItem(LOGIN_FLAG);
      await afterLogin();
    }
  } catch (e) {
    console.error('auth init failed', e);
    setStatus('로그인 상태를 확인하지 못했어요', true);
  }
})();
renderAuth();
