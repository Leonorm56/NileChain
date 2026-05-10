import sharp from 'sharp';

const svgK = Buffer.from(`<svg width="64" height="64" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" rx="10" fill="#0A1628"/>
  <text x="50%" y="50%" font-family="Arial Black" font-weight="900" font-size="28" fill="#2E5FFF" text-anchor="middle" dominant-baseline="middle">NK</text>
</svg>`);

const svgA = Buffer.from(`<svg width="64" height="64" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" rx="10" fill="#0A1628"/>
  <text x="50%" y="50%" font-family="Arial Black" font-weight="900" font-size="28" fill="#2E5FFF" text-anchor="middle" dominant-baseline="middle">NA</text>
</svg>`);

await sharp(svgK).png().toFile('apps/purrfect-farmer/src/assets/images/bot-web-k.png');
await sharp(svgA).png().toFile('apps/purrfect-farmer/src/assets/images/bot-web-a.png');

console.log('Bot icons replaced!');