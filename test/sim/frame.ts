// Frames, word boxes and OCR noise for the TV simulator.
//
// App models draw in a 1920×1080 reference frame; the simulated TV scales words to its own screenshot resolution
// (a 4K Google TV hands back 3840×2160 PNGs), so navigators see what tesseract would give them on that device.

export interface SimWord {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export const REF_W = 1920;
export const REF_H = 1080;

/** One line of text as words, starting at (x, y) in the reference frame. */
export function line(text: string, x: number, y: number, size = 32): SimWord[] {
  const out: SimWord[] = [];
  let cx = x;
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const width = Math.max(1, Math.round(w.length * size * 0.55));
    out.push({ text: w, left: cx, top: y, width, height: size });
    cx += width + Math.round(size * 0.4);
  }
  return out;
}

/** Several lines stacked down from (x, y). */
export function lines(rows: string[], x: number, y: number, size = 32, gap = 1.6): SimWord[] {
  return rows.flatMap((r, i) => line(r, x, Math.round(y + i * size * gap), size));
}

/** Reading order, roughly what tesseract's sparse mode returns: top to bottom, then left to right. */
export function readingOrder(words: SimWord[]): SimWord[] {
  return words.slice().sort((a, b) => Math.round(a.top / 12) - Math.round(b.top / 12) || a.left - b.left);
}

export function scaleWords(words: SimWord[], width: number, height: number): SimWord[] {
  const sx = width / REF_W;
  const sy = height / REF_H;
  return words.map((w) => ({
    text: w.text,
    left: Math.round(w.left * sx),
    top: Math.round(w.top * sy),
    width: Math.round(w.width * sx),
    height: Math.round(w.height * sy),
  }));
}

// Single-character confusions tesseract makes on TV fonts.
const CONFUSIONS: [string, string][] = [
  ["o", "0"], ["O", "0"], ["l", "1"], ["I", "l"], ["i", "l"], ["e", "c"], ["a", "o"], ["n", "h"],
  ["rn", "m"], ["m", "rn"], ["S", "5"], ["s", "5"], ["B", "8"], ["G", "6"], ["u", "v"], ["c", "e"],
];

/** One plausible misread of a word (or the word itself when no confusion applies). */
export function misread(word: string, rnd: () => number): string {
  const options = CONFUSIONS.filter(([from]) => word.includes(from));
  if (!options.length) return word;
  const [from, to] = options[Math.floor(rnd() * options.length)];
  // Replace one occurrence, chosen at random.
  const spots: number[] = [];
  for (let i = word.indexOf(from); i >= 0; i = word.indexOf(from, i + 1)) spots.push(i);
  const at = spots[Math.floor(rnd() * spots.length)];
  return word.slice(0, at) + to + word.slice(at + from.length);
}

// --- fake PNGs: a real signature and IHDR size (so server/ocr.ts-style readers get the resolution), plus a frame id ---

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function fakePng(frameId: number, width: number, height: number): Buffer {
  const b = Buffer.alloc(32);
  SIG.copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  b.writeUInt32BE(frameId, 24);
  return b;
}

export function fakePngInfo(png: Buffer): { frameId: number; width: number; height: number } {
  if (png.length < 28 || !png.subarray(0, 8).equals(SIG)) throw new Error("libpng error: not a PNG");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20), frameId: png.readUInt32BE(24) };
}
