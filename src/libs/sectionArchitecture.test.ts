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
type ApprovedRendererSeam =
  | 'salonProfile:BookingStepHeader'
  | 'salonProfile:quickBookRenderer-fallback'
  | 'serviceMenu:renderServiceMenuContent-declaration'
  | 'serviceMenu:renderServiceMenuContent-call'
  | 'serviceMenu:services-anchor-wrapper';
type RendererInspection = {
  violations: Violation[];
  approvedRendererSeams: ApprovedRendererSeam[];
};

function attributeValue(node: ts.JsxAttribute, file: ts.SourceFile): string | null {
  if (!node.initializer) {
    return '';
  }
  if (ts.isStringLiteral(node.initializer)) {
    return node.initializer.text;
  }
  return node.initializer.getText(file);
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isFunctionBoundary(node: ts.Node): boolean {
  return ts.isArrowFunction(node)
    || ts.isFunctionExpression(node)
    || ts.isFunctionDeclaration(node)
    || ts.isMethodDeclaration(node);
}

function rendererDefinitionBody(node: ts.Node): ts.Node {
  let current = ts.isExpression(node) ? unwrapExpression(node) : node;
  while (ts.isCallExpression(current)) {
    const callee = unwrapExpression(current.expression);
    const wrapperName = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee)
        && ts.isIdentifier(callee.expression)
        && callee.expression.text === 'React'
        ? callee.name.text
        : null;
    const callback = current.arguments[0];
    if (
      !['forwardRef', 'memo'].includes(wrapperName ?? '')
      || !callback
      || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
    ) {
      break;
    }
    current = callback;
  }
  return current;
}

function looksLikeRendererDefinition(node: ts.Node): boolean {
  const current = ts.isExpression(node) ? unwrapExpression(node) : node;
  if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
    return true;
  }
  if (!ts.isCallExpression(current)) {
    return false;
  }
  const callback = current.arguments[0];
  return !!callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback));
}

function rendererReturnedExpressions(node: ts.Node): ts.Expression[] {
  const rendererNode = rendererDefinitionBody(node);

  if (ts.isArrowFunction(rendererNode) && !ts.isBlock(rendererNode.body)) {
    return [rendererNode.body];
  }

  const expressions: ts.Expression[] = [];
  const visit = (child: ts.Node) => {
    if (child !== rendererNode && isFunctionBoundary(child)) {
      return;
    }
    if (ts.isReturnStatement(child)) {
      if (child.expression) {
        expressions.push(child.expression);
      }
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(rendererNode);
  return expressions;
}

function hasReturnNull(node: ts.Node): boolean {
  return rendererReturnedExpressions(node)
    .some(expression => unwrapExpression(expression).kind === ts.SyntaxKind.NullKeyword);
}

function returnedExpressionHasConditionalOmission(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression);
  if (ts.isConditionalExpression(unwrapped)) {
    return unwrapExpression(unwrapped.whenTrue).kind === ts.SyntaxKind.NullKeyword
      || unwrapExpression(unwrapped.whenFalse).kind === ts.SyntaxKind.NullKeyword;
  }
  return ts.isBinaryExpression(unwrapped)
    && unwrapped.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    && unwrapExpression(unwrapped.right).kind !== ts.SyntaxKind.NullKeyword;
}

function hasConditionalOmission(node: ts.Node): boolean {
  return rendererReturnedExpressions(node).some(returnedExpressionHasConditionalOmission);
}

function rendererNameMatchesSection(name: string, sectionId: ContentSectionId): boolean {
  const normalizedName = name.toLowerCase();
  const normalizedId = sectionId.toLowerCase();
  const singularId = normalizedId.endsWith('ies')
    ? `${normalizedId.slice(0, -3)}y`
    : normalizedId.endsWith('s')
      ? normalizedId.slice(0, -1)
      : normalizedId;
  return normalizedName.includes(normalizedId) || normalizedName.includes(singularId);
}

function isSectionRendererName(name: string): boolean {
  const normalized = name.toLowerCase();
  return EXPECTED_SECTION_IDS.some(id => rendererNameMatchesSection(name, id))
    && (normalized.includes('render') || normalized.includes('section'));
}

function sectionIdFromRendererName(name: string): ContentSectionId | null {
  return EXPECTED_SECTION_IDS.find(id => rendererNameMatchesSection(name, id)) ?? null;
}

function returnedLeafExpressions(expression: ts.Expression): ts.Expression[] {
  const unwrapped = unwrapExpression(expression);
  if (ts.isConditionalExpression(unwrapped)) {
    return [unwrapped.whenTrue, unwrapped.whenFalse]
      .flatMap(branch => unwrapExpression(branch).kind === ts.SyntaxKind.NullKeyword ? [] : returnedLeafExpressions(branch));
  }
  if (ts.isBinaryExpression(unwrapped) && unwrapped.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return returnedLeafExpressions(unwrapped.right);
  }
  return [unwrapped];
}

function jsxRoot(expression: ts.Expression): ts.JsxOpeningLikeElement | null {
  const unwrapped = unwrapExpression(expression);
  if (ts.isJsxElement(unwrapped)) {
    return unwrapped.openingElement;
  }
  return ts.isJsxSelfClosingElement(unwrapped) ? unwrapped : null;
}

function hasSurfaceMarker(node: ts.JsxOpeningLikeElement, file: ts.SourceFile): boolean {
  return node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute)
    && ['data-public-surface', 'data-public-surfaces'].includes(attribute.name.getText(file)));
}

