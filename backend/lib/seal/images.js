import { PNG } from 'pngjs';

export function flattenPng(buffer) {
  const source = PNG.sync.read(buffer);
  const rgb = Buffer.alloc(source.width * source.height * 3);
  for (let i = 0, j = 0; i < source.data.length; i += 4, j += 3) {
    const alpha = source.data[i + 3] / 255;
    rgb[j] = Math.round(source.data[i] * alpha + 255 * (1 - alpha));
    rgb[j + 1] = Math.round(source.data[i + 1] * alpha + 255 * (1 - alpha));
    rgb[j + 2] = Math.round(source.data[i + 2] * alpha + 255 * (1 - alpha));
  }
  return PNG.sync.write({ width: source.width, height: source.height, data: rgb, colorType: 2, inputColorType: 2, inputHasAlpha: false });
}
