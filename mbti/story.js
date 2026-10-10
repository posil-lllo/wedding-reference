// 인스타그램 스토리 크기(1080×1920) 결과 이미지를 만든다.
// 웹에서는 스토리에 바로 올리는 API가 없어서, 이미지를 휴대폰 공유 창으로 넘긴다.
const STORY_W = 1080;
const STORY_H = 1920;
const STORY_FONT = '-apple-system, "Apple SD Gothic Neo", "Pretendard", "Noto Sans KR", sans-serif';

// 공백 기준으로 maxWidth 안에 들어가게 줄을 나눈다.
function wrapLines(ctx, text, maxWidth) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  return line ? [...lines, line] : lines;
}

async function makeStoryFile(c, gender) {
  const img = new Image();
  img.src = encodeURI(`서있는모습/${c.image}-${gender}.png`);
  await img.decode();

  const canvas = document.createElement("canvas");
  canvas.width = STORY_W;
  canvas.height = STORY_H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff8f3";
  ctx.fillRect(0, 0, STORY_W, STORY_H);
  ctx.textAlign = "center";

  ctx.fillStyle = "#9a8585";
  ctx.font = `500 44px ${STORY_FONT}`;
  ctx.fillText("나의 결혼 준비 캐릭터는", STORY_W / 2, 330);

  // 결과 화면의 그림 틀(12:13, 분홍 배경, 아래 정렬)과 같은 모양
  const frameW = 800;
  const frameH = Math.round((frameW * 13) / 12);
  const frameX = (STORY_W - frameW) / 2;
  const frameY = 390;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(frameX, frameY, frameW, frameH, 60);
  ctx.fillStyle = "#feeef2";
  ctx.fill();
  ctx.clip();
  const scale = Math.min(frameW / img.naturalWidth, frameH / img.naturalHeight);
  const imgW = img.naturalWidth * scale;
  const imgH = img.naturalHeight * scale;
  ctx.drawImage(img, frameX + (frameW - imgW) / 2, frameY + frameH - imgH, imgW, imgH);
  ctx.restore();

  ctx.fillStyle = "#4a3a3a";
  ctx.font = `700 88px ${STORY_FONT}`;
  ctx.fillText(c.name, STORY_W / 2, frameY + frameH + 130);

  ctx.font = `400 46px ${STORY_FONT}`;
  wrapLines(ctx, c.line, 860).forEach((line, i) => {
    ctx.fillText(line, STORY_W / 2, frameY + frameH + 230 + i * 72);
  });

  ctx.fillStyle = "#d77a92";
  ctx.font = `600 40px ${STORY_FONT}`;
  ctx.fillText("나는 어떤 예비부부일까?", STORY_W / 2, 1660);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("스토리 이미지를 만들지 못했습니다");
  return new File([blob], "wedding-character.png", { type: "image/png" });
}
