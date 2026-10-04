// 실행: node collage.test.js
const assert = require('assert');
const { fitCols } = require('./collage.js');

const fits = (n, w, h, gap) => {
  const { cols, tile } = fitCols(n, w, h, gap);
  const rows = Math.ceil(n / cols);
  assert.ok(cols * tile + (cols - 1) * gap <= w + 1e-9, `width overflow n=${n}`);
  assert.ok(rows * tile * (4 / 3) + (rows - 1) * gap <= h + 1e-9, `height overflow n=${n}`);
  return { cols, tile };
};

for (let n = 1; n <= 12; n++) fits(n, 30, 35, 0.5);
assert.deepStrictEqual(fits(1, 30, 35, 0.5), { cols: 1, tile: 26.25 });
assert.strictEqual(fits(4, 60, 35, 0.5).cols, 4); // 넓은 상자는 한 줄
assert.strictEqual(fits(4, 20, 60, 0.5).cols, 1); // 좁고 긴 상자는 한 열
console.log('collage ok');
