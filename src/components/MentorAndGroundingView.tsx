import { useState, useEffect, useRef } from 'react';
import {
  Send,
  Search,
  MapPin,
  ExternalLink,
  RotateCcw,
  Loader2,
  AlertTriangle,
  MessageSquare,
  Pencil,
  Check,
  Copy,
} from 'lucide-react';
import { TRAINING_SCENARIOS } from '@/src/data/playbookData';
import { useFirebaseAuth } from '@/src/contexts/FirebaseContext';
import {
  appendMentorMessageDoc,
  clearMentorHistory,
  subscribeMentorMessages,
} from '@/src/lib/firestoreRepo';

interface MentorMsg {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: string;
}

interface SearchResult {
  answerMarkdown: string;
  originalAnswerMarkdown?: string;
  sources: Array<{ title: string; uri: string }>;
  grounded?: boolean;
  notice?: string;
}

interface MapsResult {
  answerMarkdown: string;
  originalAnswerMarkdown?: string;
  places: Array<{ title: string; uri: string; snippets: string[] }>;
  grounded?: boolean;
  notice?: string;
}

const DEFAULT_WELCOME: MentorMsg = {
  id: 'mentor-welcome',
  role: 'model',
  text: 'สวัสดีครับ ผมคือพี่โค้ชงานบริการ (AI Mentor) ยินดีช่วยฝึกตอบแชท แนะนำวิธีเขียนสคริปต์ปิดการขาย วิธีรับมือลูกค้าปฏิเสธ Upsell หรือเช็คกฎค่าส่งและขั้นตอน Shift ให้ครับ อยากถามเรื่องไหนพิมพ์คุยกันได้เลยครับ!',
  timestamp: 'พร้อมให้คำปรึกษา',
};

const QUICK_MENTOR_PROMPTS = [
  'ช่วยร่างสคริปต์เสนอ Upsell รังนก 200 บาท สำหรับเคสเยี่ยมไข้ที่จบด้วยคำถาม',
  'ถ้าลูกค้าบอกว่าค่าส่ง 159 บาทแพงเกินไป ควรตอบอย่างไรให้นุ่มนวลและยังรักษาการขายได้?',
  'สรุปข้อมูล 6 อย่างที่ต้องทวนก่อนส่งต่อทีม OP ให้หน่อย',
];

const QUICK_SEARCH_QUERIES = [
  'ฤดูกาลเชอร์รี่อเมริกาและชิลีในไทยช่วงเดือนพฤศจิกายนมีไหม',
  'วิธีเก็บรักษาองุ่น Shine Muscat เกาหลีให้สดกรอบ',
  'วิธีฝากของเยี่ยมผู้ป่วย โรงพยาบาลบำรุงราษฎร์ จุดรับของอยู่ตรงไหน',
];

const QUICK_MAPS_QUERIES = [
  'โรงพยาบาลบำรุงราษฎร์ อินเตอร์เนชั่นแนล สุขุมวิท 3',
  'โรงพยาบาลสมิติเวช สุขุมวิท',
  'อาคาร จี ทาวเวอร์ พระราม 9',
];

