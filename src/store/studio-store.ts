import { create, type StateCreator } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { AppSettings } from "../domain/settings";
import type { ArtSettings, EffectSettings, ThemeDocument } from "../domain/theme";
import {
  commandClient,
  StudioCommandError,
  toStudioCommandError,
  type CommandClient,
  type EnvironmentStatus,
  type ImageMetadata,
  type RuntimeStatus,
  type StudioErrorPayload,
  type ThemeDetail,
  type ThemeSummary,
} from "../lib/commands";

export type BusyAction =
  | "initialize"
  | "refresh-environment"
  | "select-theme"
  | "apply-theme"
  | "create-theme"
  | "duplicate-theme"
  | "rename-theme"
  | "delete-theme"
  | "choose-image"
  | "start-skin"
  | "pause-skin"
  | "resume-skin"
  | "stop-skin"
  | "restore-appearance"
  | "open-logs"
  | "save-settings";

export type SelectionResult = "selected" | "decision-required" | "cancelled" | "failed";
export type DirtyResolution = "apply" | "discard" | "cancel";
export type ThemePatch = Partial<Omit<ThemeDocument, "art" | "effects" | "extra">> & {
  art?: Partial<ArtSettings>;
  effects?: Partial<EffectSettings>;
  extra?: Record<string, unknown>;
};

export interface StudioState {
  themes: ThemeSummary[];
  selected: ThemeDetail | null;
  applied: ThemeDocument | null;
  draft: ThemeDocument | null;
  stagedImage: ImageMetadata | null;
  runtime: RuntimeStatus | null;
  environment: EnvironmentStatus | null;
  settings: AppSettings | null;
  dirty: boolean;
  activationPending: boolean;
  pendingSelectionId: string | null;
  busyAction: BusyAction | null;
  error: StudioErrorPayload | null;
  initialize(): Promise<boolean>;
  refreshEnvironment(): Promise<boolean>;
  refreshThemes(): Promise<boolean>;
  selectTheme(id: string): Promise<SelectionResult>;
  resolvePendingSelection(resolution: DirtyResolution): Promise<SelectionResult>;
  updateDraft(patch: ThemePatch): void;
  discardDraft(): void;
  applyDraft(sourceImage?: string): Promise<boolean>;
  createTheme(name: string, sourceImage: string): Promise<ThemeDetail | null>;
  duplicateTheme(id: string, name: string): Promise<ThemeDetail | null>;
  renameTheme(id: string, name: string): Promise<ThemeDetail | null>;
  deleteTheme(id: string): Promise<boolean>;
  chooseImage(path: string): Promise<ImageMetadata | null>;
  stageDraftImage(path: string): Promise<ImageMetadata | null>;
  refreshRuntime(): Promise<boolean>;
  startSkin(confirmRestart?: boolean): Promise<boolean>;
  pauseSkin(): Promise<boolean>;
  resumeSkin(): Promise<boolean>;
  stopSkin(): Promise<boolean>;
  restoreOfficialAppearance(confirmed: boolean): Promise<boolean>;
  openLogDirectory(): Promise<boolean>;
  saveSettings(settings: AppSettings): Promise<boolean>;
  reportExternalError(error: StudioErrorPayload): void;
  clearError(): void;
}

type StudioStore = StoreApi<StudioState>;
type RuntimeTarget = (runtime: RuntimeStatus) => boolean;
type RuntimeTargetFactory = () => RuntimeTarget;
interface RuntimeMutation {
  action: BusyAction;
  token: symbol;
  promise: Promise<boolean>;
}

export function createStudioStore(client: CommandClient): StudioStore {
  return createStore<StudioState>(createStudioState(client));
}

