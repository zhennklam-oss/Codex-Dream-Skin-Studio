# Product

## Register

product

## Users

Windows Codex desktop users who want to personalize the application without editing scripts by hand. They use the Studio repeatedly to choose artwork, tune crop and tone effects, switch saved themes, and control the Dream Skin runtime. The interface must remain understandable in both Chinese and English and must be distributable to users whose Codex installation path differs from the developer machine.

## Product Purpose

Codex Dream Skin Studio is a lightweight visual controller for the existing Dream Skin injection engine. It makes theme creation, local preview, runtime start/pause/resume, restoration, startup behavior, tray controls, and installation manageable from one Tauri desktop application. Success means the preview communicates the real effect of settings, theme data migrates without loss, and applying or removing a skin never requires users to understand PowerShell, Node, CDP, or Windows package paths.

## Brand Personality

Direct, tactile, and confident. The new-brutalist visual identity should feel intentionally constructed rather than decorative: strong hierarchy, explicit controls, compact language, and motion that confirms state changes without slowing work.

## Anti-references

- Generic SaaS dashboards with nested cards, soft gradients, glass panels, and decorative metrics.
- Novel controls that obscure standard slider, tab, button, window, or tray behavior.
- Display fonts in dense settings labels, fonts without full Simplified Chinese coverage, or type scales that make Codex content look artificially small.
- Previews that simulate unsupported geometry, duplicate panes, or imply one-to-one Codex targeting that the renderer cannot guarantee.
- Hidden terminal windows, modal-heavy flows, and security ceremony that does not improve this local utility.

## Design Principles

1. Show only controls the engine can apply truthfully.
2. Keep preview structure simple enough that content cannot overlap and every adjustment has an immediate visual response.
3. Preserve standard Windows and creative-tool affordances while expressing the new-brutalist identity through hierarchy, borders, spacing, and restrained motion.
4. Treat theme files and source artwork as user data: migrate canonically, preserve unknown metadata, and never rewrite damaged assets.
5. Keep runtime state explicit. Starting, pausing, restoring, closing, and exiting must have distinct visible outcomes.

## Accessibility & Inclusion

Use font families with complete Simplified Chinese and Latin coverage. Preserve keyboard access, visible focus states, readable contrast, and standard control semantics. Respect reduced-motion preferences, keep essential state changes understandable without animation, and do not encode status by color alone.
