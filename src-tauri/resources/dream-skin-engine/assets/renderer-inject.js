((cssText, artDataUrl, rawConfig) => {
  const STATE_KEY = "__CODEX_DREAM_SKIN_STATE__";
  const STYLE_ID = "codex-dream-skin-style";
  const CHROME_ID = "codex-dream-skin-chrome";
  const ROOT_CLASSES = [
    "codex-dream-skin",
    "dream-theme-light",
    "dream-theme-dark",
    "dream-art-wide",
    "dream-art-standard",
    "dream-focus-left",
    "dream-focus-center",
    "dream-focus-right",
    "dream-task-ambient",
    "dream-task-banner",
    "dream-task-off",
    "dream-tone-original",
    "dream-tone-grayscale",
    "dream-tone-duotone",
    "dream-tone-wash",
    "dream-route-home",
    "dream-route-task",
    "dream-layout-left-open",
    "dream-layout-right-open",
    "dream-layout-bottom-open",
    "dream-input-custom",
  ];
  const ROOT_PROPERTIES = [
    "--dream-art",
    "--dream-art-position",
    "--dream-focus-x",
    "--dream-focus-y",
    "--dream-accent",
    "--dream-accent-ink",
    "--dream-image-luma",
    "--dream-home-opacity",
    "--dream-ambient-opacity",
    "--dream-art-blur",
    "--dream-art-saturation",
    "--dream-art-brightness",
    "--dream-mask-strength",
    "--dream-interface-opacity",
    "--dream-left-sidebar-opacity",
    "--dream-top-bar-opacity",
    "--dream-right-sidebar-opacity",
    "--dream-bottom-bar-opacity",
    "--dream-input-opacity",
    "--dream-tone-mode",
    "--dream-tone-strength",
    "--dream-duotone-shadow",
    "--dream-duotone-highlight",
    "--dream-wash-color",
    "--dream-art-scale",
    "--dream-art-rendered-width",
    "--dream-art-rendered-height",
    "--dream-art-offset-x",
    "--dream-art-offset-y",
  ];
  const SURFACE_CLASS_BY_NAME = {
    main: "dream-surface-main",
    top: "dream-surface-top",
    left: "dream-surface-left",
    right: "dream-surface-right",
    bottom: "dream-surface-bottom",
    input: "dream-surface-input",
    card: "dream-control-card",
  };
  const SURFACE_CLASSES = [
    ...Object.values(SURFACE_CLASS_BY_NAME),
    "dream-control-input",
  ];
  const installToken = {};
  let samplingNativeShell = false;
  let observer = null;
  const matchedSurfaceElements = new Map();
  const surfaceState = Object.fromEntries(
    ["main", "top", "left", "right", "bottom", "card", "input"]
      .map((name) => [name, { available: false, count: 0 }]),
  );
  window.__CODEX_DREAM_SKIN_DISABLED__ = false;

  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number(value)));
  const pixel = (value) => `${Math.round(value * 1000) / 1000}px`;
  const luminance = (red, green, blue) => {
    const linear = [red, green, blue].map((value) => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
  };
  const defaultProfile = {
    appearance: "dark",
    accent: [108, 131, 142],
    focusX: .5,
    focusY: .5,
    aspect: 1.6,
    luma: .32,
  };

  const normalizeConfig = (value) => {
    const config = value && typeof value === "object" ? value : {};
    const schemaVersion = config.schemaVersion ?? 5;
    const art = config.art && typeof config.art === "object" ? config.art : {};
    const effects = config.effects && typeof config.effects === "object" ? config.effects : {};
    const hasNumber = (candidate) =>
      (typeof candidate === "number" || (typeof candidate === "string" && candidate.trim() !== "")) &&
      Number.isFinite(Number(candidate));
    const requestedAccent = typeof config?.palette?.accent === "string"
      ? config.palette.accent.trim()
      : "";
    const safeAccent = /^(?:#[\da-f]{3,8}|(?:rgb|hsl|oklch|oklab)\([^;{}]{1,96}\))$/i.test(requestedAccent)
      ? requestedAccent
      : null;
    const appearance = ["auto", "light", "dark"].includes(config.appearance)
      ? config.appearance
      : "auto";
    const safeArea = ["auto", "left", "right", "center", "none"].includes(art.safeArea)
      ? art.safeArea
      : "auto";
    const taskMode = ["auto", "ambient", "banner", "off"].includes(art.taskMode)
      ? art.taskMode
      : "auto";
    const metadataRatio = Number(config?.artMetadata?.ratio);
    const bounded = (candidate, minimum, maximum, fallback) => {
      if (!hasNumber(candidate)) return fallback;
      return clamp(candidate, minimum, maximum);
    };
    const toneMode = ["original", "grayscale", "duotone", "wash"].includes(effects.toneMode)
      ? effects.toneMode
      : "original";
    const hexColor = (candidate, fallback) =>
      typeof candidate === "string" && /^#[0-9A-Fa-f]{6}$/.test(candidate) ? candidate : fallback;
    const interfaceOpacity = bounded(effects.interfaceOpacity, 0, 1, .78);
    const regionOpacity = (field, legacyField = null) => bounded(
      effects[field],
      0,
      1,
      legacyField ? bounded(effects[legacyField], 0, 1, interfaceOpacity) : interfaceOpacity,
    );
    const inputOpacity = effects.inputOpacity !== undefined
      ? bounded(effects.inputOpacity, 0, 1, .9)
      : effects.composerOpacity !== undefined
        ? bounded(effects.composerOpacity, 0, 1, .9)
        : schemaVersion <= 4 && effects.bottomBarOpacity !== undefined
          ? bounded(effects.bottomBarOpacity, 0, 1, .9)
          : .9;
    const bottomBarOpacity = schemaVersion === 5
      ? regionOpacity("bottomBarOpacity")
      : interfaceOpacity;
    return {
      appearance,
      safeArea,
      taskMode,
      focusX: hasNumber(art.focusX) ? clamp(art.focusX) : null,
      focusY: hasNumber(art.focusY) ? clamp(art.focusY) : null,
      scale: bounded(art.scale, .5, 2.5, 1),
      effects: {
        homeOpacity: bounded(effects.homeOpacity, 0, 1, 1),
        taskOpacity: bounded(effects.taskOpacity, 0, 1, .18),
        blur: bounded(effects.blur, 0, 32, 0),
        saturation: bounded(effects.saturation, 0, 2, 1),
        brightness: bounded(effects.brightness, .5, 1.5, 1),
        maskStrength: bounded(effects.maskStrength, 0, 1, .65),
        interfaceOpacity,
        leftSidebarOpacity: regionOpacity("leftSidebarOpacity", "sidebarOpacity"),
        topBarOpacity: regionOpacity("topBarOpacity"),
        rightSidebarOpacity: regionOpacity("rightSidebarOpacity"),
        bottomBarOpacity,
        inputOpacity,
        toneMode,
        toneStrength: bounded(effects.toneStrength, 0, 1, 1),
        duotoneShadow: hexColor(effects.duotoneShadow, "#1C1B22"),
        duotoneHighlight: hexColor(effects.duotoneHighlight, "#F2E9DC"),
        washColor: hexColor(effects.washColor, "#7D9FA5"),
      },
      accent: safeAccent,
      initialAspect: Number.isFinite(metadataRatio) && metadataRatio > 0 ? metadataRatio : null,
    };
  };

  const previous = window[STATE_KEY];
  if (previous?.observer) previous.observer.disconnect();
  if (previous?.timer) clearInterval(previous.timer);
  if (previous?.scheduler?.timeout) clearTimeout(previous.scheduler.timeout);
  if (previous?.onViewportChange) {
    window.removeEventListener?.("resize", previous.onViewportChange);
    window.visualViewport?.removeEventListener?.("resize", previous.onViewportChange);
    window.visualViewport?.removeEventListener?.("scroll", previous.onViewportChange);
  }
  if (previous?.artUrl) URL.revokeObjectURL(previous.artUrl);
  for (const className of SURFACE_CLASSES) {
    document.querySelectorAll?.(`.${className}`)?.forEach?.((node) => node.classList.remove(className));
  }
  const artUrl = (() => {
    const comma = artDataUrl.indexOf(",");
    const binary = atob(artDataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const mime = /^data:([^;,]+)/.exec(artDataUrl)?.[1] || "image/png";
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  })();
  const config = normalizeConfig(rawConfig);
  let profile = {
    ...defaultProfile,
    aspect: config.initialAspect ?? defaultProfile.aspect,
  };
  const existingStyle = document.getElementById(STYLE_ID);
  if (existingStyle) {
    existingStyle.textContent = cssText;
    existingStyle.dataset.dreamVersion = "6";
  }

  const analyzeArt = () => new Promise((resolve) => {
    if (typeof Image !== "function") {
      resolve(defaultProfile);
      return;
    }
    const image = new Image();
    image.onload = () => {
      try {
        const width = 48;
        const height = Math.max(12, Math.round(width * image.naturalHeight / image.naturalWidth));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext?.("2d", { willReadFrequently: true });
        if (!context) throw new Error("Canvas is unavailable");
        context.drawImage(image, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height).data;
        let count = 0;
        let totalRed = 0;
        let totalGreen = 0;
        let totalBlue = 0;
        let totalBrightness = 0;
        const samples = [];
        for (let offset = 0; offset < pixels.length; offset += 4) {
          if (pixels[offset + 3] < 96) continue;
          const red = pixels[offset];
          const green = pixels[offset + 1];
          const blue = pixels[offset + 2];
          const light = (.2126 * red + .7152 * green + .0722 * blue) / 255;
          const sample = { red, green, blue, light, index: offset / 4 };
          samples.push(sample);
          totalRed += red;
          totalGreen += green;
          totalBlue += blue;
          totalBrightness += light;
          count += 1;
        }
        if (!count) throw new Error("Image contains no opaque pixels");
        const average = [totalRed / count, totalGreen / count, totalBlue / count];
        const averageBrightness = totalBrightness / count;
        let focusWeight = 0;
        let focusX = 0;
        let focusY = 0;
        let accentWeight = 0;
        let accent = [0, 0, 0];
        for (const sample of samples) {
          const x = sample.index % width;
          const y = Math.floor(sample.index / width);
          const difference = Math.sqrt(
            (sample.red - average[0]) ** 2 +
            (sample.green - average[1]) ** 2 +
            (sample.blue - average[2]) ** 2,
          ) / 441.7;
          const saliency = .03 + difference ** 1.35;
          focusX += (x / Math.max(1, width - 1)) * saliency;
          focusY += (y / Math.max(1, height - 1)) * saliency;
          focusWeight += saliency;
          const max = Math.max(sample.red, sample.green, sample.blue);
          const min = Math.min(sample.red, sample.green, sample.blue);
          const saturation = max ? (max - min) / max : 0;
          const usableLight = 1 - Math.min(1, Math.abs(sample.light - .46) / .54);
          const weight = saturation ** 2 * (.15 + usableLight);
          accent[0] += sample.red * weight;
          accent[1] += sample.green * weight;
          accent[2] += sample.blue * weight;
          accentWeight += weight;
        }
        const resolvedAccent = accentWeight > 1
          ? accent.map((channel) => Math.round(channel / accentWeight))
          : average.map((channel) => Math.round(channel));
        const resolvedFocusX = clamp(focusX / focusWeight);
        resolve({
          appearance: averageBrightness >= .58 ? "light" : "dark",
          accent: resolvedAccent,
          focusX: resolvedFocusX,
          focusY: clamp(focusY / focusWeight),
          aspect: image.naturalWidth / Math.max(1, image.naturalHeight),
          luma: clamp(averageBrightness),
        });
      } catch {
        resolve(defaultProfile);
      }
    };
    image.onerror = () => resolve(defaultProfile);
    image.src = artUrl;
  });

  const detectShellAppearance = () => {
    const root = document.documentElement;
    const body = document.body;
    const classes = `${root?.className || ""} ${body?.className || ""}`
      .toLowerCase()
      .replace(/\bdream-theme-(?:dark|light)\b/g, "");
    if (/\b(dark|electron-dark|theme-dark|appearance-dark)\b/.test(classes)) return "dark";
    if (/\b(light|electron-light|theme-light|appearance-light)\b/.test(classes)) return "light";

    const dataTheme = (
      root?.getAttribute?.("data-theme") ||
      root?.getAttribute?.("data-appearance") ||
      root?.getAttribute?.("data-color-mode") ||
      body?.getAttribute?.("data-theme") ||
      body?.getAttribute?.("data-appearance") ||
      ""
    ).toLowerCase();
    if (dataTheme.includes("dark")) return "dark";
    if (dataTheme.includes("light")) return "light";

    try {
      const hadSkin = root?.classList?.contains?.("codex-dream-skin");
      const savedSkinClasses = hadSkin
        ? ROOT_CLASSES.filter((className) => root.classList.contains(className))
        : [];
      samplingNativeShell = true;
      if (hadSkin) root.classList.remove(...ROOT_CLASSES);
      try {
        const colorScheme = getComputedStyle(root).colorScheme || "";
        if (colorScheme.includes("dark") && !colorScheme.includes("light")) return "dark";
        if (colorScheme.includes("light") && !colorScheme.includes("dark")) return "light";
      } finally {
        if (hadSkin) root.classList.add(...savedSkinClasses);
        observer?.takeRecords?.();
        samplingNativeShell = false;
      }
    } catch {
      samplingNativeShell = false;
    }
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch {}
    return "light";
  };

  const clearSkinDom = () => {
    const root = document.documentElement;
    root?.classList.remove(...ROOT_CLASSES);
    for (const property of ROOT_PROPERTIES) root?.style.removeProperty(property);
    document.querySelectorAll(".dream-home").forEach((node) => node.classList.remove("dream-home"));
    document.querySelectorAll(".dream-task").forEach((node) => node.classList.remove("dream-task"));
    document.querySelectorAll(".dream-home-shell").forEach((node) => node.classList.remove("dream-home-shell"));
    for (const [node, classes] of matchedSurfaceElements) node.classList.remove(...classes);
    matchedSurfaceElements.clear();
    for (const name of Object.keys(surfaceState)) surfaceState[name] = { available: false, count: 0 };
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(CHROME_ID)?.remove();
  };

  const applyProfile = (root) => {
    const focusX = config.focusX ?? profile.focusX;
    const focusY = config.focusY ?? profile.focusY;
    const appearance = config.appearance === "auto" ? detectShellAppearance() : config.appearance;
    const focus = focusX < .4 ? "left" : focusX > .6 ? "right" : "center";
    const taskMode = config.taskMode === "auto"
      ? profile.aspect >= 2.25 ? "banner" : "ambient"
      : config.taskMode;
    const accent = config.accent || `rgb(${profile.accent.join(" ")})`;
    const accentInk = luminance(...profile.accent) > .42 ? "rgb(26 24 28)" : "rgb(250 248 251)";
    root.classList.toggle("dream-theme-light", appearance === "light");
    root.classList.toggle("dream-theme-dark", appearance === "dark");
    root.classList.toggle("dream-art-wide", profile.aspect >= 1.75);
    root.classList.toggle("dream-art-standard", profile.aspect < 1.75);
    for (const value of ["left", "center", "right"]) {
      root.classList.toggle(`dream-focus-${value}`, focus === value);
    }
    for (const value of ["ambient", "banner", "off"]) {
      root.classList.toggle(`dream-task-${value}`, taskMode === value);
    }
    for (const value of ["original", "grayscale", "duotone", "wash"]) {
      root.classList.toggle(`dream-tone-${value}`, config.effects.toneMode === value);
    }
    const viewportWidth = Math.max(1, Number(globalThis.innerWidth || root.clientWidth || 1));
    const viewportHeight = Math.max(1, Number(globalThis.innerHeight || root.clientHeight || 1));
    const viewportAspect = viewportWidth / viewportHeight;
    const coverWidth = profile.aspect >= viewportAspect ? viewportHeight * profile.aspect : viewportWidth;
    const coverHeight = profile.aspect >= viewportAspect ? viewportHeight : viewportWidth / profile.aspect;
    const renderedWidth = coverWidth * config.scale;
    const renderedHeight = coverHeight * config.scale;
    const offsetX = -(renderedWidth - viewportWidth) * focusX;
    const offsetY = -(renderedHeight - viewportHeight) * focusY;
    root.style.setProperty("--dream-art", `url("${artUrl}")`);
    root.style.setProperty("--dream-art-position", `${Math.round(focusX * 100)}% ${Math.round(focusY * 100)}%`);
    root.style.setProperty("--dream-focus-x", String(focusX));
    root.style.setProperty("--dream-focus-y", String(focusY));
    root.style.setProperty("--dream-accent", accent);
    root.style.setProperty("--dream-accent-ink", accentInk);
    root.style.setProperty("--dream-image-luma", profile.luma.toFixed(3));
    root.style.setProperty("--dream-home-opacity", String(config.effects.homeOpacity));
    root.style.setProperty("--dream-ambient-opacity", String(config.effects.taskOpacity));
    root.style.setProperty("--dream-art-blur", `${config.effects.blur}px`);
    root.style.setProperty("--dream-art-saturation", String(config.effects.saturation));
    root.style.setProperty("--dream-art-brightness", String(config.effects.brightness));
    root.style.setProperty("--dream-mask-strength", String(config.effects.maskStrength));
    root.style.setProperty("--dream-interface-opacity", String(config.effects.interfaceOpacity));
    root.style.setProperty("--dream-left-sidebar-opacity", String(config.effects.leftSidebarOpacity));
    root.style.setProperty("--dream-top-bar-opacity", String(config.effects.topBarOpacity));
    root.style.setProperty("--dream-right-sidebar-opacity", String(config.effects.rightSidebarOpacity));
    root.style.setProperty("--dream-bottom-bar-opacity", String(config.effects.bottomBarOpacity));
    root.style.setProperty("--dream-input-opacity", String(config.effects.inputOpacity));
    root.classList.toggle("dream-input-custom", Math.abs(config.effects.inputOpacity - .9) > .0001);
    root.style.setProperty("--dream-tone-mode", config.effects.toneMode);
    root.style.setProperty("--dream-tone-strength", String(config.effects.toneStrength));
    root.style.setProperty("--dream-duotone-shadow", config.effects.duotoneShadow);
    root.style.setProperty("--dream-duotone-highlight", config.effects.duotoneHighlight);
    root.style.setProperty("--dream-wash-color", config.effects.washColor);
    root.style.setProperty("--dream-art-scale", String(config.scale));
    root.style.setProperty("--dream-art-rendered-width", pixel(renderedWidth));
    root.style.setProperty("--dream-art-rendered-height", pixel(renderedHeight));
    root.style.setProperty("--dream-art-offset-x", pixel(offsetX));
    root.style.setProperty("--dream-art-offset-y", pixel(offsetY));
  };

  const queryAll = (selector, scope = document) => {
    try {
      return [...(scope?.querySelectorAll?.(selector) ?? [])];
    } catch {
      return [];
    }
  };

  const isVisibleSurface = (node) => {
    if (!node || node.isConnected === false || typeof node.getBoundingClientRect !== "function") return false;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const viewportWidth = Math.max(1, Number(globalThis.innerWidth || document.documentElement?.clientWidth || 1));
    const viewportHeight = Math.max(1, Number(globalThis.innerHeight || document.documentElement?.clientHeight || 1));
    const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
    const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
    if (visibleWidth < Math.min(32, rect.width * .2) || visibleHeight < Math.min(40, rect.height * .25)) return false;
    try {
      const style = getComputedStyle(node);
      return style.display !== "none" && style.visibility !== "hidden";
    } catch {
      return true;
    }
  };

  const applySemanticSurfaces = (shellMain) => {
    const next = new Map();
    const counts = Object.fromEntries(Object.keys(surfaceState).map((name) => [name, 0]));
    const mark = (name, node) => {
      if (!isVisibleSurface(node)) return;
      const className = SURFACE_CLASS_BY_NAME[name];
      const classes = next.get(node) ?? new Set();
      if (!classes.has(className)) {
        classes.add(className);
        counts[name] += 1;
      }
      next.set(node, classes);
    };
    const markAll = (name, selectors, scope = document) => {
      const seen = new Set();
      for (const selector of selectors) {
        for (const node of queryAll(selector, scope)) {
          if (seen.has(node)) continue;
          seen.add(node);
          mark(name, node);
        }
      }
    };
    const markControlInput = (node) => {
      if (!isVisibleSurface(node)) return;
      const classes = next.get(node) ?? new Set();
      classes.add("dream-control-input");
      next.set(node, classes);
    };

    mark("main", shellMain);
    markAll("top", [
      '[class~="group/application-menu-top-bar"]',
      "header.app-header-tint",
    ]);
    markAll("left", ["aside.app-shell-left-panel"]);

    const viewportWidth = Math.max(1, Number(globalThis.innerWidth || document.documentElement?.clientWidth || 1));
    const viewportHeight = Math.max(1, Number(globalThis.innerHeight || document.documentElement?.clientHeight || 1));
    const rightPanel = queryAll('[data-app-shell-focus-area="right-panel"]').find(isVisibleSurface);
    if (rightPanel) {
      mark("right", rightPanel);
    } else {
      const rightFallback = queryAll(
        'aside[class~="z-[41]"][class~="ml-auto"][class~="shrink-0"][class~="overflow-visible"]',
      ).find((node) => {
        if (!isVisibleSurface(node) || queryAll('[data-tab-id="diff"]', node).length === 0) return false;
        const rect = node.getBoundingClientRect();
        return rect.right >= viewportWidth - Math.max(8, viewportWidth * .025) &&
          rect.width >= Math.min(160, viewportWidth * .16) && rect.width <= viewportWidth * .55 &&
          rect.height >= viewportHeight * .32;
      });
      if (rightFallback) mark("right", rightFallback);
    }

    const bottomPanel = queryAll('[data-app-shell-focus-area="bottom-panel"]').find((node) =>
      isVisibleSurface(node) &&
      queryAll('[data-app-shell-tab-panel-controller="bottom"]', node).length > 0
    );
    if (bottomPanel) {
      mark("bottom", bottomPanel);
    } else {
      const shellRect = shellMain.getBoundingClientRect();
      const bottomFallback = queryAll('[data-codex-terminal][data-codex-xterm]')
        .map((node) => node.closest?.('[class~="shrink-0"][class~="overflow-visible"]'))
        .find((node) => {
          if (!isVisibleSurface(node)) return false;
          const rect = node.getBoundingClientRect();
          const tolerance = Math.max(8, viewportHeight * .025);
          return rect.left >= shellRect.left - tolerance && rect.right <= shellRect.right + tolerance &&
            rect.bottom >= shellRect.bottom - tolerance && rect.width >= shellRect.width * .4 &&
            rect.height >= 80 && rect.height <= shellRect.height * .65;
        });
      if (bottomFallback) mark("bottom", bottomFallback);
    }

    const composer = document.querySelector(".composer-surface-chrome");
    if (composer) mark("input", composer);
    markAll("card", [
      ".group\\/home-suggestions button",
      '[role="main"] [data-testid*="card" i]',
      '[role="main"] [role="listitem"] > button',
    ]);
    for (const selector of [
      ".ProseMirror",
      'textarea',
      'input:not([type="range"]):not([type="checkbox"]):not([type="radio"])',
      '[contenteditable="true"]',
    ]) {
      for (const node of queryAll(selector)) markControlInput(node);
    }

    for (const [node, classes] of matchedSurfaceElements) {
      const nextClasses = next.get(node) ?? new Set();
      for (const className of classes) {
        if (!nextClasses.has(className)) node.classList.remove(className);
      }
    }
    for (const [node, classes] of next) {
      for (const className of classes) {
        if (!node.classList.contains(className)) node.classList.add(className);
      }
    }
    matchedSurfaceElements.clear();
    for (const [node, classes] of next) matchedSurfaceElements.set(node, classes);
    for (const name of Object.keys(surfaceState)) {
      surfaceState[name] = { available: counts[name] > 0, count: counts[name] };
    }

    const root = document.documentElement;
    root.classList.toggle("dream-layout-left-open", surfaceState.left.available);
    root.classList.toggle("dream-layout-right-open", surfaceState.right.available);
    root.classList.toggle("dream-layout-bottom-open", surfaceState.bottom.available);
  };

  const ensure = () => {
    if (window.__CODEX_DREAM_SKIN_DISABLED__) return;
    const root = document.documentElement;
    if (!root || !document.body) return;

    const shellMain = document.querySelector("main.main-surface");
    if (!shellMain) {
      if (!root.classList.contains("codex-dream-skin")) clearSkinDom();
      return;
    }

    root.classList.add("codex-dream-skin");
    applyProfile(root);

    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || root).appendChild(style);
    }
    if (style.dataset.dreamVersion !== "6") {
      style.textContent = cssText;
      style.dataset.dreamVersion = "6";
    }

    const home = document.querySelector('[role="main"]:has([data-testid="home-icon"])');
    for (const candidate of document.querySelectorAll('[role="main"]')) {
      candidate.classList.toggle("dream-home", candidate === home);
      candidate.classList.toggle("dream-task", candidate !== home);
    }
    shellMain.classList.toggle("dream-home-shell", Boolean(home));
    root.classList.toggle("dream-route-home", Boolean(home));
    root.classList.toggle("dream-route-task", !home);
    applySemanticSurfaces(shellMain);

    let chrome = document.getElementById(CHROME_ID);
    if (!chrome || chrome.parentElement !== document.body) {
      chrome?.remove();
      chrome = document.createElement("div");
      chrome.id = CHROME_ID;
      chrome.setAttribute("aria-hidden", "true");
      document.body.appendChild(chrome);
    }
    chrome.classList.toggle("dream-home-shell", Boolean(home));
  };

  const cleanup = () => {
    const state = window[STATE_KEY];
    if (state?.installToken !== installToken) return false;
    window.__CODEX_DREAM_SKIN_DISABLED__ = true;
    clearSkinDom();
    state?.observer?.disconnect();
    if (state?.timer) clearInterval(state.timer);
    if (state?.scheduler?.timeout) clearTimeout(state.scheduler.timeout);
    if (state?.onViewportChange) {
      window.removeEventListener?.("resize", state.onViewportChange);
      window.visualViewport?.removeEventListener?.("resize", state.onViewportChange);
      window.visualViewport?.removeEventListener?.("scroll", state.onViewportChange);
    }
    if (state?.artUrl) URL.revokeObjectURL(state.artUrl);
    delete window[STATE_KEY];
    return true;
  };

  const scheduler = { timeout: null };
  const scheduleEnsure = () => {
    if (scheduler.timeout) clearTimeout(scheduler.timeout);
    scheduler.timeout = setTimeout(() => {
      scheduler.timeout = null;
      ensure();
    }, 180);
  };
  observer = new MutationObserver(() => {
    if (samplingNativeShell) return;
    scheduleEnsure();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "class",
      "style",
      "hidden",
      "aria-hidden",
      "aria-expanded",
      "data-state",
      "data-theme",
      "data-appearance",
      "data-color-mode",
    ],
  });
  const onViewportChange = scheduleEnsure;
  window.addEventListener?.("resize", onViewportChange, { passive: true });
  window.visualViewport?.addEventListener?.("resize", onViewportChange, { passive: true });
  window.visualViewport?.addEventListener?.("scroll", onViewportChange, { passive: true });
  const timer = setInterval(ensure, 1000);
  window[STATE_KEY] = {
    ensure,
    cleanup,
    observer,
    timer,
    scheduler,
    onViewportChange,
    artUrl,
    profile,
    config,
    surfaces: surfaceState,
    installToken,
    version: "1.7.0",
  };
  ensure();
  analyzeArt().then((result) => {
    const state = window[STATE_KEY];
    if (state?.installToken !== installToken || window.__CODEX_DREAM_SKIN_DISABLED__) return;
    profile = result;
    state.profile = result;
    ensure();
  });
  return { installed: true, version: "1.7.0", adaptive: true, semanticSurfaces: true };
})(__DREAM_CSS_JSON__, __DREAM_ART_JSON__, __DREAM_THEME_JSON__)
