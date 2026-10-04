// 결과 슬라이드(16:9) 렌더링과 PDF 내보내기. 크기 단위는 cqw (슬라이드 너비 = 100)
const BODY_W = 90;
const BODY_H = 39;
const GAP = 2.4;
const TILE_GAP = 0.5;
const LABEL_H = 2.6;
const HAIR_PER_SLIDE = 4;
const DRESS_PER_SLIDE = 2;
const ITEM_KINDS = [['dress', 'Dress', '드레스'], ['bouquet', 'Bouquet', '부케'], ['boutonniere', 'Boutonniere', '부토니에']];
const WEEK = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = (s) => esc(s).replace(/\n/g, '<br>');
const pad2 = (n) => String(n).padStart(2, '0');
const chunk = (arr, size) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

function fmtDate(v) {
  if (!v) return '';
  const [y, m, d] = v.split('-').map(Number);
  return `${y}. ${pad2(m)}. ${pad2(d)} · ${WEEK[new Date(y, m - 1, d).getDay()]}`;
}
const timeRange = (a, b) => (a || b ? `${a || '?'} – ${b || '?'}` : '');

function collage(imgs, w, h, label, kind) {
  if (!imgs.length) return '';
  const { tile } = fitCols(imgs.length, w, h - (label ? LABEL_H : 0), TILE_GAP);
  return `<div class="collage ${kind}" style="width:${w}cqw">
    ${label ? `<div class="s-lbl">${label}</div>` : ''}
    <div class="tiles">${imgs.map((src) => `<img class="tile" src="${src}" alt="" style="width:${tile}cqw">`).join('')}</div>
  </div>`;
}

// 좋아요·싫어요 콜라주를 사진 수에 비례해 너비를 나눠 배치
function likeDislike(like, dislike, w) {
  const parts = [[like, '좋아요', 'like'], [dislike, '싫어요', 'dislike']].filter(([imgs]) => imgs.length);
  if (!parts.length) return '';
  if (parts.length === 1) return collage(parts[0][0], w, BODY_H, parts[0][1], parts[0][2]);
  const free = w - GAP;
  const share = Math.min(0.7, Math.max(0.3, like.length / (like.length + dislike.length)));
  const widths = [free * share, free * (1 - share)];
  return parts.map(([imgs, label, kind], i) => collage(imgs, widths[i], BODY_H, label, kind)).join('');
}

const titled = (en, ko, who, body) => `<div class="s-pad">
  <div class="s-title"><span class="en">${en}</span><h3>${ko}</h3>${who ? `<span class="who">${esc(who)}</span>` : ''}</div>
  <div class="s-body">${body}</div>
</div>`;

function coverSlide(s) {
  const isSnap = s.studio.kind === '스냅';
  const sched = [
    { src: s.makeup, en: 'Makeup', name: [s.makeup.name, s.makeup.teacher && `${s.makeup.teacher} 선생님`].filter(Boolean).join(' · '), link: s.makeup.link },
    { src: s.studio, en: isSnap ? 'Snap' : 'Studio', name: [s.studio.name, !isSnap && s.studio.total].filter(Boolean).join(' · ') },
  ]
    .map((x) => ({ ...x, start: x.src.start, end: x.src.end }))
    .filter((x) => x.src.name || x.start || x.end)
    .sort((a, b) => (a.start || '99').localeCompare(b.start || '99'));
  const nameHtml = (x) => (x.link ? `<a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.name)}</a>` : esc(x.name));
  return `<div class="lace"><i class="edge-l"></i><i class="edge-r"></i>
    <div class="invite">
      <div class="kicker">웨딩 촬영 레퍼런스</div>
      <div class="names">${esc(s.basic.groom || '신랑')}<span class="amp">&amp;</span>${esc(s.basic.bride || '신부')}</div>
      ${s.basic.date ? `<div class="date">${fmtDate(s.basic.date)}</div>` : ''}
      ${sched.length ? `<div class="sched">${sched.map((x) => `<div><b>${x.en}</b>${nameHtml(x)}<span>${timeRange(x.start, x.end)}</span></div>`).join('')}</div>` : ''}
    </div>
  </div>`;
}

function makeupSlide(mu, who) {
  const hasImgs = mu.like.length || mu.dislike.length;
  const textW = hasImgs ? 26 : BODY_W;
  const block = (label, v) => (v ? `<div><div class="s-lbl">${label}</div><div class="s-txt">${nl(v)}</div></div>` : '');
  const text = mu.worry || mu.want ? `<div class="s-text" style="width:${textW}cqw">${block('고민인 부분', mu.worry)}${block('원하는 느낌', mu.want)}</div>` : '';
  const right = BODY_W - (text ? textW + GAP : 0);
  return titled('Makeup', '메이크업 시안', who, text + likeDislike(mu.like, mu.dislike, right));
}

