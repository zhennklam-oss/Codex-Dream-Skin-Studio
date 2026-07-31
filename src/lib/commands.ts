import { invoke } from "@tauri-apps/api/core";

import type { AppSettings } from "../domain/settings";
import type { ThemeDocument } from "../domain/theme";

export interface StudioErrorPayload {
  code: string;
  message: string;
  detail?: string;
}

export class StudioCommandError extends Error implements StudioErrorPayload {
  readonly code: string;
  readonly detail?: string;

  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = "StudioCommandError";
    this.code = code;
    this.detail = detail;
  }
}

export interface ImageMetadata {
  path: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
}

export interface ThemeSummary {
  id: string;
  name: string;
  imagePath: string | null;
  isBuiltIn: boolean;
  isDamaged: boolean;
}

export interface ThemeDetail {
  theme: ThemeDocument;
  imagePath: string;
  metadata: ImageMetadata;
  isBuiltIn: boolean;
}

export interface RuntimeStatus {
  codexRunning: boolean;
  skinActive: boolean;
  starting: boolean;
  paused: boolean;
  port: number | null;
  activeThemeId: string | null;
  activeThemeName: string | null;
  requiresRestartConfirmation: boolean;
  lastError: string | null;
}

export interface EnvironmentStatus {
  windowsVersion: string | null;
  nodePath: string | null;
  nodeVersion: string | null;
  nodeSource: "bundled" | "external" | null;
  codexPresent: boolean;
  codexVersion: string | null;
  engineInstalled: boolean;
  skinRuntimeReady: boolean;
  errorCodes: string[];
}

export interface CommandClient {
  getEnvironmentStatus(): Promise<EnvironmentStatus>;
  getRuntimeStatus(): Promise<RuntimeStatus>;
  reconcileRuntime(): Promise<RuntimeStatus>;
  startSkin(confirmRestart: boolean): Promise<RuntimeStatus>;
  pauseSkin(): Promise<RuntimeStatus>;
  resumeSkin(): Promise<RuntimeStatus>;
  stopSkin(): Promise<RuntimeStatus>;
  restoreOfficialAppearance(confirmed: boolean): Promise<RuntimeStatus>;
  openLogDirectory(): Promise<void>;
  getAppSettings(): Promise<AppSettings>;
  updateAppSettings(settings: AppSettings): Promise<AppSettings>;
  listThemes(): Promise<ThemeSummary[]>;
  readTheme(id: string): Promise<ThemeDetail>;
  applyTheme(theme: ThemeDocument, sourceImage?: string): Promise<ThemeDetail>;
  createTheme(name: string, sourceImage: string): Promise<ThemeDetail>;
  duplicateTheme(id: string, name: string): Promise<ThemeDetail>;
  renameTheme(id: string, name: string): Promise<ThemeDetail>;
  deleteTheme(id: string): Promise<void>;
  chooseImage(path: string): Promise<ImageMetadata>;
}

export type CommandInvoker = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export function toStudioCommandError(error: unknown): StudioCommandError {
  if (error instanceof StudioCommandError) return error;
  const payload = parseErrorPayload(error);
  if (payload) return new StudioCommandError(payload.code, payload.message, payload.detail);
  if (error instanceof Error) return new StudioCommandError("COMMAND_FAILED", error.message);
  return new StudioCommandError("COMMAND_FAILED", typeof error === "string" ? error : "Command failed");
}

export function createCommandClient(invoker: CommandInvoker = invoke): CommandClient {
  const call = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    try {
      return await invoker<T>(command, args);
    } catch (error) {
      throw toStudioCommandError(error);
    }
  };

  return {
    getEnvironmentStatus: () => call("get_environment_status"),
    getRuntimeStatus: () => call("get_runtime_status"),
    reconcileRuntime: () => call("reconcile_runtime"),
    startSkin: (confirmRestart) => call("start_skin", { confirmRestart }),
    pauseSkin: () => call("pause_skin"),
    resumeSkin: () => call("resume_skin"),
    stopSkin: () => call("stop_skin"),
    restoreOfficialAppearance: (confirmed) => call("restore_official_appearance", { confirmed }),
    openLogDirectory: () => call("open_log_directory"),
    getAppSettings: () => call("get_app_settings"),
    updateAppSettings: (settings) => call("update_app_settings", { settings }),
    listThemes: () => call("list_themes"),
    readTheme: (id) => call("read_theme", { request: { id } }),
    applyTheme: (theme, sourceImage) => call("apply_theme", { request: { theme, sourceImage: sourceImage ?? null } }),
    createTheme: (name, sourceImage) => call("create_theme", { request: { name, sourceImage } }),
    duplicateTheme: (id, name) => call("duplicate_theme", { request: { id, name } }),
    renameTheme: (id, name) => call("rename_theme", { request: { id, name } }),
    deleteTheme: (id) => call("delete_theme", { request: { id } }),
    chooseImage: (path) => call("choose_image", { request: { path } }),
  };
}

export const commandClient = createCommandClient();

function parseErrorPayload(error: unknown): StudioErrorPayload | null {
  if (typeof error === "string") {
    try {
      return parseErrorPayload(JSON.parse(error));
    } catch {
      return null;
    }
  }
  if (typeof error !== "object" || error === null) return null;
  const value = error as Record<string, unknown>;
  if (typeof value.code !== "string" || typeof value.message !== "string") return null;
  return {
    code: value.code,
    message: value.message,
    ...(typeof value.detail === "string" ? { detail: value.detail } : {}),
  };
}
