# Dream Skin Studio UI Decision Brief

## UI decision brief

- **Surface type:** Editor/canvas.
- **Platform idiom:** Windows desktop delivered through Tauri 2 and WebView2; preserve native title bar, Snap Layouts, keyboard focus, tray behavior, and bounded desktop panes.
- **Product thesis:** Give the user one inspectable place to select a Codex skin, calibrate its image and readability layers, apply it, and recover the official appearance.
- **Desktop archetype:** Workbench with a secondary tray utility.
- **Main object:** The selected skin image and its applied theme document.
- **Primary workspace:** A local Codex preview canvas.
- **Secondary surfaces:** Theme library, calibrated inspector, runtime command strip, error/status strip, startup settings, and tray menu.
- **Composition archetype:** Studio desk + light table + instrument panel.
- **Visual direction:** Tactile neo-brutalism, restrained for daily repeated use.
- **Density:** Operational and balanced; the canvas dominates while controls remain continuously visible.
- **Hierarchy:** Preview canvas first, Apply Changes second, theme library and inspector third, destructive recovery isolated in red.
- **Component grammar:** Stable split panes, command strip, indexed theme rows, calibrated sliders/readouts, native dialogs, and bounded drawers. Avoid decorative dashboard cards.
- **Color/materials:** Warm paper, near-black structure, acid yellow selection/warning, cobalt primary action, red destructive action, solid blocks, thick rules, and hard offset shadows. No gradients or glass surfaces.
- **State visuals:** Empty library, loading skeleton that preserves panes, damaged theme, missing image, Node unavailable, restart confirmation, applying, active, paused, failed, restored, and unsaved draft.
- **Tasteful risk:** Expose the calibration grid, focal crosshair, and numeric readouts as part of the product identity instead of hiding them behind a generic settings surface.
- **Restraint:** The grid stays inside the canvas and inspector; it never overlays reading text or native dialogs. One acid highlight per region. No decorative motion.

## Concept seed

- **Subject:** Visual control center for Codex desktop skins.
- **Metaphor:** A print studio calibration desk for a live software surface.
- **World:** Warm paper, ink rules, registration marks, labeled specimens, and instrument readouts.
- **Main object:** The background artwork under calibration.
- **Layout premise:** Artwork on the light table, materials indexed at left, instruments fixed at right, live machine status across the top.
- **Repeated motif:** Registration crosses, numbered labels, hard rules, and offset blocks.
- **One weird move:** The selected theme thumbnail carries a visible crop/focus registration mark that matches the preview crosshair.
- **Restraints:** No fake paper textures, tape stickers, rotated controls, novelty copy, or dense decoration around sliders.

## Originality brief

- **Composition archetype:** Studio desk rather than sidebar plus settings cards.
- **Specific defaults banned:** Generic dashboard overview, identical rounded cards, purple/indigo gradients, glassmorphism, Inter/Space Grotesk, floating hover cards, marketing-page hero spacing, and animated counters.
- **Memorable anchor:** The large calibrated preview canvas with the same focus and safe-area geometry used by the real theme.

## Layout sketch

```text
[RUNTIME STRIP: CODEX / SKIN / DIRTY STATE / START / PAUSE / APPLY / RESTORE]
[THEME INDEX 230] [CALIBRATED PREVIEW CANVAS, DOMINANT] [INSTRUMENT INSPECTOR 300]
[TRAY + STARTUP STATUS / ERRORS STAY BOUNDED TO THEIR FAILED REGION]
```

At widths below 1120 px, the canvas remains visible and the inspector becomes a right drawer. Theme rows scroll within the left region. The application has no page-level horizontal overflow.

## Typography personality

- **Display:** Bricolage Grotesque Variable for Latin labels and headings; Noto Sans SC Black for Chinese glyphs.
- **UI/body:** Noto Sans SC Variable with Geist-compatible proportions and a Windows UI fallback only after the bundled face.
- **Mono/labels:** JetBrains Mono Variable with Noto Sans SC fallback.
- **Why it fits:** Heavy grotesque display type gives the brutalist voice; the Chinese UI remains highly legible; mono readouts reinforce calibration without turning the entire app into a terminal.
- **Banned fallback:** Inter, Space Grotesk, Roboto, Arial, and unstyled system-ui as the primary face.

## Interaction decision

- **Budget:** Functional.
- **Techniques:** Snappy pane/drawer transitions, selected-theme connected highlight, apply-state stamp, and direct canvas drag/scale feedback.
- **Library:** CSS transitions for controls and Motion for drawer/layout continuity only.
- **Why this fits:** The editor needs continuity and feedback, but stable controls and a stationary canvas matter more than spectacle.
- **Timing:** 120–180 ms using `cubic-bezier(0.85, 0, 0.15, 1)`; no soft springs.
- **Reduced-motion behavior:** All pane and selection transitions become immediate while state labels and geometry still update.
- **Rejected:** Smooth scrolling, parallax, page-load curtain, custom cursor, magnetic buttons, pinned scroll, animated control movement, and decorative entrance cascades.

## Implementation track

- **Track:** Tauri 2 + Vite + React 19 + Tailwind CSS 4 + Motion.
- **Why this track fits:** The workbench has persistent draft state, reusable inspectors, native IPC, file dialogs, tray behavior, and interactive canvas geometry.
- **Why the simpler track was rejected:** Static HTML/CSS/JS would make typed state transitions, testable command boundaries, and component-level inspector behavior harder to maintain.
- **Required dependencies:** Tauri core/plugins, React, Zustand, Motion, Tailwind 4, Vitest, React Testing Library, and self-hosted Fontsource packages.
- **Dependency risk notes:** Keep a committed lockfile, run `npm audit`, avoid component frameworks and icon packs, and use CSS/native APIs for simple interaction.

## Asset plan

- **Theme imagery:** Existing user and built-in theme images loaded through the Tauri asset protocol; no copied private screenshots.
- **Icons:** Segoe Fluent Icons system font for Windows commands; no mixed icon packs.
- **Typography:** Self-host Bricolage Grotesque Variable, Noto Sans SC Variable, and JetBrains Mono Variable through Fontsource packages.
- **Application icon:** Original geometric registration-mark icon built as SVG and exported to Tauri icon sizes.
- **Texture:** CSS grid/rules only; no bitmap paper texture.
- **Reference extraction:** Preserve the existing Dream Skin theme/runtime information architecture and Codex pane proportions without copying Codex branding or proprietary UI assets.
- **License risk:** Open-source fonts and original geometric assets only.

## Quality bar

- **Specific job:** Calibrate and operate a selected Codex skin.
- **Proof surface:** The local preview reproduces the exact theme fields that the bundled injector consumes.
- **Required states:** Empty, loading, damaged, blocked, dirty, applying, active, paused, failed, and restored.
- **Scan-speed decision:** Runtime status and primary commands stay fixed; numeric values remain adjacent to sliders; theme names and active state are visible without opening dialogs.
- **Memorable anchor:** Calibrated image light table with focus crosshair and safe-area overlay.
