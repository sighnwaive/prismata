import { createElement } from 'react';
import type { ReactNode } from 'react';
import { Text as TamaguiText } from 'tamagui';

export type TextProps = {
  children?: ReactNode;
  tone?: 'default' | 'muted' | 'primary' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
  [key: string]: unknown;
};

const toneStyles = {
  default: '$color',
  muted: '$muted',
  primary: '$primary',
  danger: '$danger',
  success: '$success',
} as const;

const sizeStyles = {
  sm: { fontSize: '$3', lineHeight: 20 },
  md: { fontSize: '$4', lineHeight: 22 },
  lg: { fontSize: '$6', lineHeight: 28 },
  xl: { fontSize: '$7', lineHeight: 32 },
} as const;

const weightStyles = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export function Text({ children, size = 'md', tone = 'default', weight = 'regular', ...props }: TextProps) {
  return createElement(
    TamaguiText as any,
    {
      color: toneStyles[tone],
      fontFamily: '$body',
      fontWeight: weightStyles[weight],
      ...sizeStyles[size],
      ...props,
    },
    children,
  );
}
