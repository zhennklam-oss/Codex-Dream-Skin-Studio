import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (relativePath) => readFile(new URL(`../../${relativePath}`, import.meta.url), "utf8");
const evidence = (fileName) => new URL(`../../docs/verification/${fileName}`, import.meta.url);

test("persists and applies all three typography presets", async () => {
  const [settings, selector, app] = await Promise.all([
    read("src-tauri/src/model/settings.rs"),
    read("src/components/settings/StartupSettings.tsx"),
    read("src/App.tsx"),
  ]);

  for (const preset of ["Industrial", "Poster", "Mono"]) {
    assert.match(settings, new RegExp(`\\b${preset}\\b`));
  }
  for (const preset of ["industrial", "poster", "mono"]) {
    assert.match(selector, new RegExp(`value=["']${preset}["']`));
  }
  assert.match(app, /document\.documentElement\.dataset\.fontPreset/);
  assert.match(app, /saveSettings/);
});

test("maps direct X and Y movement in the same visible direction", async () => {
  const math = await read("src/components/preview/position-math.ts");
  assert.match(math, /focusX:\s*roundFocus\(clamp\(start\.focusX\s*-\s*deltaX\s*\/\s*bounds\.width/);
  assert.match(math, /focusY:\s*roundFocus\(clamp\(start\.focusY\s*-\s*deltaY\s*\/\s*bounds\.height/);
  assert.match(math, /focusX:\s*roundFocus\(clamp\(0\.5\s*-\s*x\s*\/\s*200/);
  assert.match(math, /focusY:\s*roundFocus\(clamp\(0\.5\s*-\s*y\s*\/\s*200/);
});

test("uses frameless configuration and integrated window controls", async () => {
  const [configText, capabilityText, app, controls] = await Promise.all([
    read("src-tauri/tauri.conf.json"),
    read("src-tauri/capabilities/default.json"),
    read("src/App.tsx"),
    read("src/components/window/WindowControls.tsx"),
  ]);
  const config = JSON.parse(configText);
  const capability = JSON.parse(capabilityText);
  assert.equal(config.app.windows[0].decorations, false);
  assert.equal(config.app.windows[0].resizable, true);
  assert.deepEqual(capability.windows, ["main"]);
  assert.deepEqual(
    capability.permissions.filter((permission) => permission.startsWith("core:window:")),
    [
      "core:window:allow-close",
      "core:window:allow-minimize",
      "core:window:allow-start-dragging",
      "core:window:allow-toggle-maximize",
      "core:window:allow-is-maximized",
    ],
  );
  assert.equal(capability.permissions.includes("core:window:*"), false);
  assert.equal(capability.permissions.includes("dialog:allow-open"), true);
  assert.equal(capability.permissions.includes("dialog:default"), false);
  assert.match(app, /<WindowControls/);
  assert.match(controls, /client\.minimize\(\)/);
  assert.match(controls, /client\.toggleMaximize\(\)/);
  assert.match(controls, /client\.close\(\)/);
});

test("keeps the calibrated preview structural and shadow-free", async () => {
  const [preview, css] = await Promise.all([
    read("src/components/preview/PreviewCanvas.tsx"),
    read("src/styles/app.css"),
  ]);
  assert.match(preview, /data-testid=["']preview-artwork-layer["']/);
  assert.match(preview, /data-testid=["']preview-title-bar["']/);
  assert.match(preview, /data-testid=["']preview-codex-grid["']/);
  assert.doesNotMatch(preview, /preview-shadow/);
  assert.doesNotMatch(preview, /preview-region-|codex-geometry/);

  const canvasRule = css.match(/\.preview-canvas\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(canvasRule, "preview-canvas rule is required");
  assert.doesNotMatch(canvasRule, /box-shadow\s*:/);
});

test("documents the non-destructive acceptance boundary", async () => {
  const checklist = await read("docs/verification/release-checklist.md");
  assert.match(checklist, /真实 Codex restart\/Restore\/pause\/resume：待用户单独确认/);
});

test("bundles full-CJK font families and lays startup settings out inline", async () => {
  const [css, settings] = await Promise.all([
    read("src/styles/app.css"),
    read("src/components/settings/StartupSettings.tsx"),
  ]);
  for (const family of ["HarmonyOS Sans SC", "Smiley Sans", "Sarasa Mono SC"]) {
    assert.match(css, new RegExp(`font-family:\\s*"${family}"`));
  }
  assert.match(settings, /font-preset-settings/);
  assert.doesNotMatch(css.match(/\.startup-settings\s*\{[\s\S]*?\n\}/)?.[0] ?? "", /position:\s*(absolute|fixed)/);
});

test("ships the five-page inspector with six mapped interface controls", async () => {
  const [tabs, inspector, preview, themeLibrary, css] = await Promise.all([
    read("src/components/inspector/InspectorTabs.tsx"),
    read("src/components/inspector/ThemeInspector.tsx"),
    read("src/components/preview/PreviewCanvas.tsx"),
    read("src/components/themes/ThemeLibrary.tsx"),
    read("src/styles/app.css"),
  ]);
  for (const label of ["图片", "构图", "色调", "光效", "界面"]) assert.match(inspector, new RegExp(label));
  for (const mode of ["original", "grayscale", "duotone", "wash"]) assert.match(inspector, new RegExp(mode));
  assert.match(inspector, /界面背景透明度/);
  for (const field of [
    "interfaceOpacity",
    "leftSidebarOpacity",
    "topBarOpacity",
    "rightSidebarOpacity",
    "bottomBarOpacity",
    "inputOpacity",
  ]) {
    assert.match(`${inspector}\n${preview}`, new RegExp(field));
  }
  for (const testId of [
    "preview-codex-grid",
    "preview-right-panel",
    "preview-bottom-panel",
    "preview-composer",
  ]) {
    assert.match(preview, new RegExp(`data-testid=["']${testId}["']`));
  }
  for (const alias of ["sidebarOpacity", "composerOpacity"]) assert.doesNotMatch(inspector, new RegExp(alias));
  assert.match(themeLibrary, /aria-label={`删除 \$\{theme\.name\}`}/);
  assert.doesNotMatch(`${tabs}\n${inspector}\n${preview}`, /内容避让区|focus-crosshair|safe-area/);
  assert.match(inspector, /同步调整全部界面区域/);
  assert.doesNotMatch(`${inspector}\n${preview}`, /preview-region-|preview-bottom-fade|preview-bottom-actions/);
  assert.match(css, /\.preview-codex-grid\s*\{/);
  for (const structuralClass of [
    "preview-title-bar",
    "preview-left-navigation",
    "preview-route-header",
    "preview-main-content",
    "preview-right-panel",
    "preview-composer",
    "preview-bottom-panel",
  ]) {
    const rules = css.match(new RegExp(`\\.${structuralClass}\\s*\\{[\\s\\S]*?\\n\\}`, "g")) ?? [];
    assert.ok(rules.length > 0, `${structuralClass} rule is required`);
    for (const rule of rules) assert.doesNotMatch(rule, /position:\s*absolute/);
  }
  const composerRules = (css.match(/\.preview-composer\s*\{[\s\S]*?\n\}/g) ?? []).join("\n");
  assert.match(composerRules, /--preview-input-opacity/);
  assert.doesNotMatch(composerRules, /--preview-bottom-opacity/);
  const stageRule = css.match(/\.preview-stage\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(stageRule, /aspect-ratio:\s*1296\s*\/\s*830/);
  assert.doesNotMatch(stageRule, /background:\s*(#000|black|rgb\(0)/i);
});

test("removes the region contract and keeps Studio acceptance on the unified preview grid", async () => {
  const removedPaths = [
    "src-tauri/resources/dream-skin-engine/assets/codex-region-contract.json",
    "src-tauri/resources/dream-skin-engine/assets/region-contract.js",
    "src-tauri/resources/dream-skin-engine/tests/region-contract.test.mjs",
    "tests/acceptance/cdp-codex-region-contract.mjs",
    "docs/verification/codex-region-structure-26.715.3651.json",
  ];
  for (const relativePath of removedPaths) {
    await assert.rejects(access(new URL(`../../${relativePath}`, import.meta.url)));
  }

  const acceptance = await read("tests/acceptance/cdp-studio-acceptance.mjs");
  assert.match(acceptance, /preview-codex-grid/);
  assert.match(acceptance, /preview-main-content/);
  assert.match(acceptance, /preview-right-panel/);
  assert.match(acceptance, /preview-bottom-panel/);
  assert.match(acceptance, /preview-composer/);
  assert.match(acceptance, /mainAboveComposer:\s*main\.bottom\s*<=\s*composer\.top/);
  assert.match(acceptance, /composerAboveBottom:\s*composer\.bottom\s*<=\s*bottom\.top/);
  assert.match(acceptance, /rightBesideMain:\s*right\.left\s*>=\s*main\.right/);
  assert.doesNotMatch(acceptance, /preview-region-|regionContract|Four-region|four-region/);
});

test("records advanced-control screenshots and install preservation evidence", async () => {
  const screenshots = [
    "studio-settings-inline.png",
    "studio-inspector-tabs.png",
    "studio-tone-modes.png",
    "studio-region-controls.png",
    "studio-crop-preview.png",
  ];
  await Promise.all(screenshots.map((fileName) => access(evidence(fileName))));
  const preservation = JSON.parse(await read("docs/verification/install-preservation-theme-controls.json"));
  assert.equal(preservation.mode, "non-destructive");
  assert.equal(preservation.preserved, true);
  assert.equal(preservation.sourceImageSha256, "01762A9AE36F7E246AE2F80434AD14DFFCD1C0438363501D3B3635494CBE8D62");
  assert.equal(preservation.before.port9335OwnerPid, preservation.after.port9335OwnerPid);
  assert.deepEqual(preservation.before.themeIds, preservation.after.themeIds);
});
