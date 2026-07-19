import type { ConversationSummary, Language, Prisma } from '@prisma/client';

interface SummaryEmailInput {
  meetingTitle: string;
  recipientDisplayName: string;
  recipientLanguage: Language;
  summary: ConversationSummary;
}

export interface RenderedSummaryEmail {
  subject: string;
  text: string;
  html: string;
}

const labels = {
  zh: {
    subject: '会议纪要', greeting: '您好', intro: '主持人向您发送了以下会议纪要。',
    meeting: '会议', generated: '生成时间', revision: '纪要版本', participants: '参会人员',
    overview: '会议概要', discussion: '核心讨论内容', views: '各方观点',
    confirmed: '已确认事项', actions: '待办事项及负责人', open: '尚未解决的问题',
    original: '原文', translation: '译文', assignee: '负责人', due: '截止时间',
    empty: '暂无', footer: '本邮件由 RUSCNY 中俄实时语音翻译 App 发送。重要事项请结合会议原始记录确认。',
  },
  ru: {
    subject: 'Протокол встречи', greeting: 'Здравствуйте', intro: 'Ведущий отправил вам протокол встречи.',
    meeting: 'Встреча', generated: 'Дата создания', revision: 'Версия', participants: 'Участники',
    overview: 'Краткое содержание', discussion: 'Основные обсуждения', views: 'Позиции сторон',
    confirmed: 'Подтвержденные решения', actions: 'Задачи и ответственные', open: 'Нерешенные вопросы',
    original: 'Оригинал', translation: 'Перевод', assignee: 'Ответственный', due: 'Срок',
    empty: 'Нет данных', footer: 'Письмо отправлено приложением RUSCNY для китайско-русского перевода. Важные пункты следует сверить с исходной записью встречи.',
  },
} as const;

export function renderSummaryEmail(input: SummaryEmailInput): RenderedSummaryEmail {
  const locale = input.recipientLanguage === 'ru' ? 'ru' : 'zh';
  const t = labels[locale];
  const summary = input.summary;
  const participants = jsonObjects(summary.participantRoster).map((item) =>
    [stringValue(item.displayName), stringValue(item.company)].filter(Boolean).join('｜'),
  ).filter(Boolean);
  const discussion = jsonObjects(summary.coreDiscussion).slice(0, 400).map((item) => {
    const speaker = [stringValue(item.speakerDisplayName), stringValue(item.speakerCompany)]
      .filter(Boolean).join('｜');
    const source = clip(stringValue(item.sourceText), 4_000);
    const translated = clip(stringValue(item.translatedText), 4_000);
    return `${speaker || '-'}\n${t.original}：${source || '-'}\n${t.translation}：${translated || '-'}`;
  });
  const views = jsonObjects(summary.partyViews).map((item) =>
    `${stringValue(item.speakerDisplayName) || '-'}：${clip(stringValue(item.view), 8_000)}`,
  );
  const confirmed = textItems(summary.confirmedItems);
  const actions = jsonObjects(summary.actionItems).map((item) => {
    const details = [
      `${t.assignee}：${stringValue(item.assigneeDisplayName) || '-'}`,
      ...(stringValue(item.dueAt) ? [`${t.due}：${stringValue(item.dueAt)}`] : []),
    ].join('；');
    return `${clip(stringValue(item.text), 8_000)}（${details}）`;
  });
  const open = textItems(summary.openQuestions);
  const generatedAt = summary.generatedAt.toISOString();

  const sections: Array<[string, string[]]> = [
    [t.participants, participants],
    [t.overview, [clip(summary.summary, 20_000)]],
    [t.discussion, discussion],
    [t.views, views],
    [t.confirmed, confirmed],
    [t.actions, actions],
    [t.open, open],
  ];
  const text = clip([
    `${t.greeting}，${input.recipientDisplayName}：`,
    '',
    t.intro,
    `${t.meeting}：${input.meetingTitle}`,
    `${t.generated}：${generatedAt}`,
    `${t.revision}：${summary.revision}`,
    '',
    ...sections.flatMap(([title, values]) => [
      `【${title}】`,
      ...(values.length ? values.map((value) => `- ${value}`) : [`- ${t.empty}`]),
      '',
    ]),
    t.footer,
  ].join('\n'), 450_000);

  const htmlSections = sections.map(([title, values]) => `
    <section style="margin:24px 0">
      <h2 style="font-size:18px;color:#103f35;margin:0 0 10px">${escapeHtml(title)}</h2>
      ${values.length
        ? `<ul style="padding-left:22px;margin:0">${values.map((value) =>
            `<li style="margin:8px 0;white-space:pre-wrap">${escapeHtml(value)}</li>`).join('')}</ul>`
        : `<p style="color:#667085">${escapeHtml(t.empty)}</p>`}
    </section>`).join('');
  const html = `<!doctype html><html lang="${locale}"><body style="margin:0;background:#f4f7f6;color:#172b27;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
    <div style="max-width:720px;margin:0 auto;padding:28px 16px">
      <div style="background:#fff;border:1px solid #dfe9e6;border-radius:16px;padding:28px">
        <p>${escapeHtml(t.greeting)}，${escapeHtml(input.recipientDisplayName)}：</p>
        <p>${escapeHtml(t.intro)}</p>
        <h1 style="font-size:24px;color:#103f35;margin:24px 0 10px">${escapeHtml(input.meetingTitle)}</h1>
        <p style="color:#667085">${escapeHtml(t.generated)}：${escapeHtml(generatedAt)}<br>${escapeHtml(t.revision)}：${summary.revision}</p>
        ${htmlSections}
        <p style="border-top:1px solid #e7eeec;padding-top:18px;color:#667085;font-size:13px">${escapeHtml(t.footer)}</p>
      </div>
    </div>
  </body></html>`;
  return {
    subject: `${t.subject}：${input.meetingTitle}`,
    text,
    html,
  };
}

function jsonObjects(value: Prisma.JsonValue): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  const objects: Array<Record<string, unknown>> = [];
  for (const item of value) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      objects.push(item as unknown as Record<string, unknown>);
    }
  }
  return objects;
}

function textItems(value: Prisma.JsonValue): string[] {
  return jsonObjects(value).map((item) => clip(
    stringValue(item.text) || stringValue(item.view),
    8_000,
  )).filter(Boolean);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clip(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, Math.max(0, maximum - 1))}…`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
