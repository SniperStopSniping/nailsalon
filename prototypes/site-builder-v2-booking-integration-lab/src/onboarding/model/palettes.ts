import type { SitePalettePresetId } from './types';

export type SitePaletteRoles = {
  accent: string;
  button: string;
  buttonText: string;
  focusRing: string;
  ground: string;
  ink: string;
  line: string;
  muted: string;
  secondaryAccent: string;
  surface: string;
};

export type SitePalettePreset = {
  description: string;
  id: SitePalettePresetId;
  label: string;
  roles: SitePaletteRoles;
};

/**
 * Customer-site colours only. Owner, account, plan, and Workspace surfaces do
 * not read these tokens.
 */
export const SITE_PALETTE_PRESETS: readonly SitePalettePreset[] = [
  {
    description: 'Luster’s signature berry with warm ivory.',
    id: 'luster_berry',
    label: 'Luster Berry',
    roles: {
      accent: '#8f3155',
      button: '#8f3155',
      buttonText: '#ffffff',
      focusRing: '#6544b8',
      ground: '#fbf5f1',
      ink: '#30262a',
      line: '#dfd1d4',
      muted: '#706267',
      secondaryAccent: '#d8a4b6',
      surface: '#fffdfb',
    },
  },
  {
    description: 'Soft blush balanced by rich cocoa.',
    id: 'blush_cocoa',
    label: 'Blush & Cocoa',
    roles: {
      accent: '#914863',
      button: '#744052',
      buttonText: '#ffffff',
      focusRing: '#6843b0',
      ground: '#fff2f4',
      ink: '#452f35',
      line: '#e6cfd5',
      muted: '#755f65',
      secondaryAccent: '#d8a5ae',
      surface: '#fffafb',
    },
  },
  {
    description: 'Earthy terracotta on a creamy ground.',
    id: 'terracotta_cream',
    label: 'Terracotta & Cream',
    roles: {
      accent: '#9b432f',
      button: '#913c2b',
      buttonText: '#ffffff',
      focusRing: '#5a49b8',
      ground: '#fbf1e5',
      ink: '#382923',
      line: '#dfcdbc',
      muted: '#756359',
      secondaryAccent: '#d99d71',
      surface: '#fffaf3',
    },
  },
  {
    description: 'Grounded sage with cool stone neutrals.',
    id: 'sage_stone',
    label: 'Sage & Stone',
    roles: {
      accent: '#2f6352',
      button: '#2f6352',
      buttonText: '#ffffff',
      focusRing: '#6544b8',
      ground: '#f1f4ee',
      ink: '#26372f',
      line: '#ced8d0',
      muted: '#607067',
      secondaryAccent: '#91aa97',
      surface: '#fbfdfa',
    },
  },
  {
    description: 'Airy lilac grounded with deep plum.',
    id: 'lilac_plum',
    label: 'Lilac & Plum',
    roles: {
      accent: '#70427b',
      button: '#70427b',
      buttonText: '#ffffff',
      focusRing: '#424fbd',
      ground: '#f7f1fa',
      ink: '#39293f',
      line: '#ded0e4',
      muted: '#6f6075',
      secondaryAccent: '#b79ac7',
      surface: '#fefbff',
    },
  },
  {
    description: 'Classic navy with soft, luminous ivory.',
    id: 'navy_ivory',
    label: 'Navy & Ivory',
    roles: {
      accent: '#294d73',
      button: '#294d73',
      buttonText: '#ffffff',
      focusRing: '#7650b8',
      ground: '#faf7ef',
      ink: '#1d2c41',
      line: '#d5d4ce',
      muted: '#647083',
      secondaryAccent: '#8da4bc',
      surface: '#fffdf7',
    },
  },
  {
    description: 'Crisp black, white, and quiet grey.',
    id: 'monochrome',
    label: 'Monochrome',
    roles: {
      accent: '#262626',
      button: '#202020',
      buttonText: '#ffffff',
      focusRing: '#6648b8',
      ground: '#f5f5f3',
      ink: '#202020',
      line: '#d1d1ce',
      muted: '#666663',
      secondaryAccent: '#a8a8a3',
      surface: '#ffffff',
    },
  },
  {
    description: 'Dramatic black softened by champagne.',
    id: 'black_champagne',
    label: 'Black & Champagne',
    roles: {
      accent: '#e1c27e',
      button: '#e1c27e',
      buttonText: '#211a16',
      focusRing: '#f3d99f',
      ground: '#151315',
      ink: '#fff7e8',
      line: '#51484a',
      muted: '#c9bab0',
      secondaryAccent: '#6e294f',
      surface: '#221e20',
    },
  },
] as const;

export const SITE_PALETTE_BY_ID: Readonly<Record<SitePalettePresetId, SitePalettePreset>> =
  Object.fromEntries(SITE_PALETTE_PRESETS.map((preset) => [preset.id, preset])) as
    Record<SitePalettePresetId, SitePalettePreset>;
