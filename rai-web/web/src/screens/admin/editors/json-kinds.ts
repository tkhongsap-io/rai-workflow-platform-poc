// W6-11 (W6 plan sections 1.2 Q16 and 6): the configuration kinds edited as schema-validated JSON (the identity
// mapping; W6-12 adds the risk rubric). Pure. The page shows the body as indented JSON and sends only a JSON object;
// every rule of what may be published is the server's (`publishProblems`, W6-03), listed after a save (Q18).

export const JSON_KINDS = ['group_role_mapping'] as const;
export type JsonKind = (typeof JSON_KINDS)[number];

export function isJsonKind(kind: string): kind is JsonKind {
  return (JSON_KINDS as readonly string[]).includes(kind);
}

/** The editor's text for `body` (the draft's, or the revision in force's; `{}` before anything exists). */
export function jsonTextOf(body: Readonly<Record<string, unknown>> | undefined): string {
  return body === undefined ? '{}' : JSON.stringify(body, null, 2);
}

export type ParsedJsonBody = { ok: true; body: Record<string, unknown> } | { ok: false };

/** The body a save sends, or `{ ok: false }` when the text is not a JSON object (nothing is sent then). */
export function parseJsonBody(text: string): ParsedJsonBody {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false };
  return { ok: true, body: value as Record<string, unknown> };
}
