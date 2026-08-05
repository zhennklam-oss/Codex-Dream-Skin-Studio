import type {ReactNode} from "react";
import {Easing, interpolate, useCurrentFrame} from "remotion";

export const Caption = ({children, align = "center"}: {children: ReactNode; align?: "left" | "center"}) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        left: align === "left" ? 82 : "50%",
        bottom: 62,
        translate: align === "left" ? "0 0" : "-50% 0",
        opacity: interpolate(frame, [0, 14, 9999], [0, 1, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
        padding: "18px 28px",
        border: "1px solid rgba(255,255,255,0.26)",
        borderRadius: 999,
        backgroundColor: "rgba(7, 10, 18, 0.72)",
        boxShadow: "0 18px 70px rgba(0,0,0,0.35)",
        color: "white",
        fontFamily: '"Microsoft YaHei UI", "Segoe UI", sans-serif',
        fontSize: 31,
        letterSpacing: 0.5,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </div>
  );
};
