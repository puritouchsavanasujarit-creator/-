export type AppTab = 'simulator' | 'mentor' | 'quiz' | 'playbook' | 'progress';

export interface ChatMessage {
  id: string;
  role: 'customer' | 'admin';
  text: string;
  timestamp: string;
  attachmentLabel?: string;
}

export interface LiveCoachFeedback {
  customerMood: string;
  stageDetected: number;
  isDealClosed: boolean;
  endedWithQuestion: boolean;
  toneScore: number;
  sopAccuracyNote: string;
  coachingTip: string;
  betterExample: string;
}

export interface EvaluationDimension {
  name: string;
  score: number;
  comment: string;
}

export interface CheckpointResult {
  label: string;
  passed: boolean;
  note: string;
}

export interface SessionEvaluation {
  overallScore: number;
  gradeLabel: string;
  dimensions: EvaluationDimension[];
  checkpointResults: CheckpointResult[];
  strengths: string[];
  improvements: string[];
  summaryVerdict: string;
}

export interface SavedAttempt {
  id: string;
  scenarioId: string;
  scenarioTitle: string;
  dateIso: string;
  messageCount: number;
  overallScore: number;
  gradeLabel: string;
  dimensions: EvaluationDimension[];
  summaryVerdict: string;
}

export interface QuizProgress {
  bestScore: number;
  totalQuestions: number;
  lastAttemptIso: string;
}
