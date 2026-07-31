import { describe, expect, it } from "vitest";

import { dragFocus, focusToPosition, positionToFocus } from "./position-math";

describe("artwork position math", () => {
  it("maps focus coordinates to centered X/Y artwork positions", () => {
    expect(focusToPosition(0.5, 0.5)).toEqual({ x: 0, y: 0 });
    expect(focusToPosition(0, 1)).toEqual({ x: 100, y: -100 });
  });

  it("reverses X/Y positions into the existing focus schema", () => {
    expect(positionToFocus(20, -40)).toEqual({ focusX: 0.4, focusY: 0.7 });
    expect(positionToFocus(200, -200)).toEqual({ focusX: 0, focusY: 1 });
  });

  it("moves artwork with pointer deltas without jumping and clamps the result", () => {
    const start = { focusX: 0.4, focusY: 0.7 };
    const bounds = { width: 400, height: 200 };

    expect(dragFocus(start, 0, 0, bounds)).toEqual(start);
    expect(dragFocus(start, 40, 20, bounds)).toEqual({ focusX: 0.3, focusY: 0.6 });
    expect(dragFocus(start, 800, -400, bounds)).toEqual({ focusX: 0, focusY: 1 });
  });
});
