// Design tokens for this app. Editorial Mobile LIGHT — warm ceramic & saffron
// (Kosher AI — Kashmiri voice assistant). Values from /app/design_guidelines.json.
//
// The keys match the "color" block of /app/design_guidelines.json.
// A plain key is a background, its `on` partner is the text/icon color on top.

import { createElement, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

import { storage } from "@/src/utils/storage";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#FDFBF7",
  onSurface: "#2C2623",
  surfaceSecondary: "#F5EFE6",
  onSurfaceSecondary: "#3E3532",
  surfaceTertiary: "#EBE3D5",
  onSurfaceTertiary: "#4E423E",
  surfaceInverse: "#1A1715",
  onSurfaceInverse: "#FDFBF7",
  muted: "#7A6E65",

  brand: "#C85A32",
  onBrand: "#FFFFFF",
  brandPrimary: "#C85A32",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#A64420",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#FCECE6",
  onBrandTertiary: "#C85A32",

  success: "#3D7A5D",
  onSuccess: "#FFFFFF",
  warning: "#D48C33",
  onWarning: "#FFFFFF",
  error: "#B83A2C",
  onError: "#FFFFFF",
  info: "#4A6FA5",
  onInfo: "#FFFFFF",

  border: "#E2D9CE",
  borderStrong: "#C85A32",
  divider: "#EFE8DF",
};

export type ThemeColors = typeof light;

// Dark palette — warm ceramic & saffron tuned for low light.
const dark: ThemeColors = {
  surface: "#1A1715",
  onSurface: "#F2EBE1",
  surfaceSecondary: "#241F1C",
  onSurfaceSecondary: "#E4DACF",
  surfaceTertiary: "#2E2823",
  onSurfaceTertiary: "#D9CFC4",
  surfaceInverse: "#FDFBF7",
  onSurfaceInverse: "#1A1715",
  muted: "#A89A8D",

  brand: "#E0713F",
  onBrand: "#FFFFFF",
  brandPrimary: "#E0713F",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#C55A2E",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#3A2A22",
  onBrandTertiary: "#F0A57F",

  success: "#5AA57E",
  onSuccess: "#0E1A13",
  warning: "#E0A64D",
  onWarning: "#1A1206",
  error: "#E0574A",
  onError: "#FFFFFF",
  info: "#6E93C9",
  onInfo: "#0A1220",

  border: "#3A322C",
  borderStrong: "#E0713F",
  divider: "#2A2420",
};

export const defaultScheme = "light" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark: ThemeColors } = { light, dark };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

// --- Theme mode context (manual light/dark toggle, persisted) ---
type ThemeModeState = { mode: ColorScheme; setMode: (m: ColorScheme) => void; toggle: () => void };
const ThemeModeContext = createContext<ThemeModeState | null>(null);
const THEME_KEY = "app_theme_mode";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme() as ColorScheme | null;
  const [mode, setModeState] = useState<ColorScheme>(system && themes[system] ? system : defaultScheme);

  useEffect(() => {
    storage.getItem<ColorScheme>(THEME_KEY, "" as ColorScheme).then((v) => {
      if (v === "light" || v === "dark") setModeState(v);
    });
  }, []);

  const setMode = useCallback((m: ColorScheme) => {
    setModeState(m);
    void storage.setItem(THEME_KEY, m);
  }, []);

  const toggle = useCallback(() => {
    setModeState((prev) => {
      const next: ColorScheme = prev === "dark" ? "light" : "dark";
      void storage.setItem(THEME_KEY, next);
      return next;
    });
  }, []);

  return createElement(ThemeModeContext.Provider, { value: { mode, setMode, toggle } }, children);
}

export function useThemeMode(): ThemeModeState {
  return useContext(ThemeModeContext) ?? { mode: defaultScheme, setMode: () => {}, toggle: () => {} };
}

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const ctx = useContext(ThemeModeContext);
  const system = useColorScheme() as ColorScheme | null;
  const scheme: ColorScheme = ctx ? ctx.mode : system && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

// Spacing + radius tokens from the design guidelines (8pt editorial rhythm).
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = { sm: 6, md: 12, lg: 20, pill: 999 } as const;