function isRenderServiceMenuCall(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression);
  return ts.isCallExpression(unwrapped)
    && ts.isIdentifier(unwrapped.expression)
    && unwrapped.expression.text === 'renderServiceMenuContent';
}

function isApprovedBookingStepHeader(
  sectionId: ContentSectionId,
  root: ts.JsxOpeningLikeElement,
  file: ts.SourceFile,
): boolean {
  if (sectionId !== 'salonProfile' || root.tagName.getText(file) !== 'BookingStepHeader') {
    return false;
  }
  return root.attributes.properties.every(attribute => ts.isJsxAttribute(attribute)
    && attribute.name.getText(file) !== 'content'
    && !attribute.getText(file).includes('content.'));
}

function isApprovedServicesAnchorWrapper(
  sectionId: ContentSectionId,
  expression: ts.Expression,
  file: ts.SourceFile,
): boolean {
  const unwrapped = unwrapExpression(expression);
  if (sectionId !== 'serviceMenu' || !ts.isJsxElement(unwrapped)) {
    return false;
  }
  const root = unwrapped.openingElement;
  if (root.tagName.getText(file) !== 'div') {
    return false;
  }
  const attributes = root.attributes.properties;
  if (!attributes.every(ts.isJsxAttribute)) {
    return false;
  }
  const jsxAttributes = attributes.filter(ts.isJsxAttribute);
  const attributeNames = jsxAttributes.map(attribute => attribute.name.getText(file)).sort();
  if (attributeNames.join(',') !== 'className,id,ref') {
    return false;
  }
  const id = jsxAttributes.find(attribute => attribute.name.getText(file) === 'id');
  if (!id || attributeValue(id, file) !== 'services') {
    return false;
  }
  const meaningfulChildren = unwrapped.children.filter(child => !ts.isJsxText(child) || child.text.trim() !== '');
  return meaningfulChildren.length === 1
    && ts.isJsxExpression(meaningfulChildren[0]!)
    && !!meaningfulChildren[0]!.expression
    && isRenderServiceMenuCall(meaningfulChildren[0]!.expression);
}

