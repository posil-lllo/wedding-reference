// 홈(index.html) SPA 의 #/chars 화면. 홈 스크립트와 이름이 겹치지 않게 함수로 감쌈
(() => {
  const GENDERS = [["여자", "신부"], ["남자", "신랑"]];
  const $ = (id) => document.getElementById(id);
  const detail = $("detail");

  function openDetail(key, gender) {
    const c = CHARACTERS[key];
    $("d-img").src = encodeURI(`mbti/서있는모습/${c.image}-${gender}.png`);
    $("d-img").alt = c.name;
    $("d-name").textContent = c.name;
    $("d-line").textContent = c.line;
    $("d-intro").textContent = c.intro;
    $("d-desc").textContent = c.desc;
    detail.showModal();
    detail.scrollTop = 0;
  }

  $("list").replaceChildren(...Object.entries(CHARACTERS).map(([key, c]) => {
    const pair = document.createElement("section");
    pair.className = "t-pair";
    const name = document.createElement("h2");
    name.textContent = c.name;
    const cols = document.createElement("div");
    cols.className = "cols";
    cols.append(...GENDERS.map(([gender, label]) => {
      const cell = document.createElement("button");
      cell.className = "cell";
      cell.onclick = () => openDetail(key, gender);
      const frame = document.createElement("div");
      frame.className = "frame";
      const img = document.createElement("img");
      img.src = encodeURI(`mbti/썸네일/${c.image}-${gender}.webp`); // 리스트는 작은 그림, 상세 팝업은 원본
      img.alt = `${c.name} ${label}`;
      img.loading = "lazy"; // 홈에서도 같이 불리므로 이 화면을 열 때 받음
      frame.append(img);
      cell.append(frame, label);
      return cell;
    }));
    pair.append(name, cols);
    return pair;
  }));

  detail.querySelector(".close").onclick = () => detail.close();
  detail.onclick = (e) => { if (e.target === detail) detail.close(); };
  // 공유 링크(#/chars?c=캐릭터&g=성별)로 열면 그 캐릭터 설명을 바로 띄우고, 닫으면 주소에서 지운다.
  detail.onclose = () => { if (location.hash.includes("?")) history.replaceState(null, "", "#/chars"); };

  // app.js 의 renderView 가 #/chars 를 띄울 때 부름
  window.openSharedChar = () => {
    const params = new URLSearchParams(location.hash.split("?")[1]);
    const key = params.get("c");
    if (!Object.hasOwn(CHARACTERS, key ?? "")) return;
    const gender = GENDERS.some(([g]) => g === params.get("g")) ? params.get("g") : "여자";
    openDetail(key, gender);
  };
})();
