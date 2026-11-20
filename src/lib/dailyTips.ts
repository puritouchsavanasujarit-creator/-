import {
  CHAT_SCRIPTS,
  QUIZ_QUESTIONS,
  SALES_STAGES,
  SHIFT_WORKFLOWS,
  UPSELL_OPTIONS,
} from '@/src/data/playbookData';
import type { AppTab } from '@/src/types';

export interface ServiceTip {
  id: string;
  sourceLabel: string;
  category: string;
  title: string;
  excerpt: string;
  sampleScript?: string;
  keyTakeaway?: string;
  recommendedTab: AppTab;
}

export const DAILY_TIP_SESSION_KEY = 'chatcraft_daily_service_tip_shown_v1';

export function buildPlaybookServiceTips(): ServiceTip[] {
  const tips: ServiceTip[] = [];

  for (const q of QUIZ_QUESTIONS) {
    tips.push({
      id: `sop-${q.id}`,
      sourceLabel: 'มาตรฐาน SOP',
      category: q.category,
      title: q.question,
      excerpt: q.explanation,
      keyTakeaway: q.options[q.correctIndex],
      recommendedTab: 'quiz',
    });
  }

  for (const stage of SALES_STAGES) {
    tips.push({
      id: `stage-${stage.step}`,
      sourceLabel: 'Flow การขาย 6 ขั้นตอน',
      category: `ขั้นตอนที่ ${stage.step}`,
      title: stage.label,
      excerpt: stage.shortDesc,
      recommendedTab: 'playbook',
    });
  }

  CHAT_SCRIPTS.forEach((script, index) => {
    tips.push({
      id: `script-${index}`,
      sourceLabel: 'คลังสคริปต์ตอบแชท',
      category: script.category,
      title: script.title,
      excerpt:
        'เลือกใช้ข้อความมาตรฐานจาก Playbook แล้วปรับให้เข้ากับสถานการณ์ลูกค้า พร้อมปิดท้ายด้วยคำถามเพื่อรักษาบทสนทนา',
      sampleScript: script.text,
      recommendedTab: 'simulator',
    });
  });

  for (const upsell of UPSELL_OPTIONS) {
    tips.push({
      id: `upsell-${upsell.id}`,
      sourceLabel: 'แนวทาง Upsell',
      category: 'เพิ่มมูลค่าออเดอร์',
      title: upsell.title,
      excerpt: `เหมาะสำหรับ: ${upsell.bestFor} (${upsell.priceText}) · หากลูกค้าปฏิเสธให้ตอบ “ยินดีค่ะ” และสรุปยอดเซตเดิมทันที`,
      sampleScript: upsell.script,
      recommendedTab: 'playbook',
    });
  }

  for (const workflow of SHIFT_WORKFLOWS) {
    tips.push({
      id: `shift-${workflow.shift}`,
      sourceLabel: 'การส่งต่อตามกะ',
      category: workflow.label,
      title: workflow.shift,
      excerpt: workflow.steps.join(' · '),
      recommendedTab: 'playbook',
    });
  }

  return tips;
}

export function pickRandomServiceTip(excludeId?: string): ServiceTip {
  const allTips = buildPlaybookServiceTips();
  const candidates =
    excludeId && allTips.length > 1
      ? allTips.filter((tip) => tip.id !== excludeId)
      : allTips;
  const randomIndex = Math.floor(Math.random() * candidates.length);
  return candidates[randomIndex];
}
