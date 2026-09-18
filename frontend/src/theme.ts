// Design tokens for this app. Editorial Mobile LIGHT — warm ceramic & saffron
// (Kosher AI — Kashmiri voice assistant). Values from /app/design_guidelines.json.
//
// The keys match the "color" block of /app/design_guidelines.json.
// A plain key is a background, its `on` partner is the text/icon color on top.

import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

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

export const defaultScheme = "light" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme() as ColorScheme | null;
  const scheme: ColorScheme = system && themes[system] ? system : defaultScheme;
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