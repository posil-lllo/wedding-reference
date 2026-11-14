// 로그인 · 마이페이지 · 촬영 시안 여러 개 저장
// 로그인 없이도 모든 기능을 쓰고, 로그인하면 지금 작업을 시안으로 저장해 이어서 할 수 있음

// 로그인 = Supabase Auth(카카오), 시안 = drafts 테이블, 사진 = photos 버킷 (supabase/schema.sql)
// 공개(publishable) 키라 브라우저에 있어도 됨. 접근 제한은 RLS 정책이 맡음
const sb = supabase.createClient('https://yucqtbuefqjdoszhavzb.supabase.co', 'sb_publishable_BUsTCR2Q9rQx6W8D4otopg_s4ooALX-');
const BUCKET = 'photos';
const LOGIN_FLAG = 'wr-login';
const ASKED_FLAG = 'wr-login-asked';
const SKIP_DAY = 'wr-login-ask-skip'; // '오늘 하루 보지 않기' 누른 날짜
const KEEP_FLAG = 'wr-keep-test'; // 테스트 결과 화면에서 로그인을 누른 경우, 돌아와서 그 결과를 저장
const INVITE_FLAG = 'wr-invite'; // 초대 화면에서 로그인을 누른 경우, 카카오에서 돌아와 다시 열 초대 코드
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
  // 남의 시안(초대)에서 받은 사진은 그 사람 폴더 경로가 캐시돼 있으므로 내 폴더로 다시 올림
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
// 초대 코드 8자리. 헷갈리는 I O 0 1 을 뺀 32자 (schema.sql invites.code 검사와 같게)
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => CODE_CHARS[b & 31]).join('');
const fromRow = (r) => ({ id: r.id, name: r.name, updatedAt: Date.parse(r.updated_at), data: r.data });
// 초대 링크로 들어와 익명 로그인한 사람은 로그인하지 않은 것으로 봄
const toUser = (session) => {
  if (!session || session.user.is_anonymous) return null;
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
  // 초대: 시안 하나를 보기만 하게 링크·QR·코드로 보냄. 시안마다 하나, 끊고 다시 만들면 새 코드
  invite: async (id) => must(await sb.from('invites').select('code').eq('draft_id', id).maybeSingle())?.code,
  createInvite: async (uid, id) => must(await sb.from('invites').insert({ code: newCode(), user_id: uid, draft_id: id }).select('code').single()).code,
  revokeInvite: async (id) => must(await sb.from('invites').delete().eq('draft_id', id)),
  // 로그인하지 않았으면 익명 로그인부터. 그래야 서버가 이 사람에게 초대받은 시안의 사진을 열어 줌
  joinInvite: async (code) => {
    if (!must(await sb.auth.getSession()).session) must(await sb.auth.signInAnonymously());
    return must(await sb.rpc('join_invite', { c: code }))[0];
  },
  invitedList: async () => must(await sb.rpc('invited_drafts')),
  // 체크리스트는 계정당 하나
  checklist: async () => must(await sb.from('checklists').select('data').maybeSingle())?.data,
  putChecklist: async (uid, s) => must(await sb.from('checklists').upsert({ user_id: uid, data: s, updated_at: new Date().toISOString() })),
  // 성향 테스트 결과는 한 번 할 때마다 쌓고, 최신 캐릭터는 프로필에도 적음 (프로필이 아직 없으면 update 는 아무 일 안 함)
  saveTestResult: async (uid, r) => {
    must(await sb.from('test_results').insert({
      character: r.key, value: r.value, gender: r.gender, answers: r.answers, value_percent: r.valuePercent, style_percent: r.stylePercent,
    }));
    must(await sb.from('profiles').update({ character: r.key }).eq('user_id', uid));
  },
  // 마이페이지 카드용 1시간짜리 서명 URL
  signedUrls: async (paths) => (paths.length
    ? Object.fromEntries(must(await sb.storage.from(BUCKET).createSignedUrls(paths, 3600)).map((x) => [x.path, x.signedUrl]))
    : {}),
};

let user = null;

