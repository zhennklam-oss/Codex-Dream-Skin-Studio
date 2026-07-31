import { describe, expect, it } from "vitest";

import {
  calculateCropGeometry,
  cropOffsetToFocus,
  dragCrop,
  focusToCropOffset,
} from "./crop-geometry";

const image = { width: 3840, height: 2160 };
const viewport = { width: 1296, height: 830 };

describe("bounded crop geometry", () => {
  it("calculates cover geometry at the minimum crop scale", () => {
    const geometry = calculateCropGeometry(image, viewport, 1);

    expect(geometry.renderedWidth).toBeCloseTo(1475.56, 2);
    expect(geometry.renderedHeight).toBe(830);
    expect(geometry.maxOffsetX).toBeCloseTo(89.78, 2);
    expect(geometry.maxOffsetY).toBe(0);
  });

  it("treats legacy scale values below one as the minimum cover scale", () => {
    expect(calculateCropGeometry(image, viewport, 0.5)).toEqual(
      calculateCropGeometry(image, viewport, 1),
    );
    expect(calculateCropGeometry(image, viewport, 3)).toEqual(
      calculateCropGeometry(image, viewport, 2.5),
    );
  });

  it("increases both movement ranges after zooming", () => {
    const geometry = calculateCropGeometry(image, viewport, 1.2);

    expect(geometry.renderedWidth).toBeCloseTo(1770.67, 2);
    expect(geometry.renderedHeight).toBeCloseTo(996, 2);
    expect(geometry.maxOffsetX).toBeCloseTo(237.33, 2);
    expect(geometry.maxOffsetY).toBeCloseTo(83, 2);
  });

  it("clamps focus and dragged offsets to the available crop", () => {
    const geometry = calculateCropGeometry(image, viewport, 1.2);

    expect(focusToCropOffset({ focusX: -1, focusY: 2 }, geometry)).toEqual({
      x: geometry.maxOffsetX,
      y: -geometry.maxOffsetY,
    });
    expect(dragCrop({ x: 0, y: 0 }, { x: 999, y: -999 }, geometry)).toEqual({
      x: geometry.maxOffsetX,
      y: -geometry.maxOffsetY,
    });
  });

  it("centers safely when image, viewport, or scale bounds are invalid", () => {
    const invalidInputs = [
      calculateCropGeometry({ width: 0, height: 2160 }, viewport, 1),
      calculateCropGeometry(image, { width: 1296, height: Number.NaN }, 1),
      calculateCropGeometry(image, viewport, 0),
    ];

    for (const geometry of invalidInputs) {
      expect(geometry).toEqual({ renderedWidth: 0, renderedHeight: 0, maxOffsetX: 0, maxOffsetY: 0 });
      expect(focusToCropOffset({ focusX: 0.2, focusY: 0.8 }, geometry)).toEqual({ x: 0, y: 0 });
      expect(cropOffsetToFocus({ x: 400, y: -400 }, geometry)).toEqual({ focusX: 0.5, focusY: 0.5 });
    }
  });

  it("round-trips focus through pixel offsets to two decimals", () => {
    const geometry = calculateCropGeometry(image, viewport, 1.2);

    for (const focus of [
      { focusX: 0, focusY: 0 },
      { focusX: 0.37, focusY: 0.68 },
      { focusX: 0.5, focusY: 0.5 },
      { focusX: 1, focusY: 1 },
    ]) {
      const roundTrip = cropOffsetToFocus(focusToCropOffset(focus, geometry), geometry);
      expect(roundTrip.focusX).toBeCloseTo(focus.focusX, 2);
      expect(roundTrip.focusY).toBeCloseTo(focus.focusY, 2);
    }
  });
});
