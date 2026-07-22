import { describe, expect, it, vi } from "vitest";

import type {
  CommandClient,
  EnvironmentStatus,
  RuntimeStatus,
  ThemeDetail,
  ThemeSummary,
} from "../lib/commands";
import type { AppSettings } from "../domain/settings";
import { DEFAULT_EFFECTS, type ThemeDocument } from "../domain/theme";
import { createStudioStore } from "./studio-store";

const runtime: RuntimeStatus = {
  codexRunning: true,
  skinActive: true,
  starting: false,
  paused: false,
  port: 9335,
  activeThemeId: "yingying",
  activeThemeName: "萦萦",
  requiresRestartConfirmation: false,
  lastError: null,
};

const environment: EnvironmentStatus = {
  windowsVersion: "11",
  nodePath: "C:\\Program Files\\nodejs\\node.exe",
  nodeVersion: "22.20.0",
  nodeSource: "external",
  codexPresent: true,
  codexVersion: "26.707.9981.0",
  engineInstalled: true,
  skinRuntimeReady: true,
  errorCodes: [],
};

const settings: AppSettings = {
  launchAtLogin: true,
  autoStartSkin: true,
  fontPreset: "industrial",
  window: null,
};

function theme(id: string, name: string, opacity = 0.18): ThemeDocument {
  return {
    schemaVersion: 4,
    id,
    name,
    image: "art.jpg",
    appearance: "auto",
    art: {
      focusX: 0.5,
      focusY: 0.46,
      scale: 1,
      safeArea: "auto",
      taskMode: "auto",
    },
    effects: {
      ...DEFAULT_EFFECTS,
      taskOpacity: opacity,
    },
    extra: {},
  };
}

function detail(document: ThemeDocument): ThemeDetail {
  return {
    theme: document,
    imagePath: `C:\\themes\\${document.id}\\art.jpg`,
    metadata: {
      path: `C:\\themes\\${document.id}\\art.jpg`,
      format: "jpeg",
      width: 3840,
      height: 2160,
      bytes: 7_000_000,
      sha256: document.id,
    },
    isBuiltIn: false,
  };
}

const yingying = detail(theme("yingying", "萦萦"));
const other = detail(theme("other", "Other", 0.3));
const summaries: ThemeSummary[] = [
  { id: "yingying", name: "萦萦", imagePath: yingying.imagePath, isBuiltIn: false, isDamaged: false },
  { id: "other", name: "Other", imagePath: other.imagePath, isBuiltIn: false, isDamaged: false },
];

function makeClient(overrides: Partial<CommandClient> = {}): CommandClient {
  const getRuntimeStatus = overrides.getRuntimeStatus ?? vi.fn().mockResolvedValue(runtime);
  const reconcileRuntime = overrides.reconcileRuntime ?? vi.fn(() => getRuntimeStatus());
  return {
    getEnvironmentStatus: vi.fn().mockResolvedValue(environment),
    getRuntimeStatus,
    reconcileRuntime,
    startSkin: vi.fn().mockResolvedValue(runtime),
    pauseSkin: vi.fn().mockResolvedValue({ ...runtime, paused: true }),
    resumeSkin: vi.fn().mockResolvedValue(runtime),
    stopSkin: vi.fn().mockResolvedValue({ ...runtime, skinActive: false }),
    restoreOfficialAppearance: vi.fn().mockResolvedValue({ ...runtime, skinActive: false }),
    openLogDirectory: vi.fn().mockResolvedValue(undefined),
    getAppSettings: vi.fn().mockResolvedValue(settings),
    updateAppSettings: vi.fn().mockImplementation(async (value) => value),
    listThemes: vi.fn().mockResolvedValue(summaries),
    readTheme: vi.fn().mockImplementation(async (id) => (id === "yingying" ? yingying : other)),
    applyTheme: vi.fn().mockImplementation(async (document) => detail(document)),
    createTheme: vi.fn().mockResolvedValue(other),
    duplicateTheme: vi.fn().mockResolvedValue(other),
    renameTheme: vi.fn().mockResolvedValue(other),
    deleteTheme: vi.fn().mockResolvedValue(undefined),
    chooseImage: vi.fn().mockResolvedValue(yingying.metadata),
    ...overrides,
  };
}

async function initializedStore(client = makeClient()) {
  const store = createStudioStore(client);
  await store.getState().initialize();
  return { client, store };
}

