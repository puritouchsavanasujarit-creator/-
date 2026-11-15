import { useState } from 'react';
import { Copy, Check, AlertCircle } from 'lucide-react';
import {
  SALES_STAGES,
  PRODUCT_SETS,
  INDIVIDUAL_FRUITS,
  UPSELL_OPTIONS,
  CHAT_SCRIPTS,
  SHIFT_WORKFLOWS,
} from '@/src/data/playbookData';
import { PRODUCT_IMAGE_MAP } from '@/src/data/productImages';

export function PlaybookView() {
  const [search, setSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (id: string, text: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const filteredProducts = PRODUCT_SETS.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.code.toLowerCase().includes(search.toLowerCase()) ||
      p.fruits.some((f) => f.toLowerCase().includes(search.toLowerCase())) ||
      p.occasions.some((o) => o.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-8 space-y-10">
      {/* Intro & Search */}
      <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            คู่มือการขาย สินค้า และกฎปฏิบัติงาน (Admin Sale Playbook)
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            รวม Flow 6 ขั้นตอน, ราคาเซตกระเช้า, เกณฑ์ค่าจัดส่ง, สคริปต์ Upsell และวิธีส่งต่อออเดอร์ตามกะ
          </p>
        </div>
        <div className="w-full sm:w-72">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อเซต ผลไม้ หรือโอกาสใช้งาน..."
            className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none"
          />
        </div>
      </section>

      {/* 1. Golden Rule + 6-Step Flow */}
      <section className="space-y-4">
        <div className="p-5 rounded-2xl bg-emerald-50/70 border border-emerald-200">
          <div className="text-xs font-semibold text-emerald-800">กฎเหล็กของการแชท</div>
          <p className="text-base font-bold text-slate-900 mt-1">
            “ทุกขั้นตอนของการคุยกับลูกค้า ต้องทิ้งคำถามไว้ให้ลูกค้าตอบเสมอ เพื่อรักษาบทสนทนาไว้”
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {SALES_STAGES.map((stage) => (
            <div
              key={stage.key}
              className="p-4 rounded-xl bg-white border border-slate-200 space-y-1.5"
            >
              <div className="text-xs font-semibold text-emerald-700 font-mono-num">
                ขั้นตอนที่ {stage.step}
              </div>
              <h2 className="text-sm font-bold text-slate-900">{stage.label}</h2>
              <p className="text-xs text-slate-600 leading-relaxed">{stage.shortDesc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 2. Product Catalog */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-bold text-slate-900">รายการเซตผลไม้พรีเมียมและส่วนประกอบ</h2>
          <span className="text-xs text-slate-500 font-mono-num">
            {filteredProducts.length} รายการ
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredProducts.map((prod) => (
            <article
              key={prod.id}
              className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col sm:flex-row"
            >
              <div className="sm:w-44 h-44 sm:h-auto shrink-0 bg-slate-100 relative">
                {prod.imageKey ? (
                  <img
                    src={PRODUCT_IMAGE_MAP[prod.imageKey]}
                    alt={`${prod.code} ${prod.name}`}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-emerald-50 to-slate-100 flex items-center justify-center p-4 text-center text-xs font-semibold text-slate-600">
                    {prod.code}
                  </div>
                )}
              </div>

              <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs text-slate-500 font-mono-num">{prod.code}</div>
                      <h3 className="text-base font-bold text-slate-900">{prod.name}</h3>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-base font-bold font-mono-num text-emerald-700">
                        {prod.price.toLocaleString()} บ.
                      </div>
                      {prod.originalPrice && (
                        <div className="text-xs font-mono-num text-slate-400 line-through">
                          {prod.originalPrice.toLocaleString()} บ.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="text-xs text-slate-500 mt-1">
                    {prod.boxColor} · เหมาะสำหรับ: {prod.occasions.join(', ')}
                  </div>

                  <p className="text-xs text-slate-700 mt-2 leading-relaxed">
                    {prod.fruits.join(' · ')}
                  </p>
                </div>

                {prod.hasSeasonalRisk && prod.seasonalNote && (
                  <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <span>{prod.seasonalNote}</span>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* 3. Individual Fruit Pricing + Shipping Matrix */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
          <h2 className="text-base font-bold text-slate-900">ตารางราคาผลไม้ปลีก (สำหรับปรับ/ทดแทน)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 font-semibold">ผลไม้</th>
                  <th className="py-2 font-semibold">หน่วย</th>
                  <th className="py-2 font-semibold">แหล่งที่มา</th>
                  <th className="py-2 font-semibold text-right">ราคา (บาท)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {INDIVIDUAL_FRUITS.map((f) => (
                  <tr key={f.name}>
                    <td className="py-2.5 font-medium text-slate-900">{f.name}</td>
                    <td className="py-2.5 text-slate-600">{f.unit}</td>
                    <td className="py-2.5 text-slate-500">{f.origin}</td>
                    <td className="py-2.5 font-mono-num font-semibold text-slate-900 text-right">
                      {f.price}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <h2 className="text-base font-bold text-slate-900">เกณฑ์ค่าจัดส่งและข้อควรระวัง</h2>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 font-semibold">ระยะทาง / ช่องทาง</th>
                <th className="py-2 font-semibold">ค่าส่ง</th>
                <th className="py-2 font-semibold">เงื่อนไขส่งฟรี / รอบส่ง</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="py-2.5 font-medium text-slate-900">1–10 กม.</td>
                <td className="py-2.5 font-mono-num font-semibold text-slate-900">59 บ.</td>
                <td className="py-2.5 text-slate-600">ฟรีเมื่อยอด 1,500+ บ. (ถึงใน 1–1.5 ชม.)</td>
              </tr>
              <tr>
                <td className="py-2.5 font-medium text-slate-900">11–25 กม.</td>
                <td className="py-2.5 font-mono-num font-semibold text-slate-900">159 บ.</td>
                <td className="py-2.5 text-slate-600">ฟรีเมื่อยอด 4,000+ บ. (ถึงใน 2–2.5 ชม.)</td>
              </tr>
              <tr>
                <td className="py-2.5 font-medium text-slate-900">เกิน 25 กม.</td>
                <td className="py-2.5 font-mono-num font-semibold text-slate-900">
                  159 + 10/กม.
                </td>
                <td className="py-2.5 text-slate-600">บวกเพิ่มกม.ละ 10 บ. (ถึงใน 3 ชม.)</td>
              </tr>
              <tr>
                <td className="py-2.5 font-medium text-slate-900">ต่างจังหวัด Inter Express</td>
                <td className="py-2.5 font-mono-num font-semibold text-slate-900">450 บ./ชิ้น</td>
                <td className="py-2.5 text-slate-600">
                  รถห้องเย็น นับถอยหลัง 3 วัน ตัดรอบก่อน 12.00 น. งดวิ่งวันเสาร์
                </td>
              </tr>
            </tbody>
          </table>

          <ul className="space-y-1.5 text-xs text-slate-600 list-disc pl-4 pt-2 border-t border-slate-200">
            <li>เคสด่วนน้อยกว่า 2 ชม. หรือชุดส่งด่วน 1–1.5 ชม.: ประสานทีม OP ก่อนรับปากทุกครั้ง</li>
            <li>ส่งโรงพยาบาล: ต้องขอเบอร์ติดต่อญาติผู้ป่วยเสมอ</li>
            <li>ส่ง URL Payment: ห้ามเว้นวรรคและห้ามใส่อีโมจิในลิงก์</li>
            <li>การเก็บรักษา: แช่ตู้เย็น 1–5°C ไม่วางในห้องแอร์เกิน 3–4 ชั่วโมง</li>
          </ul>
        </div>
      </section>

      {/* 4. Shift Workflows */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-900">ขั้นตอนรับและส่งต่อออเดอร์ตามช่วงเวลา (Shift)</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {SHIFT_WORKFLOWS.map((wf) => (
            <div key={wf.shift} className="p-4 rounded-xl bg-white border border-slate-200 space-y-2">
              <div className="text-xs font-semibold text-emerald-700">{wf.shift}</div>
              <div className="text-sm font-bold text-slate-900">{wf.label}</div>
              <ul className="space-y-1.5 text-xs text-slate-600 list-disc pl-4 leading-relaxed">
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
        <h2 className="text-lg font-bold text-slate-900">คลังสคริปต์ Upsell และสคริปต์แชท</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {UPSELL_OPTIONS.map((up) => (
            <div key={up.id} className="p-4 rounded-xl bg-white border border-slate-200 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{up.title}</h3>
                  <div className="text-xs text-slate-500">
                    {up.priceText} · {up.bestFor}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(up.id, up.script)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-800 shrink-0 cursor-pointer"
                >
                  {copiedId === up.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedId === up.id ? 'คัดลอกแล้ว' : 'คัดลอก'}
                </button>
              </div>
              <p className="text-xs text-slate-700 bg-slate-50 p-3 rounded-lg leading-relaxed">
                {up.script}
              </p>
            </div>
          ))}

          {CHAT_SCRIPTS.map((sc, i) => (
            <div key={i} className="p-4 rounded-xl bg-white border border-slate-200 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs text-slate-500">{sc.category}</div>
                  <h3 className="text-sm font-bold text-slate-900">{sc.title}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(`cs-${i}`, sc.text)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-800 shrink-0 cursor-pointer"
                >
                  {copiedId === `cs-${i}` ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  {copiedId === `cs-${i}` ? 'คัดลอกแล้ว' : 'คัดลอก'}
                </button>
              </div>
              <p className="text-xs text-slate-700 bg-slate-50 p-3 rounded-lg leading-relaxed whitespace-pre-line">
                {sc.text}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
