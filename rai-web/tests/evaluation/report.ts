// W4-08a (W4b plan section 11.2 "Report"): `report.json` and `report.md` of one evaluation run. They hold the run's
// identity (and its digest) and the grade: identities, hashes, locators and counts, never document text, a filename,
// a finding message or a param. `summaryLines` is what `npm run eval:qc` prints.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Counts, Grade, LatencyStats } from './grade.js';
import { identityDigestOf, type EvalIdentity } from './identity.js';

export const REPORT_SCHEMA = 'rai-qc-eval-report/1' as const;

export interface EvalReport {
  schema: typeof REPORT_SCHEMA;
  generatedAt: string;
  identity: EvalIdentity;
  identityDigest: string;
  grade: Grade;
}

export function buildReport(identity: EvalIdentity, grade: Grade, generatedAt: Date): EvalReport {
  return {
    schema: REPORT_SCHEMA,
    generatedAt: generatedAt.toISOString(),
    identity,
    identityDigest: identityDigestOf(identity),
    grade,
  };
}

const num = (v: number | null): string =>
  v === null ? 'n/a' : Number.isInteger(v) ? String(v) : v.toFixed(4);
const ms = (v: number | null): string => (v === null ? 'n/a' : `${v} ms`);
const table = (head: string[], rows: string[][]): string[] => [
  `| ${head.join(' | ')} |`,
  `| ${head.map(() => '---').join(' | ')} |`,
  ...rows.map((r) => `| ${r.join(' | ')} |`),
];
const countCells = (c: Counts) => [String(c.tp), String(c.fp), String(c.fn), num(c.precision), num(c.recall)];
const where = (m: {
  caseId: string;
  trigger: string;
  lane: string | null;
  slot: number | null;
  part: string;
}) =>
  `${m.caseId} ${m.trigger}${m.slot === null ? '' : ` slot ${m.slot}`}${m.lane === null ? '' : ` ${m.lane}`} ${m.part}`;
const latencyCells = (name: string, l: LatencyStats) => [
  name,
  String(l.count),
  ms(l.p50),
  ms(l.p95),
  ms(l.max),
];

export function reportMarkdown(report: EvalReport): string {
  const { identity: id, grade: g } = report;
  const lines: string[] = [
    '# QC evaluation report',
    '',
    `Dataset \`${id.dataset.label}\`, split \`${id.dataset.split}\`. Generated ${report.generatedAt}. Identities, hashes, locators and counts only; no document text.`,
    '',
    '## Identity',
    '',
    ...table(
      ['Part', 'Value'],
      [
        ['identityDigest', `\`${report.identityDigest}\``],
        ['code', `\`${id.code.commit}\`${id.code.dirty ? ' (dirty)' : ''}`],
        [
          'deterministic runner',
          `\`${id.runners.deterministic.runner}\` \`${id.runners.deterministic.runnerVersion}\``,
        ],
        ['content runner', `\`${id.runners.content.runner}\` \`${id.runners.content.runnerVersion}\``],
        ['extractor', `\`${id.extractor.version}\``],
        ['rules', `\`${id.rules.label}\` body \`${id.rules.bodySha256}\` revision \`${id.rules.revision}\``],
        ['templates', id.templates.map((t) => `\`${t}\``).join(', ')],
        [
          'model',
          id.model.mode === 'disabled'
            ? '`disabled` (no model, no prompt)'
            : `\`${id.model.provider}\` \`${id.model.modelId}\` prompt \`${id.model.promptRevision}\``,
        ],
        [
          'dataset',
          `\`${id.dataset.name}@${id.dataset.version}\` \`${id.dataset.sha256}\` split \`${id.dataset.split}\``,
        ],
        ['grader', `\`${id.grader.version}\``],
        ['thresholds', `\`${id.thresholds.file}\` \`${id.thresholds.sha256}\``],
      ],
    ),
    '',
    '## Per rule',
    '',
    ...table(
      ['Rule', 'Engine', 'In catalogue', 'Labelled', 'Raised', 'TP', 'FP', 'FN', 'Precision', 'Recall'],
      g.rules.map((r) => [
        r.ruleId,
        r.engine,
        r.inCatalogue ? 'yes' : 'no',
        String(r.labelled),
        String(r.raised),
        ...countCells(r),
      ]),
    ),
    '',
    '## Per segment',
    '',
  ];
  for (const [dim, rows] of Object.entries(g.segments)) {
    lines.push(`### ${dim}`, '');
    lines.push(
      ...table(
        [dim, 'TP', 'FP', 'FN', 'Precision', 'Recall'],
        rows.map((r) => [r.value, ...countCells(r)]),
      ),
    );
    lines.push('');
  }
  if (g.findings.mismatches.length > 0) {
    lines.push('### Finding mismatches', '');
    lines.push(
      ...table(
        ['Kind', 'Run part', 'Rule', 'Owning lane', 'Scope', 'Evidence'],
        g.findings.mismatches.map((m) => [
          m.kind.toUpperCase(),
          where(m),
          m.ruleId,
          m.owningLane,
          `\`${JSON.stringify(m.scope)}\``,
          `\`${JSON.stringify(m.evidence)}\``,
        ]),
      ),
      '',
    );
  }
  lines.push(
    '## Grounded citations',
    '',
    `${g.grounding.grounded} of ${g.grounding.citations} citations grounded (rate ${num(g.grounding.rate)}): the artifact is the request's, with the same slot and content hash, and re-extraction yields the same excerpt hash at the locator.`,
    '',
    ...table(
      ['Rule', 'Citations', 'Grounded', 'Rate'],
      g.grounding.byRule.map((r) => [r.ruleId, String(r.citations), String(r.grounded), num(r.rate)]),
    ),
    '',
  );
  if (g.grounding.failures.length > 0)
    lines.push(
      ...table(
        ['Run part', 'Rule', 'Cited slot', 'Locator', 'Problem'],
        g.grounding.failures.map((f) => [where(f), f.ruleId, String(f.citedSlot), f.locatorKind, f.problem]),
      ),
      '',
    );
  lines.push(
    '## Unavailable handling',
    '',
    `${g.parts.statusMatched} of ${g.parts.total} run parts ended with the labelled status and reason (accuracy ${num(g.parts.accuracy)}); ${g.parts.unavailableMatched} of ${g.parts.expectedUnavailable} labelled-unavailable parts (accuracy ${num(g.parts.unavailableAccuracy)}).`,
    '',
  );
  if (g.parts.mismatches.length > 0)
    lines.push(
      ...table(
        ['Run part', 'Expected', 'Actual'],
        g.parts.mismatches.map((m) => [
          where(m),
          `${m.expected.status}${m.expected.reason === null ? '' : `:${m.expected.reason}`}`,
          `${m.actual.status}${m.actual.reason === null ? '' : `:${m.actual.reason}`}${m.actual.detail === null ? '' : ` (${m.actual.detail})`}`,
        ]),
      ),
      '',
    );
  lines.push(
    '## Lane scope and metadata kept',
    '',
    ...table(
      ['Measure', 'Value'],
      [
        [
          'approve-attempt content parts matching their label',
          `${g.laneScope.approveContentPartsMatched} of ${g.laneScope.approveContentParts}`,
        ],
        [
          'approve-attempt content findings owned by another lane',
          `${g.laneScope.foreignLaneFindings} of ${g.laneScope.approveContentFindings}`,
        ],
        [
          'labelled metadata findings recorded on cases with an unreadable slot 1, 2 or 5',
          `${g.metadataKept.recorded} of ${g.metadataKept.labelled} (rate ${num(g.metadataKept.rate)})`,
        ],
      ],
    ),
    '',
    '## Latency',
    '',
    ...table(
      ['Parts', 'Count', 'p50', 'p95', 'Max'],
      [
        latencyCells('all', g.latency.overall),
        latencyCells('deterministic', g.latency.deterministic),
        latencyCells('content', g.latency.content),
      ],
    ),
    '',
    '## Failures and cost',
    '',
    `Failures (runner_error, timeout): ${g.failures.count}. Cost: ${g.cost.usdMicros} USD micros (no provider; ${g.cost.modelCalls} model calls, ${g.cost.inputTokens} input and ${g.cost.outputTokens} output tokens).`,
    '',
  );
  if (g.failures.parts.length > 0)
    lines.push(
      ...table(
        ['Run part', 'Reason', 'Detail'],
        g.failures.parts.map((f) => [where(f), f.reason, f.detail ?? '']),
      ),
      '',
    );
  return `${lines.join('\n').trimEnd()}\n`;
}

