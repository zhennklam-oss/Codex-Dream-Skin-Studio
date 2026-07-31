export type Appearance = "auto" | "light" | "dark";
export type SafeArea = "auto" | "left" | "right" | "center" | "none";
export type TaskMode = "auto" | "ambient" | "banner" | "off";
export type ToneMode = "original" | "grayscale" | "duotone" | "wash";

export interface ArtSettings {
  focusX: number;
  focusY: number;
  scale: number;
  safeArea: SafeArea;
  taskMode: TaskMode;
}

export interface EffectSettings {
  homeOpacity: number;
  taskOpacity: number;
  blur: number;
  saturation: number;
  brightness: number;
  maskStrength: number;
  interfaceOpacity: number;
  leftSidebarOpacity: number;
  topBarOpacity: number;
  rightSidebarOpacity: number;
  bottomBarOpacity: number;
  inputOpacity: number;
  homeCardOpacity: number;
  homeCardRadius: number;
  homeCardHoverBrightness: number;
  toneMode: ToneMode;
  toneStrength: number;
  duotoneShadow: string;
  duotoneHighlight: string;
  washColor: string;
}

export interface ThemeDocument {
  schemaVersion: 6;
  id: string;
  name: string;
  image: string;
  appearance: Appearance;
  art: ArtSettings;
  effects: EffectSettings;
  extra: Record<string, unknown>;
}

export type ThemeSummary = Pick<ThemeDocument, "id" | "name" | "image" | "appearance">;

export const DEFAULT_ART: ArtSettings = {
  focusX: 0.5,
  focusY: 0.46,
  scale: 1,
  safeArea: "none",
  taskMode: "auto",
};

export const DEFAULT_EFFECTS: EffectSettings = {
  homeOpacity: 1,
  taskOpacity: 0.18,
  blur: 0,
  saturation: 1,
  brightness: 1,
  maskStrength: 0.65,
  interfaceOpacity: 0.78,
  leftSidebarOpacity: 0.78,
  topBarOpacity: 0.78,
  rightSidebarOpacity: 0.78,
  bottomBarOpacity: 0.78,
  inputOpacity: 0.9,
  homeCardOpacity: 0.68,
  homeCardRadius: 18,
  homeCardHoverBrightness: 1.1,
  toneMode: "original",
  toneStrength: 1,
  duotoneShadow: "#1C1B22",
  duotoneHighlight: "#F2E9DC",
  washColor: "#7D9FA5",
};

const APPEARANCES: readonly Appearance[] = ["auto", "light", "dark"];
const SAFE_AREAS: readonly SafeArea[] = ["auto", "left", "right", "center", "none"];
const TASK_MODES: readonly TaskMode[] = ["auto", "ambient", "banner", "off"];
const TONE_MODES: readonly ToneMode[] = ["original", "grayscale", "duotone", "wash"];
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const REGION_OPACITY_KEYS = ["leftSidebarOpacity", "topBarOpacity", "rightSidebarOpacity", "bottomBarOpacity"] as const;
const LEGACY_OPACITY_KEYS = ["sidebarOpacity", "composerOpacity"] as const;
const KNOWN_FIELDS = new Set([
  "schemaVersion",
  "id",
  "name",
  "image",
  "appearance",
  "art",
  "effects",
  "extra",
]);

