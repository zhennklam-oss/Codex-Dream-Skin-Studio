import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFile(path.join(root, relative), "utf8");

test("Cargo and Tauri use the standard src-tauri target directory", async () => {
  const [ignore, bundleScript, liveScript, snapshotScript] = await Promise.all([
    read(".gitignore"),
    read("tests/acceptance/bundle-payload.test.ps1"),
    read("tests/acceptance/runtime-lifecycle-live.ps1"),
    read("scripts/create-public-snapshot.ps1"),
  ]);
  await assert.rejects(fs.stat(path.join(root, ".cargo/config.toml")), { code: "ENOENT" });
  assert.doesNotMatch(ignore, /^\.cargo-target-cache-20260721\/$/m);
  assert.match(ignore, /^src-tauri\/target\/$/m);
  assert.match(ignore, /^docs\/verification\/studio-dom\.json$/m);
  assert.match(ignore, /^docs\/verification\/studio-main\.png$/m);
  assert.match(ignore, /^docs\/verification\/runtime-lifecycle-reconciliation\.json$/m);
  assert.match(bundleScript, /src-tauri[\\/]target[\\/]release/);
  assert.match(liveScript, /src-tauri[\\/]target[\\/]release[\\/]bundle[\\/]nsis/);
  assert.doesNotMatch(snapshotScript, /\.cargo-target-cache-20260721/);
});

test("personal verification captures are not tracked for publication", () => {
  const tracked = execFileSync("git", [
    "ls-files",
    "--",
    "docs/verification/studio-dom.json",
    "docs/verification/studio-main.png",
    "docs/verification/runtime-lifecycle-reconciliation.json",
  ], { cwd: root, encoding: "utf8" });
  assert.equal(tracked.trim(), "");
});

