import {Composition} from "remotion";
import {DemoVideo} from "./DemoVideo";
import {FPS, HEIGHT, TOTAL_FRAMES, WIDTH} from "./timeline";

export const compositionConfig = {
  id: "DreamSkinDemo",
  durationInFrames: TOTAL_FRAMES,
  fps: FPS,
  width: WIDTH,
  height: HEIGHT,
} as const;

export const Root = () => {
  return <Composition component={DemoVideo} {...compositionConfig} />;
};
