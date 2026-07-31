import type { AppSettings, FontPreset } from "../../domain/settings";

export interface StartupSettingsProps {
  settings: AppSettings;
  busy: boolean;
  onChange(settings: AppSettings): void | Promise<unknown>;
}

export function StartupSettings({ settings, busy, onChange }: StartupSettingsProps) {
  const setFontPreset = (fontPreset: FontPreset) => void onChange({ ...settings, fontPreset });

  return (
    <fieldset className="startup-settings" disabled={busy}>
      <legend>应用设置</legend>
      <div className="font-preset-settings" role="radiogroup" aria-labelledby="font-preset-label">
        <div className="font-preset-settings__header">
          <strong id="font-preset-label">界面字体</strong>
          <small>选择后立即应用，并保存到本机。</small>
        </div>
        <label className="font-preset-option">
          <input aria-label="现代界面" type="radio" name="font-preset" value="industrial" checked={settings.fontPreset === "industrial"} onChange={() => setFontPreset("industrial")} />
          <span><strong>现代界面</strong><small>HarmonyOS Sans SC，中英文统一清晰。</small></span>
        </label>
        <label className="font-preset-option">
          <input aria-label="海报风格" type="radio" name="font-preset" value="poster" checked={settings.fontPreset === "poster"} onChange={() => setFontPreset("poster")} />
          <span><strong>海报风格</strong><small>得意黑标题，HarmonyOS Sans SC 正文。</small></span>
        </label>
        <label className="font-preset-option">
          <input aria-label="技术等宽" type="radio" name="font-preset" value="mono" checked={settings.fontPreset === "mono"} onChange={() => setFontPreset("mono")} />
          <span><strong>技术等宽</strong><small>更纱黑体，中英文与数字等宽。</small></span>
        </label>
      </div>
      <div className="startup-settings__divider" aria-hidden="true" />
      <label>
        <input aria-label="登录后启动应用" type="checkbox" checked={settings.launchAtLogin} onChange={(event) => void onChange({ ...settings, launchAtLogin: event.currentTarget.checked })} />
        <span><strong>登录后启动应用</strong><small>进入 Windows 后在托盘运行控制中心。</small></span>
      </label>
      <label>
        <input aria-label="打开应用后自动启动皮肤" type="checkbox" checked={settings.autoStartSkin} onChange={(event) => void onChange({ ...settings, autoStartSkin: event.currentTarget.checked })} />
        <span><strong>打开应用后自动启动皮肤</strong><small>需要重启 Codex 时仍会等待你的确认。</small></span>
      </label>
    </fieldset>
  );
}
