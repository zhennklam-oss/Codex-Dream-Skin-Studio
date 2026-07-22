import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const documentPath = path.join(root, "docs", "ENGINEERING_RETROSPECTIVE.zh-CN.md");

test("engineering retrospective is evidence-backed and reusable", async () => {
  const text = await fs.readFile(documentPath, "utf8");
  for (const heading of [
    "摘要",
    "项目如何从脚本变成桌面应用",
    "它与无约束 vibecoding 的区别",
    "实际采用的开发流程",
    "使用的 Skill 如何改变工作方式",
    "代表性工程案例",
    "专业限制清单",
    "当前证据与仍然存在的限制",
    "后续开发基线",
  ]) assert.match(text, new RegExp(`^## ${heading}$`, "m"));

  for (const evidence of [
    "docs/superpowers/specs/2026-07-20-runtime-lifecycle-reconciliation-design.md",
    "docs/superpowers/plans/2026-07-20-runtime-lifecycle-reconciliation-implementation.md",
    "tests/acceptance/runtime-lifecycle-contract.test.mjs",
    "tests/acceptance/publication-contract.test.mjs",
    "src-tauri/resources/dream-skin-engine/tests/runtime-lifecycle.test.mjs",
    "PRODUCT.md",
    "THIRD_PARTY_NOTICES.md",
  ]) assert.match(text, new RegExp(evidence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  for (const fact of [
    "26/26", "178/178", "31/31", "108 passed", "2 ignored", "20/20",
    "Node.js 24.18.0", "Engine 1.6.0", "Theme schema 4", "09a5e00",
    "3A348CF55BC8985177053C066105AEAAB3087BED574E9BD24EA88D260177CE1E",
  ]) assert.match(text, new RegExp(fact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  for (const checklist of [
    "新功能检查表", "Bug 修复检查表", "UI 变更检查表",
    "引擎变更检查表", "发布检查表", "Definition of Done",
  ]) assert.match(text, new RegExp(checklist));

  for (const privateMarker of [
    "C:" + "\\Users\\",
    "D:" + "\\Codex-Dream-Skin-Studio",
    "3840" + "-",
    "萦萦" + ".jpg",
  ]) assert.equal(text.includes(privateMarker), false);
  assert.doesNotMatch(text, /TBD|TODO|稍后补充|待完善/);
});
