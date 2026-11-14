import { createElement, forwardRef } from 'react';
import type { ReactNode } from 'react';
import { Button as TamaguiButton, Spinner } from 'tamagui';

export type ButtonProps = {
  children: ReactNode;
  tone?: 'primary' | 'secondary';
  loading?: boolean;
  disabled?: boolean;
  [key: string]: unknown;
};

export const Button = forwardRef<any, ButtonProps>(function Button(
  { children, disabled = false, loading = false, tone = 'primary', ...props },
  ref,
) {
  const palette =
    tone === 'primary'
      ? {
          backgroundColor: '$primary',
          color: '$primaryText',
          pressStyle: { backgroundColor: '$primaryHover' },
          spinnerColor: '$primaryText',
        }
      : {
          backgroundColor: '$secondary',
          color: '$secondaryText',
          pressStyle: { opacity: 0.9 },
          spinnerColor: '$secondaryText',
        };

  return createElement(
    TamaguiButton as any,
    {
      ref,
      alignItems: 'center',
      borderRadius: '$3',
      disabled: disabled || loading,
      fontFamily: '$body',
      fontSize: '$4',
      fontWeight: '600',
      gap: '$2',
      paddingHorizontal: '$4',
      paddingVertical: '$3',
      ...palette,
      ...props,
    },
    loading ? createElement(Spinner as any, { color: palette.spinnerColor, size: 'small' }) : null,
    children as ReactNode,
  );
});
