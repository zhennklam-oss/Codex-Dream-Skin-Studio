import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from "remotion";
import {COPY} from "../timeline";

export const EndCardScene = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{background: "radial-gradient(circle at 50% 35%, #263452 0%, #101520 42%, #07090f 100%)", color: "white", fontFamily: '"Segoe UI", "Microsoft YaHei UI", sans-serif'}}>
      <div style={{position: "absolute", inset: 0, opacity: 0.24, backgroundImage: "linear-gradient(rgba(255,255,255,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.08) 1px, transparent 1px)", backgroundSize: "56px 56px"}} />
      <div style={{position: "absolute", left: "50%", top: "44%", translate: "-50% -50%", width: "100%", textAlign: "center", opacity: interpolate(frame, [0, 20], [0, 1], {extrapolateRight: "clamp", easing: Easing.bezier(.16, 1, .3, 1)})}}>
        <div style={{fontSize: 72, fontWeight: 680, letterSpacing: -1.8}}>{COPY.title}</div>
        <div style={{marginTop: 24, fontSize: 28, color: "rgba(226,235,255,.78)", letterSpacing: 3}}>{COPY.platform}</div>
      </div>
      <div style={{position: "absolute", right: 40, bottom: 30, fontSize: 18, color: "rgba(220,228,245,.62)"}}>{COPY.attribution}</div>
    </AbsoluteFill>
  );
};
