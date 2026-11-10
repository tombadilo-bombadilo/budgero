import { createQuestion } from '@features/reports/lib/question';
import {
  clearAllQuestionDrafts,
  clearQuestionDraft,
  loadQuestionDraft,
  saveQuestionDraft,
} from './question-drafts';

afterEach(clearAllQuestionDrafts);

describe('question drafts', () => {
  it('keeps one draft per budget and question', () => {
    const spec = createQuestion('accounts');
    saveQuestionDraft(1, null, spec);
    expect(loadQuestionDraft(1, null)).toBe(spec);
    expect(loadQuestionDraft(2, null)).toBeNull();
    expect(loadQuestionDraft(1, 'q1')).toBeNull();
    clearQuestionDraft(1, null);
    expect(loadQuestionDraft(1, null)).toBeNull();
  });

  it('forgets the oldest drafts past the cap', () => {
    for (let index = 0; index < 25; index += 1) {
      saveQuestionDraft(1, `q${index}`, createQuestion());
    }
    expect(loadQuestionDraft(1, 'q0')).toBeNull();
    expect(loadQuestionDraft(1, 'q24')).not.toBeNull();
  });
});
