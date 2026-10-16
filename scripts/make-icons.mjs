// Draws the app icon (a ring on the dawn gradient, the same ring as the app) and writes the PNGs the
// iPhone and the web app manifest use. Run: node scripts/make-icons.mjs
import sharp from "sharp";

const svg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#d9e5f5"/><stop offset="1" stop-color="#f6e8d8"/>
    </linearGradient>
    <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#33c6ff"/><stop offset="1" stop-color="#7f8cff"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <circle cx="256" cy="256" r="132" fill="none" stroke="#17202e" stroke-opacity=".10" stroke-width="44"/>
  <circle cx="256" cy="256" r="132" fill="none" stroke="url(#ring)" stroke-width="44" stroke-linecap="round"
    pathLength="100" stroke-dasharray="72 100" transform="rotate(-90 256 256)"/>
</svg>`;

for (const [file, size] of [
  ["public/apple-touch-icon.png", 180],
  ["public/icon-192.png", 192],
  ["public/icon-512.png", 512],
]) {
  await sharp(Buffer.from(svg(size)))
    .png()
    .toFile(file);
  console.log("wrote", file);
}
