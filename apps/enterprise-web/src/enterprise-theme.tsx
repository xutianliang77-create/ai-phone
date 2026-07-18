import { createContext, useContext, useLayoutEffect, useMemo, useState } from "react";

export type EnterpriseThemePreference = "system" | "light" | "dark";

interface EnterpriseThemeContextValue {
  preference: EnterpriseThemePreference;
  setPreference(value: EnterpriseThemePreference): void;
}

const storageKey = "wujie.enterprise.theme.v1";
const EnterpriseThemeContext = createContext<EnterpriseThemeContextValue>({
  preference: "system",
  setPreference() {},
});

export function EnterpriseThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreference] = useState<EnterpriseThemePreference>(readPreference);

  useLayoutEffect(() => {
    const media = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)") : undefined;
    const legacyMedia = media as unknown as {
      addListener?(listener: () => void): void;
      removeListener?(listener: () => void): void;
    } | undefined;
    const apply = () => {
      document.documentElement.dataset.theme = preference === "system"
        ? (media?.matches ? "dark" : "light")
        : preference;
      document.documentElement.style.colorScheme =
        document.documentElement.dataset.theme ?? "light";
    };
    apply();
    if (typeof media?.addEventListener === "function") media.addEventListener("change", apply);
    else legacyMedia?.addListener?.(apply);
    try { window.localStorage.setItem(storageKey, preference); } catch {}
    return () => {
      if (typeof media?.removeEventListener === "function") media.removeEventListener("change", apply);
      else legacyMedia?.removeListener?.(apply);
    };
  }, [preference]);

  const value = useMemo(() => ({ preference, setPreference }), [preference]);
  return <EnterpriseThemeContext.Provider value={value}>
    {children}
  </EnterpriseThemeContext.Provider>;
}

export function useEnterpriseTheme() {
  return useContext(EnterpriseThemeContext);
}

function readPreference(): EnterpriseThemePreference {
  try {
    const value = window.localStorage.getItem(storageKey);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}
