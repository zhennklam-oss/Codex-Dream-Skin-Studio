import {Audio} from "@remotion/media";
import {AbsoluteFill, Sequence, staticFile} from "remotion";
import {EndCardScene} from "./scenes/EndCardScene";
import {OpeningScene} from "./scenes/OpeningScene";
import {StudioIntroScene} from "./scenes/StudioIntroScene";
import {ThemeSwitchScene} from "./scenes/ThemeSwitchScene";
import {ToneScene} from "./scenes/ToneScene";
import {SCENES} from "./timeline";

export const DemoVideo = () => {
  return (
    <AbsoluteFill style={{backgroundColor: "#080a12"}}>
      <Audio src={staticFile("audio/dream-ambient.wav")} volume={0.72} />
      <Sequence from={SCENES.opening.from} durationInFrames={SCENES.opening.duration} name="Opening">
        <OpeningScene />
      </Sequence>
      <Sequence from={SCENES.studioIntro.from} durationInFrames={SCENES.studioIntro.duration} name="Studio intro">
        <StudioIntroScene />
      </Sequence>
      <Sequence from={SCENES.themeSwitches.from} durationInFrames={SCENES.themeSwitches.duration} name="Theme switches">
        <ThemeSwitchScene />
      </Sequence>
      <Sequence from={SCENES.tone.from} durationInFrames={SCENES.tone.duration} name="Tone and opacity">
        <ToneScene />
      </Sequence>
      <Sequence from={SCENES.endCard.from} durationInFrames={SCENES.endCard.duration} name="End card">
        <EndCardScene />
      </Sequence>
    </AbsoluteFill>
  );
};
