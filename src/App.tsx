import { useState, useEffect } from 'react';
import { TRAINING_SCENARIOS } from '@/src/data/playbookData';
import type { AppTab, SavedAttempt, QuizProgress } from '@/src/types';
import { FirebaseProvider, useFirebaseAuth } from '@/src/contexts/FirebaseContext';
import { ThemeProvider } from '@/src/contexts/ThemeContext';
import { ToastProvider, useToast } from '@/src/contexts/ToastContext';
import {
  clearAllUserProgress,
  saveAttemptDoc,
  saveQuizSummaryDoc,
  subscribeAttempts,
  subscribeQuizSummary,
} from '@/src/lib/firestoreRepo';
import { TopBar } from '@/src/components/TopBar';
import { SimulatorView } from '@/src/components/SimulatorView';
import { MentorAndGroundingView } from '@/src/components/MentorAndGroundingView';
import { QuizView } from '@/src/components/QuizView';
import { PlaybookView } from '@/src/components/PlaybookView';
import { ProgressView } from '@/src/components/ProgressView';

const ATTEMPTS_STORAGE_KEY = 'chatcraft_saved_attempts_v1';
const QUIZ_STORAGE_KEY = 'chatcraft_quiz_progress_v1';

function AppShell() {
  const { user, authReady, authError, signInWithGoogle } = useFirebaseAuth();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<AppTab>('simulator');
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(TRAINING_SCENARIOS[0].id);
  const [resetSignal, setResetSignal] = useState(0);

  const [localAttempts, setLocalAttempts] = useState<SavedAttempt[]>(() => {
    try {
      const raw = localStorage.getItem(ATTEMPTS_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as SavedAttempt[]) : [];
    } catch {
      return [];
    }
  });

  const [localQuizProgress, setLocalQuizProgress] = useState<QuizProgress | null>(() => {
    try {
      const raw = localStorage.getItem(QUIZ_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as QuizProgress) : null;
    } catch {
      return null;
    }
  });

  const [cloudAttempts, setCloudAttempts] = useState<SavedAttempt[]>([]);
  const [cloudQuizProgress, setCloudQuizProgress] = useState<QuizProgress | null>(null);

  useEffect(() => {
    if (!authReady || !user) {
      setCloudAttempts([]);
      setCloudQuizProgress(null);
      return;
    }

    const unsubAttempts = subscribeAttempts(user.uid, setCloudAttempts);
    const unsubQuiz = subscribeQuizSummary(user.uid, setCloudQuizProgress);
    return () => {
      unsubAttempts();
      unsubQuiz();
    };
  }, [authReady, user]);

  useEffect(() => {
    try {
      localStorage.setItem(ATTEMPTS_STORAGE_KEY, JSON.stringify(localAttempts));
    } catch {
      // Ignore storage errors
    }
  }, [localAttempts]);

  useEffect(() => {
    try {
      if (localQuizProgress) {
        localStorage.setItem(QUIZ_STORAGE_KEY, JSON.stringify(localQuizProgress));
      } else {
        localStorage.removeItem(QUIZ_STORAGE_KEY);
      }
    } catch {
      // Ignore storage errors
    }
  }, [localQuizProgress]);

  const attempts = user ? cloudAttempts : localAttempts;
  const quizProgress = user ? cloudQuizProgress : localQuizProgress;

  const handleSaveAttempt = async (attempt: SavedAttempt) => {
    if (user) {
      try {
        await saveAttemptDoc(user.uid, attempt);
        showToast({
          variant: 'success',
          title: 'บันทึกผลการฝึกซ้อมแล้ว',
          description: `${attempt.scenarioTitle} · คะแนน ${attempt.overallScore}/100`,
        });
      } catch (err) {
        console.error('Failed to save attempt to Firestore:', err);
        showToast({
          variant: 'error',
          title: 'บันทึกผลการฝึกซ้อมไม่สำเร็จ',
          description: 'เกิดข้อผิดพลาดระหว่างบันทึกลง Cloud กรุณาลองใหม่อีกครั้ง',
        });
      }
    } else {
      setLocalAttempts((prev) => [attempt, ...prev].slice(0, 365));
      showToast({
        variant: 'success',
        title: 'บันทึกผลการฝึกซ้อมแล้ว',
        description: `${attempt.scenarioTitle} · คะแนน ${attempt.overallScore}/100`,
      });
    }
  };

  const handleCompleteQuiz = async (score: number, total: number) => {
    const percent = total > 0 ? Math.round((score / total) * 100) : 0;
    if (user) {
      try {
        await saveQuizSummaryDoc(user.uid, score, total);
        showToast({
          variant: 'success',
          title: 'บันทึกผลแบบทดสอบสำเร็จ',
          description: `ได้คะแนน ${score}/${total} ข้อ (${percent}%)`,
        });
      } catch (err) {
        console.error('Failed to save quiz to Firestore:', err);
        showToast({
          variant: 'error',
          title: 'บันทึกผลแบบทดสอบไม่สำเร็จ',
          description: 'เกิดข้อผิดพลาดระหว่างบันทึกลง Cloud กรุณาลองใหม่อีกครั้ง',
        });
      }
    } else {
      setLocalQuizProgress((prev) => ({
        bestScore: prev ? Math.max(prev.bestScore, score) : score,
        totalQuestions: total,
        lastAttemptIso: new Date().toISOString(),
      }));
      showToast({
        variant: 'success',
        title: 'บันทึกผลแบบทดสอบสำเร็จ',
        description: `ได้คะแนน ${score}/${total} ข้อ (${percent}%)`,
      });
    }
  };

  const handleClearHistory = async () => {
    if (user) {
      try {
        await clearAllUserProgress(user.uid);
      } catch (err) {
        console.error('Failed to clear Firestore history:', err);
      }
    } else {
      setLocalAttempts([]);
      setLocalQuizProgress(null);
    }
  };

  const handleOpenScenarioFromProgress = (scenarioId: string) => {
    setSelectedScenarioId(scenarioId);
    setActiveTab('simulator');
    setResetSignal((n) => n + 1);
  };

  const completedScenarioIds = Array.from(new Set(attempts.map((a) => a.scenarioId)));

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] dark:bg-slate-950 text-[#0F172A] dark:text-slate-100 transition-colors">
      <TopBar activeTab={activeTab} onSelectTab={setActiveTab} />

      {authReady && !user && (
        <div className="bg-slate-900 dark:bg-slate-900/95 dark:border-b dark:border-slate-800 text-white text-xs px-4 py-2">
          <div className="max-w-[1400px] mx-auto flex flex-wrap items-center justify-between gap-2">
            <span>
              เข้าสู่ระบบด้วย Google เพื่อบันทึกประวัติการฝึกตอบแชท ผลคะแนน และแชทพี่โค้ช AI บน Cloud อัตโนมัติ
            </span>
            <button
              type="button"
              onClick={signInWithGoogle}
              className="font-semibold text-emerald-300 hover:text-emerald-200 underline cursor-pointer"
            >
              เข้าสู่ระบบเลย
            </button>
          </div>
        </div>
      )}

      {authError && (
        <div className="bg-rose-50 dark:bg-rose-950/60 border-b border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs px-4 py-2">
          <div className="max-w-[1400px] mx-auto">{authError}</div>
        </div>
      )}

      <main className="flex-1">
        {activeTab === 'simulator' && (
          <SimulatorView
            selectedScenarioId={selectedScenarioId}
            onSelectScenarioId={setSelectedScenarioId}
            resetSignal={resetSignal}
            onSaveAttempt={handleSaveAttempt}
            completedScenarioIds={completedScenarioIds}
          />
        )}
        {activeTab === 'mentor' && (
          <MentorAndGroundingView activeScenarioId={selectedScenarioId} />
        )}
        {activeTab === 'quiz' && <QuizView onCompleteQuiz={handleCompleteQuiz} />}
        {activeTab === 'playbook' && <PlaybookView />}
        {activeTab === 'progress' && (
          <ProgressView
            attempts={attempts}
            quizProgress={quizProgress}
            onClearHistory={handleClearHistory}
            onOpenScenario={handleOpenScenarioFromProgress}
          />
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <FirebaseProvider>
          <AppShell />
        </FirebaseProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
