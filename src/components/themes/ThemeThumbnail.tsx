import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import type { ThemeSummary } from "../../lib/commands";

export interface ThemeThumbnailProps {
  theme: ThemeSummary;
  onReplace(): void;
  toAssetUrl?: (path: string) => string;
}

export function ThemeThumbnail({
  theme,
  onReplace,
  toAssetUrl = convertFileSrc,
}: ThemeThumbnailProps) {
  const [failed, setFailed] = useState(theme.isDamaged || !theme.imagePath);

  useEffect(() => {
    setFailed(theme.isDamaged || !theme.imagePath);
  }, [theme.imagePath, theme.isDamaged]);

  if (failed || !theme.imagePath) {
    return (
      <div className="theme-thumbnail theme-thumbnail--broken">
        <span className="theme-thumbnail__fallback">图片不可用</span>
        <button
          type="button"
          className="theme-thumbnail__replace"
          aria-label={`替换 ${theme.name} 的图片`}
          onClick={onReplace}
        >
          替换图片
        </button>
      </div>
    );
  }

  return (
    <div className="theme-thumbnail">
      <img
        className="theme-thumbnail__image"
        src={toAssetUrl(theme.imagePath)}
        alt={`${theme.name} 缩略图`}
        onError={() => setFailed(true)}
      />
      <span className="theme-thumbnail__registration" aria-hidden="true" />
    </div>
  );
}
