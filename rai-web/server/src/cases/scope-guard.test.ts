// W0-05 "Query scope" guard (W3-F8, register "W3 deferred rulings" item 13): every read of the `case` table in
// server code either takes `caseScopeWhere(actor)` as a conjunct of its WHERE or is named, with a reason, in
// ALLOW_LIST below. The analyzer walks the TypeScript AST (never regular expressions over lines) and resolves names
// with the compiler's binder, one file at a time, so shadowing and property names cannot pass for a variable.
//
// A site is: a Drizzle `.from(T)` / `…Join(T, …)` / `.$count(T, …)`; a relational `query.cases` / `with: { case }`;
// any string or template literal whose text names the table (`"case"`, `x.case`) or puts an interpolated table
// name after FROM / JOIN / a FROM-list comma; and any other use of the table object (passed to a helper, exported,
// put in a conditional), because the guard cannot follow it there. T is the schema's `cases` under any import
// name, a `const` holding it, a namespace member or destructured field, an `alias(cases, …)` or a
// `pgTable('case', …)`. Writes (insert, update, delete) are not sites.
// A site is scoped when every `.where(…)` on its query (the fluent chain, and later statements on the variable
// holding it) is conjunctive in `caseScopeWhere(p)` with p a parameter of the enclosing code: the call itself, an
// `and(…)` argument, a `const`/`let` only ever assigned such a value, a `const` array only `push`ed and spread into
// `and(…)`, or a parameter of a local, unexported function whose every caller passes one. `or`, `not`, `?:`, `??`
// and `sql` wrappers are not conjunctive. An inner-join ON, a builder returned by a local helper whose every caller
// applies the where, and a raw `sql` template with one read and `WHERE|AND ${scope}` (no OR) also count.
// Known limits (read by a reviewer, not proved by the test): the actor is checked to be a parameter, not the
// request's actor; SQL split across literals so none names the table, or built by a helper in another module, is
// not seen; a raw template's SQL nesting is not parsed; the allow-list is keyed by file and function name, so a
// new unscoped read under a reused function name can take a vacated slot.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

interface Site {
  file: string;
  line: number;
  fn: string; // the nearest named enclosing function, method, class field or `const f = () => …`; else '<module>'
  kind: 'builder' | 'count' | 'relational' | 'sql' | 'escape';
  scoped: boolean;
}

interface AllowEntry {
  file: string; // repository-relative
  fn: string;
  count: number;
  reason: string;
}

const EXT = String.raw`(\.[cm]?[jt]sx?)?$`;
const CASE_MODULE = new RegExp(String.raw`(^|/)schema/(case|index)${EXT}`); // modules that export `cases`
const SCHEMA_MODULE = new RegExp(String.raw`(^|/)schema/[\w-]+${EXT}`); // any schema table module
const CLIENT_MODULE = new RegExp(String.raw`(^|/)db/client${EXT}`); // exports the schema namespace as `schema`
const SCOPE_MODULE = new RegExp(String.raw`(^|/)scope${EXT}`);
const DRIZZLE = /^drizzle-orm(\/|$)/;
const TABLE_HOME = /(^|\/)db\/(schema\/[^/]+|client)\.[cm]?tsx?$/; // may define, export and pass the table around
const BUILDER_METHODS = new Set([
  'from',
  'join',
  'innerJoin',
  'leftJoin',
  'rightJoin',
  'fullJoin',
  'crossJoin',
  'innerJoinLateral',
  'leftJoinLateral',
  'crossJoinLateral',
]);
const WRITES = new Set(['insert', 'update', 'delete']);
const PROJECTIONS = new Set(['select', 'selectDistinct', 'selectDistinctOn', 'returning']);
// `"case"` is a reserved word in Postgres, so the table is always quoted or schema-qualified; bare CASE is the keyword.
const CASE_TABLE_TEXT = /(?:(?:\b\w+|"\w+")\.)?"case"(?!\s*\.)|(?:\b\w+|"\w+")\.case\b(?!\s*\.)/gi;
const WRITE_TARGET = /(?:\b(?:update|into)|\bdelete\s+from)\s+(?:only\s+)?$/i;

function unwrap(node: ts.Expression): ts.Expression {
  let n = node;
  while (
    ts.isParenthesizedExpression(n) ||
    ts.isAsExpression(n) ||
    ts.isNonNullExpression(n) ||
    ts.isSatisfiesExpression(n) ||
    ts.isTypeAssertionExpression(n)
  )
    n = n.expression;
  return n;
}

const nameText = (n: ts.Node | undefined): string | undefined =>
  n !== undefined && (ts.isIdentifier(n) || ts.isStringLiteralLike(n)) ? n.text : undefined;

/** `a.b` → 'b', `a['b']` → 'b'. */
function memberName(n: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(n)) return n.name.text;
  if (ts.isElementAccessExpression(n)) return nameText(n.argumentExpression);
  return undefined;
}

function enclosingFunctionName(node: ts.Node): string {
  for (let n: ts.Node | undefined = node.parent; n !== undefined; n = n.parent) {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name !== undefined)
      return n.name.getText();
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
      if (ts.isFunctionExpression(n) && n.name !== undefined) return n.name.text;
      const p = n.parent;
      if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
      if (ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) return p.name.getText();
      // an anonymous callback such as `db.transaction(async (tx) => …)`: keep walking to its named owner
    }
  }
  return '<module>';
}

/** Binds one file on its own (no lib, no module resolution): enough to resolve every local name and import. */
function bind(file: string, text: string): { sf: ts.SourceFile; checker: ts.TypeChecker } {
  const kind = /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const host: ts.CompilerHost = {
    getSourceFile: () => sf,
    getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: () => {},
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: () => false,
    readFile: () => undefined,
  };
  const options: ts.CompilerOptions = { noLib: true, noResolve: true, types: [] };
  return { sf, checker: ts.createProgram({ rootNames: [file], options, host }).getTypeChecker() };
}

