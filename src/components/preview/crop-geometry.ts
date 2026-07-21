export interface Size {
  width: number;
  height: number;
}

export interface CropGeometry {
  renderedWidth: number;
  renderedHeight: number;
  maxOffsetX: number;
  maxOffsetY: number;
}

export interface CropOffset {
  x: number;
  y: number;
}

export interface FocusPoint {
  focusX: number;
  focusY: number;
}

const EMPTY_GEOMETRY: CropGeometry = {
  renderedWidth: 0,
  renderedHeight: 0,
  maxOffsetX: 0,
  maxOffsetY: 0,
};

export function calculateCropGeometry(image: Size, viewport: Size, scale: number): CropGeometry {
  if (![image.width, image.height, viewport.width, viewport.height, scale].every(isPositiveFinite)) {
    return { ...EMPTY_GEOMETRY };
  }

  const coverScale = Math.max(viewport.width / image.width, viewport.height / image.height);
  const cropScale = clamp(scale, 1, 2.5);
  const renderedWidth = image.width * coverScale * cropScale;
  const renderedHeight = image.height * coverScale * cropScale;

  return {
    renderedWidth,
    renderedHeight,
    maxOffsetX: Math.max(0, (renderedWidth - viewport.width) / 2),
    maxOffsetY: Math.max(0, (renderedHeight - viewport.height) / 2),
  };
}

export function focusToCropOffset(focus: FocusPoint, geometry: CropGeometry): CropOffset {
  return {
    x: focusAxisToOffset(focus.focusX, geometry.maxOffsetX),
    y: focusAxisToOffset(focus.focusY, geometry.maxOffsetY),
  };
}

export function cropOffsetToFocus(offset: CropOffset, geometry: CropGeometry): FocusPoint {
  return {
    focusX: offsetAxisToFocus(offset.x, geometry.maxOffsetX),
    focusY: offsetAxisToFocus(offset.y, geometry.maxOffsetY),
  };
}

export function dragCrop(startOffset: CropOffset, delta: CropOffset, geometry: CropGeometry): CropOffset {
  return {
    x: clamp(startOffset.x + delta.x, -geometry.maxOffsetX, geometry.maxOffsetX),
    y: clamp(startOffset.y + delta.y, -geometry.maxOffsetY, geometry.maxOffsetY),
  };
}

function focusAxisToOffset(focus: number, maximum: number): number {
  if (!isPositiveFinite(maximum)) return 0;
  return (1 - 2 * clamp(focus, 0, 1)) * maximum;
}

function offsetAxisToFocus(offset: number, maximum: number): number {
  if (!isPositiveFinite(maximum)) return 0.5;
  return clamp(0.5 - clamp(offset, -maximum, maximum) / (2 * maximum), 0, 1);
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : 0));
}