function createStudioState(client: CommandClient): StateCreator<StudioState> {
  return (set, get) => {
    let initialization: Promise<boolean> | null = null;
    let environmentRefresh: Promise<boolean> | null = null;
    let runtimeRefresh: Promise<boolean> | null = null;
    let runtimeMutation: RuntimeMutation | null = null;
    const fail = (error: unknown): false => {
      set({ error: errorPayload(error), busyAction: null });
      return false;
    };

    const loadTheme = async (id: string): Promise<boolean> => {
      set({ busyAction: "select-theme", error: null });
      try {
        const selected = await client.readTheme(id);
        const applied = cloneTheme(selected.theme);
        const loadedSelection = { ...selected, theme: cloneTheme(selected.theme) };
        set((state) => ({
          selected: loadedSelection,
          applied,
          draft: cloneTheme(applied),
          stagedImage: null,
          dirty: false,
          activationPending: themeNeedsActivation(loadedSelection, state.runtime),
          pendingSelectionId: null,
          busyAction: null,
        }));
        return true;
      } catch (error) {
        return fail(error);
      }
    };

    const refreshThemes = async (): Promise<boolean> => {
      try {
        const themes = await client.listThemes();
        set({ themes, error: null });
        return true;
      } catch (error) {
        return fail(error);
      }
    };

    const publishRuntime = (runtime: RuntimeStatus, token: symbol): void => {
      set((state) => {
        const isLatestMutation = runtimeMutation?.token === token;
        return {
          runtime,
          activationPending: themeNeedsActivation(state.selected, runtime),
          ...(isLatestMutation ? { busyAction: null, error: null } : {}),
        };
      });
    };

    const runRuntimeAction = (
      action: BusyAction,
      operation: () => Promise<RuntimeStatus>,
      createTarget: RuntimeTargetFactory,
      reconcileProcessTimeout = false,
    ): Promise<boolean> => {
      if (runtimeMutation?.action === action) return runtimeMutation.promise;

      const previous = runtimeMutation?.promise;
      const token = Symbol(action);
      set({ busyAction: action, error: null });

      const execute = async (): Promise<boolean> => {
        const targetReached = createTarget();
        try {
          let runtime: RuntimeStatus;
          try {
            runtime = await operation();
          } catch (error) {
            const original = errorPayload(error);
            if (original.code === "PROCESS_TIMEOUT" && reconcileProcessTimeout) {
              try {
                const reconciled = await client.getRuntimeStatus();
                if (targetReached(reconciled)) {
                  publishRuntime(reconciled, token);
                  return true;
                }
              } catch {
                // Keep the timeout as the user-facing cause.
              }
            }
            if (runtimeMutation?.token === token) {
              set({ error: original, busyAction: null });
            }
            return false;
          }
          if (!targetReached(runtime)) {
            const targetError = errorPayload(new StudioCommandError(
              "RUNTIME_TARGET_NOT_REACHED",
              "Runtime command completed without reaching its requested state",
            ));
            if (runtimeMutation?.token === token) {
              set({ error: targetError, busyAction: null });
            }
            return false;
          }
          publishRuntime(runtime, token);
          return true;
        } finally {
          if (runtimeMutation?.token === token) runtimeMutation = null;
        }
      };

      const promise = previous
        ? previous.then(execute, execute)
        : Promise.resolve().then(execute);
      runtimeMutation = { action, token, promise };
      return promise;
    };

    const upsertSummary = (detail: ThemeDetail): void => {
      set((state) => {
        const summary: ThemeSummary = {
          id: detail.theme.id,
          name: detail.theme.name,
          imagePath: detail.imagePath,
          isBuiltIn: detail.isBuiltIn,
          isDamaged: false,
        };
        const exists = state.themes.some((theme) => theme.id === summary.id);
        return { themes: exists ? state.themes.map((theme) => (theme.id === summary.id ? summary : theme)) : [...state.themes, summary] };
      });
    };

    return {
      themes: [],
      selected: null,
      applied: null,
      draft: null,
      stagedImage: null,
      runtime: null,
      environment: null,
      settings: null,
      dirty: false,
      activationPending: false,
      pendingSelectionId: null,
      busyAction: null,
      error: null,

      initialize: async () => {
        if (initialization) return initialization;
        initialization = (async () => {
          set({ busyAction: "initialize", error: null });
          try {
            const [environment, initialRuntime, settings, themes] = await Promise.all([
              client.getEnvironmentStatus(),
              client.reconcileRuntime(),
              client.getAppSettings(),
              client.listThemes(),
            ]);
            let runtime = initialRuntime;
            let autoStartError: StudioErrorPayload | null = null;
            set({ environment, runtime, settings, themes });
            if (settings.autoStartSkin && environment.skinRuntimeReady && runtime.codexRunning && !runtime.skinActive && !runtime.starting && !runtime.requiresRestartConfirmation) {
              try {
                runtime = await client.startSkin(false);
                set({ runtime });
              } catch (error) {
                autoStartError = errorPayload(error);
              }
            }
            const initialTheme = themes.find((theme) => !theme.isDamaged && theme.id === runtime.activeThemeId)
              ?? themes.find((theme) => !theme.isDamaged && theme.name === runtime.activeThemeName)
              ?? themes.find((theme) => !theme.isDamaged);
            if (!initialTheme) {
              set({ busyAction: null, error: autoStartError });
              return true;
            }
            const loaded = await loadTheme(initialTheme.id);
            if (loaded && autoStartError) set({ error: autoStartError });
            return loaded;
          } catch (error) {
            return fail(error);
          }
        })();
        return initialization;
      },

      refreshEnvironment: () => {
        if (environmentRefresh) return environmentRefresh;
        set({ busyAction: "refresh-environment", error: null });
        environmentRefresh = (async () => {
          try {
            const environment = await Promise.resolve().then(() => client.getEnvironmentStatus());
            set({ environment, busyAction: null });
            return true;
          } catch (error) {
            return fail(error);
          } finally {
            environmentRefresh = null;
          }
        })();
        return environmentRefresh;
      },

      refreshThemes,

      selectTheme: async (id) => {
        const state = get();
        if (state.selected?.theme.id === id) return "selected";
        if (state.dirty) {
          set({ pendingSelectionId: id });
          return "decision-required";
        }
        return (await loadTheme(id)) ? "selected" : "failed";
      },

      resolvePendingSelection: async (resolution) => {
        const id = get().pendingSelectionId;
        if (!id) return "cancelled";
        if (resolution === "cancel") {
          set({ pendingSelectionId: null });
          return "cancelled";
        }
        if (resolution === "apply" && !(await get().applyDraft())) return "failed";
        if (resolution === "discard") get().discardDraft();
        return (await loadTheme(id)) ? "selected" : "failed";
      },

      updateDraft: (patch) => {
        const current = get().draft;
        if (!current) return;
        const draft: ThemeDocument = {
          ...current,
          ...patch,
          art: { ...current.art, ...patch.art },
          effects: { ...current.effects, ...(patch.effects ?? {}) },
          extra: patch.extra ? { ...current.extra, ...patch.extra } : current.extra,
        };
        set({ draft, dirty: draftHasEdits(draft, get().applied, get().stagedImage) });
      },

      discardDraft: () => {
        const applied = get().applied;
        set({ draft: applied ? cloneTheme(applied) : null, stagedImage: null, dirty: false, error: null });
      },

      applyDraft: async (sourceImage) => {
        const draft = get().draft;
        if (!draft) return false;
        set({ busyAction: "apply-theme", error: null });
        try {
          const pendingSource = sourceImage ?? get().stagedImage?.path;
          const appliedResult = await client.applyTheme(cloneTheme(draft), pendingSource);
          const readBack = await client.readTheme(appliedResult.theme.id);
          if (!themesEqual(readBack.theme, appliedResult.theme)) {
            throw new StudioCommandError("READ_BACK_MISMATCH", "Saved theme did not match the applied theme");
          }
          const applied = cloneTheme(readBack.theme);
          set((state) => ({
            selected: { ...readBack, theme: cloneTheme(readBack.theme) },
            applied,
            draft: cloneTheme(applied),
            stagedImage: null,
            dirty: false,
            activationPending: false,
            runtime: state.runtime ? {
              ...state.runtime,
              activeThemeId: applied.id,
              activeThemeName: applied.name,
            } : state.runtime,
            busyAction: null,
          }));
          upsertSummary(readBack);
          return true;
        } catch (error) {
          return fail(error);
        }
      },

      createTheme: async (name, sourceImage) => runThemeMutation("create-theme", () => client.createTheme(name, sourceImage), set, upsertSummary, loadTheme, fail),
      duplicateTheme: async (id, name) => runThemeMutation("duplicate-theme", () => client.duplicateTheme(id, name), set, upsertSummary, loadTheme, fail),
      renameTheme: async (id, name) => {
        set({ busyAction: "rename-theme", error: null });
        try {
          const detail = await client.renameTheme(id, name);
          upsertSummary(detail);
          set((state) => {
            if (state.selected?.theme.id !== id) return { busyAction: null };
            const applied = cloneTheme(detail.theme);
            const draft = state.dirty && state.draft
              ? { ...state.draft, name: detail.theme.name }
              : cloneTheme(applied);
            return {
              selected: { ...detail, theme: cloneTheme(detail.theme) },
              applied,
              draft,
              dirty: draftHasEdits(draft, applied, state.stagedImage),
              activationPending: themeNeedsActivation(
                { ...detail, theme: cloneTheme(detail.theme) },
                state.runtime,
              ),
              busyAction: null,
            };
          });
          return detail;
        } catch (error) {
          fail(error);
          return null;
        }
      },

      deleteTheme: async (id) => {
        const previous = get();
        set({ busyAction: "delete-theme", error: null });
        try {
          await client.deleteTheme(id);
          let themes: ThemeSummary[];
          try {
            themes = await client.listThemes();
          } catch {
            themes = previous.themes.filter((theme) => theme.id !== id);
          }

          const selectedStillAvailable = previous.selected !== null
            && previous.selected.theme.id !== id
            && themes.some((theme) => theme.id === previous.selected!.theme.id && !theme.isDamaged);
          if (selectedStillAvailable) {
            set({ themes, busyAction: null, error: null });
            return true;
          }

          set({ themes, busyAction: null, error: null });
          const nextTheme = themes.find((theme) => !theme.isDamaged);
          if (!nextTheme) {
            set({
              selected: null,
              applied: null,
              draft: null,
              stagedImage: null,
              dirty: false,
              activationPending: false,
              pendingSelectionId: null,
            });
            return true;
          }

          if (!(await loadTheme(nextTheme.id))) {
            set({
              selected: null,
              applied: null,
              draft: null,
              stagedImage: null,
              dirty: false,
              activationPending: false,
              pendingSelectionId: null,
              busyAction: null,
            });
          }
          return true;
        } catch {
          set(previous, true);
          return false;
        }
      },

      chooseImage: async (path) => {
        set({ busyAction: "choose-image", error: null });
        try {
          const metadata = await client.chooseImage(path);
          set({ busyAction: null });
          return metadata;
        } catch (error) {
          fail(error);
          return null;
        }
      },

      stageDraftImage: async (path) => {
        if (!get().draft) return null;
        set({ busyAction: "choose-image", error: null });
        try {
          const metadata = await client.chooseImage(path);
          set({ stagedImage: metadata, dirty: true, busyAction: null });
          return metadata;
        } catch (error) {
          fail(error);
          return null;
        }
      },

      refreshRuntime: () => {
        if (runtimeRefresh) return runtimeRefresh;
        runtimeRefresh = (async () => {
          try {
            const runtime = await client.reconcileRuntime();
            set((state) => ({
              runtime,
              activationPending: themeNeedsActivation(state.selected, runtime),
              error: null,
            }));
            return true;
          } catch (error) {
            return fail(error);
          } finally {
            runtimeRefresh = null;
          }
        })();
        return runtimeRefresh;
      },
      startSkin: (confirmRestart = false) => runRuntimeAction(
        "start-skin",
        () => client.startSkin(confirmRestart),
        () => (runtime) => runtime.skinActive || runtime.starting,
        true,
      ),
      pauseSkin: () => runRuntimeAction(
        "pause-skin",
        () => client.pauseSkin(),
        () => (runtime) => runtime.skinActive && runtime.paused,
        true,
      ),
      resumeSkin: () => runRuntimeAction(
        "resume-skin",
        () => client.resumeSkin(),
        () => (runtime) => runtime.skinActive && !runtime.paused,
        true,
      ),
      stopSkin: () => runRuntimeAction(
        "stop-skin",
        () => client.stopSkin(),
        () => (runtime) => !runtime.skinActive && !runtime.starting,
      ),
      restoreOfficialAppearance: (confirmed) => runRuntimeAction(
        "restore-appearance",
        () => client.restoreOfficialAppearance(confirmed),
        () => {
          const codexWasRunning = get().runtime?.codexRunning ?? false;
          return (runtime) => !runtime.skinActive
            && !runtime.starting
            && (!codexWasRunning || runtime.codexRunning);
        },
      ),

      openLogDirectory: async () => {
        set({ busyAction: "open-logs", error: null });
        try {
          await client.openLogDirectory();
          set({ busyAction: null });
          return true;
        } catch (error) {
          return fail(error);
        }
      },

      saveSettings: async (settings) => {
        set({ busyAction: "save-settings", error: null });
        try {
          const saved = await client.updateAppSettings(settings);
          set({ settings: saved, busyAction: null });
          return true;
        } catch (error) {
          return fail(error);
        }
      },

      reportExternalError: (error) => set({ error, busyAction: null }),
      clearError: () => set((state) => ({
        error: null,
        runtime: state.runtime ? { ...state.runtime, lastError: null } : null,
        environment: state.environment ? { ...state.environment, errorCodes: [] } : null,
      })),
    };
  };
}

