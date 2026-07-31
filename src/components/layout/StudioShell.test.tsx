// @ts-expect-error Node types are intentionally absent from the frontend build.
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { StudioShell } from "./StudioShell";

afterEach(cleanup);

function renderShell() {
  return render(
    <StudioShell
      library={<div>Library placeholder</div>}
      preview={<div>Preview placeholder</div>}
      inspector={<div>Inspector placeholder</div>}
      runtime={<div>Runtime placeholder</div>}
    />,
  );
}

describe("StudioShell", () => {
  it("exposes the stable workbench regions by name", () => {
    renderShell();

    expect(
      screen.getByRole("region", { name: "Runtime Controls" }),
    ).toBeVisible();
    expect(
      screen.getByRole("region", { name: "Theme Library" }),
    ).toBeVisible();
    expect(
      screen.getByRole("region", { name: "Preview Canvas" }),
    ).toBeVisible();
    expect(
      screen.getByRole("region", { name: "Theme Inspector" }),
    ).toBeVisible();
  });

  it("provides an accessible inspector drawer toggle for compact widths", async () => {
    const user = userEvent.setup();
    renderShell();

    const toggle = screen.getByRole("button", { name: "打开主题检查器" });
    const inspector = screen.getByRole("region", { name: "Theme Inspector" });

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(inspector).toHaveAttribute("data-drawer-open", "false");

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(inspector).toHaveAttribute("data-drawer-open", "true");
    expect(
      screen.getByRole("button", { name: "关闭主题检查器" }),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "关闭主题检查器" }));

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(inspector).toHaveAttribute("data-drawer-open", "false");
  });

  it("lets the runtime row grow in document flow instead of fixing its height", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const shellRule = css.match(/\.studio-shell\s*\{[^}]+\}/)?.[0] ?? "";
    const settingsBandRule = css.match(/\.runtime-settings-band\s*\{[^}]+\}/)?.[0] ?? "";

    expect(shellRule).toContain("grid-template-rows: auto minmax(0, 1fr)");
    expect(shellRule).not.toContain("--runtime-height");
    expect(settingsBandRule).not.toContain("position: absolute");
    expect(settingsBandRule).not.toContain("position: fixed");
  });
});
