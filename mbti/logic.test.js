// 실행: node logic.test.js
const assert = require("assert");
const data = require("./data.js");
const { valueScores, styleCounts, percentages, decideValue, decideStyle, decideCharacter } = require("./logic.js");

const V = data.VALUE_QUESTIONS;
const ST = data.STYLE_QUESTIONS;
const sidx = { D: 0, I: 1, H: 2, A: 3 };
// 문항마다 그 가치가 주 가치인 보기, 없으면 그 가치에 점수를 주는 보기를 고른다
const vals = (s) => [...s].map((c, i) => {
  const opts = V[i].options;
  const main = opts.findIndex((o) => o.main === c);
  return main >= 0 ? main : opts.findIndex((o) => c in o.score);
});
const styles = (s) => [...s].map((c) => sidx[c]);

assert.strictEqual(V.length, 14);
assert.strictEqual(ST.length, 5);

// 모두 같은 가치를 고르면 그 가치
for (const k of "RGMS") assert.strictEqual(decideValue(vals(k.repeat(14)), V), k);

// 2번(결혼하고 싶은 곳)은 주 가치 없이 1점씩
assert.deepStrictEqual(valueScores([0, 0], V.slice(0, 2)), { R: 3, G: 0, M: 1, S: 0 });

// 동점: 앞 문항부터 보되 주 가치가 없는 문항(2번형)은 건너뜀
const q = (main, score) => ({ options: [{ main, score }] });
const tieQs = [q(null, { G: 1, S: 1 }), q("S", { S: 2 }), q("G", { G: 2 })];
assert.strictEqual(decideValue([0, 0, 0], tieQs), "S");
assert.strictEqual(decideValue([0, 0], [q("G", { G: 2 }), q("S", { S: 2 })]), "G");

// 정하는 방식
assert.strictEqual(decideStyle(styles("HHHDD"), ST), "H");
assert.strictEqual(decideStyle(styles("AAAII"), ST), "A");
assert.strictEqual(decideStyle(styles("DDIHA"), ST), "D");
assert.strictEqual(decideStyle(styles("HIDHA"), ST), "I"); // D·I 1개씩, 먼저 나온 I
assert.strictEqual(decideStyle(styles("HADIA"), ST), "D");

// 캐릭터 조합
const md = decideCharacter(vals("M".repeat(14)), styles("DDDII"), data);
assert.strictEqual(md.key, "MD");
assert.deepStrictEqual(md.stylePercent, { D: 60, I: 40, H: 0, A: 0 });
const h = decideCharacter(vals("S".repeat(14)), styles("HHHII"), data);
assert.deepStrictEqual([h.key, h.value], ["H", "S"]);

// 비율
assert.deepStrictEqual(styleCounts(styles("DIHAA"), ST), { D: 1, I: 1, H: 1, A: 2 });
assert.deepStrictEqual(percentages({ a: 1, b: 1, c: 1 }), { a: 34, b: 33, c: 33 });
for (const v of "RGMS") {
  const p = decideCharacter(vals(v.repeat(14)), styles("DDIIH"), data).valuePercent;
  assert.strictEqual(Object.values(p).reduce((a, b) => a + b, 0), 100);
}

// 모든 결과 키에 캐릭터 데이터가 있음
for (const v of "RGMS") for (const s of "DI") assert.ok(data.CHARACTERS[v + s]);
assert.ok(data.CHARACTERS.H && data.CHARACTERS.A);

console.log("ok");
