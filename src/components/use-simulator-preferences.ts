"use client";

import { useCallback, useEffect, useState } from "react";
import {
  SIMULATOR_PREFERENCES_STORAGE_KEY,
  createDefaultSimulatorPreferences,
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
        if (stored) {
          const parsed = parseSimulatorPreferences(JSON.parse(stored));
          if (parsed) setPreferences(parsed);
        }
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
