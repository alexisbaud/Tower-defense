// Grille du niveau : types de cases, pierres posées par le joueur.

export const T = {
  VOID: 0,
  PATH: 1,
  OPEN: 2,
  SLOT: 3,
  SPAWN: 4,
  GOAL: 5,
  TREE: 6,
  WATER: 7,
  ROCK: 8,
  BRIDGE: 9,
  GRASS: 10,
};

export const LEGEND = {
  ' ': T.VOID,
  '.': T.PATH,
  o: T.OPEN,
  '#': T.SLOT,
  S: T.SPAWN,
  G: T.GOAL,
  T: T.TREE,
  '~': T.WATER,
  R: T.ROCK,
  '=': T.BRIDGE,
  ',': T.GRASS,
};

const WALKABLE = new Set([T.PATH, T.OPEN, T.SPAWN, T.GOAL, T.BRIDGE]);

export class Grid {
  constructor(map) {
    this.rows = map.length;
    this.cols = map[0].length;
    this.size = this.cols * this.rows;
    this.types = new Uint8Array(this.size);
    this.stone = new Uint8Array(this.size);
    this.spawns = [];
    this.goals = [];
    for (let r = 0; r < this.rows; r++) {
      const line = map[r];
      for (let c = 0; c < this.cols; c++) {
        const ch = line[c] ?? ' ';
        const t = LEGEND[ch] ?? T.VOID;
        const i = r * this.cols + c;
        this.types[i] = t;
        if (t === T.SPAWN) this.spawns.push(i);
        if (t === T.GOAL) this.goals.push(i);
      }
    }
  }
  idx(c, r) {
    return r * this.cols + c;
  }
  col(i) {
    return i % this.cols;
  }
  row(i) {
    return (i / this.cols) | 0;
  }
  inBounds(c, r) {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows;
  }
  cx(i) {
    return (i % this.cols) + 0.5;
  }
  cy(i) {
    return ((i / this.cols) | 0) + 0.5;
  }
  type(i) {
    return this.types[i];
  }
  isWalkableType(i) {
    return WALKABLE.has(this.types[i]);
  }
  isWalkable(i) {
    return WALKABLE.has(this.types[i]) && !this.stone[i];
  }
  tileAt(x, y) {
    const c = Math.floor(x);
    const r = Math.floor(y);
    if (!this.inBounds(c, r)) return -1;
    return r * this.cols + c;
  }
}
