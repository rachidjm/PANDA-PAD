import { docRead, docUpdate } from "@/lib/storage/store";
import { canTransitionTheme, newTheme, NewThemeInput, Theme, ThemeStatus, validateNewTheme } from "./theme";

/** Storage for themes (server only): one index document, updated atomically. */

const PATH = "themes/index.json";
type ThemesDoc = { version: 1; themes: Theme[] };
const EMPTY: ThemesDoc = { version: 1, themes: [] };

export async function listThemes(): Promise<Theme[]> {
  return (await docRead<ThemesDoc>(PATH, EMPTY)).themes;
}

export async function getThemeBySlug(slug: string): Promise<Theme | null> {
  return (await listThemes()).find((t) => t.slug === slug) ?? null;
}

export async function getThemeById(id: number): Promise<Theme | null> {
  return (await listThemes()).find((t) => t.themeId === id) ?? null;
}

export async function createTheme(input: NewThemeInput, now: number): Promise<{ ok: true; theme: Theme } | { ok: false; error: string }> {
  return docUpdate<ThemesDoc, { ok: true; theme: Theme } | { ok: false; error: string }>(PATH, EMPTY, (doc) => {
    const error = validateNewTheme(input, doc.themes, now);
    if (error) return { next: doc, result: { ok: false, error } };
    const theme = newTheme(input, doc.themes, now);
    return { next: { ...doc, themes: [...doc.themes, theme] }, result: { ok: true, theme } };
  });
}

export type ThemeTransition = { ok: true; before: Theme; after: Theme } | { ok: false; error: string };

export async function transitionTheme(themeId: number, to: ThemeStatus, now: number): Promise<ThemeTransition> {
  return docUpdate<ThemesDoc, ThemeTransition>(PATH, EMPTY, (doc) => {
    const before = doc.themes.find((t) => t.themeId === themeId);
    if (!before) return { next: doc, result: { ok: false, error: "No such theme." } };
    const check = canTransitionTheme(before, to, now);
    if (!check.ok) return { next: doc, result: { ok: false, error: check.reason } };
    const after: Theme = { ...before, status: to, updatedAt: now };
    return { next: { ...doc, themes: doc.themes.map((t) => (t.themeId === themeId ? after : t)) }, result: { ok: true, before, after } };
  });
}
