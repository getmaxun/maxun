import sharp from 'sharp';
import { BinaryOutputService } from '../storage/mino';

export const COMPARABLE_SCREENSHOT_FORMATS = ['screenshot-visible', 'screenshot-fullpage'] as const;
export type ComparableScreenshotFormat = (typeof COMPARABLE_SCREENSHOT_FORMATS)[number];

const PIXEL_CHANNEL_THRESHOLD = 32;
const HORIZONTAL_POSITION_TOLERANCE = 2;
// Row alignment works at block level. Allow a small local vertical search as well
// so sub-pixel rendering and content-height shifts do not paint unchanged glyphs.
const VERTICAL_POSITION_TOLERANCE = 3;
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

const ROW_FINGERPRINT_BINS = 24;

function createRowFingerprints(buffer: Buffer, canvasWidth: number, imageWidth: number, imageHeight: number) {
  const fingerprints = new Float32Array(imageHeight * ROW_FINGERPRINT_BINS);
  for (let y = 0; y < imageHeight; y += 1) {
    for (let bin = 0; bin < ROW_FINGERPRINT_BINS; bin += 1) {
      const start = Math.floor(bin * imageWidth / ROW_FINGERPRINT_BINS);
      const end = Math.max(start + 1, Math.floor((bin + 1) * imageWidth / ROW_FINGERPRINT_BINS));
      const step = Math.max(1, Math.floor((end - start) / 6));
      let total = 0;
      let samples = 0;
      for (let x = start; x < end; x += step) {
        const offset = (y * canvasWidth + x) * 4;
        total += buffer[offset] * 0.299 + buffer[offset + 1] * 0.587 + buffer[offset + 2] * 0.114;
        samples += 1;
      }
      fingerprints[y * ROW_FINGERPRINT_BINS + bin] = samples ? total / samples : 255;
    }
  }
  return fingerprints;
}

function alignRows(current: Buffer, previous: Buffer, width: number, currentWidth: number, currentHeight: number, previousWidth: number, previousHeight: number) {
  const currentRows = createRowFingerprints(current, width, currentWidth, currentHeight);
  const previousRows = createRowFingerprints(previous, width, previousWidth, previousHeight);
  const searchRadius = Math.min(250, Math.max(40, Math.abs(currentHeight - previousHeight) + 30));
  const rowMap = new Int32Array(currentHeight);
  const blockHeight = 24;
  let previousOffset = 0;

  for (let blockStart = 0; blockStart < currentHeight; blockStart += blockHeight) {
    const blockEnd = Math.min(currentHeight, blockStart + blockHeight);
    const minimumOffset = Math.max(-searchRadius, -blockStart);
    const maximumOffset = Math.min(searchRadius, previousHeight - blockEnd);
    let bestOffset = Math.max(minimumOffset, Math.min(maximumOffset, previousOffset));
    let bestScore = Number.POSITIVE_INFINITY;
    for (let offset = minimumOffset; offset <= maximumOffset; offset += 1) {
      let score = Math.abs(offset - previousOffset) * 2 + Math.abs(offset) * 0.05;
      for (let currentY = blockStart; currentY < blockEnd; currentY += 3) {
        const previousY = currentY + offset;
        for (let bin = 0; bin < ROW_FINGERPRINT_BINS; bin += 1) {
          score += Math.abs(
            currentRows[currentY * ROW_FINGERPRINT_BINS + bin]
            - previousRows[previousY * ROW_FINGERPRINT_BINS + bin],
          );
        }
      }
      if (score < bestScore) {
        bestScore = score;
        bestOffset = offset;
      }
    }
    previousOffset = bestOffset;
    for (let currentY = blockStart; currentY < blockEnd; currentY += 1) {
      rowMap[currentY] = Math.max(0, Math.min(previousHeight - 1, currentY + bestOffset));
    }
  }
  return rowMap;
}

export async function compareScreenshots(currentEntry: any, previousEntry: any): Promise<ScreenshotComparisonResult | null> {
  const [currentBuffer, previousBuffer] = await Promise.all([
    loadStoredScreenshot(currentEntry),
    loadStoredScreenshot(previousEntry),
  ]);
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

  const previousRowForCurrent = alignRows(
    currentPixels, previousPixels, width, currentWidth, currentHeight, previousWidth, previousHeight,
  );
  const changedMask = new Uint8Array(width * currentHeight);
  let changedPixels = 0;
  for (let y = 0; y < currentHeight; y += 1) {
    const previousY = previousRowForCurrent[y];
    for (let x = 0; x < currentWidth; x += 1) {
      const pixelIndex = y * width + x;
      const currentOffset = pixelIndex * 4;
      let delta = 255;
      for (let dy = -VERTICAL_POSITION_TOLERANCE; dy <= VERTICAL_POSITION_TOLERANCE; dy += 1) {
        const candidatePreviousY = previousY + dy;
        if (candidatePreviousY < 0 || candidatePreviousY >= previousHeight) continue;
        for (let dx = -HORIZONTAL_POSITION_TOLERANCE; dx <= HORIZONTAL_POSITION_TOLERANCE; dx += 1) {
          const previousX = x + dx;
          if (previousX < 0 || previousX >= previousWidth) continue;
          const previousOffset = (candidatePreviousY * width + previousX) * 4;
          delta = Math.min(delta, Math.max(
            Math.abs(currentPixels[currentOffset] - previousPixels[previousOffset]),
            Math.abs(currentPixels[currentOffset + 1] - previousPixels[previousOffset + 1]),
            Math.abs(currentPixels[currentOffset + 2] - previousPixels[previousOffset + 2]),
            Math.abs(currentPixels[currentOffset + 3] - previousPixels[previousOffset + 3]),
          ));
        }
      }
      if (delta > PIXEL_CHANNEL_THRESHOLD) {
        changedPixels += 1;
        changedMask[pixelIndex] = 1;
      }
    }
  }

  const changedPercentage = (changedPixels / (currentWidth * currentHeight)) * 100;
  const changed = changedPercentage >= CHANGED_PERCENTAGE_THRESHOLD;
  let diff: Buffer | undefined;
  if (changed) {
    const highlightedMask = new Uint8Array(changedMask.length);
    const radius = 1;
    for (let index = 0; index < changedMask.length; index += 1) {
      if (!changedMask[index]) continue;
      const centerX = index % width;
      const centerY = Math.floor(index / width);
      for (let y = Math.max(0, centerY - radius); y <= Math.min(currentHeight - 1, centerY + radius); y += 1) {
        for (let x = Math.max(0, centerX - radius); x <= Math.min(width - 1, centerX + radius); x += 1) {
          highlightedMask[y * width + x] = 1;
        }
      }
    }

    const diffPixels = Buffer.from(currentPixels.subarray(0, width * currentHeight * 4));
    for (let index = 0; index < highlightedMask.length; index += 1) {
      if (!highlightedMask[index]) continue;
      const offset = index * 4;
      diffPixels[offset] = Math.round(diffPixels[offset] * 0.25 + 255 * 0.75);
      diffPixels[offset + 1] = Math.round(diffPixels[offset + 1] * 0.25);
      diffPixels[offset + 2] = Math.round(diffPixels[offset + 2] * 0.25 + 195 * 0.75);
      diffPixels[offset + 3] = 255;
    }
    diff = await sharp(diffPixels, { raw: { width, height: currentHeight, channels: 4 } }).png().toBuffer();
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
