/**
 * @jest-environment node
 */
import { isQuotaOrRateLimitError } from './gemini-adapter';

describe('isQuotaOrRateLimitError', () => {
  it('identifies 429 errors', () => {
    expect(isQuotaOrRateLimitError(new Error('[429 Too Many Requests] ...'))).toBe(true);
  });

  it('identifies quota errors by keyword', () => {
    expect(isQuotaOrRateLimitError(new Error('Quota exceeded for metric: ...'))).toBe(true);
  });

  it('identifies rate limit errors', () => {
    expect(isQuotaOrRateLimitError(new Error('rate limit exceeded'))).toBe(true);
    expect(isQuotaOrRateLimitError(new Error('Rate-limit hit'))).toBe(true);
  });

  it('identifies RESOURCE_EXHAUSTED', () => {
    expect(isQuotaOrRateLimitError(new Error('code: RESOURCE_EXHAUSTED'))).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isQuotaOrRateLimitError(new Error('connection refused'))).toBe(false);
    expect(isQuotaOrRateLimitError(new Error('bad request'))).toBe(false);
  });

  it('handles non-Error inputs', () => {
    expect(isQuotaOrRateLimitError('quota err string')).toBe(true);
    expect(isQuotaOrRateLimitError(null)).toBe(false);
    expect(isQuotaOrRateLimitError(undefined)).toBe(false);
  });
});

describe('createModelFactory', () => {
  // Lazy-import to avoid loading Groq/Gemini SDKs up-front.
  it('requires at least one API key', async () => {
    const { createModelFactory } = await import('./model-factory');
    expect(() => createModelFactory({})).toThrow(/no model credentials/i);
  });

  it('builds a factory when only Groq key is set', async () => {
    const { createModelFactory } = await import('./model-factory');
    expect(() => createModelFactory({ groqApiKey: 'xxx' })).not.toThrow();
  });

  it('builds a factory when only Gemini key is set', async () => {
    const { createModelFactory } = await import('./model-factory');
    expect(() => createModelFactory({ geminiApiKey: 'xxx' })).not.toThrow();
  });
});
