'use client';

import type { CSSProperties, ElementType, ReactNode } from 'react';

import { useChromeThemeProps } from './useChromeThemeProps';
import type { ChromeMapping } from '@/lib/theme/chromeThemeProps';
import { hunkyardChromeMapping } from '@/lib/theme/hunkyardChromeMapping';
import type { ThemeInput } from '@/lib/theme/ThemeSource';

interface ThemedSurfaceProps {
  as?: ElementType;
  children?: ReactNode;
  className?: string;
  mapping?: ChromeMapping;
  style?: CSSProperties;
  theme?: ThemeInput;
}

// A themed chrome host. Renders `as` (default div) with the chrome style applied
// from the active theme via the given mapping (default hunkyardChromeMapping).
// Caller `style` (spread after) still wins on key collisions.
export function ThemedSurface({
  as,
  children,
  className,
  mapping = hunkyardChromeMapping,
  style,
  theme,
}: ThemedSurfaceProps) {
  const Component = as ?? 'div';
  const themeProps = useChromeThemeProps(mapping, theme);
  return (
    <Component className={className} style={{ ...themeProps.style, ...style }}>
      {children}
    </Component>
  );
}
