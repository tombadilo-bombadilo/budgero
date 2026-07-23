import { useEffect, useRef } from 'react';
import { useTheme } from 'next-themes';
import { useProfile } from '@entities/user/api/useAuth';
import { useApiClient } from '@shared/hooks/useApiClient';
import { useThemePreset } from '@shared/contexts/ThemePresetContext';
import { useUiStore } from '@shared/store/useUiStore';
import {
  registerUserPreferencesSaver,
  type UserPreferencesPatch,
  withUserPreferencesPersistenceSuspended,
} from '@shared/lib/user-preferences-sync';
import type { UserPreferences } from '@shared/model/auth';
import { MasterPasswordManager } from '@shared/lib/crypto';

const FLUSH_DEBOUNCE_MS = 300;

export function UserPreferencesSync() {
  const { data: profile } = useProfile();
  const apiClient = useApiClient();
  const { setTheme, theme } = useTheme();
  const { themeId, setThemeId } = useThemePreset();

  const homePage = useUiStore((state) => state.homePage);
  const setHomePage = useUiStore((state) => state.setHomePage);
  const classicFont = useUiStore((state) => state.classicFont);
  const setClassicFont = useUiStore((state) => state.setClassicFont);
  const desktopBudgetLayout = useUiStore((state) => state.desktopBudgetLayout);
  const setDesktopBudgetLayout = useUiStore((state) => state.setDesktopBudgetLayout);
  const compactMobileLayout = useUiStore((state) => state.compactMobileLayout);
  const setCompactMobileLayout = useUiStore((state) => state.setCompactMobileLayout);
  const mobileBudgetLayout = useUiStore((state) => state.mobileBudgetLayout);
  const setMobileBudgetLayout = useUiStore((state) => state.setMobileBudgetLayout);

  const pendingPatchRef = useRef<UserPreferencesPatch>({});
  const flushTimerRef = useRef<number | null>(null);
  const flushingRef = useRef(false);
  const appliedSignatureRef = useRef<string>('');

  useEffect(() => {
    const hasProfile = Boolean(profile?.id);
    if (!hasProfile) {
      registerUserPreferencesSaver(null);
      return;
    }

    const scheduleFlush = () => {
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
      }
      flushTimerRef.current = window.setTimeout(async () => {
        if (flushingRef.current) return;

        const patch = pendingPatchRef.current;
        if (Object.keys(patch).length === 0) return;

        pendingPatchRef.current = {};
        flushingRef.current = true;
        try {
          await apiClient.put<UserPreferences>('/profile/preferences', patch);
        } catch {
          // Re-queue failed patch so transient network errors don't drop user changes.
          pendingPatchRef.current = { ...patch, ...pendingPatchRef.current };
          scheduleFlush();
        } finally {
          flushingRef.current = false;
        }
      }, FLUSH_DEBOUNCE_MS);
    };

    registerUserPreferencesSaver((patch) => {
      pendingPatchRef.current = { ...pendingPatchRef.current, ...patch };
      scheduleFlush();
    });

    return () => {
      registerUserPreferencesSaver(null);
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
      }
    };
  }, [apiClient, profile?.id]);

  useEffect(() => {
    const prefs = profile?.preferences;
    if (!prefs) return;

    const signature = JSON.stringify(prefs);
    if (appliedSignatureRef.current === signature) return;
    appliedSignatureRef.current = signature;

    // A locally-changed preference that hasn't flushed to the server yet
    // (debounce window, or the PUT is failing/retrying) must NOT be
    // clobbered by a stale server snapshot — otherwise a failed save makes
    // the UI revert the user's click on the next profile refetch.
    const pending = pendingPatchRef.current;

    withUserPreferencesPersistenceSuspended(() => {
      if (!('theme_mode' in pending) && theme !== prefs.theme_mode) {
        setTheme(prefs.theme_mode);
      }
      if (!('theme_preset' in pending) && themeId !== prefs.theme_preset) {
        setThemeId(prefs.theme_preset);
      }
      if (!('classic_font' in pending) && classicFont !== prefs.classic_font) {
        setClassicFont(prefs.classic_font);
      }
      if (!('home_page' in pending) && homePage !== prefs.home_page) {
        setHomePage(prefs.home_page);
      }
      if (
        !('desktop_budget_layout' in pending) &&
        desktopBudgetLayout !== prefs.desktop_budget_layout
      ) {
        setDesktopBudgetLayout(prefs.desktop_budget_layout);
      }
      if (
        !('compact_mobile_layout' in pending) &&
        compactMobileLayout !== prefs.compact_mobile_layout
      ) {
        setCompactMobileLayout(prefs.compact_mobile_layout);
      }
      if (
        !('mobile_budget_layout' in pending) &&
        mobileBudgetLayout !== prefs.mobile_budget_layout
      ) {
        setMobileBudgetLayout(prefs.mobile_budget_layout);
      }

      // Apply master password storage setting from server. The actual password
      // is never stored server-side — only the mode + duration live there.
      if (prefs.master_password_storage_mode === 'session') {
        MasterPasswordManager.setPersistenceSetting({
          mode: 'session',
          days: prefs.master_password_storage_days,
        });
      } else {
        MasterPasswordManager.setPersistenceSetting({ mode: 'memory' });
      }
    });
  }, [
    classicFont,
    compactMobileLayout,
    desktopBudgetLayout,
    homePage,
    mobileBudgetLayout,
    profile?.preferences,
    setClassicFont,
    setCompactMobileLayout,
    setDesktopBudgetLayout,
    setHomePage,
    setMobileBudgetLayout,
    setTheme,
    setThemeId,
    theme,
    themeId,
  ]);

  return null;
}
