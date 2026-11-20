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
  chatOrder?: number[];
  upsellOrder?: string[];
  productOrder?: string[];
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
      chatOrder?: number[];
      upsellOrder?: string[];
      productOrder?: string[];
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
      chatOrder: Array.isArray(parsed.chatOrder) ? parsed.chatOrder : undefined,
      upsellOrder: Array.isArray(parsed.upsellOrder) ? parsed.upsellOrder : undefined,
      productOrder: Array.isArray(parsed.productOrder) ? parsed.productOrder : undefined,
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

export function getOrderedChatIndices(overrides: ScriptOverrides): number[] {
  const all = CHAT_SCRIPTS.map((_, idx) => idx);
  if (!overrides.chatOrder || overrides.chatOrder.length === 0) return all;
  const seen = new Set<number>();
  const valid: number[] = [];
  for (const idx of overrides.chatOrder) {
    if (Number.isInteger(idx) && idx >= 0 && idx < CHAT_SCRIPTS.length && !seen.has(idx)) {
      seen.add(idx);
      valid.push(idx);
    }
  }
  for (const idx of all) {
    if (!seen.has(idx)) valid.push(idx);
  }
  return valid;
}

export function getOrderedUpsellIds(overrides: ScriptOverrides): string[] {
  const all = UPSELL_OPTIONS.map((u) => u.id);
  if (!overrides.upsellOrder || overrides.upsellOrder.length === 0) return all;
  const validSet = new Set(all);
  const seen = new Set<string>();
  const valid: string[] = [];
  for (const id of overrides.upsellOrder) {
    if (validSet.has(id) && !seen.has(id)) {
      seen.add(id);
      valid.push(id);
    }
  }
  for (const id of all) {
    if (!seen.has(id)) valid.push(id);
  }
  return valid;
}

export function getOrderedProductIds(overrides: ScriptOverrides): string[] {
  const all = PRODUCT_SETS.map((p) => p.id);
  if (!overrides.productOrder || overrides.productOrder.length === 0) return all;
  const validSet = new Set(all);
  const seen = new Set<string>();
  const valid: string[] = [];
  for (const id of overrides.productOrder) {
    if (validSet.has(id) && !seen.has(id)) {
      seen.add(id);
      valid.push(id);
    }
  }
  for (const id of all) {
    if (!seen.has(id)) valid.push(id);
  }
  return valid;
}

export function moveItemByKey<T>(order: T[], fromKey: T, toKey: T): T[] {
  if (fromKey === toKey) return order;
  const fromIdx = order.indexOf(fromKey);
  const toIdx = order.indexOf(toKey);
  if (fromIdx === -1 || toIdx === -1) return order;
  const next = [...order];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next;
}

export function stepItemInOrder<T>(
  fullOrder: T[],
  visibleKeys: T[],
  key: T,
  direction: 'up' | 'down'
): T[] {
  const visIdx = visibleKeys.indexOf(key);
  if (visIdx === -1) return fullOrder;
  const neighborVisIdx = direction === 'up' ? visIdx - 1 : visIdx + 1;
  if (neighborVisIdx < 0 || neighborVisIdx >= visibleKeys.length) return fullOrder;
  const targetKey = visibleKeys[neighborVisIdx];
  return moveItemByKey(fullOrder, key, targetKey);
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