export async function writeReport(dir: string, report: EvalReport): Promise<{ json: string; md: string }> {
  await mkdir(dir, { recursive: true });
  const json = path.join(dir, 'report.json');
  const md = path.join(dir, 'report.md');
  await writeFile(json, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(md, reportMarkdown(report));
  return { json, md };
}

/** The console summary of `npm run eval:qc`. */
export function summaryLines(report: EvalReport): string[] {
  const { grade: g, identity: id } = report;
  const pad = (s: string, n: number) => s.padEnd(n);
  const lines = [
    `eval:qc: dataset ${id.dataset.label} split ${id.dataset.split}`,
    `eval:qc: identityDigest ${report.identityDigest}`,
    `eval:qc: code ${id.code.commit}${id.code.dirty ? ' (dirty)' : ''}; rules ${id.rules.label} ${id.rules.bodySha256.slice(0, 12)}; extractor ${id.extractor.version}; model ${id.model.mode}; grader ${id.grader.version}`,
    'eval:qc: per rule (TP FP FN precision recall)',
    ...g.rules.map(
      (r) =>
        `  ${pad(r.ruleId, 34)} ${pad(r.engine, 13)} ${r.tp} ${r.fp} ${r.fn} ${num(r.precision)} ${num(r.recall)}${r.inCatalogue ? '' : ' (not in catalogue)'}`,
    ),
    'eval:qc: per segment (TP FP FN precision recall)',
  ];
  for (const [dim, rows] of Object.entries(g.segments))
    for (const r of rows)
      lines.push(
        `  ${pad(`${dim}=${r.value}`, 34)} ${r.tp} ${r.fp} ${r.fn} ${num(r.precision)} ${num(r.recall)}`,
      );
  lines.push(
    `eval:qc: grounded citations ${g.grounding.grounded}/${g.grounding.citations} (rate ${num(g.grounding.rate)})`,
    `eval:qc: unavailable handling ${g.parts.statusMatched}/${g.parts.total} parts (labelled unavailable ${g.parts.unavailableMatched}/${g.parts.expectedUnavailable})`,
    `eval:qc: lane scope: foreign-lane content findings ${g.laneScope.foreignLaneFindings}; metadata kept ${g.metadataKept.recorded}/${g.metadataKept.labelled}`,
    `eval:qc: latency p50 ${ms(g.latency.overall.p50)}, p95 ${ms(g.latency.overall.p95)}, max ${ms(g.latency.overall.max)} over ${g.latency.overall.count} parts`,
    `eval:qc: failures ${g.failures.count}; cost ${g.cost.usdMicros} USD micros`,
  );
  return lines;
}
