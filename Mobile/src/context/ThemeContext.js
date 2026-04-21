/**
 * ThemeContext.js
 *
 * Global theme system for the entire app.
 *
 * HOW TO CHANGE COLORS
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. Find the theme you want to edit below  ('dark' or 'light').
 *  2. Change the hex value next to the label you want.
 *  3. That's it — every screen that uses useTheme() will update automatically.
 *
 * HOW TO ADD A NEW THEME
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. Add a new key inside THEMES (copy 'dark' or 'light' as a template).
 *  2. Update toggleTheme() below to cycle through the new key.
 *  3. The theme toggle button in AlertScreen will show it automatically.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// THEME DEFINITIONS  ← edit colors here
// ─────────────────────────────────────────────────────────────────────────────
export const THEMES = {

  // ── Dark: Black backgrounds + Red accents ─────────────────────────────────
  dark: {
    name:          'dark',
    label:         ' Light',   // label shown on the toggle button

    // Backgrounds
    bg:            '#060910',         // full-screen background
    surface:       '#0D1117',         // cards, panels, modals
    surfaceAlt:    '#1C1C1E',         // secondary surface (ETA bar, bottom sheets)
    surfaceAlt2:   '#2C2C2E',         // tertiary surface (pressed states)
    inputBg:       '#080C14',         // text-input fields

    // Borders / separators
    border:        '#1E293B',
    borderLight:   '#0F172A',

    // Accent — the main "brand" action color
    accent:        '#CC0000',         // ← swap this hex to change the red
    accentLight:   '#FF3B30',         // lighter variant (hover, icons)
    accentBg:      'rgba(204,0,0,0.12)', // accent with opacity (chips, bg tints)

    // Text
    textPrimary:   '#F1F5F9',
    textSecondary: '#94A3B8',
    textMuted:     '#475569',

    // Header / top-bar
    topBar:        '#3d0909',         // header bar bg (chat list, map bar)

    // Map / Navigation
    polyline:      '#CC0000',         // main route line
    mapSurface:    '#1C1C1E',         // ETA bar bg during navigation
    mapText:       '#FFFFFF',         // ETA bar text
    urgency:       ['#CC0000', '#E65100', '#B71C1C'], // [normal, warn, now]

    // System
    statusBar:     'light-content',
  },

  // ── Light: White backgrounds + Orange accents ─────────────────────────────
  light: {
    name:          'light',
    label:         ' Dark',    // label shown on the toggle button

    bg:            '#F8FAFC',
    surface:       '#FFFFFF',
    surfaceAlt:    '#F2F2F7',
    surfaceAlt2:   '#E5E7EB',
    inputBg:       '#F8FAFC',

    border:        '#E2E8F0',
    borderLight:   '#F1F5F9',

    accent:        '#EA580C',         // ← swap this hex to change the orange
    accentLight:   '#F97316',
    accentBg:      'rgba(234,88,12,0.08)',

    textPrimary:   '#0F172A',
    textSecondary: '#64748B',
    textMuted:     '#94A3B8',

    topBar:        '#EA580C',

    polyline:      '#EA580C',
    mapSurface:    '#FFFFFF',
    mapText:       '#0F172A',
    urgency:       ['#EA580C', '#D97706', '#C2410C'],

    statusBar:     'dark-content',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT + PROVIDER
// ─────────────────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'APP_THEME';

const ThemeContext = createContext({
  theme:        THEMES.dark,
  themeName:    'dark',
  toggleTheme:  () => {},
  setThemeName: () => {},
});

export function ThemeProvider({ children }) {
  const [themeName, setThemeNameState] = useState('dark');

  // Restore saved theme on app start
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(saved => { if (saved && THEMES[saved]) setThemeNameState(saved); })
      .catch(() => {});
  }, []);

  const setThemeName = useCallback((name) => {
    if (!THEMES[name]) return;
    setThemeNameState(name);
    AsyncStorage.setItem(STORAGE_KEY, name).catch(() => {});
  }, []);

  // ── To add a 3rd theme: change this to cycle through 3 names ──────────────
  const toggleTheme = useCallback(() => {
    setThemeName(themeName === 'dark' ? 'light' : 'dark');
  }, [themeName, setThemeName]);

  return (
    <ThemeContext.Provider value={{ theme: THEMES[themeName], themeName, toggleTheme, setThemeName }}>
      {children}
    </ThemeContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HOOK — import this in every screen
// ─────────────────────────────────────────────────────────────────────────────
export const useTheme = () => useContext(ThemeContext);
