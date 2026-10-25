import { execFile } from "node:child_process";

// Reads the text on a screenshot with the tesseract command line tool (apt install tesseract-ocr).
// The PNG goes in on stdin and the text comes back on stdout; nothing is written to disk and no shell is used.

export type Ocr = (png: Buffer) => Promise<string>;

export function makeTesseract(bin = process.env.TESSERACT_BIN ?? "tesseract"): Ocr {
  return (png) =>
    new Promise((resolve, reject) => {
      // --psm 11: sparse text, which suits a TV UI of tiles and titles.
      const p = execFile(bin, ["stdin", "stdout", "--psm", "11"], { timeout: 20_000, maxBuffer: 4 << 20 }, (err, stdout) =>
        err ? reject(err) : resolve(String(stdout)));
      p.stdin?.on("error", () => undefined);
      p.stdin?.end(png);
    });
}

/** True when the tesseract binary can run; used once at startup to decide whether OCR-checked routes are on. */
export function tesseractAvailable(bin = process.env.TESSERACT_BIN ?? "tesseract"): Promise<boolean> {
  return new Promise((resolve) => execFile(bin, ["--version"], { timeout: 5000 }, (err) => resolve(!err)));
}

export interface OcrWord {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface OcrPage {
  words: OcrWord[];
  height: number; // image height in pixels
  width?: number; // image width in pixels (defaults to 1920 where it matters)
}
export type OcrBoxes = (png: Buffer) => Promise<OcrPage>;

/** Same tool, TSV output: every word with its position, so a caller can read just one region of the screen. */
export function makeTesseractBoxes(bin = process.env.TESSERACT_BIN ?? "tesseract"): OcrBoxes {
  return (png) =>
    new Promise((resolve, reject) => {
      const p = execFile(bin, ["stdin", "stdout", "--psm", "11", "tsv"], { timeout: 20_000, maxBuffer: 8 << 20 }, (err, stdout) => {
        if (err) return reject(err);
        const words: OcrWord[] = [];
        for (const line of String(stdout).split("\n").slice(1)) {
          const c = line.split("\t");
          if (c.length < 12 || Number(c[10]) < 0) continue; // not a word row
          const text = c[11]?.trim();
          if (text) words.push({ text, left: Number(c[6]), top: Number(c[7]), width: Number(c[8]), height: Number(c[9]) });
        }
        // PNG header: width and height are big-endian ints at bytes 16 and 20.
        resolve({ words, height: png.length > 24 ? png.readUInt32BE(20) : 1080, width: png.length > 24 ? png.readUInt32BE(16) : 1920 });
      });
      p.stdin?.on("error", () => undefined);
      p.stdin?.end(png);
    });
}
