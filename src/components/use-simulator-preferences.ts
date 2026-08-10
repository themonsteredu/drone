"use client";

import { useCallback, useEffect, useState } from "react";
import {
  LEGACY_SIMULATOR_PREFERENCES_STORAGE_KEY,
  SIMULATOR_PREFERENCES_STORAGE_KEY,
  createDefaultSimulatorPreferences,
  migrateLegacySimulatorPreferences,
  parseSimulatorPreferences,
  type SimulatorPreferences,
} from "../simulator/settings";

export type SimulatorPreferencesUpdater = (
  current: SimulatorPreferences,
) => SimulatorPreferences;

export function useSimulatorPreferences(): {
  preferences: SimulatorPreferences;
  updatePreferences: (update: SimulatorPreferencesUpdater) => void;
  resetPreferences: () => void;
  storageReady: boolean;
} {
  const [preferences, setPreferences] = useState<SimulatorPreferences>(
    createDefaultSimulatorPreferences,
  );
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(
          SIMULATOR_PREFERENCES_STORAGE_KEY,
        );
        const legacy = window.localStorage.getItem(
          LEGACY_SIMULATOR_PREFERENCES_STORAGE_KEY,
        );
        const parsed = stored
          ? parseSimulatorPreferences(JSON.parse(stored))
          : legacy
            ? migrateLegacySimulatorPreferences(JSON.parse(legacy))
            : null;
        if (parsed) setPreferences(parsed);
      } catch {
        // Storage is an optional convenience; safe defaults remain usable.
      } finally {
        setStorageReady(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    try {
      window.localStorage.setItem(
        SIMULATOR_PREFERENCES_STORAGE_KEY,
        JSON.stringify(preferences),
      );
    } catch {
      // Keep the in-memory preferences when storage is blocked or full.
    }
  }, [preferences, storageReady]);

  const updatePreferences = useCallback(
    (update: SimulatorPreferencesUpdater) => {
      setPreferences((current) => update(current));
    },
    [],
  );

  const resetPreferences = useCallback(() => {
    setPreferences(createDefaultSimulatorPreferences());
  }, []);

  return {
    preferences,
    updatePreferences,
    resetPreferences,
    storageReady,
  };
}
