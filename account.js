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
let profile = null; // profiles 테이블의 내 행 { nickname, role, character }
let draftId = null;
// syncedAt: 이 브라우저가 마지막으로 불러오거나 저장한 서버 시각. 서버 값과 다르면 다른 창·기기가 그 뒤에 저장한 것
let syncedAt = 0;
const setDraftId = (id, at = 0) => {
  draftId = id;
  syncedAt = at;
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
  setDraftId(d.id, d.updatedAt);
}

// 시안이 이미 MAX_DRAFTS 개면 안내만 하고 false (서버 트리거도 같은 제한)
async function createDraft(s) {
  if ((await backend.list()).length >= MAX_DRAFTS) {
    alert(`서버 용량 문제로 현재는 계정당 시안을 ${MAX_DRAFTS}개까지만 만들 수 있어요.\n마이페이지에서 기존 시안을 삭제하면 새로 만들 수 있어요.`);
    return false;
  }
  const d = { id: uid(), name: defaultName(s), updatedAt: Date.now(), data: s };
  await backend.put(user.id, d);
  setDraftId(d.id, d.updatedAt);
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
  showProfile();
  draftsEl.innerHTML = list.map((d) => draftCard(d, covers[photoPaths(d.data)[0]])).join('') || '<p class="note">저장된 시안이 없어요</p>';
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
  setDraftId(d.id, d.updatedAt);
  loadIntoEditor(data, view);
}

// 메뉴를 여는 아이콘 바로 아래, 오른쪽 끝을 맞춰 드롭다운처럼
document.querySelectorAll('.my-menu').forEach((menu) => menu.addEventListener('beforetoggle', (e) => {
  if (e.newState !== 'open') return;
  const r = document.querySelector(`[popovertarget="${menu.id}"]`).getBoundingClientRect();
  menu.style.top = `${r.bottom + 6}px`;
  menu.style.right = `${Math.max(8, innerWidth - r.right)}px`;
}));
document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.closest('.my-menu button')) t.closest('.my-menu').hidePopover();
  if (t.closest('[data-login]')) login();
  else if (t.closest('[data-save-draft]')) saveDraft(true);
  else if (t.closest('[data-new-draft]')) newDraft();
  else if (t.closest('[data-logout]')) logout();
  else if (t.closest('[data-edit]')) openProfile(t.closest('[data-edit]').dataset.edit);
  // 메뉴를 닫은 뒤 상담원 아이콘과 같은 문의 창을 띄움
  else if (t.closest('[data-fb]')) document.getElementById('fb').showPopover();
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
    if (viewFromHash() === 'my') {
      if (user) renderView('my');
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
      setStatus('');
    }
  } catch (e) {
    console.error('auth init failed', e);
    setStatus('로그인 상태를 확인하지 못했어요', true);
  }
  // 로그인 직후에만, 닉네임·신랑신부가 비어 있으면 입력 창. 실패해도 다른 기능은 그대로 씀
  if (user) ensureProfile(justLoggedIn).catch((e) => console.error('profile load failed', e));
})();
renderAuth();