export function normalizeTheme(input: unknown): ThemeDocument {
  const source = requireRecord(input, "theme must be an object");
  const sourceSchemaVersion = valueOrDefault(source.schemaVersion, 1);
  if (![1, 2, 3, 4, 5, 6].includes(sourceSchemaVersion as number)) {
    throw new Error("schemaVersion must be 1, 2, 3, 4, 5, or 6");
  }

  const artSource = optionalRecord(source.art, "art must be an object");
  const effectsSource = optionalRecord(source.effects, "effects must be an object");
  const existingExtra = optionalRecord(source.extra, "extra must be an object");
  const extra: Record<string, unknown> = { ...existingExtra };
  for (const [key, value] of Object.entries(source)) {
    if (!KNOWN_FIELDS.has(key)) extra[key] = value;
  }

  const interfaceOpacity = migratedInterfaceOpacity(effectsSource);
  const inputOpacity = migratedInputOpacity(effectsSource, sourceSchemaVersion as number);
  const bottomBarOpacity = (sourceSchemaVersion as number) >= 5
    ? migratedRegionOpacity(effectsSource, "bottomBarOpacity", null, interfaceOpacity)
    : interfaceOpacity;
  const theme: ThemeDocument = {
    schemaVersion: 6,
    id: requireString(source.id, "id"),
    name: requireString(source.name, "name"),
    image: requireString(source.image, "image"),
    appearance: readEnum(valueOrDefault(source.appearance, "auto"), APPEARANCES, "appearance"),
    art: {
      focusX: readNumber(valueOrDefault(artSource.focusX, DEFAULT_ART.focusX), "art.focusX"),
      focusY: readNumber(valueOrDefault(artSource.focusY, DEFAULT_ART.focusY), "art.focusY"),
      scale: readNumber(valueOrDefault(artSource.scale, DEFAULT_ART.scale), "art.scale"),
      safeArea: readEnum(valueOrDefault(artSource.safeArea, DEFAULT_ART.safeArea), SAFE_AREAS, "art.safeArea"),
      taskMode: readEnum(valueOrDefault(artSource.taskMode, DEFAULT_ART.taskMode), TASK_MODES, "art.taskMode"),
    },
    effects: {
      homeOpacity: readNumber(valueOrDefault(effectsSource.homeOpacity, DEFAULT_EFFECTS.homeOpacity), "effects.homeOpacity"),
      taskOpacity: readNumber(valueOrDefault(effectsSource.taskOpacity, DEFAULT_EFFECTS.taskOpacity), "effects.taskOpacity"),
      blur: readNumber(valueOrDefault(effectsSource.blur, DEFAULT_EFFECTS.blur), "effects.blur"),
      saturation: readNumber(valueOrDefault(effectsSource.saturation, DEFAULT_EFFECTS.saturation), "effects.saturation"),
      brightness: readNumber(valueOrDefault(effectsSource.brightness, DEFAULT_EFFECTS.brightness), "effects.brightness"),
      maskStrength: readNumber(valueOrDefault(effectsSource.maskStrength, DEFAULT_EFFECTS.maskStrength), "effects.maskStrength"),
      interfaceOpacity,
      leftSidebarOpacity: migratedRegionOpacity(effectsSource, "leftSidebarOpacity", "sidebarOpacity", interfaceOpacity),
      topBarOpacity: migratedRegionOpacity(effectsSource, "topBarOpacity", null, interfaceOpacity),
      rightSidebarOpacity: migratedRegionOpacity(effectsSource, "rightSidebarOpacity", null, interfaceOpacity),
      bottomBarOpacity,
      inputOpacity,
      homeCardOpacity: readNumber(valueOrDefault(effectsSource.homeCardOpacity, DEFAULT_EFFECTS.homeCardOpacity), "effects.homeCardOpacity"),
      homeCardRadius: readNumber(valueOrDefault(effectsSource.homeCardRadius, DEFAULT_EFFECTS.homeCardRadius), "effects.homeCardRadius"),
      homeCardHoverBrightness: readNumber(valueOrDefault(effectsSource.homeCardHoverBrightness, DEFAULT_EFFECTS.homeCardHoverBrightness), "effects.homeCardHoverBrightness"),
      toneMode: readEnum(valueOrDefault(effectsSource.toneMode, DEFAULT_EFFECTS.toneMode), TONE_MODES, "effects.toneMode"),
      toneStrength: readNumber(valueOrDefault(effectsSource.toneStrength, DEFAULT_EFFECTS.toneStrength), "effects.toneStrength"),
      duotoneShadow: readHexColor(valueOrDefault(effectsSource.duotoneShadow, DEFAULT_EFFECTS.duotoneShadow), "effects.duotoneShadow"),
      duotoneHighlight: readHexColor(valueOrDefault(effectsSource.duotoneHighlight, DEFAULT_EFFECTS.duotoneHighlight), "effects.duotoneHighlight"),
      washColor: readHexColor(valueOrDefault(effectsSource.washColor, DEFAULT_EFFECTS.washColor), "effects.washColor"),
    },
    extra,
  };

  const errors = validateTheme(theme);
  if (errors.length > 0) throw new Error(errors.join("; "));
  return theme;
}