describe("studio store", () => {
  it("uses runtime reconciliation during initialization", async () => {
    const reconcileRuntime = vi.fn().mockResolvedValue(runtime);
    const getRuntimeStatus = vi.fn().mockResolvedValue(runtime);
    const store = createStudioStore(makeClient({ reconcileRuntime, getRuntimeStatus }));

    expect(await store.getState().initialize()).toBe(true);
    expect(reconcileRuntime).toHaveBeenCalledOnce();
    expect(getRuntimeStatus).not.toHaveBeenCalled();
  });

  it("uses one reconciliation request for concurrent runtime refreshes", async () => {
    let finish: ((value: RuntimeStatus) => void) | undefined;
    const pending = new Promise<RuntimeStatus>((resolve) => { finish = resolve; });
    const recovered = { ...runtime, activeThemeName: "Recovered" };
    const reconcileRuntime = vi.fn()
      .mockResolvedValueOnce(runtime)
      .mockReturnValueOnce(pending);
    const store = createStudioStore(makeClient({ reconcileRuntime }));
    await store.getState().initialize();

    const first = store.getState().refreshRuntime();
    const second = store.getState().refreshRuntime();

    expect(second).toBe(first);
    finish?.(recovered);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(reconcileRuntime).toHaveBeenCalledTimes(2);
    expect(store.getState().runtime).toEqual(recovered);
  });

  it("shares one in-flight environment detection and keeps it busy until completion", async () => {
    let finish: ((status: EnvironmentStatus) => void) | undefined;
    const pending = new Promise<EnvironmentStatus>((resolve) => { finish = resolve; });
    const detected = {
      ...environment,
      nodePath: "C:\\Users\\test\\AppData\\Local\\CodexDreamSkin\\engine\\runtime\\node.exe",
      nodeVersion: "24.18.0",
      nodeSource: "bundled" as const,
    };
    const getEnvironmentStatus = vi.fn()
      .mockResolvedValueOnce(environment)
      .mockReturnValueOnce(pending);
    const store = createStudioStore(makeClient({ getEnvironmentStatus }));
    await store.getState().initialize();

    const first = store.getState().refreshEnvironment();
    const second = store.getState().refreshEnvironment();

    expect(second).toBe(first);
    await Promise.resolve();
    expect(getEnvironmentStatus).toHaveBeenCalledTimes(2);
    expect(store.getState().busyAction).toBe("refresh-environment");

    finish?.(detected);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(store.getState().busyAction).toBeNull();
    expect(store.getState().environment).toEqual(detected);
  });

  it("re-detects the environment and clears a stale Node error", async () => {
    const detected = {
      ...environment,
      nodePath: "C:\\Users\\test\\AppData\\Local\\CodexDreamSkin\\engine\\runtime\\node.exe",
      nodeVersion: "24.18.0",
      nodeSource: "bundled" as const,
      skinRuntimeReady: true,
      errorCodes: [],
    };
    const getEnvironmentStatus = vi.fn()
      .mockResolvedValueOnce({
        ...environment,
        nodePath: null,
        nodeVersion: null,
        nodeSource: null,
        skinRuntimeReady: false,
        errorCodes: ["NODE_NOT_FOUND"],
      })
      .mockResolvedValueOnce(detected);
    const store = createStudioStore(makeClient({ getEnvironmentStatus }));
    await store.getState().initialize();
    store.setState({ error: { code: "NODE_NOT_FOUND", message: "stale" } });

    expect(await store.getState().refreshEnvironment()).toBe(true);
    expect(store.getState().environment).toEqual(detected);
    expect(store.getState().error).toBeNull();
  });

  it("reports a failed environment refresh and always releases busy state", async () => {
    const getEnvironmentStatus = vi.fn()
      .mockResolvedValueOnce(environment)
      .mockRejectedValueOnce({ code: "ENVIRONMENT_CHECK_FAILED", message: "probe failed" });
    const store = createStudioStore(makeClient({ getEnvironmentStatus }));
    await store.getState().initialize();

    expect(await store.getState().refreshEnvironment()).toBe(false);
    expect(store.getState().error).toEqual({ code: "ENVIRONMENT_CHECK_FAILED", message: "probe failed" });
    expect(store.getState().busyAction).toBeNull();
  });

  it("recovers when the environment client throws synchronously", async () => {
    const detected = {
      ...environment,
      nodePath: "C:\\Users\\test\\AppData\\Local\\CodexDreamSkin\\engine\\runtime\\node.exe",
      nodeVersion: "24.18.0",
      nodeSource: "bundled" as const,
    };
    const getEnvironmentStatus = vi.fn()
      .mockResolvedValueOnce(environment)
      .mockImplementationOnce(() => {
        throw { code: "ENVIRONMENT_CHECK_FAILED", message: "sync probe failure" };
      })
      .mockResolvedValueOnce(detected);
    const store = createStudioStore(makeClient({ getEnvironmentStatus }));
    await store.getState().initialize();

    const failed = store.getState().refreshEnvironment();
    expect(failed).toBeInstanceOf(Promise);
    await expect(failed).resolves.toBe(false);
    expect(store.getState().error).toEqual({ code: "ENVIRONMENT_CHECK_FAILED", message: "sync probe failure" });
    expect(store.getState().busyAction).toBeNull();

    await expect(store.getState().refreshEnvironment()).resolves.toBe(true);
    expect(getEnvironmentStatus).toHaveBeenCalledTimes(3);
    expect(store.getState().environment).toEqual(detected);
  });

  it("auto-starts once only when enabled and no restart confirmation is required", async () => {
    const startSkin = vi.fn().mockResolvedValue(runtime);
    const client = makeClient({
      getRuntimeStatus: vi.fn().mockResolvedValue({ ...runtime, skinActive: false, codexRunning: true }),
      startSkin,
    });
    const store = createStudioStore(client);

    await Promise.all([store.getState().initialize(), store.getState().initialize()]);

    expect(startSkin).toHaveBeenCalledTimes(1);
    expect(startSkin).toHaveBeenCalledWith(false);
  });

  it("does not auto-start Codex when Studio launches at sign-in before Codex", async () => {
    const startSkin = vi.fn();
    const inactive = { ...runtime, skinActive: false, codexRunning: false };
    const store = createStudioStore(makeClient({
      getRuntimeStatus: vi.fn().mockResolvedValue(inactive),
      startSkin,
    }));

    expect(await store.getState().initialize()).toBe(true);
    expect(startSkin).not.toHaveBeenCalled();
    expect(store.getState().runtime).toEqual(inactive);
    expect(store.getState().error).toBeNull();
  });

  it("does not dispatch another start while the watcher is waiting for the renderer", async () => {
    const startSkin = vi.fn();
    const starting = {
      ...runtime,
      skinActive: false,
      starting: true,
      requiresRestartConfirmation: false,
    };
    const store = createStudioStore(makeClient({
      getRuntimeStatus: vi.fn().mockResolvedValue(starting),
      startSkin,
    }));

    expect(await store.getState().initialize()).toBe(true);
    expect(startSkin).not.toHaveBeenCalled();
    expect(store.getState().runtime).toEqual(starting);
  });

  it("hot-upgrades a stale watcher during initialization without requesting a Codex restart", async () => {
    const stale = {
      ...runtime,
      codexRunning: true,
      skinActive: false,
      requiresRestartConfirmation: false,
      lastError: null,
    };
    const upgraded = {
      ...runtime,
      codexRunning: true,
      skinActive: true,
      port: 9335,
      requiresRestartConfirmation: false,
      lastError: null,
    };
    const startSkin = vi.fn().mockResolvedValue(upgraded);
    const store = createStudioStore(makeClient({
      getRuntimeStatus: vi.fn().mockResolvedValue(stale),
      getAppSettings: vi.fn().mockResolvedValue({ ...settings, autoStartSkin: true }),
      startSkin,
    }));

    expect(await store.getState().initialize()).toBe(true);
    expect(startSkin).toHaveBeenCalledOnce();
    expect(startSkin).toHaveBeenCalledWith(false);
    expect(store.getState().runtime).toEqual(upgraded);
    expect(store.getState().error).toBeNull();
  });

  it("leaves an upgradeable stale watcher untouched when automatic skin startup is disabled", async () => {
    const stale = {
      ...runtime,
      codexRunning: true,
      skinActive: false,
      requiresRestartConfirmation: false,
      lastError: null,
    };
    const startSkin = vi.fn();
    const store = createStudioStore(makeClient({
      getRuntimeStatus: vi.fn().mockResolvedValue(stale),
      getAppSettings: vi.fn().mockResolvedValue({ ...settings, autoStartSkin: false }),
      startSkin,
    }));

    expect(await store.getState().initialize()).toBe(true);
    expect(startSkin).not.toHaveBeenCalled();
    expect(store.getState().runtime).toEqual(stale);
    expect(store.getState().error).toBeNull();
  });

  it("does not auto-start when Codex requires restart confirmation", async () => {
    const startSkin = vi.fn();
    const client = makeClient({
      getRuntimeStatus: vi.fn().mockResolvedValue({ ...runtime, skinActive: false, requiresRestartConfirmation: true }),
      startSkin,
    });
    const store = createStudioStore(client);

    await store.getState().initialize();

    expect(startSkin).not.toHaveBeenCalled();
  });

  it("keeps the workbench available when automatic skin startup fails", async () => {
    const client = makeClient({
      getRuntimeStatus: vi.fn().mockResolvedValue({ ...runtime, skinActive: false, codexRunning: true }),
      startSkin: vi.fn().mockRejectedValue({ code: "ENGINE_COMMAND_FAILED", message: "start failed" }),
    });
    const store = createStudioStore(client);

    expect(await store.getState().initialize()).toBe(true);
    expect(store.getState().selected).toEqual(yingying);
    expect(store.getState().error).toEqual({ code: "ENGINE_COMMAND_FAILED", message: "start failed" });
    expect(store.getState().busyAction).toBeNull();
  });

  it("dismisses command, runtime, and environment errors together", async () => {
    const { store } = await initializedStore();
    store.setState({
      error: { code: "ENGINE_COMMAND_FAILED", message: "restore failed" },
      runtime: { ...runtime, lastError: "watcher verification failed" },
      environment: { ...environment, errorCodes: ["NODE_NOT_FOUND"] },
    });

    store.getState().clearError();

    expect(store.getState().error).toBeNull();
    expect(store.getState().runtime?.lastError).toBeNull();
    expect(store.getState().environment?.errorCodes).toEqual([]);
  });

  it("initializes environment, runtime, settings, themes, and the active theme", async () => {
    const { store } = await initializedStore();

    const state = store.getState();
    expect(state.environment).toEqual(environment);
    expect(state.runtime).toEqual(runtime);
    expect(state.settings).toEqual(settings);
    expect(state.themes).toEqual(summaries);
    expect(state.selected).toEqual(yingying);
    expect(state.applied).toEqual(yingying.theme);
    expect(state.draft).toEqual(yingying.theme);
    expect(state.dirty).toBe(false);
    expect(state.activationPending).toBe(false);
  });

  it("uses the active theme id instead of an ambiguous display name during initialization", async () => {
    const store = createStudioStore(makeClient({
      getRuntimeStatus: vi.fn().mockResolvedValue({
        ...runtime,
        activeThemeId: "other",
        activeThemeName: yingying.theme.name,
      }),
    }));

    expect(await store.getState().initialize()).toBe(true);
    expect(store.getState().selected?.theme.id).toBe("other");
    expect(store.getState().activationPending).toBe(false);
  });

  it("updates only the draft and marks the theme dirty", async () => {
    const { store } = await initializedStore();

    store.getState().updateDraft({ effects: { taskOpacity: 0.55 } });

    expect(store.getState().draft?.effects.taskOpacity).toBe(0.55);
    expect(store.getState().applied?.effects.taskOpacity).toBe(0.18);
    expect(store.getState().selected?.theme.effects.taskOpacity).toBe(0.18);
    expect(store.getState().dirty).toBe(true);
  });

  it("updates the unified interface opacity in draft patches", async () => {
    const { store } = await initializedStore();

    store.getState().updateDraft({ effects: { interfaceOpacity: 0.33 } });

    expect(store.getState().draft?.effects.interfaceOpacity).toBe(0.33);
  });

  it("requests a decision instead of selecting another theme while dirty", async () => {
    const { client, store } = await initializedStore();
    store.getState().updateDraft({ effects: { blur: 4 } });

    const result = await store.getState().selectTheme("other");

    expect(result).toBe("decision-required");
    expect(store.getState().pendingSelectionId).toBe("other");
    expect(store.getState().selected?.theme.id).toBe("yingying");
    expect(client.readTheme).toHaveBeenCalledTimes(1);
  });

  it("allows repeated preset selection while keeping the newly selected theme ready to apply", async () => {
    const { store } = await initializedStore();

    expect(await store.getState().selectTheme("other")).toBe("selected");
    expect(store.getState().selected?.theme.id).toBe("other");
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().activationPending).toBe(true);

    expect(await store.getState().selectTheme("yingying")).toBe("selected");
    expect(store.getState().selected?.theme.id).toBe("yingying");
    expect(store.getState().activationPending).toBe(false);

    expect(await store.getState().selectTheme("other")).toBe("selected");
    expect(store.getState().selected?.theme.id).toBe("other");
    expect(store.getState().activationPending).toBe(true);
  });

  it("discards a dirty draft before resolving the pending selection", async () => {
    const { store } = await initializedStore();
    store.getState().updateDraft({ effects: { blur: 4 } });
    await store.getState().selectTheme("other");

    const result = await store.getState().resolvePendingSelection("discard");

    expect(result).toBe("selected");
    expect(store.getState().selected).toEqual(other);
    expect(store.getState().draft).toEqual(other.theme);
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().activationPending).toBe(true);
    expect(store.getState().pendingSelectionId).toBeNull();
  });

  it("cancels a pending selection without changing the dirty draft", async () => {
    const { store } = await initializedStore();
    store.getState().updateDraft({ effects: { blur: 4 } });
    await store.getState().selectTheme("other");

    const result = await store.getState().resolvePendingSelection("cancel");

    expect(result).toBe("cancelled");
    expect(store.getState().selected?.theme.id).toBe("yingying");
    expect(store.getState().draft?.effects.blur).toBe(4);
    expect(store.getState().dirty).toBe(true);
    expect(store.getState().pendingSelectionId).toBeNull();
  });

  it("replaces applied state with the read-back result after a successful apply", async () => {
    const applied = detail(theme("yingying", "萦萦", 0.55));
    const client = makeClient({
      applyTheme: vi.fn().mockResolvedValue(applied),
      readTheme: vi.fn().mockResolvedValueOnce(yingying).mockResolvedValueOnce(applied),
    });
    const { store } = await initializedStore(client);
    store.getState().updateDraft({ effects: { taskOpacity: 0.55 } });

    const result = await store.getState().applyDraft();

    expect(result).toBe(true);
    expect(client.applyTheme).toHaveBeenCalledWith(expect.objectContaining({ effects: expect.objectContaining({ taskOpacity: 0.55 }) }), undefined);
    expect(client.readTheme).toHaveBeenLastCalledWith("yingying");
    expect(store.getState().applied).toEqual(applied.theme);
    expect(store.getState().draft).toEqual(applied.theme);
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().activationPending).toBe(false);
    expect(store.getState().runtime?.activeThemeId).toBe("yingying");
    expect(store.getState().runtime?.activeThemeName).toBe(applied.theme.name);
    expect(store.getState().error).toBeNull();
  });

  it("activates a selected preset even when it has no editor changes", async () => {
    const applyTheme = vi.fn().mockResolvedValue(other);
    const client = makeClient({ applyTheme });
    const { store } = await initializedStore(client);

    await store.getState().selectTheme("other");
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().activationPending).toBe(true);

    expect(await store.getState().applyDraft()).toBe(true);
    expect(applyTheme).toHaveBeenCalledWith(other.theme, undefined);
    expect(store.getState().activationPending).toBe(false);
    expect(store.getState().runtime?.activeThemeId).toBe("other");
    expect(store.getState().runtime?.activeThemeName).toBe("Other");
  });

  it("preserves the draft and dirty state when apply fails", async () => {
    const client = makeClient({ applyTheme: vi.fn().mockRejectedValue({ code: "APPLY_FAILED", message: "Could not apply", detail: "watcher offline" }) });
    const { store } = await initializedStore(client);
    store.getState().updateDraft({ effects: { taskOpacity: 0.55 } });
    const draftBeforeApply = store.getState().draft;

    const result = await store.getState().applyDraft();

    expect(result).toBe(false);
    expect(store.getState().draft).toBe(draftBeforeApply);
    expect(store.getState().applied).toEqual(yingying.theme);
    expect(store.getState().dirty).toBe(true);
    expect(store.getState().busyAction).toBeNull();
    expect(store.getState().error).toEqual({ code: "APPLY_FAILED", message: "Could not apply", detail: "watcher offline" });
  });

  it("stages only a backend-validated image and treats it as a dirty draft", async () => {
    const staged = { ...yingying.metadata, path: "C:\\images\\replacement.webp", format: "webp" };
    const client = makeClient({ chooseImage: vi.fn().mockResolvedValue(staged) });
    const { store } = await initializedStore(client);

    const result = await store.getState().stageDraftImage(staged.path);

    expect(result).toEqual(staged);
    expect(store.getState().stagedImage).toEqual(staged);
    expect(store.getState().dirty).toBe(true);
    expect(await store.getState().selectTheme("other")).toBe("decision-required");
  });

  it("keeps a staged image after failed Apply and sends it again on retry", async () => {
    const staged = { ...yingying.metadata, path: "C:\\images\\replacement.webp", format: "webp" };
    const applyTheme = vi.fn().mockRejectedValueOnce({ code: "APPLY_FAILED", message: "Could not apply" });
    const client = makeClient({ chooseImage: vi.fn().mockResolvedValue(staged), applyTheme });
    const { store } = await initializedStore(client);
    await store.getState().stageDraftImage(staged.path);

    expect(await store.getState().applyDraft()).toBe(false);
    expect(store.getState().stagedImage).toEqual(staged);
    expect(store.getState().dirty).toBe(true);
    expect(applyTheme).toHaveBeenCalledWith(expect.anything(), staged.path);
  });

  it("clears the staged image after successful Apply or Discard", async () => {
    const staged = { ...yingying.metadata, path: "C:\\images\\replacement.webp", format: "webp" };
    const applied = { ...yingying, imagePath: "C:\\themes\\yingying\\replacement.webp", metadata: staged };
    const client = makeClient({
      chooseImage: vi.fn().mockResolvedValue(staged),
      applyTheme: vi.fn().mockResolvedValue(applied),
      readTheme: vi.fn().mockResolvedValueOnce(yingying).mockResolvedValueOnce(applied),
    });
    const { store } = await initializedStore(client);
    await store.getState().stageDraftImage(staged.path);

    expect(await store.getState().applyDraft()).toBe(true);
    expect(store.getState().stagedImage).toBeNull();

    await store.getState().stageDraftImage(staged.path);
    store.getState().discardDraft();
    expect(store.getState().stagedImage).toBeNull();
    expect(store.getState().dirty).toBe(false);
  });

  it("discards edits by restoring a cloned applied document", async () => {
    const { store } = await initializedStore();
    store.getState().updateDraft({ art: { focusX: 0.9 } });

    store.getState().discardDraft();

    expect(store.getState().draft).toEqual(store.getState().applied);
    expect(store.getState().draft).not.toBe(store.getState().applied);
    expect(store.getState().dirty).toBe(false);
  });

  it("updates runtime state and clears busy state after runtime actions", async () => {
    const { store } = await initializedStore();

    await store.getState().pauseSkin();
    expect(store.getState().runtime?.paused).toBe(true);
    await store.getState().resumeSkin();
    expect(store.getState().runtime?.paused).toBe(false);
    await store.getState().stopSkin();
    expect(store.getState().runtime?.skinActive).toBe(false);
    expect(store.getState().busyAction).toBeNull();
  });

  it("treats a rejected start as success when reconciliation finds an active skin", async () => {
    const inactive = { ...runtime, skinActive: false, starting: false };
    const active = { ...runtime, skinActive: true, starting: false };
    const getRuntimeStatus = vi.fn()
      .mockResolvedValueOnce(inactive)
      .mockResolvedValueOnce(active);
    const startSkin = vi.fn().mockRejectedValue({ code: "PROCESS_TIMEOUT", message: "timed out" });
    const store = createStudioStore(makeClient({
      getRuntimeStatus,
      getAppSettings: vi.fn().mockResolvedValue({ ...settings, autoStartSkin: false }),
      startSkin,
    }));
    await store.getState().initialize();

    expect(await store.getState().startSkin(true)).toBe(true);
    expect(startSkin).toHaveBeenCalledWith(true);
    expect(getRuntimeStatus).toHaveBeenCalledTimes(2);
    expect(store.getState().runtime).toEqual(active);
    expect(store.getState().error).toBeNull();
    expect(store.getState().busyAction).toBeNull();
  });

  it("treats a synchronously failed start as success when reconciliation finds it starting", async () => {
    const inactive = { ...runtime, skinActive: false, starting: false };
    const starting = { ...runtime, skinActive: false, starting: true };
    const failure = { code: "PROCESS_TIMEOUT", message: "timed out" };
    const getRuntimeStatus = vi.fn()
      .mockResolvedValueOnce(inactive)
      .mockResolvedValueOnce(starting);
    const store = createStudioStore(makeClient({
      getRuntimeStatus,
      getAppSettings: vi.fn().mockResolvedValue({ ...settings, autoStartSkin: false }),
      startSkin: vi.fn(() => { throw failure; }),
    }));
    await store.getState().initialize();

    expect(await store.getState().startSkin()).toBe(true);
    expect(store.getState().runtime).toEqual(starting);
    expect(store.getState().error).toBeNull();
    expect(store.getState().busyAction).toBeNull();
  });

  it("keeps the original command error when start reconciliation misses the target", async () => {
    const inactive = { ...runtime, skinActive: false, starting: false };
    const failure = { code: "PROCESS_TIMEOUT", message: "timed out" };
    const getRuntimeStatus = vi.fn().mockResolvedValue(inactive);
    const store = createStudioStore(makeClient({
      getRuntimeStatus,
      getAppSettings: vi.fn().mockResolvedValue({ ...settings, autoStartSkin: false }),
      startSkin: vi.fn().mockRejectedValue(failure),
    }));
    await store.getState().initialize();

    expect(await store.getState().startSkin(true)).toBe(false);
    expect(getRuntimeStatus).toHaveBeenCalledTimes(2);
    expect(store.getState().runtime).toEqual(inactive);
    expect(store.getState().error).toEqual(failure);
    expect(store.getState().busyAction).toBeNull();
  });

  it("preserves a non-timeout command error without probing runtime status", async () => {
    const inactive = { ...runtime, skinActive: false, starting: false };
    const failure = {
      code: "ENGINE_COMMAND_FAILED",
      message: "start failed",
      detail: "Another install, start, restore, or verify operation is already running.",
    };
    const getRuntimeStatus = vi.fn().mockResolvedValue(inactive);
    const store = createStudioStore(makeClient({
      getRuntimeStatus,
      getAppSettings: vi.fn().mockResolvedValue({ ...settings, autoStartSkin: false }),
      startSkin: vi.fn().mockRejectedValue(failure),
    }));
    await store.getState().initialize();

    expect(await store.getState().startSkin()).toBe(false);
    expect(getRuntimeStatus).toHaveBeenCalledTimes(1);
    expect(store.getState().runtime).toEqual(inactive);
    expect(store.getState().error).toEqual(failure);
    expect(store.getState().busyAction).toBeNull();
  });

  it("reports a target error without reconciling a resolved wrong-target result", async () => {
    const inactive = { ...runtime, skinActive: false, starting: false };
    const starting = { ...runtime, skinActive: false, starting: true };
    const getRuntimeStatus = vi.fn()
      .mockResolvedValueOnce(inactive)
      .mockResolvedValueOnce(starting);
    const store = createStudioStore(makeClient({
      getRuntimeStatus,
      getAppSettings: vi.fn().mockResolvedValue({ ...settings, autoStartSkin: false }),
      startSkin: vi.fn().mockResolvedValue(inactive),
    }));
    await store.getState().initialize();

    expect(await store.getState().startSkin()).toBe(false);
    expect(getRuntimeStatus).toHaveBeenCalledTimes(1);
    expect(store.getState().runtime).toEqual(inactive);
    expect(store.getState().error).toEqual({
      code: "RUNTIME_TARGET_NOT_REACHED",
      message: "Runtime command completed without reaching its requested state",
    });
  });

  it("reports a target error when a resolved stop result misses its target", async () => {
    const active = { ...runtime, skinActive: true, starting: false };
    const getRuntimeStatus = vi.fn().mockResolvedValue(active);
    const store = createStudioStore(makeClient({
      getRuntimeStatus,
      stopSkin: vi.fn().mockResolvedValue(active),
    }));
    await store.getState().initialize();

    expect(await store.getState().stopSkin()).toBe(false);
    expect(getRuntimeStatus).toHaveBeenCalledTimes(1);
    expect(store.getState().error).toEqual({
      code: "RUNTIME_TARGET_NOT_REACHED",
      message: "Runtime command completed without reaching its requested state",
    });
    expect(store.getState().busyAction).toBeNull();
  });

  it("treats restore as successful when the command resolves to the official target", async () => {
    const official = { ...runtime, skinActive: false, starting: false };
    const getRuntimeStatus = vi.fn().mockResolvedValue(runtime);
    const restoreOfficialAppearance = vi.fn().mockResolvedValue(official);
    const store = createStudioStore(makeClient({ getRuntimeStatus, restoreOfficialAppearance }));
    await store.getState().initialize();

    expect(await store.getState().restoreOfficialAppearance(true)).toBe(true);
    expect(restoreOfficialAppearance).toHaveBeenCalledWith(true);
    expect(getRuntimeStatus).toHaveBeenCalledTimes(1);
    expect(store.getState().runtime).toEqual(official);
    expect(store.getState().error).toBeNull();
  });

  it("keeps a restore command error when a previously running Codex remains closed", async () => {
    const failure = { code: "PROCESS_TIMEOUT", message: "restore timed out" };
    const getRuntimeStatus = vi.fn().mockResolvedValue(runtime);
    const store = createStudioStore(makeClient({
      getRuntimeStatus,
      restoreOfficialAppearance: vi.fn().mockRejectedValue(failure),
    }));
    await store.getState().initialize();

    expect(await store.getState().restoreOfficialAppearance(true)).toBe(false);
    expect(getRuntimeStatus).toHaveBeenCalledTimes(1);
    expect(store.getState().runtime).toEqual(runtime);
    expect(store.getState().error).toEqual(failure);
  });

  it("does not reconcile restore or stop timeouts from an apparently official status", async () => {
    const closedActive = { ...runtime, codexRunning: false, skinActive: true, starting: false };
    const closedOfficial = { ...closedActive, skinActive: false };
    const restoreStatus = vi.fn()
      .mockResolvedValueOnce(closedActive)
      .mockResolvedValueOnce(closedOfficial);
    const restoreStore = createStudioStore(makeClient({
      getRuntimeStatus: restoreStatus,
      restoreOfficialAppearance: vi.fn().mockRejectedValue({ code: "PROCESS_TIMEOUT", message: "timed out" }),
    }));
    await restoreStore.getState().initialize();

    expect(await restoreStore.getState().restoreOfficialAppearance(true)).toBe(false);
    expect(restoreStatus).toHaveBeenCalledTimes(1);
    expect(restoreStore.getState().runtime).toEqual(closedActive);
    expect(restoreStore.getState().error).toEqual({ code: "PROCESS_TIMEOUT", message: "timed out" });

    const stopStatus = vi.fn()
      .mockResolvedValueOnce(runtime)
      .mockResolvedValueOnce(closedOfficial);
    const stopStore = createStudioStore(makeClient({
      getRuntimeStatus: stopStatus,
      stopSkin: vi.fn().mockRejectedValue({ code: "PROCESS_TIMEOUT", message: "timed out" }),
    }));
    await stopStore.getState().initialize();

    expect(await stopStore.getState().stopSkin()).toBe(false);
    expect(stopStatus).toHaveBeenCalledTimes(1);
    expect(stopStore.getState().runtime).toEqual(runtime);
    expect(stopStore.getState().error).toEqual({ code: "PROCESS_TIMEOUT", message: "timed out" });
  });

  it("does not reconcile resolved wrong-target pause and resume results", async () => {
    const inactivePaused = { ...runtime, skinActive: false, starting: false, paused: true };
    const pauseStatus = vi.fn()
      .mockResolvedValueOnce(runtime)
      .mockResolvedValueOnce(inactivePaused);
    const pauseStore = createStudioStore(makeClient({
      getRuntimeStatus: pauseStatus,
      pauseSkin: vi.fn().mockResolvedValue(inactivePaused),
    }));
    await pauseStore.getState().initialize();

    expect(await pauseStore.getState().pauseSkin()).toBe(false);
    expect(pauseStatus).toHaveBeenCalledTimes(1);

    const startingUnpaused = { ...runtime, skinActive: false, starting: true, paused: false };
    const resumeStatus = vi.fn()
      .mockResolvedValueOnce({ ...runtime, paused: true })
      .mockResolvedValueOnce(startingUnpaused);
    const resumeStore = createStudioStore(makeClient({
      getRuntimeStatus: resumeStatus,
      resumeSkin: vi.fn().mockResolvedValue(startingUnpaused),
    }));
    await resumeStore.getState().initialize();

    expect(await resumeStore.getState().resumeSkin()).toBe(false);
    expect(resumeStatus).toHaveBeenCalledTimes(1);
  });

  it("reconciles pause and resume process timeouts against their exact targets", async () => {
    const paused = { ...runtime, paused: true };
    const pauseStatus = vi.fn()
      .mockResolvedValueOnce(runtime)
      .mockResolvedValueOnce(paused);
    const pauseStore = createStudioStore(makeClient({
      getRuntimeStatus: pauseStatus,
      pauseSkin: vi.fn().mockRejectedValue({ code: "PROCESS_TIMEOUT", message: "pause timed out" }),
    }));
    await pauseStore.getState().initialize();

    expect(await pauseStore.getState().pauseSkin()).toBe(true);
    expect(pauseStatus).toHaveBeenCalledTimes(2);
    expect(pauseStore.getState().runtime).toEqual(paused);

    const resumeStatus = vi.fn()
      .mockResolvedValueOnce(paused)
      .mockResolvedValueOnce(runtime);
    const resumeStore = createStudioStore(makeClient({
      getRuntimeStatus: resumeStatus,
      resumeSkin: vi.fn().mockRejectedValue({ code: "PROCESS_TIMEOUT", message: "resume timed out" }),
    }));
    await resumeStore.getState().initialize();

    expect(await resumeStore.getState().resumeSkin()).toBe(true);
    expect(resumeStatus).toHaveBeenCalledTimes(2);
    expect(resumeStore.getState().runtime).toEqual(runtime);
  });

  it("shares one in-flight runtime mutation when the same action is requested twice", async () => {
    let finishStart: ((status: RuntimeStatus) => void) | undefined;
    const pendingStart = new Promise<RuntimeStatus>((resolve) => { finishStart = resolve; });
    const startSkin = vi.fn().mockReturnValue(pendingStart);
    const { store } = await initializedStore(makeClient({ startSkin }));

    const first = store.getState().startSkin(true);
    const second = store.getState().startSkin(true);

    expect(second).toBe(first);
    await Promise.resolve();
    expect(startSkin).toHaveBeenCalledTimes(1);
    expect(store.getState().busyAction).toBe("start-skin");

    finishStart?.(runtime);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(store.getState().runtime).toEqual(runtime);
    expect(store.getState().busyAction).toBeNull();
  });

  it("serializes different runtime actions and prevents an older result from replacing the newer request", async () => {
    const inactive = { ...runtime, skinActive: false, starting: false };
    const active = { ...runtime, skinActive: true, starting: false };
    const stopped = { ...runtime, skinActive: false, starting: false };
    let finishStart: ((status: RuntimeStatus) => void) | undefined;
    let finishStop: ((status: RuntimeStatus) => void) | undefined;
    const startSkin = vi.fn(() => new Promise<RuntimeStatus>((resolve) => { finishStart = resolve; }));
    const stopSkin = vi.fn(() => new Promise<RuntimeStatus>((resolve) => { finishStop = resolve; }));
    const store = createStudioStore(makeClient({
      getRuntimeStatus: vi.fn().mockResolvedValue(inactive),
      getAppSettings: vi.fn().mockResolvedValue({ ...settings, autoStartSkin: false }),
      startSkin,
      stopSkin,
    }));
    await store.getState().initialize();

    const startResult = store.getState().startSkin();
    const stopResult = store.getState().stopSkin();

    await Promise.resolve();
    expect(startSkin).toHaveBeenCalledTimes(1);
    expect(stopSkin).not.toHaveBeenCalled();
    expect(store.getState().busyAction).toBe("stop-skin");

    finishStart?.(active);
    await expect(startResult).resolves.toBe(true);
    expect(stopSkin).toHaveBeenCalledTimes(1);
    expect(store.getState().runtime).toEqual(active);
    expect(store.getState().busyAction).toBe("stop-skin");

    finishStop?.(stopped);
    await expect(stopResult).resolves.toBe(true);
    expect(store.getState().runtime).toEqual(stopped);
    expect(store.getState().busyAction).toBeNull();
  });

  it("captures the restore Codex state when a queued restore actually starts", async () => {
    const closed = { ...runtime, codexRunning: false, skinActive: false, starting: false };
    const active = { ...runtime, codexRunning: true, skinActive: true, starting: false };
    const closedOfficial = { ...closed, skinActive: false, starting: false };
    let finishStart: ((status: RuntimeStatus) => void) | undefined;
    const startSkin = vi.fn(() => new Promise<RuntimeStatus>((resolve) => { finishStart = resolve; }));
    const restoreOfficialAppearance = vi.fn().mockResolvedValue(closedOfficial);
    const getRuntimeStatus = vi.fn()
      .mockResolvedValueOnce(closed)
      .mockResolvedValueOnce(closedOfficial);
    const store = createStudioStore(makeClient({
      getRuntimeStatus,
      getAppSettings: vi.fn().mockResolvedValue({ ...settings, autoStartSkin: false }),
      startSkin,
      restoreOfficialAppearance,
    }));
    await store.getState().initialize();

    const startResult = store.getState().startSkin();
    const restoreResult = store.getState().restoreOfficialAppearance(true);
    await Promise.resolve();
    expect(restoreOfficialAppearance).not.toHaveBeenCalled();

    finishStart?.(active);
    await expect(startResult).resolves.toBe(true);
    expect(store.getState().runtime).toEqual(active);
    expect(restoreOfficialAppearance).toHaveBeenCalledWith(true);

    await expect(restoreResult).resolves.toBe(false);
    expect(getRuntimeStatus).toHaveBeenCalledTimes(1);
    expect(store.getState().runtime).toEqual(active);
    expect(store.getState().error).toEqual({
      code: "RUNTIME_TARGET_NOT_REACHED",
      message: "Runtime command completed without reaching its requested state",
    });
    expect(store.getState().busyAction).toBeNull();
  });

  it("persists settings and restores the previous settings on failure", async () => {
    const updated = { ...settings, autoStartSkin: false };
    const updateAppSettings = vi.fn().mockResolvedValueOnce(updated).mockRejectedValueOnce({ code: "SETTINGS_FAILED", message: "No access" });
    const { store } = await initializedStore(makeClient({ updateAppSettings }));

    expect(await store.getState().saveSettings(updated)).toBe(true);
    expect(store.getState().settings).toEqual(updated);
    expect(await store.getState().saveSettings({ ...updated, launchAtLogin: false })).toBe(false);
    expect(store.getState().settings).toEqual(updated);
    expect(store.getState().error).toEqual({ code: "SETTINGS_FAILED", message: "No access" });
  });

  it("keeps the selected, applied, and draft documents synchronized after rename", async () => {
    const renamed = detail({ ...theme("yingying", "新萦萦"), effects: { ...yingying.theme.effects } });
    const { store } = await initializedStore(makeClient({ renameTheme: vi.fn().mockResolvedValue(renamed) }));

    expect(await store.getState().renameTheme("yingying", "新萦萦")).toEqual(renamed);

    expect(store.getState().selected?.theme.name).toBe("新萦萦");
    expect(store.getState().applied?.name).toBe("新萦萦");
    expect(store.getState().draft?.name).toBe("新萦萦");
    expect(store.getState().dirty).toBe(false);
  });

  it("deletes before refreshing and selects the first usable theme in authoritative order", async () => {
    const deleteTheme = vi.fn().mockResolvedValue(undefined);
    const listThemes = vi.fn()
      .mockResolvedValueOnce(summaries)
      .mockResolvedValueOnce([
        { id: "damaged", name: "Damaged", imagePath: null, isBuiltIn: true, isDamaged: true },
        summaries[1],
      ]);
    const client = makeClient({ deleteTheme, listThemes });
    const { store } = await initializedStore(client);

    expect(await store.getState().deleteTheme("yingying")).toBe(true);

    const refreshCallOrder = listThemes.mock.invocationCallOrder;
    expect(deleteTheme.mock.invocationCallOrder[0]).toBeLessThan(
      refreshCallOrder[refreshCallOrder.length - 1]!,
    );
    expect(store.getState().themes).toEqual([
      { id: "damaged", name: "Damaged", imagePath: null, isBuiltIn: true, isDamaged: true },
      summaries[1],
    ]);
    expect(store.getState().selected?.theme.id).toBe("other");
    expect(store.getState().applied).toEqual(other.theme);
    expect(store.getState().draft).toEqual(other.theme);
    expect(store.getState().stagedImage).toBeNull();
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().activationPending).toBe(true);
  });

  it("deleting an unrelated theme preserves the current selection and unsaved editor state", async () => {
    const listThemes = vi.fn()
      .mockResolvedValueOnce(summaries)
      .mockResolvedValueOnce([summaries[0]]);
    const { store } = await initializedStore(makeClient({ listThemes }));
    store.getState().updateDraft({ effects: { blur: 4 } });

    expect(await store.getState().deleteTheme("other")).toBe(true);

    expect(store.getState().selected?.theme.id).toBe("yingying");
    expect(store.getState().draft?.effects.blur).toBe(4);
    expect(store.getState().dirty).toBe(true);
    expect(store.getState().activationPending).toBe(false);
  });

  it("falls back to the pre-delete order when the authoritative refresh fails", async () => {
    const listThemes = vi.fn()
      .mockResolvedValueOnce(summaries)
      .mockRejectedValueOnce({ code: "LIST_FAILED", message: "Could not refresh" });
    const { store } = await initializedStore(makeClient({ listThemes }));

    expect(await store.getState().deleteTheme("yingying")).toBe(true);

    expect(store.getState().themes).toEqual([summaries[1]]);
    expect(store.getState().selected?.theme.id).toBe("other");
    expect(store.getState().error).toBeNull();
  });

  it("clears all editing state after deleting the last usable theme", async () => {
    const listThemes = vi.fn()
      .mockResolvedValueOnce([summaries[0]])
      .mockResolvedValueOnce([]);
    const { store } = await initializedStore(makeClient({ listThemes }));
    store.getState().updateDraft({ effects: { blur: 4 } });
    await store.getState().stageDraftImage("C:\\images\\replacement.webp");

    expect(await store.getState().deleteTheme("yingying")).toBe(true);

    expect(store.getState().themes).toEqual([]);
    expect(store.getState().selected).toBeNull();
    expect(store.getState().applied).toBeNull();
    expect(store.getState().draft).toBeNull();
    expect(store.getState().stagedImage).toBeNull();
    expect(store.getState().dirty).toBe(false);
  });

  it("leaves the complete state unchanged when backend deletion fails", async () => {
    const client = makeClient({
      deleteTheme: vi.fn().mockRejectedValue({ code: "DELETE_FAILED", message: "Could not delete" }),
    });
    const { store } = await initializedStore(client);
    store.getState().updateDraft({ effects: { blur: 4 } });
    await store.getState().stageDraftImage("C:\\images\\replacement.webp");
    const before = store.getState();

    expect(await store.getState().deleteTheme("yingying")).toBe(false);

    expect(store.getState()).toEqual(before);
  });
});