// 체크리스트(checklist/app.js)는 계정에만 저장. 고친 것을 1초 모아 통째로 올림
// 못 올리면 안내만 띄우고, 다음에 고칠 때 통째로 다시 올라감
let clTimer, clPending;
const clSyncErr = (on) => { document.getElementById('cl-sync-err').hidden = !on; };
const flushChecklist = () => {
  clearTimeout(clTimer);
  const s = clPending;
  clPending = null;
  if (!s || !user) return;
  backend.putChecklist(user.id, s).then(() => clSyncErr(false), (e) => {
    console.error('checklist sync failed', e);
    clSyncErr(true);
  });
};
window.pushChecklist = (s) => {
  if (!user) return;
  clPending = s;
  clearTimeout(clTimer);
  clTimer = setTimeout(flushChecklist, 1000);
};
// 1초가 지나기 전에 탭을 닫거나 옮겨도 올라가게
document.addEventListener('visibilitychange', () => { if (document.hidden) flushChecklist(); });
// 로그인 확인 뒤 한 번 계정에서 불러옴. 비로그인이면 체크리스트는 비어 있고 안내 문구만 보임
async function syncChecklist() {
  if (!user || !window.checklistSync) return;
  window.checklistSync.load(await backend.checklist());
  refreshDates();
}
// mbti/app.js 가 테스트를 끝낸 순간 부름. 카카오 로그인한 사람만 저장 (익명·비로그인은 user 가 null)
window.saveTestResult = (r) => {
  if (!user) return;
  backend.saveTestResult(user.id, r)
    .then(() => { if (profile) profile = { ...profile, character: r.key }; })
    .catch((e) => console.error('성향 테스트 결과 저장 실패', e));
};
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
  document.getElementById('keep-result').hidden = Boolean(user);
  myBtn.hidden = !user;
  document.body.classList.toggle('authed', Boolean(user));
  // 로그인 확인 전에는 둘 다 아님. 체크리스트는 로그인해야 쓰고, 비로그인이면 안내 문구만 (style.css .guest)
  document.body.classList.toggle('guest', authChecked && !user);
}

const fmtSaved = (t) => new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const KEBAB = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5.5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="18.5" r="1.6"/></svg>';

// 대표 이미지: 시안에 첨부한 사진 중 처음 나오는 것
const draftCard = (d, img) => {
  const isCur = d.id === draftId;
  return `<article class="dcard${isCur ? ' cur' : ''}">
    <button class="dcard-img" data-open="${esc(d.id)}" aria-label="${esc(d.name)} 이어서 작업">${img ? `<img src="${esc(img)}" alt="">` : '<span>사진 없음</span>'}${isCur ? '<em>작업 중</em>' : ''}</button>
    <p class="dcard-name">${esc(d.name)}</p>
    <div class="dcard-f"><small>${fmtSaved(d.updatedAt)}</small><button class="iconbtn" popovertarget="dm-${esc(d.id)}" aria-label="시안 메뉴">${KEBAB}</button></div>
    <nav class="help my-menu" id="dm-${esc(d.id)}" popover aria-label="시안 메뉴"><button data-rename="${esc(d.id)}">이름 수정</button><button data-invite="${esc(d.id)}">초대하기</button>${isCur ? '' : `<button data-rm="${esc(d.id)}">시안 삭제</button>`}</nav>
  </article>`;
};

// 프로필 사진이 없을 때 쓰는 기본 이미지: 가운데 네잎클로버
const LEAF = 'M50 47C35 37 29 20 38 13C45 8 50 14 50 19C50 14 55 8 62 13C71 20 65 37 50 47Z';
const DEFAULT_AVATAR = `<svg class="avatar-def" viewBox="0 0 100 100" aria-hidden="true">${[45, 135, 225, 315]
  .map((r) => `<path d="${LEAF}" transform="rotate(${r} 50 50)"/>`).join('')}<path class="stem" d="M50 52q1 22 16 40"/></svg>`;

const invitedEl = document.getElementById('invited');
const invitedCard = (x, img) => `<article class="dcard">
    <button class="dcard-img" data-invited="${esc(x.code)}" aria-label="${esc(x.nickname || '익명')}님의 시안 보기">${img ? `<img src="${esc(img)}" alt="">` : '<span>사진 없음</span>'}</button>
    <p class="dcard-name">${esc(x.name || '이름 없는 시안')}</p>
    <div class="dcard-f"><small>${esc(x.nickname || '익명')}님 · ${fmtSaved(Date.parse(x.updated_at))} 수정</small></div>
  </article>`;

// 공유받은 시안 끝에 늘 붙는 카드. 눌러서 초대 코드를 넣으면 목록에 추가됨 (받는 초대 수는 제한 없음)
const JOIN_CARD = `<article class="dcard">
    <button class="dcard-img dcard-add" data-join aria-label="초대 코드 입력">+</button>
    <p class="dcard-name">초대 코드 입력</p>
    <div class="dcard-f"><small>받은 코드로 시안 추가</small></div>
  </article>`;

