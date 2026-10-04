// 3:4 타일 n장을 w×h 상자에 가장 크게 들어가도록 열 수와 타일 너비를 고른다 (단위는 호출자 기준)
function fitCols(n, w, h, gap) {
  let best = { cols: 1, tile: 0 };
  for (let c = 1; c <= n; c++) {
    const rows = Math.ceil(n / c);
    const byWidth = (w - (c - 1) * gap) / c;
    const byHeight = ((h - (rows - 1) * gap) / rows) * (3 / 4);
    const tile = Math.min(byWidth, byHeight);
    if (tile > best.tile) best = { cols: c, tile };
  }
  return { cols: best.cols, tile: Math.floor(best.tile * 100) / 100 };
}

if (typeof module === 'object') module.exports = { fitCols };
