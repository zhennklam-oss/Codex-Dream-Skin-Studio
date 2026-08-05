import {AbsoluteFill} from "remotion";
import {Caption} from "../components/Caption";
import {CursorClick} from "../components/CursorClick";
import {ScreenShot} from "../components/ScreenShot";
import {COPY} from "../timeline";

export const StudioIntroScene = () => {
  return (
    <AbsoluteFill style={{backgroundColor: "#0a0d14", overflow: "hidden"}}>
      <ScreenShot src="captures/studio-overview.png" zoomFrom={1.015} zoomTo={1.035} />
      <CursorClick x={1514} y={77} at={78} />
      <Caption>{COPY.studio}</Caption>
    </AbsoluteFill>
  );
};