// app.js 의 show('my') 가 부름
async function renderMyPage() {
  const [list, invited] = await Promise.all([backend.list(), backend.invitedList()]);
  setDraftDates(list); // 삭제·이름 변경 뒤에도 여기를 지남
  const covers = await backend.signedUrls([...new Set([...list, ...invited].map((d) => photoPaths(d.data)[0]).filter(Boolean))]);
  document.getElementById('my-avatar').innerHTML = user.avatar ? `<img src="${esc(user.avatar)}" alt="">` : DEFAULT_AVATAR;
  showProfile();
  draftsEl.innerHTML = list.map((d) => draftCard(d, covers[photoPaths(d.data)[0]])).join('') || '<p class="note">저장된 시안이 없어요</p>';
  invitedEl.innerHTML = invited.map((x) => invitedCard(x, covers[photoPaths(x.data)[0]])).join('') + JOIN_CARD;
}
// 마이페이지 탭: 레퍼런스 모음 / 공유받은 시안
const myTabs = document.querySelector('.my-tabs');
myTabs.addEventListener('click', (e) => {
  const t = e.target.closest('[role=tab]');
  if (!t) return;
  myTabs.querySelectorAll('[role=tab]').forEach((b) => {
    b.setAttribute('aria-selected', b === t);
    document.getElementById(b.getAttribute('aria-controls')).hidden = b !== t;
  });
});
const joinDlg = document.getElementById('join');
const joinForm = document.getElementById('join-form');
const joinErr = document.getElementById('join-err');
const showJoinErr = (msg) => { joinErr.textContent = msg; joinErr.hidden = false; };
invitedEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-invited]');
  if (b) openInviteView(b.dataset.invited);
  else if (e.target.closest('[data-join]')) {
    joinForm.reset();
    joinErr.hidden = true;
    joinDlg.showModal();
  }
});
document.getElementById('join-x').addEventListener('click', () => joinDlg.close());
joinForm.addEventListener('input', () => { joinErr.hidden = true; }); // 비우고 내면 required 가 막아 submit 이 안 불리므로 고칠 때 지움
joinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = joinForm.code.value.trim().toUpperCase();
  joinErr.hidden = true;
  try {
    await backend.joinInvite(code);
  } catch (err) {
    const notFound = /invite not found/.test(err.message);
    if (!notFound) console.error('join invite failed', err);
    showJoinErr(notFound ? '초대를 찾지 못했어요. 코드를 다시 확인해 주세요.' : '불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    return;
  }
  await renderMyPage();
  // 내 시안의 코드는 서버가 받은 사람으로 기록하지 않아 목록에 안 생김
  if (!invitedEl.querySelector(`[data-invited="${code}"]`)) return showJoinErr('내 시안의 초대 코드예요. 레퍼런스 모음에서 볼 수 있어요.');
  joinDlg.close();
  track('join_invite');
});

