// Makes the app icons from the logo geometry: public/icon.svg and the PNGs the manifest and iOS use.
// Run with `npm run icons` after changing the logo. The monogram is the blue a and the purple q on the dawn tile.
import { writeFileSync } from "node:fs";
import sharp from "sharp";

const BLUE = "#33c6ff";
const PURPLE = "#7f8cff";
const A = `<circle cx="28.5" cy="28.5" r="20.5"/><line x1="49" y1="26.5" x2="49" y2="49"/>`;
const Q = `<circle cx="28.5" cy="28.5" r="20.5"/><line x1="49" y1="8" x2="49" y2="70"/>`;

/** `radius` is the corner radius as a share of the size (0 for the square files iOS and the manifest round themselves). */
function svg(size, radius) {
  const w = size * 0.6; // the monogram's width on the tile
  const k = w / 121; // 121 = two rings (57) and the gap (7)
  const x = (size - 121 * k) / 2;
  const y = (size - 78 * k) / 2; // 78 = ring height plus the q's stem
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<defs><linearGradient id="t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eef3fb"/><stop offset="1" stop-color="#f1e6dd"/></linearGradient></defs>
<rect width="${size}" height="${size}" rx="${size * radius}" fill="url(#t)"/>
<g transform="translate(${x} ${y}) scale(${k})" fill="none" stroke-width="16" stroke-linecap="round">
<g stroke="${BLUE}">${A}</g><g transform="translate(64 0)" stroke="${PURPLE}">${Q}</g></g></svg>`;
}

writeFileSync("public/icon.svg", svg(512, 0.22));
for (const [file, size] of [
  ["public/icon-192.png", 192],
  ["public/icon-512.png", 512],
  ["public/apple-touch-icon.png", 180],
  ["public/favicon-32.png", 32],
]) {
  await sharp(Buffer.from(svg(size, 0))).png().toFile(file);
}
console.log("icons written");
