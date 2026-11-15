import { CheckCircle2, Trash2, ArrowRight, Flame, Check, Clock } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TRAINING_SCENARIOS } from '@/src/data/playbookData';
import { computeDailyStreak, computeLast30DaysTrend } from '@/src/lib/streak';
import type { DailyTrendPoint } from '@/src/lib/streak';
import type { SavedAttempt, QuizProgress } from '@/src/types';

interface ProgressViewProps {
  attempts: SavedAttempt[];
  quizProgress: QuizProgress | null;
  onClearHistory: () => void;
  onOpenScenario: (scenarioId: string) => void;
}

interface TrendTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: DailyTrendPoint }>;
}

function TrendTooltip({ active, payload }: TrendTooltipProps) {
  if (!active || !payload || payload.length === 0 || !payload[0]?.payload) {
    return null;
  }
  const point = payload[0].payload;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-3.5 py-2.5 text-xs space-y-1.5">
      <div className="font-semibold text-slate-900">{point.fullDateLabel}</div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-slate-600">คะแนนเฉลี่ย</span>
        <span className="font-bold font-mono-num text-emerald-700">
          {point.avgScore !== null ? `${point.avgScore}/100` : 'ไม่มีข้อมูล'}
        </span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-slate-600">ความถี่การฝึก</span>
        <span className="font-bold font-mono-num text-sky-700">{point.sessionCount} ครั้ง</span>
      </div>
    </div>
  );
}