function hairSlide(items, who) {
  const w = (BODY_W - GAP * (HAIR_PER_SLIDE - 1)) / HAIR_PER_SLIDE;
  const cards = items.map((h) => `<div class="hcard" style="width:${w}cqw">
    ${h.imgs.length ? collage(h.imgs, w, BODY_H - 7, '', '') : '<div class="tile empty"></div>'}
    <div class="nm">${esc(h.name)}</div><div class="ds">${nl(h.desc)}</div>
  </div>`);
  return titled('Hair', '헤어 시안', who, cards.join(''));
}

function itemSlide(items, en, ko) {
  const w = (BODY_W - GAP * (DRESS_PER_SLIDE - 1)) / DRESS_PER_SLIDE;
  const cards = items.map((d) => `<div class="hcard" style="width:${w}cqw">
    ${collage(d.imgs, w, BODY_H - 7, '', '')}
    <div class="nm">${esc(d.name)}</div><div class="ds">${nl(d.desc)}</div>
  </div>`);
  return titled(en, ko, '', cards.join(''));
}

function shotSlide(shot, i, s) {
  const picked = (list, id, label) => {
    const x = list.find((d) => d.id === id);
    return x && `<div><dt>${label}</dt><dd>${esc(x.name)}</dd><div class="mini">${x.imgs.slice(0, 3).map((src) => `<img class="tile" src="${src}" alt="">`).join('')}</div></div>`;
  };
  const meta = [
    shot.place && `<div><dt>장소</dt><dd>${esc(shot.place)}</dd></div>`,
    picked([...s.hair.bride, ...s.hair.groom], shot.hair, '헤어'),
    ...ITEM_KINDS.map(([key, , ko]) => picked(s[key], shot[key], ko)),
  ].filter(Boolean);
  // ponytail: 4개 이상이면 2열로 접어 세로 넘침 방지
  const isTwoCol = meta.length > 3;
  const metaW = isTwoCol ? 30 : 18;
  const right = BODY_W - (meta.length ? metaW + GAP : 0);
  const metaHtml = meta.length ? `<dl class="meta${isTwoCol ? ' two' : ''}" style="width:${metaW}cqw">${meta.join('')}</dl>` : '';
  return titled(`Scene ${pad2(i + 1)}`, '촬영 시안', shot.name || shot.place, metaHtml + likeDislike(shot.like, shot.dislike, right));
}

function buildSlides(s) {
  const slides = [{ cap: '커버', cls: 'cover', html: coverSlide(s) }];
  const people = [['bride', '신부', s.basic.bride], ['groom', '신랑', s.basic.groom]];
  for (const [side, label, name] of people) {
    const mu = s.mu[side];
    if (mu.worry || mu.want || mu.like.length || mu.dislike.length) {
      slides.push({ cap: `메이크업 · ${label}`, html: makeupSlide(mu, `${label} ${name}`.trim()) });
    }
  }
  for (const [side, label, name] of people) {
    chunk(s.hair[side], HAIR_PER_SLIDE).forEach((items) => slides.push({ cap: `헤어 · ${label}`, html: hairSlide(items, `${label} ${name}`.trim()) }));
  }
  for (const [key, en, ko] of ITEM_KINDS) {
    chunk(s[key], DRESS_PER_SLIDE).forEach((items) => slides.push({ cap: ko, html: itemSlide(items, en, ko) }));
  }
  s.shots.forEach((shot, i) => slides.push({ cap: `촬영 시안 · ${shot.name || `컷 ${i + 1}`}`, html: shotSlide(shot, i, s) }));
  return slides;
}

function renderDeck(s) {
  return buildSlides(s)
    .map((x, i) => `<section class="slide-wrap"><div class="slide-cap"><b>p.${i + 1}</b> ${x.cap}</div><div class="slide ${x.cls || ''}">${x.html}</div></section>`)
    .join('');
}

// 슬라이드를 1280px 고정 폭으로 캡처해 가로 PDF 한 파일로 이어 붙임
async function exportPdf(deckEl, filename) {
  const { jsPDF } = window.jspdf;
  await document.fonts.ready;
  deckEl.classList.add('exporting');
  try {
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [960, 540] });
    const slides = [...deckEl.querySelectorAll('.slide')];
    for (const [i, el] of slides.entries()) {
      const canvas = await html2canvas(el, { scale: 1.5, useCORS: true, backgroundColor: null });
      if (i) pdf.addPage([960, 540], 'landscape');
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 960, 540);
    }
    pdf.save(filename);
  } finally {
    deckEl.classList.remove('exporting');
  }
}
