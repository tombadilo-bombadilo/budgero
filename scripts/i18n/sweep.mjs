#!/usr/bin/env node
/**
 * AST-based i18n sweep for packages/app.
 *
 *   node scripts/i18n/sweep.mjs                 audit: list untranslated user-facing strings
 *   node scripts/i18n/sweep.mjs --fix           wrap what can be wrapped mechanically
 *   node scripts/i18n/sweep.mjs --max 0         CI gate: fail if unallowlisted findings remain
 *
 * Audit and fix share the same detection logic, so the audit number is the
 * ground truth for what the fixer left behind — not a separate estimate.
 * Allowlist: i18n/sweep-allowlist.json  entries {file, text} with a reason.
 */

import jscodeshift from 'jscodeshift';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = join(ROOT, 'packages', 'app');
const ALLOWLIST_PATH = join(ROOT, 'i18n', 'sweep-allowlist.json');

const j = jscodeshift.withParser('tsx');

const allowlist = existsSync(ALLOWLIST_PATH)
  ? JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8')).entries ?? []
  : [];
const fileFullyAllowed = (file) => allowlist.some((a) => a.file === file && a.text === '*');
const textAllowed = (file, text) =>
  allowlist.some((a) => a.file === file && (a.text === '*' || a.text === text));

const FIX = process.argv.includes('--fix');
const takeList = (flag) => {
  const i = process.argv.indexOf(flag);
  if (i < 0) return [];
  const out = [];
  for (let k = i + 1; k < process.argv.length && !process.argv[k].startsWith('--'); k++) {
    out.push(process.argv[k]);
  }
  return out;
};
const MODULES = process.argv.includes('--modules');
const MAX = process.argv.includes('--max')
  ? Number(process.argv[process.argv.indexOf('--max') + 1])
  : null;

// ---------------------------------------------------------------- config

const OBJ_KEYS = new Set([
  'label', 'title', 'description', 'placeholder', 'tooltip', 'heading',
  'subtitle', 'subheading', 'text', 'cta', 'message', 'summary', 'hint',
  'blurb', 'caption', 'emptyText', 'confirmText', 'cancelText', 'successMessage',
  'question', 'buttonLabel', 'allOptionLabel', 'searchPlaceholder',
  'errorMessage', 'helperText', 'empty', 'loadingText', 'badge', 'name',
]);
const ARRAY_KEYS = new Set(['takeaways', 'tips', 'bullets', 'features', 'steps']);
const ATTRS = new Set([
  'placeholder', 'title', 'aria-label', 'label', 'alt', 'description',
  'emptyText', 'confirmText', 'cancelText', 'tooltip', 'buttonLabel',
  'allOptionLabel', 'searchPlaceholder', 'question', 'heading', 'subtitle',
]);
const MACHINE_ATTRS = new Set([
  'className', 'class', 'id', 'htmlFor', 'key', 'variant', 'size', 'value',
  'type', 'mode', 'side', 'align', 'href', 'src', 'to', 'path', 'rel',
  'target', 'role', 'autoComplete', 'inputMode', 'form', 'method', 'name',
  'data-testid', 'testId', 'position', 'orientation', 'dir', 'loading',
  'decoding', 'sizes', 'accept', 'pattern', 'defaultValue', 'asChild',
]);
const STYLE_CALLEES = new Set(['cn', 'clsx', 'cva', 'twMerge', 'tv']);
const SILENT_CALLEES = new Set([
  'console', 'logger', 'log', 'track', 'captureException', 'captureMessage',
  'getItem', 'setItem', 'removeItem', 'querySelector', 'querySelectorAll',
  'addEventListener', 'removeEventListener', 'getElementById', 'invalidateQueries',
  'setQueryData', 'useQuery', 'createElement', 'includes', 'startsWith', 'endsWith',
  'indexOf', 'split', 'replace', 'replaceAll', 'test', 'match', 'localeCompare',
]);
// date-fns / Intl pattern args: format(x, 'MMM d, yyyy')
const PATTERN_ARG_CALLEES = new Map([
  ['format', 1], ['formatDate', 1], ['formatInTimeZone', 1], ['parse', 1],
]);
const SKIP_ELEMENTS = new Set(['code', 'pre', 'script', 'style', 'svg', 'path', 'Trans']);
const WRAPPER_TAGS = new Set(['t', 'msg']);

