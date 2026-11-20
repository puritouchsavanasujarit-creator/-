import { Flame, Moon, Sun } from 'lucide-react';
import type { AppTab } from '@/src/types';
import type { DailyStreakSummary } from '@/src/lib/streak';
import { useFirebaseAuth } from '@/src/contexts/FirebaseContext';
import { useTheme } from '@/src/contexts/ThemeContext';

interface TopBarProps {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  streakSummary: DailyStreakSummary;
}

const NAV_ITEMS: Array<{ id: AppTab; label: string }> = [
  { id: 'simulator', label: 'จำลองแชท' },
  { id: 'mentor', label: 'โค้ช AI & ค้นหา' },
  { id: 'quiz', label: 'แบบทดสอบ SOP' },
  { id: 'playbook', label: 'คู่มือและสินค้า' },
  { id: 'progress', label: 'ผลประเมินของฉัน' },
];

export function TopBar({ activeTab, onSelectTab, streakSummary }: TopBarProps) {
  const { user, authReady, isSigningIn, signInWithGoogle, logout } = useFirebaseAuth();
  const { isDark, toggleTheme } = useTheme();
  const shortName = user?.displayName?.split(' ')[0] || 'บัญชีของฉัน';

  const { currentStreak, longestStreak, completedToday } = streakSummary;

  const streakTooltip = completedToday
    ? `ฝึกต่อเนื่อง ${currentStreak} วัน (สถิติสูงสุด ${longestStreak} วัน) · วันนี้ฝึกสำเร็จแล้ว`
    : currentStreak > 0
      ? `ฝึกต่อเนื่อง ${currentStreak} วัน (สถิติสูงสุด ${longestStreak} วัน) · จบ 1 เคสวันนี้เพื่อต่อสตรีคเป็น ${currentStreak + 1} วัน`
      : 'ยังไม่มีสถิติฝึกต่อเนื่อง · จบการจำลองแชท 1 เคสวันนี้เพื่อเริ่มนับสตรีค';

  const streakButtonStyle = completedToday
    ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-300 dark:border-amber-700/80 text-amber-900 dark:text-amber-200 hover:bg-amber-100/80 dark:hover:bg-amber-900/50'
    : currentStreak > 0
      ? 'bg-amber-50/60 dark:bg-slate-800 border-amber-200 dark:border-amber-700/60 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-slate-700'
      : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700';

  return (
    <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800 transition-colors">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3 sm:gap-6">
        {/* Zone 1: Single-element wordmark */}
        <button
          type="button"
          onClick={() => onSelectTab('simulator')}
          className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600 cursor-pointer"
        >
          ChatCraft Studio
        </button>

        {/* Zone 2: 5 clean single-line text navigation links */}
        <nav className="flex items-center gap-4 sm:gap-6 overflow-x-auto" aria-label="เมนูหลัก">
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`relative py-2 text-sm font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600 ${
                  isActive
                    ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {item.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-[17px] h-0.5 bg-emerald-600 dark:bg-emerald-400"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Daily streak, Theme toggle & primary auth action */}
        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => onSelectTab('progress')}
            title={streakTooltip}
            aria-label={streakTooltip}
            className={`inline-flex items-center justify-center gap-1.5 h-10 px-2.5 sm:px-3 text-xs font-semibold border rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-emerald-600 ${streakButtonStyle}`}
          >
            <Flame
              className={`w-4 h-4 shrink-0 ${
                currentStreak > 0
                  ? 'text-amber-500 dark:text-amber-400 fill-amber-400/30'
                  : 'text-slate-400 dark:text-slate-500'
              }`}
            />
            <span className="font-mono-num">{currentStreak}</span>
            <span className="hidden md:inline">วันติดกัน</span>
            {completedToday ? (
              <span
                aria-hidden="true"
                className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 shrink-0"
              />
            ) : currentStreak > 0 ? (
              <span
                aria-hidden="true"
                className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0"
              />
            ) : null}
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            aria-pressed={isDark}
            aria-label={isDark ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด'}
            title={isDark ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'}
            className="inline-flex items-center justify-center gap-1.5 h-10 px-3 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-emerald-600"
          >
            {isDark ? (
              <>
                <Sun className="w-4 h-4 text-amber-400" />
                <span className="hidden sm:inline">โหมดสว่าง</span>
              </>
            ) : (
              <>
                <Moon className="w-4 h-4 text-slate-600" />
                <span className="hidden sm:inline">โหมดมืด</span>
              </>
            )}
          </button>

          {!authReady ? (
            <span className="text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap">
              กำลังตรวจสอบ...
            </span>
          ) : user ? (
            <button
              type="button"
              onClick={logout}
              className="px-3.5 py-2 h-10 text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {shortName} · ออกจากระบบ
            </button>
          ) : (
            <button
              type="button"
              onClick={signInWithGoogle}
              disabled={isSigningIn}
              className="px-4 py-2 h-10 text-xs sm:text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isSigningIn ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ Google'}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
