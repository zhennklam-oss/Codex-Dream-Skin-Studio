import {interpolate, useCurrentFrame} from "remotion";

export const CursorClick = ({x, y, at}: {x: number; y: number; at: number}) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [at, at + 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div style={{position: "absolute", left: x, top: y, pointerEvents: "none"}}>
      <div
        style={{
          position: "absolute",
          width: 28,
          height: 28,
          translate: "-50% -50%",
          borderRadius: "50%",
          backgroundColor: "rgba(255,255,255,0.92)",
          boxShadow: "0 4px 18px rgba(0,0,0,0.45)",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 92,
          height: 92,
          translate: "-50% -50%",
          scale: 0.25 + progress * 0.9,
          opacity: 1 - progress,
          borderRadius: "50%",
          border: "4px solid rgba(141, 210, 255, 0.9)",
        }}
      />
    </div>
  );
};
