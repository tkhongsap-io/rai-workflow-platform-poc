import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export function integrationEntries(root: string): string[] {
  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(file) : file.endsWith('.ts') ? [file] : [];
    });
  }
  return walk(path.join(root, 'tests/integration'));
}

/** Policy only for test imports: production modules remain the system under test. */
export function unauditedAppImports(root: string, entries = integrationEntries(root)): string[] {
  const wrapper = path.join(root, 'tests/support/observed-app.ts');
  const rawApp = path.join(root, 'server/src/app.ts');
  const failures: string[] = [];
  const seen = new Set<string>();
  function resolve(from: string, specifier: string): string | undefined {
    const base = specifier.startsWith('.')
      ? path.resolve(path.dirname(from), specifier)
      : specifier.startsWith('@rai/server/')
        ? path.join(root, 'server/src', specifier.slice('@rai/server/'.length))
        : path.isAbsolute(specifier)
          ? specifier
          : undefined;
    if (base === undefined) return undefined;
    return [base.replace(/\.js$/, '.ts'), `${base}.ts`, path.join(base, 'index.ts')].find((file) =>
      existsSync(file),
    );
  }
  function visitFile(file: string) {
    if (seen.has(file)) return;
    seen.add(file);
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    function inspect(specifier: ts.Expression | undefined) {
      if (specifier === undefined || !ts.isStringLiteralLike(specifier)) {
        failures.push(`${path.relative(root, file)}: nonliteral module access`);
        return;
      }
      const resolved = resolve(file, specifier.text);
      if (resolved === rawApp && file !== wrapper)
        failures.push(`${path.relative(root, file)}: unaudited app import`);
      if (resolved?.startsWith(path.join(root, 'tests') + path.sep)) visitFile(resolved);
      else if (specifier.text.startsWith('.') && resolved === undefined)
        failures.push(`${path.relative(root, file)}: unresolved test import`);
    }
    function visit(node: ts.Node) {
      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause;
        const named = clause?.namedBindings;
        const typeOnly =
          clause?.isTypeOnly ||
          (clause?.name === undefined &&
            named !== undefined &&
            ts.isNamedImports(named) &&
            named.elements.length > 0 &&
            named.elements.every((e) => e.isTypeOnly));
        if (!typeOnly) inspect(node.moduleSpecifier);
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
        const typeOnly =
          node.isTypeOnly ||
          (node.exportClause !== undefined &&
            ts.isNamedExports(node.exportClause) &&
            node.exportClause.elements.length > 0 &&
            node.exportClause.elements.every((e) => e.isTypeOnly));
        if (!typeOnly) inspect(node.moduleSpecifier);
      } else if (
        ts.isImportEqualsDeclaration(node) &&
        !node.isTypeOnly &&
        ts.isExternalModuleReference(node.moduleReference)
      ) {
        inspect(node.moduleReference.expression);
      } else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require') ||
          (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'require'))
      ) {
        inspect(node.arguments[0]);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  entries.forEach(visitFile);
  return failures;
}
