import sharp from 'sharp';

const svg = Buffer.from(`<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="77" fill="#0A1628"/>
  <text x="50%" y="45%" font-family="Arial Black" font-weight="900" font-size="230" fill="#2E5FFF" text-anchor="middle" dominant-baseline="middle">N</text>
  <text x="50%" y="78%" font-family="Arial" font-weight="bold" font-size="72" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">NILECHAIN</text>
</svg>`);

await sharp(svg).png().toFile('apps/purrfect-farmer/src/assets/images/icon-unwrapped-cropped.png');
await sharp(svg).png().toFile('apps/purrfect-farmer/src/assets/images/icon-unwrapped.png');

console.log('Done!');