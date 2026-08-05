import {AbsoluteFill, interpolate, useCurrentFrame} from "remotion";
import {Caption} from "../components/Caption";
import {CodexMockup} from "../components/CodexMockup";
import {CursorClick} from "../components/CursorClick";
import {ScreenShot} from "../components/ScreenShot";
import {TONE_MODES} from "../timeline";

const FILTERS: Record<string, string | undefined> = {
  original: undefined,
  grayscale: "grayscale(1)",
  duotone: "grayscale(1) sepia(1) hue-rotate(178deg) saturate(2.1) contrast(1.05)",
  wash: "sepia(.32) saturate(.78) hue-rotate(320deg) brightness(1.08)",
};

export const ToneScene = () => {
  const frame = useCurrentFrame();
  if (frame < 300) {
    const modeIndex = Math.min(3, Math.floor(frame / 75));
    const localFrame = frame - modeIndex * 75;
    const mode = TONE_MODES[modeIndex];
    return (
      <AbsoluteFill style={{backgroundColor: "#080b12", overflow: "hidden"}}>
        <ScreenShot src={mode.source} zoomFrom={1.01} zoomTo={1.02} filter={FILTERS[mode.id]} />
        <div style={{position: "absolute", top: 52, right: 66, color: "white", font: '650 38px "Microsoft YaHei UI"', padding: "14px 24px", borderRadius: 14, backgroundColor: "rgba(7,10,17,.72)", opacity: interpolate(localFrame, [0, 12, 62, 74], [0, 1, 1, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp"})}}>{mode.label}</div>
        <Caption>同一张图片 · 四种色调</Caption>
      </AbsoluteFill>
    );
  }

  if (frame < 360) {
    return (
      <AbsoluteFill style={{backgroundColor: "#080b12", overflow: "hidden"}}>
        <ScreenShot src="captures/studio-opacity.png" zoomFrom={1.015} zoomTo={1.025} />
        <CursorClick x={1710} y={1010} at={34} />
        <Caption>调节透明度 · 应用更改</Caption>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{backgroundColor: "#080b12", overflow: "hidden"}}>
      <CodexMockup src="captures/codex-theme-3.png" filter="saturate(.9) brightness(1.03)" wash="rgba(244, 153, 180, .26)" />
      <div style={{position: "absolute", inset: 0, background: "radial-gradient(circle at 65% 40%, rgba(255,255,255,.12), transparent 46%)"}} />
    </AbsoluteFill>
  );
};
