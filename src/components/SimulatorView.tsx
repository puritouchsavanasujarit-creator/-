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

interface SimulatorViewProps {
  selectedScenarioId: string;
  onSelectScenarioId: (id: string) => void;
  resetSignal: number;
  onSaveAttempt: (attempt: SavedAttempt) => void;
  completedScenarioIds: string[];
}

type CompanionTab = 'coach' | 'shipping' | 'scripts';

const SCRIPT_OVERRIDES_KEY = 'chatcraft_script_overrides_v1';

interface ScriptOverrides {
  chat: Record<string, string>;
  upsell: Record<string, string>;
}

function getCurrentTimeLabel(): string {
  const now = new Date();
  return now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

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
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [scriptSearch, setScriptSearch] = useState('');
  const [scriptOverrides, setScriptOverrides] = useState<ScriptOverrides>(() => {
    try {
      const raw = localStorage.getItem(SCRIPT_OVERRIDES_KEY);
      if (!raw) return { chat: {}, upsell: {} };
      const parsed = JSON.parse(raw) as Partial<ScriptOverrides>;
      return { chat: parsed.chat ?? {}, upsell: parsed.upsell ?? {} };
    } catch {
      return { chat: {}, upsell: {} };
    }
  });
  const [editingScript, setEditingScript] = useState<{
    kind: 'chat' | 'upsell';
    key: string;
  } | null>(null);
  const [scriptDraft, setScriptDraft] = useState('');

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
    try {
      localStorage.setItem(SCRIPT_OVERRIDES_KEY, JSON.stringify(scriptOverrides));
    } catch {
      // Ignore storage errors
    }
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

  const chatScriptText = (index: number) =>
    scriptOverrides.chat[String(index)] ?? CHAT_SCRIPTS[index].text;

  const upsellScriptText = (id: string) =>
    scriptOverrides.upsell[id] ?? UPSELL_OPTIONS.find((u) => u.id === id)?.script ?? '';

  const startScriptEdit = (kind: 'chat' | 'upsell', key: string, currentText: string) => {
    setEditingScript({ kind, key });
    setScriptDraft(currentText);
  };

  const saveScriptEdit = () => {
    if (!editingScript) return;
    const text = scriptDraft.trim();
    setScriptOverrides((prev) => {
      if (editingScript.kind === 'chat') {
        const defaultValue = CHAT_SCRIPTS[Number(editingScript.key)].text;
        const nextChat = { ...prev.chat };
        if (!text || text === defaultValue) delete nextChat[editingScript.key];
        else nextChat[editingScript.key] = text;
        return { ...prev, chat: nextChat };
      }
      const defaultValue = UPSELL_OPTIONS.find((u) => u.id === editingScript.key)?.script ?? '';
      const nextUpsell = { ...prev.upsell };
      if (!text || text === defaultValue) delete nextUpsell[editingScript.key];
      else nextUpsell[editingScript.key] = text;
      return { ...prev, upsell: nextUpsell };
    });
    setEditingScript(null);
    setScriptDraft('');
  };

  const cancelScriptEdit = () => {
    setEditingScript(null);
    setScriptDraft('');
  };

  const resetScriptOverride = (kind: 'chat' | 'upsell', key: string) => {
    setScriptOverrides((prev) => {
      const next: ScriptOverrides = { ...prev, [kind]: { ...prev[kind] } };
      delete next[kind][key];
      return next;
    });
    setEditingScript(null);
    setScriptDraft('');
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

  const filteredScripts = CHAT_SCRIPTS.filter((s, index) => {
    const q = scriptSearch.toLowerCase();
    const text = scriptOverrides.chat[String(index)] ?? s.text;
    return (
      s.title.toLowerCase().includes(q) ||
      text.toLowerCase().includes(q) ||
      s.category.toLowerCase().includes(q)
    );
  });

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
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
              ห้องจำลองตอบแชทลูกค้า (Chat Roleplay Studio)
            </h1>
            <p className="text-sm text-slate-600 mt-0.5">
              ฝึกตอบแชทตาม Flow การขายจริง พร้อม AI สวมบทบาทลูกค้าและโค้ชตรวจคำตอบแบบเรียลไทม์
            </p>
          </div>
          <div className="text-xs text-slate-500 font-mono-num shrink-0">
            ฝึกสำเร็จแล้ว {completedScenarioIds.length}/{TRAINING_SCENARIOS.length} เคส
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {TRAINING_SCENARIOS.map((item) => {
            const isSelected = item.id === scenario.id;
            const isDone = completedScenarioIds.includes(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectScenarioId(item.id)}
                className={`text-left p-3.5 rounded-xl border transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-emerald-600 ${
                  isSelected
                    ? 'bg-white border-emerald-600 ring-1 ring-emerald-600 shadow-xs'
                    : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-900 leading-snug">
                    {item.title}
                  </span>
                  {isDone && (
                    <CheckCircle2
                      className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5"
                      aria-label="ผ่านการฝึกแล้ว"
                    />
                  )}
                </div>
                <div className="mt-1.5 text-xs text-slate-500 flex flex-wrap items-center gap-x-1.5">
                  <span>{item.channel}</span>
                  <span aria-hidden="true">·</span>
                  <span>ระดับ{item.difficulty}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono-num">
                    {item.isUpcountry ? 'ต่างจังหวัด' : `${item.distanceKm} กม.`}
                  </span>
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
          className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col h-[700px]"
        >
          {/* Customer Header */}
          <div className="px-5 py-3.5 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 truncate">
                  {scenario.customerName}
                </h2>
                <span className="text-xs font-medium text-emerald-700">
                  · {scenario.channel}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5 truncate">
                {scenario.shiftTime} · {scenario.customerProfile}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {liveFeedback?.customerMood && (
                <span className="text-xs font-medium text-slate-600 mr-2">
                  อารมณ์ลูกค้า: <strong className="text-slate-900">{liveFeedback.customerMood}</strong>
                </span>
              )}
              <button
                type="button"
                onClick={() => resetConversation(scenario)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                เริ่มใหม่
              </button>
            </div>
          </div>

          {/* Chat Thread */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-[#EEF2F6]">
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
                  <span className="text-[11px] font-medium text-slate-500 mb-1 px-1">
                    {isAdmin ? 'คุณ (Admin Sale)' : scenario.customerName}
                  </span>

                  <div
                    className={`max-w-[85%] sm:max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-line shadow-2xs ${
                      isAdmin
                        ? 'bg-emerald-600 text-white rounded-br-sm'
                        : 'bg-white text-slate-900 border border-slate-200 rounded-bl-sm'
                    }`}
                  >
                    {msg.attachmentLabel && (
                      <div
                        className={`mb-2 px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 ${
                          isAdmin
                            ? 'bg-emerald-700/80 text-emerald-50'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        <ImagePlus className="w-3.5 h-3.5 shrink-0" />
                        <span>{msg.attachmentLabel}</span>
                      </div>
                    )}
                    {msg.text}
                  </div>
                  <span className="text-[11px] text-slate-400 mt-1 px-1 font-mono-num">
                    {msg.timestamp}
                  </span>
                </motion.div>
              );
            })}

            {isSending && (
              <div className="flex items-start">
                <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-sm px-4 py-2.5 text-xs text-slate-500 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                  <span>{scenario.customerName} กำลังพิมพ์ข้อความ...</span>
                </div>
              </div>
            )}

            {liveFeedback?.isDealClosed && (
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-emerald-900">
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
            <div className="px-4 py-3 bg-amber-50 border-t border-amber-200 text-xs text-amber-950 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold flex items-center gap-1.5">
                  <Lightbulb className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>คำแนะนำจังหวะนี้: {hintBox.focusPoint}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setHintBox(null)}
                  className="text-amber-700 hover:text-amber-950 font-medium cursor-pointer"
                >
                  ปิด
                </button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 bg-white/80 border border-amber-200 rounded-lg p-2.5">
                <span className="text-slate-700 leading-relaxed">{hintBox.suggestedReply}</span>
                <button
                  type="button"
                  onClick={() => copyOrUseText('hint-reply', hintBox.suggestedReply, true)}
                  className="px-2.5 py-1 text-xs font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-md shrink-0 cursor-pointer"
                >
                  นำมาใช้ตอบ
                </button>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="px-4 py-2.5 bg-rose-50 border-t border-rose-200 text-xs text-rose-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Composer */}
          <div className="p-3.5 bg-white border-t border-slate-200 space-y-2.5">
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
                    ? 'bg-emerald-50 border-emerald-600 text-emerald-800'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <ImagePlus className="w-3.5 h-3.5" />
                {attachPhotoSet ? 'แนบรูป 8–12 แบบแล้ว' : 'แนบรูป 8–12 แบบตามงบ'}
              </button>

              <button
                type="button"
                onClick={insertSummaryTemplate}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer whitespace-nowrap"
              >
                <FileText className="w-3.5 h-3.5" />
                แทรกเทมเพลตสรุปยอด
              </button>

              <button
                type="button"
                onClick={() => insertChatScript(chatScriptText(0))}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer whitespace-nowrap"
              >
                <MessageSquareText className="w-3.5 h-3.5" />
                สคริปต์ทักทาย
              </button>

              <button
                type="button"
                onClick={() => insertChatScript(chatScriptText(4))}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer whitespace-nowrap"
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
                    ? 'bg-emerald-50 border-emerald-600 text-emerald-800'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
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
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 transition-colors cursor-pointer disabled:opacity-60 ml-auto whitespace-nowrap"
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
                  className="absolute bottom-full left-0 mb-2 w-full sm:w-[480px] bg-white border border-slate-200 rounded-xl shadow-lg z-20 flex flex-col max-h-[340px] overflow-hidden"
                >
                  <div className="px-3.5 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
                    <div className="text-xs font-bold text-slate-900">
                      คลิกเพื่อใส่สคริปต์แชทในกล่องข้อความ
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsScriptPickerOpen(false)}
                      aria-label="ปิดรายการสคริปต์แชท"
                      className="p-1 text-slate-500 hover:text-slate-800 rounded-md cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="px-3.5 py-2 border-b border-slate-100">
                    <input
                      type="search"
                      value={quickScriptQuery}
                      onChange={(e) => setQuickScriptQuery(e.target.value)}
                      placeholder="ค้นหาสคริปต์ เช่น ทักทาย, เชอร์รี่, รังนก, OP..."
                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none"
                    />
                  </div>

                  <div className="flex-1 overflow-y-auto p-2.5 space-y-3">
                    <div className="space-y-1.5">
                      <div className="px-1.5 text-[11px] font-semibold text-slate-500">
                        สคริปต์แชทมาตรฐาน
                      </div>
                      {CHAT_SCRIPTS.filter((sc) => {
                        const q = quickScriptQuery.trim().toLowerCase();
                        if (!q) return true;
                        const text = chatScriptText(CHAT_SCRIPTS.indexOf(sc));
                        return (
                          sc.title.toLowerCase().includes(q) ||
                          sc.category.toLowerCase().includes(q) ||
                          text.toLowerCase().includes(q)
                        );
                      }).map((sc) => {
                        const idx = CHAT_SCRIPTS.indexOf(sc);
                        const text = chatScriptText(idx);
                        return (
                          <button
                            key={`quick-sc-${idx}`}
                            type="button"
                            onClick={() => insertChatScript(text)}
                            className="w-full text-left p-2.5 rounded-lg border border-slate-200 hover:border-emerald-600 hover:bg-emerald-50/40 transition-colors cursor-pointer space-y-1"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-slate-900">
                                {sc.title}
                              </span>
                              <span className="text-[11px] text-slate-500 shrink-0">
                                {sc.category}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                              {text}
                            </p>
                          </button>
                        );
                      })}
                    </div>

                    <div className="space-y-1.5 pt-2 border-t border-slate-100">
                      <div className="px-1.5 text-[11px] font-semibold text-slate-500">
                        สคริปต์เสนอ Upsell
                      </div>
                      {UPSELL_OPTIONS.filter((up) => {
                        const q = quickScriptQuery.trim().toLowerCase();
                        if (!q) return true;
                        const text = upsellScriptText(up.id);
                        return (
                          up.title.toLowerCase().includes(q) ||
                          up.bestFor.toLowerCase().includes(q) ||
                          text.toLowerCase().includes(q)
                        );
                      }).map((up) => {
                        const text = upsellScriptText(up.id);
                        return (
                          <button
                            key={`quick-up-${up.id}`}
                            type="button"
                            onClick={() => insertChatScript(text)}
                            className="w-full text-left p-2.5 rounded-lg border border-slate-200 hover:border-emerald-600 hover:bg-emerald-50/40 transition-colors cursor-pointer space-y-1"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-slate-900">
                                {up.title}
                              </span>
                              <span className="text-[11px] text-emerald-700 shrink-0">
                                Upsell
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                              {text}
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
                className="flex-1 resize-none rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSendMessage}
                disabled={isSending || (!inputText.trim() && !attachPhotoSet)}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 h-[44px] text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 rounded-xl transition-colors shrink-0 cursor-pointer"
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
          className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col lg:h-[700px]"
        >
          {/* Segmented Tab Switcher */}
          <div className="p-2 border-b border-slate-200 bg-slate-50">
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-200/70 rounded-xl">
              <button
                type="button"
                onClick={() => setCompanionTab('coach')}
                className={`py-1.5 px-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap ${
                  companionTab === 'coach'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
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
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
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
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
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
                    <h3 className="text-sm font-bold text-slate-900">
                      Flow ขั้นตอนการขาย 6 ระยะ
                    </h3>
                    <span className="text-xs font-mono-num text-slate-500">
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
                              ? 'bg-emerald-50 border-emerald-600 text-emerald-950'
                              : isDone
                              ? 'bg-slate-50 border-slate-200 text-slate-700'
                              : 'bg-white border-slate-200 text-slate-400'
                          }`}
                        >
                          <div className="font-semibold flex items-center justify-between">
                            <span>
                              {st.step}. {st.label}
                            </span>
                            {isDone && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Live Coach Feedback */}
                <div className="border-t border-slate-200 pt-4">
                  <h3 className="text-sm font-bold text-slate-900 mb-2.5">
                    ผลวิเคราะห์ข้อความล่าสุดของคุณ
                  </h3>

                  {!liveFeedback ? (
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 leading-relaxed">
                      ลองส่งข้อความทักทายและสอบถามความต้องการลูกค้าด้านซ้ายมือ โค้ชจะตรวจ{" "}
                      <strong>กฎเหล็กการทิ้งคำถาม</strong> ความสุภาพ และความแม่นยำของ SOP ให้ทันทีหลังทุกข้อความ
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* Golden Rule + Tone */}
                      <div className="grid grid-cols-2 gap-2.5">
                        <div
                          className={`p-3 rounded-xl border ${
                            liveFeedback.endedWithQuestion
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                              : 'bg-rose-50 border-rose-200 text-rose-900'
                          }`}
                        >
                          <div className="text-[11px] font-medium opacity-80">
                            กฎเหล็ก: ทิ้งคำถามท้ายแชท
                          </div>
                          <div className="text-xs font-bold mt-1 flex items-center gap-1.5">
                            {liveFeedback.endedWithQuestion ? (
                              <>
                                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                <span>ผ่าน · มีคำถามต่อยอด</span>
                              </>
                            ) : (
                              <>
                                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                                <span>ระวัง · ลืมทิ้งคำถาม</span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
                          <div className="text-[11px] font-medium text-slate-500">
                            น้ำเสียงงานบริการ
                          </div>
                          <div className="text-sm font-bold font-mono-num text-slate-900 mt-1">
                            {liveFeedback.toneScore}/5 คะแนน
                          </div>
                        </div>
                      </div>

                      {/* SOP Note */}
                      <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-1.5">
                        <div className="text-xs font-semibold text-slate-900">
                          ความถูกต้องตามคู่มือ (SOP)
                        </div>
                        <p className="text-xs text-slate-600 leading-relaxed">
                          {liveFeedback.sopAccuracyNote}
                        </p>
                      </div>

                      {/* Coaching Tip */}
                      <div className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/50 space-y-1.5">
                        <div className="text-xs font-semibold text-amber-900">
                          คำแนะนำเพิ่มเติม
                        </div>
                        <p className="text-xs text-slate-700 leading-relaxed">
                          {liveFeedback.coachingTip}
                        </p>
                      </div>

                      {/* Better Example */}
                      <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-900">
                            ตัวอย่างประโยคที่สมบูรณ์แบบ
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              copyOrUseText('better-ex', liveFeedback.betterExample, true)
                            }
                            className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-800 cursor-pointer"
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
                        <p className="text-xs text-slate-700 leading-relaxed">
                          “{liveFeedback.betterExample}”
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Case Checkpoints */}
                <div className="border-t border-slate-200 pt-4">
                  <h3 className="text-sm font-bold text-slate-900 mb-2">
                    เช็คลิสต์เป้าหมายของเคสนี้
                  </h3>
                  <ul className="space-y-1.5 text-xs text-slate-600 leading-relaxed list-disc pl-4">
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
                  <h3 className="text-sm font-bold text-slate-900">
                    เครื่องคิดเลขค่าจัดส่งและยอดรวมตามคู่มือ
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    ตรวจสอบค่าส่งและระยะเวลาจัดส่งก่อนสรุปยอดให้ลูกค้าทุกครั้ง
                  </p>
                </div>

                <div className="space-y-3">
                  <div>
                    <label
                      htmlFor="calc-subtotal"
                      className="block text-xs font-semibold text-slate-700 mb-1"
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
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono-num text-slate-900 focus:border-emerald-600 focus:outline-none"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-700 mb-1">
                      <label htmlFor="calc-distance">ระยะทางจัดส่ง (กม.)</label>
                      <span className="font-mono-num text-slate-900">{calcDistance} กม.</span>
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
                    <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={calcUrgent}
                        onChange={(e) => setCalcUrgent(e.target.checked)}
                        className="rounded accent-emerald-600"
                      />
                      <span>จัดส่งด่วนพิเศษ (น้อยกว่า 2 ชม. / 1–1.5 ชม.)</span>
                    </label>

                    <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={calcUpcountry}
                        onChange={(e) => setCalcUpcountry(e.target.checked)}
                        className="rounded accent-emerald-600"
                      />
                      <span>ส่งต่างจังหวัดด้วยรถห้องเย็น Inter Express</span>
                    </label>

                    {calcUpcountry && (
                      <label className="flex items-center gap-2 text-xs text-rose-700 pl-5 cursor-pointer">
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
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>ค่าจัดส่งตามเกณฑ์</span>
                    <span className="font-bold font-mono-num text-base text-slate-900">
                      {shippingResult.isFree
                        ? 'ฟรีค่าส่ง (0 บาท)'
                        : `${shippingResult.fee.toLocaleString()} บาท`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>ยอดรวมสุทธิ (สินค้า + ค่าส่ง)</span>
                    <span className="font-bold font-mono-num text-lg text-emerald-700">
                      {(calcSubtotal + shippingResult.fee).toLocaleString()} บาท
                    </span>
                  </div>
                  <div className="pt-2 border-t border-slate-200 text-xs text-slate-700 space-y-1">
                    <div>
                      <strong>ระยะเวลาถึงลูกค้า:</strong> {shippingResult.etaText}
                    </div>
                    <div>
                      <strong>เวลาเดินทางแมส:</strong> {shippingResult.messengerTravelText}
                    </div>
                  </div>
                  {shippingResult.notes.length > 0 && (
                    <ul className="pt-2 border-t border-slate-200 space-y-1 text-xs text-slate-600 list-disc pl-4">
                      {shippingResult.notes.map((n, idx) => (
                        <li key={idx}>{n}</li>
                      ))}
                    </ul>
                  )}
                </div>

                <button
                  type="button"
                  onClick={insertSummaryTemplate}
                  className="w-full py-2 px-4 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg transition-colors cursor-pointer"
                >
                  นำยอดนี้ไปแทรกในเทมเพลตสรุปยอด
                </button>

                {/* Inline Google Maps Grounding Lookup */}
                <div className="pt-4 border-t border-slate-200 space-y-2.5">
                  <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-emerald-600" />
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
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-900 focus:border-emerald-600 focus:outline-none"
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
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 rounded-lg cursor-pointer shrink-0"
                    >
                      {isCheckingMap ? 'ค้น...' : 'เช็คพิกัด'}
                    </button>
                  </div>
                  {mapLookupResult && (
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-2">
                      <p className="leading-relaxed whitespace-pre-line">
                        {mapLookupResult.answerMarkdown}
                      </p>
                      {mapLookupResult.places?.length > 0 && (
                        <div className="space-y-1 pt-1 border-t border-slate-200">
                          {mapLookupResult.places.map((pl, idx) => (
                            <a
                              key={idx}
                              href={pl.uri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-emerald-700 font-semibold hover:underline mr-3"
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
                <div>
                  <input
                    type="search"
                    value={scriptSearch}
                    onChange={(e) => setScriptSearch(e.target.value)}
                    placeholder="ค้นหาสคริปต์, โปร Upsell, หรือชื่อเซต..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none"
                  />
                </div>

                {/* Chat Scripts */}
                <div className="space-y-2.5">
                  <h4 className="text-xs font-bold text-slate-900">สคริปต์แชทมาตรฐาน</h4>
                  {filteredScripts.map((sc) => {
                    const idx = CHAT_SCRIPTS.indexOf(sc);
                    const key = String(idx);
                    const isEditing = editingScript?.kind === 'chat' && editingScript.key === key;
                    const isOverridden = scriptOverrides.chat[key] !== undefined;
                    return (
                      <div
                        key={idx}
                        className="p-3 rounded-xl border border-slate-200 bg-white space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-900">{sc.title}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => startScriptEdit('chat', key, chatScriptText(idx))}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                            >
                              <Pencil className="w-3 h-3" />
                              แก้ไข
                            </button>
                            <button
                              type="button"
                              onClick={() => copyOrUseText(`sc-${idx}`, chatScriptText(idx), true)}
                              className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 cursor-pointer"
                            >
                              ใส่ในแชท
                            </button>
                          </div>
                        </div>
                        {isEditing ? (
                          <div className="space-y-1.5">
                            <textarea
                              rows={4}
                              value={scriptDraft}
                              onChange={(e) => setScriptDraft(e.target.value)}
                              aria-label={`แก้ไขสคริปต์: ${sc.title}`}
                              className="w-full resize-y rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 focus:border-emerald-600 focus:outline-none"
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
                                className="px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                              >
                                ยกเลิก
                              </button>
                              {isOverridden && (
                                <button
                                  type="button"
                                  onClick={() => resetScriptOverride('chat', key)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  คืนค่าเดิม
                                </button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">
                            {chatScriptText(idx)}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Upsell Snippets */}
                <div className="space-y-2.5 pt-2 border-t border-slate-200">
                  <h4 className="text-xs font-bold text-slate-900">สคริปต์เสนอ Upsell</h4>
                  {UPSELL_OPTIONS.map((up) => {
                    const isEditing = editingScript?.kind === 'upsell' && editingScript.key === up.id;
                    const isOverridden = scriptOverrides.upsell[up.id] !== undefined;
                    return (
                      <div
                        key={up.id}
                        className="p-3 rounded-xl border border-slate-200 bg-slate-50 space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-900">{up.title}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => startScriptEdit('upsell', up.id, upsellScriptText(up.id))}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                            >
                              <Pencil className="w-3 h-3" />
                              แก้ไข
                            </button>
                            <button
                              type="button"
                              onClick={() => copyOrUseText(up.id, upsellScriptText(up.id), true)}
                              className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 cursor-pointer"
                            >
                              ใส่ในแชท
                            </button>
                          </div>
                        </div>
                        {isEditing ? (
                          <div className="space-y-1.5">
                            <textarea
                              rows={4}
                              value={scriptDraft}
                              onChange={(e) => setScriptDraft(e.target.value)}
                              aria-label={`แก้ไขสคริปต์ Upsell: ${up.title}`}
                              className="w-full resize-y rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 focus:border-emerald-600 focus:outline-none"
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
                                className="px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                              >
                                ยกเลิก
                              </button>
                              {isOverridden && (
                                <button
                                  type="button"
                                  onClick={() => resetScriptOverride('upsell', up.id)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  คืนค่าเดิม
                                </button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">
                              {upsellScriptText(up.id)}
                            </p>
                            <div className="text-[11px] text-slate-500">
                              {up.priceText} · {up.bestFor}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Quick Product Reference */}
                <div className="space-y-2.5 pt-2 border-t border-slate-200">
                  <h4 className="text-xs font-bold text-slate-900">ราคาเซตสินค้าอ้างอิง</h4>
                  {PRODUCT_SETS.map((prod) => (
                    <div
                      key={prod.id}
                      className="p-2.5 rounded-xl border border-slate-200 bg-white flex items-center gap-3"
                    >
                      {prod.imageKey && (
                        <img
                          src={PRODUCT_IMAGE_MAP[prod.imageKey]}
                          alt={prod.name}
                          referrerPolicy="no-referrer"
                          className="w-12 h-12 rounded-lg object-cover shrink-0 bg-slate-100"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-900 truncate">
                            {prod.code} {prod.name}
                          </span>
                          <span className="text-xs font-bold font-mono-num text-emerald-700 shrink-0">
                            {prod.price.toLocaleString()} บ.
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 truncate mt-0.5">
                          {prod.occasions.join(', ')}
                          {prod.hasSeasonalRisk ? ' · มีเชอรี่(เช็คฤดู)' : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sticky Footer CTA to Finish & Grade */}
          <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
            <div className="text-xs text-slate-600">
              ตอบแล้ว <strong className="font-mono-num text-slate-900">{adminMessageCount}</strong>{' '}
              ข้อความ
            </div>
            <button
              type="button"
              onClick={handleEvaluateSession}
              disabled={adminMessageCount === 0 || isEvaluating || isSending}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 rounded-lg transition-colors cursor-pointer"
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
