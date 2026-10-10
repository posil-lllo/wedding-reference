const QUESTIONS = [...VALUE_QUESTIONS, ...STYLE_QUESTIONS];
const $ = (id) => document.getElementById(id);

let gender = "여자";
let answers = [];
let resultKey = null;

function show(id) {
  for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== id;
  window.scrollTo(0, 0);
}

// 새로고침해도 진행 상태를 이어 가도록 탭 단위로 저장한다.
const STORAGE_KEY = "wedding-test";

function save() {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ gender, answers })); } catch {}
}

function clearSaved() {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
}

function restore() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
    const isValid = ["여자", "남자"].includes(saved?.gender) && Array.isArray(saved.answers)
      && saved.answers.length <= QUESTIONS.length
      && saved.answers.every((n, i) => Number.isInteger(n) && n >= 0 && n < QUESTIONS[i].options.length);
    if (!isValid) return false;
    ({ gender, answers } = saved);
    return true;
  } catch {
    return false;
  }
}

// 이전 질문으로 돌아가며 잠시 빼 둔 답. 앞이 지금 질문의 답이다.
let ahead = [];

function renderQuestion() {
  save();
  const i = answers.length;
  if (i === QUESTIONS.length) return renderResult();
  const { q, options } = QUESTIONS[i];
  $("count").textContent = `${i + 1} / ${QUESTIONS.length}`;
  $("bar").style.width = `${(i / QUESTIONS.length) * 100}%`;
  $("question").textContent = q;
  $("options").replaceChildren(...options.map((o, n) => {
    const b = document.createElement("button");
    b.className = n === ahead[0] ? "choice selected" : "choice";
    b.textContent = o.text;
    // 문항끼리는 독립이라 답을 바꿔도 뒤 질문 답은 그대로 둔다.
    b.onclick = () => { ahead.shift(); answers.push(n); renderQuestion(); };
    return b;
  }));
  $("back").hidden = i === 0;
  $("next").hidden = ahead.length === 0;
  show("quiz");
}

function renderResult() {
  const valueAnswers = answers.slice(0, VALUE_QUESTIONS.length);
  const styleAnswers = answers.slice(VALUE_QUESTIONS.length);
  const { key, value, valuePercent, stylePercent } = decideCharacter(valueAnswers, styleAnswers, { VALUE_QUESTIONS, STYLE_QUESTIONS });
  const c = CHARACTERS[key];
  resultKey = key;

  const img = $("char-img");
  img.hidden = !c.image;
  img.onerror = () => { img.hidden = true; };
  if (c.image) {
    img.src = encodeURI(`서있는모습/${c.image}-${gender}.png`);
    img.alt = c.name;
  } else {
    img.removeAttribute("src");
  }

  $("char-name").textContent = c.name;
  const isSolo = key === "H" || key === "A";
  $("char-sub").hidden = !isSolo;
  $("char-sub").textContent = isSolo ? `그래도 자꾸 눈이 가는 곳: ${VALUE_NAMES[value]}` : "";
  $("char-line").textContent = c.line;
  $("char-intro").textContent = c.intro;
  $("char-desc").textContent = c.desc;
  renderBars("value-bars", valuePercent, VALUE_NAMES);
  renderBars("style-bars", stylePercent, STYLE_NAMES);
  renderAnswers();
  prepareStory(c);
  show("result");
}

// 휴대폰 공유 창은 누른 직후에만 열리므로 이미지를 결과 화면에서 미리 만들어 둔다.
let storyFile = null;

function prepareStory(c) {
  storyFile = null;
  $("story").hidden = true;
  makeStoryFile(c, gender).then((file) => {
    storyFile = file;
    const canShare = navigator.canShare?.({ files: [file] }) ?? false;
    const label = canShare ? "인스타그램 스토리에 올리기" : "스토리용 이미지 저장하기";
    $("story").ariaLabel = label;
    $("story").title = label;
    $("story").hidden = false;
  }).catch((e) => console.error("스토리 이미지 생성 실패", e));
}

function downloadStory() {
  const url = URL.createObjectURL(storyFile);
  const a = document.createElement("a");
  a.href = url;
  a.download = storyFile.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderAnswers() {
  $("answer-list").replaceChildren(...answers.map((pick, i) => {
    const { q, options } = QUESTIONS[i];
    const item = document.createElement("li");
    const question = document.createElement("p");
    question.className = "q";
    question.textContent = q.replaceAll("\n", " ");
    const answer = document.createElement("p");
    answer.className = "a";
    answer.textContent = options[pick].text;
    item.append(question, answer);
    return item;
  }));
  $("answer-list").closest("details").open = false;
}

// 큰 비율부터 막대로 보여 준다.
function renderBars(id, percent, names) {
  const rows = Object.keys(percent).sort((a, b) => percent[b] - percent[a]).map((k) => {
    const row = document.createElement("div");
    row.className = "bar-row";
    const label = document.createElement("span");
    label.textContent = names[k];
    const track = document.createElement("div");
    track.className = "track";
    const fill = document.createElement("div");
    fill.style.width = `${percent[k]}%`;
    track.append(fill);
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = `${percent[k]}%`;
    row.append(label, track, num);
    return row;
  });
  $(id).replaceChildren(...rows);
}

for (const b of document.querySelectorAll("[data-gender]")) {
  b.onclick = () => { gender = b.dataset.gender; answers = []; ahead = []; renderQuestion(); };
}
$("back").onclick = () => { ahead.unshift(answers.pop()); renderQuestion(); };
$("next").onclick = () => { answers.push(ahead.shift()); renderQuestion(); };
// 카카오 JavaScript 키는 등록한 도메인에서만 동작한다.
const KAKAO_KEY = "eddcdfcb6c5ae4b85f18cec5e60f48c8";
const hasKakao = typeof Kakao !== "undefined";
if (hasKakao && !Kakao.isInitialized()) Kakao.init(KAKAO_KEY);
$("share").hidden = !hasKakao;
$("share").onclick = () => {
  const c = CHARACTERS[resultKey];
  const home = new URL(".", location.href).href;
  const detail = `${home}characters.html?c=${resultKey}&g=${encodeURIComponent(gender)}`;
  Kakao.Share.sendDefault({
    objectType: "feed",
    content: {
      title: `나의 결혼준비 유형은? ${c.name}`,
      description: c.line,
      imageUrl: new URL(encodeURI(`서있는모습/${c.image}-${gender}.png`), location.href).href,
      link: { mobileWebUrl: detail, webUrl: detail },
    },
    buttons: [
      { title: "캐릭터 보기", link: { mobileWebUrl: detail, webUrl: detail } },
      { title: "나도 테스트하기", link: { mobileWebUrl: home, webUrl: home } },
    ],
  });
};
$("story").onclick = async () => {
  if (!storyFile) return;
  if (!navigator.canShare?.({ files: [storyFile] })) return downloadStory();
  try {
    await navigator.share({ files: [storyFile] });
  } catch (e) {
    if (e.name !== "AbortError") downloadStory();
  }
};
$("restart").onclick = () => { answers = []; clearSaved(); show("start"); };
if (restore()) renderQuestion();
