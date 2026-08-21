import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  type ContentSectionId,
  PUBLIC_SURFACE_INVENTORY,
  REGISTERED_SECTION_IDS,
  SECTION_REGISTRY,
} from './sectionRegistry';

const EXPECTED_SECTION_IDS: ContentSectionId[] = [
  'salonProfile',
  'technicianProfile',
  'featuredServices',
  'serviceMenu',
  'whatsIncluded',
  'technicianList',
  'portfolio',
  'reviews',
  'hoursLocation',
  'policies',
  'socialLinks',
  'bookingCta',
  'announcement',
  'bookingFacts',
];

const EXPECTED_NON_CONTENT_SURFACES = [
  'bookingCtaCompatibility',
  'editorialStickyBookingCta',
  'selectedServiceContinueBar',
  'appointmentSummaryCard',
  'bookingProgressHeader',
  'serviceSelectionControls',
  'smartFitAvailabilitySection',
  'confirmationPolicyDisclosure',
  'depositDisclosure',
] as const;

type ViolationKind =
  | 'raw-hidden-read'
  | 'legacy-can-render'
  | 'unclassified-section'
  | 'unknown-surface'
  | 'independent-renderer-guard';
type Violation = { kind: ViolationKind; text: string };

function attributeValue(node: ts.JsxAttribute, file: ts.SourceFile): string | null {
  if (!node.initializer) {
    return '';
  }
  if (ts.isStringLiteral(node.initializer)) {
    return node.initializer.text;
  }
  return node.initializer.getText(file);
}

function hasReturnNull(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node) => {
    if (ts.isReturnStatement(child) && child.expression?.kind === ts.SyntaxKind.NullKeyword) {
      found = true;
    }
    if (!found) {
      ts.forEachChild(child, visit);
    }
  };
  visit(node);
  return found;
}

function hasConditionalOmission(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node) => {
    if (ts.isConditionalExpression(child)
      && (child.whenTrue.kind === ts.SyntaxKind.NullKeyword || child.whenFalse.kind === ts.SyntaxKind.NullKeyword)) {
      found = true;
    }
    if (ts.isBinaryExpression(child)
      && child.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      && (ts.isJsxElement(child.right) || ts.isJsxSelfClosingElement(child.right))) {
      found = true;
    }
    if (!found) {
      ts.forEachChild(child, visit);
    }
  };
  visit(node);
  return found;
}

function isSectionRendererName(name: string): boolean {
  const normalized = name.toLowerCase();
  return EXPECTED_SECTION_IDS.some(id => normalized.includes(id.toLowerCase()))
    && (normalized.includes('render') || normalized.includes('section'));
}

function rendererRoot(node: ts.Node): ts.JsxOpeningLikeElement | null {
  if (ts.isArrowFunction(node) && (ts.isJsxElement(node.body) || ts.isJsxSelfClosingElement(node.body))) {
    return ts.isJsxElement(node.body) ? node.body.openingElement : node.body;
  }
  let root: ts.JsxOpeningLikeElement | null = null;
  ts.forEachChild(node, (child) => {
    if (!root && ts.isReturnStatement(child) && child.expression) {
      if (ts.isJsxElement(child.expression)) {
        root = child.expression.openingElement;
      } else if (ts.isJsxSelfClosingElement(child.expression)) {
        root = child.expression;
      }
    }
  });
  return root;
}

function hasSurfaceMarker(node: ts.JsxOpeningLikeElement, file: ts.SourceFile): boolean {
  return node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute)
    && ['data-public-surface', 'data-public-surfaces'].includes(attribute.name.getText(file)));
}

