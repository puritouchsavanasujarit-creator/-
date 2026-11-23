import { useState } from 'react';
import { ChevronDown, Copy, Check } from 'lucide-react';
import { AGENT_FAQ_GROUPS } from '@/src/data/agentFaqData';

interface AgentFaqSectionProps {
  search: string;
}

export function AgentFaqSection({ search }: AgentFaqSectionProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const query = search.trim().toLowerCase();

  const groups = AGENT_FAQ_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        !query ||
        [item.question, item.answer, item.script, item.reference, group.label]
          .filter(Boolean)
          .some((text) => text!.toLowerCase().includes(query)),
    ),
  })).filter((group) => group.items.length > 0);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
          คำถามที่เอเจนท์ถามบ่อยในกะ (Agent FAQ)
        </h2>
        <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
          ค่าจัดส่ง ชำระเงิน ใบกำกับ ส่วนลด สต็อก และการส่งต่อออเดอร์
        </p>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">
          ไม่พบคำถามที่ตรงกับ “{search}” — ลองค้นหาคำสั้นๆ เช่น ค่าส่ง, โอน, ใบกำกับ, กะ
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div
              key={group.id}
              className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 space-y-2"
            >
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{group.label}</h3>

              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {group.items.map((item) => {
                  const isOpen = query.length > 0 || openId === item.id;
                  return (
                    <li key={item.id} className="py-1">
                      <button
                        type="button"
                        onClick={() => setOpenId(isOpen && !query ? null : item.id)}
                        aria-expanded={isOpen}
                        className="w-full flex items-start justify-between gap-3 py-2 text-left cursor-pointer group"
                      >
                        <span className="text-xs sm:text-sm font-medium text-slate-900 dark:text-slate-100 group-hover:text-emerald-700 dark:group-hover:text-emerald-400">
                          {item.question}
                        </span>
                        <ChevronDown
                          className={`w-4 h-4 shrink-0 mt-0.5 text-slate-400 transition-transform ${
                            isOpen ? 'rotate-180' : ''
                          }`}
                          aria-hidden="true"
                        />
                      </button>

                      {isOpen && (
                        <div className="pb-3 space-y-2">
                          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                            {item.answer}
                          </p>

                          {item.script && (
                            <div className="rounded-xl bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/70 p-3 space-y-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                                  ประโยคที่ใช้ตอบลูกค้าได้เลย
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleCopy(item.id, item.script ?? '')}
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 hover:text-emerald-900 dark:hover:text-emerald-200 cursor-pointer"
                                >
                                  {copiedId === item.id ? (
                                    <>
                                      <Check className="w-3 h-3" aria-hidden="true" /> คัดลอกแล้ว
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="w-3 h-3" aria-hidden="true" /> คัดลอก
                                    </>
                                  )}
                                </button>
                              </div>
                              <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-line">
                                “{item.script}”
                              </p>
                            </div>
                          )}

                          {item.reference && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              ดูเพิ่มเติม: {item.reference}
                            </p>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