const SKIP_FILES = [
  /\.test\./, /\.spec\./, /\/test\//, /\.generated\./, /\.d\.ts$/,
  /currency-data\.ts$/, // handled via Intl.DisplayNames, not catalogs
  /\/mutations\/fuzz\//, /\/undo-integrity\/harness\.ts$/, // test-only fixtures
];

// ---------------------------------------------------------------- text classification

const DATE_TOKENS = /^[yYMLdEHhmsaPpOxXzZQwWkKcGuT\s,./:'-]+$/;

function isUtilityText(t) {
  const words = t.split(/\s+/);
  const utilityish = words.some((w) => /[[\]:#%]|-\S|\d/.test(w));
  const allLowerTokens = words.every((w) => /^[a-z0-9[\]:#%./!&_-]+$/.test(w));
  return utilityish && allLowerTokens;
}

function baseHuman(t) {
  if (t.length < 2 || t.length > 2000) return false;
  if (!/[A-Za-z]{2}/.test(t)) return false;
  if (/^(https?:|www\.|mailto:|\/|\.\/|#|@|--)/.test(t)) return false;
  if (/^[\w.+-]+@[\w-]+\.\w+$/.test(t)) return false;
  if (/^[A-Z0-9_]+$/.test(t)) return false; // SCREAMING_CASE ids
  if (/^[\w-]+=/.test(t)) return false; // cookie/query assignments
  if (!/\s/.test(t) && /\d/.test(t)) return false; // SHA-256, ISO-8601, v2 ids
  if (!/\s/.test(t) && /^[a-z]+[A-Z]/.test(t)) return false; // camelCase token
  if (!/\s/.test(t) && /^[A-Z][a-z]+[A-Z]/.test(t)) return false; // PascalCase token
  if (!/\s/.test(t) && /[-_.]/.test(t) && !/[A-Z]/.test(t)) return false; // slug
  if (/^\s*(--|SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|PRAGMA|WITH|EXPLAIN)\b/i.test(t)) return false; // SQL
  if (isUtilityText(t)) return false;
  return true;
}

// strict: prose-ish — needed where ids are plausible (returns, var inits)
const humanStrict = (s) => {
  const t = s.trim();
  return baseHuman(t) && /\s/.test(t);
};
// normal: labels — capital or space
const humanNormal = (s) => {
  const t = s.trim();
  return baseHuman(t) && (/\s/.test(t) || /^[A-Z]/.test(t));
};
// loose: ternary branches / JSX text — must still look like copy, not a value
const humanLoose = (s) => {
  const t = s.trim();
  return baseHuman(t) && (/\s/.test(t) || /^[A-Z]/.test(t));
};

// ---------------------------------------------------------------- AST helpers

function* ancestors(path) {
  let p = path.parent;
  while (p) {
    yield p;
    p = p.parent;
  }
}

function elementName(node) {
  const n = node.openingElement?.name;
  if (!n) return null;
  return n.type === 'JSXIdentifier' ? n.name : n.property?.name ?? null;
}

function calleeRootName(callee) {
  if (!callee) return null;
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression') {
    return callee.property?.name ?? calleeRootName(callee.object);
  }
  return null;
}

function attrName(node) {
  const n = node.name;
  if (!n) return null;
  return n.type === 'JSXNamespacedName' ? `${n.namespace.name}-${n.name.name}` : n.name;
}

/** Why this node must be left alone, or null if it's fair game. */
function excludedReason(path) {
  let child = path.node;
  for (const p of ancestors(path)) {
    const n = p.node;
    switch (n.type) {
      case 'ImportDeclaration':
      case 'ExportAllDeclaration':
      case 'TSLiteralType':
      case 'TSEnumMember':
        return 'machine';
      case 'BinaryExpression':
        if (['===', '!==', '==', '!='].includes(n.operator)) return 'comparison';
        break;
      case 'SwitchCase':
        if (n.test === child) return 'switch-test';
        break;
      case 'ObjectProperty':
      case 'Property':
        if (n.key === child) return 'object-key';
        break;
      case 'MemberExpression':
        if (n.computed && n.property === child) return 'computed-member';
        break;
      case 'JSXAttribute': {
        const a = attrName(n);
        if (a && MACHINE_ATTRS.has(a)) return 'machine-attr';
        break;
      }
      case 'CallExpression':
      case 'NewExpression': {
        const name = calleeRootName(n.callee);
        if (name && STYLE_CALLEES.has(name)) return 'style-call';
        if (name && SILENT_CALLEES.has(name)) return 'silent-call';
        if (name === 'Error') return 'error-message';
        const patternIdx = name ? PATTERN_ARG_CALLEES.get(name) : undefined;
        if (patternIdx !== undefined && n.arguments[patternIdx] === child) return 'pattern-arg';
        break;
      }
      case 'TaggedTemplateExpression':
        if (n.tag.type === 'Identifier' && WRAPPER_TAGS.has(n.tag.name)) return 'already-wrapped';
        break;
      case 'JSXElement':
        if (elementName(n) === 'Trans') return 'already-wrapped';
        if (SKIP_ELEMENTS.has(elementName(n) ?? '')) return 'skip-element';
        break;
    }
    // plural(x, { one: '...', other: '...' }) — already ICU
    if (
      (n.type === 'CallExpression') &&
      ['plural', 't', 'msg', 'select'].includes(calleeRootName(n.callee) ?? '')
    ) {
      return 'already-wrapped';
    }
    child = n;
  }
  return null;
}

function isComponentName(name) {
  return !!name && (/^[A-Z]/.test(name) || /^use[A-Z]/.test(name));
}

function enclosingComponent(path) {
  for (const p of ancestors(path)) {
    const n = p.node;
    if (n.type === 'FunctionDeclaration' && isComponentName(n.id?.name)) return n;
    if (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression') {
      if (n.type === 'FunctionExpression' && isComponentName(n.id?.name)) return n;
      // Climb through memo()/forwardRef() wrappers to the declarator name.
      let q = p.parent;
      while (
        q?.node?.type === 'CallExpression' &&
        ['memo', 'forwardRef'].includes(calleeRootName(q.node.callee) ?? '')
      ) {
        q = q.parent;
      }
      const parent = q?.node;
      if (parent?.type === 'VariableDeclarator' && isComponentName(parent.id?.name)) return n;
      if (parent?.type === 'ExportDefaultDeclaration') return n;
    }
  }
  return null;
}

/** Is this string in a position a user will read? Returns a category or null. */
function userFacingPosition(path) {
  const parent = path.parent?.node;
  if (!parent) return null;

  if (parent.type === 'JSXExpressionContainer') {
    const gp = path.parent.parent?.node;
    if (gp?.type === 'JSXElement' || gp?.type === 'JSXFragment') return 'jsx-child';
    if (gp?.type === 'JSXAttribute') {
      const a = attrName(gp);
      return a && ATTRS.has(a) ? 'attr' : null;
    }
    return null;
  }
  if (parent.type === 'JSXAttribute') {
    const a = attrName(parent);
    return a && ATTRS.has(a) ? 'attr' : null;
  }
  if (parent.type === 'ObjectProperty' || parent.type === 'Property') {
    if (parent.value !== path.node) return null;
    const key = parent.key?.name ?? parent.key?.value;
    return key && OBJ_KEYS.has(key) ? 'object-prop' : null;
  }
  if (parent.type === 'ArrayExpression') {
    const gp = path.parent.parent?.node;
    if (gp?.type === 'MemberExpression' && gp.property?.name === 'map') return 'array-item';
    if (gp?.type === 'ObjectProperty' || gp?.type === 'Property') {
      const key = gp.key?.name ?? gp.key?.value;
      if (key && ARRAY_KEYS.has(key)) return 'array-item';
    }
    return null;
  }
  if (parent.type === 'CallExpression') {
    const name = calleeRootName(parent.callee);
    if (name === 'getErrorMessage' && parent.arguments[1] === path.node) return 'toast';
    if (/^set.*(?:Error|Message)$/.test(name ?? '') && parent.arguments[0] === path.node) return 'toast';
    if (name === 'push' && ['errors', 'validationErrors', 'summaryParts'].includes(parent.callee.object?.name)) return 'toast';
    if (name === 'toast' || (parent.callee.type === 'MemberExpression' &&
        parent.callee.object?.name === 'toast')) return 'toast';
    return null;
  }
  if (parent.type === 'ReturnStatement') return 'return';
  if (parent.type === 'VariableDeclarator' && parent.init === path.node) return 'var-init';
  if (parent.type === 'ConditionalExpression' || parent.type === 'LogicalExpression') {
    // classification of the ternary/logical itself decides; recurse upward
    return userFacingPosition(path.parent);
  }
  if (parent.type === 'ArrowFunctionExpression' && parent.body === path.node) return 'return';
  return null;
}

const HUMAN_BY_POSITION = {
  'jsx-child': humanLoose,
  attr: humanNormal,
  'object-prop': humanNormal,
  'array-item': humanNormal,
  toast: humanNormal,
  return: humanStrict,
  'var-init': humanStrict,
};

// ---------------------------------------------------------------- fixers

function tTemplateFromString(value) {
  return j.taggedTemplateExpression(
    j.identifier('t'),
    j.templateLiteral([j.templateElement({ raw: value, cooked: value }, true)], [])
  );
}

function hasHtmlEntity(node) {
  const raw = node.extra?.raw ?? node.raw;
  return typeof raw === 'string' && /&[a-zA-Z#][a-zA-Z0-9]*;/.test(raw);
}

function injectUseLingui(root) {
  const MACRO = '@lingui/react/macro';
  const touched = new Set();
  return {
    mark(fn) {
      if (fn) touched.add(fn);
    },
    commit() {
      let injected = false;
      for (const fn of touched) {
        if (!fn.body || fn.body.type !== 'BlockStatement') continue;
        const has = fn.body.body.some(
          (s) =>
            s.type === 'VariableDeclaration' &&
            s.declarations.some((d) => d.init?.callee?.name === 'useLingui')
        );
        if (has) { injected = true; continue; }
        fn.body.body.unshift(
          j.variableDeclaration('const', [
            j.variableDeclarator(
              j.objectPattern([
                Object.assign(j.property('init', j.identifier('t'), j.identifier('t')), {
                  shorthand: true,
                }),
              ]),
              j.callExpression(j.identifier('useLingui'), [])
            ),
          ])
        );
        injected = true;
      }
      if (!injected || touched.size === 0) return;
      const existing = root.find(j.ImportDeclaration, { source: { value: MACRO } });
      if (existing.size() > 0) {
        const specs = existing.at(0).get().node.specifiers ?? [];
        if (!specs.some((s) => s.imported?.name === 'useLingui')) {
          specs.push(j.importSpecifier(j.identifier('useLingui')));
        }
      } else {
        const decl = j.importDeclaration(
          [j.importSpecifier(j.identifier('useLingui'))],
          j.literal(MACRO)
        );
        const imports = root.find(j.ImportDeclaration);
        if (imports.size() > 0) imports.at(0).insertBefore(decl);
        else root.get().node.program.body.unshift(decl);
      }
    },
  };
}

// ---------------------------------------------------------------- per-file sweep

function isStr(n) {
  return n && (n.type === 'StringLiteral' || (n.type === 'Literal' && typeof n.value === 'string'));
}
function isHumanTemplate(n) {
  return (
    n?.type === 'TemplateLiteral' &&
    n.quasis.some((q) => humanNormal(q.value.cooked ?? ''))
  );
}

function subtreeHasHumanLabel(node) {
  let found = false;
  j(node)
    .find(j.StringLiteral)
    .forEach((p) => {
      if (found) return;
      const parent = p.parent?.node;
      const inLabelProp =
        (parent?.type === 'ObjectProperty' || parent?.type === 'Property') &&
        parent.value === p.node &&
        OBJ_KEYS.has(parent.key?.name ?? parent.key?.value);
      if (inLabelProp && humanNormal(p.node.value)) found = true;
    });
  return found;
}

/** Move module constants used by exactly one same-file component into it, so
 * the ordinary t\`\` pass can reach their strings. Data-only inits; React
 * Compiler memoizes the recreation, so this is semantics- and perf-neutral. */
function hoistPass(root) {
  let hoisted = 0;
  root
    .find(j.VariableDeclaration)
    .filter((p) => p.parent?.node?.type === 'Program')
    .forEach((declPath) => {
      const decl = declPath.node;
      if (decl.declarations.length !== 1) return;
      const d = decl.declarations[0];
      if (d.id?.type !== 'Identifier' || !d.init) return;
      let init = d.init;
      while (['TSAsExpression', 'TSSatisfiesExpression'].includes(init.type)) init = init.expression;
      if (!['ObjectExpression', 'ArrayExpression'].includes(init.type)) return;
      if (!subtreeHasHumanLabel(init)) return;

      const name = d.id.name;
      let target = null;
      let ok = true;
      root.find(j.Identifier, { name }).forEach((idPath) => {
        if (!ok || idPath.node === d.id) return;
        const parent = idPath.parent?.node;
        if (
          (parent?.type === 'ObjectProperty' && parent.key === idPath.node && !parent.computed) ||
          (parent?.type === 'MemberExpression' && parent.property === idPath.node && !parent.computed) ||
          parent?.type === 'ImportSpecifier' || parent?.type === 'ExportSpecifier' ||
          parent?.type?.startsWith('TS')
        ) {
          return;
        }
        const fn = enclosingComponent(idPath);
        if (!fn) { ok = false; return; }
        if (target && target !== fn) { ok = false; return; }
        // A default-parameter reference cannot see body declarations.
        let node = idPath;
        while (node.parent && node.parent.node !== fn) node = node.parent;
        if (node.parent && fn.params?.includes(node.node)) { ok = false; return; }
        target = fn;
      });
      if (!ok || !target || !target.body || target.body.type !== 'BlockStatement') return;

      declPath.prune();
      // Insert below any useLingui() hook so wrapped strings see `t`.
      const body = target.body.body;
      const hookIdx = body.findIndex(
        (st) =>
          st.type === 'VariableDeclaration' &&
          st.declarations.some((dd) => dd.init?.callee?.name === 'useLingui')
      );
      body.splice(hookIdx + 1, 0, decl);
      hoisted++;
    });
  return hoisted;
}

function sweepFile(file, report) {
  const abs = join(APP, file);
  const src = readFileSync(abs, 'utf8');
  const root = j(src);
  const hook = injectUseLingui(root);
  let changed = false;
  if (FIX && hoistPass(root) > 0) changed = true;

  const record = (path, category, text) => {
    report.push({ file, line: path.node.loc?.start.line ?? 0, category, text: text.trim() });
  };

  let coreImportNeeded = new Set();
  const insideAnyFunction = (path) => {
    for (const p of ancestors(path)) {
      if (
        ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(
          p.node.type
        )
      ) {
        return true;
      }
    }
    return false;
  };
  const wrapModuleLeaf = (path) => {
    if (!FIX || !MODULES || fileFullyAllowed(file)) return false;
    const node = path.node;
    if (isStr(node) && textAllowed(file, node.value)) return false;
    // Top-level data must defer resolution (msg descriptor); strings built
    // inside functions resolve at call time, after the locale is active.
    const tag = insideAnyFunction(path) ? 't' : 'msg';
    const needsContainer = path.parent?.node?.type === 'JSXAttribute';
    const contain = (expr) => (needsContainer ? j.jsxExpressionContainer(expr) : expr);
    if (isStr(node)) {
      if (hasHtmlEntity(node)) return false;
      path.replace(
        contain(
          j.taggedTemplateExpression(
            j.identifier(tag),
            j.templateLiteral([j.templateElement({ raw: node.value, cooked: node.value }, true)], [])
          )
        )
      );
    } else if (node.type === 'TemplateLiteral') {
      if (tag === 'msg') return false; // interpolation needs values at render
      path.replace(contain(j.taggedTemplateExpression(j.identifier('t'), node)));
    } else return false;
    coreImportNeeded.add(tag);
    changed = true;
    return true;
  };

  const wrapLeaf = (path, fn) => {
    if (!FIX || !fn) return false;
    const node = path.node;
    const needsContainer = path.parent?.node?.type === 'JSXAttribute';
    const contain = (expr) => (needsContainer ? j.jsxExpressionContainer(expr) : expr);
    if (isStr(node)) {
      if (hasHtmlEntity(node)) return false;
      path.replace(contain(tTemplateFromString(node.value)));
    } else if (node.type === 'TemplateLiteral') {
      path.replace(contain(j.taggedTemplateExpression(j.identifier('t'), node)));
    } else return false;
    hook.mark(fn);
    changed = true;
    return true;
  };

  // Pass 1 — ternary / logical string leaves.
  root
    .find(j.ConditionalExpression)
    .paths()
    .reverse() // innermost first for nested chains
    .forEach((path) => {
      for (const side of ['consequent', 'alternate']) {
        const leafPath = path.get(side);
        const leaf = leafPath.node;
        const isCandidate =
          (isStr(leaf) && humanLoose(leaf.value)) || isHumanTemplate(leaf);
        if (!isCandidate) continue;
        if (excludedReason(leafPath)) continue;
        const pos = userFacingPosition(path);
        if (!pos) continue;
        const fn = enclosingComponent(path);
        const text = isStr(leaf) ? leaf.value : leaf.quasis.map((q) => q.value.cooked).join('{…}');
        if (!fn) {
          if (!wrapModuleLeaf(leafPath)) record(leafPath, 'module-scope', text);
          continue;
        }
        if (!wrapLeaf(leafPath, fn)) record(leafPath, 'ternary', text);
      }
    });

  root.find(j.LogicalExpression).forEach((path) => {
    const right = path.get('right');
    const leaf = right.node;
    if (!((isStr(leaf) && humanLoose(leaf.value)) || isHumanTemplate(leaf))) return;
    if (excludedReason(right)) return;
    const pos = userFacingPosition(path);
    if (!pos) return;
    const fn = enclosingComponent(path);
    const text = isStr(leaf) ? leaf.value : '`template`';
    if (!fn) { if (!wrapModuleLeaf(right)) record(right, 'module-scope', text); return; }
    if (!wrapLeaf(right, fn)) record(right, 'logical-fallback', text);
  });

  // Pass 2 — bare strings and templates in user-facing positions.
  const sweepLiteral = (path) => {
    const node = path.node;
    const pos = userFacingPosition(path);
    if (!pos) return;
    if (excludedReason(path)) return;
    const human = HUMAN_BY_POSITION[pos] ?? humanNormal;
    const text = isStr(node) ? node.value : node.quasis.map((q) => q.value.cooked).join('{…}');
    if (isStr(node) && !human(node.value)) return;
    if (node.type === 'TemplateLiteral' && !isHumanTemplate(node)) return;
    const fn = enclosingComponent(path);
    if (!fn) { if (!wrapModuleLeaf(path)) record(path, 'module-scope', text); return; }
    if (!wrapLeaf(path, fn)) record(path, pos === 'attr' ? 'attr' : pos, text);
  };
  root.find(j.StringLiteral).forEach(sweepLiteral);
  root.find(j.TemplateLiteral).forEach((path) => {
    if (path.parent?.node?.type === 'TaggedTemplateExpression') return;
    sweepLiteral(path);
  });

  // Pass 2b — whitelisted attrs with plain string values: title="Assets".
  root.find(j.JSXAttribute).forEach((path) => {
    const a = attrName(path.node);
    if (!a || !ATTRS.has(a)) return;
    const v = path.node.value;
    if (!isStr(v) || !humanNormal(v.value)) return;
    if (excludedReason(path.get('value'))) return;
    const fn = enclosingComponent(path);
    if (!fn) { if (!wrapModuleLeaf(path.get('value'))) record(path.get('value'), 'module-scope', v.value); return; }
    if (FIX) {
      path.node.value = j.jsxExpressionContainer(tTemplateFromString(v.value));
      hook.mark(fn);
      changed = true;
    } else {
      record(path.get('value'), 'attr', v.value);
    }
  });

  // Pass 3 — JSXText not inside Trans, mixed siblings now allowed.
  const sweepContainer = (path) => {
    const node = path.node;
    if (node.type === 'JSXElement') {
      const name = elementName(node);
      if (name && SKIP_ELEMENTS.has(name)) return;
    }
    const children = node.children ?? [];
    const textChildren = children.filter(
      (c) => c.type === 'JSXText' && baseHuman(c.value.trim()) && !hasHtmlEntity(c)
    );
    if (textChildren.length === 0) return;
    if (excludedReason(path)) return;
    // Direct parent only — nested elements handle their own text.
    if (children.some((c) => c.type === 'JSXText' && hasHtmlEntity(c))) {
      record(path, 'jsx-text', textChildren.map((c) => c.value.trim()).join(' | '));
      return;
    }
    if (!FIX) {
      record(path, 'jsx-text', textChildren.map((c) => c.value.trim()).join(' | '));
      return;
    }
    let start = 0;
    let end = children.length;
    const blank = (c) => c.type === 'JSXText' && /^\s*$/.test(c.value);
    while (start < end && blank(children[start])) start++;
    while (end > start && blank(children[end - 1])) end--;
    if (start >= end) return;
    const trans = j.jsxElement(
      j.jsxOpeningElement(j.jsxIdentifier('Trans'), []),
      j.jsxClosingElement(j.jsxIdentifier('Trans')),
      children.slice(start, end)
    );
    node.children = [...children.slice(0, start), trans, ...children.slice(end)];
    changed = true;
    // ensure Trans import
    const MACRO = '@lingui/react/macro';
    const existing = root.find(j.ImportDeclaration, { source: { value: MACRO } });
    if (existing.size() > 0) {
      const specs = existing.at(0).get().node.specifiers ?? [];
      if (!specs.some((s) => s.imported?.name === 'Trans')) {
        specs.push(j.importSpecifier(j.identifier('Trans')));
      }
    } else {
      const decl = j.importDeclaration([j.importSpecifier(j.identifier('Trans'))], j.literal(MACRO));
      const imports = root.find(j.ImportDeclaration);
      if (imports.size() > 0) imports.at(0).insertBefore(decl);
      else root.get().node.program.body.unshift(decl);
    }
  };
  root.find(j.JSXElement).forEach(sweepContainer);
  root.find(j.JSXFragment).forEach(sweepContainer);

  if (FIX && coreImportNeeded.size > 0) {
    const CORE = '@lingui/core/macro';
    const existing = root.find(j.ImportDeclaration, { source: { value: CORE } });
    const wanted = [...coreImportNeeded];
    if (existing.size() > 0) {
      const specs = existing.at(0).get().node.specifiers ?? [];
      for (const name of wanted) {
        if (!specs.some((sp) => sp.imported?.name === name)) {
          specs.push(j.importSpecifier(j.identifier(name)));
        }
      }
    } else {
      const decl = j.importDeclaration(
        wanted.map((name) => j.importSpecifier(j.identifier(name))),
        j.literal(CORE)
      );
      const imports = root.find(j.ImportDeclaration);
      if (imports.size() > 0) imports.at(0).insertBefore(decl);
      else root.get().node.program.body.unshift(decl);
    }
  }
  if (FIX && changed) {
    hook.commit();
    writeFileSync(abs, root.toSource({ quote: 'single', lineTerminator: '\n' }));
  }
  return changed;
}

// ---------------------------------------------------------------- main

const files = execSync(
  `find src -name '*.tsx' -o -name '*.ts' | sort`,
  { cwd: APP, encoding: 'utf8' }
)
  .trim()
  .split('\n')
  .filter((f) => !SKIP_FILES.some((re) => re.test(f)));

const rawReport = [];
let changedFiles = 0;
for (const file of files) {
  try {
    if (sweepFile(file, rawReport)) changedFiles++;
  } catch (err) {
    console.error(`PARSE FAIL ${file}: ${err.message}`);
    process.exitCode = 1;
  }
}

const seen = new Set();
const report = rawReport.filter((f) => {
  const k = `${f.file}:${f.line}:${f.text}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

const allowed = (f) =>
  allowlist.some((a) => a.file === f.file && (a.text === '*' || a.text === f.text));
const open = report.filter((f) => !allowed(f));

const byCat = {};
for (const f of open) byCat[f.category] = (byCat[f.category] ?? 0) + 1;

if (FIX) console.log(`fixed ${changedFiles} files\n`);
console.log(`untranslated findings: ${open.length} (${report.length - open.length} allowlisted)\n`);
for (const [cat, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cat.padEnd(18)} ${n}`);
}
const byFile = {};
for (const f of open) byFile[f.file] = (byFile[f.file] ?? 0) + 1;
console.log('\nworst files:');
for (const [f, n] of Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${String(n).padStart(4)}  ${f}`);
}
console.log('\nsample findings:');
for (const f of open.slice(0, 20)) {
  console.log(`  ${f.file}:${f.line} [${f.category}] ${JSON.stringify(f.text.slice(0, 60))}`);
}

writeFileSync(
  join(ROOT, 'i18n', 'sweep-report.json'),
  JSON.stringify({ generated: 'sweep.mjs', open, allowlisted: report.length - open.length }, null, 2) + '\n'
);
console.log(`\nfull report: i18n/sweep-report.json`);

if (MAX !== null && open.length > MAX) {
  console.error(`\nFAIL: ${open.length} findings exceed --max ${MAX}`);
  process.exit(1);
}
