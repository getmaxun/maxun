import sharp from 'sharp';
import { BinaryOutputService } from '../storage/mino';

export const COMPARABLE_SCREENSHOT_FORMATS = ['screenshot-visible', 'screenshot-fullpage'] as const;
export type ComparableScreenshotFormat = (typeof COMPARABLE_SCREENSHOT_FORMATS)[number];

const PIXEL_CHANNEL_THRESHOLD = 24;
const CHANGED_PERCENTAGE_THRESHOLD = 0.01;
const MAX_COMPARISON_PIXELS = 4_000_000;

export interface ScreenshotComparisonResult {
  changed: boolean;
  changedPixels: number;
  changedPercentage: number;
  previousWidth: number;
  previousHeight: number;
  currentWidth: number;
  currentHeight: number;
  comparedWidth: number;
  comparedHeight: number;
  diff?: Buffer;
}

function binaryEntryToBuffer(entry: any): Buffer | null {
  const value = entry?.data ?? entry;
  if (Buffer.isBuffer(value)) return value;
  if (value?.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data);
  if (typeof value !== 'string' || /^https?:\/\//.test(value)) return null;

  const dataUri = value.match(/^data:[^;]+;base64,(.+)$/);
  return Buffer.from(dataUri?.[1] ?? value, 'base64');
}

async function loadStoredScreenshot(entry: any): Promise<Buffer | null> {
  const inline = binaryEntryToBuffer(entry);
  if (inline) return inline;

  const value = entry?.data ?? entry;
  if (typeof value !== 'string' || !/^https?:\/\//.test(value)) return null;

  try {
    const url = new URL(value);
    const bucketSegment = '/maxun-run-screenshots/';
    const bucketIndex = url.pathname.indexOf(bucketSegment);
    if (bucketIndex === -1) return null;
    const key = decodeURIComponent(url.pathname.slice(bucketIndex + bucketSegment.length));
    return await new BinaryOutputService('maxun-run-screenshots').getBinaryOutputFromMinioBucket(key);
  } catch {
    return null;
  }
}

async function renderComparableImage(
  buffer: Buffer,
  imageWidth: number,
  imageHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): Promise<Buffer> {
  return sharp(buffer)
    .resize(imageWidth, imageHeight, { fit: 'fill' })
    .extend({
      top: 0,
      left: 0,
      right: canvasWidth - imageWidth,
      bottom: canvasHeight - imageHeight,
      background: { r: 255, g: 255, b: 255, alpha: 255 },
    })
    .ensureAlpha()
    .raw()
    .toBuffer();
}

export async function compareScreenshots(currentEntry: any, previousEntry: any): Promise<ScreenshotComparisonResult | null> {
  const currentBuffer = binaryEntryToBuffer(currentEntry);
  const previousBuffer = await loadStoredScreenshot(previousEntry);
  if (!currentBuffer || !previousBuffer) return null;

  const [currentMetadata, previousMetadata] = await Promise.all([
    sharp(currentBuffer).metadata(),
    sharp(previousBuffer).metadata(),
  ]);
  if (!currentMetadata.width || !currentMetadata.height || !previousMetadata.width || !previousMetadata.height) return null;

  const sourceWidth = Math.max(currentMetadata.width, previousMetadata.width);
  const sourceHeight = Math.max(currentMetadata.height, previousMetadata.height);
  const scale = Math.min(1, Math.sqrt(MAX_COMPARISON_PIXELS / (sourceWidth * sourceHeight)));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const currentWidth = Math.max(1, Math.round(currentMetadata.width * scale));
  const currentHeight = Math.max(1, Math.round(currentMetadata.height * scale));
  const previousWidth = Math.max(1, Math.round(previousMetadata.width * scale));
  const previousHeight = Math.max(1, Math.round(previousMetadata.height * scale));
  const [currentPixels, previousPixels] = await Promise.all([
    renderComparableImage(currentBuffer, currentWidth, currentHeight, width, height),
    renderComparableImage(previousBuffer, previousWidth, previousHeight, width, height),
  ]);

  const changedMask = new Uint8Array(width * height);
  let changedPixels = 0;
  for (let offset = 0; offset < currentPixels.length; offset += 4) {
    const pixelIndex = offset / 4;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    const dimensionsDifferHere = (x >= currentWidth || y >= currentHeight)
      !== (x >= previousWidth || y >= previousHeight);
    const delta = Math.max(
      Math.abs(currentPixels[offset] - previousPixels[offset]),
      Math.abs(currentPixels[offset + 1] - previousPixels[offset + 1]),
      Math.abs(currentPixels[offset + 2] - previousPixels[offset + 2]),
      Math.abs(currentPixels[offset + 3] - previousPixels[offset + 3]),
    );
    const changed = dimensionsDifferHere || delta > PIXEL_CHANNEL_THRESHOLD;
    if (changed) {
      changedPixels += 1;
      changedMask[pixelIndex] = 1;
    }
  }

  const changedPercentage = (changedPixels / (width * height)) * 100;
  const changed = changedPercentage >= CHANGED_PERCENTAGE_THRESHOLD;
  let diff: Buffer | undefined;
  if (changed) {
    const highlightedMask = new Uint8Array(changedMask.length);
    const radius = 2;
    for (let index = 0; index < changedMask.length; index += 1) {
      if (!changedMask[index]) continue;
      const centerX = index % width;
      const centerY = Math.floor(index / width);
      for (let y = Math.max(0, centerY - radius); y <= Math.min(height - 1, centerY + radius); y += 1) {
        for (let x = Math.max(0, centerX - radius); x <= Math.min(width - 1, centerX + radius); x += 1) {
          highlightedMask[y * width + x] = 1;
        }
      }
    }

    const diffPixels = Buffer.from(currentPixels);
    for (let index = 0; index < highlightedMask.length; index += 1) {
      if (!highlightedMask[index]) continue;
      const offset = index * 4;
      diffPixels[offset] = Math.round(diffPixels[offset] * 0.25 + 255 * 0.75);
      diffPixels[offset + 1] = Math.round(diffPixels[offset + 1] * 0.25);
      diffPixels[offset + 2] = Math.round(diffPixels[offset + 2] * 0.25 + 195 * 0.75);
      diffPixels[offset + 3] = 255;
    }
    diff = await sharp(diffPixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
  }

  return {
    changed,
    changedPixels,
    changedPercentage,
    previousWidth: previousMetadata.width,
    previousHeight: previousMetadata.height,
    currentWidth: currentMetadata.width,
    currentHeight: currentMetadata.height,
    comparedWidth: width,
    comparedHeight: height,
    diff,
  };
}
