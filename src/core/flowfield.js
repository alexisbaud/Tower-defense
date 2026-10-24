// Champ de flux (BFS depuis le sanctuaire). Chaque case marchable connaît sa
// distance au sanctuaire ; les yokai descendent simplement le gradient.

const DIRS = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

export function bfs(grid, extraBlocked = -1) {
  const { cols, rows, size } = grid;
  const dist = new Int32Array(size).fill(-1);
  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;
  for (const g of grid.goals) {
    dist[g] = 0;
    queue[tail++] = g;
  }
  while (head < tail) {
    const i = queue[head++];
    const c = i % cols;
    const r = (i / cols) | 0;
    const d = dist[i] + 1;
    for (const [dx, dy] of DIRS) {
      const nc = c + dx;
      const nr = r + dy;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const n = nr * cols + nc;
      if (dist[n] !== -1 || n === extraBlocked || !grid.isWalkable(n)) continue;
      dist[n] = d;
      queue[tail++] = n;
    }
  }
  return dist;
}

export class FlowField {
  constructor(grid) {
    this.grid = grid;
    this.dist = bfs(grid);
    this.version = 0;
  }
  compute() {
    this.dist = bfs(this.grid);
    this.version++;
  }
  // Case suivante depuis i. (dx, dy) = direction actuelle, pour préférer les lignes droites.
  next(i, dx = 0, dy = 0) {
    const { cols, rows } = this.grid;
    const d = this.dist[i];
    if (d <= 0) return -1;
    const c = i % cols;
    const r = (i / cols) | 0;
    let best = -1;
    let bestScore = -Infinity;
    for (const [ex, ey] of DIRS) {
      const nc = c + ex;
      const nr = r + ey;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const n = nr * cols + nc;
      if (this.dist[n] !== d - 1) continue;
      const score = ex * dx + ey * dy;
      if (score > bestScore) {
        bestScore = score;
        best = n;
      }
    }
    return best;
  }
  // Suite de cases depuis `start` jusqu'au sanctuaire (pour l'affichage du tracé).
  route(start) {
    const out = [start];
    let i = start;
    let dx = 0;
    let dy = 0;
    const cols = this.grid.cols;
    for (let guard = 0; guard < this.grid.size; guard++) {
      const n = this.next(i, dx, dy);
      if (n < 0) break;
      dx = (n % cols) - (i % cols);
      dy = ((n / cols) | 0) - ((i / cols) | 0);
      out.push(n);
      i = n;
    }
    return out;
  }
}
