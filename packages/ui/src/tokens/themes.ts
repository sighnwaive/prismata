import { palette } from './templates';

export const themes = {
  light: {
    background: palette.mist,
    color: palette.ink,
    muted: palette.slate,
    panel: palette.panel,
    panelAlt: '#eef2ff',
    borderColor: palette.border,
    primary: palette.indigo,
    primaryHover: palette.indigoDark,
    primaryText: palette.white,
    secondary: palette.slateDark,
    secondaryText: palette.white,
    success: palette.success,
    danger: palette.danger
  },
  dark: {
    background: palette.panelDark,
    color: palette.white,
    muted: '#94a3b8',
    panel: '#162033',
    panelAlt: '#1e293b',
    borderColor: palette.borderDark,
    primary: '#6366f1',
    primaryHover: '#818cf8',
    primaryText: palette.white,
    secondary: '#475569',
    secondaryText: palette.white,
    success: '#22c55e',
    danger: '#f87171'
  }
} as const;

export type AppThemes = typeof themes;
