import type { AppTab } from '@/src/types';
import { useFirebaseAuth } from '@/src/contexts/FirebaseContext';

interface TopBarProps {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
}

const NAV_ITEMS: Array<{ id: AppTab; label: string }> = [
  { id: 'simulator', label: 'จำลองแชท' },
  { id: 'mentor', label: 'โค้ช AI & ค้นหา' },
  { id: 'quiz', label: 'แบบทดสอบ SOP' },
  { id: 'playbook', label: 'คู่มือและสินค้า' },
  { id: 'progress', label: 'ผลประเมินของฉัน' },
];

export function TopBar({ activeTab, onSelectTab }: TopBarProps) {
  const { user, authReady, isSigningIn, signInWithGoogle, logout } = useFirebaseAuth();
  const shortName = user?.displayName?.split(' ')[0] || 'บัญชีของฉัน';

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single-element wordmark */}
        <button
          type="button"
          onClick={() => onSelectTab('simulator')}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600 cursor-pointer"
        >
          ChatCraft Studio
        </button>

        {/* Zone 2: 5 clean single-line text navigation links */}
        <nav className="flex items-center gap-5 sm:gap-6 overflow-x-auto" aria-label="เมนูหลัก">
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`relative py-2 text-sm font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600 ${
                  isActive
                    ? 'text-emerald-700 font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-[17px] h-0.5 bg-emerald-600"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single primary action */}
        <div className="shrink-0">
          {!authReady ? (
            <span className="text-xs text-slate-400 whitespace-nowrap">กำลังตรวจสอบ...</span>
          ) : user ? (
            <button
              type="button"
              onClick={logout}
              className="px-3.5 py-2 text-xs sm:text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {shortName} · ออกจากระบบ
            </button>
          ) : (
            <button
              type="button"
              onClick={signInWithGoogle}
              disabled={isSigningIn}
              className="px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:bg-slate-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isSigningIn ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ Google'}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
