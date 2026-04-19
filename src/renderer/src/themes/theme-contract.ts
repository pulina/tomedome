/**
 * Theme contract — every theme MUST define these CSS custom properties on :root.
 * Components reference only these tokens (via var(--token)) and never hardcoded
 * colors or fonts. Adding a new theme = one CSS file defining all of these +
 * an optional decor React component.
 */

import type { ComponentType } from 'react';

export type ThemeCssVar =
  // Background surfaces
  | '--color-bg-primary'
  | '--color-bg-secondary'
  | '--color-bg-tertiary'
  // Text
  | '--color-text-primary'
  | '--color-text-secondary'
  | '--color-text-muted'
  // Accent
  | '--color-accent'
  | '--color-accent-hover'
  | '--color-accent-muted'
  | '--color-highlight'
  // Semantic
  | '--color-success'
  | '--color-error'
  // Borders
  | '--border-color'
  | '--border-color-strong'
  | '--border-color-focus'
  | '--border-radius-sm'
  | '--border-radius-md'
  // Typography
  | '--font-heading'
  | '--font-body'
  | '--font-mono'
  | '--letter-spacing-heading'
  // Surfaces
  | '--surface-sidebar'
  | '--surface-main'
  | '--surface-panel'
  | '--surface-input'
  | '--surface-input-hover'
  | '--surface-overlay'
  // Effects
  | '--shadow-panel'
  | '--glow-accent'
  // Modal / page chrome (rgba tokens used by *.module.css)
  | '--overlay-modal-scrim'
  | '--overlay-modal-scrim-strong'
  | '--surface-page-tint'
  | '--surface-chat-card'
  | '--shadow-chat-title-wrap'
  | '--text-shadow-chat-title'
  | '--surface-info-muted'
  | '--border-info-muted'
  | '--border-info-muted-soft'
  | '--color-warning-foreground'
  | '--border-warning-muted'
  | '--surface-warning-muted'
  | '--border-error-muted'
  | '--surface-error-muted'
  | '--surface-success-muted'
  | '--border-success-muted'
  | '--surface-amber-muted'
  | '--border-amber-muted'
  | '--surface-amber-raised'
  | '--border-amber-strong'
  | '--surface-amber-solid'
  | '--surface-amber-note'
  | '--border-amber-note'
  | '--border-settings-callout'
  | '--surface-settings-callout'
  | '--shadow-control-ring-dark'
  | '--surface-toggle-off'
  | '--surface-toggle-on'
  | '--shadow-toggle-success'
  | '--shadow-toggle-error'
  | '--surface-bar-positive'
  | '--surface-bar-caution'
  | '--surface-embedding-violet'
  | '--border-embedding-violet'
  | '--gradient-decor-spot-accent'
  | '--gradient-decor-spot-cyan'
  | '--gradient-decor-fade-start'
  | '--gradient-decor-fade-end'
  | '--grid-line-faint';

export interface ThemeDefinition {
  id: string;
  displayName: string;
  /** React component rendered inside AppShell that provides theme-specific
   * decorative layers (background gradients, overlays, grid-lines, etc.).
   * May render null for minimal themes. */
  Decor: ComponentType;
  /** Vite-resolved URL to the theme stylesheet (`import './theme.css?url'`). */
  stylesheetUrl: string;
}
