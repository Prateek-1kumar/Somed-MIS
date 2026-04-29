import { POWER_PROMPT, getPowerPromptSection } from './power-prompt';

describe('POWER_PROMPT', () => {
  it('loads non-empty content', () => {
    expect(POWER_PROMPT.length).toBeGreaterThan(500);
  });

  it('contains all expected top-level sections', () => {
    const required = [
      '# DECISION FLOW',
      '# ANTI-HALLUCINATION TRAPS',
      '# FORMULA DICTIONARY',
      '# CHART TYPE RULES',
      '# SQL FORMATTING RULES',
      '# WHEN IN DOUBT',
    ];
    for (const r of required) expect(POWER_PROMPT).toContain(r);
  });

  it('mentions the trailing-underscore trap for net_sales_', () => {
    expect(POWER_PROMPT).toMatch(/net_sales_/);
    expect(POWER_PROMPT).toMatch(/underscore/i);
  });

  it('mentions the gri_sales sign convention', () => {
    expect(POWER_PROMPT).toMatch(/gri_sales/);
    expect(POWER_PROMPT).toMatch(/negative/i);
  });

  it('contains the canonical FOC formula reference', () => {
    expect(POWER_PROMPT).toMatch(/SUM\(foc_value\)/);
  });

  it('section getter returns content for a known heading', () => {
    const flow = getPowerPromptSection('DECISION FLOW');
    expect(flow).toBeTruthy();
    expect(flow!.length).toBeGreaterThan(50);
  });

  it('section getter is case-insensitive', () => {
    expect(getPowerPromptSection('decision flow')).not.toBeNull();
  });

  it('section getter returns null for unknown heading', () => {
    expect(getPowerPromptSection('NONEXISTENT')).toBeNull();
  });
});