function isApprovedServiceMenuDeclaration(name: string, initializer: ts.Expression): boolean {
  const unwrapped = unwrapExpression(initializer);
  if (name !== 'renderServiceMenuContent' || !ts.isArrowFunction(unwrapped) || unwrapped.parameters.length !== 1) {
    return false;
  }
  const parameter = unwrapped.parameters[0]!.name;
  if (!ts.isObjectBindingPattern(parameter)) {
    return false;
  }
  const closedProps = parameter.elements.map(element => element.name.getText()).sort();
  if (closedProps.join(',') !== 'showFeaturedCarousel,showPolicyCard,showSocialLinks') {
    return false;
  }
  if (ts.isBlock(unwrapped.body) || !ts.isJsxFragment(unwrapExpression(unwrapped.body))) {
    return false;
  }
  let readsRawContentObject = false;
  const inspectBody = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === 'content') {
      readsRawContentObject = true;
      return;
    }
    if (!readsRawContentObject) {
      ts.forEachChild(node, inspectBody);
    }
  };
  inspectBody(unwrapped.body);
  return !readsRawContentObject;
}

function isApprovedSameSectionFallback(sectionId: ContentSectionId, expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression);
  if (!ts.isBinaryExpression(unwrapped)
    || unwrapped.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken
    || unwrapExpression(unwrapped.right).kind !== ts.SyntaxKind.NullKeyword) {
    return false;
  }
  const fallbackCall = unwrapExpression(unwrapped.left);
  return ts.isCallExpression(fallbackCall)
    && fallbackCall.arguments.length === 0
    && ts.isPropertyAccessExpression(fallbackCall.expression)
    && ts.isIdentifier(fallbackCall.expression.expression)
    && fallbackCall.expression.expression.text === 'quickBookRenderers'
    && fallbackCall.expression.name.text === sectionId;
}

function inspectRendererDefinition(
  sectionId: ContentSectionId,
  node: ts.Node,
  file: ts.SourceFile,
  inspection: RendererInspection,
): void {
  const returnedExpressions = rendererReturnedExpressions(node);
  if (returnedExpressions.length === 0) {
    inspection.violations.push({ kind: 'unclassified-section', text: node.getText(file) });
    return;
  }
  if (hasReturnNull(node) || hasConditionalOmission(node)) {
    inspection.violations.push({ kind: 'independent-renderer-guard', text: node.getText(file) });
  }

  const expressions = returnedExpressions.flatMap(returnedLeafExpressions);
  for (const expression of expressions) {
    if (unwrapExpression(expression).kind === ts.SyntaxKind.NullKeyword) {
      continue;
    }
    const root = jsxRoot(expression);
    if (root && hasSurfaceMarker(root, file)) {
      continue;
    }
    if (root && isApprovedBookingStepHeader(sectionId, root, file)) {
      inspection.approvedRendererSeams.push('salonProfile:BookingStepHeader');
      continue;
    }
    if (sectionId === 'salonProfile' && isApprovedSameSectionFallback(sectionId, expression)) {
      inspection.approvedRendererSeams.push('salonProfile:quickBookRenderer-fallback');
      continue;
    }
    if (sectionId === 'serviceMenu' && isRenderServiceMenuCall(expression)) {
      inspection.approvedRendererSeams.push('serviceMenu:renderServiceMenuContent-call');
      continue;
    }
    if (isApprovedServicesAnchorWrapper(sectionId, expression, file)) {
      inspection.approvedRendererSeams.push('serviceMenu:services-anchor-wrapper');
      continue;
    }
    inspection.violations.push({ kind: 'unclassified-section', text: expression.getText(file) });
  }
}

