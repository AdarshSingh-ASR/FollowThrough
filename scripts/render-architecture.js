import sharp from "sharp";

const result = await sharp("docs/architecture.svg", { density: 144 })
  .png()
  .toFile("docs/architecture.png");

console.log(`Rendered docs/architecture.png (${result.width}×${result.height})`);
