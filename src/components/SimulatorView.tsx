import { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  Send,
  Lightbulb,
  ImagePlus,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Calculator,
  BookOpen,
  Award,
  RotateCcw,
  Copy,
  Check,
  Loader2,
  MapPin,
  ExternalLink,
  MessageSquareText,
  ChevronDown,
  X,
  Pencil,
  Plus,
  Trash2,
  GripVertical,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import {
  TRAINING_SCENARIOS,
  SALES_STAGES,
  PRODUCT_SETS,
  CHAT_SCRIPTS,
  UPSELL_OPTIONS,
  calculateShipping,
} from '@/src/data/playbookData';
import type { TrainingScenario } from '@/src/data/playbookData';
import { PRODUCT_IMAGE_MAP } from '@/src/data/productImages';
import type {
  ChatMessage,
  LiveCoachFeedback,
  SessionEvaluation,
  SavedAttempt,
} from '@/src/types';
import { useFirebaseAuth } from '@/src/contexts/FirebaseContext';
import {
  appendSessionMessageDoc,
  ensureChatSessionDoc,
  updateChatSessionDoc,
} from '@/src/lib/firestoreRepo';
import { EvaluationModal } from '@/src/components/EvaluationModal';
import {
  getOrderedChatIndices,
  getOrderedProductIds,
  getOrderedUpsellIds,
  moveItemByKey,
  parseStoredOverrides,
  resolveChatScript,
  resolveProductInfo,
  resolveUpsellOption,
  saveStoredOverrides,
  stepItemInOrder,
  type CustomChatScript,
  type ScriptOverrides,
} from '@/src/lib/scriptOverrides';

interface SimulatorViewProps {
  selectedScenarioId: string;
  onSelectScenarioId: (id: string) => void;
  resetSignal: number;
  onSaveAttempt: (attempt: SavedAttempt) => void;
  completedScenarioIds: string[];
}

type CompanionTab = 'coach' | 'shipping' | 'scripts';

interface EditDraft {
  title: string;
  category: string;
  text: string;
  priceText: string;
  bestFor: string;
  code: string;
  name: string;
  price: string;
  occasions: string;
}

const EMPTY_DRAFT: EditDraft = {
  title: '',
  category: '',
  text: '',
  priceText: '',
  bestFor: '',
  code: '',
  name: '',
  price: '',
  occasions: '',
};

function getCurrentTimeLabel(): string {
  const now = new Date();
  return now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

type DifficultyFilter = 'all' | TrainingScenario['difficulty'];

const DIFFICULTY_META: Record<
  TrainingScenario['difficulty'],
  {
    label: string;
    englishLabel: string;
    level: 1 | 2 | 3;
    badgeClass: string;
    activeBarClass: string;
    inactiveBarClass: string;
  }
> = {
  พื้นฐาน: {
    label: 'พื้นฐาน',
    englishLabel: 'Easy',
    level: 1,
    badgeClass:
      'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/80',
    activeBarClass: 'bg-emerald-600 dark:bg-emerald-400',
    inactiveBarClass: 'bg-emerald-200 dark:bg-emerald-900',
  },
  กลาง: {
    label: 'ปานกลาง',
    englishLabel: 'Medium',
    level: 2,
    badgeClass:
      'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800/80',
    activeBarClass: 'bg-amber-500 dark:bg-amber-400',
    inactiveBarClass: 'bg-amber-200 dark:bg-amber-900',
  },
  ท้าทาย: {
    label: 'ท้าทาย',
    englishLabel: 'Hard',
    level: 3,
    badgeClass:
      'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/80',
    activeBarClass: 'bg-rose-600 dark:bg-rose-400',
    inactiveBarClass: 'bg-rose-200 dark:bg-rose-900',
  },
};

export function SimulatorView({
  selectedScenarioId,
  onSelectScenarioId,
  resetSignal,
  onSaveAttempt,
  completedScenarioIds,
}: SimulatorViewProps) {
  const scenario: TrainingScenario =
    TRAINING_SCENARIOS.find((s) => s.id === selectedScenarioId) ?? TRAINING_SCENARIOS[0];

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [attachPhotoSet, setAttachPhotoSet] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isRequestingHint, setIsRequestingHint] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [currentStage, setCurrentStage] = useState(1);
  const [liveFeedback, setLiveFeedback] = useState<LiveCoachFeedback | null>(null);
  const [hintBox, setHintBox] = useState<{ focusPoint: string; suggestedReply: string } | null>(
    null
  );
  const [evaluation, setEvaluation] = useState<SessionEvaluation | null>(null);

  const [companionTab, setCompanionTab] = useState<CompanionTab>('coach');
  const [difficultyFilter, setDifficultyFilter] = useState<DifficultyFilter>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [scriptSearch, setScriptSearch] = useState('');
  const [scriptCategoryFilter, setScriptCategoryFilter] = useState('ทั้งหมด');
  const [scriptOverrides, setScriptOverrides] = useState<ScriptOverrides>(parseStoredOverrides);
  const [dragItem, setDragItem] = useState<{
    kind: 'customChat' | 'chat' | 'upsell' | 'product';
    key: string;
  } | null>(null);
  const [dragOverItem, setDragOverItem] = useState<{
    kind: 'customChat' | 'chat' | 'upsell' | 'product';
    key: string;
  } | null>(null);
  const [editingScript, setEditingScript] = useState<{
    kind: 'chat' | 'customChat' | 'upsell' | 'product';
    key: string;
  } | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>(EMPTY_DRAFT);
  const [isAddingCustomScript, setIsAddingCustomScript] = useState(false);
  const [newCustomDraft, setNewCustomDraft] = useState({
    title: '',
    category: 'กำหนดเอง',
    text: '',
  });

  // Shipping calculator state synced with active scenario defaults
  const [calcSubtotal, setCalcSubtotal] = useState<number>(scenario.budgetHint);
  const [calcDistance, setCalcDistance] = useState<number>(scenario.distanceKm);
  const [calcUrgent, setCalcUrgent] = useState<boolean>(Boolean(scenario.isUrgent));
  const [calcUpcountry, setCalcUpcountry] = useState<boolean>(Boolean(scenario.isUpcountry));
  const [calcSaturday, setCalcSaturday] = useState<boolean>(false);

  const { user } = useFirebaseAuth();
  const [sessionId, setSessionId] = useState<string>(`sess_${Date.now()}`);
  const [mapQuery, setMapQuery] = useState<string>('');
  const [isCheckingMap, setIsCheckingMap] = useState(false);
  const [mapLookupResult, setMapLookupResult] = useState<{
    answerMarkdown: string;
    places: Array<{ title: string; uri: string }>;
    notice?: string;
  } | null>(null);

  const [isScriptPickerOpen, setIsScriptPickerOpen] = useState(false);
  const [quickScriptQuery, setQuickScriptQuery] = useState('');

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const scriptPickerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!isScriptPickerOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        scriptPickerRef.current &&
        !scriptPickerRef.current.contains(event.target as Node)
      ) {
        setIsScriptPickerOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsScriptPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isScriptPickerOpen]);

  useEffect(() => {
    saveStoredOverrides(scriptOverrides);
  }, [scriptOverrides]);

  const resetConversation = (target: TrainingScenario) => {
    const nextSessId = `sess_${Date.now()}`;
    const initMsg: ChatMessage = {
      id: `cust_init_${Date.now()}`,
      role: 'customer',
      text: target.openingMessage,
      timestamp: getCurrentTimeLabel(),
    };

    setSessionId(nextSessId);
    setMessages([initMsg]);
    setInputText('');
    setAttachPhotoSet(false);
    setCurrentStage(1);
    setLiveFeedback(null);
    setHintBox(null);
    setEvaluation(null);
    setErrorMsg(null);
    setCalcSubtotal(target.budgetHint);
    setCalcDistance(target.distanceKm);
    setCalcUrgent(Boolean(target.isUrgent));
    setCalcUpcountry(Boolean(target.isUpcountry));
    setCalcSaturday(false);
    setMapLookupResult(null);

    if (user) {
      ensureChatSessionDoc(user.uid, nextSessId, target.id, target.title)
        .then(() => appendSessionMessageDoc(user.uid, nextSessId, initMsg))
        .catch((e) => console.error('Failed to init Firestore session:', e));
    }
  };

  useEffect(() => {
    resetConversation(scenario);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario.id, resetSignal]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  const adminMessageCount = messages.filter((m) => m.role === 'admin').length;

  const handleSendMessage = async () => {
    const trimmed = inputText.trim();
    if (!trimmed && !attachPhotoSet) return;
    if (isSending) return;

    const finalText = trimmed || 'ส่งรูปภาพแบบกระเช้าผลไม้ 8–12 แบบตามงบประมาณให้ลูกค้าชมค่ะ';
    const newMsg: ChatMessage = {
      id: `admin-${Date.now()}`,
      role: 'admin',
      text: finalText,
      timestamp: getCurrentTimeLabel(),
      attachmentLabel: attachPhotoSet ? 'แนบรูปชุดผลไม้ 8–12 แบบตามงบประมาณ' : undefined,
    };

    const nextMessages = [...messages, newMsg];
    setMessages(nextMessages);
    setInputText('');
    setAttachPhotoSet(false);
    setHintBox(null);
    setErrorMsg(null);
    setIsSending(true);

    if (user) {
      ensureChatSessionDoc(user.uid, sessionId, scenario.id, scenario.title)
        .then(() => appendSessionMessageDoc(user.uid, sessionId, newMsg))
        .catch((e) => console.error('Failed to save admin msg:', e));
    }

    try {
      const response = await fetch('/api/chat/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenarioId: scenario.id,
          currentStage,
          messages: nextMessages.map((m) => ({
            role: m.role,
            text: m.attachmentLabel ? `[แนบไฟล์: ${m.attachmentLabel}] ${m.text}` : m.text,
          })),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'ไม่สามารถส่งข้อความได้');
      }

      const customerMsg: ChatMessage = {
        id: `cust_${Date.now()}`,
        role: 'customer',
        text: data.customerReply,
        timestamp: getCurrentTimeLabel(),
      };

      const nextStage = data.stageDetected || currentStage;
      setMessages((prev) => [...prev, customerMsg]);
      setCurrentStage(nextStage);
      setLiveFeedback({
        customerMood: data.customerMood,
        stageDetected: data.stageDetected,
        isDealClosed: data.isDealClosed,
        endedWithQuestion: data.endedWithQuestion,
        toneScore: data.toneScore,
        sopAccuracyNote: data.sopAccuracyNote,
        coachingTip: data.coachingTip,
        betterExample: data.betterExample,
      });

      if (user) {
        appendSessionMessageDoc(user.uid, sessionId, customerMsg)
          .then(() => updateChatSessionDoc(user.uid, sessionId, nextStage, 'active'))
          .catch((e) => console.error('Failed to update Firestore session:', e));
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการโต้ตอบกับลูกค้า');
    } finally {
      setIsSending(false);
    }
  };

  const handleRequestHint = async () => {
    if (isRequestingHint || isSending) return;
    setIsRequestingHint(true);
    setErrorMsg(null);

    try {
      const response = await fetch('/api/chat/hint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenarioId: scenario.id,
          currentStage,
          messages: messages.map((m) => ({ role: m.role, text: m.text })),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'ไม่สามารถขอคำใบ้ได้');
      }
      setHintBox({
        focusPoint: data.focusPoint,
        suggestedReply: data.suggestedReply,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'ไม่สามารถโหลดคำใบ้ได้');
    } finally {
      setIsRequestingHint(false);
    }
  };

  const handleEvaluateSession = async () => {
    if (adminMessageCount === 0 || isEvaluating) return;
    setIsEvaluating(true);
    setErrorMsg(null);

    try {
      const response = await fetch('/api/chat/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenarioId: scenario.id,
          messages: messages.map((m) => ({
            role: m.role,
            text: m.attachmentLabel ? `[แนบไฟล์: ${m.attachmentLabel}] ${m.text}` : m.text,
          })),
        }),
      });
      const data: SessionEvaluation & { error?: string } = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'ไม่สามารถประเมินผลได้');
      }

      setEvaluation(data);
      if (user) {
        updateChatSessionDoc(user.uid, sessionId, currentStage, 'evaluated').catch((e) =>
          console.error('Failed to mark session evaluated:', e)
        );
      }
      onSaveAttempt({
        id: `attempt_${Date.now()}`,
        scenarioId: scenario.id,
        scenarioTitle: scenario.title,
        dateIso: new Date().toISOString(),
        messageCount: adminMessageCount,
        overallScore: data.overallScore,
        gradeLabel: data.gradeLabel,
        dimensions: data.dimensions,
        summaryVerdict: data.summaryVerdict,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดระหว่างประเมินผล');
    } finally {
      setIsEvaluating(false);
    }
  };

  const insertSummaryTemplate = () => {
    const calc = calculateShipping({
      distanceKm: calcDistance,
      orderSubtotal: calcSubtotal,
      isUrgentUnder2Hr: calcUrgent,
      isUpcountryInterExpress: calcUpcountry,
      isSaturdayDispatch: calcSaturday,
    });
    const total = calcSubtotal + calc.fee;
    const template = `ทางร้านขอสรุปยอดนะคะ
ชุดผลไม้ 1 ชุด = ${calcSubtotal.toLocaleString()} บาท
*( ในเซตจัด [ระบุรายละเอียดผลไม้] )*
ค่าจัดส่ง ${calc.fee.toLocaleString()} บาท
ยอดรวมทั้งหมด ${total.toLocaleString()} บาท
ลูกค้าสะดวกชำระค่าสินค้าช่องทางไหนดีคะ
ลูกค้าสามารถคอนเฟิร์มออเดอร์โดยการส่งหลักฐานการชำระให้ทางร้านได้เลยนะคะ การจัดส่งจะคอนเฟิร์มหลังจากได้รับหลักฐานการชำระนะคะ ขอบพระคุณมากค่ะ`;
    setInputText(template);
  };

  const insertChatScript = (text: string) => {
    setInputText(text);
    setIsScriptPickerOpen(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  };

  const getChatScript = (index: number) => resolveChatScript(scriptOverrides, index);

  const getUpsellOption = (id: string) => resolveUpsellOption(scriptOverrides, id);

  const getProductInfo = (id: string) => resolveProductInfo(scriptOverrides, id);

  const startScriptEdit = (kind: 'chat' | 'customChat' | 'upsell' | 'product', key: string) => {
    if (kind === 'chat') {
      const resolved = getChatScript(Number(key));
      setEditDraft({
        ...EMPTY_DRAFT,
        title: resolved.title,
        category: resolved.category,
        text: resolved.text,
      });
    } else if (kind === 'customChat') {
      const custom = scriptOverrides.customChat.find((c) => c.id === key);
      if (!custom) return;
      setEditDraft({
        ...EMPTY_DRAFT,
        title: custom.title,
        category: custom.category,
        text: custom.text,
      });
    } else if (kind === 'upsell') {
      const resolved = getUpsellOption(key);
      setEditDraft({
        ...EMPTY_DRAFT,
        title: resolved.title,
        text: resolved.script,
        priceText: resolved.priceText,
        bestFor: resolved.bestFor,
      });
    } else if (kind === 'product') {
      const resolved = getProductInfo(key);
      setEditDraft({
        ...EMPTY_DRAFT,
        code: resolved.code,
        name: resolved.name,
        price: String(resolved.price),
        occasions: resolved.occasions,
      });
    }
    setEditingScript({ kind, key });
  };

  const saveScriptEdit = () => {
    if (!editingScript) return;
    setScriptOverrides((prev) => {
      if (editingScript.kind === 'chat') {
        const base = CHAT_SCRIPTS[Number(editingScript.key)];
        const title = editDraft.title.trim() || base.title;
        const category = editDraft.category.trim() || base.category;
        const text = editDraft.text.trim() || base.text;
        const nextChat = { ...prev.chat };
        if (title === base.title && category === base.category && text === base.text) {
          delete nextChat[editingScript.key];
        } else {
          nextChat[editingScript.key] = {
            ...(title !== base.title ? { title } : {}),
            ...(category !== base.category ? { category } : {}),
            ...(text !== base.text ? { text } : {}),
          };
        }
        return { ...prev, chat: nextChat };
      }

      if (editingScript.kind === 'customChat') {
        const nextCustom = prev.customChat.map((c) =>
          c.id === editingScript.key
            ? {
                ...c,
                title: editDraft.title.trim() || c.title,
                category: editDraft.category.trim() || 'กำหนดเอง',
                text: editDraft.text.trim() || c.text,
              }
            : c
        );
        return { ...prev, customChat: nextCustom };
      }

      if (editingScript.kind === 'upsell') {
        const base = UPSELL_OPTIONS.find((u) => u.id === editingScript.key);
        if (!base) return prev;
        const title = editDraft.title.trim() || base.title;
        const script = editDraft.text.trim() || base.script;
        const priceText = editDraft.priceText.trim() || base.priceText;
        const bestFor = editDraft.bestFor.trim() || base.bestFor;
        const nextUpsell = { ...prev.upsell };
        if (
          title === base.title &&
          script === base.script &&
          priceText === base.priceText &&
          bestFor === base.bestFor
        ) {
          delete nextUpsell[editingScript.key];
        } else {
          nextUpsell[editingScript.key] = {
            ...(title !== base.title ? { title } : {}),
            ...(script !== base.script ? { script } : {}),
            ...(priceText !== base.priceText ? { priceText } : {}),
            ...(bestFor !== base.bestFor ? { bestFor } : {}),
          };
        }
        return { ...prev, upsell: nextUpsell };
      }

      const baseProd = PRODUCT_SETS.find((p) => p.id === editingScript.key);
      if (!baseProd) return prev;
      const baseOccasions = baseProd.occasions.join(', ');
      const code = editDraft.code.trim() || baseProd.code;
      const name = editDraft.name.trim() || baseProd.name;
      const parsedPrice = Number(editDraft.price);
      const price = Number.isFinite(parsedPrice) && parsedPrice >= 0 ? parsedPrice : baseProd.price;
      const occasions = editDraft.occasions.trim() || baseOccasions;
      const nextProducts = { ...prev.products };
      if (
        code === baseProd.code &&
        name === baseProd.name &&
        price === baseProd.price &&
        occasions === baseOccasions
      ) {
        delete nextProducts[editingScript.key];
      } else {
        nextProducts[editingScript.key] = {
          ...(code !== baseProd.code ? { code } : {}),
          ...(name !== baseProd.name ? { name } : {}),
          ...(price !== baseProd.price ? { price } : {}),
          ...(occasions !== baseOccasions ? { occasions } : {}),
        };
      }
      return { ...prev, products: nextProducts };
    });
    setEditingScript(null);
    setEditDraft(EMPTY_DRAFT);
  };

  const cancelScriptEdit = () => {
    setEditingScript(null);
    setEditDraft(EMPTY_DRAFT);
  };

  const resetScriptOverride = (kind: 'chat' | 'upsell' | 'product', key: string) => {
    setScriptOverrides((prev) => {
      if (kind === 'chat') {
        const nextChat = { ...prev.chat };
        delete nextChat[key];
        return { ...prev, chat: nextChat };
      }
      if (kind === 'upsell') {
        const nextUpsell = { ...prev.upsell };
        delete nextUpsell[key];
        return { ...prev, upsell: nextUpsell };
      }
      const nextProducts = { ...prev.products };
      delete nextProducts[key];
      return { ...prev, products: nextProducts };
    });
    setEditingScript(null);
    setEditDraft(EMPTY_DRAFT);
  };

  const handleAddCustomScript = () => {
    const title = newCustomDraft.title.trim();
    const text = newCustomDraft.text.trim();
    if (!title || !text) return;
    const newItem: CustomChatScript = {
      id: `custom_${Date.now()}`,
      title,
      category: newCustomDraft.category.trim() || 'กำหนดเอง',
      text,
    };
    setScriptOverrides((prev) => ({
      ...prev,
      customChat: [newItem, ...prev.customChat],
    }));
    setNewCustomDraft({ title: '', category: 'กำหนดเอง', text: '' });
    setIsAddingCustomScript(false);
  };

  const deleteCustomScript = (id: string) => {
    setScriptOverrides((prev) => ({
      ...prev,
      customChat: prev.customChat.filter((c) => c.id !== id),
    }));
    if (editingScript?.kind === 'customChat' && editingScript.key === id) {
      cancelScriptEdit();
    }
  };

  const copyOrUseText = (id: string, text: string, putInInput = false) => {
    if (putInInput) {
      setInputText(text);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const shippingResult = calculateShipping({
    distanceKm: calcDistance,
    orderSubtotal: calcSubtotal,
    isUrgentUnder2Hr: calcUrgent,
    isUpcountryInterExpress: calcUpcountry,
    isSaturdayDispatch: calcSaturday,
  });

  const orderedChatIndices = getOrderedChatIndices(scriptOverrides);
  const orderedUpsellIds = getOrderedUpsellIds(scriptOverrides);
  const orderedProductIds = getOrderedProductIds(scriptOverrides);

  const scriptCategories = [
    'ทั้งหมด',
    ...Array.from(
      new Set([
        ...scriptOverrides.customChat.map((c) => c.category),
        ...orderedChatIndices.map((idx) => getChatScript(idx).category),
      ])
    ),
  ];

  const scriptQueryLower = scriptSearch.trim().toLowerCase();

  const filteredChatIndices = orderedChatIndices.filter((index) => {
    const resolved = getChatScript(index);
    if (scriptCategoryFilter !== 'ทั้งหมด' && resolved.category !== scriptCategoryFilter) {
      return false;
    }
    if (!scriptQueryLower) return true;
    return (
      resolved.title.toLowerCase().includes(scriptQueryLower) ||
      resolved.text.toLowerCase().includes(scriptQueryLower) ||
      resolved.category.toLowerCase().includes(scriptQueryLower)
    );
  });

  const filteredCustomScripts = scriptOverrides.customChat.filter((c) => {
    if (scriptCategoryFilter !== 'ทั้งหมด' && c.category !== scriptCategoryFilter) {
      return false;
    }
    if (!scriptQueryLower) return true;
    return (
      c.title.toLowerCase().includes(scriptQueryLower) ||
      c.text.toLowerCase().includes(scriptQueryLower) ||
      c.category.toLowerCase().includes(scriptQueryLower)
    );
  });

  const filteredUpsellIds = orderedUpsellIds.filter((id) => {
    if (!scriptQueryLower) return true;
    const resolved = getUpsellOption(id);
    return (
      resolved.title.toLowerCase().includes(scriptQueryLower) ||
      resolved.script.toLowerCase().includes(scriptQueryLower) ||
      resolved.priceText.toLowerCase().includes(scriptQueryLower) ||
      resolved.bestFor.toLowerCase().includes(scriptQueryLower)
    );
  });

  const filteredProductIds = orderedProductIds.filter((id) => {
    if (!scriptQueryLower) return true;
    const resolved = getProductInfo(id);
    return (
      resolved.code.toLowerCase().includes(scriptQueryLower) ||
      resolved.name.toLowerCase().includes(scriptQueryLower) ||
      String(resolved.price).includes(scriptQueryLower) ||
      resolved.occasions.toLowerCase().includes(scriptQueryLower)
    );
  });

  const moveScriptItem = (
    kind: 'customChat' | 'chat' | 'upsell' | 'product',
    key: string,
    direction: 'up' | 'down'
  ) => {
    setScriptOverrides((prev) => {
      if (kind === 'customChat') {
        const allKeys = prev.customChat.map((c) => c.id);
        const visibleKeys = filteredCustomScripts.map((c) => c.id);
        const nextKeys = stepItemInOrder(allKeys, visibleKeys, key, direction);
        const byId = new Map(prev.customChat.map((c) => [c.id, c]));
        return {
          ...prev,
          customChat: nextKeys.map((id) => byId.get(id)!).filter(Boolean),
        };
      }
      if (kind === 'chat') {
        const fullOrder = getOrderedChatIndices(prev);
        const nextOrder = stepItemInOrder(fullOrder, filteredChatIndices, Number(key), direction);
        return { ...prev, chatOrder: nextOrder };
      }
      if (kind === 'upsell') {
        const fullOrder = getOrderedUpsellIds(prev);
        const nextOrder = stepItemInOrder(fullOrder, filteredUpsellIds, key, direction);
        return { ...prev, upsellOrder: nextOrder };
      }
      const fullOrder = getOrderedProductIds(prev);
      const nextOrder = stepItemInOrder(fullOrder, filteredProductIds, key, direction);
      return { ...prev, productOrder: nextOrder };
    });
  };

  const dropScriptItem = (
    kind: 'customChat' | 'chat' | 'upsell' | 'product',
    targetKey: string
  ) => {
    if (!dragItem || dragItem.kind !== kind || dragItem.key === targetKey) {
      setDragItem(null);
      setDragOverItem(null);
      return;
    }
    const sourceKey = dragItem.key;
    setScriptOverrides((prev) => {
      if (kind === 'customChat') {
        const allKeys = prev.customChat.map((c) => c.id);
        const nextKeys = moveItemByKey(allKeys, sourceKey, targetKey);
        const byId = new Map(prev.customChat.map((c) => [c.id, c]));
        return {
          ...prev,
          customChat: nextKeys.map((id) => byId.get(id)!).filter(Boolean),
        };
      }
      if (kind === 'chat') {
        const fullOrder = getOrderedChatIndices(prev);
        const nextOrder = moveItemByKey(fullOrder, Number(sourceKey), Number(targetKey));
        return { ...prev, chatOrder: nextOrder };
      }
      if (kind === 'upsell') {
        const fullOrder = getOrderedUpsellIds(prev);
        const nextOrder = moveItemByKey(fullOrder, sourceKey, targetKey);
        return { ...prev, upsellOrder: nextOrder };
      }
      const fullOrder = getOrderedProductIds(prev);
      const nextOrder = moveItemByKey(fullOrder, sourceKey, targetKey);
      return { ...prev, productOrder: nextOrder };
    });
    setDragItem(null);
    setDragOverItem(null);
  };

  const resetScriptOrder = (kind: 'chat' | 'upsell' | 'product') => {
    setScriptOverrides((prev) => {
      if (kind === 'chat') return { ...prev, chatOrder: undefined };
      if (kind === 'upsell') return { ...prev, upsellOrder: undefined };
      return { ...prev, productOrder: undefined };
    });
  };

  const handleNextScenario = () => {
    const idx = TRAINING_SCENARIOS.findIndex((s) => s.id === scenario.id);
    const next = TRAINING_SCENARIOS[(idx + 1) % TRAINING_SCENARIOS.length];
    setEvaluation(null);
    onSelectScenarioId(next.id);
  };

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-5">
      {/* Scenario Selector Strip */}
      <section aria-label="เลือกสถานการณ์ฝึกซ้อม">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 mb-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">
              ห้องจำลองตอบแชทลูกค้า (Chat Roleplay Studio)
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-0.5">
              ฝึกตอบแชทตาม Flow การขายจริง พร้อม AI สวมบทบาทลูกค้าและโค้ชตรวจคำตอบแบบเรียลไทม์
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <div
              role="group"
              aria-label="กรองระดับความยาก"
              className="inline-flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg"
            >
              {(
                [
                  { id: 'all', label: 'ทั้งหมด' },
                  { id: 'พื้นฐาน', label: 'Easy' },
                  { id: 'กลาง', label: 'Medium' },
                  { id: 'ท้าทาย', label: 'Hard' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setDifficultyFilter(opt.id)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                    difficultyFilter === opt.id
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">
              ฝึกสำเร็จแล้ว {completedScenarioIds.length}/{TRAINING_SCENARIOS.length} เคส
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {TRAINING_SCENARIOS.filter(
            (item) => difficultyFilter === 'all' || item.difficulty === difficultyFilter
          ).map((item) => {
            const isSelected = item.id === scenario.id;
            const isDone = completedScenarioIds.includes(item.id);
            const diff = DIFFICULTY_META[item.difficulty];
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectScenarioId(item.id)}
                className={`text-left p-3.5 rounded-xl border transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-emerald-600 flex flex-col justify-between gap-2.5 ${
                  isSelected
                    ? 'bg-white dark:bg-slate-900 border-emerald-600 dark:border-emerald-500 ring-1 ring-emerald-600 dark:ring-emerald-500 shadow-xs'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                    {item.title}
                  </span>
                  {isDone && (
                    <CheckCircle2
                      className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5"
                      aria-label="ผ่านการฝึกแล้ว"
                    />
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${diff.badgeClass}`}
                    title={`ระดับ${diff.label} (${diff.englishLabel})`}
                  >
                    <span className="inline-flex items-end gap-0.5 h-2.5" aria-hidden="true">
                      <span
                        className={`w-1 h-1 rounded-[1px] ${
                          diff.level >= 1 ? diff.activeBarClass : diff.inactiveBarClass
                        }`}
                      />
                      <span
                        className={`w-1 h-1.5 rounded-[1px] ${
                          diff.level >= 2 ? diff.activeBarClass : diff.inactiveBarClass
                        }`}
                      />
                      <span
                        className={`w-1 h-2.5 rounded-[1px] ${
                          diff.level >= 3 ? diff.activeBarClass : diff.inactiveBarClass
                        }`}
                      />
                    </span>
                    <span>
                      {diff.label} · {diff.englishLabel}
                    </span>
                  </span>

                  <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-x-1.5">
                    <span>{item.channel}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-num">
                      {item.isUpcountry ? 'ต่างจังหวัด' : `${item.distanceKm} กม.`}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Two-Zone Interactive Sandbox */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Zone (7 cols): Interactive LINE OA Chat Window */}
        <section
          aria-label="หน้าต่างแชทจำลอง"
          className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden flex flex-col h-[700px]"
        >
          {/* Customer Header */}
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                  {scenario.customerName}
                </h2>
                <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  · {scenario.channel}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                {scenario.shiftTime} · {scenario.customerProfile}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {liveFeedback?.customerMood && (
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300 mr-2">
                  อารมณ์ลูกค้า: <strong className="text-slate-900 dark:text-slate-100">{liveFeedback.customerMood}</strong>
                </span>
              )}
              <button
                type="button"
                onClick={() => resetConversation(scenario)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                เริ่มใหม่
              </button>
            </div>
          </div>

          {/* Chat Thread */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-[#EEF2F6] dark:bg-slate-950">
            {messages.map((msg) => {
              const isAdmin = msg.role === 'admin';
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.16 }}
                  className={`flex flex-col ${isAdmin ? 'items-end' : 'items-start'}`}
                >
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1 px-1">
                    {isAdmin ? 'คุณ (Admin Sale)' : scenario.customerName}
                  </span>

                  <div
                    className={`max-w-[85%] sm:max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-line shadow-2xs ${
                      isAdmin
                        ? 'bg-emerald-600 text-white rounded-br-sm'
                        : 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-bl-sm'
                    }`}
                  >
                    {msg.attachmentLabel && (
                      <div
                        className={`mb-2 px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 ${
                          isAdmin
                            ? 'bg-emerald-700/80 text-emerald-50'
                            : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        <ImagePlus className="w-3.5 h-3.5 shrink-0" />
                        <span>{msg.attachmentLabel}</span>
                      </div>
                    )}
                    {msg.text}
                  </div>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 px-1 font-mono-num">
                    {msg.timestamp}
                  </span>
                </motion.div>
              );
            })}

            {isSending && (
              <div className="flex items-start">
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl rounded-bl-sm px-4 py-2.5 text-xs text-slate-500 dark:text-slate-300 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600 dark:text-emerald-400" />
                  <span>{scenario.customerName} กำลังพิมพ์ข้อความ...</span>
                </div>
              </div>
            )}

            {liveFeedback?.isDealClosed && (
              <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-xl flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-emerald-900 dark:text-emerald-200">
                  <strong>ปิดการขายสำเร็จแล้ว!</strong> ลูกค้ายืนยันออเดอร์เรียบร้อย กดประเมินผลเพื่อดูคะแนนละเอียดได้เลย
                </div>
                <button
                  type="button"
                  onClick={handleEvaluateSession}
                  disabled={isEvaluating}
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors cursor-pointer disabled:opacity-60"
                >
                  {isEvaluating ? 'กำลังตรวจคะแนน...' : 'ดูผลประเมินทันที'}
                </button>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Hint Box & Error Banner */}
          {hintBox && (
            <div className="px-4 py-3 bg-amber-50 dark:bg-amber-950/40 border-t border-amber-200 dark:border-amber-800 text-xs text-amber-950 dark:text-amber-100 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold flex items-center gap-1.5">
                  <Lightbulb className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>คำแนะนำจังหวะนี้: {hintBox.focusPoint}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setHintBox(null)}
                  className="text-amber-700 dark:text-amber-300 hover:text-amber-950 dark:hover:text-amber-100 font-medium cursor-pointer"
                >
                  ปิด
                </button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 bg-white/80 dark:bg-slate-900/90 border border-amber-200 dark:border-amber-800 rounded-lg p-2.5">
                <span className="text-slate-700 dark:text-slate-200 leading-relaxed">{hintBox.suggestedReply}</span>
                <button
                  type="button"
                  onClick={() => copyOrUseText('hint-reply', hintBox.suggestedReply, true)}
                  className="px-2.5 py-1 text-xs font-semibold text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/60 hover:bg-amber-200 dark:hover:bg-amber-800/70 rounded-md shrink-0 cursor-pointer"
                >
                  นำมาใช้ตอบ
                </button>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="px-4 py-2.5 bg-rose-50 dark:bg-rose-950/60 border-t border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Composer */}
          <div className="p-3.5 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
            {/* Quick Toolbar */}
            <div
              ref={scriptPickerRef}
              className="relative flex flex-wrap items-center gap-2"
            >
              <button
                type="button"
                onClick={() => setAttachPhotoSet((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors cursor-pointer whitespace-nowrap ${
                  attachPhotoSet
                    ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-600 dark:border-emerald-500 text-emerald-800 dark:text-emerald-200'
                    : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                <ImagePlus className="w-3.5 h-3.5" />
                {attachPhotoSet ? 'แนบรูป 8–12 แบบแล้ว' : 'แนบรูป 8–12 แบบตามงบ'}
              </button>

              <button
                type="button"
                onClick={insertSummaryTemplate}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer whitespace-nowrap"
              >
                <FileText className="w-3.5 h-3.5" />
                แทรกเทมเพลตสรุปยอด
              </button>

              <button
                type="button"
                onClick={() => insertChatScript(getChatScript(0).text)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer whitespace-nowrap"
              >
                <MessageSquareText className="w-3.5 h-3.5" />
                สคริปต์ทักทาย
              </button>

              <button
                type="button"
                onClick={() => insertChatScript(getChatScript(4).text)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer whitespace-nowrap"
              >
                <MessageSquareText className="w-3.5 h-3.5" />
                ขอข้อมูลจัดส่ง
              </button>

              <button
                type="button"
                aria-expanded={isScriptPickerOpen}
                onClick={() => setIsScriptPickerOpen((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors cursor-pointer whitespace-nowrap ${
                  isScriptPickerOpen
                    ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-600 dark:border-emerald-500 text-emerald-800 dark:text-emerald-200'
                    : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>สคริปต์แชท</span>
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform ${
                    isScriptPickerOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              <button
                type="button"
                onClick={handleRequestHint}
                disabled={isRequestingHint || isSending}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/60 transition-colors cursor-pointer disabled:opacity-60 ml-auto whitespace-nowrap"
              >
                {isRequestingHint ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Lightbulb className="w-3.5 h-3.5" />
                )}
                ขอคำใบ้ก่อนตอบ
              </button>

              {isScriptPickerOpen && (
                <div
                  role="dialog"
                  aria-label="เลือกสคริปต์แชท"
                  className="absolute bottom-full left-0 mb-2 w-full sm:w-[480px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg z-20 flex flex-col max-h-[340px] overflow-hidden"
                >
                  <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/80 flex items-center justify-between gap-2">
                    <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      คลิกเพื่อใส่สคริปต์แชทในกล่องข้อความ
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsScriptPickerOpen(false)}
                      aria-label="ปิดรายการสคริปต์แชท"
                      className="p-1 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 rounded-md cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="px-3.5 py-2 border-b border-slate-100 dark:border-slate-800">
                    <input
                      type="search"
                      value={quickScriptQuery}
                      onChange={(e) => setQuickScriptQuery(e.target.value)}
                      placeholder="ค้นหาสคริปต์ เช่น ทักทาย, เชอร์รี่, รังนก, OP..."
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-emerald-600 dark:focus:border-emerald-500 focus:outline-none"
                    />
                  </div>

                  <div className="flex-1 overflow-y-auto p-2.5 space-y-3">
                    {scriptOverrides.customChat.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="px-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                          สคริปต์ที่สร้างเพิ่มเอง
                        </div>
                        {scriptOverrides.customChat
                          .filter((c) => {
                            const q = quickScriptQuery.trim().toLowerCase();
                            if (!q) return true;
                            return (
                              c.title.toLowerCase().includes(q) ||
                              c.category.toLowerCase().includes(q) ||
                              c.text.toLowerCase().includes(q)
                            );
                          })
                          .map((c) => (
                            <button
                              key={`quick-custom-${c.id}`}
                              type="button"
                              onClick={() => insertChatScript(c.text)}
                              className="w-full text-left p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-emerald-600 dark:hover:border-emerald-500 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/40 transition-colors cursor-pointer space-y-1"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                                  {c.title}
                                </span>
                                <span className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                                  {c.category}
                                </span>
                              </div>
                              <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 leading-relaxed">
                                {c.text}
                              </p>
                            </button>
                          ))}
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <div className="px-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                        สคริปต์แชทมาตรฐาน
                      </div>
                      {orderedChatIndices
                        .filter((idx) => {
                          const q = quickScriptQuery.trim().toLowerCase();
                          if (!q) return true;
                          const resolved = getChatScript(idx);
                          return (
                            resolved.title.toLowerCase().includes(q) ||
                            resolved.category.toLowerCase().includes(q) ||
                            resolved.text.toLowerCase().includes(q)
                          );
                        })
                        .map((idx) => {
                          const resolved = getChatScript(idx);
                          return (
                            <button
                              key={`quick-sc-${idx}`}
                              type="button"
                              onClick={() => insertChatScript(resolved.text)}
                              className="w-full text-left p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-emerald-600 dark:hover:border-emerald-500 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/40 transition-colors cursor-pointer space-y-1"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                                  {resolved.title}
                                </span>
                                <span className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                                  {resolved.category}
                                </span>
                              </div>
                              <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 leading-relaxed">
                                {resolved.text}
                              </p>
                            </button>
                          );
                        })}
                    </div>

                    <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                      <div className="px-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                        สคริปต์เสนอ Upsell
                      </div>
                      {orderedUpsellIds
                        .filter((id) => {
                          const q = quickScriptQuery.trim().toLowerCase();
                          if (!q) return true;
                          const resolved = getUpsellOption(id);
                          return (
                            resolved.title.toLowerCase().includes(q) ||
                            resolved.bestFor.toLowerCase().includes(q) ||
                            resolved.script.toLowerCase().includes(q)
                          );
                        })
                        .map((id) => {
                          const resolved = getUpsellOption(id);
                          return (
                            <button
                              key={`quick-up-${id}`}
                              type="button"
                              onClick={() => insertChatScript(resolved.script)}
                              className="w-full text-left p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-emerald-600 dark:hover:border-emerald-500 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/40 transition-colors cursor-pointer space-y-1"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                                  {resolved.title}
                                </span>
                                <span className="text-[11px] text-emerald-700 dark:text-emerald-400 shrink-0">
                                  Upsell
                                </span>
                              </div>
                              <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 leading-relaxed">
                                {resolved.script}
                              </p>
                            </button>
                          );
                        })}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Textarea + Send */}
            <div className="flex items-end gap-2.5">
              <textarea
                ref={textareaRef}
                rows={2}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder="พิมพ์ข้อความตอบกลับลูกค้า (กด Enter เพื่อส่ง, Shift+Enter เพื่อขึ้นบรรทัดใหม่)..."
                className="flex-1 resize-none rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-emerald-600 dark:focus:border-emerald-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSendMessage}
                disabled={isSending || (!inputText.trim() && !attachPhotoSet)}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 h-[44px] text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 rounded-xl transition-colors shrink-0 cursor-pointer"
              >
                <Send className="w-4 h-4" />
                <span>ส่งแชท</span>
              </button>
            </div>
          </div>
        </section>

        {/* Right Zone (5 cols): Live Coach & SOP Companion Deck */}
        <aside
          aria-label="แผงโค้ชสดและคู่มือช่วยตอบ"
          className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden flex flex-col lg:h-[700px]"
        >
          {/* Segmented Tab Switcher */}
          <div className="p-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60">
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-200/70 dark:bg-slate-950 rounded-xl">
              <button
                type="button"
                onClick={() => setCompanionTab('coach')}
                className={`py-1.5 px-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap ${
                  companionTab === 'coach'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Award className="w-3.5 h-3.5" />
                โค้ชสด & ขั้นตอน
              </button>
              <button
                type="button"
                onClick={() => setCompanionTab('shipping')}
                className={`py-1.5 px-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap ${
                  companionTab === 'shipping'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Calculator className="w-3.5 h-3.5" />
                คำนวณค่าส่ง
              </button>
              <button
                type="button"
                onClick={() => setCompanionTab('scripts')}
                className={`py-1.5 px-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap ${
                  companionTab === 'scripts'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                สคริปต์ & สินค้า
              </button>
            </div>
          </div>

          {/* Tab Panels */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {companionTab === 'coach' && (
              <>
                {/* 6-Stage Flow Tracker */}
                <div>
                  <div className="flex items-center justify-between mb-2.5">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Flow ขั้นตอนการขาย 6 ระยะ
                    </h3>
                    <span className="text-xs font-mono-num text-slate-500 dark:text-slate-400">
                      ขั้นที่ {currentStage}/6
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {SALES_STAGES.map((st) => {
                      const isDone = st.step < currentStage;
                      const isCurrent = st.step === currentStage;
                      return (
                        <div
                          key={st.key}
                          className={`p-2.5 rounded-lg border text-xs transition-colors ${
                            isCurrent
                              ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-600 dark:border-emerald-500 text-emerald-950 dark:text-emerald-100'
                              : isDone
                              ? 'bg-slate-50 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                              : 'bg-white dark:bg-slate-950/60 border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500'
                          }`}
                        >
                          <div className="font-semibold flex items-center justify-between">
                            <span>
                              {st.step}. {st.label}
                            </span>
                            {isDone && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Live Coach Feedback */}
                <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-2.5">
                    ผลวิเคราะห์ข้อความล่าสุดของคุณ
                  </h3>

                  {!liveFeedback ? (
                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      ลองส่งข้อความทักทายและสอบถามความต้องการลูกค้าด้านซ้ายมือ โค้ชจะตรวจ{" "}
                      <strong className="text-slate-900 dark:text-slate-100">กฎเหล็กการทิ้งคำถาม</strong> ความสุภาพ และความแม่นยำของ SOP ให้ทันทีหลังทุกข้อความ
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* Golden Rule + Tone */}
                      <div className="grid grid-cols-2 gap-2.5">
                        <div
                          className={`p-3 rounded-xl border ${
                            liveFeedback.endedWithQuestion
                              ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                              : 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200'
                          }`}
                        >
                          <div className="text-[11px] font-medium opacity-80">
                            กฎเหล็ก: ทิ้งคำถามท้ายแชท
                          </div>
                          <div className="text-xs font-bold mt-1 flex items-center gap-1.5">
                            {liveFeedback.endedWithQuestion ? (
                              <>
                                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                <span>ผ่าน · มีคำถามต่อยอด</span>
                              </>
                            ) : (
                              <>
                                <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                                <span>ระวัง · ลืมทิ้งคำถาม</span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70">
                          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            น้ำเสียงงานบริการ
                          </div>
                          <div className="text-sm font-bold font-mono-num text-slate-900 dark:text-slate-100 mt-1">
                            {liveFeedback.toneScore}/5 คะแนน
                          </div>
                        </div>
                      </div>

                      {/* SOP Note */}
                      <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 space-y-1.5">
                        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          ความถูกต้องตามคู่มือ (SOP)
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                          {liveFeedback.sopAccuracyNote}
                        </p>
                      </div>

                      {/* Coaching Tip */}
                      <div className="p-3.5 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/30 space-y-1.5">
                        <div className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                          คำแนะนำเพิ่มเติม
                        </div>
                        <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
                          {liveFeedback.coachingTip}
                        </p>
                      </div>

                      {/* Better Example */}
                      <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                            ตัวอย่างประโยคที่สมบูรณ์แบบ
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              copyOrUseText('better-ex', liveFeedback.betterExample, true)
                            }
                            className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 cursor-pointer"
                          >
                            {copiedId === 'better-ex' ? (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                <span>ใส่ในแชทแล้ว</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>ลองใช้เป็นแนวทาง</span>
                              </>
                            )}
                          </button>
                        </div>
                        <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
                          “{liveFeedback.betterExample}”
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Case Checkpoints */}
                <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-2">
                    เช็คลิสต์เป้าหมายของเคสนี้
                  </h3>
                  <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed list-disc pl-4">
                    {scenario.keyCheckpoints.map((cp, i) => (
                      <li key={i}>{cp}</li>
                    ))}
                  </ul>
                </div>
              </>
            )}

            {companionTab === 'shipping' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    เครื่องคิดเลขค่าจัดส่งและยอดรวมตามคู่มือ
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    ตรวจสอบค่าส่งและระยะเวลาจัดส่งก่อนสรุปยอดให้ลูกค้าทุกครั้ง
                  </p>
                </div>

                <div className="space-y-3">
                  <div>
                    <label
                      htmlFor="calc-subtotal"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1"
                    >
                      ยอดค่าสินค้า (บาท)
                    </label>
                    <input
                      id="calc-subtotal"
                      type="number"
                      min={0}
                      step={10}
                      value={calcSubtotal}
                      onChange={(e) => setCalcSubtotal(Number(e.target.value) || 0)}
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-num text-slate-900 dark:text-slate-100 focus:border-emerald-600 dark:focus:border-emerald-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
                      <label htmlFor="calc-distance">ระยะทางจัดส่ง (กม.)</label>
                      <span className="font-mono-num text-slate-900 dark:text-slate-100">{calcDistance} กม.</span>
                    </div>
                    <input
                      id="calc-distance"
                      type="range"
                      min={1}
                      max={45}
                      value={Math.min(45, calcDistance)}
                      disabled={calcUpcountry}
                      onChange={(e) => setCalcDistance(Number(e.target.value))}
                      className="w-full accent-emerald-600 cursor-pointer disabled:opacity-40"
                    />
                  </div>

                  <div className="space-y-2 pt-1">
                    <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={calcUrgent}
                        onChange={(e) => setCalcUrgent(e.target.checked)}
                        className="rounded accent-emerald-600"
                      />
                      <span>จัดส่งด่วนพิเศษ (น้อยกว่า 2 ชม. / 1–1.5 ชม.)</span>
                    </label>

                    <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={calcUpcountry}
                        onChange={(e) => setCalcUpcountry(e.target.checked)}
                        className="rounded accent-emerald-600"
                      />
                      <span>ส่งต่างจังหวัดด้วยรถห้องเย็น Inter Express</span>
                    </label>

                    {calcUpcountry && (
                      <label className="flex items-center gap-2 text-xs text-rose-700 dark:text-rose-300 pl-5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={calcSaturday}
                          onChange={(e) => setCalcSaturday(e.target.checked)}
                          className="rounded accent-rose-600"
                        />
                        <span>ลูกค้าขอรับ/ส่งวันเสาร์</span>
                      </label>
                    )}
                  </div>
                </div>

                {/* Result Card */}
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2.5">
                  <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
                    <span>ค่าจัดส่งตามเกณฑ์</span>
                    <span className="font-bold font-mono-num text-base text-slate-900 dark:text-slate-100">
                      {shippingResult.isFree
                        ? 'ฟรีค่าส่ง (0 บาท)'
                        : `${shippingResult.fee.toLocaleString()} บาท`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
                    <span>ยอดรวมสุทธิ (สินค้า + ค่าส่ง)</span>
                    <span className="font-bold font-mono-num text-lg text-emerald-700 dark:text-emerald-400">
                      {(calcSubtotal + shippingResult.fee).toLocaleString()} บาท
                    </span>
                  </div>
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-200 space-y-1">
                    <div>
                      <strong>ระยะเวลาถึงลูกค้า:</strong> {shippingResult.etaText}
                    </div>
                    <div>
                      <strong>เวลาเดินทางแมส:</strong> {shippingResult.messengerTravelText}
                    </div>
                  </div>
                  {shippingResult.notes.length > 0 && (
                    <ul className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-1 text-xs text-slate-600 dark:text-slate-300 list-disc pl-4">
                      {shippingResult.notes.map((n, idx) => (
                        <li key={idx}>{n}</li>
                      ))}
                    </ul>
                  )}
                </div>

                <button
                  type="button"
                  onClick={insertSummaryTemplate}
                  className="w-full py-2 px-4 text-xs font-semibold text-emerald-800 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 rounded-lg transition-colors cursor-pointer"
                >
                  นำยอดนี้ไปแทรกในเทมเพลตสรุปยอด
                </button>

                {/* Inline Google Maps Grounding Lookup */}
                <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
                  <div className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span>เช็คสถานที่จัดส่งด้วย Google Maps</span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="search"
                      value={mapQuery}
                      onChange={(e) => setMapQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && mapQuery.trim() && !isCheckingMap) {
                          setIsCheckingMap(true);
                          fetch('/api/tools/maps', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ query: mapQuery.trim() }),
                          })
                            .then((r) => r.json())
                            .then((d) => setMapLookupResult(d))
                            .catch(() => {})
                            .finally(() => setIsCheckingMap(false));
                        }
                      }}
                      placeholder="เช่น รพ.บำรุงราษฎร์, ตึกอโศก..."
                      className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-emerald-600 dark:focus:border-emerald-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={isCheckingMap || !mapQuery.trim()}
                      onClick={() => {
                        if (!mapQuery.trim() || isCheckingMap) return;
                        setIsCheckingMap(true);
                        fetch('/api/tools/maps', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ query: mapQuery.trim() }),
                        })
                          .then((r) => r.json())
                          .then((d) => setMapLookupResult(d))
                          .catch(() => {})
                          .finally(() => setIsCheckingMap(false));
                      }}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 rounded-lg cursor-pointer shrink-0"
                    >
                      {isCheckingMap ? 'ค้น...' : 'เช็คพิกัด'}
                    </button>
                  </div>
                  {mapLookupResult && (
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-200 space-y-2">
                      {mapLookupResult.notice && (
                        <p className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-200 leading-relaxed">
                          {mapLookupResult.notice}
                        </p>
                      )}
                      <p className="leading-relaxed whitespace-pre-line">
                        {mapLookupResult.answerMarkdown}
                      </p>
                      {mapLookupResult.places?.length > 0 && (
                        <div className="space-y-1 pt-1 border-t border-slate-200 dark:border-slate-700">
                          {mapLookupResult.places.map((pl, idx) => (
                            <a
                              key={idx}
                              href={pl.uri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-semibold hover:underline mr-3"
                            >
                              <ExternalLink className="w-3 h-3" />
                              <span>{pl.title}</span>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {companionTab === 'scripts' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <input
                    type="search"
                    value={scriptSearch}
                    onChange={(e) => setScriptSearch(e.target.value)}
                    placeholder="ค้นหาสคริปต์, โปร Upsell, หรือชื่อเซต..."
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-emerald-600 dark:focus:border-emerald-500 focus:outline-none"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <select
                      aria-label="กรองตามหมวดหมู่สคริปต์"
                      value={scriptCategoryFilter}
                      onChange={(e) => setScriptCategoryFilter(e.target.value)}
                      className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:border-emerald-600 dark:focus:border-emerald-500 focus:outline-none cursor-pointer"
                    >
                      {scriptCategories.map((cat) => (
                        <option key={cat} value={cat}>
                          หมวดหมู่: {cat}
                        </option>
                      ))}
                    </select>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                      ลาก <GripVertical className="w-3 h-3 inline -mt-0.5" /> หรือกด ↑↓ เพื่อย้าย
                    </span>
                  </div>
                </div>

                {/* Chat Scripts */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                        สคริปต์แชททั้งหมด ({filteredCustomScripts.length + filteredChatIndices.length})
                      </h4>
                      {scriptOverrides.chatOrder && (
                        <button
                          type="button"
                          onClick={() => resetScriptOrder('chat')}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                          title="คืนลำดับสคริปต์แชทมาตรฐาน"
                        >
                          <RotateCcw className="w-3 h-3" />
                          รีเซ็ตลำดับ
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsAddingCustomScript((v) => !v)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded-md transition-colors cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      เพิ่มสคริปต์
                    </button>
                  </div>

                  {isAddingCustomScript && (
                    <div className="p-3 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/30 space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <input
                          type="text"
                          value={newCustomDraft.title}
                          onChange={(e) =>
                            setNewCustomDraft((d) => ({ ...d, title: e.target.value }))
                          }
                          placeholder="ชื่อสคริปต์ใหม่"
                          aria-label="ชื่อสคริปต์ใหม่"
                          className="sm:col-span-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 dark:focus:border-emerald-500 focus:outline-none"
                        />
                        <input
                          type="text"
                          value={newCustomDraft.category}
                          onChange={(e) =>
                            setNewCustomDraft((d) => ({ ...d, category: e.target.value }))
                          }
                          placeholder="หมวดหมู่"
                          aria-label="หมวดหมู่สคริปต์ใหม่"
                          className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 dark:focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                      <textarea
                        rows={3}
                        value={newCustomDraft.text}
                        onChange={(e) =>
                          setNewCustomDraft((d) => ({ ...d, text: e.target.value }))
                        }
                        placeholder="พิมพ์ข้อความสคริปต์..."
                        aria-label="ข้อความสคริปต์ใหม่"
                        className="w-full resize-y rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 dark:focus:border-emerald-500 focus:outline-none"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleAddCustomScript}
                          disabled={!newCustomDraft.title.trim() || !newCustomDraft.text.trim()}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 rounded-md cursor-pointer"
                        >
                          <Check className="w-3 h-3" />
                          บันทึกสคริปต์ใหม่
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsAddingCustomScript(false)}
                          className="px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                        >
                          ยกเลิก
                        </button>
                      </div>
                    </div>
                  )}

                  {filteredCustomScripts.map((custom, posIdx) => {
                    const isEditing =
                      editingScript?.kind === 'customChat' && editingScript.key === custom.id;
                    const isDragging = dragItem?.kind === 'customChat' && dragItem.key === custom.id;
                    const isDropTarget =
                      dragOverItem?.kind === 'customChat' &&
                      dragOverItem.key === custom.id &&
                      dragItem?.key !== custom.id;
                    return (
                      <div
                        key={custom.id}
                        draggable={!isEditing}
                        onDragStart={() => setDragItem({ kind: 'customChat', key: custom.id })}
                        onDragOver={(e) => {
                          if (dragItem?.kind === 'customChat') {
                            e.preventDefault();
                            setDragOverItem({ kind: 'customChat', key: custom.id });
                          }
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          dropScriptItem('customChat', custom.id);
                        }}
                        onDragEnd={() => {
                          setDragItem(null);
                          setDragOverItem(null);
                        }}
                        className={`p-3 rounded-xl border bg-white dark:bg-slate-800/60 space-y-1.5 transition-all ${
                          isDropTarget
                            ? 'border-emerald-500 ring-2 ring-emerald-500/40'
                            : 'border-emerald-200 dark:border-emerald-800/80'
                        } ${isDragging ? 'opacity-50' : ''}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              title="ลากเพื่อย้ายตำแหน่ง"
                              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing shrink-0"
                            >
                              <GripVertical className="w-3.5 h-3.5" />
                            </span>
                            <span
                              onClick={() => startScriptEdit('customChat', custom.id)}
                              title="คลิกเพื่อแก้ไข"
                              className="text-xs font-semibold text-slate-900 dark:text-slate-100 hover:text-emerald-700 dark:hover:text-emerald-400 truncate cursor-pointer"
                            >
                              {custom.title}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              disabled={posIdx === 0}
                              onClick={() => moveScriptItem('customChat', custom.id, 'up')}
                              aria-label={`ย้ายขึ้น: ${custom.title}`}
                              title="ย้ายขึ้น"
                              className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 cursor-pointer disabled:cursor-default"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              disabled={posIdx === filteredCustomScripts.length - 1}
                              onClick={() => moveScriptItem('customChat', custom.id, 'down')}
                              aria-label={`ย้ายลง: ${custom.title}`}
                              title="ย้ายลง"
                              className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 cursor-pointer disabled:cursor-default"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => startScriptEdit('customChat', custom.id)}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                            >
                              <Pencil className="w-3 h-3" />
                              แก้ไข
                            </button>
                            <button
                              type="button"
                              onClick={() => copyOrUseText(`custom-${custom.id}`, custom.text, true)}
                              className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 cursor-pointer"
                            >
                              ใส่ในแชท
                            </button>
                          </div>
                        </div>
                        {isEditing ? (
                          <div className="space-y-1.5">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                              <input
                                type="text"
                                value={editDraft.title}
                                onChange={(e) =>
                                  setEditDraft((d) => ({ ...d, title: e.target.value }))
                                }
                                aria-label="แก้ไขชื่อสคริปต์"
                                placeholder="ชื่อสคริปต์"
                                className="sm:col-span-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 dark:focus:border-emerald-500 focus:outline-none"
                              />
                              <input
                                type="text"
                                value={editDraft.category}
                                onChange={(e) =>
                                  setEditDraft((d) => ({ ...d, category: e.target.value }))
                                }
                                aria-label="แก้ไขหมวดหมู่สคริปต์"
                                placeholder="หมวดหมู่"
                                className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 dark:focus:border-emerald-500 focus:outline-none"
                              />
                            </div>
                            <textarea
                              rows={4}
                              value={editDraft.text}
                              onChange={(e) =>
                                setEditDraft((d) => ({ ...d, text: e.target.value }))
                              }
                              aria-label={`แก้ไขข้อความสคริปต์: ${custom.title}`}
                              className="w-full resize-y rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 dark:focus:border-emerald-500 focus:outline-none"
                            />
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={saveScriptEdit}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer"
                              >
                                <Check className="w-3 h-3" />
                                บันทึก
                              </button>
                              <button
                                type="button"
                                onClick={cancelScriptEdit}
                                className="px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                              >
                                ยกเลิก
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteCustomScript(custom.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:text-rose-800 dark:hover:text-rose-300 ml-auto cursor-pointer"
                              >
                                <Trash2 className="w-3 h-3" />
                                ลบ
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-3">
                              {custom.text}
                            </p>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              หมวด: {custom.category}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}

                  {filteredChatIndices.map((idx, posIdx) => {
                    const key = String(idx);
                    const resolved = getChatScript(idx);
                    const isEditing = editingScript?.kind === 'chat' && editingScript.key === key;
                    const isOverridden = scriptOverrides.chat[key] !== undefined;
                    const isDragging = dragItem?.kind === 'chat' && dragItem.key === key;
                    const isDropTarget =
                      dragOverItem?.kind === 'chat' &&
                      dragOverItem.key === key &&
                      dragItem?.key !== key;
                    return (
                      <div
                        key={idx}
                        draggable={!isEditing}
                        onDragStart={() => setDragItem({ kind: 'chat', key })}
                        onDragOver={(e) => {
                          if (dragItem?.kind === 'chat') {
                            e.preventDefault();
                            setDragOverItem({ kind: 'chat', key });
                          }
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          dropScriptItem('chat', key);
                        }}
                        onDragEnd={() => {
                          setDragItem(null);
                          setDragOverItem(null);
                        }}
                        className={`p-3 rounded-xl border bg-white dark:bg-slate-800/60 space-y-1.5 transition-all ${
                          isDropTarget
                            ? 'border-emerald-500 ring-2 ring-emerald-500/40'
                            : 'border-slate-200 dark:border-slate-700'
                        } ${isDragging ? 'opacity-50' : ''}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              title="ลากเพื่อย้ายตำแหน่ง"
                              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing shrink-0"
                            >
                              <GripVertical className="w-3.5 h-3.5" />
                            </span>
                            <span
                              onClick={() => startScriptEdit('chat', key)}
                              title="คลิกเพื่อแก้ไข"
                              className="text-xs font-semibold text-slate-900 dark:text-slate-100 hover:text-emerald-700 dark:hover:text-emerald-400 truncate cursor-pointer"
                            >
                              {resolved.title}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              disabled={posIdx === 0}
                              onClick={() => moveScriptItem('chat', key, 'up')}
                              aria-label={`ย้ายขึ้น: ${resolved.title}`}
                              title="ย้ายขึ้น"
                              className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 cursor-pointer disabled:cursor-default"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              disabled={posIdx === filteredChatIndices.length - 1}
                              onClick={() => moveScriptItem('chat', key, 'down')}
                              aria-label={`ย้ายลง: ${resolved.title}`}
                              title="ย้ายลง"
                              className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 cursor-pointer disabled:cursor-default"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => startScriptEdit('chat', key)}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                            >
                              <Pencil className="w-3 h-3" />
                              แก้ไข
                            </button>
                            <button
                              type="button"
                              onClick={() => copyOrUseText(`sc-${idx}`, resolved.text, true)}
                              className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 cursor-pointer"
                            >
                              ใส่ในแชท
                            </button>
                          </div>
                        </div>
                        {isEditing ? (
                          <div className="space-y-1.5">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                              <input
                                type="text"
                                value={editDraft.title}
                                onChange={(e) =>
                                  setEditDraft((d) => ({ ...d, title: e.target.value }))
                                }
                                aria-label={`แก้ไขชื่อสคริปต์: ${resolved.title}`}
                                placeholder="ชื่อสคริปต์"
                                className="sm:col-span-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 dark:focus:border-emerald-500 focus:outline-none"
                              />
                              <input
                                type="text"
                                value={editDraft.category}
                                onChange={(e) =>
                                  setEditDraft((d) => ({ ...d, category: e.target.value }))
                                }
                                aria-label={`แก้ไขหมวดหมู่: ${resolved.category}`}
                                placeholder="หมวดหมู่"
                                className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 dark:focus:border-emerald-500 focus:outline-none"
                              />
                            </div>
                            <textarea
                              rows={4}
                              value={editDraft.text}
                              onChange={(e) =>
                                setEditDraft((d) => ({ ...d, text: e.target.value }))
                              }
                              aria-label={`แก้ไขสคริปต์: ${resolved.title}`}
                              className="w-full resize-y rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 dark:focus:border-emerald-500 focus:outline-none"
                            />
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={saveScriptEdit}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer"
                              >
                                <Check className="w-3 h-3" />
                                บันทึก
                              </button>
                              <button
                                type="button"
                                onClick={cancelScriptEdit}
                                className="px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                              >
                                ยกเลิก
                              </button>
                              {isOverridden && (
                                <button
                                  type="button"
                                  onClick={() => resetScriptOverride('chat', key)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  คืนค่าเดิม
                                </button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-3">
                              {resolved.text}
                            </p>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              หมวด: {resolved.category}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Upsell Snippets */}
                <div className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      สคริปต์เสนอ Upsell ({filteredUpsellIds.length})
                    </h4>
                    {scriptOverrides.upsellOrder && (
                      <button
                        type="button"
                        onClick={() => resetScriptOrder('upsell')}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                        title="คืนลำดับ Upsell เดิม"
                      >
                        <RotateCcw className="w-3 h-3" />
                        รีเซ็ตลำดับ
                      </button>
                    )}
                  </div>
                  {filteredUpsellIds.map((upId, posIdx) => {
                    const resolved = getUpsellOption(upId);
                    const isEditing = editingScript?.kind === 'upsell' && editingScript.key === upId;
                    const isOverridden = scriptOverrides.upsell[upId] !== undefined;
                    const isDragging = dragItem?.kind === 'upsell' && dragItem.key === upId;
                    const isDropTarget =
                      dragOverItem?.kind === 'upsell' &&
                      dragOverItem.key === upId &&
                      dragItem?.key !== upId;
                    return (
                      <div
                        key={upId}
                        draggable={!isEditing}
                        onDragStart={() => setDragItem({ kind: 'upsell', key: upId })}
                        onDragOver={(e) => {
                          if (dragItem?.kind === 'upsell') {
                            e.preventDefault();
                            setDragOverItem({ kind: 'upsell', key: upId });
                          }
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          dropScriptItem('upsell', upId);
                        }}
                        onDragEnd={() => {
                          setDragItem(null);
                          setDragOverItem(null);
                        }}
                        className={`p-3 rounded-xl border bg-slate-50 dark:bg-slate-800/70 space-y-1.5 transition-all ${
                          isDropTarget
                            ? 'border-emerald-500 ring-2 ring-emerald-500/40'
                            : 'border-slate-200 dark:border-slate-700'
                        } ${isDragging ? 'opacity-50' : ''}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              title="ลากเพื่อย้ายตำแหน่ง"
                              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing shrink-0"
                            >
                              <GripVertical className="w-3.5 h-3.5" />
                            </span>
                            <span
                              onClick={() => startScriptEdit('upsell', upId)}
                              title="คลิกเพื่อแก้ไข"
                              className="text-xs font-semibold text-slate-900 dark:text-slate-100 hover:text-emerald-700 dark:hover:text-emerald-400 truncate cursor-pointer"
                            >
                              {resolved.title}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              disabled={posIdx === 0}
                              onClick={() => moveScriptItem('upsell', upId, 'up')}
                              aria-label={`ย้ายขึ้น: ${resolved.title}`}
                              title="ย้ายขึ้น"
                              className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 cursor-pointer disabled:cursor-default"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              disabled={posIdx === filteredUpsellIds.length - 1}
                              onClick={() => moveScriptItem('upsell', upId, 'down')}
                              aria-label={`ย้ายลง: ${resolved.title}`}
                              title="ย้ายลง"
                              className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 cursor-pointer disabled:cursor-default"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => startScriptEdit('upsell', upId)}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                            >
                              <Pencil className="w-3 h-3" />
                              แก้ไข
                            </button>
                            <button
                              type="button"
                              onClick={() => copyOrUseText(upId, resolved.script, true)}
                              className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 cursor-pointer"
                            >
                              ใส่ในแชท
                            </button>
                          </div>
                        </div>
                        {isEditing ? (
                          <div className="space-y-1.5">
                            <input
                              type="text"
                              value={editDraft.title}
                              onChange={(e) =>
                                setEditDraft((d) => ({ ...d, title: e.target.value }))
                              }
                              aria-label={`แก้ไขชื่อ Upsell: ${resolved.title}`}
                              placeholder="ชื่อโปร Upsell"
                              className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 dark:focus:border-emerald-500 focus:outline-none"
                            />
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                              <input
                                type="text"
                                value={editDraft.priceText}
                                onChange={(e) =>
                                  setEditDraft((d) => ({ ...d, priceText: e.target.value }))
                                }
                                aria-label="แก้ไขราคา Upsell"
                                placeholder="ราคา"
                                className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 dark:focus:border-emerald-500 focus:outline-none"
                              />
                              <input
                                type="text"
                                value={editDraft.bestFor}
                                onChange={(e) =>
                                  setEditDraft((d) => ({ ...d, bestFor: e.target.value }))
                                }
                                aria-label="แก้ไขโอกาสที่เหมาะ"
                                placeholder="เหมาะสำหรับ"
                                className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 dark:focus:border-emerald-500 focus:outline-none"
                              />
                            </div>
                            <textarea
                              rows={4}
                              value={editDraft.text}
                              onChange={(e) =>
                                setEditDraft((d) => ({ ...d, text: e.target.value }))
                              }
                              aria-label={`แก้ไขสคริปต์ Upsell: ${resolved.title}`}
                              className="w-full resize-y rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 dark:focus:border-emerald-500 focus:outline-none"
                            />
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={saveScriptEdit}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer"
                              >
                                <Check className="w-3 h-3" />
                                บันทึก
                              </button>
                              <button
                                type="button"
                                onClick={cancelScriptEdit}
                                className="px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                              >
                                ยกเลิก
                              </button>
                              {isOverridden && (
                                <button
                                  type="button"
                                  onClick={() => resetScriptOverride('upsell', upId)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  คืนค่าเดิม
                                </button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-3">
                              {resolved.script}
                            </p>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {resolved.priceText} · {resolved.bestFor}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Quick Product Reference */}
                <div className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      ราคาเซตสินค้าอ้างอิง ({filteredProductIds.length})
                    </h4>
                    {scriptOverrides.productOrder && (
                      <button
                        type="button"
                        onClick={() => resetScriptOrder('product')}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                        title="คืนลำดับสินค้าเดิม"
                      >
                        <RotateCcw className="w-3 h-3" />
                        รีเซ็ตลำดับ
                      </button>
                    )}
                  </div>
                  {filteredProductIds.map((prodId, posIdx) => {
                    const prod = PRODUCT_SETS.find((p) => p.id === prodId);
                    if (!prod) return null;
                    const resolved = getProductInfo(prod.id);
                    const isEditing =
                      editingScript?.kind === 'product' && editingScript.key === prod.id;
                    const isOverridden = scriptOverrides.products[prod.id] !== undefined;
                    const isDragging = dragItem?.kind === 'product' && dragItem.key === prod.id;
                    const isDropTarget =
                      dragOverItem?.kind === 'product' &&
                      dragOverItem.key === prod.id &&
                      dragItem?.key !== prod.id;
                    return (
                      <div
                        key={prod.id}
                        draggable={!isEditing}
                        onDragStart={() => setDragItem({ kind: 'product', key: prod.id })}
                        onDragOver={(e) => {
                          if (dragItem?.kind === 'product') {
                            e.preventDefault();
                            setDragOverItem({ kind: 'product', key: prod.id });
                          }
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          dropScriptItem('product', prod.id);
                        }}
                        onDragEnd={() => {
                          setDragItem(null);
                          setDragOverItem(null);
                        }}
                        className={`p-2.5 rounded-xl border bg-white dark:bg-slate-800/60 space-y-2 transition-all ${
                          isDropTarget
                            ? 'border-emerald-500 ring-2 ring-emerald-500/40'
                            : 'border-slate-200 dark:border-slate-700'
                        } ${isDragging ? 'opacity-50' : ''}`}
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            title="ลากเพื่อย้ายตำแหน่ง"
                            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing shrink-0"
                          >
                            <GripVertical className="w-3.5 h-3.5" />
                          </span>
                          {prod.imageKey && (
                            <img
                              src={PRODUCT_IMAGE_MAP[prod.imageKey]}
                              alt={resolved.name}
                              referrerPolicy="no-referrer"
                              className="w-12 h-12 rounded-lg object-cover shrink-0 bg-slate-100 dark:bg-slate-800"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span
                                onClick={() => startScriptEdit('product', prod.id)}
                                title="คลิกเพื่อแก้ไข"
                                className="text-xs font-semibold text-slate-900 dark:text-slate-100 hover:text-emerald-700 dark:hover:text-emerald-400 truncate cursor-pointer"
                              >
                                {resolved.code} {resolved.name}
                              </span>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="text-xs font-bold font-mono-num text-emerald-700 dark:text-emerald-400">
                                  {resolved.price.toLocaleString()} บ.
                                </span>
                                <button
                                  type="button"
                                  disabled={posIdx === 0}
                                  onClick={() => moveScriptItem('product', prod.id, 'up')}
                                  aria-label={`ย้ายขึ้น: ${resolved.name}`}
                                  title="ย้ายขึ้น"
                                  className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 cursor-pointer disabled:cursor-default"
                                >
                                  <ArrowUp className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  disabled={posIdx === filteredProductIds.length - 1}
                                  onClick={() => moveScriptItem('product', prod.id, 'down')}
                                  aria-label={`ย้ายลง: ${resolved.name}`}
                                  title="ย้ายลง"
                                  className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 cursor-pointer disabled:cursor-default"
                                >
                                  <ArrowDown className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => startScriptEdit('product', prod.id)}
                                  className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                                >
                                  <Pencil className="w-3 h-3" />
                                  แก้ไข
                                </button>
                              </div>
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                              {resolved.occasions}
                              {prod.hasSeasonalRisk ? ' · มีเชอรี่(เช็คฤดู)' : ''}
                            </div>
                          </div>
                        </div>

                        {isEditing && (
                          <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-700">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                              <input
                                type="text"
                                value={editDraft.code}
                                onChange={(e) =>
                                  setEditDraft((d) => ({ ...d, code: e.target.value }))
                                }
                                aria-label="แก้ไขรหัสเซต"
                                placeholder="รหัสเซต"
                                className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 dark:focus:border-emerald-500 focus:outline-none"
                              />
                              <input
                                type="text"
                                value={editDraft.name}
                                onChange={(e) =>
                                  setEditDraft((d) => ({ ...d, name: e.target.value }))
                                }
                                aria-label="แก้ไขชื่อเซตสินค้า"
                                placeholder="ชื่อเซตสินค้า"
                                className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 dark:focus:border-emerald-500 focus:outline-none"
                              />
                              <input
                                type="number"
                                min={0}
                                value={editDraft.price}
                                onChange={(e) =>
                                  setEditDraft((d) => ({ ...d, price: e.target.value }))
                                }
                                aria-label="แก้ไขราคาสินค้า"
                                placeholder="ราคา (บาท)"
                                className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-mono-num text-slate-900 dark:text-slate-100 focus:border-emerald-600 dark:focus:border-emerald-500 focus:outline-none"
                              />
                            </div>
                            <input
                              type="text"
                              value={editDraft.occasions}
                              onChange={(e) =>
                                setEditDraft((d) => ({ ...d, occasions: e.target.value }))
                              }
                              aria-label="แก้ไขโอกาสที่เหมาะ"
                              placeholder="โอกาสที่เหมาะ (คั่นด้วยจุลภาค)"
                              className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 dark:focus:border-emerald-500 focus:outline-none"
                            />
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={saveScriptEdit}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer"
                              >
                                <Check className="w-3 h-3" />
                                บันทึก
                              </button>
                              <button
                                type="button"
                                onClick={cancelScriptEdit}
                                className="px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                              >
                                ยกเลิก
                              </button>
                              {isOverridden && (
                                <button
                                  type="button"
                                  onClick={() => resetScriptOverride('product', prod.id)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  คืนค่าเดิม
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Sticky Footer CTA to Finish & Grade */}
          <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 flex items-center justify-between gap-3">
            <div className="text-xs text-slate-600 dark:text-slate-300">
              ตอบแล้ว <strong className="font-mono-num text-slate-900 dark:text-slate-100">{adminMessageCount}</strong>{' '}
              ข้อความ
            </div>
            <button
              type="button"
              onClick={handleEvaluateSession}
              disabled={adminMessageCount === 0 || isEvaluating || isSending}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 rounded-lg transition-colors cursor-pointer"
            >
              {isEvaluating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>กำลังประเมินผล...</span>
                </>
              ) : (
                <>
                  <Award className="w-4 h-4" />
                  <span>จบเคส & ประเมินผล</span>
                </>
              )}
            </button>
          </div>
        </aside>
      </div>

      {evaluation && (
        <EvaluationModal
          evaluation={evaluation}
          scenarioTitle={scenario.title}
          onClose={() => setEvaluation(null)}
          onRetryScenario={() => resetConversation(scenario)}
          onNextScenario={handleNextScenario}
        />
      )}
    </div>
  );
}
