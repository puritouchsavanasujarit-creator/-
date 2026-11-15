import type { SavedAttempt } from '@/src/types';

export interface DailyStreakDay {
  dateKey: string;
  weekdayLabel: string;
  dayOfMonth: number;
  completed: boolean;
  isToday: boolean;
}

export interface DailyStreakSummary {
  currentStreak: number;
  longestStreak: number;
  completedToday: boolean;
  totalActiveDays: number;
  last7Days: DailyStreakDay[];
}

const THAI_SHORT_WEEKDAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'] as const;

export function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKeyToUtcDayNumber(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

function addLocalDays(base: Date, deltaDays: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + deltaDays);
}

export function computeDailyStreak(
  attempts: SavedAttempt[],
  now: Date = new Date()
): DailyStreakSummary {
  const completedDayKeys = new Set<string>();

  for (const attempt of attempts) {
    if (!attempt.dateIso) continue;
    const parsed = new Date(attempt.dateIso);
    if (Number.isNaN(parsed.getTime())) continue;
    completedDayKeys.add(toLocalDateKey(parsed));
  }

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayKey = toLocalDateKey(today);
  const yesterday = addLocalDays(today, -1);
  const yesterdayKey = toLocalDateKey(yesterday);

  const completedToday = completedDayKeys.has(todayKey);

  // Count consecutive days anchored on today (if completed today) or yesterday (streak still alive)
  let currentStreak = 0;
  if (completedToday || completedDayKeys.has(yesterdayKey)) {
    let cursor = completedToday ? today : yesterday;
    while (completedDayKeys.has(toLocalDateKey(cursor))) {
      currentStreak += 1;
      cursor = addLocalDays(cursor, -1);
    }
  }

  // Compute longest historical streak across all recorded days
  let longestStreak = 0;
  if (completedDayKeys.size > 0) {
    const sortedDayNumbers = Array.from(completedDayKeys)
      .map(parseDateKeyToUtcDayNumber)
      .sort((a, b) => a - b);

    let run = 1;
    longestStreak = 1;
    for (let i = 1; i < sortedDayNumbers.length; i += 1) {
      if (sortedDayNumbers[i] - sortedDayNumbers[i - 1] === 1) {
        run += 1;
        if (run > longestStreak) {
          longestStreak = run;
        }
      } else {
        run = 1;
      }
    }
  }

  // Last 7 days ending today (oldest -> newest)
  const last7Days: DailyStreakDay[] = [];
  for (let offset = -6; offset <= 0; offset += 1) {
    const d = addLocalDays(today, offset);
    const dateKey = toLocalDateKey(d);
    last7Days.push({
      dateKey,
      weekdayLabel: THAI_SHORT_WEEKDAYS[d.getDay()],
      dayOfMonth: d.getDate(),
      completed: completedDayKeys.has(dateKey),
      isToday: offset === 0,
    });
  }

  return {
    currentStreak,
    longestStreak,
    completedToday,
    totalActiveDays: completedDayKeys.size,
    last7Days,
  };
}

export interface DailyTrendPoint {
  dateKey: string;
  label: string;
  fullDateLabel: string;
  avgScore: number | null;
  sessionCount: number;
}

export function computeLast30DaysTrend(
  attempts: SavedAttempt[],
  now: Date = new Date()
): DailyTrendPoint[] {
  const dayBuckets = new Map<string, { scoreSum: number; count: number }>();

  for (const attempt of attempts) {
    if (!attempt.dateIso) continue;
    const parsed = new Date(attempt.dateIso);
    if (Number.isNaN(parsed.getTime())) continue;
    const key = toLocalDateKey(parsed);
    const bucket = dayBuckets.get(key) || { scoreSum: 0, count: 0 };
    bucket.scoreSum += Number(attempt.overallScore || 0);
    bucket.count += 1;
    dayBuckets.set(key, bucket);
  }

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const points: DailyTrendPoint[] = [];

  for (let offset = -29; offset <= 0; offset += 1) {
    const d = addLocalDays(today, offset);
    const dateKey = toLocalDateKey(d);
    const bucket = dayBuckets.get(dateKey);

    points.push({
      dateKey,
      label: d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }),
      fullDateLabel: d.toLocaleDateString('th-TH', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      }),
      avgScore: bucket ? Math.round(bucket.scoreSum / bucket.count) : null,
      sessionCount: bucket ? bucket.count : 0,
    });
  }

  return points;
}
