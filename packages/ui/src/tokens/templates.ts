export const palette = {
  white: '#ffffff',
  ink: '#101418',
  slate: '#64748b',
  slateDark: '#334155',
  indigo: '#4f46e5',
  indigoDark: '#4338ca',
  mist: '#f8fafc',
  panel: '#ffffff',
  panelDark: '#0f172a',
  border: '#d7dee7',
  borderDark: '#334155',
  success: '#0f9d58',
  danger: '#dc2626'
} as const;

export const spaceScale = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24
} as const;

export const sizeScale = {
  0: 0,
  2: 12,
  3: 14,
  4: 16,
  5: 18,
  6: 20,
  7: 24
} as const;

export const radiusScale = {
  0: 0,
  1: 6,
  2: 10,
  3: 14,
  4: 18
} as const;

export const zIndexScale = {
  0: 0,
  1: 1,
  10: 10,
  100: 100
} as const;

export const fontTemplate = {
  family: 'System',
  size: {
    2: 12,
    3: 14,
    4: 16,
    5: 18,
    6: 20,
    7: 24
  },
  lineHeight: {
    2: 16,
    3: 20,
    4: 22,
    5: 24,
    6: 28,
    7: 32
  },
  weight: {
    4: '400',
    5: '500',
    6: '600',
    7: '700'
  },
  letterSpacing: {
    4: 0,
    5: 0,
    6: -0.2,
    7: -0.3
  }
} as const;

export const shadowScale = {
  resting: {
    shadowColor: 'rgba(15, 23, 42, 0.12)',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 18
  }
} as const;
