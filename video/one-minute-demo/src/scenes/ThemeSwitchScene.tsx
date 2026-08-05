import {AbsoluteFill, interpolate, useCurrentFrame} from "remotion";
import {Caption} from "../components/Caption";
import {CodexMockup} from "../components/CodexMockup";
import {CursorClick} from "../components/CursorClick";
import {ScreenShot} from "../components/ScreenShot";
import {THEME_SHOTS} from "../timeline";

export const ThemeSwitchScene = () => {
  const frame = useCurrentFrame();
  const shotIndex = Math.min(2, Math.floor(frame / 260));
  const localFrame = frame - shotIndex * 260;
  const shot = THEME_SHOTS[shotIndex];
  const studioOpacity = interpolate(localFrame, [88, 120], [1, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const codexOpacity = interpolate(localFrame, [100, 132], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});

  return (
    <AbsoluteFill style={{backgroundColor: "#070911", overflow: "hidden"}}>
      <AbsoluteFill style={{opacity: studioOpacity}}>
        <ScreenShot src={shot.studio} zoomFrom={1.01} zoomTo={1.025} />
        <CursorClick x={1760} y={1010} at={64} />
        <Caption align="left">选择皮肤 · 点击应用更改</Caption>
      </AbsoluteFill>
      <AbsoluteFill style={{opacity: codexOpacity}}>
        <CodexMockup src={shot.codex} />
        <div style={{position: "absolute", right: 64, top: 52, padding: "12px 20px", borderRadius: 999, backgroundColor: "rgba(8,11,18,.58)", color: "white", font: '600 24px "Microsoft YaHei UI"', letterSpacing: 1}}>{shot.label}</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
