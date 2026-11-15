import { CheckCircle2, XCircle, RotateCcw, ArrowRight, X } from 'lucide-react';
import type { SessionEvaluation } from '@/src/types';

interface EvaluationModalProps {
  evaluation: SessionEvaluation;
  scenarioTitle: string;
  onClose: () => void;
  onRetryScenario: () => void;
  onNextScenario: () => void;
}

export function EvaluationModal({
  evaluation,
  scenarioTitle,
  onClose,
  onRetryScenario,
  onNextScenario,
}: EvaluationModalProps) {
  const scoreColor =
    evaluation.overallScore >= 80
      ? 'text-emerald-700'
      : evaluation.overallScore >= 60
      ? 'text-amber-700'
      : 'text-rose-700';

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[2px] flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="eval-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-xl">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-200 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-slate-500">
              รายงานประเมินผลการฝึกตอบแชท · {scenarioTitle}
            </p>
            <h2 id="eval-modal-title" className="text-xl font-bold text-slate-900 mt-1">
              สรุปผลการสื่อสารงานบริการ
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่างประเมินผล"
            className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Overall Score Strip */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="space-y-1">
              <div className="text-sm font-medium text-slate-600">ระดับความพร้อมในการรับแชทจริง</div>
              <div className="text-lg font-bold text-slate-900">{evaluation.gradeLabel}</div>
              <p className="text-sm text-slate-600 max-w-xl leading-relaxed">
                {evaluation.summaryVerdict}
              </p>
            </div>
            <div className="shrink-0 sm:text-right border-t sm:border-t-0 sm:border-l border-slate-200 pt-3 sm:pt-0 sm:pl-6">
              <div className="text-xs font-medium text-slate-500">คะแนนรวม</div>
              <div className={`text-4xl font-bold font-mono-num ${scoreColor}`}>
                {evaluation.overallScore}
                <span className="text-base font-normal text-slate-400">/100</span>
              </div>
            </div>
          </div>

          {/* 5 Dimensions */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-3">
              คะแนนประเมินรายด้าน (5 ทักษะหลัก)
            </h3>
            <div className="space-y-3">
              {evaluation.dimensions.map((dim) => {
                const barColor =
                  dim.score >= 80
                    ? 'bg-emerald-600'
                    : dim.score >= 60
                    ? 'bg-amber-500'
                    : 'bg-rose-500';
                return (
                  <div
                    key={dim.name}
                    className="p-3.5 border border-slate-200 rounded-xl bg-white"
                  >
                    <div className="flex items-center justify-between gap-3 mb-1.5">
                      <span className="text-sm font-semibold text-slate-900">{dim.name}</span>
                      <span className="text-sm font-bold font-mono-num text-slate-900">
                        {dim.score}/100
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden mb-2">
                      <div
                        className={`h-full ${barColor} rounded-full transition-all`}
                        style={{ width: `${Math.min(100, Math.max(0, dim.score))}%` }}
                      />
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">{dim.comment}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Checkpoint Results */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-3">
              การปฏิบัติตามขั้นตอนและ SOP ของเคสนี้
            </h3>
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
              {evaluation.checkpointResults.map((cp, idx) => (
                <div key={idx} className="p-3.5 flex items-start gap-3 bg-white">
                  {cp.passed ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900">
                      {cp.label}{' '}
                      <span
                        className={`text-xs font-semibold ml-1 ${
                          cp.passed ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        ({cp.passed ? 'ผ่าน' : 'ยังขาดจุดนี้'})
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{cp.note}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Strengths & Improvements */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 border border-slate-200 rounded-xl bg-emerald-50/40">
              <h4 className="text-sm font-semibold text-emerald-900 mb-2">จุดเด่นที่ทำได้ดี</h4>
              <ul className="space-y-1.5 text-xs text-slate-700 leading-relaxed list-disc pl-4">
                {evaluation.strengths.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="p-4 border border-slate-200 rounded-xl bg-amber-50/40">
              <h4 className="text-sm font-semibold text-amber-900 mb-2">
                จุดที่ควรพัฒนาต่อ
              </h4>
              <ul className="space-y-1.5 text-xs text-slate-700 leading-relaxed list-disc pl-4">
                {evaluation.improvements.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={onRetryScenario}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            ฝึกเคสนี้อีกครั้ง
          </button>
          <button
            type="button"
            onClick={onNextScenario}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors cursor-pointer"
          >
            ไปเคสถัดไป
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
