// valueAnswers: 가치관 문항별 고른 보기 번호, styleAnswers: 정하는 방식 문항별 고른 보기 번호

function valueScores(valueAnswers, questions) {
  const scores = { R: 0, G: 0, M: 0, S: 0 };
  valueAnswers.forEach((pick, i) => {
    const s = questions[i].options[pick].score;
    for (const k in s) scores[k] += s[k];
  });
  return scores;
}

// 최고점 가치. 동점이면 앞 문항부터 보며 주 가치가 동점 가치인 첫 답을 따른다.
function decideValue(valueAnswers, questions) {
  const scores = valueScores(valueAnswers, questions);
  const top = Math.max(...Object.values(scores));
  const tied = Object.keys(scores).filter((k) => scores[k] === top);
  if (tied.length === 1) return tied[0];
  for (let i = 0; i < valueAnswers.length; i++) {
    const main = questions[i].options[valueAnswers[i]].main;
    if (tied.includes(main)) return main;
  }
  return tied[0];
}

function styleCounts(styleAnswers, questions) {
  const counts = { D: 0, I: 0, H: 0, A: 0 };
  for (const [i, pick] of styleAnswers.entries()) counts[questions[i].options[pick].style] += 1;
  return counts;
}

// 고민 3개 이상 H, 맞춤 3개 이상 A, 나머지는 설계·직감 중 많은 쪽(같으면 먼저 나온 쪽).
function decideStyle(styleAnswers, questions) {
  const { D, I, H, A } = styleCounts(styleAnswers, questions);
  if (H >= 3) return "H";
  if (A >= 3) return "A";
  if (D !== I) return D > I ? "D" : "I";
  const picks = styleAnswers.map((pick, i) => questions[i].options[pick].style);
  return picks.find((p) => p === "D" || p === "I");
}

// 합이 정확히 100 이 되는 정수 백분율(최대 나머지 방식)
function percentages(counts) {
  const keys = Object.keys(counts);
  const total = keys.reduce((sum, k) => sum + counts[k], 0);
  const raw = keys.map((k) => (counts[k] * 100) / total);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = keys.map((_, i) => i).sort((a, b) => (raw[b] - floors[b]) - (raw[a] - floors[a]));
  const result = {};
  keys.forEach((k, i) => { result[k] = floors[i]; });
  for (const i of order) { if (left-- <= 0) break; result[keys[i]] += 1; }
  return result;
}

function decideCharacter(valueAnswers, styleAnswers, data) {
  const value = decideValue(valueAnswers, data.VALUE_QUESTIONS);
  const style = decideStyle(styleAnswers, data.STYLE_QUESTIONS);
  return {
    key: style === "H" || style === "A" ? style : value + style,
    value,
    valuePercent: percentages(valueScores(valueAnswers, data.VALUE_QUESTIONS)),
    stylePercent: percentages(styleCounts(styleAnswers, data.STYLE_QUESTIONS)),
  };
}

if (typeof module !== "undefined") module.exports = { valueScores, styleCounts, percentages, decideValue, decideStyle, decideCharacter };
