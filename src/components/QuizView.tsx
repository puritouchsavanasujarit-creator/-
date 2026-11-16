import { useState } from 'react';
import { CheckCircle2, XCircle, RotateCcw } from 'lucide-react';
import { QUIZ_QUESTIONS } from '@/src/data/playbookData';

interface QuizViewProps {
  onCompleteQuiz: (score: number, total: number) => void;
}

type QuizFilter = 'all' | 'unanswered' | 'wrong';

export function QuizView({ onCompleteQuiz }: QuizViewProps) {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [filter, setFilter] = useState<QuizFilter>('all');
  const [submitted, setSubmitted] = useState(false);

  const answeredCount = Object.keys(answers).length;
  const correctCount = QUIZ_QUESTIONS.reduce((acc, q) => {
    return acc + (answers[q.id] === q.correctIndex ? 1 : 0);
  }, 0);

  const handleSelectOption = (questionId: number, optionIndex: number) => {
    setAnswers((prev) => {
      const next = { ...prev, [questionId]: optionIndex };
      return next;
    });
  };

  const handleSubmitQuiz = () => {
    setSubmitted(true);
    onCompleteQuiz(correctCount, QUIZ_QUESTIONS.length);
  };

  const handleReset = () => {
    setAnswers({});
    setSubmitted(false);
    setFilter('all');
  };

  const visibleQuestions = QUIZ_QUESTIONS.filter((q) => {
    if (filter === 'unanswered') return answers[q.id] === undefined;
    if (filter === 'wrong') return answers[q.id] !== undefined && answers[q.id] !== q.correctIndex;
    return true;
  });

  return (
    <div className="max-w-[1000px] mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            แบบทดสอบความรู้คู่มือการขายและปฏิบัติงาน
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
            ตรวจสอบความเข้าใจกฎการแชท การคำนวณค่าส่ง การเสนอ Upsell และขั้นตอนส่งต่อ OP ทั้งหมด{' '}
            {QUIZ_QUESTIONS.length} ข้อ
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <div className="text-xs text-slate-500 dark:text-slate-400">ตอบแล้ว / ถูกต้อง</div>
            <div className="text-lg font-bold font-mono-num text-slate-900 dark:text-slate-100">
              {answeredCount}/{QUIZ_QUESTIONS.length}
              <span className="text-emerald-700 dark:text-emerald-400 ml-2">({correctCount} ถูก)</span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            ทำใหม่
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-xl">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              filter === 'all'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            ทั้งหมด ({QUIZ_QUESTIONS.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('unanswered')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              filter === 'unanswered'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            ยังไม่ตอบ ({QUIZ_QUESTIONS.length - answeredCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter('wrong')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              filter === 'wrong'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            ข้อที่ตอบผิด ({answeredCount - correctCount})
          </button>
        </div>

        <button
          type="button"
          onClick={handleSubmitQuiz}
          disabled={answeredCount === 0}
          className="px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 rounded-lg transition-colors cursor-pointer"
        >
          บันทึกคะแนนรอบนี้
        </button>
      </div>

      {submitted && (
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-emerald-600 dark:border-emerald-500 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
              บันทึกผลทดสอบแล้ว: ได้คะแนน {correctCount} จาก {QUIZ_QUESTIONS.length} ข้อ (
              {Math.round((correctCount / QUIZ_QUESTIONS.length) * 100)}%)
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
              {correctCount >= 16
                ? 'ยอดเยี่ยม! คุณแม่นยำกฎ SOP และพร้อมรับมือแชทลูกค้าจริงแล้ว'
                : 'แนะนำให้ทบทวนข้อที่ตอบผิดและเปิดคู่มือประกอบในห้องจำลองแชท'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setFilter('wrong')}
            className="px-3.5 py-2 text-xs font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/60 shrink-0 cursor-pointer"
          >
            ทบทวนข้อที่ผิด
          </button>
        </div>
      )}

      {/* Question Cards */}
      {visibleQuestions.length === 0 ? (
        <div className="p-10 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl text-sm text-slate-500 dark:text-slate-400">
          ไม่มีข้อคำถามในตัวกรองที่เลือก
        </div>
      ) : (
        <div className="space-y-4">
          {visibleQuestions.map((q) => {
            const chosen = answers[q.id];
            const isAnswered = chosen !== undefined;
            const isCorrect = chosen === q.correctIndex;

            return (
              <div
                key={q.id}
                className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl space-y-3.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      ข้อที่ {q.id} · {q.category}
                    </div>
                    <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-1">
                      {q.question}
                    </h2>
                  </div>
                  {isAnswered && (
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-semibold shrink-0 ${
                        isCorrect
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-rose-700 dark:text-rose-400'
                      }`}
                    >
                      {isCorrect ? (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          ถูกต้อง
                        </>
                      ) : (
                        <>
                          <XCircle className="w-4 h-4" />
                          ยังไม่ถูก
                        </>
                      )}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-2">
                  {q.options.map((opt, idx) => {
                    const isThisChosen = chosen === idx;
                    const isThisCorrect = q.correctIndex === idx;

                    let styleClass =
                      'bg-white dark:bg-slate-950/60 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-700';
                    if (isAnswered) {
                      if (isThisCorrect) {
                        styleClass =
                          'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-600 dark:border-emerald-500 text-emerald-950 dark:text-emerald-100 font-medium';
                      } else if (isThisChosen) {
                        styleClass =
                          'bg-rose-50 dark:bg-rose-950/50 border-rose-400 dark:border-rose-600 text-rose-900 dark:text-rose-200';
                      } else {
                        styleClass =
                          'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400';
                      }
                    }

                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleSelectOption(q.id, idx)}
                        className={`text-left px-4 py-3 rounded-xl border text-sm transition-colors cursor-pointer flex items-start gap-3 ${styleClass}`}
                      >
                        <span className="font-mono-num text-xs font-semibold mt-0.5 shrink-0">
                          {idx + 1}.
                        </span>
                        <span>{opt}</span>
                      </button>
                    );
                  })}
                </div>

                {isAnswered && (
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                    <strong className="text-slate-900 dark:text-slate-100">คำอธิบายตามคู่มือ:</strong>{' '}
                    {q.explanation}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