export function validateTheme(theme: ThemeDocument): string[] {
  const errors: string[] = [];
  if (theme.schemaVersion !== 6) errors.push("schemaVersion must be 6");
  validateRequiredString(errors, "id", theme.id);
  validateRequiredString(errors, "name", theme.name);
  validateRequiredString(errors, "image", theme.image);
  if (!APPEARANCES.includes(theme.appearance)) errors.push("appearance is invalid");
  if (!SAFE_AREAS.includes(theme.art.safeArea)) errors.push("art.safeArea is invalid");
  if (!TASK_MODES.includes(theme.art.taskMode)) errors.push("art.taskMode is invalid");
  validateRange(errors, "art.focusX", theme.art.focusX, 0, 1);
  validateRange(errors, "art.focusY", theme.art.focusY, 0, 1);
  validateRange(errors, "art.scale", theme.art.scale, 0.5, 2.5);
  validateRange(errors, "effects.homeOpacity", theme.effects.homeOpacity, 0, 1);
  validateRange(errors, "effects.taskOpacity", theme.effects.taskOpacity, 0, 1);
  validateRange(errors, "effects.blur", theme.effects.blur, 0, 32);
  validateRange(errors, "effects.saturation", theme.effects.saturation, 0, 2);
  validateRange(errors, "effects.brightness", theme.effects.brightness, 0.5, 1.5);
  validateRange(errors, "effects.maskStrength", theme.effects.maskStrength, 0, 1);
  validateRange(errors, "effects.interfaceOpacity", theme.effects.interfaceOpacity, 0, 1);
  validateRange(errors, "effects.leftSidebarOpacity", theme.effects.leftSidebarOpacity, 0, 1);
  validateRange(errors, "effects.topBarOpacity", theme.effects.topBarOpacity, 0, 1);
  validateRange(errors, "effects.rightSidebarOpacity", theme.effects.rightSidebarOpacity, 0, 1);
  validateRange(errors, "effects.bottomBarOpacity", theme.effects.bottomBarOpacity, 0, 1);
  validateRange(errors, "effects.inputOpacity", theme.effects.inputOpacity, 0, 1);
  validateRange(errors, "effects.homeCardOpacity", theme.effects.homeCardOpacity, 0.25, 0.95);
  validateRange(errors, "effects.homeCardRadius", theme.effects.homeCardRadius, 6, 28);
  validateRange(errors, "effects.homeCardHoverBrightness", theme.effects.homeCardHoverBrightness, 1, 1.25);
  if (!TONE_MODES.includes(theme.effects.toneMode)) errors.push("effects.toneMode is invalid");
  validateRange(errors, "effects.toneStrength", theme.effects.toneStrength, 0, 1);
  validateHexColor(errors, "effects.duotoneShadow", theme.effects.duotoneShadow);
  validateHexColor(errors, "effects.duotoneHighlight", theme.effects.duotoneHighlight);
  validateHexColor(errors, "effects.washColor", theme.effects.washColor);
  return errors;
}

function migratedInterfaceOpacity(effects: Record<string, unknown>): number {
  if (effects.interfaceOpacity !== undefined) {
    return readNumber(effects.interfaceOpacity, "effects.interfaceOpacity");
  }
  const regionValues = REGION_OPACITY_KEYS.flatMap((key) => (
    effects[key] === undefined ? [] : [readNumber(effects[key], `effects.${key}`)]
  ));
  const legacyValues = LEGACY_OPACITY_KEYS.flatMap((key) => (
    effects[key] === undefined ? [] : [readNumber(effects[key], `effects.${key}`)]
  ));
  const values = regionValues.length > 0 ? regionValues : legacyValues;
  const mean = values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : DEFAULT_EFFECTS.interfaceOpacity;
  return Math.round(Math.min(1, Math.max(0, mean)) * 10_000) / 10_000;
}

function migratedRegionOpacity(
  effects: Record<string, unknown>,
  field: typeof REGION_OPACITY_KEYS[number],
  legacyField: typeof LEGACY_OPACITY_KEYS[number] | null,
  fallback: number,
): number {
  if (effects[field] !== undefined) return readNumber(effects[field], `effects.${field}`);
  if (legacyField && effects[legacyField] !== undefined) {
    return readNumber(effects[legacyField], `effects.${legacyField}`);
  }
  return fallback;
}

function migratedInputOpacity(effects: Record<string, unknown>, schemaVersion: number): number {
  if (effects.inputOpacity !== undefined) {
    return readNumber(effects.inputOpacity, "effects.inputOpacity");
  }
  if (effects.composerOpacity !== undefined) {
    return readNumber(effects.composerOpacity, "effects.composerOpacity");
  }
  if (schemaVersion <= 4 && effects.bottomBarOpacity !== undefined) {
    return readNumber(effects.bottomBarOpacity, "effects.bottomBarOpacity");
  }
  return DEFAULT_EFFECTS.inputOpacity;
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown, message: string): Record<string, unknown> {
  return value === undefined ? {} : requireRecord(value, message);
}

function valueOrDefault<T>(value: unknown, fallback: T): unknown | T {
  return value === undefined ? fallback : value;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value;
}

function readNumber(value: unknown, field: string): number {
  if (typeof value !== "number") throw new Error(`${field} must be a number`);
  return value;
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(`${field} is invalid`);
  return value as T;
}

function readHexColor(value: unknown, field: string): string {
  if (typeof value !== "string" || !HEX_COLOR.test(value)) throw new Error(`${field} is invalid`);
  return value;
}

function validateRequiredString(errors: string[], field: string, value: string): void {
  if (value.trim().length === 0) errors.push(`${field} must not be empty`);
}

function validateRange(errors: string[], field: string, value: number, minimum: number, maximum: number): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    errors.push(`${field} must be between ${minimum} and ${maximum}`);
  }
}

function validateHexColor(errors: string[], field: string, value: string): void {
  if (!HEX_COLOR.test(value)) errors.push(`${field} is invalid`);
}
