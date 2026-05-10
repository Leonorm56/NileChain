import sharp from 'sharp';

const svg = (size) => Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" rx="${Math.floor(size*0.15)}" fill="#0A1628"/>
  <text x="50%" y="45%" font-family="Arial Black" font-weight="900" font-size="${Math.floor(size*0.45)}" fill="#2E5FFF" text-anchor="middle" dominant-baseline="middle">N</text>
  <text x="50%" y="78%" font-family="Arial" font-weight="bold" font-size="${Math.floor(size*0.14)}" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">NILECHAIN</text>
</svg>`);

const pub = 'apps/purrfect-farmer/public/';

await sharp(svg(16)).png().toFile(pub + 'icon-16.png');
await sharp(svg(32)).png().toFile(pub + 'icon-32.png');
await sharp(svg(48)).png().toFile(pub + 'icon-48.png');
await sharp(svg(128)).png().toFile(pub + 'icon-128.png');
await sharp(svg(256)).png().toFile(pub + 'icon-256.png');
await sharp(svg(512)).png().toFile(pub + 'icon-512.png');
await sharp(svg(512)).png().toFile(pub + 'icon.png');
await sharp(svg(512)).png().toFile(pub + 'pwa-512x512.png');
await sharp(svg(192)).png().toFile(pub + 'pwa-192x192.png');
await sharp(svg(64)).png().toFile(pub + 'pwa-64x64.png');
await sharp(svg(512)).png().toFile(pub + 'maskable-icon-512x512.png');
await sharp(svg(180)).png().toFile(pub + 'apple-touch-icon-180x180.png');

console.log('Public icons replaced!');