import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { auth, db } from '@/src/lib/firebase';
import type { ChatMessage, QuizProgress, SavedAttempt } from '@/src/types';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: Array<{
      providerId?: string | null;
      email?: string | null;
    }>;
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function clampStr(val: string, maxLen: number): string {
  const trimmed = val.trim();
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

export function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned.slice(0, 128) || 'id';
}

export async function syncUserProfile(user: User): Promise<void> {
  const profilePath = `users/${user.uid}`;
  const privatePath = `users/${user.uid}/private/info`;
  const displayName = clampStr(user.displayName || 'ผู้ฝึกอบรม', 120);
  const photoURL = user.photoURL ? clampStr(user.photoURL, 512) : undefined;

  try {
    const profileRef = doc(db, 'users', user.uid);
    const snap = await getDoc(profileRef);
    if (!snap.exists()) {
      await setDoc(profileRef, {
        uid: user.uid,
        displayName,
        ...(photoURL ? { photoURL } : {}),
        role: 'trainee',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(profileRef, {
        displayName,
        ...(photoURL ? { photoURL } : {}),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, profilePath);
  }

  if (user.email) {
    try {
      const privateRef = doc(db, 'users', user.uid, 'private', 'info');
      const privateSnap = await getDoc(privateRef);
      const safeEmail = clampStr(user.email, 254);
      if (!privateSnap.exists()) {
        await setDoc(privateRef, {
          userId: user.uid,
          email: safeEmail,
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(privateRef, {
          email: safeEmail,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, privatePath);
    }
  }
}

export async function saveAttemptDoc(uid: string, attempt: SavedAttempt): Promise<void> {
  const safeId = sanitizeId(attempt.id);
  const path = `users/${uid}/attempts/${safeId}`;
  try {
    await setDoc(doc(db, 'users', uid, 'attempts', safeId), {
      id: safeId,
      userId: uid,
      scenarioId: clampStr(attempt.scenarioId, 64),
      scenarioTitle: clampStr(attempt.scenarioTitle, 200),
      messageCount: Math.max(1, Math.min(500, Math.round(attempt.messageCount))),
      overallScore: Math.max(0, Math.min(100, Math.round(attempt.overallScore))),
      gradeLabel: clampStr(attempt.gradeLabel, 120),
      summaryVerdict: clampStr(attempt.summaryVerdict, 2000),
      dimensions: attempt.dimensions.slice(0, 5).map((d) => ({
        name: clampStr(d.name, 160),
        score: Math.max(0, Math.min(100, Math.round(d.score))),
        comment: clampStr(d.comment, 500),
      })),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export function subscribeAttempts(
  uid: string,
  onData: (attempts: SavedAttempt[]) => void
): () => void {
  const path = `users/${uid}/attempts`;
  const q = query(
    collection(db, 'users', uid, 'attempts'),
    where('userId', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(365)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items: SavedAttempt[] = snapshot.docs.map((d) => {
        const data = d.data();
        const createdAt =
          data.createdAt instanceof Timestamp
            ? data.createdAt.toDate().toISOString()
            : new Date().toISOString();
        return {
          id: String(data.id || d.id),
          scenarioId: String(data.scenarioId || ''),
          scenarioTitle: String(data.scenarioTitle || ''),
          dateIso: createdAt,
          messageCount: Number(data.messageCount || 0),
          overallScore: Number(data.overallScore || 0),
          gradeLabel: String(data.gradeLabel || ''),
          dimensions: Array.isArray(data.dimensions) ? data.dimensions : [],
          summaryVerdict: String(data.summaryVerdict || ''),
        };
      });
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function saveQuizSummaryDoc(
  uid: string,
  bestScore: number,
  totalQuestions: number
): Promise<void> {
  const path = `users/${uid}/quiz/summary`;
  try {
    const ref = doc(db, 'users', uid, 'quiz', 'summary');
    const snap = await getDoc(ref);
    const safeBest = Math.max(0, Math.min(100, Math.round(bestScore)));
    const safeTotal = Math.max(1, Math.min(100, Math.round(totalQuestions)));
    if (!snap.exists()) {
      await setDoc(ref, {
        userId: uid,
        bestScore: safeBest,
        totalQuestions: safeTotal,
        updatedAt: serverTimestamp(),
      });
    } else {
      const prevBest = Number(snap.data().bestScore || 0);
      await updateDoc(ref, {
        bestScore: Math.max(prevBest, safeBest),
        totalQuestions: safeTotal,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeQuizSummary(
  uid: string,
  onData: (progress: QuizProgress | null) => void
): () => void {
  const path = `users/${uid}/quiz/summary`;
  const ref = doc(db, 'users', uid, 'quiz', 'summary');
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const data = snap.data();
      const updatedAt =
        data.updatedAt instanceof Timestamp
          ? data.updatedAt.toDate().toISOString()
          : new Date().toISOString();
      onData({
        bestScore: Number(data.bestScore || 0),
        totalQuestions: Number(data.totalQuestions || 19),
        lastAttemptIso: updatedAt,
      });
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}

export async function ensureChatSessionDoc(
  uid: string,
  sessionId: string,
  scenarioId: string,
  title: string
): Promise<void> {
  const safeSessionId = sanitizeId(sessionId);
  const path = `users/${uid}/sessions/${safeSessionId}`;
  try {
    const ref = doc(db, 'users', uid, 'sessions', safeSessionId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        id: safeSessionId,
        userId: uid,
        scenarioId: clampStr(scenarioId, 64),
        title: clampStr(title, 200),
        currentStage: 1,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function createChatSessionDoc(
  uid: string,
  sessionId: string,
  scenarioId: string,
  title: string
): Promise<void> {
  return ensureChatSessionDoc(uid, sessionId, scenarioId, title);
}

export async function updateChatSessionDoc(
  uid: string,
  sessionId: string,
  currentStage: number,
  status: 'active' | 'evaluated'
): Promise<void> {
  const safeSessionId = sanitizeId(sessionId);
  const path = `users/${uid}/sessions/${safeSessionId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'sessions', safeSessionId), {
      currentStage: Math.max(1, Math.min(6, Math.round(currentStage))),
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function appendSessionMessageDoc(
  uid: string,
  sessionId: string,
  message: ChatMessage
): Promise<void> {
  const safeSessionId = sanitizeId(sessionId);
  const safeMsgId = sanitizeId(message.id);
  const path = `users/${uid}/sessions/${safeSessionId}/messages/${safeMsgId}`;
  try {
    await setDoc(doc(db, 'users', uid, 'sessions', safeSessionId, 'messages', safeMsgId), {
      id: safeMsgId,
      sessionId: safeSessionId,
      userId: uid,
      role: message.role,
      text: clampStr(message.text, 4000) || '...',
      ...(message.attachmentLabel
        ? { attachmentLabel: clampStr(message.attachmentLabel, 200) }
        : {}),
      timestampLabel: clampStr(message.timestamp || '00:00', 32),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function appendMentorMessageDoc(
  uid: string,
  messageId: string,
  role: 'admin' | 'mentor',
  text: string,
  timestampLabel: string
): Promise<void> {
  const safeMsgId = sanitizeId(messageId);
  const path = `users/${uid}/mentorMessages/${safeMsgId}`;
  try {
    await setDoc(doc(db, 'users', uid, 'mentorMessages', safeMsgId), {
      id: safeMsgId,
      sessionId: 'mentor',
      userId: uid,
      role,
      text: clampStr(text, 4000) || '...',
      timestampLabel: clampStr(timestampLabel, 32),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export function subscribeMentorMessages(
  uid: string,
  onData: (messages: Array<{ id: string; role: 'user' | 'model'; text: string; timestamp: string }>) => void
): () => void {
  const path = `users/${uid}/mentorMessages`;
  const q = query(
    collection(db, 'users', uid, 'mentorMessages'),
    where('userId', '==', uid),
    orderBy('createdAt', 'asc'),
    limit(60)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: String(data.id || d.id),
          role: (data.role === 'admin' ? 'user' : 'model') as 'user' | 'model',
          text: String(data.text || ''),
          timestamp: String(data.timestampLabel || ''),
        };
      });
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function clearAllUserProgress(uid: string): Promise<void> {
  try {
    const attemptsSnap = await getDocs(
      query(collection(db, 'users', uid, 'attempts'), where('userId', '==', uid))
    );
    await Promise.all(attemptsSnap.docs.map((d) => deleteDoc(d.ref)));

    const quizRef = doc(db, 'users', uid, 'quiz', 'summary');
    const quizSnap = await getDoc(quizRef);
    if (quizSnap.exists()) {
      await deleteDoc(quizRef);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `users/${uid}`);
  }
}

export async function clearMentorHistory(uid: string): Promise<void> {
  const path = `users/${uid}/mentorMessages`;
  try {
    const snap = await getDocs(
      query(collection(db, 'users', uid, 'mentorMessages'), where('userId', '==', uid))
    );
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