export const useStudioStore = create<StudioState>(createStudioState(commandClient));

async function runThemeMutation(
  action: BusyAction,
  operation: () => Promise<ThemeDetail>,
  set: StudioStore["setState"],
  upsertSummary: (detail: ThemeDetail) => void,
  select: ((id: string) => Promise<boolean>) | undefined,
  fail: (error: unknown) => false,
): Promise<ThemeDetail | null> {
  set({ busyAction: action, error: null });
  try {
    const detail = await operation();
    upsertSummary(detail);
    if (select) await select(detail.theme.id);
    else set({ busyAction: null });
    return detail;
  } catch (error) {
    fail(error);
    return null;
  }
}

function cloneTheme(theme: ThemeDocument): ThemeDocument {
  return JSON.parse(JSON.stringify(theme)) as ThemeDocument;
}

function themesEqual(left: ThemeDocument | null, right: ThemeDocument | null): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function draftHasEdits(
  draft: ThemeDocument | null,
  applied: ThemeDocument | null,
  stagedImage: ImageMetadata | null,
): boolean {
  return !themesEqual(draft, applied) || stagedImage !== null;
}

function themeNeedsActivation(
  selected: ThemeDetail | null,
  runtime: RuntimeStatus | null,
): boolean {
  return selected !== null && selected.theme.id !== runtime?.activeThemeId;
}

function errorPayload(error: unknown): StudioErrorPayload {
  const normalized = toStudioCommandError(error);
  return {
    code: normalized.code,
    message: normalized.message,
    ...(normalized.detail ? { detail: normalized.detail } : {}),
  };
}
