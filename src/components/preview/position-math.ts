export interface FocusPoint {
  focusX: number;
  focusY: number;
}

export interface ArtworkPosition {
  x: number;
  y: number;
}

export interface DragBounds {
  width: number;
  height: number;
}

export function focusToPosition(focusX: number, focusY: number): ArtworkPosition {
  return {
    x: roundPosition((0.5 - focusX) * 200),
    y: roundPosition((0.5 - focusY) * 200),
  };
}

export function positionToFocus(x: number, y: number): FocusPoint {
  return {
    focusX: roundFocus(clamp(0.5 - x / 200, 0, 1)),
    focusY: roundFocus(clamp(0.5 - y / 200, 0, 1)),
  };
}

export function dragFocus(
  start: FocusPoint,
  deltaX: number,
  deltaY: number,
  bounds: DragBounds,
): FocusPoint {
  if (bounds.width <= 0 || bounds.height <= 0) return start;
  return {
    focusX: roundFocus(clamp(start.focusX - deltaX / bounds.width, 0, 1)),
    focusY: roundFocus(clamp(start.focusY - deltaY / bounds.height, 0, 1)),
  };
}

function roundFocus(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundPosition(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
