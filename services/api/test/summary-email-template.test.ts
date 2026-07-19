import { describe, expect, it } from 'vitest';
import { renderSummaryEmail } from '../src/services/summary-email-template.js';

describe('summary email template', () => {
  it('renders Russian headings while preserving attributed source and translation text', () => {
    const rendered = renderSummaryEmail({
      meetingTitle: 'Цена <июль>',
      recipientDisplayName: 'Ivan',
      recipientLanguage: 'ru',
      summary: {
        id: 'summary-a', conversationId: 'conversation-a', summary: '报价确认',
        participantRoster: [{ displayName: 'Ivan', company: 'RU Co' }],
        coreDiscussion: [{
          speakerDisplayName: 'Ivan', speakerCompany: 'RU Co',
          sourceText: 'Подтверждаю', translatedText: '我确认',
        }],
        partyViews: [], confirmedItems: [], actionItems: [], openQuestions: [],
        customerRequirements: [], products: [], specifications: [], quantity: [], price: [],
        delivery: [], paymentTerms: [], sourceMaxSequence: 1, sourceMessageCount: 1,
        sourceLatestMessageUpdatedAt: new Date('2026-07-18T23:59:00Z'),
        revision: 1, generatedAt: new Date('2026-07-19T00:00:00Z'),
      },
    });
    expect(rendered.subject).toContain('Протокол встречи');
    expect(rendered.text).toContain('Подтверждаю');
    expect(rendered.text).toContain('我确认');
    expect(rendered.html).toContain('Цена &lt;июль&gt;');
    expect(rendered.html).not.toContain('Цена <июль>');
  });
});