function inspectPublicRendererDetailed(source: string): RendererInspection {
  const file = ts.createSourceFile('public-renderer.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const inspection: RendererInspection = { violations: [], approvedRendererSeams: [] };
  const inventory = new Set(Object.keys(PUBLIC_SURFACE_INVENTORY));
  const contentIds = new Set<ContentSectionId>(EXPECTED_SECTION_IDS);

  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'hiddenSections') {
      inspection.violations.push({ kind: 'raw-hidden-read', text: node.getText(file) });
    }
    if (ts.isBindingElement(node)
      && (node.name.getText(file) === 'hiddenSections' || node.propertyName?.getText(file) === 'hiddenSections')) {
      inspection.violations.push({ kind: 'raw-hidden-read', text: node.getText(file) });
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'canRender') {
      inspection.violations.push({ kind: 'legacy-can-render', text: node.getText(file) });
    }
    if (ts.isPropertyAssignment(node)
      && contentIds.has(node.name.getText(file).replaceAll(/['"]/g, '') as ContentSectionId)
      && looksLikeRendererDefinition(node.initializer)) {
      const sectionId = node.name.getText(file).replaceAll(/['"]/g, '') as ContentSectionId;
      inspectRendererDefinition(sectionId, node.initializer, file, inspection);
    }
    if (ts.isFunctionDeclaration(node) && node.name && isSectionRendererName(node.name.text)) {
      const sectionId = sectionIdFromRendererName(node.name.text);
      if (sectionId) {
        inspectRendererDefinition(sectionId, node, file, inspection);
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && isSectionRendererName(node.name.text) && node.initializer) {
      if (isApprovedServiceMenuDeclaration(node.name.text, node.initializer)) {
        inspection.approvedRendererSeams.push('serviceMenu:renderServiceMenuContent-declaration');
      } else {
        const sectionId = sectionIdFromRendererName(node.name.text);
        if (sectionId) {
          inspectRendererDefinition(sectionId, node.initializer, file, inspection);
        }
      }
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
      const markers = attributes.filter(attribute =>
        attribute.name.getText(file) === 'data-public-surface'
        || attribute.name.getText(file) === 'data-public-surfaces');
      if (['section', 'nav', 'ul'].includes(node.tagName.getText(file)) && markers.length === 0) {
        inspection.violations.push({ kind: 'unclassified-section', text: node.getText(file) });
      }
      for (const marker of markers) {
        const value = attributeValue(marker, file);
        if (value?.startsWith('{')) {
          inspection.violations.push({ kind: 'unknown-surface', text: value });
        } else if (value) {
          for (const surface of value.split(/\s+/)) {
            if (!inventory.has(surface)) {
              inspection.violations.push({ kind: 'unknown-surface', text: surface });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return inspection;
}

function inspectPublicRenderer(source: string): Violation[] {
  return inspectPublicRendererDetailed(source).violations;
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
      const inspection = inspectPublicRendererDetailed(renderer);
      const inspected = inspection.violations;
      const adapterReads = rendererPath.endsWith('BookServiceClient.tsx')
        ? inspected.filter(violation => violation.kind === 'raw-hidden-read' && violation.text === 'bookingPage?.hiddenSections')
        : [];
      if (rendererPath.endsWith('BookServiceClient.tsx')) {
        expect(adapterReads, 'exactly one raw hidden-state adapter is allowed').toHaveLength(1);
        expect(inspection.approvedRendererSeams.sort(), 'closed-prop/shared renderer seams are pinned exactly').toEqual([
          'salonProfile:BookingStepHeader',
          'salonProfile:quickBookRenderer-fallback',
          'serviceMenu:renderServiceMenuContent-call',
          'serviceMenu:renderServiceMenuContent-declaration',
          'serviceMenu:services-anchor-wrapper',
        ]);
      } else {
        expect(inspection.approvedRendererSeams, `${rendererPath} must not grow an unreviewed renderer exception`).toEqual([]);
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

  it('catches parenthesized, asserted, lowercase, and multi-return renderer bypasses', () => {
    const parenthesized = inspectPublicRenderer(`
      const renderers = { reviews: () => (<div>{content.reviews}</div>) };
    `);
    const asserted = inspectPublicRenderer(`
      const renderers = { reviews: () => ((((<div>{content.reviews}</div>)) as React.ReactNode) satisfies React.ReactNode) };
    `);
    const lowercase = inspectPublicRenderer(`
      const policiesRenderer = () => { if (!content.policy) return null; return <section data-public-surface="policies" />; };
      const reviewsRenderer = () => content.reviews ? <section data-public-surface="reviews" /> : null;
    `);
    const singularLowercase = inspectPublicRenderer(`
      const policyRenderer = () => { if (!content.policy) return null; return <section data-public-surface="policies" />; };
      const reviewRenderer = () => content.reviews ? <section data-public-surface="reviews" /> : null;
    `);
    const wrapped = inspectPublicRenderer(`
      const policiesRenderer = memo(() => { if (!content.policy) return null; return <section data-public-surface="policies" />; });
      const reviewRenderer = React.forwardRef((_props, _ref) => content.reviews ? <section data-public-surface="reviews" /> : null);
      const policySection = withUnknownWrapper(() => <section data-public-surface="policies" />);
    `);
    const multipleReturns = inspectPublicRenderer(`
      const reviewsRenderer = () => {
        if (content.featured) return <section data-public-surface="reviews" />;
        return (<div>{content.reviews}</div>);
      };
    `);

    expect(parenthesized).toContainEqual(expect.objectContaining({ kind: 'unclassified-section' }));
    expect(asserted).toContainEqual(expect.objectContaining({ kind: 'unclassified-section' }));
    expect(lowercase.filter(violation => violation.kind === 'independent-renderer-guard')).toHaveLength(2);
    expect(singularLowercase.filter(violation => violation.kind === 'independent-renderer-guard')).toHaveLength(2);
    expect(wrapped.filter(violation => violation.kind === 'independent-renderer-guard')).toHaveLength(2);
    expect(wrapped).toContainEqual(expect.objectContaining({
      kind: 'unclassified-section',
      text: expect.stringContaining('withUnknownWrapper'),
    }));
    expect(multipleReturns).toContainEqual(expect.objectContaining({ kind: 'unclassified-section' }));
  });

  it('does not confuse nested callback omission with an independent renderer guard', () => {
    const inspected = inspectPublicRenderer(`
      const reviewsRenderer = () => (
        <section data-public-surface="reviews">
          {content.reviews.map(review => review.visible ? <article key={review.id}>{review.text}</article> : null)}
        </section>
      );
    `);

    expect(inspected).toEqual([]);
  });

  it('allows only the audited closed-prop and shared service-menu seams', () => {
    const approved = inspectPublicRendererDetailed(`
      const renderServiceMenuContent = ({ showFeaturedCarousel, showPolicyCard, showSocialLinks }) => (
        <><section data-public-surface="serviceMenu" /></>
      );
      const renderers = {
        salonProfile: () => (<BookingStepHeader salonName="Luster" />),
        serviceMenu: () => renderServiceMenuContent({ showFeaturedCarousel: true, showPolicyCard: true, showSocialLinks: true }),
      };
      const editorial = {
        salonProfile: () => {
          if (!content.hero) return quickBookRenderers.salonProfile?.() ?? null;
          return <section data-public-surface="salonProfile" />;
        },
        serviceMenu: () => (
          <div id="services" ref={servicesAnchorRef} className="shell">
            {renderServiceMenuContent({ showFeaturedCarousel: false, showPolicyCard: false, showSocialLinks: false })}
          </div>
        ),
      };
    `);
    const rejected = inspectPublicRenderer(`
      const wrongSection = { serviceMenu: () => (<BookingStepHeader salonName="Luster" />) };
      const spreadContent = { salonProfile: () => (<BookingStepHeader {...content} />) };
      const rawContent = { salonProfile: () => (<BookingStepHeader content={content} />) };
      const arbitraryCall = { reviews: () => renderReviewsContent() };
      const rawWrapper = {
        serviceMenu: () => (
          <div id="services" ref={servicesAnchorRef} className="shell">{content.raw}</div>
        ),
      };
      const renderServiceMenuContent = ({ showFeaturedCarousel, showPolicyCard, showSocialLinks }) => (
        <>{content.raw}</>
      );
    `);

    expect(approved.violations).toEqual([]);
    expect(approved.approvedRendererSeams.sort()).toEqual([
      'salonProfile:BookingStepHeader',
      'salonProfile:quickBookRenderer-fallback',
      'serviceMenu:renderServiceMenuContent-call',
      'serviceMenu:renderServiceMenuContent-declaration',
      'serviceMenu:services-anchor-wrapper',
    ]);
    expect(rejected.filter(violation => violation.kind === 'unclassified-section').length).toBeGreaterThanOrEqual(6);
  });
});
