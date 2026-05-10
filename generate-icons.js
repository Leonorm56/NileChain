import sharp from 'sharp';
import { writeFileSync } from 'fs';

const sizes = [16, 32, 48, 128, 512];

const generateSVG = (size) => `
<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" rx="${Math.floor(size * 0.15)}" fill="#0A1628"/>
  <text x="50%" y="45%" font-family="Arial Black, Arial" font-weight="900" 
    font-size="${Math.floor(size * 0.45)}" fill="#2E5FFF" 
    text-anchor="middle" dominant-baseline="middle">N</text>
  <text x="50%" y="78%" font-family="Arial" font-weight="bold" 
    font-size="${Math.floor(size * 0.14)}" fill="#ffffff" 
    text-anchor="middle" dominant-baseline="middle">NILECHAIN</text>
</svg>`;

for (const size of sizes) {
  const svg = Buffer.from(generateSVG(size));
  await sharp(svg).png().toFile(`apps/purrfect-farmer/src/assets/images/icon-${size}.png`);
  console.log(`Generated icon-${size}.png`);
}

await sharp(Buffer.from(generateSVG(512))).png().toFile(`apps/purrfect-farmer/src/assets/images/icon.png`);
await sharp(Buffer.from(generateSVG(512))).png().toFile(`apps/purrfect-farmer/src/assets/images/nilechain-logo.png`);
await sharp(Buffer.from(generateSVG(256))).png().toFile(`apps/purrfect-farmer/src/assets/images/nilechain-alert.png`);
await sharp(Buffer.from(generateSVG(512))).png().toFile(`apps/purrfect-farmer/src/assets/images/purrfect-cat.png`);
await sharp(Buffer.from(generateSVG(256))).png().toFile(`apps/purrfect-farmer/src/assets/images/shocked-cat.png`);

console.log('All icons generated!');s
await sharp(Buffer.from(generateSVG(512))).png().toFile(`apps/purrfect-farmer/src/assets/images/icon-unwrapped.png`);
await sharp(Buffer.from(generateSVG(512))).png().toFile(`apps/purrfect-farmer/src/assets/images/icon-unwrapped-cropped.png`);
await sharp(Buffer.from(generateSVG(512))).png().toFile(`apps/purrfect-farmer/src/assets/images/icon-toolbar-minimized.png`);
await sharp(Buffer.from(generateSVG(512))).png().toFile(`apps/purrfect-farmer/src/assets/images/whiskers.png`);