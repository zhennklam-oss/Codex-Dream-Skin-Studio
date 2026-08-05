import {Img, staticFile} from "remotion";

export const CodexMockup = ({src, filter, wash}: {src: string; filter?: string; wash?: string}) => {
  return (
    <div style={{position: "absolute", inset: 0, overflow: "hidden", backgroundColor: "#10131b"}}>
      <Img src={staticFile(src)} style={{width: "100%", height: "100%", objectFit: "cover", filter}} />
      {wash ? <div style={{position: "absolute", inset: 0, backgroundColor: wash, mixBlendMode: "soft-light"}} /> : null}
      <div style={{position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(6,10,18,.72), rgba(6,10,18,.12) 38%, rgba(6,10,18,.06))"}} />
      <div style={{position: "absolute", left: 0, top: 0, bottom: 0, width: 292, backgroundColor: "rgba(12,16,25,.48)", borderRight: "1px solid rgba(255,255,255,.14)", backdropFilter: "blur(18px)"}} />
      <div style={{position: "absolute", left: 28, top: 28, color: "white", font: '700 28px "Segoe UI"', letterSpacing: 4}}>CODEX</div>
      {[0, 1, 2, 3].map((item) => <div key={item} style={{position: "absolute", left: 34, top: 140 + item * 64, width: 144 + item * 12, height: 14, borderRadius: 8, backgroundColor: `rgba(255,255,255,${0.32 - item * 0.04})`}} />)}
      <div style={{position: "absolute", left: 380, right: 94, top: 70, height: 62, borderRadius: 18, backgroundColor: "rgba(10,14,22,.24)", border: "1px solid rgba(255,255,255,.12)", backdropFilter: "blur(14px)"}} />
      <div style={{position: "absolute", left: 490, top: 300, color: "white", fontFamily: '"Microsoft YaHei UI", "Segoe UI", sans-serif', fontSize: 76, fontWeight: 650, textShadow: "0 8px 40px rgba(0,0,0,.42)"}}>开始一个任务</div>
      <div style={{position: "absolute", left: 455, right: 170, bottom: 84, height: 156, borderRadius: 28, backgroundColor: "rgba(246,248,255,.22)", border: "1px solid rgba(255,255,255,.36)", backdropFilter: "blur(24px)", boxShadow: "0 28px 90px rgba(0,0,0,.26)"}} />
      <div style={{position: "absolute", left: 500, bottom: 162, width: 320, height: 18, borderRadius: 9, backgroundColor: "rgba(255,255,255,.56)"}} />
      <div style={{position: "absolute", right: 210, bottom: 126, width: 48, height: 48, borderRadius: "50%", backgroundColor: "rgba(255,255,255,.72)"}} />
    </div>
  );
};
