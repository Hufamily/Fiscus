type Finding = {
  original: string;
  masked: string;
  start: number;
  end: number;
  luhnPassed: boolean;
};

function normalizeDigits(s: string): string {
  // Convert full-width digits (U+FF10..U+FF19) to ASCII 0-9
  const ascii = s.replace(/[\uFF10-\uFF19]/g, (ch) => {
    return String.fromCharCode(ch.charCodeAt(0) - 0xFF10 + 0x30);
  });
  return ascii.replace(/\D/g, "");
}

function passesLuhn(digits: string): boolean {
  const arr = digits.split("").reverse().map((d) => parseInt(d, 10));
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    let val = arr[i];
    if (i % 2 === 1) {
      val = val * 2;
      if (val > 9) val -= 9;
    }
    sum += val;
  }
  return sum % 10 === 0;
}

function maskNormalizedDigits(norm: string, maskChar = "X"): string {
  if (norm.length <= 4) return norm;
  const keep = 4;
  const masked = maskChar.repeat(Math.max(0, norm.length - keep)) + norm.slice(-keep);
  return masked;
}

export function redactText(input: string): { redacted: string; findings: Finding[] } {
  const findings: Finding[] = [];

  // Regex to catch substrings that contain digits, spaces, common separators,
  // full-width digits, parentheses, or mask chars. We'll normalize and validate
  // by digit count + Luhn afterwards.
  const candidateRe = /[\d\-\s\uFF10-\uFF19\.\(\)\*\/]{13,160}/g;

  let out = input;
  // We'll accumulate replacements by doing a replace with a function.
  out = out.replace(candidateRe, (match, offset) => {
    const norm = normalizeDigits(match);
    const luhn = norm.length >= 13 && norm.length <= 19 && passesLuhn(norm);
    if (!luhn) {
      // If not Luhn-valid, don't aggressively redact; return original match unchanged.
      return match;
    }

    const maskedNorm = maskNormalizedDigits(norm);

    // Rebuild masked string preserving separators
    let digitIndex = 0;
    let rebuilt = "";
    for (let i = 0; i < match.length; i++) {
      const ch = match[i];
      if (/\d/.test(ch)) {
        rebuilt += maskedNorm[digitIndex++] || ch;
      } else {
        rebuilt += ch;
      }
    }

    // Record finding (store masked, not original digits)
    findings.push({ original: match, masked: rebuilt, start: offset as number, end: (offset as number) + match.length, luhnPassed: luhn });
    return rebuilt;
  });

  // Final safety pass: if any contiguous 13+ digits remain (edge cases), mask them conservatively
  // and record a finding so callers can audit all redactions.
  out = out.replace(/\d{13,}/g, (digits: string, offset: number) => {
    const norm = normalizeDigits(digits);
    const luhn = norm.length >= 13 && norm.length <= 19 && passesLuhn(norm);
    const masked = maskNormalizedDigits(norm);
    // For the replaced string, try to preserve grouping like original (best-effort)
    // If original had separators, they'd be digits only here, so we return masked as-is.
    findings.push({ original: digits, masked, start: offset, end: offset + digits.length, luhnPassed: luhn });
    return masked;
  });

  return { redacted: out, findings };
}

export { Finding };

// Convenience wrapper: returns only the redacted string (B2 usage).
export function redact(text: string): string {
  return redactText(text).redacted;
}
