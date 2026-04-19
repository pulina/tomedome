import technoGothicStylesheetUrl from './techno-gothic.css?url';
import { TechnoGothicDecor } from './techno-gothic-decor';
import type { ThemeDefinition } from './theme-contract';

export const THEMES: Record<string, ThemeDefinition> = {
  'techno-gothic': {
    id: 'techno-gothic',
    displayName: 'Techno-Gothic',
    Decor: TechnoGothicDecor,
    stylesheetUrl: technoGothicStylesheetUrl,
  },
};

export const DEFAULT_THEME_ID = 'techno-gothic';
