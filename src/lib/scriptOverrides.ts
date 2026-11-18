import {
  CHAT_SCRIPTS,
  PRODUCT_SETS,
  UPSELL_OPTIONS,
} from '@/src/data/playbookData';

export const SCRIPT_OVERRIDES_KEY = 'chatcraft_script_overrides_v1';

export interface ChatScriptOverride {
  title?: string;
  category?: string;
  text?: string;
}

export interface CustomChatScript {
  id: string;
  title: string;
  category: string;
  text: string;
}

export interface UpsellOverride {
  title?: string;
  script?: string;
  priceText?: string;
  bestFor?: string;
}

export interface ProductOverride {
  code?: string;
  name?: string;
  price?: number;
  occasions?: string;
}

export interface ScriptOverrides {
  chat: Record<string, ChatScriptOverride>;
  customChat: CustomChatScript[];
  upsell: Record<string, UpsellOverride>;
  products: Record<string, ProductOverride>;
  playbookScriptsHeading?: string;
}

export function parseStoredOverrides(): ScriptOverrides {
  const empty: ScriptOverrides = { chat: {}, customChat: [], upsell: {}, products: {} };
  try {
    const raw = localStorage.getItem(SCRIPT_OVERRIDES_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as {
      chat?: Record<string, string | ChatScriptOverride>;
      customChat?: CustomChatScript[];
      upsell?: Record<string, string | UpsellOverride>;
      products?: Record<string, ProductOverride>;
      playbookScriptsHeading?: string;
    };
    const chat: Record<string, ChatScriptOverride> = {};
    if (parsed.chat) {
      for (const [k, v] of Object.entries(parsed.chat)) {
        chat[k] = typeof v === 'string' ? { text: v } : v;
      }
    }
    const upsell: Record<string, UpsellOverride> = {};
    if (parsed.upsell) {
      for (const [k, v] of Object.entries(parsed.upsell)) {
        upsell[k] = typeof v === 'string' ? { script: v } : v;
      }
    }
    return {
      chat,
      customChat: Array.isArray(parsed.customChat) ? parsed.customChat : [],
      upsell,
      products: parsed.products ?? {},
      playbookScriptsHeading: parsed.playbookScriptsHeading,
    };
  } catch {
    return empty;
  }
}

export function saveStoredOverrides(overrides: ScriptOverrides): void {
  try {
    localStorage.setItem(SCRIPT_OVERRIDES_KEY, JSON.stringify(overrides));
  } catch {
    // Ignore storage errors
  }
}

export function resolveChatScript(overrides: ScriptOverrides, index: number) {
  const base = CHAT_SCRIPTS[index];
  const ov = overrides.chat[String(index)];
  return {
    title: ov?.title ?? base.title,
    category: ov?.category ?? base.category,
    text: ov?.text ?? base.text,
  };
}

export function resolveUpsellOption(overrides: ScriptOverrides, id: string) {
  const base = UPSELL_OPTIONS.find((u) => u.id === id);
  const ov = overrides.upsell[id];
  return {
    title: ov?.title ?? base?.title ?? '',
    script: ov?.script ?? base?.script ?? '',
    priceText: ov?.priceText ?? base?.priceText ?? '',
    bestFor: ov?.bestFor ?? base?.bestFor ?? '',
  };
}

export function resolveProductInfo(overrides: ScriptOverrides, id: string) {
  const base = PRODUCT_SETS.find((p) => p.id === id);
  const ov = overrides.products[id];
  return {
    code: ov?.code ?? base?.code ?? '',
    name: ov?.name ?? base?.name ?? '',
    price: ov?.price ?? base?.price ?? 0,
    occasions: ov?.occasions ?? (base ? base.occasions.join(', ') : ''),
  };
}
