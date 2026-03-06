// Fabric-SDK AIANA -- secret scrubbing
// Redacts PII and secrets before embedding or storage

const SCRUB_RULES: Array<[RegExp, string]> = [
  [/ghp_[A-Za-z0-9]+/g, '[REDACTED]'],
  [/ghs_[A-Za-z0-9]+/g, '[REDACTED]'],
  [/github_pat_[A-Za-z0-9_]+/g, '[REDACTED]'],
  [/sk-[A-Za-z0-9\-_]{20,}/g, '[REDACTED]'],
  [/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, 'Bearer [REDACTED]'],
  [/[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}/g, '[REDACTED]'],
  [/password\s*["'\s:=]+[^\s"']+/gi, 'password [REDACTED]'],
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED]'],
  [/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[REDACTED]'],
  [/\bapi[_-]?key\s*[:=]\s*\S+/gi, 'api_key [REDACTED]'],
];

export function scrub(text: string): string {
  let result = text;
  for (const [pattern, replacement] of SCRUB_RULES) {
    result = result.replace(pattern, replacement);
  }
  return result;
}
