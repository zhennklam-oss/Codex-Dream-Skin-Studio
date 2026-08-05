import {Img, interpolate, staticFile, useCurrentFrame} from "remotion";

export const ScreenShot = ({
  src,
  zoomFrom = 1,
  zoomTo = 1.025,
  panX = 0,
  panY = 0,
  filter,
}: {
  src: string;
  zoomFrom?: number;
  zoomTo?: number;
  panX?: number;
  panY?: number;
  filter?: string;
}) => {
  const frame = useCurrentFrame();
  return (
    <Img
      src={staticFile(src)}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        scale: interpolate(frame, [0, 240], [zoomFrom, zoomTo], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
        translate: `${panX}px ${panY}px`,
        filter,
      }}
    />
  );
};