// ── 초대 (보내는 쪽): 시안 메뉴의 '초대하기' → 링크·QR·코드 창 ──
const inviteDlg = document.getElementById('invite');
const inviteLink = (code) => `${location.origin}${location.pathname}#/invite?c=${code}`;
let inviting = null; // 창에 띄운 { id, code }
async function openInvite(id) {
  try {
    const code = (await backend.invite(id)) || (await backend.createInvite(user.id, id));
    inviting = { id, code };
    const qr = qrcode(0, 'M');
    qr.addData(inviteLink(code));
    qr.make();
    document.getElementById('invite-qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true, alt: '초대 링크 QR 코드' });
    document.getElementById('invite-code').textContent = code;
    document.getElementById('invite-send').hidden = !navigator.share;
    inviteDlg.showModal();
    track('open_invite');
  } catch (err) {
    console.error('open invite failed', err);
    alert('초대 링크를 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  }
}
document.getElementById('invite-x').addEventListener('click', () => inviteDlg.close());
document.getElementById('invite-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(inviteLink(inviting.code));
    alert('링크를 복사했어요.');
    track('copy_invite');
  } catch {
    prompt('이 링크를 복사해 보내 주세요.', inviteLink(inviting.code)); // 클립보드 권한이 없는 브라우저
  }
});
document.getElementById('invite-send').addEventListener('click', () => {
  navigator.share({ title: '웨딩 촬영 시안', text: `초대 코드 ${inviting.code}`, url: inviteLink(inviting.code) })
    .then(() => track('send_invite'))
    .catch((e) => { if (e.name !== 'AbortError') console.error('share invite failed', e); });
});
document.getElementById('invite-off').addEventListener('click', async () => {
  if (!confirm('초대를 끊을까요?\n지금 링크와 코드로는 더 볼 수 없어요. 다시 초대하면 새 링크가 만들어져요.')) return;
  try {
    await backend.revokeInvite(inviting.id);
    inviteDlg.close();
    track('revoke_invite');
  } catch (err) {
    console.error('revoke invite failed', err);
    alert('초대를 끊지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  }
});

// ── 초대 (받는 쪽): #/invite?c=코드. 코드가 없거나 틀리면 입력 칸 ──
const inviteForm = document.getElementById('invite-form');
const inviteErr = document.getElementById('invite-err');
const invitePreview = document.getElementById('invite-preview');
const inviteCode = () => new URLSearchParams(location.hash.split('?')[1]).get('c')?.trim().toUpperCase() || '';
function openInviteView(code) {
  history.pushState(null, '', `#/invite?c=${encodeURIComponent(code)}`);
  renderView('invite');
}
// app.js 의 show('invite') 가 부름. 익명 로그인이 세션 복원과 겹치지 않게 로그인 확인 뒤에만
async function renderInvite() {
  if (!authChecked) return;
  const code = inviteCode();
  inviteForm.hidden = Boolean(code);
  invitePreview.hidden = true;
  inviteErr.hidden = true;
  if (!code) return;
  setStatus('시안 불러오는 중…');
  try {
    const x = await backend.joinInvite(code);
    const data = await toLocal(x.data);
    if (inviteCode() !== code) return; // 불러오는 사이 다른 화면으로 감
    document.getElementById('invite-who').textContent = `${x.nickname || '익명'}님이 초대한 시안 · ${x.name || '이름 없는 시안'}`;
    document.getElementById('invite-deck').innerHTML = renderDeck(withoutBlanks(restore(data)));
    document.getElementById('invite-keep').hidden = Boolean(user);
    invitePreview.hidden = false;
    setStatus('');
    track('view_invite', { member: Boolean(user) });
  } catch (err) {
    const notFound = /invite not found/.test(err.message);
    if (!notFound) console.error('open invite failed', err);
    setStatus('');
    inviteForm.hidden = false;
    inviteForm.code.value = code;
    inviteErr.textContent = notFound ? '초대를 찾지 못했어요. 코드를 다시 확인하거나 보낸 분께 새 링크를 받아 주세요.' : '불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.';
    inviteErr.hidden = false;
  }
}
inviteForm.addEventListener('submit', (e) => {
  e.preventDefault();
  openInviteView(inviteForm.code.value.trim().toUpperCase());
});

// 비로그인으로 시안 화면에 처음 들어오면 탭마다 한 번 로그인 권유. 로그인 상태를 확인하기 전이면 확인한 뒤에 띄움
// (체크리스트는 비로그인이면 화면 자체가 안내 문구라 권유하지 않음)
const ASK_MSG = {
  edit: '로그인하면 임시저장하고, 저장한 곳부터 이어서 할 수 있습니다.',
};
let authChecked = false;
function askLogin() {
  if (!authChecked || user || sessionStorage.getItem(ASKED_FLAG)) return;
  if (localStorage.getItem(SKIP_DAY) === new Date().toDateString()) return;
  sessionStorage.setItem(ASKED_FLAG, '1');
  document.getElementById('login-ask-msg').textContent = ASK_MSG[viewFromHash()] || ASK_MSG.edit;
  document.getElementById('login-ask').showPopover();
}

// 카카오에서 돌아온 직후 한 번: 비로그인으로 작업하던 내용이 있으면 새 시안으로 저장, 없으면 마지막 시안을 이어서
// 시안이 이미 꽉 찼으면 작업 내용은 이 기기에만 두고 안내 팝업 없이 넘어감 (덮어쓰지 않음)
// view 가 null 이면 지금 화면(테스트 결과 등)을 그대로 둠
async function afterLogin(view = 'edit') {
  const list = await backend.list();
  if (!hasContent(state)) {
    if (list.length) await openDraft(list[0], view);
    else await createDraft(state);
  } else if (list.length < MAX_DRAFTS) await createDraft(state);
  setStatus('');
  track('login');
}

async function login() {
  try {
    sessionStorage.setItem(LOGIN_FLAG, viewFromHash()); // 로그인을 누른 화면. 돌아오면 주소의 #/... 가 빠짐
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
  else if (t.closest('[data-keep-login]')) {
    sessionStorage.setItem(KEEP_FLAG, '1');
    login();
  }
  else if (t.closest('[data-invite-login]')) {
    sessionStorage.setItem(INVITE_FLAG, inviteCode());
    login();
  }
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
  } else if (b.dataset.invite) {
    await openInvite(b.dataset.invite);
  } else if (b.dataset.rename) {
    if (await renameDraft(b.dataset.rename)) await renderMyPage();
  } else if (b.dataset.rm) {
    if (!confirm('이 시안을 삭제할까요?\n삭제하면 되돌릴 수 없어요.')) return;
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
  draftDates = [];
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
// 계정의 모든 시안 촬영일 (홈 내 일정·체크리스트가 읽음). 지금 연 시안은 home-cal.js 가 화면 값으로 덮어씀
let draftDates = [];
window.draftShoots = () => draftDates;
const setDraftDates = (list) => {
  draftDates = list.map((d) => ({ id: d.id, name: d.name, date: d.data?.basic?.date || '' }));
  refreshDates();
};
// 본식일·촬영일이 보이는 화면(홈 내 일정, 체크리스트)을 지금 값으로 다시 그림
const refreshDates = () => {
  const v = document.body.dataset.view;
  if (v === 'home') window.renderHomeCal?.();
  if (v === 'checklist') window.renderChecklist?.();
};
// 체크리스트에서 본식일을 고치면 결혼 예정 날짜도 그 날로 (정확한 날짜라 오차 0). 프로필이 아직 없으면 체크리스트에만 둠
window.saveWeddingDate = (d) => {
  if (!user || !profile || (profile.wedding_date || '') === d) return;
  sb.from('profiles').update({ wedding_date: d || null, wedding_date_range: d ? 0 : null }).eq('user_id', user.id)
    .select('nickname,role,character,wedding_date,wedding_date_range').single()
    .then((r) => { profile = must(r); showProfile(); })
    .catch((e) => console.error('wedding date save failed', e));
};
async function ensureProfile(ask) {
  profile = must(await sb.from('profiles').select('nickname,role,character,wedding_date,wedding_date_range').maybeSingle());
  refreshDates();
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
    window.checklistSync?.setWedding(profile.wedding_date || '');
    refreshDates();
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
    const loginFrom = user && sessionStorage.getItem(LOGIN_FLAG);
    if (loginFrom) {
      sessionStorage.removeItem(LOGIN_FLAG);
      justLoggedIn = true;
      const stay = ['home', 'checklist', 'test'].includes(loginFrom); // 로그인을 누른 화면으로 돌아옴 (test 는 결과가 복원됨)
      await afterLogin(sessionStorage.getItem(KEEP_FLAG) || stay ? null : 'edit');
      if (stay) show(loginFrom);
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
  authChecked = true;
  renderAuth(); // 로그인 확인이 끝났으니 비로그인 안내(guest)를 켤 수 있음
  refreshDates(); // 계정에서 불러온 시안의 촬영일
  if (user) backend.list().then(setDraftDates).catch((e) => console.error('draft dates load failed', e));
  // 로그인 직후에만, 닉네임·신랑신부가 비어 있으면 입력 창. 실패해도 다른 기능은 그대로 씀
  if (user) ensureProfile(justLoggedIn).catch((e) => console.error('profile load failed', e));
  syncChecklist().catch((e) => { console.error('checklist load failed', e); clSyncErr(true); });
  // 초대 화면에서 로그인하고 돌아왔으면 그 초대를 다시 열어 마이페이지에 보관
  // 테스트 결과 화면에서 로그인하고 돌아왔으면 그 결과를 저장
  const keep = sessionStorage.getItem(KEEP_FLAG);
  sessionStorage.removeItem(KEEP_FLAG);
  const kept = keep && window.testResult?.();
  if (user && kept) window.saveTestResult(kept);
  const pendingInvite = sessionStorage.getItem(INVITE_FLAG);
  sessionStorage.removeItem(INVITE_FLAG);
  if (user && pendingInvite) openInviteView(pendingInvite);
  else if (viewFromHash() === 'invite') renderInvite();
  if (viewFromHash() === 'edit') askLogin();
})();
renderAuth();
