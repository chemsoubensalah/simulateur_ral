"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "cv-favorites";
const EVENT = "cv-favorites-change";

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Favourite paints (ids), kept on this device and shared by every component. */
export function useFavorites(): { favorites: string[]; isFavorite: (id: string) => boolean; toggle: (id: string) => void } {
  const [favorites, setFavorites] = useState<string[]>([]);
  useEffect(() => {
    setFavorites(read());
    const sync = () => setFavorites(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const toggle = useCallback((id: string) => {
    const cur = read();
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [id, ...cur].slice(0, 60);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
    setFavorites(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return { favorites, isFavorite: (id) => favorites.includes(id), toggle };
}
