import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StartupSettings } from "./StartupSettings";

afterEach(cleanup);

describe("StartupSettings", () => {
  it("updates the two persisted switches independently", () => {
    const onChange = vi.fn();
    render(<StartupSettings settings={{ launchAtLogin: true, autoStartSkin: true, fontPreset: "industrial", window: null }} busy={false} onChange={onChange} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "登录后启动应用" }));
    expect(onChange).toHaveBeenCalledWith({ launchAtLogin: false, autoStartSkin: true, fontPreset: "industrial", window: null });

    fireEvent.click(screen.getByRole("checkbox", { name: "打开应用后自动启动皮肤" }));
    expect(onChange).toHaveBeenCalledWith({ launchAtLogin: true, autoStartSkin: false, fontPreset: "industrial", window: null });
  });

  it("persists the complete settings document when selecting a font preset", () => {
    const onChange = vi.fn();
    const settings = { launchAtLogin: true, autoStartSkin: true, fontPreset: "industrial" as const, window: null };
    render(<StartupSettings settings={settings} busy={false} onChange={onChange} />);

    expect(screen.getByRole("radio", { name: "现代界面" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "海报风格" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "技术等宽" })).not.toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: "海报风格" }));

    expect(onChange).toHaveBeenCalledWith({ ...settings, fontPreset: "poster" });
  });
});
