// 문의하기: 상단 문의 아이콘의 팝업(#fb)에 폼을 그려 Supabase inquiries 테이블·버킷에 저장 (supabase/schema.sql)
// 홈(index.html)과 성향 테스트(mbti/) 페이지가 이 파일 하나를 같이 씀. supabase-js 가 없는 페이지면 처음 보낼 때 받아 옴
(() => {
  // account.js 와 같은 공개(publishable) 키. 문의는 넣기만 되고 읽기는 RLS 로 막혀 있음
  const SB_URL = 'https://yucqtbuefqjdoszhavzb.supabase.co';
  const SB_KEY = 'sb_publishable_BUsTCR2Q9rQx6W8D4otopg_s4ooALX-';
  const SB_LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  const BUCKET = 'inquiries';
  const MAX_PHOTOS = 2;
  const PHOTO_MAX = 1600; // 긴 변(px). 시안 사진을 미리 읽어 둘 때와 같은 크기
  const KINDS = [['error', '에러'], ['improve', '개선 요청'], ['feedback', '피드백'], ['etc', '기타']];
  const SERVICES = [['mbti', '결혼 준비 성향 테스트'], ['reference', '시안 만들기']];

  const base = new URL('.', document.currentScript.src); // 이 파일이 있는 곳 = 사이트 루트
  const pop = document.getElementById('fb');
  const track = (name, params = {}) => window.gtag?.('event', name, params);
  const must = ({ data, error }) => {
    if (error) throw error;
    return data;
  };

  const chips = (name, items, checked) => items.map(([v, label]) =>
    `<label><input type="radio" name="${name}" value="${v}" required${v === checked ? ' checked' : ''}><span>${label}</span></label>`).join('');

  document.head.insertAdjacentHTML('beforeend', `<style>
#fb.inq-pop { width: min(420px, calc(100vw - 32px)); max-width: none; max-height: calc(100dvh - 32px); overflow: auto; padding: 20px; border: 1px solid #eae7dc; border-radius: 10px; background: #fffefa; color: #3a3d44; font-size: 13px; line-height: 1.6; box-shadow: 0 8px 24px rgb(0 0 0 / .12); }
#fb.inq-pop::backdrop { background: rgb(0 0 0 / .25); }
.inq { display: grid; gap: 14px; }
.inq h2 { margin: 0; font-size: 16px; }
.inq fieldset { margin: 0; padding: 0; border: 0; min-width: 0; }
.inq legend, .inq-label { display: block; margin-bottom: 6px; font-weight: 700; }
.inq small { font-weight: 400; color: #8a8d93; }
.inq-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.inq-chips input { position: absolute; opacity: 0; pointer-events: none; }
.inq-chips span { display: inline-block; padding: 5px 12px; border: 1px solid #eae7dc; border-radius: 999px; background: #fff; cursor: pointer; }
.inq-chips input:checked + span { border-color: #6a9edb; background: #6a9edb; color: #fff; }
.inq-chips input:focus-visible + span { outline: 2px solid #6d93bd; outline-offset: 2px; }
.inq textarea, .inq input[type=text] { display: block; width: 100%; padding: 8px 10px; border: 1px solid #eae7dc; border-radius: 6px; background: #fff; font: inherit; color: inherit; }
.inq textarea { resize: vertical; min-height: 110px; }
.inq-photos { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.inq-photos figure { position: relative; margin: 0; width: 72px; height: 72px; }
.inq-photos img { width: 100%; height: 100%; object-fit: cover; border-radius: 6px; border: 1px solid #eae7dc; }
.inq-photos figure button { position: absolute; top: -6px; right: -6px; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 50%; background: #3a3d44; color: #fff; font-size: 12px; line-height: 22px; cursor: pointer; }
.inq-add { display: grid; place-items: center; width: 72px; height: 72px; border: 1px dashed #c9c6bb; border-radius: 6px; color: #6d93bd; font-size: 12px; cursor: pointer; }
.inq-add input { position: absolute; opacity: 0; pointer-events: none; }
.inq-add:focus-within { outline: 2px solid #6d93bd; outline-offset: 2px; }
.inq-msg { margin: 0; min-height: 1.6em; color: #6d93bd; }
.inq-msg.err { color: #b88378; }
.inq-btns { display: flex; justify-content: flex-end; gap: 8px; }
.inq-btns button { padding: 5px 14px; border: 1px solid #6a9edb; border-radius: 6px; background: #6a9edb; color: #fff; font: inherit; cursor: pointer; }
.inq-btns button:disabled { opacity: .6; cursor: progress; }
.inq-btns .soft { border-color: #f1f0ec; background: #f1f0ec; color: #3a3d44; }
</style>`);

  // 바깥을 눌러도 쓰던 내용이 날아가지 않게 manual. Esc·닫기 버튼으로만 닫음
  pop.popover = 'manual';
  pop.className = 'inq-pop';
  pop.setAttribute('aria-label', '문의하기');
  pop.innerHTML = `<form class="inq">
    <h2>문의하기</h2>
    <fieldset><legend>문의 종류</legend><div class="inq-chips">${chips('kind', KINDS)}</div></fieldset>
    <fieldset><legend>대상 서비스</legend><div class="inq-chips">${chips('service', SERVICES, location.pathname.includes('/mbti/') ? 'mbti' : 'reference')}</div></fieldset>
    <label><span class="inq-label">내용</span><textarea name="body" maxlength="2000" required placeholder="어떤 화면에서 무엇을 하다가 생긴 일인지 적어 주시면 빨리 찾을 수 있어요."></textarea></label>
    <div><span class="inq-label">참고 사진 <small>(${MAX_PHOTOS}장까지)</small></span><div class="inq-photos"></div></div>
    <label><span class="inq-label">안내받을 연락처 또는 메일 <small>(선택)</small></span><input type="text" name="contact" maxlength="100" autocomplete="email" placeholder="010-0000-0000 또는 name@example.com"></label>
    <p class="inq-msg" role="status"></p>
    <div class="inq-btns"><button type="button" class="soft" data-close>닫기</button><button type="submit">보내기</button></div>
  </form>`;
  const form = pop.querySelector('form');
  const photosEl = pop.querySelector('.inq-photos');
  const msg = pop.querySelector('.inq-msg');
  const send = form.querySelector('[type=submit]');
  let photos = []; // { blob, url } — 이미 줄여 둔 JPEG

  const say = (text, isErr = false) => {
    msg.textContent = text;
    msg.classList.toggle('err', isErr);
  };
  const renderPhotos = () => {
    photosEl.innerHTML = photos.map((p, i) => `<figure><img src="${p.url}" alt="참고 사진 ${i + 1}"><button type="button" data-rm="${i}" aria-label="참고 사진 ${i + 1} 빼기">✕</button></figure>`).join('')
      + (photos.length < MAX_PHOTOS ? '<label class="inq-add">사진 추가<input type="file" accept="image/*" multiple></label>' : '');
  };

  // 시안 사진처럼 긴 변을 줄여 JPEG 로. 아이폰 HEIC 를 못 읽는 브라우저면 홈과 같은 변환 라이브러리를 씀
  async function decode(file) {
    const options = { imageOrientation: 'from-image' };
    try {
      return await createImageBitmap(file, options);
    } catch (e) {
      if (!/^image\/hei[cf]/.test(file.type) && !/\.hei[cf]$/i.test(file.name)) throw e;
      const { heicTo } = await import(new URL('vendor/heic-to.js', base));
      return heicTo({ blob: file, type: 'bitmap', options });
    }
  }
  async function compress(file) {
    const bmp = await decode(file);
    const k = Math.min(1, PHOTO_MAX / Math.max(bmp.width, bmp.height));
    const c = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; // 투명 PNG 가 JPEG 에서 검게 나오지 않게
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('jpeg encode failed'))), 'image/jpeg', 0.85));
  }

  let client;
  async function getClient() {
    if (client) return client;
    if (typeof sb !== 'undefined') return (client = sb); // 홈: account.js 의 클라이언트. 로그인했으면 user_id 가 같이 남음
    if (!window.supabase) {
      await new Promise((ok, fail) => document.head.append(Object.assign(document.createElement('script'), { src: SB_LIB, onload: ok, onerror: () => fail(new Error('supabase-js load failed')) })));
    }
    return (client = window.supabase.createClient(SB_URL, SB_KEY));
  }

  const reset = () => {
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    photos = [];
    form.reset();
    renderPhotos();
  };

  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') pop.hidePopover();
  });
  pop.addEventListener('toggle', (e) => {
    if (e.newState === 'open') {
      say('');
      form.querySelector('input')?.focus();
    }
  });
  pop.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) pop.hidePopover();
    const rm = e.target.closest('[data-rm]');
    if (!rm) return;
    const [gone] = photos.splice(Number(rm.dataset.rm), 1);
    URL.revokeObjectURL(gone.url);
    renderPhotos();
  });
  pop.addEventListener('change', async (e) => {
    if (e.target.type !== 'file') return;
    const files = [...e.target.files];
    const room = MAX_PHOTOS - photos.length;
    if (files.length > room) say(`참고 사진은 ${MAX_PHOTOS}장까지라 앞의 ${room}장만 넣었어요.`);
    else say('사진 줄이는 중…');
    const done = await Promise.allSettled(files.slice(0, room).map(compress));
    const ok = done.filter((r) => r.status === 'fulfilled').map((r) => ({ blob: r.value, url: URL.createObjectURL(r.value) }));
    photos = [...photos, ...ok];
    renderPhotos();
    if (ok.length < done.length) {
      done.filter((r) => r.status === 'rejected').forEach((r) => console.warn('inquiry photo failed', r.reason));
      say('읽지 못한 사진이 있어요. JPG·PNG 로 다시 골라 주세요.', true);
    } else if (files.length <= room) say('');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const body = String(f.get('body')).trim();
    if (!body) {
      say('내용을 적어 주세요.', true);
      return;
    }
    send.disabled = true;
    say('보내는 중…');
    try {
      const c = await getClient();
      const paths = await Promise.all(photos.map(async (p) => {
        const path = `${crypto.randomUUID()}.jpg`;
        must(await c.storage.from(BUCKET).upload(path, p.blob, { contentType: 'image/jpeg' }));
        return path;
      }));
      const row = { kind: f.get('kind'), service: f.get('service'), body, contact: String(f.get('contact')).trim() || null, photos: paths, page: location.href.slice(0, 300) };
      must(await c.from('inquiries').insert(row));
      track('inquiry_submit', { kind: row.kind, service: row.service, photos: paths.length });
      reset();
      say('보냈어요. 확인하고 연락드릴게요!');
    } catch (err) {
      console.error('inquiry submit failed', err);
      say('보내지 못했어요. 잠시 뒤 다시 시도해 주세요.', true);
    } finally {
      send.disabled = false;
    }
  });

  renderPhotos();
})();
