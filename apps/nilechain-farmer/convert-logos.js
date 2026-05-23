import sharp from 'sharp';

const assetsDir = './src/assets/images';

// Convert SVG to PNG
async function convertSvgToPng() {
  try {
    // Convert nilechain-logo.svg to PNG
    await sharp(`${assetsDir}/nilechain-logo.svg`)
      .png()
      .toFile(`${assetsDir}/nilechain-logo.png`);
    console.log('✓ Created nilechain-logo.png');

    // Convert nilechain-alert.svg to PNG
    await sharp(`${assetsDir}/nilechain-alert.svg`)
      .png()
      .toFile(`${assetsDir}/nilechain-alert.png`);
    console.log('✓ Created nilechain-alert.png');

    console.log('\nConversion complete!');
  } catch (error) {
    console.error('Error converting SVG to PNG:', error.message);
    process.exit(1);
  }
}

convertSvgToPng();
