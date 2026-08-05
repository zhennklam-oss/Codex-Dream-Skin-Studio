import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from "remotion";
import {ScreenShot} from "../components/ScreenShot";
import {COPY} from "../timeline";

export const OpeningScene = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{backgroundColor: "#070911", overflow: "hidden"}}>
      <ScreenShot src="captures/codex-opening.png" zoomFrom={1} zoomTo={1.045} />
      <AbsoluteFill style={{background: "linear-gradient(180deg, rgba(5,7,13,.08), rgba(5,7,13,.24))"}} />
      <div
        style={{
          position: "absolute",
          left: 88,
          bottom: 84,
          opacity: interpolate(frame, [16, 42, 190, 225], [0, 1, 1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          color: "white",
          fontFamily: '"Segoe UI", "Microsoft YaHei UI", sans-serif',
          fontSize: 64,
          fontWeight: 650,
          letterSpacing: -1.5,
          textShadow: "0 8px 45px rgba(0,0,0,.55)",
        }}
      >
        {COPY.title}
      </div>
    </AbsoluteFill>
  );
};
