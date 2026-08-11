import { describe, it, expect } from 'vitest'
import { redactText } from '../lib/redact'

describe('redactText', () => {
  it('redacts a full card number and preserves last 4', () => {
    const input = 'Charge 4111 1111 1111 1111 for dinner';
    const { redacted, findings } = redactText(input);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(redacted).not.toMatch(/\d{13,}/);
    expect(redacted).toMatch(/XXXX.*1111/);
  });

  it('handles partially masked numbers', () => {
    const input = 'Card **** **** **** 1234 used';
    const { redacted, findings } = redactText(input);
    // Should not introduce 13+ digit sequences
    expect(redacted).not.toMatch(/\d{13,}/);
    // last 4 should remain
    expect(redacted).toMatch(/1234/);
  });

  it('leaves non-card text alone', () => {
    const input = 'Invoice ID 20260810-12345';
    const { redacted, findings } = redactText(input);
    expect(findings.length).toBe(0);
    expect(redacted).toBe(input);
  });

  it('redacts multiple card numbers and records findings', () => {
    const input = 'Payment 4111 1111 1111 1111 and 378282246310005 both charged';
    const { redacted, findings } = redactText(input);
    expect(redacted).not.toMatch(/\d{13,}/);
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings.every(f => f.luhnPassed)).toBe(true);
  });


  it('masks long non-Luhn numeric sequences (safety pass)', () => {
    const input = 'Ref 12345678901234 is a long id';
    const { redacted } = redactText(input);
    // No contiguous 13+ digits should remain
    expect(redacted).not.toMatch(/\d{13,}/);
  });

  it('handles numbers across newlines and mixed spacing', () => {
    const input = 'Line1 4111111111111111\nLine2 4111 1111 1111 1111';
    const { redacted } = redactText(input);
    expect(redacted).not.toMatch(/\d{13,}/);
  });

  it('boundary lengths: 12-digit stays, 13-digit gets redacted', () => {
    const input12 = 'ID 123456789012 end';
    const { redacted: r12, findings: f12 } = redactText(input12);
    expect(f12.length).toBe(0);
    expect(r12).toBe(input12);

    const input13 = 'ID 1234567890123 end';
    const { redacted: r13, findings: f13 } = redactText(input13);
    expect(f13.length).toBeGreaterThanOrEqual(1);
    expect(r13).not.toMatch(/\d{13,}/);
  });

  it('handles parentheses and masked group formats', () => {
    const input = 'Charge (4111)1111-1111-1111 and **** **** **** 1234';
    const { redacted, findings } = redactText(input);
    // Should redact the contiguous number and leave masked last-4 intact
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(redacted).not.toMatch(/\d{13,}/);
    expect(redacted).toMatch(/1234/);
  });

  it('handles full-width Unicode digits and redacts them', () => {
    const input = '支払い: ４１１１ １１１１ １１１１ １１１１';
    const { redacted, findings } = redactText(input);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(redacted).not.toMatch(/\d{13,}/);
  });

  it('does not redact numbers interleaved with letters (alphanumeric obfuscation)', () => {
    const input = 'Card 4111a1111b1111c1111 should not be altered';
    const { redacted, findings } = redactText(input);
    expect(findings.length).toBe(0);
    expect(redacted).toBe(input);
  });


  it('still redacts contiguous digit sequences even if other mixed sequences exist nearby', () => {
    const input = 'Mix 4111111111111111abc4111111111111';
    const { redacted, findings } = redactText(input);
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(redacted).not.toMatch(/\d{13,}/);
  });

  it('records only masked digits in findings and never leaves 13+ raw digits', () => {
    const input = 'Charge 4111 1111 1111 1111';
    const { findings } = redactText(input);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    findings.forEach((finding) => {
      expect(finding.masked).not.toMatch(/\d{13,}/);
      expect(finding.masked).toMatch(/XXXX/);
      expect(finding.masked).toMatch(/1111$/);
    });
  });

  it('is idempotent when called twice on the same input', () => {
    const input = 'Payment 4111 1111 1111 1111';
    const first = redactText(input);
    const second = redactText(input);
    expect(second.redacted).toBe(first.redacted);
    expect(second.findings).toEqual(first.findings);
  });

  it('redacts adjacent card candidates separated by text', () => {
    const input = '4111111111111111 abc 378282246310005';
    const { redacted, findings } = redactText(input);
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(redacted).not.toMatch(/\d{13,}/);
  });

  it('does not alter masked-only card strings', () => {
    const input = 'Use card **** **** **** 1234 instead';
    const { redacted, findings } = redactText(input);
    expect(findings.length).toBe(0);
    expect(redacted).toBe(input);
  });

  it('redacts card numbers surrounded by non-English characters', () => {
    const input = '支払いカード: 4111 1111 1111 1111 (受領済)';
    const { redacted, findings } = redactText(input);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(redacted).not.toMatch(/\d{13,}/);
    expect(redacted).toMatch(/XXXX .* 1111/);
  });

  it('handles special characters and extra spaces around numbers', () => {
    const input = 'Paid: ***   4111  1111   1111 1111   ###';
    const { redacted, findings } = redactText(input);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(redacted).not.toMatch(/\d{13,}/);
    expect(redacted).toMatch(/1111/);
  });

  it('treats OCR-style noise conservatively and does not redact obfuscated text', () => {
    const input = 'Card 4111 O111 111I 1111 should not be altered';
    const { redacted, findings } = redactText(input);
    expect(findings.length).toBe(0);
    expect(redacted).toBe(input);
  });

  it('redacts long non-Luhn numeric IDs as a safety precaution', () => {
    const input = 'Invoice 12345678901234567 sent';
    const { redacted, findings } = redactText(input);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(redacted).not.toMatch(/\d{13,}/);
  });

  it('redacts mixed ASCII and full-width digits in a single candidate', () => {
    const input = 'Card 4111 １１１１ 1111 １１１１ now';
    const { redacted, findings } = redactText(input);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(redacted).not.toMatch(/\d{13,}/);
  });

  it('ensures findings do not expose raw 13+ digit sequences', () => {
    const input = 'Charge 4111 1111 1111 1111 for dinner';
    const { findings } = redactText(input);
    findings.forEach((finding) => {
      expect(finding.original).not.toMatch(/\d{13,}/);
      expect(finding.masked).not.toMatch(/\d{13,}/);
      expect(finding.masked).toMatch(/XXXX/);
    });
  });

});