function inspectPublicRenderer(source: string): Violation[] {
  const file = ts.createSourceFile('public-renderer.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: Violation[] = [];
  const inventory = new Set(Object.keys(PUBLIC_SURFACE_INVENTORY));
  const contentIds = new Set<ContentSectionId>(EXPECTED_SECTION_IDS);

  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'hiddenSections') {
      violations.push({ kind: 'raw-hidden-read', text: node.getText(file) });
    }
    if (ts.isBindingElement(node)
      && (node.name.getText(file) === 'hiddenSections' || node.propertyName?.getText(file) === 'hiddenSections')) {
      violations.push({ kind: 'raw-hidden-read', text: node.getText(file) });
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'canRender') {
      violations.push({ kind: 'legacy-can-render', text: node.getText(file) });
    }
    if (ts.isPropertyAssignment(node) && contentIds.has(node.name.getText(file).replaceAll(/['"]/g, '') as ContentSectionId)) {
      const inspectGuard = (child: ts.Node) => {
        if (ts.isIfStatement(child) && hasReturnNull(child.thenStatement)) {
          violations.push({ kind: 'independent-renderer-guard', text: child.getText(file) });
        }
        ts.forEachChild(child, inspectGuard);
      };
      inspectGuard(node.initializer);
      if (hasConditionalOmission(node.initializer)) {
        violations.push({ kind: 'independent-renderer-guard', text: node.initializer.getText(file) });
      }
      const root = rendererRoot(node.initializer);
      if (root && !hasSurfaceMarker(root, file)) {
        violations.push({ kind: 'unclassified-section', text: root.getText(file) });
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name && isSectionRendererName(node.name.text)) {
      if (hasReturnNull(node) || hasConditionalOmission(node)) {
        violations.push({ kind: 'independent-renderer-guard', text: node.getText(file) });
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && /^[A-Z]/.test(node.name.text) && isSectionRendererName(node.name.text) && node.initializer) {
      if (hasReturnNull(node.initializer) || hasConditionalOmission(node.initializer)) {
        violations.push({ kind: 'independent-renderer-guard', text: node.getText(file) });
      }
      const root = rendererRoot(node.initializer);
      if (root && !hasSurfaceMarker(root, file)) {
        violations.push({ kind: 'unclassified-section', text: root.getText(file) });
      }
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
      const markers = attributes.filter(attribute =>
        attribute.name.getText(file) === 'data-public-surface'
        || attribute.name.getText(file) === 'data-public-surfaces');
      if (['section', 'nav', 'ul'].includes(node.tagName.getText(file)) && markers.length === 0) {
        violations.push({ kind: 'unclassified-section', text: node.getText(file) });
      }
      for (const marker of markers) {
        const value = attributeValue(marker, file);
        if (value?.startsWith('{')) {
          violations.push({ kind: 'unknown-surface', text: value });
        } else if (value) {
          for (const surface of value.split(/\s+/)) {
            if (!inventory.has(surface)) {
              violations.push({ kind: 'unknown-surface', text: surface });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return violations;
}

function publicRendererFiles(): string[] {
  const roots = ['src/app/(unauth)/book', 'src/app/[locale]/[slug]/book', 'src/components/booking'];
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(target);
      } else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) {
        files.push(target);
      }
    }
  };
  roots.forEach(root => walk(path.join(process.cwd(), root)));
  return files;
}

describe('public section architecture guard', () => {
  it('pins the closed section vocabulary independently of the registry', () => {
    expect([...REGISTERED_SECTION_IDS].sort()).toEqual([...EXPECTED_SECTION_IDS].sort());

    for (const id of EXPECTED_SECTION_IDS) {
      expect(SECTION_REGISTRY[id].resolveReadiness, id).toBeTypeOf('function');
    }
  });

  it('pins content and non-content public surfaces in an authoritative inventory', () => {
    const inventoriedSections = Object.values(PUBLIC_SURFACE_INVENTORY)
      .flatMap(entry => 'sectionId' in entry ? [entry.sectionId] : []);

    expect([...new Set(inventoriedSections)].sort()).toEqual([...EXPECTED_SECTION_IDS].sort());

    for (const surface of EXPECTED_NON_CONTENT_SURFACES) {
      expect(PUBLIC_SURFACE_INVENTORY[surface].classification).not.toBe('content');
      expect(PUBLIC_SURFACE_INVENTORY[surface].reason.trim()).not.toBe('');
    }
  });

  it('discovers and scans every anonymous booking renderer', () => {
    const files = publicRendererFiles();

    expect(files.length).toBeGreaterThan(10);

    for (const rendererPath of files) {
      const renderer = fs.readFileSync(rendererPath, 'utf8');
      const inspected = inspectPublicRenderer(renderer);
      const adapterReads = rendererPath.endsWith('BookServiceClient.tsx')
        ? inspected.filter(violation => violation.kind === 'raw-hidden-read' && violation.text === 'bookingPage?.hiddenSections')
        : [];
      if (rendererPath.endsWith('BookServiceClient.tsx')) {
        expect(adapterReads, 'exactly one raw hidden-state adapter is allowed').toHaveLength(1);
      }
      const violations = inspected.filter(violation => !adapterReads.includes(violation));

      expect(violations, rendererPath).toEqual([]);
    }
  });

  it('is non-vacuous across hidden aliases, unclassified blocks, missing metadata and local guards', () => {
    const mutated = `
      const { hiddenSections: hiddenAlias } = bookingPage;
      const hidden = new Set(bookingPage.hiddenSections);
      const ready = registryAlias.policies.canRender(content);
      const renderers = { policies: () => { if (content.policy.length === 0) return null; return <section data-public-surface="notInventoried" />; } };
      const conditionalRenderers = { socialLinks: () => content.social.length ? <nav data-public-surface={unknown} /> : null };
      const andRenderers = { featuredServices: () => content.services.length > 0 && <ul data-public-surface="featuredServices" /> };
      function PoliciesRenderer() { if (!content.policy) return null; return <div>{content.policy}</div>; }
      const SocialLinksRenderer = () => content.social ? <aside>{content.social}</aside> : null;
      const unclassifiedRenderers = { reviews: () => <div>{content.reviews}</div> };
      const bypass = <section><div>{content.raw}</div></section>;
    `;

    expect(new Set(inspectPublicRenderer(mutated).map(result => result.kind))).toEqual(new Set<ViolationKind>([
      'raw-hidden-read',
      'legacy-can-render',
      'independent-renderer-guard',
      'unknown-surface',
      'unclassified-section',
    ]));
  });
});
