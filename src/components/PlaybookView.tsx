import { useEffect, useState } from 'react';
import { Copy, Check, AlertCircle, Pencil, RotateCcw, Plus, Trash2, ArrowUp, ArrowDown, GripVertical } from 'lucide-react';
import {
  SALES_STAGES,
  PRODUCT_SETS,
  INDIVIDUAL_FRUITS,
  UPSELL_OPTIONS,
  CHAT_SCRIPTS,
  SHIFT_WORKFLOWS,
} from '@/src/data/playbookData';
import { PRODUCT_IMAGE_MAP } from '@/src/data/productImages';
import {
  getOrderedChatIndices,
  getOrderedProductIds,
  getOrderedUpsellIds,
  moveItemByKey,
  parseStoredOverrides,
  resolveChatScript,
  resolveProductInfo,
  resolveUpsellOption,
  saveStoredOverrides,
  stepItemInOrder,
  type CustomChatScript,
  type ScriptOverrides,
} from '@/src/lib/scriptOverrides';

const DEFAULT_SCRIPTS_HEADING = 'คลังสคริปต์ Upsell และสคริปต์แชท';

export function PlaybookView() {
  const [search, setSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<ScriptOverrides>(parseStoredOverrides);

  const [isEditingHeading, setIsEditingHeading] = useState(false);
  const [headingDraft, setHeadingDraft] = useState('');

  const [editingItem, setEditingItem] = useState<{
    kind: 'upsell' | 'chat' | 'customChat' | 'product';
    key: string;
  } | null>(null);
  const [itemDraft, setItemDraft] = useState({
    title: '',
    category: '',
    priceText: '',
    bestFor: '',
    text: '',
    code: '',
    name: '',
    price: '',
    occasions: '',
  });

  const [isAddingCustom, setIsAddingCustom] = useState(false);
  const [newCustomDraft, setNewCustomDraft] = useState({
    title: '',
    category: 'กำหนดเอง',
    text: '',
  });
  const [dragItem, setDragItem] = useState<{
    kind: 'upsell' | 'customChat' | 'chat';
    key: string;
  } | null>(null);
  const [dragOverItem, setDragOverItem] = useState<{
    kind: 'upsell' | 'customChat' | 'chat';
    key: string;
  } | null>(null);

  useEffect(() => {
    saveStoredOverrides(overrides);
  }, [overrides]);

  const handleCopy = (id: string, text: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const scriptsHeading = overrides.playbookScriptsHeading ?? DEFAULT_SCRIPTS_HEADING;

  const startEditHeading = () => {
    setHeadingDraft(scriptsHeading);
    setIsEditingHeading(true);
  };

  const saveHeading = () => {
    const next = headingDraft.trim();
    setOverrides((prev) => ({
      ...prev,
      playbookScriptsHeading: !next || next === DEFAULT_SCRIPTS_HEADING ? undefined : next,
    }));
    setIsEditingHeading(false);
  };

  const startEditItem = (kind: 'upsell' | 'chat' | 'customChat' | 'product', key: string) => {
    if (kind === 'upsell') {
      const r = resolveUpsellOption(overrides, key);
      setItemDraft({
        title: r.title,
        category: '',
        priceText: r.priceText,
        bestFor: r.bestFor,
        text: r.script,
        code: '',
        name: '',
        price: '',
        occasions: '',
      });
    } else if (kind === 'chat') {
      const r = resolveChatScript(overrides, Number(key));
      setItemDraft({
        title: r.title,
        category: r.category,
        priceText: '',
        bestFor: '',
        text: r.text,
        code: '',
        name: '',
        price: '',
        occasions: '',
      });
    } else if (kind === 'customChat') {
      const c = overrides.customChat.find((item) => item.id === key);
      if (!c) return;
      setItemDraft({
        title: c.title,
        category: c.category,
        priceText: '',
        bestFor: '',
        text: c.text,
        code: '',
        name: '',
        price: '',
        occasions: '',
      });
    } else {
      const p = resolveProductInfo(overrides, key);
      setItemDraft({
        title: '',
        category: '',
        priceText: '',
        bestFor: '',
        text: '',
        code: p.code,
        name: p.name,
        price: String(p.price),
        occasions: p.occasions,
      });
    }
    setEditingItem({ kind, key });
  };

  const saveEditItem = () => {
    if (!editingItem) return;
    setOverrides((prev) => {
      if (editingItem.kind === 'upsell') {
        const base = UPSELL_OPTIONS.find((u) => u.id === editingItem.key);
        if (!base) return prev;
        const title = itemDraft.title.trim() || base.title;
        const priceText = itemDraft.priceText.trim() || base.priceText;
        const bestFor = itemDraft.bestFor.trim() || base.bestFor;
        const script = itemDraft.text.trim() || base.script;
        const nextUpsell = { ...prev.upsell };
        if (
          title === base.title &&
          priceText === base.priceText &&
          bestFor === base.bestFor &&
          script === base.script
        ) {
          delete nextUpsell[editingItem.key];
        } else {
          nextUpsell[editingItem.key] = {
            ...(title !== base.title ? { title } : {}),
            ...(priceText !== base.priceText ? { priceText } : {}),
            ...(bestFor !== base.bestFor ? { bestFor } : {}),
            ...(script !== base.script ? { script } : {}),
          };
        }
        return { ...prev, upsell: nextUpsell };
      }

      if (editingItem.kind === 'chat') {
        const base = CHAT_SCRIPTS[Number(editingItem.key)];
        const title = itemDraft.title.trim() || base.title;
        const category = itemDraft.category.trim() || base.category;
        const text = itemDraft.text.trim() || base.text;
        const nextChat = { ...prev.chat };
        if (title === base.title && category === base.category && text === base.text) {
          delete nextChat[editingItem.key];
        } else {
          nextChat[editingItem.key] = {
            ...(title !== base.title ? { title } : {}),
            ...(category !== base.category ? { category } : {}),
            ...(text !== base.text ? { text } : {}),
          };
        }
        return { ...prev, chat: nextChat };
      }

      if (editingItem.kind === 'customChat') {
        return {
          ...prev,
          customChat: prev.customChat.map((c) =>
            c.id === editingItem.key
              ? {
                  ...c,
                  title: itemDraft.title.trim() || c.title,
                  category: itemDraft.category.trim() || 'กำหนดเอง',
                  text: itemDraft.text.trim() || c.text,
                }
              : c
          ),
        };
      }

      const baseProd = PRODUCT_SETS.find((p) => p.id === editingItem.key);
      if (!baseProd) return prev;
      const baseOccasions = baseProd.occasions.join(', ');
      const code = itemDraft.code.trim() || baseProd.code;
      const name = itemDraft.name.trim() || baseProd.name;
      const parsedPrice = Number(itemDraft.price);
      const price = Number.isFinite(parsedPrice) && parsedPrice >= 0 ? parsedPrice : baseProd.price;
      const occasions = itemDraft.occasions.trim() || baseOccasions;
      const nextProducts = { ...prev.products };
      if (
        code === baseProd.code &&
        name === baseProd.name &&
        price === baseProd.price &&
        occasions === baseOccasions
      ) {
        delete nextProducts[editingItem.key];
      } else {
        nextProducts[editingItem.key] = {
          ...(code !== baseProd.code ? { code } : {}),
          ...(name !== baseProd.name ? { name } : {}),
          ...(price !== baseProd.price ? { price } : {}),
          ...(occasions !== baseOccasions ? { occasions } : {}),
        };
      }
      return { ...prev, products: nextProducts };
    });
    setEditingItem(null);
  };

  const resetItemOverride = (kind: 'upsell' | 'chat' | 'product', key: string) => {
    setOverrides((prev) => {
      if (kind === 'upsell') {
        const nextUpsell = { ...prev.upsell };
        delete nextUpsell[key];
        return { ...prev, upsell: nextUpsell };
      }
      if (kind === 'chat') {
        const nextChat = { ...prev.chat };
        delete nextChat[key];
        return { ...prev, chat: nextChat };
      }
      const nextProducts = { ...prev.products };
      delete nextProducts[key];
      return { ...prev, products: nextProducts };
    });
    setEditingItem(null);
  };

  const handleAddCustom = () => {
    const title = newCustomDraft.title.trim();
    const text = newCustomDraft.text.trim();
    if (!title || !text) return;
    const item: CustomChatScript = {
      id: `custom_${Date.now()}`,
      title,
      category: newCustomDraft.category.trim() || 'กำหนดเอง',
      text,
    };
    setOverrides((prev) => ({ ...prev, customChat: [item, ...prev.customChat] }));
    setNewCustomDraft({ title: '', category: 'กำหนดเอง', text: '' });
    setIsAddingCustom(false);
  };

  const deleteCustom = (id: string) => {
    setOverrides((prev) => ({
      ...prev,
      customChat: prev.customChat.filter((c) => c.id !== id),
    }));
    if (editingItem?.kind === 'customChat' && editingItem.key === id) {
      setEditingItem(null);
    }
  };

  const orderedProductIds = getOrderedProductIds(overrides);
  const orderedUpsellIds = getOrderedUpsellIds(overrides);
  const orderedChatIndices = getOrderedChatIndices(overrides);

  const movePlaybookItem = (
    kind: 'upsell' | 'customChat' | 'chat',
    key: string,
    direction: 'up' | 'down'
  ) => {
    setOverrides((prev) => {
      if (kind === 'customChat') {
        const keys = prev.customChat.map((c) => c.id);
        const nextKeys = stepItemInOrder(keys, keys, key, direction);
        const byId = new Map(prev.customChat.map((c) => [c.id, c]));
        return { ...prev, customChat: nextKeys.map((id) => byId.get(id)!).filter(Boolean) };
      }
      if (kind === 'upsell') {
        const order = getOrderedUpsellIds(prev);
        return { ...prev, upsellOrder: stepItemInOrder(order, order, key, direction) };
      }
      const order = getOrderedChatIndices(prev);
      return { ...prev, chatOrder: stepItemInOrder(order, order, Number(key), direction) };
    });
  };

  const dropPlaybookItem = (kind: 'upsell' | 'customChat' | 'chat', targetKey: string) => {
    if (!dragItem || dragItem.kind !== kind || dragItem.key === targetKey) {
      setDragItem(null);
      setDragOverItem(null);
      return;
    }
    const sourceKey = dragItem.key;
    setOverrides((prev) => {
      if (kind === 'customChat') {
        const keys = prev.customChat.map((c) => c.id);
        const nextKeys = moveItemByKey(keys, sourceKey, targetKey);
        const byId = new Map(prev.customChat.map((c) => [c.id, c]));
        return { ...prev, customChat: nextKeys.map((id) => byId.get(id)!).filter(Boolean) };
      }
      if (kind === 'upsell') {
        const order = getOrderedUpsellIds(prev);
        return { ...prev, upsellOrder: moveItemByKey(order, sourceKey, targetKey) };
      }
      const order = getOrderedChatIndices(prev);
      return { ...prev, chatOrder: moveItemByKey(order, Number(sourceKey), Number(targetKey)) };
    });
    setDragItem(null);
    setDragOverItem(null);
  };

  const filteredProducts = orderedProductIds
    .map((id) => PRODUCT_SETS.find((p) => p.id === id))
    .filter((p): p is (typeof PRODUCT_SETS)[number] => {
      if (!p) return false;
      const resolved = resolveProductInfo(overrides, p.id);
      const q = search.toLowerCase();
      return (
        resolved.name.toLowerCase().includes(q) ||
        resolved.code.toLowerCase().includes(q) ||
        p.fruits.some((f) => f.toLowerCase().includes(q)) ||
        resolved.occasions.toLowerCase().includes(q)
      );
    });

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-8 space-y-10">
      {/* Intro & Search */}
      <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            คู่มือการขาย สินค้า และกฎปฏิบัติงาน (Admin Sale Playbook)
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
            รวม Flow 6 ขั้นตอน, ราคาเซตกระเช้า, เกณฑ์ค่าจัดส่ง, สคริปต์ Upsell และวิธีส่งต่อออเดอร์ตามกะ
          </p>
        </div>
        <div className="w-full sm:w-72">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อเซต ผลไม้ หรือโอกาสใช้งาน..."
            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-emerald-600 focus:outline-none"
          />
        </div>
      </section>

      {/* 1. Golden Rule + 6-Step Flow */}
      <section className="space-y-4">
        <div className="p-5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/70">
          <div className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
            กฎเหล็กของการแชท
          </div>
          <p className="text-base font-bold text-slate-900 dark:text-slate-100 mt-1">
            “ทุกขั้นตอนของการคุยกับลูกค้า ต้องทิ้งคำถามไว้ให้ลูกค้าตอบเสมอ เพื่อรักษาบทสนทนาไว้”
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {SALES_STAGES.map((stage) => (
            <div
              key={stage.key}
              className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1.5"
            >
              <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 font-mono-num">
                ขั้นตอนที่ {stage.step}
              </div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">{stage.label}</h2>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {stage.shortDesc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* 2. Product Catalog */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
            รายการเซตผลไม้พรีเมียมและส่วนประกอบ
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">
            {filteredProducts.length} รายการ
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredProducts.map((prod) => {
            const resolved = resolveProductInfo(overrides, prod.id);
            const isEditing = editingItem?.kind === 'product' && editingItem.key === prod.id;
            const isOverridden = overrides.products[prod.id] !== undefined;
            return (
              <article
                key={prod.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden flex flex-col sm:flex-row"
              >
                <div className="sm:w-44 h-44 sm:h-auto shrink-0 bg-slate-100 dark:bg-slate-800 relative">
                  {prod.imageKey ? (
                    <img
                      src={PRODUCT_IMAGE_MAP[prod.imageKey]}
                      alt={`${resolved.code} ${resolved.name}`}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-emerald-50 to-slate-100 dark:from-emerald-950/50 dark:to-slate-900 flex items-center justify-center p-4 text-center text-xs font-semibold text-slate-600 dark:text-slate-300">
                      {resolved.code}
                    </div>
                  )}
                </div>

                <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                  {isEditing ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <input
                          type="text"
                          value={itemDraft.code}
                          onChange={(e) => setItemDraft((d) => ({ ...d, code: e.target.value }))}
                          aria-label="แก้ไขรหัสเซต"
                          placeholder="รหัสเซต"
                          className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:outline-none"
                        />
                        <input
                          type="text"
                          value={itemDraft.name}
                          onChange={(e) => setItemDraft((d) => ({ ...d, name: e.target.value }))}
                          aria-label="แก้ไขชื่อเซต"
                          placeholder="ชื่อเซต"
                          className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:outline-none"
                        />
                        <input
                          type="number"
                          min={0}
                          value={itemDraft.price}
                          onChange={(e) => setItemDraft((d) => ({ ...d, price: e.target.value }))}
                          aria-label="แก้ไขราคา"
                          placeholder="ราคา (บาท)"
                          className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-mono-num text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:outline-none"
                        />
                      </div>
                      <input
                        type="text"
                        value={itemDraft.occasions}
                        onChange={(e) => setItemDraft((d) => ({ ...d, occasions: e.target.value }))}
                        aria-label="แก้ไขโอกาสใช้งาน"
                        placeholder="โอกาสใช้งาน (คั่นด้วยจุลภาค)"
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:outline-none"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={saveEditItem}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer"
                        >
                          <Check className="w-3 h-3" />
                          บันทึก
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingItem(null)}
                          className="px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                        >
                          ยกเลิก
                        </button>
                        {isOverridden && (
                          <button
                            type="button"
                            onClick={() => resetItemOverride('product', prod.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                          >
                            <RotateCcw className="w-3 h-3" />
                            คืนค่าเดิม
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                            {resolved.code}
                          </div>
                          <h3
                            onClick={() => startEditItem('product', prod.id)}
                            title="คลิกเพื่อแก้ไข"
                            className="text-base font-bold text-slate-900 dark:text-slate-100 hover:text-emerald-700 dark:hover:text-emerald-400 cursor-pointer"
                          >
                            {resolved.name}
                          </h3>
                        </div>
                        <div className="flex items-start gap-2.5 shrink-0">
                          <div className="text-right">
                            <div className="text-base font-bold font-mono-num text-emerald-700 dark:text-emerald-400">
                              {resolved.price.toLocaleString()} บ.
                            </div>
                            {prod.originalPrice && (
                              <div className="text-xs font-mono-num text-slate-400 dark:text-slate-500 line-through">
                                {prod.originalPrice.toLocaleString()} บ.
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => startEditItem('product', prod.id)}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer mt-0.5"
                          >
                            <Pencil className="w-3 h-3" />
                            แก้ไข
                          </button>
                        </div>
                      </div>

                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {prod.boxColor} · เหมาะสำหรับ: {resolved.occasions}
                      </div>

                      <p className="text-xs text-slate-700 dark:text-slate-300 mt-2 leading-relaxed">
                        {prod.fruits.join(' · ')}
                      </p>
                    </div>
                  )}

                  {prod.hasSeasonalRisk && prod.seasonalNote && (
                    <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <span>{prod.seasonalNote}</span>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* 3. Individual Fruit Pricing + Shipping Matrix */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            ตารางราคาผลไม้ปลีก (สำหรับปรับ/ทดแทน)
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2 font-semibold">ผลไม้</th>
                  <th className="py-2 font-semibold">หน่วย</th>
                  <th className="py-2 font-semibold">แหล่งที่มา</th>
                  <th className="py-2 font-semibold text-right">ราคา (บาท)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {INDIVIDUAL_FRUITS.map((f) => (
                  <tr key={f.name}>
                    <td className="py-2.5 font-medium text-slate-900 dark:text-slate-100">{f.name}</td>
                    <td className="py-2.5 text-slate-600 dark:text-slate-300">{f.unit}</td>
                    <td className="py-2.5 text-slate-500 dark:text-slate-400">{f.origin}</td>
                    <td className="py-2.5 font-mono-num font-semibold text-slate-900 dark:text-slate-100 text-right">
                      {f.price}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            เกณฑ์ค่าจัดส่งและข้อควรระวัง
          </h2>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <th className="py-2 font-semibold">ระยะทาง / ช่องทาง</th>
                <th className="py-2 font-semibold">ค่าส่ง</th>
                <th className="py-2 font-semibold">เงื่อนไขส่งฟรี / รอบส่ง</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              <tr>
                <td className="py-2.5 font-medium text-slate-900 dark:text-slate-100">1–10 กม.</td>
                <td className="py-2.5 font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                  59 บ.
                </td>
                <td className="py-2.5 text-slate-600 dark:text-slate-300">
                  ฟรีเมื่อยอด 1,500+ บ. (ถึงใน 1–1.5 ชม.)
                </td>
              </tr>
              <tr>
                <td className="py-2.5 font-medium text-slate-900 dark:text-slate-100">11–25 กม.</td>
                <td className="py-2.5 font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                  159 บ.
                </td>
                <td className="py-2.5 text-slate-600 dark:text-slate-300">
                  ฟรีเมื่อยอด 4,000+ บ. (ถึงใน 2–2.5 ชม.)
                </td>
              </tr>
              <tr>
                <td className="py-2.5 font-medium text-slate-900 dark:text-slate-100">เกิน 25 กม.</td>
                <td className="py-2.5 font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                  159 + 10/กม.
                </td>
                <td className="py-2.5 text-slate-600 dark:text-slate-300">
                  บวกเพิ่มกม.ละ 10 บ. (ถึงใน 3 ชม.)
                </td>
              </tr>
              <tr>
                <td className="py-2.5 font-medium text-slate-900 dark:text-slate-100">
                  ต่างจังหวัด Inter Express
                </td>
                <td className="py-2.5 font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                  450 บ./ชิ้น
                </td>
                <td className="py-2.5 text-slate-600 dark:text-slate-300">
                  รถห้องเย็น นับถอยหลัง 3 วัน ตัดรอบก่อน 12.00 น. งดวิ่งวันเสาร์
                </td>
              </tr>
            </tbody>
          </table>

          <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300 list-disc pl-4 pt-2 border-t border-slate-200 dark:border-slate-800">
            <li>เคสด่วนน้อยกว่า 2 ชม. หรือชุดส่งด่วน 1–1.5 ชม.: ประสานทีม OP ก่อนรับปากทุกครั้ง</li>
            <li>ส่งโรงพยาบาล: ต้องขอเบอร์ติดต่อญาติผู้ป่วยเสมอ</li>
            <li>ส่ง URL Payment: ห้ามเว้นวรรคและห้ามใส่อีโมจิในลิงก์</li>
            <li>การเก็บรักษา: แช่ตู้เย็น 1–5°C ไม่วางในห้องแอร์เกิน 3–4 ชั่วโมง</li>
          </ul>
        </div>
      </section>

      {/* 4. Shift Workflows */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
          ขั้นตอนรับและส่งต่อออเดอร์ตามช่วงเวลา (Shift)
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {SHIFT_WORKFLOWS.map((wf) => (
            <div
              key={wf.shift}
              className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2"
            >
              <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                {wf.shift}
              </div>
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{wf.label}</div>
              <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300 list-disc pl-4 leading-relaxed">
                {wf.steps.map((s, idx) => (
                  <li key={idx}>{s}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* 5. Upsell & Chat Scripts */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex flex-wrap items-center justify-between gap-2">
          {isEditingHeading ? (
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto flex-1">
              <input
                type="text"
                value={headingDraft}
                onChange={(e) => setHeadingDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveHeading();
                  if (e.key === 'Escape') setIsEditingHeading(false);
                }}
                aria-label="แก้ไขหัวข้อคลังสคริปต์"
                className="flex-1 min-w-[240px] rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-bold text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:outline-none"
              />
              <button
                type="button"
                onClick={saveHeading}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                บันทึก
              </button>
              <button
                type="button"
                onClick={() => setIsEditingHeading(false)}
                className="px-2.5 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
              >
                ยกเลิก
              </button>
              {overrides.playbookScriptsHeading && (
                <button
                  type="button"
                  onClick={() => {
                    setOverrides((prev) => ({ ...prev, playbookScriptsHeading: undefined }));
                    setIsEditingHeading(false);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  คืนค่าเดิม
                </button>
              )}
            </div>
          ) : (
            <span className="inline-flex items-center gap-2">
              <span
                onClick={startEditHeading}
                title="คลิกเพื่อแก้ไขหัวข้อ"
                className="hover:text-emerald-700 dark:hover:text-emerald-400 cursor-pointer"
              >
                {scriptsHeading}
              </span>
              <button
                type="button"
                onClick={startEditHeading}
                aria-label="แก้ไขหัวข้อคลังสคริปต์"
                className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </span>
          )}

          <button
            type="button"
            onClick={() => setIsAddingCustom((v) => !v)}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 rounded-lg transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            เพิ่มสคริปต์ใหม่
          </button>
        </h2>

        {isAddingCustom && (
          <div className="p-4 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                type="text"
                value={newCustomDraft.title}
                onChange={(e) => setNewCustomDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="ชื่อสคริปต์ใหม่"
                aria-label="ชื่อสคริปต์ใหม่"
                className="sm:col-span-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:outline-none"
              />
              <input
                type="text"
                value={newCustomDraft.category}
                onChange={(e) => setNewCustomDraft((d) => ({ ...d, category: e.target.value }))}
                placeholder="หมวดหมู่"
                aria-label="หมวดหมู่สคริปต์ใหม่"
                className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:outline-none"
              />
            </div>
            <textarea
              rows={3}
              value={newCustomDraft.text}
              onChange={(e) => setNewCustomDraft((d) => ({ ...d, text: e.target.value }))}
              placeholder="พิมพ์ข้อความสคริปต์..."
              aria-label="ข้อความสคริปต์ใหม่"
              className="w-full resize-y rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:outline-none"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAddCustom}
                disabled={!newCustomDraft.title.trim() || !newCustomDraft.text.trim()}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 rounded-md cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                บันทึกสคริปต์ใหม่
              </button>
              <button
                type="button"
                onClick={() => setIsAddingCustom(false)}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {orderedUpsellIds.map((upId, posIdx) => {
            const resolved = resolveUpsellOption(overrides, upId);
            const isEditing = editingItem?.kind === 'upsell' && editingItem.key === upId;
            const isOverridden = overrides.upsell[upId] !== undefined;
            const isDragging = dragItem?.kind === 'upsell' && dragItem.key === upId;
            const isDropTarget =
              dragOverItem?.kind === 'upsell' &&
              dragOverItem.key === upId &&
              dragItem?.key !== upId;
            return (
              <div
                key={upId}
                draggable={!isEditing}
                onDragStart={() => setDragItem({ kind: 'upsell', key: upId })}
                onDragOver={(e) => {
                  if (dragItem?.kind === 'upsell') {
                    e.preventDefault();
                    setDragOverItem({ kind: 'upsell', key: upId });
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  dropPlaybookItem('upsell', upId);
                }}
                onDragEnd={() => {
                  setDragItem(null);
                  setDragOverItem(null);
                }}
                className={`p-4 rounded-xl bg-white dark:bg-slate-900 border space-y-2 transition-all ${
                  isDropTarget
                    ? 'border-emerald-500 ring-2 ring-emerald-500/40'
                    : 'border-slate-200 dark:border-slate-800'
                } ${isDragging ? 'opacity-50' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <span
                      title="ลากเพื่อย้ายตำแหน่ง"
                      className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing mt-0.5 shrink-0"
                    >
                      <GripVertical className="w-4 h-4" />
                    </span>
                    <div className="min-w-0">
                      <h3
                        onClick={() => startEditItem('upsell', upId)}
                        title="คลิกเพื่อแก้ไข"
                        className="text-sm font-bold text-slate-900 dark:text-slate-100 hover:text-emerald-700 dark:hover:text-emerald-400 cursor-pointer"
                      >
                        {resolved.title}
                      </h3>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {resolved.priceText} · {resolved.bestFor}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={posIdx === 0}
                      onClick={() => movePlaybookItem('upsell', upId, 'up')}
                      aria-label={`ย้ายขึ้น: ${resolved.title}`}
                      title="ย้ายขึ้น"
                      className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 cursor-pointer disabled:cursor-default"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={posIdx === orderedUpsellIds.length - 1}
                      onClick={() => movePlaybookItem('upsell', upId, 'down')}
                      aria-label={`ย้ายลง: ${resolved.title}`}
                      title="ย้ายลง"
                      className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 cursor-pointer disabled:cursor-default"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => startEditItem('upsell', upId)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      แก้ไข
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopy(upId, resolved.script)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 cursor-pointer"
                    >
                      {copiedId === upId ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedId === upId ? 'คัดลอกแล้ว' : 'คัดลอก'}
                    </button>
                  </div>
                </div>
                {isEditing ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={itemDraft.title}
                      onChange={(e) => setItemDraft((d) => ({ ...d, title: e.target.value }))}
                      aria-label={`แก้ไขชื่อ Upsell: ${resolved.title}`}
                      placeholder="ชื่อโปร Upsell"
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:outline-none"
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={itemDraft.priceText}
                        onChange={(e) => setItemDraft((d) => ({ ...d, priceText: e.target.value }))}
                        aria-label="แก้ไขราคา Upsell"
                        placeholder="ราคา"
                        className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:outline-none"
                      />
                      <input
                        type="text"
                        value={itemDraft.bestFor}
                        onChange={(e) => setItemDraft((d) => ({ ...d, bestFor: e.target.value }))}
                        aria-label="แก้ไขโอกาสที่เหมาะ"
                        placeholder="เหมาะสำหรับ"
                        className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:outline-none"
                      />
                    </div>
                    <textarea
                      rows={4}
                      value={itemDraft.text}
                      onChange={(e) => setItemDraft((d) => ({ ...d, text: e.target.value }))}
                      aria-label={`แก้ไขข้อความ Upsell: ${resolved.title}`}
                      className="w-full resize-y rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:outline-none"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={saveEditItem}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer"
                      >
                        <Check className="w-3 h-3" />
                        บันทึก
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingItem(null)}
                        className="px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                      >
                        ยกเลิก
                      </button>
                      {isOverridden && (
                        <button
                          type="button"
                          onClick={() => resetItemOverride('upsell', upId)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                        >
                          <RotateCcw className="w-3 h-3" />
                          คืนค่าเดิม
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <p
                    onClick={() => startEditItem('upsell', upId)}
                    title="คลิกเพื่อแก้ไขข้อความ"
                    className="text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/70 p-3 rounded-lg leading-relaxed whitespace-pre-line hover:ring-1 hover:ring-emerald-500/50 cursor-pointer"
                  >
                    {resolved.script}
                  </p>
                )}
              </div>
            );
          })}

          {overrides.customChat.map((custom, posIdx) => {
            const isEditing =
              editingItem?.kind === 'customChat' && editingItem.key === custom.id;
            const isDragging = dragItem?.kind === 'customChat' && dragItem.key === custom.id;
            const isDropTarget =
              dragOverItem?.kind === 'customChat' &&
              dragOverItem.key === custom.id &&
              dragItem?.key !== custom.id;
            return (
              <div
                key={custom.id}
                draggable={!isEditing}
                onDragStart={() => setDragItem({ kind: 'customChat', key: custom.id })}
                onDragOver={(e) => {
                  if (dragItem?.kind === 'customChat') {
                    e.preventDefault();
                    setDragOverItem({ kind: 'customChat', key: custom.id });
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  dropPlaybookItem('customChat', custom.id);
                }}
                onDragEnd={() => {
                  setDragItem(null);
                  setDragOverItem(null);
                }}
                className={`p-4 rounded-xl bg-white dark:bg-slate-900 border space-y-2 transition-all ${
                  isDropTarget
                    ? 'border-emerald-500 ring-2 ring-emerald-500/40'
                    : 'border-emerald-200 dark:border-emerald-800/80'
                } ${isDragging ? 'opacity-50' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <span
                      title="ลากเพื่อย้ายตำแหน่ง"
                      className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing mt-0.5 shrink-0"
                    >
                      <GripVertical className="w-4 h-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs text-emerald-700 dark:text-emerald-400">
                        {custom.category}
                      </div>
                      <h3
                        onClick={() => startEditItem('customChat', custom.id)}
                        title="คลิกเพื่อแก้ไข"
                        className="text-sm font-bold text-slate-900 dark:text-slate-100 hover:text-emerald-700 dark:hover:text-emerald-400 cursor-pointer"
                      >
                        {custom.title}
                      </h3>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={posIdx === 0}
                      onClick={() => movePlaybookItem('customChat', custom.id, 'up')}
                      aria-label={`ย้ายขึ้น: ${custom.title}`}
                      title="ย้ายขึ้น"
                      className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 cursor-pointer disabled:cursor-default"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={posIdx === overrides.customChat.length - 1}
                      onClick={() => movePlaybookItem('customChat', custom.id, 'down')}
                      aria-label={`ย้ายลง: ${custom.title}`}
                      title="ย้ายลง"
                      className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 cursor-pointer disabled:cursor-default"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => startEditItem('customChat', custom.id)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      แก้ไข
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopy(`custom-${custom.id}`, custom.text)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 cursor-pointer"
                    >
                      {copiedId === `custom-${custom.id}` ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      {copiedId === `custom-${custom.id}` ? 'คัดลอกแล้ว' : 'คัดลอก'}
                    </button>
                  </div>
                </div>
                {isEditing ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input
                        type="text"
                        value={itemDraft.title}
                        onChange={(e) => setItemDraft((d) => ({ ...d, title: e.target.value }))}
                        aria-label="แก้ไขชื่อสคริปต์"
                        placeholder="ชื่อสคริปต์"
                        className="sm:col-span-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:outline-none"
                      />
                      <input
                        type="text"
                        value={itemDraft.category}
                        onChange={(e) => setItemDraft((d) => ({ ...d, category: e.target.value }))}
                        aria-label="แก้ไขหมวดหมู่สคริปต์"
                        placeholder="หมวดหมู่"
                        className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:outline-none"
                      />
                    </div>
                    <textarea
                      rows={4}
                      value={itemDraft.text}
                      onChange={(e) => setItemDraft((d) => ({ ...d, text: e.target.value }))}
                      aria-label={`แก้ไขข้อความสคริปต์: ${custom.title}`}
                      className="w-full resize-y rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:outline-none"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={saveEditItem}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer"
                      >
                        <Check className="w-3 h-3" />
                        บันทึก
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingItem(null)}
                        className="px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                      >
                        ยกเลิก
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteCustom(custom.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:text-rose-800 dark:hover:text-rose-300 ml-auto cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                        ลบ
                      </button>
                    </div>
                  </div>
                ) : (
                  <p
                    onClick={() => startEditItem('customChat', custom.id)}
                    title="คลิกเพื่อแก้ไขข้อความ"
                    className="text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/70 p-3 rounded-lg leading-relaxed whitespace-pre-line hover:ring-1 hover:ring-emerald-500/50 cursor-pointer"
                  >
                    {custom.text}
                  </p>
                )}
              </div>
            );
          })}

          {orderedChatIndices.map((i, posIdx) => {
            const key = String(i);
            const resolved = resolveChatScript(overrides, i);
            const isEditing = editingItem?.kind === 'chat' && editingItem.key === key;
            const isOverridden = overrides.chat[key] !== undefined;
            const isDragging = dragItem?.kind === 'chat' && dragItem.key === key;
            const isDropTarget =
              dragOverItem?.kind === 'chat' &&
              dragOverItem.key === key &&
              dragItem?.key !== key;
            return (
              <div
                key={i}
                draggable={!isEditing}
                onDragStart={() => setDragItem({ kind: 'chat', key })}
                onDragOver={(e) => {
                  if (dragItem?.kind === 'chat') {
                    e.preventDefault();
                    setDragOverItem({ kind: 'chat', key });
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  dropPlaybookItem('chat', key);
                }}
                onDragEnd={() => {
                  setDragItem(null);
                  setDragOverItem(null);
                }}
                className={`p-4 rounded-xl bg-white dark:bg-slate-900 border space-y-2 transition-all ${
                  isDropTarget
                    ? 'border-emerald-500 ring-2 ring-emerald-500/40'
                    : 'border-slate-200 dark:border-slate-800'
                } ${isDragging ? 'opacity-50' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <span
                      title="ลากเพื่อย้ายตำแหน่ง"
                      className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing mt-0.5 shrink-0"
                    >
                      <GripVertical className="w-4 h-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs text-slate-500 dark:text-slate-400">{resolved.category}</div>
                      <h3
                        onClick={() => startEditItem('chat', key)}
                        title="คลิกเพื่อแก้ไข"
                        className="text-sm font-bold text-slate-900 dark:text-slate-100 hover:text-emerald-700 dark:hover:text-emerald-400 cursor-pointer"
                      >
                        {resolved.title}
                      </h3>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={posIdx === 0}
                      onClick={() => movePlaybookItem('chat', key, 'up')}
                      aria-label={`ย้ายขึ้น: ${resolved.title}`}
                      title="ย้ายขึ้น"
                      className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 cursor-pointer disabled:cursor-default"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={posIdx === orderedChatIndices.length - 1}
                      onClick={() => movePlaybookItem('chat', key, 'down')}
                      aria-label={`ย้ายลง: ${resolved.title}`}
                      title="ย้ายลง"
                      className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 cursor-pointer disabled:cursor-default"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => startEditItem('chat', key)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      แก้ไข
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopy(`cs-${i}`, resolved.text)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 cursor-pointer"
                    >
                      {copiedId === `cs-${i}` ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      {copiedId === `cs-${i}` ? 'คัดลอกแล้ว' : 'คัดลอก'}
                    </button>
                  </div>
                </div>
                {isEditing ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input
                        type="text"
                        value={itemDraft.title}
                        onChange={(e) => setItemDraft((d) => ({ ...d, title: e.target.value }))}
                        aria-label={`แก้ไขชื่อสคริปต์: ${resolved.title}`}
                        placeholder="ชื่อสคริปต์"
                        className="sm:col-span-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:outline-none"
                      />
                      <input
                        type="text"
                        value={itemDraft.category}
                        onChange={(e) => setItemDraft((d) => ({ ...d, category: e.target.value }))}
                        aria-label={`แก้ไขหมวดหมู่: ${resolved.category}`}
                        placeholder="หมวดหมู่"
                        className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:outline-none"
                      />
                    </div>
                    <textarea
                      rows={4}
                      value={itemDraft.text}
                      onChange={(e) => setItemDraft((d) => ({ ...d, text: e.target.value }))}
                      aria-label={`แก้ไขข้อความสคริปต์: ${resolved.title}`}
                      className="w-full resize-y rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:outline-none"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={saveEditItem}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer"
                      >
                        <Check className="w-3 h-3" />
                        บันทึก
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingItem(null)}
                        className="px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                      >
                        ยกเลิก
                      </button>
                      {isOverridden && (
                        <button
                          type="button"
                          onClick={() => resetItemOverride('chat', key)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                        >
                          <RotateCcw className="w-3 h-3" />
                          คืนค่าเดิม
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <p
                    onClick={() => startEditItem('chat', key)}
                    title="คลิกเพื่อแก้ไขข้อความ"
                    className="text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/70 p-3 rounded-lg leading-relaxed whitespace-pre-line hover:ring-1 hover:ring-emerald-500/50 cursor-pointer"
                  >
                    {resolved.text}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