export function ProgressView({
  attempts,
  quizProgress,
  onClearHistory,
  onOpenScenario,
}: ProgressViewProps) {
  const completedScenarioIds = Array.from(new Set(attempts.map((a) => a.scenarioId)));
  const avgScore =
    attempts.length > 0
      ? Math.round(attempts.reduce((sum, a) => sum + a.overallScore, 0) / attempts.length)
      : 0;
  const streak = computeDailyStreak(attempts);
  const trend30Days = computeLast30DaysTrend(attempts);
  const total30DaySessions = trend30Days.reduce((sum, d) => sum + d.sessionCount, 0);
  const active30DayCount = trend30Days.filter((d) => d.sessionCount > 0).length;

  // Aggregate average per competency dimension
  const dimensionAverages: Array<{ name: string; avg: number }> = [];
  if (attempts.length > 0) {
    const map = new Map<string, { total: number; count: number }>();
    for (const att of attempts) {
      for (const dim of att.dimensions) {
        const entry = map.get(dim.name) || { total: 0, count: 0 };
        entry.total += dim.score;
        entry.count += 1;
        map.set(dim.name, entry);
      }
    }
    map.forEach((val, name) => {
      dimensionAverages.push({ name, avg: Math.round(val.total / val.count) });
    });
  }

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            ผลประเมินและพัฒนาการทักษะงานบริการของฉัน
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            ติดตามคะแนนการสื่อสาร ความครบถ้วนของ SOP และความครอบคลุมในทุกสถานการณ์ฝึกซ้อม
          </p>
        </div>
        {(attempts.length > 0 || quizProgress) && (
          <button
            type="button"
            onClick={onClearHistory}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-rose-700 bg-white border border-rose-200 rounded-lg hover:bg-rose-50 transition-colors cursor-pointer shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
            ล้างประวัติการฝึก
          </button>
        )}
      </div>

      {/* Daily Streak Counter */}
      <section
        aria-label="Daily Streak"
        className="p-5 sm:p-6 bg-white border border-slate-200 rounded-2xl flex flex-col lg:flex-row lg:items-center justify-between gap-6"
      >
        <div className="flex items-start sm:items-center gap-4">
          <div
            className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border ${
              streak.currentStreak > 0
                ? 'bg-amber-50 border-amber-200 text-amber-600'
                : 'bg-slate-50 border-slate-200 text-slate-400'
            }`}
          >
            <Flame className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500">
              สถิติการฝึกต่อเนื่อง (Daily Streak)
            </div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mt-0.5">
              <span className="text-3xl font-bold font-mono-num text-slate-900">
                {streak.currentStreak}{' '}
                <span className="text-sm font-normal text-slate-500">วันติดกัน</span>
              </span>
              <span className="text-xs text-slate-400" aria-hidden="true">
                ·
              </span>
              <span className="text-xs text-slate-600 font-mono-num">
                สถิติสูงสุด {streak.longestStreak} วัน
              </span>
              <span className="text-xs text-slate-400" aria-hidden="true">
                ·
              </span>
              <span className="text-xs text-slate-600 font-mono-num">
                รวมทั้งหมด {streak.totalActiveDays} วัน
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-xs">
              {streak.completedToday ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="font-medium text-emerald-700">
                    วันนี้ทำภารกิจฝึกจบอย่างน้อย 1 เคสแล้ว รักษาความต่อเนื่องได้ดีมาก
                  </span>
                </>
              ) : streak.currentStreak > 0 ? (
                <>
                  <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                  <span className="font-medium text-amber-700">
                    วันนี้ยังไม่ได้ฝึก 1 เคส — จบการจำลองแชทวันนี้เพื่อต่อสตรีคเป็น{' '}
                    <span className="font-mono-num">{streak.currentStreak + 1}</span> วัน
                  </span>
                </>
              ) : (
                <>
                  <Clock className="w-4 h-4 text-slate-500 shrink-0" />
                  <span className="text-slate-600">
                    จบการจำลองแชทอย่างน้อย 1 เคสต่อวัน เพื่อเริ่มนับสถิติ Daily Streak
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 7-Day Activity Strip */}
        <div className="flex flex-col sm:items-end gap-2">
          <div className="text-[11px] font-medium text-slate-500">7 วันล่าสุด</div>
          <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
            {streak.last7Days.map((day) => (
              <div
                key={day.dateKey}
                title={`${day.dateKey}${day.completed ? ' — ฝึกสำเร็จแล้ว' : ' — ยังไม่มีการฝึก'}`}
                className={`w-10 sm:w-11 py-1.5 rounded-lg border flex flex-col items-center justify-center gap-1 ${
                  day.completed
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : day.isToday
                      ? 'bg-amber-50/60 border-amber-300 text-slate-700'
                      : 'bg-slate-50 border-slate-200 text-slate-400'
                }`}
              >
                <span className="text-[10px] font-medium leading-none">
                  {day.isToday ? 'วันนี้' : day.weekdayLabel}
                </span>
                {day.completed ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <span className="text-[11px] font-mono-num leading-none">{day.dayOfMonth}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Summary Metrics Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 bg-white border border-slate-200 rounded-2xl">
          <div className="text-xs font-medium text-slate-500">จำนวนรอบที่ฝึกจบ</div>
          <div className="text-3xl font-bold font-mono-num text-slate-900 mt-1">
            {attempts.length} <span className="text-sm font-normal text-slate-500">ครั้ง</span>
          </div>
        </div>

        <div className="p-5 bg-white border border-slate-200 rounded-2xl">
          <div className="text-xs font-medium text-slate-500">คะแนนเฉลี่ยการตอบแชท</div>
          <div className="text-3xl font-bold font-mono-num text-emerald-700 mt-1">
            {attempts.length > 0 ? avgScore : '—'}
            {attempts.length > 0 && (
              <span className="text-sm font-normal text-slate-400">/100</span>
            )}
          </div>
        </div>

        <div className="p-5 bg-white border border-slate-200 rounded-2xl">
          <div className="text-xs font-medium text-slate-500">เคสที่ฝึกสำเร็จแล้ว</div>
          <div className="text-3xl font-bold font-mono-num text-slate-900 mt-1">
            {completedScenarioIds.length}/{TRAINING_SCENARIOS.length}
          </div>
        </div>

        <div className="p-5 bg-white border border-slate-200 rounded-2xl">
          <div className="text-xs font-medium text-slate-500">คะแนนสูงสุดแบบทดสอบ SOP</div>
          <div className="text-3xl font-bold font-mono-num text-slate-900 mt-1">
            {quizProgress
              ? `${quizProgress.bestScore}/${quizProgress.totalQuestions}`
              : 'ยังไม่ทำ'}
          </div>
        </div>
      </div>

      {/* 30-Day Performance & Training Frequency Line Chart */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              แนวโน้มคะแนนและความถี่ในการฝึกซ้อม (30 วันล่าสุด)
            </h2>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500 mt-1">
              <span className="font-mono-num">ฝึกทั้งหมด {total30DaySessions} ครั้ง</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-num">เข้าฝึก {active30DayCount}/30 วัน</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-700">
            <div className="flex items-center gap-2">
              <span className="w-4 h-0.5 bg-emerald-600 inline-block" aria-hidden="true" />
              <span>คะแนนเฉลี่ย (0–100)</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="w-4 h-0.5 border-t-2 border-dashed border-sky-600 inline-block"
                aria-hidden="true"
              />
              <span>จำนวนครั้งที่ฝึก (ครั้ง/วัน)</span>
            </div>
          </div>
        </div>

        {total30DaySessions === 0 ? (
          <div className="h-[240px] flex flex-col items-center justify-center text-center bg-slate-50 rounded-xl px-4">
            <p className="text-xs font-medium text-slate-700">
              ยังไม่มีประวัติการฝึกจบเคสในช่วง 30 วันที่ผ่านมา
            </p>
            <p className="text-xs text-slate-500 mt-1">
              กรุณาฝึกโต้ตอบในหน้าจำลองแชทแล้วกด “จบเคส & ประเมินผล” เพื่อดูกราฟพัฒนาการรายวัน
            </p>
          </div>
        ) : (
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={trend30Days}
                margin={{ top: 10, right: 12, left: -12, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#64748B' }}
                  tickLine={false}
                  axisLine={{ stroke: '#E2E8F0' }}
                  minTickGap={24}
                />
                <YAxis
                  yAxisId="score"
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  tick={{ fontSize: 11, fill: '#059669' }}
                  tickLine={false}
                  axisLine={false}
                  width={42}
                />
                <YAxis
                  yAxisId="count"
                  orientation="right"
                  allowDecimals={false}
                  domain={[0, (dataMax: number) => Math.max(3, dataMax + 1)]}
                  tick={{ fontSize: 11, fill: '#0284C7' }}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                />
                <Tooltip content={<TrendTooltip />} />
                <Line
                  yAxisId="score"
                  type="monotone"
                  dataKey="avgScore"
                  name="คะแนนเฉลี่ย"
                  stroke="#059669"
                  strokeWidth={2.5}
                  connectNulls
                  dot={{ r: 3.5, fill: '#059669', strokeWidth: 0 }}
                  activeDot={{ r: 5.5, fill: '#059669', stroke: '#FFFFFF', strokeWidth: 2 }}
                />
                <Line
                  yAxisId="count"
                  type="monotone"
                  dataKey="sessionCount"
                  name="จำนวนครั้งที่ฝึก"
                  stroke="#0284C7"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={{ r: 2.5, fill: '#0284C7', strokeWidth: 0 }}
                  activeDot={{ r: 5, fill: '#0284C7', stroke: '#FFFFFF', strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Competency Breakdown + Scenario Coverage */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <h2 className="text-base font-bold text-slate-900">คะแนนเฉลี่ยแยกตาม 5 ทักษะหลัก</h2>
          {dimensionAverages.length === 0 ? (
            <div className="p-6 text-center bg-slate-50 rounded-xl text-xs text-slate-500">
              ยังไม่มีข้อมูลผลประเมิน กรุณาลองฝึกโต้ตอบในหน้าจำลองแชทและกด “จบเคส & ประเมินผล”
            </div>
          ) : (
            <div className="space-y-3">
              {dimensionAverages.map((d) => (
                <div key={d.name} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-800">{d.name}</span>
                    <span className="font-bold font-mono-num text-slate-900">{d.avg}/100</span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-600 rounded-full"
                      style={{ width: `${d.avg}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
          <h2 className="text-base font-bold text-slate-900">ความคืบหน้าแต่ละสถานการณ์</h2>
          <div className="divide-y divide-slate-100">
            {TRAINING_SCENARIOS.map((sc) => {
              const done = completedScenarioIds.includes(sc.id);
              const bestForScenario = attempts
                .filter((a) => a.scenarioId === sc.id)
                .reduce((max, a) => Math.max(max, a.overallScore), 0);

              return (
                <div key={sc.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {done && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
                      <span className="text-xs font-semibold text-slate-900 truncate">
                        {sc.title}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {done ? `คะแนนสูงสุด ${bestForScenario}/100` : 'ยังไม่ได้ฝึกเคสนี้'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenScenario(sc.id)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-800 shrink-0 cursor-pointer"
                  >
                    ฝึกเลย
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Attempt History Table */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
        <h2 className="text-base font-bold text-slate-900">ประวัติการประเมินผลล่าสุด</h2>
        {attempts.length === 0 ? (
          <p className="text-xs text-slate-500">ยังไม่มีประวัติการฝึกซ้อมที่บันทึกไว้</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 font-semibold">วันเวลา</th>
                  <th className="py-2 font-semibold">เคสฝึกซ้อม</th>
                  <th className="py-2 font-semibold">จำนวนข้อความ</th>
                  <th className="py-2 font-semibold">ระดับผลประเมิน</th>
                  <th className="py-2 font-semibold text-right">คะแนนรวม</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {attempts.map((att) => (
                  <tr key={att.id}>
                    <td className="py-3 font-mono-num text-slate-500 whitespace-nowrap pr-4">
                      {new Date(att.dateIso).toLocaleString('th-TH', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td className="py-3 font-medium text-slate-900 pr-4">{att.scenarioTitle}</td>
                    <td className="py-3 font-mono-num text-slate-600 pr-4">
                      {att.messageCount} ข้อความ
                    </td>
                    <td className="py-3 text-slate-700 pr-4">{att.gradeLabel}</td>
                    <td className="py-3 font-mono-num font-bold text-emerald-700 text-right">
                      {att.overallScore}/100
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