test("public documentation is bilingual, current, and explicitly unofficial", async () => {
  const [readme, license] = await Promise.all([read("README.md"), read("LICENSE")]);
  const chinese = readme.match(/## 中文([\s\S]*?)## English/)?.[1] ?? "";
  const english = readme.match(/## English([\s\S]*)/)?.[1] ?? "";

  assert.match(readme, /^# Codex Dream Skin Studio$/m);
  assert.match(readme, /^\[中文\]\(#中文\) · \[English\]\(#english\)$/m);
  assert.match(readme, /^## 中文$/m);
  assert.match(readme, /^## English$/m);

  for (const heading of [
    "项目简介",
    "功能",
    "系统要求",
    "安装",
    "使用方法",
    "恢复官方外观",
    "数据与隐私",
    "从源码构建",
    "测试",
    "常见问题",
    "项目状态与免责声明",
    "许可证",
  ]) {
    assert.match(chinese, new RegExp(`^### ${heading}$`, "m"));
  }

  for (const heading of [
    "Overview",
    "Features",
    "Requirements",
    "Installation",
    "Usage",
    "Restore the official appearance",
    "Data and privacy",
    "Build from source",
    "Tests",
    "Troubleshooting",
    "Project status and disclaimer",
    "License",
  ]) {
    assert.match(english, new RegExp(`^### ${heading}$`, "m"));
  }

  for (const section of [chinese, english]) {
    assert.match(section, /Windows 11/);
    assert.match(section, /Microsoft Edge WebView2/);
    assert.match(section, /OpenAI\.Codex/);
    assert.match(section, /Node\.js 24\.18\.0/);
    assert.match(section, /Node\.js 22\+/);
    assert.match(section, /0\.2\.0/);
    assert.match(section, /Engine 1\.7\.0/);
    assert.match(section, /Theme schema 5/);
    assert.match(section, /PNG/);
    assert.match(section, /JPEG/);
    assert.match(section, /WebP/);
    assert.match(section, /%LOCALAPPDATA%\\CodexDreamSkin/);
    assert.match(section, /%LOCALAPPDATA%\\CodexDreamSkinStudio/);
    assert.match(section, /127\.0\.0\.1|loopback/i);
    assert.match(section, /WindowsApps/);
    assert.match(section, /app\.asar/);
    assert.match(section, /npm install/);
    assert.match(section, /npm test -- --run/);
    assert.match(section, /npm run tauri build/);
    assert.match(
      section,
      /src-tauri\\target\\release\\bundle\\nsis\\Codex Dream Skin Studio_0\.2\.0_x64-setup\.exe/,
    );
  }

  assert.match(chinese, /非官方社区项目/);
  assert.match(chinese, /不隶属于.*OpenAI.*背书/s);
  assert.match(english, /unofficial community project/i);
  assert.match(english, /not affiliated with or endorsed by OpenAI/i);
  assert.doesNotMatch(readme, /AEC64AFB574344B34133508F54E207A05D6C38F015DEE917E900D305CA16271E/);
  assert.match(license, /^MIT License$/m);
  assert.match(license, /Copyright \(c\) 2026 zhennklam-oss/);
});

test("bundled artwork and notices are safe for public redistribution", async () => {
  const [manifest, theme, license, notices, readme] = await Promise.all([
    read("src-tauri/resources/dream-skin-engine/ENGINE-SOURCE.json"),
    read("src-tauri/resources/dream-skin-engine/assets/theme.json"),
    read("LICENSE"),
    read("THIRD_PARTY_NOTICES.md"),
    read("README.md"),
  ]);
  assert.match(manifest, /assets\/portal-hero\.png/);
  assert.doesNotMatch(manifest, /dream-reference\.jpg/);
  assert.match(theme, /"id"\s*:\s*"preset-dream-portal"/);
  assert.match(theme, /"name"\s*:\s*"梦境门户"/);
  assert.match(theme, /"image"\s*:\s*"portal-hero\.png"/);
  assert.match(license, /Copyright \(c\) 2026 Codex Dream Skin Studio contributors/);
  assert.match(license, /Copyright \(c\) 2026 zhennklam-oss/);
  assert.match(notices, /Fei-Away\/Codex-Dream-Skin/);
  assert.match(notices, /3af1d6d62f3a0388cc640d2f497ac3100998938e/);
  assert.match(notices, /portal-hero\.png/);
  assert.match(notices, /runtime\/LICENSE/);
  assert.doesNotMatch(readme, /cache on the D drive|D 盘缓存目录/);
});

async function collectTextFiles(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectTextFiles(absolute));
    else {
      const buffer = await fs.readFile(absolute);
      if (!buffer.includes(0)) files.push(absolute);
    }
  }
  return files;
}

test("public snapshot has one clean commit and no private paths", async (context) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "dream-skin-publication-"));
  const snapshot = path.join(temporary, "snapshot");
  context.after(() => fs.rm(temporary, { recursive: true, force: true }));

  execFileSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", path.join(root, "scripts", "create-public-snapshot.ps1"),
    "-Destination", snapshot,
    "-RepositoryName", "Codex-Dream-Skin-Studio",
  ], { cwd: root, encoding: "utf8", stdio: "pipe" });

  await assert.rejects(fs.access(path.join(snapshot, "docs", "verification")));
  await fs.access(path.join(snapshot, "tests", "acceptance", "runtime-lifecycle-live.ps1"));
  assert.equal(execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: snapshot, encoding: "utf8" }).trim(), "1");
  assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: snapshot, encoding: "utf8" }).trim(), "");

  const engineRoot = path.join(snapshot, "src-tauri", "resources", "dream-skin-engine");
  const manifest = JSON.parse(await fs.readFile(path.join(engineRoot, "ENGINE-SOURCE.json"), "utf8"));
  for (const entry of manifest.files) {
    const bytes = await fs.readFile(path.join(engineRoot, entry.path));
    const actual = createHash("sha256").update(bytes).digest("hex");
    assert.equal(actual, entry.sha256, `${entry.path} changed bytes in the public snapshot`);
  }

  const forbidden = [
    new RegExp(String.raw`C:\\Users\\` + "aqlte", "i"),
    new RegExp(String.raw`D:\\Codex-Dream-Skin` + "-Studio", "i"),
    new RegExp("3840" + "-"),
    new RegExp("萦萦" + String.raw`\.jpg`, "u"),
  ];
  for (const file of await collectTextFiles(snapshot)) {
    const content = await fs.readFile(file, "utf8");
    for (const pattern of forbidden) {
      assert.doesNotMatch(content, pattern, `${path.relative(snapshot, file)} contains ${pattern}`);
    }
  }
});