function nowLabel(): string {
  return new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

export function MentorAndGroundingView({ activeScenarioId }: { activeScenarioId: string }) {
  const { user, authReady } = useFirebaseAuth();

  // Multi-turn Mentor Chat state
  const [mentorMsgs, setMentorMsgs] = useState<MentorMsg[]>([DEFAULT_WELCOME]);
  const [mentorInput, setMentorInput] = useState('');
  const [isMentorSending, setIsMentorSending] = useState(false);
  const [mentorError, setMentorError] = useState<string | null>(null);
  const mentorEndRef = useRef<HTMLDivElement | null>(null);

  // Google Search Grounding state
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Google Maps Grounding state
  const [mapsQuery, setMapsQuery] = useState('');
  const [isSearchingMaps, setIsSearchingMaps] = useState(false);
  const [mapsResult, setMapsResult] = useState<MapsResult | null>(null);
  const [mapsError, setMapsError] = useState<string | null>(null);
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [activeToolTab, setActiveToolTab] = useState<'search' | 'maps'>('search');

  const [isEditingSearch, setIsEditingSearch] = useState(false);
  const [searchDraft, setSearchDraft] = useState('');
  const [isEditingMaps, setIsEditingMaps] = useState(false);
  const [mapsDraft, setMapsDraft] = useState('');
  const [copiedTool, setCopiedTool] = useState<'search' | 'maps' | null>(null);

  useEffect(() => {
    if (!authReady || !user) {
      setMentorMsgs([DEFAULT_WELCOME]);
      return;
    }

    const unsubscribe = subscribeMentorMessages(user.uid, (items) => {
      if (items.length === 0) {
        setMentorMsgs([DEFAULT_WELCOME]);
      } else {
        setMentorMsgs(items);
      }
    });
    return () => unsubscribe();
  }, [authReady, user]);

  useEffect(() => {
    mentorEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mentorMsgs, isMentorSending]);

  const handleSendMentor = async (overrideText?: string) => {
    const text = (overrideText ?? mentorInput).trim();
    if (!text || isMentorSending) return;

    const ts = nowLabel();
    const userMsg: MentorMsg = {
      id: `u_${Date.now()}`,
      role: 'user',
      text,
      timestamp: ts,
    };

    const historyForApi = mentorMsgs
      .filter((m) => m.id !== 'mentor-welcome')
      .map((m) => ({ role: m.role, text: m.text }));

    setMentorMsgs((prev) => [...prev, userMsg]);
    if (!overrideText) setMentorInput('');
    setMentorError(null);
    setIsMentorSending(true);

    if (user) {
      appendMentorMessageDoc(user.uid, userMsg.id, 'admin', text, ts).catch((e) =>
        console.error('Failed to persist user mentor msg:', e)
      );
    }

    try {
      const res = await fetch('/api/mentor/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          history: historyForApi,
          message: text,
          scenarioId: activeScenarioId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'ไม่สามารถติดต่อโค้ช AI ได้');
      }

      const replyTs = nowLabel();
      const modelMsg: MentorMsg = {
        id: `m_${Date.now()}`,
        role: 'model',
        text: data.reply || 'ขออภัย ไม่สามารถสร้างคำตอบได้ในขณะนี้',
        timestamp: replyTs,
      };
      setMentorMsgs((prev) => [...prev, modelMsg]);

      if (user) {
        appendMentorMessageDoc(user.uid, modelMsg.id, 'mentor', modelMsg.text, replyTs).catch(
          (e) => console.error('Failed to persist model mentor msg:', e)
        );
      }
    } catch (err) {
      setMentorError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการสนทนากับโค้ช AI');
    } finally {
      setIsMentorSending(false);
    }
  };

  const handleResetMentor = async () => {
    setMentorMsgs([DEFAULT_WELCOME]);
    setMentorError(null);
    if (user) {
      try {
        await clearMentorHistory(user.uid);
      } catch (e) {
        console.error('Failed to clear mentor history:', e);
      }
    }
  };

  const handleSearchGrounding = async (overrideQuery?: string) => {
    const q = (overrideQuery ?? searchQuery).trim();
    if (!q || isSearching) return;
    if (overrideQuery) setSearchQuery(q);

    setIsSearching(true);
    setSearchError(null);
    try {
      const res = await fetch('/api/tools/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'ไม่สามารถค้นหาข้อมูลจาก Google Search ได้');
      }
      setIsEditingSearch(false);
      setSearchResult(data);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการสืบค้นข้อมูล');
    } finally {
      setIsSearching(false);
    }
  };

  const handleRequestLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserCoords({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
      },
      () => {
        // Fallback silently if user declines geolocation
      }
    );
  };

  const handleMapsGrounding = async (overrideQuery?: string) => {
    const q = (overrideQuery ?? mapsQuery).trim();
    if (!q || isSearchingMaps) return;
    if (overrideQuery) setMapsQuery(q);

    setIsSearchingMaps(true);
    setMapsError(null);
    try {
      const res = await fetch('/api/tools/maps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: q,
          ...(userCoords ? { latLng: userCoords } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'ไม่สามารถค้นหาสถานที่ผ่าน Google Maps ได้');
      }
      setIsEditingMaps(false);
      setMapsResult(data);
    } catch (err) {
      setMapsError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการค้นหาแผนที่');
    } finally {
      setIsSearchingMaps(false);
    }
  };

  const handleCopyResult = (kind: 'search' | 'maps', text: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedTool(kind);
    setTimeout(() => setCopiedTool((prev) => (prev === kind ? null : prev)), 1500);
  };

  const startEditSearch = () => {
    if (!searchResult) return;
    setSearchDraft(searchResult.answerMarkdown);
    setIsEditingSearch(true);
  };

  const saveEditSearch = () => {
    setSearchResult((prev) =>
      prev
        ? {
            ...prev,
            originalAnswerMarkdown: prev.originalAnswerMarkdown ?? prev.answerMarkdown,
            answerMarkdown: searchDraft,
          }
        : prev
    );
    setIsEditingSearch(false);
  };

  const resetSearchAnswer = () => {
    setSearchResult((prev) =>
      prev && prev.originalAnswerMarkdown !== undefined
        ? {
            ...prev,
            answerMarkdown: prev.originalAnswerMarkdown,
            originalAnswerMarkdown: undefined,
          }
        : prev
    );
    setIsEditingSearch(false);
  };

  const startEditMaps = () => {
    if (!mapsResult) return;
    setMapsDraft(mapsResult.answerMarkdown);
    setIsEditingMaps(true);
  };

  const saveEditMaps = () => {
    setMapsResult((prev) =>
      prev
        ? {
            ...prev,
            originalAnswerMarkdown: prev.originalAnswerMarkdown ?? prev.answerMarkdown,
            answerMarkdown: mapsDraft,
          }
        : prev
    );
    setIsEditingMaps(false);
  };

  const resetMapsAnswer = () => {
    setMapsResult((prev) =>
      prev && prev.originalAnswerMarkdown !== undefined
        ? {
            ...prev,
            answerMarkdown: prev.originalAnswerMarkdown,
            originalAnswerMarkdown: undefined,
          }
        : prev
    );
    setIsEditingMaps(false);
  };

  const currentScenario = TRAINING_SCENARIOS.find((s) => s.id === activeScenarioId);

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div className="border-b border-slate-200 dark:border-slate-800 pb-4">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          พี่โค้ช AI ถาม-ตอบ และเครื่องมือค้นหาข้อมูลสด (Search & Maps)
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
          ปรึกษาแนวทางการตอบแชทแบบ Multi-Turn ต่อเนื่อง พร้อมค้นหาข้อมูลผลไม้ล่าสุดจาก Google Search และตรวจสอบพิกัดจัดส่งบน Google Maps
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left 7 Cols: Multi-Turn AI Mentor Chatbot */}
        <section
          aria-label="แชทถาม-ตอบกับพี่โค้ช AI"
          className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden flex flex-col h-[680px]"
        >
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>พี่โค้ช AI ประจำศูนย์ฝึก (Multi-Turn Mentor)</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {currentScenario ? `เชื่อมบริบทเคส: ${currentScenario.title}` : 'พร้อมตอบคำถามทุกขั้นตอน'}
                {user ? ' · บันทึกประวัติแชทอัตโนมัติในบัญชีของคุณ' : ' · โหมดทดลองใช้งาน'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleResetMentor}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              ล้างบทสนทนา
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-[#F8FAFC] dark:bg-slate-950">
            {mentorMsgs.map((msg) => {
              const isUser = msg.role === 'user';
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                >
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1 px-1">
                    {isUser ? 'คุณ' : 'พี่โค้ช AI'}
                  </span>
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-line ${
                      isUser
                        ? 'bg-slate-900 dark:bg-emerald-600 text-white rounded-br-sm'
                        : 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-bl-sm'
                    }`}
                  >
                    {msg.text}
                  </div>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 px-1 font-mono-num">
                    {msg.timestamp}
                  </span>
                </div>
              );
            })}

            {isMentorSending && (
              <div className="flex items-start">
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl rounded-bl-sm px-4 py-2.5 text-xs text-slate-500 dark:text-slate-300 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600 dark:text-emerald-400" />
                  <span>พี่โค้ช AI กำลังเรียบเรียงคำแนะนำ...</span>
                </div>
              </div>
            )}
            <div ref={mentorEndRef} />
          </div>

          {mentorError && (
            <div className="px-4 py-2.5 bg-rose-50 dark:bg-rose-950/60 border-t border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
              <span>{mentorError}</span>
            </div>
          )}

          {/* Quick Suggested Prompts */}
          <div className="px-4 pt-3 pb-1 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap gap-1.5">
            {QUICK_MENTOR_PROMPTS.map((q, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSendMentor(q)}
                className="text-left px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors cursor-pointer"
              >
                {q}
              </button>
            ))}
          </div>

          <div className="p-3.5 bg-white dark:bg-slate-900 flex items-end gap-2.5">
            <textarea
              rows={2}
              value={mentorInput}
              onChange={(e) => setMentorInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMentor();
                }
              }}
              placeholder="ถามพี่โค้ช AI เช่น 'ช่วยเกลาประโยคปฏิเสธเรื่องส่งฟรีให้ดูนุ่มนวลหน่อย'..."
              className="flex-1 resize-none rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-emerald-600 dark:focus:border-emerald-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => handleSendMentor()}
              disabled={isMentorSending || !mentorInput.trim()}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 h-[44px] text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 rounded-xl transition-colors shrink-0 cursor-pointer"
            >
              <Send className="w-4 h-4" />
              <span>ถามโค้ช</span>
            </button>
          </div>
        </section>

        {/* Right 5 Cols: Google Search Grounding + Google Maps Grounding */}
        <aside className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden flex flex-col lg:h-[680px]">
          <div className="p-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60">
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-200/70 dark:bg-slate-950 rounded-xl">
              <button
                type="button"
                onClick={() => setActiveToolTab('search')}
                className={`py-1.5 px-3 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                  activeToolTab === 'search'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Search className="w-3.5 h-3.5" />
                ค้นหาข้อมูลสด (Search)
              </button>
              <button
                type="button"
                onClick={() => setActiveToolTab('maps')}
                className={`py-1.5 px-3 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                  activeToolTab === 'maps'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <MapPin className="w-3.5 h-3.5" />
                เช็คสถานที่จัดส่ง (Maps)
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {activeToolTab === 'search' ? (
              <>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    สืบค้นข้อมูลผลไม้และเกร็ดบริการผ่าน Google Search
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    ตรวจสอบฤดูกาลผลไม้นำเข้า โภชนาการ หรือข้อควรระวังก่อนให้ข้อมูลลูกค้า
                  </p>
                </div>

                <div className="flex gap-2">
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSearchGrounding();
                    }}
                    placeholder="เช่น ฤดูกาลเชอร์รี่ชิลีในไทย, ประโยชน์ของสาลี่หิมะ..."
                    className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-emerald-600 dark:focus:border-emerald-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleSearchGrounding()}
                    disabled={isSearching || !searchQuery.trim()}
                    className="px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 rounded-xl transition-colors cursor-pointer shrink-0"
                  >
                    {isSearching ? 'กำลังค้น...' : 'ค้นหา'}
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {QUICK_SEARCH_QUERIES.map((q, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleSearchGrounding(q)}
                      className="text-left px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md cursor-pointer"
                    >
                      {q}
                    </button>
                  ))}
                </div>

                {searchError && (
                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200">
                    {searchError}
                  </div>
                )}

                {searchResult && (
                  <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                    {searchResult.notice && (
                      <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200">
                        {searchResult.notice}
                      </div>
                    )}
                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                          ผลลัพธ์การสืบค้น
                          {searchResult.originalAnswerMarkdown !== undefined &&
                          searchResult.answerMarkdown !== searchResult.originalAnswerMarkdown
                            ? ' · แก้ไขแล้ว'
                            : ''}
                        </span>
                        {!isEditingSearch && (
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleCopyResult('search', searchResult.answerMarkdown)}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 cursor-pointer"
                            >
                              {copiedTool === 'search' ? (
                                <>
                                  <Check className="w-3 h-3" />
                                  <span>คัดลอกแล้ว</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span>คัดลอก</span>
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={startEditSearch}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                            >
                              <Pencil className="w-3 h-3" />
                              <span>แก้ไข</span>
                            </button>
                          </div>
                        )}
                      </div>

                      {isEditingSearch ? (
                        <div className="space-y-2">
                          <textarea
                            rows={6}
                            value={searchDraft}
                            onChange={(e) => setSearchDraft(e.target.value)}
                            aria-label="แก้ไขข้อความผลลัพธ์การสืบค้น"
                            className="w-full resize-y rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 leading-relaxed focus:border-emerald-600 dark:focus:border-emerald-500 focus:outline-none"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={saveEditSearch}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer"
                            >
                              <Check className="w-3 h-3" />
                              บันทึก
                            </button>
                            <button
                              type="button"
                              onClick={() => setIsEditingSearch(false)}
                              className="px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                            >
                              ยกเลิก
                            </button>
                            {searchResult.originalAnswerMarkdown !== undefined && (
                              <button
                                type="button"
                                onClick={resetSearchAnswer}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                              >
                                <RotateCcw className="w-3 h-3" />
                                คืนค่าเดิม
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div
                          onClick={startEditSearch}
                          title="คลิกเพื่อแก้ไขข้อความ"
                          className="leading-relaxed whitespace-pre-line cursor-pointer hover:text-slate-950 dark:hover:text-white"
                        >
                          {searchResult.answerMarkdown}
                        </div>
                      )}
                    </div>
                    {searchResult.sources.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          แหล่งอ้างอิงจาก Google Search
                        </div>
                        <ul className="space-y-1">
                          {searchResult.sources.map((src, idx) => (
                            <li key={idx}>
                              <a
                                href={src.uri}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400 hover:underline break-all"
                              >
                                <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                                <span>{src.title}</span>
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    ตรวจสอบพิกัดโรงพยาบาลและจุดจัดส่งบน Google Maps
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    ค้นหาที่ตั้ง อาคาร หรือจุดรับส่งสินค้าจริงเพื่อใช้วางแผนส่งแมสเซนเจอร์
                  </p>
                </div>

                <div className="flex gap-2">
                  <input
                    type="search"
                    value={mapsQuery}
                    onChange={(e) => setMapsQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleMapsGrounding();
                    }}
                    placeholder="เช่น โรงพยาบาลบำรุงราษฎร์, อาคารสาทรซิตี้..."
                    className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-emerald-600 dark:focus:border-emerald-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleMapsGrounding()}
                    disabled={isSearchingMaps || !mapsQuery.trim()}
                    className="px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 rounded-xl transition-colors cursor-pointer shrink-0"
                  >
                    {isSearchingMaps ? 'กำลังค้น...' : 'ค้นแผนที่'}
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_MAPS_QUERIES.map((q, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => handleMapsGrounding(q)}
                        className="text-left px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md cursor-pointer"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={handleRequestLocation}
                    className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline shrink-0 cursor-pointer"
                  >
                    {userCoords ? 'ใช้พิกัดปัจจุบันแล้ว' : 'ใช้พิกัดของฉัน'}
                  </button>
                </div>

                {mapsError && (
                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200">
                    {mapsError}
                  </div>
                )}

                {mapsResult && (
                  <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                    {mapsResult.notice && (
                      <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200">
                        {mapsResult.notice}
                      </div>
                    )}
                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                          ผลลัพธ์พิกัดจัดส่ง
                          {mapsResult.originalAnswerMarkdown !== undefined &&
                          mapsResult.answerMarkdown !== mapsResult.originalAnswerMarkdown
                            ? ' · แก้ไขแล้ว'
                            : ''}
                        </span>
                        {!isEditingMaps && (
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleCopyResult('maps', mapsResult.answerMarkdown)}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 cursor-pointer"
                            >
                              {copiedTool === 'maps' ? (
                                <>
                                  <Check className="w-3 h-3" />
                                  <span>คัดลอกแล้ว</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span>คัดลอก</span>
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={startEditMaps}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                            >
                              <Pencil className="w-3 h-3" />
                              <span>แก้ไข</span>
                            </button>
                          </div>
                        )}
                      </div>

                      {isEditingMaps ? (
                        <div className="space-y-2">
                          <textarea
                            rows={6}
                            value={mapsDraft}
                            onChange={(e) => setMapsDraft(e.target.value)}
                            aria-label="แก้ไขข้อความผลลัพธ์พิกัดจัดส่ง"
                            className="w-full resize-y rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 leading-relaxed focus:border-emerald-600 dark:focus:border-emerald-500 focus:outline-none"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={saveEditMaps}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer"
                            >
                              <Check className="w-3 h-3" />
                              บันทึก
                            </button>
                            <button
                              type="button"
                              onClick={() => setIsEditingMaps(false)}
                              className="px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                            >
                              ยกเลิก
                            </button>
                            {mapsResult.originalAnswerMarkdown !== undefined && (
                              <button
                                type="button"
                                onClick={resetMapsAnswer}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                              >
                                <RotateCcw className="w-3 h-3" />
                                คืนค่าเดิม
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div
                          onClick={startEditMaps}
                          title="คลิกเพื่อแก้ไขข้อความ"
                          className="leading-relaxed whitespace-pre-line cursor-pointer hover:text-slate-950 dark:hover:text-white"
                        >
                          {mapsResult.answerMarkdown}
                        </div>
                      )}
                    </div>
                    {mapsResult.places.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          ลิงก์สถานที่บน Google Maps
                        </div>
                        <div className="space-y-2">
                          {mapsResult.places.map((pl, idx) => (
                            <div
                              key={idx}
                              className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 space-y-1.5"
                            >
                              <a
                                href={pl.uri}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                              >
                                <MapPin className="w-3.5 h-3.5 shrink-0" />
                                <span>{pl.title}</span>
                                <ExternalLink className="w-3 h-3 shrink-0" />
                              </a>
                              {pl.snippets.length > 0 && (
                                <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                                  {pl.snippets[0]}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
