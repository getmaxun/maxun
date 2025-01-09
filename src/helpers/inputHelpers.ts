import {
  ONE_PERCENT_OF_VIEWPORT_H,
  ONE_PERCENT_OF_VIEWPORT_W,
  VIEWPORT_W,
  VIEWPORT_H,
} from "../constants/const";
import { Coordinates } from '../components/recorder/canvas';

export const throttle = (callback: any, limit: number) => {
  let wait = false;
  return (...args: any[]) => {
    if (!wait) {
      callback(...args);
      wait = true;
      setTimeout(function () {
        wait = false;
      }, limit);
    }
  }
}

export const getMappedCoordinates = (
  event: MouseEvent,
  canvas: HTMLCanvasElement | null,
  browserWidth: number,
  browserHeight: number,
): Coordinates => {
  const clientCoordinates = getCoordinates(event, canvas);
  const mappedX = mapPixelFromSmallerToLarger(
    browserWidth / 100,
    ONE_PERCENT_OF_VIEWPORT_W,
    clientCoordinates.x,
  );
  const mappedY = mapPixelFromSmallerToLarger(
    browserHeight / 100,
    ONE_PERCENT_OF_VIEWPORT_H,
    clientCoordinates.y,
  );

  return {
    x: mappedX,
    y: mappedY
  };
};

const getCoordinates = (event: MouseEvent, canvas: HTMLCanvasElement | null): Coordinates => {
  if (!canvas) {
    return { x: 0, y: 0 };
  }
  return {
    x: event.pageX - canvas.offsetLeft,
    y: event.pageY - canvas.offsetTop
  };
};

export const mapRect = (
  rect: DOMRect,
  browserWidth: number,
  browserHeight: number,
) => {
  const mappedX = mapPixelFromSmallerToLarger(
    browserWidth / 100,
    ONE_PERCENT_OF_VIEWPORT_W,
    rect.x,
  );
  const mappedLeft = mapPixelFromSmallerToLarger(
    browserWidth / 100,
    ONE_PERCENT_OF_VIEWPORT_W,
    rect.left,
  );
  const mappedRight = mapPixelFromSmallerToLarger(
    browserWidth / 100,
    ONE_PERCENT_OF_VIEWPORT_W,
    rect.right,
  );
  const mappedWidth = mapPixelFromSmallerToLarger(
    browserWidth / 100,
    ONE_PERCENT_OF_VIEWPORT_W,
    rect.width,
  );
  const mappedY = mapPixelFromSmallerToLarger(
    browserHeight / 100,
    ONE_PERCENT_OF_VIEWPORT_H,
    rect.y,
  );
  const mappedTop = mapPixelFromSmallerToLarger(
    browserHeight / 100,
    ONE_PERCENT_OF_VIEWPORT_H,
    rect.top,
  );
  const mappedBottom = mapPixelFromSmallerToLarger(
    browserHeight / 100,
    ONE_PERCENT_OF_VIEWPORT_H,
    rect.bottom,
  );
  const mappedHeight = mapPixelFromSmallerToLarger(
    browserHeight / 100,
    ONE_PERCENT_OF_VIEWPORT_H,
    rect.height,
  );

  console.log('Mapped:', {
    x: mappedX,
    y: mappedY,
    width: mappedWidth,
    height: mappedHeight,
    top: mappedTop,
    right: mappedRight,
    bottom: mappedBottom,
    left: mappedLeft,
  })

  return {
    x: mappedX,
    y: mappedY,
    width: mappedWidth,
    height: mappedHeight,
    top: mappedTop,
    right: mappedRight,
    bottom: mappedBottom,
    left: mappedLeft,
  };
};

const mapPixelFromSmallerToLarger = (
  onePercentOfSmallerScreen: number,
  onePercentOfLargerScreen: number,
  pixel: number
): number => {
  const xPercentOfScreen = pixel / onePercentOfSmallerScreen;
  return xPercentOfScreen * onePercentOfLargerScreen;
};

const mapPixelFromLargerToSmaller = (
  onePercentOfSmallerScreen: number,
  onePercentOfLargerScreen: number,
  pixel: number
): number => {
  const xPercentOfScreen = pixel / onePercentOfLargerScreen;
  return Math.round(xPercentOfScreen * onePercentOfSmallerScreen);
};