/** Finds every case-table read in one source file and whether it carries the scope predicate. */
function analyzeSource(file: string, text: string): Site[] {
  const { sf, checker } = bind(file, text);

  // ---- names: what an identifier is bound to ----

  const symbolOf = (id: ts.Identifier): ts.Symbol | undefined => {
    const p = id.parent;
    if (ts.isShorthandPropertyAssignment(p) && p.name === id)
      return checker.getShorthandAssignmentValueSymbol(p);
    if (ts.isExportSpecifier(p) && (p.propertyName ?? p.name) === id)
      return checker.getExportSpecifierLocalTargetSymbol(p);
    return checker.getSymbolAtLocation(id);
  };
  const declOf = (id: ts.Identifier): ts.Declaration | undefined => symbolOf(id)?.declarations?.[0];

  let refIndex: Map<ts.Symbol, ts.Identifier[]> | undefined;
  /** Every identifier in the file bound to `decl`, except its own name. */
  const referencesOf = (decl: ts.NamedDeclaration): ts.Identifier[] => {
    if (refIndex === undefined) {
      const index = new Map<ts.Symbol, ts.Identifier[]>();
      const walk = (n: ts.Node): void => {
        if (ts.isIdentifier(n)) {
          const s = symbolOf(n);
          if (s !== undefined) index.set(s, [...(index.get(s) ?? []), n]);
        }
        ts.forEachChild(n, walk);
      };
      walk(sf);
      refIndex = index;
    }
    const sym = decl.name === undefined ? undefined : checker.getSymbolAtLocation(decl.name);
    return (sym === undefined ? [] : (refIndex.get(sym) ?? [])).filter((r) => r !== decl.name);
  };

  const importModule = (d: ts.ImportSpecifier | ts.NamespaceImport): string => {
    const decl = ts.isImportSpecifier(d) ? d.parent.parent.parent : d.parent.parent;
    return (decl.moduleSpecifier as ts.StringLiteral).text;
  };

  /** The imported module and name behind `f` or `ns.f`, whatever the local names are. */
  const origin = (expr: ts.Expression): { module: string; name: string } | undefined => {
    const e = unwrap(expr);
    if (ts.isIdentifier(e)) {
      const d = declOf(e);
      if (d !== undefined && ts.isImportSpecifier(d))
        return { module: importModule(d), name: (d.propertyName ?? d.name).text };
    }
    if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) {
      const d = declOf(e.expression);
      if (d !== undefined && ts.isNamespaceImport(d)) return { module: importModule(d), name: e.name.text };
    }
    return undefined;
  };
  const isDrizzle = (callee: ts.Expression, name: string): boolean => {
    const o = origin(callee);
    return o !== undefined && o.name === name && DRIZZLE.test(o.module);
  };

  const isConst = (d: ts.VariableDeclaration): boolean =>
    ts.isVariableDeclarationList(d.parent) && (d.parent.flags & ts.NodeFlags.Const) !== 0;
  const isExported = (d: ts.Node): boolean => {
    const stmt = ts.isVariableDeclaration(d) ? d.parent.parent : d;
    return (
      ts.canHaveModifiers(stmt) &&
      (ts.getModifiers(stmt) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    );
  };

  // ---- the table and the schema namespace ----

  /** `import * as schema from '…/schema/index.js'`, `import { schema } from '…/db/client.js'`, `await import(…)`. */
  const isNamespace = (expr: ts.Expression, depth = 0): boolean => {
    const e = unwrap(expr);
    if (depth > 8) return false;
    if (ts.isAwaitExpression(e)) return isNamespace(e.expression, depth + 1);
    if (ts.isCallExpression(e) && e.expression.kind === ts.SyntaxKind.ImportKeyword)
      return CASE_MODULE.test(nameText(e.arguments[0]) ?? '');
    if (!ts.isIdentifier(e)) return false;
    const d = declOf(e);
    if (d === undefined) return false;
    if (ts.isNamespaceImport(d)) return CASE_MODULE.test(importModule(d));
    if (ts.isImportSpecifier(d))
      return (d.propertyName ?? d.name).text === 'schema' && CLIENT_MODULE.test(importModule(d));
    return (
      ts.isVariableDeclaration(d) && d.initializer !== undefined && isNamespace(d.initializer, depth + 1)
    );
  };

  const definesCaseTable = (e: ts.Expression): boolean =>
    ts.isCallExpression(e) && isDrizzle(e.expression, 'pgTable') && nameText(e.arguments[0]) === 'case';

  /** True when `expr` evaluates to the `case` table object (or an alias of it). */
  const tableRef = (expr: ts.Expression, depth = 0): boolean => {
    const e = unwrap(expr);
    if (depth > 8) return false;
    if (ts.isIdentifier(e)) {
      const d = declOf(e);
      if (d === undefined) return false;
      if (ts.isImportSpecifier(d))
        return (d.propertyName ?? d.name).text === 'cases' && CASE_MODULE.test(importModule(d));
      if (ts.isVariableDeclaration(d))
        return (
          d.initializer !== undefined &&
          (definesCaseTable(d.initializer) || tableRef(d.initializer, depth + 1))
        );
      if (ts.isBindingElement(d)) {
        const decl = d.parent.parent;
        return (
          nameText(d.propertyName ?? d.name) === 'cases' &&
          ts.isObjectBindingPattern(d.parent) &&
          ts.isVariableDeclaration(decl) &&
          decl.initializer !== undefined &&
          isNamespace(decl.initializer)
        );
      }
      return false;
    }
    if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e))
      return memberName(e) === 'cases' && isNamespace(e.expression);
    if (ts.isCallExpression(e))
      return (
        isDrizzle(e.expression, 'alias') &&
        e.arguments[0] !== undefined &&
        tableRef(e.arguments[0], depth + 1)
      );
    return false;
  };

  /** Another schema table (or an alias of one): safe to interpolate after FROM. */
  const otherTable = (expr: ts.Expression): boolean => {
    const e = unwrap(expr);
    if (ts.isIdentifier(e)) {
      const d = declOf(e);
      if (d !== undefined && ts.isImportSpecifier(d)) return SCHEMA_MODULE.test(importModule(d));
      if (d !== undefined && ts.isVariableDeclaration(d) && d.initializer !== undefined)
        return otherTable(d.initializer);
    }
    if (ts.isCallExpression(e) && isDrizzle(e.expression, 'alias') && e.arguments[0] !== undefined)
      return otherTable(e.arguments[0]);
    return (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) && isNamespace(e.expression);
  };

  // ---- the scope predicate ----

  /** The actor comes from the caller: a parameter, a field of one, or a `const` taken from one. */
  const fromCaller = (expr: ts.Expression, depth = 0): boolean => {
    let e = unwrap(expr);
    while (ts.isPropertyAccessExpression(e)) e = unwrap(e.expression);
    if (!ts.isIdentifier(e) || depth > 8) return false;
    let d: ts.Node | undefined = declOf(e);
    while (
      d !== undefined &&
      (ts.isBindingElement(d) || ts.isObjectBindingPattern(d) || ts.isArrayBindingPattern(d))
    )
      d = d.parent;
    if (d === undefined) return false;
    if (ts.isParameter(d)) return true;
    return (
      ts.isVariableDeclaration(d) &&
      isConst(d) &&
      d.initializer !== undefined &&
      fromCaller(d.initializer, depth + 1)
    );
  };

  /** The local, unexported function `fn` and every call to it; undefined when it escapes (exported, passed on). */
  const callersOf = (fn: ts.Node): ts.CallExpression[] | undefined => {
    let decl: ts.NamedDeclaration;
    if (ts.isFunctionDeclaration(fn) && fn.name !== undefined) decl = fn;
    else if (
      (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
      ts.isVariableDeclaration(fn.parent) &&
      ts.isIdentifier(fn.parent.name)
    )
      decl = fn.parent;
    else return undefined;
    if (isExported(decl)) return undefined;
    const calls: ts.CallExpression[] = [];
    for (const r of referencesOf(decl)) {
      if (!ts.isCallExpression(r.parent) || r.parent.expression !== r) return undefined;
      calls.push(r.parent);
    }
    return calls.length > 0 ? calls : undefined;
  };

  /** The right-hand sides assigned to a variable after its declaration; undefined for any other kind of write. */
  const assignmentsTo = (d: ts.VariableDeclaration): ts.Expression[] | undefined => {
    const out: ts.Expression[] = [];
    for (const r of referencesOf(d)) {
      const p = r.parent;
      if (ts.isBinaryExpression(p) && p.left === r) {
        const op = p.operatorToken.kind;
        if (op === ts.SyntaxKind.EqualsToken) out.push(p.right);
        else if (op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment) return undefined;
      }
    }
    return out;
  };

  /**
   * True when `expr` always narrows to the caller's scope: `caseScopeWhere(p)`, an `and(…)` with such an argument,
   * or a name only ever bound to one. `assumed` holds the `let`s under proof (their own reads count as scoped).
   */
  const conjScoped = (expr: ts.Expression | undefined, assumed = new Set<ts.Node>(), depth = 0): boolean => {
    if (expr === undefined || depth > 8) return false;
    const e = unwrap(expr);
    if (ts.isCallExpression(e)) {
      const o = origin(e.expression);
      if (o?.name === 'caseScopeWhere' && SCOPE_MODULE.test(o.module))
        return e.arguments.length === 1 && fromCaller(e.arguments[0]!);
      if (isDrizzle(e.expression, 'and'))
        return e.arguments.some((a) =>
          ts.isSpreadElement(a)
            ? spreadScoped(a.expression, assumed, depth + 1)
            : conjScoped(a, assumed, depth + 1),
        );
      return false;
    }
    if (!ts.isIdentifier(e)) return false;
    const d = declOf(e);
    if (d === undefined) return false;
    if (assumed.has(d)) return true;
    if (ts.isVariableDeclaration(d) && ts.isIdentifier(d.name) && d.initializer !== undefined) {
      if (isConst(d)) return conjScoped(d.initializer, assumed, depth + 1);
      const inductive = new Set(assumed).add(d);
      const later = assignmentsTo(d);
      return (
        later !== undefined && [d.initializer, ...later].every((rhs) => conjScoped(rhs, inductive, depth + 1))
      );
    }
    if (ts.isParameter(d) && d.dotDotDotToken === undefined) {
      const index = d.parent.parameters.indexOf(d);
      const callers = callersOf(d.parent);
      return (
        callers !== undefined &&
        callers.every(
          (c) =>
            !c.arguments.slice(0, index + 1).some(ts.isSpreadElement) &&
            conjScoped(c.arguments[index], assumed, depth + 1),
        )
      );
    }
    return false;
  };

  /** `and(...[scope, x])`, or `and(...conditions)` over a `const` array seeded with the scope and only pushed to. */
  const spreadScoped = (expr: ts.Expression, assumed: Set<ts.Node>, depth: number): boolean => {
    const e = unwrap(expr);
    const seeded = (a: ts.Expression): boolean =>
      ts.isArrayLiteralExpression(a) &&
      a.elements.some((el) => !ts.isSpreadElement(el) && conjScoped(el, assumed, depth + 1));
    if (seeded(e)) return true;
    if (!ts.isIdentifier(e)) return false;
    const d = declOf(e);
    if (d === undefined || !ts.isVariableDeclaration(d) || !isConst(d) || d.initializer === undefined)
      return false;
    if (!seeded(unwrap(d.initializer))) return false;
    return referencesOf(d).every((r) => {
      const p = r.parent;
      if (ts.isPropertyAccessExpression(p) && p.name.text === 'push')
        return ts.isCallExpression(p.parent) && p.parent.expression === p;
      return ts.isSpreadElement(p) && ts.isCallExpression(p.parent) && isDrizzle(p.parent.expression, 'and');
    });
  };

  // ---- query chains ----

  /** The calls chained on `start` (`start.a().b()` → [a, b]) and the expression the chain ends in. */
  const chainAbove = (start: ts.Expression): { calls: ts.CallExpression[]; top: ts.Expression } => {
    const calls: ts.CallExpression[] = [];
    let n: ts.Expression = start;
    for (;;) {
      const p = n.parent;
      if (ts.isNonNullExpression(p) || ts.isParenthesizedExpression(p)) n = p;
      else if (ts.isPropertyAccessExpression(p) && p.expression === n) {
        if (ts.isCallExpression(p.parent) && p.parent.expression === p) {
          calls.push(p.parent);
          n = p.parent;
        } else n = p;
      } else return { calls, top: n };
    }
  };
  const isWhere = (c: ts.CallExpression): boolean =>
    ts.isPropertyAccessExpression(c.expression) && c.expression.name.text === 'where';
  const wheresScoped = (calls: ts.CallExpression[]): boolean =>
    calls.filter(isWhere).every((w) => conjScoped(w.arguments[0]));

  /** The identifier a chain such as `q.where(…).limit(…)` starts from, and whether it applies a where. */
  const chainRoot = (expr: ts.Expression): { root: ts.Expression; where: boolean } => {
    let n = unwrap(expr);
    let where = false;
    for (;;) {
      if (ts.isCallExpression(n)) {
        where ||= isWhere(n);
        n = unwrap(n.expression);
      } else if (ts.isPropertyAccessExpression(n)) n = unwrap(n.expression);
      else return { root: n, where };
    }
  };

  /** A query builder held in `holder`: every later where on it is scoped, and (if none came before) the first
   *  statement after the declaration that uses it applies one, unconditionally, in the same block. */
  const holderScoped = (holder: ts.VariableDeclaration, scopedAlready: boolean): boolean => {
    const refs = referencesOf(holder);
    for (const r of refs) {
      const p = r.parent;
      if (ts.isBinaryExpression(p) && p.left === r) {
        const { root } = chainRoot(p.right);
        if (
          p.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
          !ts.isIdentifier(root) ||
          declOf(root) !== holder
        )
          return false; // replaced by something that is not built on the scoped query
      } else if (!wheresScoped(chainAbove(r).calls)) return false;
    }
    if (scopedAlready) return true;
    const stmt = holder.parent.parent;
    const block = stmt.parent;
    if (!ts.isVariableStatement(stmt) || !('statements' in block)) return false;
    const statements = (block as ts.Block).statements;
    const next = statements
      .slice(statements.indexOf(stmt) + 1)
      .find((s) => refs.some((r) => r.pos >= s.pos && r.end <= s.end));
    if (next === undefined || !ts.isExpressionStatement(next)) return false;
    let e = unwrap(next.expression);
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.EqualsToken) e = e.right;
    const { root, where } = chainRoot(e);
    return where && ts.isIdentifier(root) && declOf(root) === holder;
  };

  /** Every where on the query built from `start` is conjunctive in the scope, and at least one applies. */
  const whereScoped = (start: ts.Expression, depth = 0): boolean => {
    if (depth > 3) return false;
    const { calls, top } = chainAbove(start);
    if (!wheresScoped(calls)) return false;
    const hasWhere = calls.some(isWhere);
    const p = top.parent;
    if (ts.isVariableDeclaration(p) && p.initializer === top && ts.isIdentifier(p.name))
      return holderScoped(p, hasWhere);
    if (hasWhere) return true;
    // a base builder returned by a local helper: every caller must apply the where
    let fn: ts.Node | undefined;
    if (ts.isArrowFunction(p) && p.body === top) fn = p;
    else if (ts.isReturnStatement(p))
      for (fn = p.parent; fn !== undefined && !ts.isFunctionLike(fn); fn = fn.parent);
    const callers = fn === undefined ? undefined : callersOf(fn);
    return callers !== undefined && callers.every((c) => whereScoped(c, depth + 1));
  };

  const relationalScoped = (site: ts.Expression): boolean => {
    const first = chainAbove(site).calls[0];
    if (first === undefined || !['findMany', 'findFirst'].includes(memberName(first.expression) ?? ''))
      return false;
    const arg = first.arguments[0];
    const where =
      arg !== undefined && ts.isObjectLiteralExpression(arg)
        ? arg.properties.find((p) => ts.isPropertyAssignment(p) && nameText(p.name) === 'where')
        : undefined;
    return where !== undefined && ts.isPropertyAssignment(where) && conjScoped(where.initializer);
  };

  // ---- raw SQL text ----

  /** Is the text before an interpolation a table position (after FROM / JOIN / ONLY, or a comma in a FROM list)? */
  const tablePosition = (before: string): boolean => {
    const bare = before.replace(/(?:(?:\w+|"\w+")\.)?"?$/, '');
    if (/\bis\s+(?:not\s+)?distinct\s+from\s*$/i.test(bare) || /\(\s*\w+\s+from\s*$/i.test(bare))
      return false;
    if (/\b(?:from|join|only)\s*$/i.test(bare)) return true;
    const from = bare.search(/\bfrom\b(?![\s\S]*\bfrom\b)/i);
    if (!/,\s*$/.test(bare) || from < 0) return false;
    const list = bare.slice(from);
    const depth = [...list].reduce((d, ch) => d + (ch === '(' ? 1 : ch === ')' ? -1 : 0), 0);
    return (
      depth === 0 &&
      !/\b(?:where|join|on|group|order|having|limit|union|select|set|values|returning)\b/i.test(list)
    );
  };

  /** An interpolation after FROM that could name the case table: not another table, a column or a known string. */
  const couldBeCaseTable = (expr: ts.Expression): boolean => {
    const e = unwrap(expr);
    if (ts.isStringLiteralLike(e)) return e.text === 'case';
    if (ts.isPropertyAccessExpression(e) || otherTable(e)) return false;
    if (ts.isCallExpression(e) && ts.isStringLiteralLike(e.arguments[0] ?? e))
      return (e.arguments[0] as ts.StringLiteral).text === 'case';
    if (ts.isIdentifier(e)) {
      const d = declOf(e);
      if (d !== undefined && ts.isVariableDeclaration(d) && isConst(d) && d.initializer !== undefined) {
        const init = unwrap(d.initializer);
        if (ts.isStringLiteralLike(init)) return init.text === 'case';
        if (ts.isCallExpression(init) && memberName(init.expression) === 'as') return false; // a subquery
      }
    }
    return true;
  };

  /** The reads of the table in one literal, and whether a drizzle `sql` template scopes its single read. */
  const literalReads = (lit: ts.StringLiteral | ts.TemplateLiteral): { reads: number; scoped: boolean } => {
    const spans = ts.isTemplateExpression(lit) ? lit.templateSpans : [];
    const chunks = ts.isTemplateExpression(lit)
      ? [lit.head.text, ...spans.map((s) => s.literal.text)]
      : [lit.text];
    const text = chunks.map((c, i) => (i === 0 ? c : `__p${i - 1}__${c}`)).join('');
    let reads = 0;
    for (const m of text.matchAll(CASE_TABLE_TEXT)) if (!WRITE_TARGET.test(text.slice(0, m.index))) reads++;
    spans.forEach((s, i) => {
      const before = text.slice(0, text.indexOf(`__p${i}__`));
      if (WRITE_TARGET.test(before.replace(/(?:(?:\w+|"\w+")\.)?"?$/, ''))) return;
      if (tableRef(s.expression) || (tablePosition(before) && couldBeCaseTable(s.expression))) reads++;
    });
    const tag = ts.isTaggedTemplateExpression(lit.parent) ? lit.parent.tag : undefined;
    const scoped =
      reads === 1 &&
      tag !== undefined &&
      isDrizzle(tag, 'sql') &&
      !/\bor\b/i.test(text) &&
      spans.some(
        (s, i) =>
          /\b(?:where|and)\s*$/i.test(chunks[i]!) &&
          /^\s*(?:$|and\b|order\b|group\b|limit\b|offset\b|for\b|returning\b)/i.test(chunks[i + 1]!) &&
          conjScoped(s.expression),
      );
    return { reads, scoped };
  };

  // ---- uses of the table object the guard cannot follow ----

  const inTypePosition = (n: ts.Node): boolean => {
    for (let a: ts.Node | undefined = n.parent; a !== undefined && !ts.isStatement(a); a = a.parent)
      if (ts.isTypeNode(a)) return true;
    return false;
  };

  /** An identifier that reads a binding (not a declaration name, a property name or a type). */
  const isValueReference = (id: ts.Identifier): boolean => {
    const p = id.parent;
    if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
    if (ts.isQualifiedName(p) && p.right === id) return false;
    if (ts.isBindingElement(p) && p.propertyName === id) return false;
    if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p))
      return (
        ts.isExportSpecifier(p) &&
        p.parent.parent.moduleSpecifier === undefined &&
        (p.propertyName ?? p.name) === id
      );
    if ('name' in p && (p as ts.NamedDeclaration).name === id && !ts.isShorthandPropertyAssignment(p))
      return false;
    return !inTypePosition(id);
  };

  /** A position where the table object is safe to appear: a site, a write, a column, a projection, a local alias. */
  const safeTableUse = (node: ts.Expression): boolean => {
    let n: ts.Node = node;
    while (
      ts.isParenthesizedExpression(n.parent) ||
      ts.isAsExpression(n.parent) ||
      ts.isNonNullExpression(n.parent)
    )
      n = n.parent;
    const p = n.parent;
    if (ts.isCallExpression(p) && p.arguments[0] === n) {
      const method = ts.isPropertyAccessExpression(p.expression) ? p.expression.name.text : '';
      if (BUILDER_METHODS.has(method) || method === '$count' || WRITES.has(method)) return true;
      if (isDrizzle(p.expression, 'alias') || isDrizzle(p.expression, 'getTableColumns')) return true;
    }
    if ((ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === n)
      return true;
    if (ts.isTemplateSpan(p)) return true; // counted as a read by the literal scan
    if (ts.isVariableDeclaration(p) && p.initializer === n) return !isExported(p);
    if ((ts.isPropertyAssignment(p) && p.initializer === n) || ts.isShorthandPropertyAssignment(p)) {
      const call = p.parent.parent;
      return (
        ts.isCallExpression(call) &&
        call.arguments[0] === p.parent &&
        PROJECTIONS.has(memberName(call.expression) ?? '')
      );
    }
    return false;
  };

  // ---- the walk ----

  const found: { pos: number; site: Site }[] = [];
  const add = (node: ts.Node, kind: Site['kind'], scoped: boolean, at: ts.Node = node): void => {
    const pos = at.getStart(sf);
    found.push({
      pos,
      site: {
        file,
        line: sf.getLineAndCharacterOfPosition(pos).line + 1,
        fn: enclosingFunctionName(node),
        kind,
        scoped,
      },
    });
  };
  const home = TABLE_HOME.test(file);

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const [table, second] = node.arguments;
      if (BUILDER_METHODS.has(method) && table !== undefined && tableRef(table))
        add(
          node,
          'builder',
          (method === 'innerJoin' && conjScoped(second)) || whereScoped(node),
          node.expression.name,
        );
      if (method === '$count' && table !== undefined && tableRef(table))
        add(node, 'count', conjScoped(second), node.expression.name);
    }
    if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      memberName(node) === 'cases'
    ) {
      const owner = unwrap(node.expression);
      if ((ts.isIdentifier(owner) ? owner.text : memberName(owner)) === 'query')
        add(node, 'relational', relationalScoped(node));
    }
    if (
      ts.isPropertyAssignment(node) &&
      ['case', 'cases'].includes(nameText(node.name) ?? '') &&
      ts.isPropertyAssignment(node.parent.parent) &&
      nameText(node.parent.parent.name) === 'with'
    )
      add(node, 'relational', false);
    if (
      ts.isTemplateExpression(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      (ts.isStringLiteral(node) &&
        !ts.isImportDeclaration(node.parent) &&
        !ts.isExportDeclaration(node.parent))
    ) {
      const { reads, scoped } = literalReads(node);
      for (let i = 0; i < reads; i++) add(node, 'sql', scoped);
    }
    if (!home) {
      const isRef = ts.isIdentifier(node)
        ? isValueReference(node)
        : ts.isPropertyAccessExpression(node) ||
          ts.isElementAccessExpression(node) ||
          ts.isCallExpression(node);
      if (isRef && tableRef(node as ts.Expression) && !safeTableUse(node as ts.Expression))
        add(node, 'escape', false);
      if (
        ts.isIdentifier(node) &&
        isValueReference(node) &&
        isNamespace(node) &&
        !(ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent)) &&
        !(ts.isVariableDeclaration(node.parent) && !isExported(node.parent))
      )
        add(node, 'escape', false); // the schema namespace handed on
      if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier !== undefined) {
        const spec = nameText(node.moduleSpecifier) ?? '';
        const names =
          node.exportClause !== undefined && ts.isNamedExports(node.exportClause)
            ? node.exportClause.elements.map((e) => (e.propertyName ?? e.name).text)
            : undefined; // `export *` or `export * as ns`
        if (
          (CASE_MODULE.test(spec) && (names === undefined || names.includes('cases'))) ||
          (CLIENT_MODULE.test(spec) && (names === undefined || names.includes('schema')))
        )
          add(node, 'escape', false); // a re-export the guard would not trace
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found.sort((a, b) => a.pos - b.pos).map((f) => f.site);
}

/** The failures for a set of sites against the allow-list: unlisted, over the count, or stale. */
function compareWithAllowList(sites: Site[], allow: AllowEntry[]): string[] {
  const failures: string[] = [];
  const unscoped = new Map<string, Site[]>();
  for (const s of sites.filter((x) => !x.scoped)) {
    const key = `${s.file}#${s.fn}`;
    unscoped.set(key, [...(unscoped.get(key) ?? []), s]);
  }
  const where = (list: Site[]) => list.map((s) => `${s.file}:${s.line} in ${s.fn}() [${s.kind}]`).join(', ');
  for (const [key, list] of unscoped) {
    const entry = allow.find((e) => `${e.file}#${e.fn}` === key);
    if (entry === undefined)
      failures.push(
        `unscoped case read with no allow-list entry: ${where(list)}; apply caseScopeWhere(actor) in its WHERE, or add a reasoned entry (W0-05 "Query scope")`,
      );
    else if (list.length > entry.count)
      failures.push(
        `${list.length} unscoped case reads where the allow-list expects ${entry.count}: ${where(list)}; the new one needs caseScopeWhere(actor) or a raised count with a reason`,
      );
  }
  for (const entry of allow) {
    const found = unscoped.get(`${entry.file}#${entry.fn}`)?.length ?? 0;
    if (found < entry.count)
      failures.push(
        `stale allow-list entry ${entry.file} ${entry.fn}(): expects ${entry.count} unscoped case read(s), found ${found}; lower or remove it`,
      );
  }
  return failures;
}

/** The server sources the real run reads: every TypeScript module except tests and declarations. */
function isServerSource(f: string): boolean {
  return /\.[cm]?tsx?$/.test(f) && !/\.test\.[cm]?tsx?$/.test(f) && !/\.d\.[cm]?ts$/.test(f);
}

// Every deliberate unscoped read, read against the code on 2026-09-26 (W3-F8). A by-id read runs after the route
// middleware's `authorize` on that case id, or inside a transaction that already locked it; none lists, searches
// or counts cases for an actor.
const ALLOW_LIST: AllowEntry[] = [
  {
    file: 'rai-web/server/src/authz/facts.ts',
    fn: 'byCaseId',
    count: 1,
    reason:
      'pre-authorization CaseScopeFacts by case id: id, owner and BU key only, the input to authorize (W0-05 Middleware)',
  },
  {
    file: 'rai-web/server/src/authz/facts.ts',
    fn: 'byArtifactId',
    count: 1,
    reason:
      'pre-authorization CaseScopeFacts through artifact.case_id, same three columns (W0-05 Middleware)',
  },
  {
    file: 'rai-web/server/src/cases/repository.ts',
    fn: 'readCaseRow',
    count: 1,
    reason:
      'single case by id; callers run after case-keyed authorize or under lockCase in the action transaction',
  },
  {
    file: 'rai-web/server/src/cases/repository.ts',
    fn: 'caseViewFrom',
    count: 1,
    reason: 'status join for the one case row the caller already holds (eq cases.id = row.id)',
  },
  {
    file: 'rai-web/server/src/artifacts/pipeline.ts',
    fn: 'openDraftOf',
    count: 1,
    reason: 'draft version id of one case by id, inside the authorized artifact.upload flow (W0-08 check 3)',
  },
  {
    file: 'rai-web/server/src/db/transaction.ts',
    fn: 'lockCase',
    count: 1,
    reason:
      'SELECT … FOR UPDATE on one case id: the per-case serialisation point (W0-06 9.1), returns no data',
  },
  {
    file: 'rai-web/server/src/notifications/service.ts',
    fn: 'loadCommittedCaseRequest',
    count: 1,
    reason:
      'dispatcher composes mail for the committed outbox row case id; recipients re-checked against case.view',
  },
  {
    file: 'rai-web/server/src/sla/breach.ts',
    fn: 'openReviewTargets',
    count: 1,
    reason:
      'system SLA-breach query (W3-05) feeding the operator digest to configured operator recipients; no actor',
  },
  {
    file: 'rai-web/server/src/operator/db-cleanup.ts',
    fn: 'main',
    count: 1,
    reason: 'npm run db:cleanup --report stale-draft count as rai_operator; a CLI, never the request path',
  },
];

// ---- self-tests: the analyzer catches what it claims to catch ----

const DRIZZLE_IMPORT =
  "import { and, eq, exists, getTableColumns, not, or, sql } from 'drizzle-orm';\nimport { alias, pgTable } from 'drizzle-orm/pg-core';\n";
const SCHEMA_IMPORT = "import { cases } from '../db/schema/case.js';\n";
const SCOPE_IMPORT = "import { caseScopeWhere } from '../cases/scope.js';\n";
const HEAD = `${DRIZZLE_IMPORT}${SCHEMA_IMPORT}${SCOPE_IMPORT}import { artifact } from '../db/schema/artifact.js';\n`;
const one = (src: string, file = 'x/probe.ts'): Site[] => analyzeSource(file, src);
/** [function, kind, scoped] per site, for sources written one function per line after HEAD. */
const shape = (src: string, file?: string) => one(`${HEAD}${src}`, file).map((s) => [s.fn, s.kind, s.scoped]);

test('flags an unscoped .from(cases) and names its function and line', () => {
  const sites = one(
    `${SCHEMA_IMPORT}export async function leak(db) {\n  return db.select().from(cases);\n}\n`,
  );
  assert.deepEqual(sites, [{ file: 'x/probe.ts', line: 3, fn: 'leak', kind: 'builder', scoped: false }]);
});

test('flags a join of cases, an aliased import, a namespace member and an alias(cases) table', () => {
  const join = one(`${SCHEMA_IMPORT}const f = (db) => db.select().from(artifact).innerJoin(cases, on);`);
  assert.deepEqual(
    join.map((s) => [s.fn, s.kind, s.scoped]),
    [['f', 'builder', false]],
  );
  const renamed = one(
    "import { cases as c } from '../db/schema/index.js';\nfunction g(db) { return db.select().from(c); }",
  );
  assert.equal(renamed.length, 1);
  const ns = one(
    "import * as schema from './schema/index.js';\nfunction h(db) { db.select().from(schema.cases); }",
  );
  assert.equal(ns.length, 1);
  const client = one(
    "import { schema } from '../db/client.js';\nfunction h(db) { db.select().from(schema.cases); }",
  );
  assert.equal(client.length, 1);
  const aliased = one(
    `${DRIZZLE_IMPORT}${SCHEMA_IMPORT}function k(db) { const other = alias(cases, 'other'); return db.select().from(other).leftJoin(other, on); }`,
  );
  assert.deepEqual(
    aliased.map((s) => [s.fn, s.scoped]),
    [
      ['k', false],
      ['k', false],
    ],
  );
});

test('flags raw sql reading "case", quoted or schema-qualified, and an interpolated table; not writes', () => {
  const sites = one(
    `${DRIZZLE_IMPORT}${SCHEMA_IMPORT}async function r(tx) {\n` +
      '  await tx.execute(sql`SELECT id FROM "case" WHERE id = ${id}`);\n' +
      '  await tx.execute(sql`select 1 from public.case c join "case" d on true`);\n' +
      '  await tx.execute(sql`SELECT * FROM ${cases} WHERE true`);\n' +
      '  await tx.execute(sql`SELECT * FROM case_note JOIN cases ON true`);\n' + // other tables are not sites
      '  await tx.execute(sql`UPDATE "case" SET x = 1 WHERE id = ${id}`);\n' + // writes are not sites
      '  await tx.execute(sql`DELETE FROM "case" WHERE id = ${id}`);\n' +
      '}\n',
  );
  assert.deepEqual(
    sites.map((s) => [s.line, s.kind, s.scoped]),
    [
      [5, 'sql', false],
      [6, 'sql', false],
      [6, 'sql', false],
      [7, 'sql', false],
    ],
  );
});

test('flags the relational query API on cases, however it is reached', () => {
  assert.deepEqual(
    shape(
      'function q(db) { return db.query.cases.findMany({ limit: 5 }); }\n' +
        "function e(db) { return db.query['cases'].findMany({ limit: 5 }); }\n" +
        'function d(db) { const { query } = db; return query.cases.findMany({ limit: 5 }); }\n' +
        'function w(db) { return db.query.artifact.findMany({ with: { case: true } }); }\n' +
        'function x(db, actor) { return db.query.cases.findMany({ limit: 5, extras: { v: sql`${caseScopeWhere(actor)}` } }); }\n' +
        'function s(db, actor) { return db.query.cases.findMany({ where: caseScopeWhere(actor) }); }\n',
    ),
    [
      ['q', 'relational', false],
      ['e', 'relational', false],
      ['d', 'relational', false],
      ['w', 'relational', false],
      ['x', 'relational', false],
      ['s', 'relational', true],
    ],
  );
});

test('accepts caseScopeWhere inline, inside and(), through a const, through a subquery and in a callback', () => {
  assert.deepEqual(
    shape(
      'function a(db, actor) { return db.select().from(cases).where(caseScopeWhere(actor)); }\n' +
        'function b(db, actor) { return db.select().from(cases).leftJoin(v, on).where(and(caseScopeWhere(actor), x)).limit(5); }\n' +
        'function c(db, actor) { const where = caseScopeWhere(actor); return db.select({ n: count() }).from(cases).where(where); }\n' +
        "function d(db, actor) { return db.transaction(async (tx) => tx.select().from(cases).where(caseScopeWhere(actor)).as('v')); }\n",
    ),
    [
      ['a', 'builder', true],
      ['b', 'builder', true],
      ['c', 'builder', true],
      ['d', 'builder', true],
    ],
  );
});

test('accepts the common scoped shapes: and() consts, condition arrays, join ON, dynamic and helper builders', () => {
  assert.deepEqual(
    shape(
      'function f01(db, actor, n) { const where = and(caseScopeWhere(actor), eq(cases.useCaseName, n)); return db.select().from(cases).where(where); }\n' +
        'function f02(db, actor, n) { const conditions: SQL[] = [caseScopeWhere(actor)]; if (n) conditions.push(eq(cases.useCaseName, n)); return db.select().from(cases).where(and(...conditions)); }\n' +
        'function f03(db, actor) { return db.select().from(artifact).innerJoin(cases, and(eq(cases.id, artifact.caseId), caseScopeWhere(actor))); }\n' +
        'function f04(db, actor) { const q = db.select().from(cases).$dynamic(); q.where(caseScopeWhere(actor)); return q; }\n' +
        'function f27(db, actor) { let q = db.select().from(cases).$dynamic(); q = q.where(caseScopeWhere(actor)); return q; }\n' +
        'function f07(db, actor, n) { let where = caseScopeWhere(actor); if (n) where = and(where, eq(cases.useCaseName, n))!; return db.select().from(cases).where(where); }\n' +
        'function base(db) { return db.select().from(cases).$dynamic(); }\n' +
        'function f06(db, actor) { return base(db).where(caseScopeWhere(actor)).limit(5); }\n' +
        'function listWith(db, scope: SQL) { return db.select().from(cases).where(scope); }\n' +
        'function f10(db, actor) { return listWith(db, caseScopeWhere(actor)); }\n' +
        'function f11(db, req) { const actor = req.actor; return db.$count(cases, caseScopeWhere(actor)); }\n' +
        'function f12(db, { actor }) { return db.execute(sql`SELECT id FROM "case" WHERE ${caseScopeWhere(actor)} ORDER BY id`); }\n',
    ),
    [
      ['f01', 'builder', true],
      ['f02', 'builder', true],
      ['f03', 'builder', true],
      ['f04', 'builder', true],
      ['f27', 'builder', true],
      ['f07', 'builder', true],
      ['base', 'builder', true],
      ['listWith', 'builder', true],
      ['f11', 'count', true],
      ['f12', 'sql', true],
    ],
  );
  const nsScope = one(
    `${DRIZZLE_IMPORT}${SCHEMA_IMPORT}import * as scope from './scope.js';\n` +
      'function f05(db, actor) { return db.select().from(cases).where(scope.caseScopeWhere(actor)); }\n',
  );
  assert.deepEqual(
    nsScope.map((s) => s.scoped),
    [true],
  );
  const classField = one(`${HEAD}class Repo { list = async (db) => db.select().from(cases); }\n`);
  assert.deepEqual(
    classField.map((s) => s.fn),
    ['list'],
  );
});

test('does not accept those shapes when they can leak', () => {
  assert.deepEqual(
    shape(
      'function mk(actor) { const where = caseScopeWhere(actor); return where; }\n' +
        'function e(db, where) { return db.select().from(cases).where(where); }\n' + // no caller
        'function f(db, actor) { let w = caseScopeWhere(actor); w = sql`TRUE`; return db.select().from(cases).where(w); }\n' +
        'function g(db, id) { return db.select().from(cases).where(eq(cases.id, id)); }\n' +
        'function h(db, actor) { return db.select().from(cases).orderBy(caseScopeWhere(actor)); }\n' +
        'function a1(db, actor) { const c = [caseScopeWhere(actor)]; c.length = 0; return db.select().from(cases).where(and(...c)); }\n' +
        'function a2(db, actor) { const c = [caseScopeWhere(actor)]; return db.select().from(cases).where(or(...c)); }\n' +
        'function j1(db, actor) { return db.select().from(artifact).leftJoin(cases, and(eq(cases.id, artifact.caseId), caseScopeWhere(actor))); }\n' +
        'function d1(db, actor, all) { const q = db.select().from(cases).$dynamic(); if (!all) q.where(caseScopeWhere(actor)); return q; }\n' +
        'function d2(db, actor) { const q = db.select().from(cases).$dynamic(); const rows = q.execute(); q.where(caseScopeWhere(actor)); return rows; }\n' +
        'export function b2(db) { return db.select().from(cases).$dynamic(); }\n' +
        'function b3(db) { return db.select().from(cases).$dynamic(); }\n' +
        'function u3(db, actor) { return b3(db).where(caseScopeWhere(actor)); }\n' +
        'function u4(db) { return b3(db); }\n' +
        'function p1(db, scope) { return db.select().from(cases).where(scope); }\n' +
        'function u5(db, id) { return p1(db, eq(cases.id, id)); }\n' +
        'function u6(db, actor) { return p1(db, caseScopeWhere(actor)); }\n',
    ),
    [
      ['e', 'builder', false],
      ['f', 'builder', false],
      ['g', 'builder', false],
      ['h', 'builder', false],
      ['a1', 'builder', false],
      ['a2', 'builder', false],
      ['j1', 'builder', false],
      ['d1', 'builder', false],
      ['d2', 'builder', false],
      ['b2', 'builder', false],
      ['b3', 'builder', false],
      ['p1', 'builder', false],
    ],
  );
});

test('closes weakened predicates: other actor, or, not, ternary, ??, sql, subquery, shadowing, re-where', () => {
  assert.deepEqual(
    shape(
      "const SYSTEM = { grants: [{ scope: { kind: 'all_cases' } }] };\n" +
        'function w1(db) { return db.select().from(cases).where(caseScopeWhere(SYSTEM)); }\n' +
        'function w2(db, actor, id) { return db.select().from(cases).where(or(caseScopeWhere(actor), eq(cases.id, id))); }\n' +
        'function w3(db, actor) { return db.select().from(cases).where(not(caseScopeWhere(actor))); }\n' +
        'function w4(db, actor, id) { return db.select().from(cases).where(id === undefined ? caseScopeWhere(actor) : eq(cases.id, id)); }\n' +
        'function w5(db, actor, admin) { const scope = caseScopeWhere(actor); const where = admin ? sql`TRUE` : scope; return db.select().from(cases).where(where ?? scope); }\n' +
        'function w6(db, actor) { const where = caseScopeWhere(actor); return db.select().from(cases).where(sql`${where} OR TRUE`); }\n' +
        'function w7(db, actor) { return db.select().from(cases).where(exists(db.select().from(artifact).where(caseScopeWhere(actor)))); }\n' +
        "function w8(db, actor, k, id) { const where = caseScopeWhere(actor); switch (k) { case 'one': { const where = eq(cases.id, id); return db.select().from(cases).where(where); } } }\n" +
        'function w9(db, actor, opts) { const where = caseScopeWhere(actor); db.select().from(cases).where(where); return db.select().from(cases).where(eq(cases.id, opts.where)); }\n' +
        'function w10(db, actor, n) { const q = db.select().from(cases).$dynamic().where(caseScopeWhere(actor)); q.where(eq(cases.useCaseName, n)); return q; }\n' +
        'function w11(db, actor, ids) { const scope = caseScopeWhere(actor); return ids.map((scope) => db.select().from(cases).where(eq(cases.id, scope))); }\n' +
        'function w12(db, actor) { return db.select().from(cases).where(caseScopeWhere(actor) ? undefined : undefined); }\n' +
        'function w13(db, actor) { return db.execute(sql`SELECT id FROM "case" WHERE TRUE AND ${caseScopeWhere(actor)} IS NOT NULL`); }\n' +
        'function w14(db, actor, id) { return db.execute(sql`SELECT id FROM "case" WHERE ${caseScopeWhere(actor)} UNION SELECT id FROM "case" WHERE id = ${id}`); }\n',
    ),
    [
      ['w1', 'builder', false],
      ['w2', 'builder', false],
      ['w3', 'builder', false],
      ['w4', 'builder', false],
      ['w5', 'builder', false],
      ['w6', 'builder', false],
      ['w7', 'builder', false],
      ['w8', 'builder', false],
      ['w9', 'builder', true],
      ['w9', 'builder', false],
      ['w10', 'builder', false],
      ['w11', 'builder', false],
      ['w12', 'builder', false],
      ['w13', 'sql', false],
      ['w14', 'sql', false],
      ['w14', 'sql', false],
    ],
  );
});

test('closes table evasions: $count, consts, destructuring, helpers, re-exports, renamed imports', () => {
  assert.deepEqual(
    shape(
      'function t1(db, actor) { return db.$count(cases, eq(cases.ownerSubjectId, actor.subjectId)); }\n' +
        'const table = cases;\n' +
        'function t2(db) { return db.select().from(table); }\n' +
        'function firstPage(db, t, n) { return db.select().from(t).limit(n); }\n' +
        'function t3(db) { return firstPage(db, cases, 20); }\n' +
        'function t4(db) { return getTableName(cases); }\n' +
        'function t5(db, flag) { return db.select().from(flag ? cases : artifact); }\n' +
        "const dup = pgTable('case', {});\n" +
        'function t6(db) { return db.select().from(dup); }\n' +
        'export { cases as caseTable };\n',
    ),
    [
      ['t1', 'count', false],
      ['t2', 'builder', false],
      ['t3', 'escape', false],
      ['t4', 'escape', false],
      ['t5', 'escape', false],
      ['t6', 'builder', false],
      ['<module>', 'escape', false],
    ],
  );
  const reexport = one(
    "export { cases as caseTable } from './schema/case.js';\nexport * from '../db/client.js';\n",
    'x/db/tables.ts',
  );
  assert.deepEqual(
    reexport.map((s) => s.kind),
    ['escape', 'escape'],
  );
  const others = one(
    "import { schema } from '../db/client.js';\nimport * as ns from '../db/schema/index.js';\n" +
      "import { cases as c2 } from '../db/schema/case.ts';\nimport { alias as aliasTable } from 'drizzle-orm/pg-core';\n" +
      'const { cases: caseTable } = schema;\n' +
      'const { cases: nsTable } = ns;\n' +
      'function d1(db) { return db.select().from(caseTable); }\n' +
      'function d2(db) { return db.select().from(nsTable); }\n' +
      "async function d3(db) { const { cases: c } = await import('../db/schema/case.js'); return db.select().from(c); }\n" +
      'function d4(db) { return db.select().from(c2); }\n' +
      "function d5(db) { const other = aliasTable(c2, 'other'); return db.select().from(other); }\n" +
      'function d6(db) { return helper(ns); }\n',
  );
  assert.deepEqual(
    others.map((s) => [s.fn, s.kind]),
    [
      ['d1', 'builder'],
      ['d2', 'builder'],
      ['d3', 'builder'],
      ['d4', 'builder'],
      ['d5', 'builder'],
      ['d6', 'escape'],
    ],
  );
});

test('closes raw SQL evasions: sql.raw, plain strings, fragments, comma joins, dynamic table names', () => {
  assert.deepEqual(
    shape(
      'function s1(db) { return db.execute(sql.raw(\'SELECT id FROM "case"\')); }\n' +
        'function s2(db) { return db.execute(`SELECT id, use_case_name FROM "case"`); }\n' +
        "function s3(db) { return db.execute(sql.raw('SELECT id FROM ' + '\"case\"')); }\n" +
        'function s4(db) { return db.execute(sql`SELECT c.id FROM artifact a, "case" c WHERE a.case_id = c.id`); }\n' +
        'function s5(db) { return db.execute(sql`SELECT * FROM ${artifact}, ${cases} WHERE true`); }\n' +
        'const CASE_TABLE = sql`"case"`;\n' +
        'function s6(db) { return db.execute(sql`SELECT count(*) FROM ${CASE_TABLE}`); }\n' +
        "function s7(db) { return db.execute(sql`SELECT id FROM ${sql.identifier('case')}`); }\n" +
        'function selectFrom(table: string) { return sql.raw(`SELECT * FROM "${table}"`); }\n' +
        'function s8(db) { return db.execute(sql`SELECT id FROM ONLY "case"`); }\n' +
        'function s9(db) { const q = sql`SELECT id FROM `; q.append(sql`"case"`); return db.execute(q); }\n',
    ),
    [
      ['s1', 'sql', false],
      ['s2', 'sql', false],
      ['s3', 'sql', false],
      ['s4', 'sql', false],
      ['s5', 'sql', false],
      ['<module>', 'sql', false],
      ['s6', 'sql', false],
      ['s7', 'sql', false],
      ['selectFrom', 'sql', false],
      ['s8', 'sql', false],
      ['s9', 'sql', false],
    ],
  );
  const renamedTag = one(
    'import { sql as q } from \'drizzle-orm\';\nfunction r(db) { return db.execute(q`SELECT id FROM "case"`); }',
  );
  assert.equal(renamedTag.length, 1);
});

test('ignores the CASE keyword, other tables, a local cases, writes, projections and known table names', () => {
  const sites = one(
    `${HEAD}` +
      'function w(db) { db.insert(cases).values(v); db.update(cases).set(v); db.delete(cases); }\n' +
      'function p(db) { return db.select({ c: cases, ...getTableColumns(cases) }).from(packVersion); }\n' +
      'function l(db) { const cases2 = [1]; return db.select().from(cases2); }\n' +
      'function k1(db) { return db.execute(sql`SELECT EXTRACT(EPOCH FROM CASE WHEN a THEN b END) FROM artifact a`); }\n' +
      "function k2(db) { return db.execute(sql`SELECT id FROM artifact WHERE status IS DISTINCT FROM CASE WHEN true THEN 'x' END`); }\n" +
      "const SCHEMA_NAME = 'drizzle'; const TABLE_NAME = '__migrations';\n" +
      'function k3(db) { return db.execute(`SELECT hash FROM "${SCHEMA_NAME}"."${TABLE_NAME}"`); }\n' +
      'function k4(db, v) { return db.execute(sql`SELECT id FROM ${artifact} WHERE x IS DISTINCT FROM ${v} AND EXTRACT(EPOCH FROM ${v}) > 0`); }\n' +
      'function k5() { type Row = typeof cases.$inferSelect; return 1; }\n',
  );
  assert.deepEqual(sites, []);
  const local = one('const cases = []; function m(db) { return db.select().from(cases); }');
  assert.deepEqual(local, []);
});

test('reads every server TypeScript module, not only .ts', () => {
  assert.deepEqual(
    ['a.ts', 'b.mts', 'c.cts', 'd.tsx', 'a.test.ts', 'b.test.mts', 'e.d.ts', 'f.js', 'g.json'].filter(
      isServerSource,
    ),
    ['a.ts', 'b.mts', 'c.cts', 'd.tsx'],
  );
});

test('the allow-list comparison fails on an unlisted site, an extra site and a stale entry', () => {
  const site = (fn: string, line: number, scoped = false): Site => ({
    file: 'f.ts',
    line,
    fn,
    kind: 'builder',
    scoped,
  });
  const allow: AllowEntry[] = [
    { file: 'f.ts', fn: 'byId', count: 1, reason: 'by id' },
    { file: 'f.ts', fn: 'gone', count: 1, reason: 'was removed' },
  ];
  const failures = compareWithAllowList(
    [site('byId', 3), site('byId', 9), site('list', 20), site('scoped', 30, true)],
    allow,
  );
  assert.equal(failures.length, 3, failures.join('\n'));
  assert.match(
    failures[0]!,
    /2 unscoped case reads where the allow-list expects 1: f\.ts:3 in byId\(\) \[builder\], f\.ts:9/,
  );
  assert.match(failures[1]!, /no allow-list entry: f\.ts:20 in list\(\)/);
  assert.match(
    failures[2]!,
    /stale allow-list entry f\.ts gone\(\): expects 1 unscoped case read\(s\), found 0/,
  );
  assert.deepEqual(compareWithAllowList([site('byId', 3)], allow.slice(0, 1)), []);
});

// ---- the real run over the server source ----

test('every case read in rai-web/server/src is scoped by caseScopeWhere or reasoned in the allow-list', () => {
  const srcRoot = path.resolve(import.meta.dirname, '..');
  const repoRoot = path.resolve(srcRoot, '..', '..', '..');
  const files = readdirSync(srcRoot, { recursive: true, encoding: 'utf8' }).filter(isServerSource).sort();
  assert.ok(files.length > 50, `expected the server sources under ${srcRoot}, found ${files.length} files`);
  const sites = files.flatMap((f) => {
    const abs = path.join(srcRoot, f);
    return analyzeSource(path.relative(repoRoot, abs).split(path.sep).join('/'), readFileSync(abs, 'utf8'));
  });
  for (const e of ALLOW_LIST)
    assert.ok(e.reason.trim() !== '', `allow-list entry ${e.file} ${e.fn} has no reason`);
  const failures = compareWithAllowList(sites, ALLOW_LIST);
  assert.deepEqual(failures, [], `\n${failures.join('\n')}`);
  // The scoped reads are seen too, so an analyzer that silently finds nothing cannot pass by accident.
  assert.ok(
    sites.some((s) => s.scoped && s.fn === 'readQueue') &&
      sites.filter((s) => s.scoped && s.fn === 'listCases').length === 2,
    'the analyzer no longer sees the scoped queue (readQueue) and list (listCases) queries',
  );
});
