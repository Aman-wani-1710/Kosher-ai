// App-wide language context. One tap toggles the whole UI between Kashmiri (ks)
// and English (en). Strings come from src/lib/ks.ts with English overrides in en.ts.
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

import { devStrings, type DevLang } from "@/src/lib/en";
import { type KS } from "@/src/lib/ks";
import { storage } from "@/src/utils/storage";

export type Strings = KS & { translate: string };
const LANG_KEY = "app_lang";

type LangState = {
  lang: DevLang;
  t: Strings;
  setLang: (l: DevLang) => void;
  toggle: () => void;
};

const LangContext = createContext<LangState>({
  lang: "ks",
  t: devStrings("ks"),
  setLang: () => {},
  toggle: () => {},
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<DevLang>("ks");

  useEffect(() => {
    storage.getItem<DevLang>(LANG_KEY, "ks").then((v) => {
      if (v === "en" || v === "ks") setLangState(v);
    });
  }, []);

  const setLang = useCallback((l: DevLang) => {
    setLangState(l);
    void storage.setItem(LANG_KEY, l);
  }, []);

  const toggle = useCallback(() => {
    setLangState((prev) => {
      const next: DevLang = prev === "en" ? "ks" : "en";
      void storage.setItem(LANG_KEY, next);
      return next;
    });
  }, []);

  return (
    <LangContext.Provider value={{ lang, t: devStrings(lang), setLang, toggle }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang(): LangState {
  return useContext(LangContext);
}

export function useT(): Strings {
  return useContext(LangContext).t;
}
