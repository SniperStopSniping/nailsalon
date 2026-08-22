import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { SECTION_PRESENTATION_CONTRACT } from './sectionPresentation';
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
  | 'readiness-bypass'
  | 'unclassified-section'
  | 'unknown-surface'
  | 'independent-renderer-guard'
  | 'independent-renderer-root'
  | 'multiple-renderer-registries'
  | 'malformed-renderer-registry'
  | 'independent-layout-fork'
  | 'hero-derived-alt-bypass'
  | 'grouped-service-menu-heading-bypass';
type Violation = { kind: ViolationKind; text: string };
type ApprovedRendererSeam =
  | 'salonProfile:BookingStepHeader'
  | 'featuredServices:marked-fragment'
  | 'serviceMenu:renderServiceMenuContent-declaration'
  | 'serviceMenu:list:renderServiceMenuContent-call'
  | 'serviceMenu:grouped_categories:renderServiceMenuContent-call'
  | 'serviceMenu:list:services-anchor-wrapper'
  | 'serviceMenu:grouped_categories:services-anchor-wrapper';
type AuditedServiceMenuVariant = 'list' | 'grouped_categories';
type RendererInspection = {
  violations: Violation[];
  approvedRendererSeams: ApprovedRendererSeam[];
  canonicalRendererRegistries: number;
};

const EXPECTED_VARIANT_RENDERER_IDS = (Object.keys(SECTION_PRESENTATION_CONTRACT) as (
  keyof typeof SECTION_PRESENTATION_CONTRACT
)[])
  .filter(id =>
    SECTION_REGISTRY[id].classification === 'content'
    && SECTION_PRESENTATION_CONTRACT[id].variants.length > 0);
const EXPECTED_VARIANT_RENDERER_ID_SET = new Set<ContentSectionId>(EXPECTED_VARIANT_RENDERER_IDS);
const BOOKING_STEP_HEADER_ALLOWED_PROPS = new Set([
  'announcement',
  'bookingFlow',
  'className',
  'currentStep',
  'description',
  'isFirstStep',
  'mounted',
  'onBack',
  'salonName',
  'salonNameVariant',
  'title',
]);

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

function hasSectionSurfaceMarker(
  node: ts.JsxOpeningLikeElement,
  sectionId: ContentSectionId,
  file: ts.SourceFile,
): boolean {
  return node.attributes.properties.some((attribute) => {
    if (!ts.isJsxAttribute(attribute)
      || !['data-public-surface', 'data-public-surfaces'].includes(attribute.name.getText(file))) {
      return false;
    }
    const value = attributeValue(attribute, file);
    return value !== null && !value.startsWith('{') && value.split(/\s+/).includes(sectionId);
  });
}

function descendantSectionSurfaceMarkers(
  node: ts.Node,
  sectionId: ContentSectionId,
  file: ts.SourceFile,
): ts.JsxOpeningLikeElement[] {
  const markers: ts.JsxOpeningLikeElement[] = [];
  const visit = (child: ts.Node) => {
    if ((ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child))
      && hasSectionSurfaceMarker(child, sectionId, file)) {
      markers.push(child);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return markers;
}

function isApprovedMarkedFragment(
  sectionId: ContentSectionId,
  expression: ts.Expression,
  file: ts.SourceFile,
): boolean {
  const unwrapped = unwrapExpression(expression);
  return sectionId === 'featuredServices'
    && ts.isJsxFragment(unwrapped)
    && descendantSectionSurfaceMarkers(unwrapped, sectionId, file).length === 1;
}

function isRenderSlotCall(expression: ts.Expression, sectionId: ContentSectionId): boolean {
  const unwrapped = unwrapExpression(expression);
  return ts.isCallExpression(unwrapped)
    && ts.isIdentifier(unwrapped.expression)
    && unwrapped.expression.text === 'renderSlot'
    && unwrapped.arguments.length === 1
    && ts.isStringLiteral(unwrapped.arguments[0]!)
    && unwrapped.arguments[0]!.text === sectionId;
}

function renderServiceMenuCallVariant(expression: ts.Expression): AuditedServiceMenuVariant | null {
  const unwrapped = unwrapExpression(expression);
  if (!ts.isCallExpression(unwrapped)
    || !ts.isIdentifier(unwrapped.expression)
    || unwrapped.expression.text !== 'renderServiceMenuContent'
    || unwrapped.arguments.length !== 1) {
    return null;
  }
  const argument = unwrapExpression(unwrapped.arguments[0]!);
  if (!ts.isObjectLiteralExpression(argument)) {
    return null;
  }
  const expectedSlots = new Map<string, ContentSectionId>([
    ['featuredServicesSlot', 'featuredServices'],
    ['policiesSlot', 'policies'],
    ['socialLinksSlot', 'socialLinks'],
  ]);
  if (argument.properties.length !== expectedSlots.size + 1) {
    return null;
  }
  let menuVariant: AuditedServiceMenuVariant | null = null;
  const seenProperties = new Set<string>();
  const valid = argument.properties.every((property) => {
    if (!ts.isPropertyAssignment(property)) {
      return false;
    }
    const propertyName = property.name.getText().replaceAll(/['"]/g, '');
    if (seenProperties.has(propertyName)) {
      return false;
    }
    seenProperties.add(propertyName);
    if (propertyName === 'menuVariant') {
      const value = unwrapExpression(property.initializer);
      if (!ts.isStringLiteral(value) || !['list', 'grouped_categories'].includes(value.text)) {
        return false;
      }
      menuVariant = value.text as AuditedServiceMenuVariant;
      return true;
    }
    const sectionId = expectedSlots.get(propertyName);
    return sectionId !== undefined && isRenderSlotCall(property.initializer, sectionId);
  });
  return valid
    && seenProperties.has('featuredServicesSlot')
    && seenProperties.has('policiesSlot')
    && seenProperties.has('socialLinksSlot')
    ? menuVariant
    : null;
}

function isRenderServiceMenuCall(
  expression: ts.Expression,
  expectedVariant?: AuditedServiceMenuVariant,
): boolean {
  const actualVariant = renderServiceMenuCallVariant(expression);
  return actualVariant !== null && (expectedVariant === undefined || actualVariant === expectedVariant);
}

function isApprovedBookingStepHeader(
  sectionId: ContentSectionId,
  root: ts.JsxOpeningLikeElement,
  file: ts.SourceFile,
): boolean {
  if (sectionId !== 'salonProfile' || root.tagName.getText(file) !== 'BookingStepHeader') {
    return false;
  }
  let hasSalonName = false;
  return root.attributes.properties.every((attribute) => {
    if (!ts.isJsxAttribute(attribute)) {
      return false;
    }
    const name = attribute.name.getText(file);
    hasSalonName ||= name === 'salonName';
    return BOOKING_STEP_HEADER_ALLOWED_PROPS.has(name)
      && name !== 'content'
      && !attribute.getText(file).includes('content.');
  }) && hasSalonName;
}

function isApprovedServicesAnchorWrapper(
  sectionId: ContentSectionId,
  expression: ts.Expression,
  file: ts.SourceFile,
  sharedLeafBindings: ReadonlySet<string>,
  expectedVariant: AuditedServiceMenuVariant | undefined,
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
    && (
      isRenderServiceMenuCall(meaningfulChildren[0]!.expression, expectedVariant)
      || (ts.isIdentifier(unwrapExpression(meaningfulChildren[0]!.expression!))
        && sharedLeafBindings.has(unwrapExpression(meaningfulChildren[0]!.expression!).getText(file)))
    );
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
  if (closedProps.join(',') !== 'featuredServicesSlot,menuVariant,policiesSlot,socialLinksSlot') {
    return false;
  }
  if (ts.isBlock(unwrapped.body) || !ts.isJsxFragment(unwrapExpression(unwrapped.body))) {
    return false;
  }
  let readsRawContentObject = false;
  let readsMenuVariant = false;
  const inspectBody = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === 'content') {
      readsRawContentObject = true;
      return;
    }
    if (ts.isIdentifier(node) && node.text === 'menuVariant') {
      readsMenuVariant = true;
    }
    if (!readsRawContentObject) {
      ts.forEachChild(node, inspectBody);
    }
  };
  inspectBody(unwrapped.body);
  return !readsRawContentObject && readsMenuVariant;
}

function inspectRendererDefinition(
  sectionId: ContentSectionId,
  node: ts.Node,
  file: ts.SourceFile,
  inspection: RendererInspection,
  variantId?: string,
): void {
  const returnedExpressions = rendererReturnedExpressions(node);
  if (returnedExpressions.length === 0) {
    inspection.violations.push({ kind: 'unclassified-section', text: node.getText(file) });
    return;
  }
  if (hasReturnNull(node) || hasConditionalOmission(node)) {
    inspection.violations.push({ kind: 'independent-renderer-guard', text: node.getText(file) });
  }

  const sharedLeafBindings = new Set<string>();
  const inspectBindings = (child: ts.Node) => {
    if (child !== node && isFunctionBoundary(child)) {
      return;
    }
    if (ts.isVariableDeclaration(child)
      && ts.isIdentifier(child.name)
      && child.initializer
      && isRenderServiceMenuCall(
        child.initializer,
        variantId === 'list' || variantId === 'grouped_categories' ? variantId : undefined,
      )) {
      sharedLeafBindings.add(child.name.text);
    }
    ts.forEachChild(child, inspectBindings);
  };
  inspectBindings(rendererDefinitionBody(node));
  const auditedMenuVariant = variantId === 'list' || variantId === 'grouped_categories'
    ? variantId
    : null;
  if (sectionId === 'serviceMenu' && auditedMenuVariant && sharedLeafBindings.size === 1) {
    inspection.approvedRendererSeams.push(`serviceMenu:${auditedMenuVariant}:renderServiceMenuContent-call`);
  } else if (sharedLeafBindings.size > 0) {
    inspection.violations.push({ kind: 'unclassified-section', text: node.getText(file) });
  }

  const expressions = returnedExpressions.flatMap(returnedLeafExpressions);
  for (const expression of expressions) {
    if (unwrapExpression(expression).kind === ts.SyntaxKind.NullKeyword) {
      continue;
    }
    const root = jsxRoot(expression);
    if (root && hasSectionSurfaceMarker(root, sectionId, file)) {
      continue;
    }
    if (isApprovedMarkedFragment(sectionId, expression, file)) {
      inspection.approvedRendererSeams.push('featuredServices:marked-fragment');
      continue;
    }
    if (root && isApprovedBookingStepHeader(sectionId, root, file)) {
      inspection.approvedRendererSeams.push('salonProfile:BookingStepHeader');
      continue;
    }
    if (ts.isIdentifier(unwrapExpression(expression))
      && sharedLeafBindings.has(unwrapExpression(expression).getText(file))) {
      continue;
    }
    if (sectionId === 'serviceMenu' && isRenderServiceMenuCall(expression)) {
      if (auditedMenuVariant && isRenderServiceMenuCall(expression, auditedMenuVariant)) {
        inspection.approvedRendererSeams.push(`serviceMenu:${auditedMenuVariant}:renderServiceMenuContent-call`);
        continue;
      }
    }
    if (isApprovedServicesAnchorWrapper(
      sectionId,
      expression,
      file,
      sharedLeafBindings,
      auditedMenuVariant ?? undefined,
    )) {
      if (auditedMenuVariant) {
        inspection.approvedRendererSeams.push(`serviceMenu:${auditedMenuVariant}:services-anchor-wrapper`);
        continue;
      }
    }
    inspection.violations.push({ kind: 'unclassified-section', text: expression.getText(file) });
  }
}

function propertyNameText(name: ts.PropertyName, file: ts.SourceFile): string {
  return name.getText(file).replaceAll(/['"]/g, '');
}

function typeNodeReferences(type: ts.TypeNode | undefined, expectedName: string): boolean {
  if (!type) {
    return false;
  }
  let found = false;
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === expectedName) {
      found = true;
      return;
    }
    if (!found) {
      ts.forEachChild(node, visit);
    }
  };
  visit(type);
  return found;
}

function expressionSatisfiesType(expression: ts.Expression, expectedName: string): boolean {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current)) {
    current = current.expression;
  }
  return ts.isSatisfiesExpression(current) && typeNodeReferences(current.type, expectedName);
}

function rendererRegistryObject(node: ts.VariableDeclaration): ts.ObjectLiteralExpression | null {
  if (!node.initializer) {
    return null;
  }
  const initializer = unwrapExpression(node.initializer);
  return ts.isObjectLiteralExpression(initializer) ? initializer : null;
}

function isTypedSectionVariantRendererRegistry(node: ts.VariableDeclaration): boolean {
  return typeNodeReferences(node.type, 'SectionVariantRenderers')
    || (!!node.initializer && expressionSatisfiesType(node.initializer, 'SectionVariantRenderers'));
}

function looksLikeRendererRegistryObject(object: ts.ObjectLiteralExpression, file: ts.SourceFile): boolean {
  return object.properties.some((property) => {
    if (!ts.isPropertyAssignment(property)) {
      return false;
    }
    const sectionId = propertyNameText(property.name, file) as ContentSectionId;
    if (!EXPECTED_VARIANT_RENDERER_ID_SET.has(sectionId)) {
      return false;
    }
    const initializer = unwrapExpression(property.initializer);
    if (looksLikeRendererDefinition(initializer)) {
      return true;
    }
    return ts.isObjectLiteralExpression(initializer)
      && initializer.properties.some(variant => ts.isPropertyAssignment(variant)
        && looksLikeRendererDefinition(variant.initializer));
  });
}

function heroRendererUsesCanonicalDerivedAlt(node: ts.Node, file: ts.SourceFile): boolean {
  let imageCount = 0;
  let canonicalAltCount = 0;
  const rendererNode = rendererDefinitionBody(node);
  const visit = (child: ts.Node) => {
    if (child !== rendererNode && isFunctionBoundary(child)) {
      return;
    }
    if ((ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child))
      && child.tagName.getText(file) === 'img') {
      imageCount += 1;
      const alt = child.attributes.properties.find(attribute =>
        ts.isJsxAttribute(attribute) && attribute.name.getText(file) === 'alt');
      if (alt && ts.isJsxAttribute(alt)
        && alt.initializer
        && ts.isJsxExpression(alt.initializer)
        && alt.initializer.expression) {
        const expression = unwrapExpression(alt.initializer.expression);
        if (ts.isCallExpression(expression)
          && ts.isIdentifier(expression.expression)
          && expression.expression.text === 'deriveSalonProfileHeroAlt'
          && expression.arguments.length === 1) {
          canonicalAltCount += 1;
        }
      }
    }
    ts.forEachChild(child, visit);
  };
  visit(rendererNode);
  return imageCount > 0 && canonicalAltCount === imageCount;
}

function comparisonResultForGroupedMenu(expression: ts.Expression): boolean | null {
  const value = unwrapExpression(expression);
  if (!ts.isBinaryExpression(value)) {
    return null;
  }
  const left = unwrapExpression(value.left);
  const right = unwrapExpression(value.right);
  const menuVariant = ts.isIdentifier(left) && left.text === 'menuVariant'
    ? right
    : ts.isIdentifier(right) && right.text === 'menuVariant'
      ? left
      : null;
  if (!menuVariant || !ts.isStringLiteral(menuVariant)) {
    return null;
  }
  if (menuVariant.text !== 'list' && menuVariant.text !== 'grouped_categories') {
    return null;
  }
  const equal = value.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
    || value.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken;
  const unequal = value.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
    || value.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken;
  if (!equal && !unequal) {
    return null;
  }
  const comparisonMatchesGrouped = menuVariant.text === 'grouped_categories';
  return equal ? comparisonMatchesGrouped : !comparisonMatchesGrouped;
}

function isInsideGroupedMenuBranch(node: ts.Node, boundary: ts.Node): boolean {
  let child = node;
  while (child !== boundary && child.parent) {
    const parent = child.parent;
    if (ts.isConditionalExpression(parent)) {
      const groupedResult = comparisonResultForGroupedMenu(parent.condition);
      if (groupedResult !== null) {
        return groupedResult ? child === parent.whenTrue : child === parent.whenFalse;
      }
    }
    if (ts.isIfStatement(parent)) {
      const groupedResult = comparisonResultForGroupedMenu(parent.expression);
      if (groupedResult !== null) {
        return groupedResult ? child === parent.thenStatement : child === parent.elseStatement;
      }
    }
    if (ts.isBinaryExpression(parent)
      && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      && comparisonResultForGroupedMenu(parent.left) === true
      && child === parent.right) {
      return true;
    }
    child = parent;
  }
  return false;
}

function normalizedJsxText(node: ts.Node): string {
  const text: string[] = [];
  const visit = (child: ts.Node) => {
    if (ts.isJsxText(child)) {
      text.push(child.text);
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return text.join(' ').replaceAll(/\s+/g, ' ').trim();
}

function jsxAttribute(
  node: ts.JsxOpeningLikeElement,
  name: string,
): ts.JsxAttribute | null {
  return node.attributes.properties.find(attribute =>
    ts.isJsxAttribute(attribute) && attribute.name.getText() === name) as ts.JsxAttribute | undefined ?? null;
}

function hasMapCallbackAncestor(node: ts.Node, boundary: ts.Node): boolean {
  let child = node;
  while (child !== boundary && child.parent) {
    const parent = child.parent;
    if ((ts.isArrowFunction(parent) || ts.isFunctionExpression(parent))
      && parent.parent
      && ts.isCallExpression(parent.parent)
      && ts.isPropertyAccessExpression(parent.parent.expression)
      && parent.parent.expression.name.text === 'map') {
      return true;
    }
    child = parent;
  }
  return false;
}

function hasGroupedMenuMapCallbackAncestor(node: ts.Node, boundary: ts.Node): boolean {
  let child = node;
  while (child !== boundary && child.parent) {
    const parent = child.parent;
    if ((ts.isArrowFunction(parent) || ts.isFunctionExpression(parent))
      && parent.parent
      && ts.isCallExpression(parent.parent)
      && ts.isPropertyAccessExpression(parent.parent.expression)
      && parent.parent.expression.name.text === 'map') {
      const collection = unwrapExpression(parent.parent.expression.expression);
      if (!ts.isConditionalExpression(collection)) {
        return false;
      }
      const groupedResult = comparisonResultForGroupedMenu(collection.condition);
      return groupedResult !== null;
    }
    child = parent;
  }
  return false;
}

function groupedHeadingOwnsLabelledGroup(
  heading: ts.JsxElement,
  boundary: ts.Node,
  file: ts.SourceFile,
): boolean {
  const headingId = jsxAttribute(heading.openingElement, 'id');
  const idValue = headingId ? attributeValue(headingId, file) : null;
  if (!idValue || !hasMapCallbackAncestor(heading, boundary)) {
    return false;
  }
  let child: ts.Node = heading;
  while (child !== boundary && child.parent) {
    const parent = child.parent;
    if (ts.isJsxElement(parent)) {
      const labelledBy = jsxAttribute(parent.openingElement, 'aria-labelledby');
      if (labelledBy && attributeValue(labelledBy, file) === idValue) {
        return true;
      }
    }
    child = parent;
  }
  return false;
}

function groupedServiceMenuUsesSemanticHeadings(file: ts.SourceFile): boolean {
  const findDeclaration = (node: ts.Node): ts.ArrowFunction | undefined => {
    if (ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === 'renderServiceMenuContent'
      && node.initializer) {
      const initializer = unwrapExpression(node.initializer);
      if (ts.isArrowFunction(initializer)) {
        return initializer;
      }
    }
    return ts.forEachChild(node, findDeclaration);
  };
  const declaration = findDeclaration(file);
  if (!declaration) {
    return false;
  }

  const groupedH2s: ts.JsxElement[] = [];
  const groupedH3s: ts.JsxElement[] = [];
  const inspect = (node: ts.Node) => {
    if (ts.isJsxElement(node)
      && (isInsideGroupedMenuBranch(node, declaration)
        || hasGroupedMenuMapCallbackAncestor(node, declaration))) {
      const tagName = node.openingElement.tagName.getText(file);
      if (tagName === 'h2') {
        groupedH2s.push(node);
      } else if (tagName === 'h3') {
        groupedH3s.push(node);
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(declaration.body);

  const servicesHeading = groupedH2s.find(heading => normalizedJsxText(heading) === 'Services');
  return servicesHeading !== undefined
    && groupedH3s.length > 0
    && groupedH3s.every(heading => servicesHeading.getStart(file) < heading.getStart(file))
    && groupedH3s.every(heading => groupedHeadingOwnsLabelledGroup(heading, declaration, file));
}

function inspectCanonicalRendererRegistry(
  object: ts.ObjectLiteralExpression,
  file: ts.SourceFile,
  inspection: RendererInspection,
): void {
  const sectionProperties = object.properties.filter(ts.isPropertyAssignment);
  const actualSections = sectionProperties.map(property => propertyNameText(property.name, file)).sort();
  const expectedSections = [...EXPECTED_VARIANT_RENDERER_IDS].sort();
  if (actualSections.join(',') !== expectedSections.join(',')) {
    inspection.violations.push({
      kind: 'malformed-renderer-registry',
      text: `expected ${expectedSections.join(',')}; received ${actualSections.join(',')}`,
    });
  }

  for (const sectionProperty of sectionProperties) {
    const sectionId = propertyNameText(sectionProperty.name, file) as ContentSectionId;
    if (!EXPECTED_VARIANT_RENDERER_ID_SET.has(sectionId)) {
      inspection.violations.push({ kind: 'malformed-renderer-registry', text: sectionProperty.getText(file) });
      continue;
    }
    const variants = unwrapExpression(sectionProperty.initializer);
    if (!ts.isObjectLiteralExpression(variants)) {
      inspection.violations.push({ kind: 'malformed-renderer-registry', text: sectionProperty.getText(file) });
      continue;
    }
    const variantProperties = variants.properties.filter(ts.isPropertyAssignment);
    const actualVariants = variantProperties.map(property => propertyNameText(property.name, file)).sort();
    const contract = SECTION_PRESENTATION_CONTRACT[sectionId as keyof typeof SECTION_PRESENTATION_CONTRACT];
    const expectedVariants = [...contract.variants].sort();
    if (actualVariants.join(',') !== expectedVariants.join(',')) {
      inspection.violations.push({
        kind: 'malformed-renderer-registry',
        text: `${sectionId}: expected ${expectedVariants.join(',')}; received ${actualVariants.join(',')}`,
      });
    }
    for (const variantProperty of variantProperties) {
      if (!looksLikeRendererDefinition(variantProperty.initializer)) {
        inspection.violations.push({ kind: 'malformed-renderer-registry', text: variantProperty.getText(file) });
        continue;
      }
      const variantId = propertyNameText(variantProperty.name, file);
      if (sectionId === 'salonProfile'
        && variantId === 'hero_image'
        && !heroRendererUsesCanonicalDerivedAlt(variantProperty.initializer, file)) {
        inspection.violations.push({ kind: 'hero-derived-alt-bypass', text: variantProperty.getText(file) });
      }
      if (sectionId === 'serviceMenu'
        && variantId === 'grouped_categories'
        && !groupedServiceMenuUsesSemanticHeadings(file)) {
        inspection.violations.push({
          kind: 'grouped-service-menu-heading-bypass',
          text: variantProperty.getText(file),
        });
      }
      inspectRendererDefinition(sectionId, variantProperty.initializer, file, inspection, variantId);
    }
  }
}

function containsPropertyRead(node: ts.Node, propertyName: string): boolean {
  let found = false;
  const visit = (child: ts.Node) => {
    if (ts.isPropertyAccessExpression(child) && child.name.text === propertyName) {
      found = true;
      return;
    }
    if (!found) {
      ts.forEachChild(child, visit);
    }
  };
  visit(node);
  return found;
}

function isSectionPresentationResolverCall(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression);
  return ts.isCallExpression(unwrapped)
    && ts.isIdentifier(unwrapped.expression)
    && unwrapped.expression.text === 'resolveSectionPresentation';
}

function referencesIdentifier(node: ts.Node, identifiers: ReadonlySet<string>): boolean {
  let found = false;
  const visit = (child: ts.Node) => {
    if (ts.isIdentifier(child) && identifiers.has(child.text)) {
      found = true;
      return;
    }
    if (!found) {
      ts.forEachChild(child, visit);
    }
  };
  visit(node);
  return found;
}

function collectRawLayoutAliases(file: ts.SourceFile): Set<string> {
  const aliases = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node)
        && ts.isIdentifier(node.name)
        && node.initializer
        && !isSectionPresentationResolverCall(node.initializer)
        && (containsPropertyRead(node.initializer, 'layout') || referencesIdentifier(node.initializer, aliases))
        && !aliases.has(node.name.text)) {
        aliases.add(node.name.text);
        changed = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return aliases;
}

function referencesRawLayout(node: ts.Node, aliases: ReadonlySet<string>): boolean {
  let found = false;
  const visit = (child: ts.Node) => {
    if ((ts.isPropertyAccessExpression(child) && child.name.text === 'layout')
      || (ts.isIdentifier(child) && aliases.has(child.text))) {
      found = true;
      return;
    }
    if (!found) {
      ts.forEachChild(child, visit);
    }
  };
  visit(node);
  return found;
}

function stringLiteralSectionId(node: ts.Expression | undefined): ContentSectionId | null {
  const value = node ? unwrapExpression(node) : null;
  return value && ts.isStringLiteral(value) && EXPECTED_SECTION_IDS.includes(value.text as ContentSectionId)
    ? value.text as ContentSectionId
    : null;
}

function inspectPublicRendererDetailed(source: string): RendererInspection {
  const file = ts.createSourceFile('public-renderer.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const inspection: RendererInspection = { violations: [], approvedRendererSeams: [], canonicalRendererRegistries: 0 };
  const inventory = new Set(Object.keys(PUBLIC_SURFACE_INVENTORY));
  const contentIds = new Set<ContentSectionId>(EXPECTED_SECTION_IDS);
  const rawLayoutAliases = collectRawLayoutAliases(file);

  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node)) {
      const registryObject = rendererRegistryObject(node);
      if (registryObject && isTypedSectionVariantRendererRegistry(node)) {
        inspection.canonicalRendererRegistries += 1;
        inspectCanonicalRendererRegistry(registryObject, file, inspection);
      } else if (registryObject && looksLikeRendererRegistryObject(registryObject, file)) {
        inspection.violations.push({ kind: 'independent-renderer-root', text: node.getText(file) });
      }
    }
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
    if (ts.isPropertyAccessExpression(node)
      && ['publicOutcome', 'readiness', 'resolveReadiness'].includes(node.name.text)) {
      inspection.violations.push({ kind: 'readiness-bypass', text: node.getText(file) });
    }
    if (ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'shouldRenderSection') {
      const sectionId = stringLiteralSectionId(node.arguments[1]);
      if (sectionId && sectionId !== 'announcement' && sectionId !== 'bookingFacts') {
        inspection.violations.push({ kind: 'readiness-bypass', text: node.getText(file) });
      }
    }
    if ((ts.isIfStatement(node) && referencesRawLayout(node.expression, rawLayoutAliases))
      || (ts.isConditionalExpression(node) && referencesRawLayout(node.condition, rawLayoutAliases))
      || (ts.isSwitchStatement(node) && referencesRawLayout(node.expression, rawLayoutAliases))
      || (ts.isElementAccessExpression(node) && referencesRawLayout(node.argumentExpression, rawLayoutAliases))) {
      inspection.violations.push({ kind: 'independent-layout-fork', text: node.getText(file) });
    }
    if (ts.isBinaryExpression(node)
      && [
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
      ].includes(node.operatorToken.kind)
      && referencesRawLayout(node, rawLayoutAliases)) {
      inspection.violations.push({ kind: 'independent-layout-fork', text: node.getText(file) });
    }
    if (ts.isPropertyAssignment(node)
      && contentIds.has(node.name.getText(file).replaceAll(/['"]/g, '') as ContentSectionId)
      && looksLikeRendererDefinition(node.initializer)) {
      const sectionId = node.name.getText(file).replaceAll(/['"]/g, '') as ContentSectionId;
      inspection.violations.push({ kind: 'independent-renderer-root', text: node.getText(file) });
      inspectRendererDefinition(sectionId, node.initializer, file, inspection);
    }
    if (ts.isFunctionDeclaration(node) && node.name && isSectionRendererName(node.name.text)) {
      const sectionId = sectionIdFromRendererName(node.name.text);
      if (sectionId) {
        inspection.violations.push({ kind: 'independent-renderer-root', text: node.getText(file) });
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
          inspection.violations.push({ kind: 'independent-renderer-root', text: node.getText(file) });
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
  if (inspection.canonicalRendererRegistries > 1) {
    inspection.violations.push({
      kind: 'multiple-renderer-registries',
      text: `${inspection.canonicalRendererRegistries} SectionVariantRenderers registries`,
    });
  }
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

function canonicalRegistryFixture(name = 'sectionRenderers'): string {
  return `
    const renderServiceMenuContent = ({ featuredServicesSlot, menuVariant, policiesSlot, socialLinksSlot }) => (
      <>
        {menuVariant === 'grouped_categories'
          ? (
              <div data-public-surface="serviceMenu">
                <h2>Services</h2>
                {groups.map(group => (
                  <div key={group.id} aria-labelledby={\`service-group-\${group.id}\`}>
                    <h3 id={\`service-group-\${group.id}\`}>{group.label}</h3>
                  </div>
                ))}
              </div>
            )
          : <div data-public-surface="serviceMenu" />}
        {featuredServicesSlot}
        {policiesSlot}
        {socialLinksSlot}
      </>
    );
    const ${name}: SectionVariantRenderers = {
      salonProfile: {
        compact: () => <section data-public-surface="salonProfile" />,
        hero_image: () => <section data-public-surface="salonProfile"><img alt={deriveSalonProfileHeroAlt(content.identity)} /></section>,
      },
      technicianProfile: {
        full: () => <section data-public-surface="technicianProfile" />,
        cards: () => <section data-public-surface="technicianProfile" />,
      },
      featuredServices: {
        carousel: () => <div data-public-surface="featuredServices" />,
        signature: () => <section data-public-surface="featuredServices" />,
      },
      serviceMenu: {
        list: ({ renderSlot }) => renderServiceMenuContent({
          featuredServicesSlot: renderSlot('featuredServices'),
          menuVariant: 'list',
          policiesSlot: renderSlot('policies'),
          socialLinksSlot: renderSlot('socialLinks'),
        }),
        grouped_categories: ({ renderSlot }) => renderServiceMenuContent({
          featuredServicesSlot: renderSlot('featuredServices'),
          menuVariant: 'grouped_categories',
          policiesSlot: renderSlot('policies'),
          socialLinksSlot: renderSlot('socialLinks'),
        }),
      },
      hoursLocation: {
        full: () => <section data-public-surface="hoursLocation" />,
        location_cards: () => <section data-public-surface="hoursLocation" />,
      },
      policies: {
        card: () => <section data-public-surface="policies" />,
        inline: () => <section data-public-surface="policies" />,
      },
      socialLinks: {
        icons: () => <nav data-public-surface="socialLinks" />,
        labeled: () => <nav data-public-surface="socialLinks" />,
      },
    };
  `;
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
    let canonicalRendererRegistries = 0;

    expect(files.length).toBeGreaterThan(10);

    for (const rendererPath of files) {
      const renderer = fs.readFileSync(rendererPath, 'utf8');
      const inspection = inspectPublicRendererDetailed(renderer);
      const inspected = inspection.violations;
      canonicalRendererRegistries += inspection.canonicalRendererRegistries;
      const ownsCanonicalRegistry = inspection.canonicalRendererRegistries === 1;
      const adapterReads = ownsCanonicalRegistry
        ? inspected.filter(violation => violation.kind === 'raw-hidden-read')
        : [];
      if (ownsCanonicalRegistry) {
        expect(adapterReads, 'exactly one raw hidden-state adapter is allowed').toHaveLength(1);
        expect(inspection.approvedRendererSeams.sort(), 'closed-prop/shared renderer seams are pinned exactly').toEqual([
          'featuredServices:marked-fragment',
          'salonProfile:BookingStepHeader',
          'serviceMenu:grouped_categories:renderServiceMenuContent-call',
          'serviceMenu:grouped_categories:services-anchor-wrapper',
          'serviceMenu:list:renderServiceMenuContent-call',
          'serviceMenu:list:services-anchor-wrapper',
          'serviceMenu:renderServiceMenuContent-declaration',
        ]);
      } else {
        expect(inspection.approvedRendererSeams, `${rendererPath} must not grow an unreviewed renderer exception`).toEqual([]);
      }
      const violations = inspected.filter(violation => !adapterReads.includes(violation));

      expect(violations, rendererPath).toEqual([]);
    }

    expect(canonicalRendererRegistries, 'exactly one typed public section renderer registry exists').toBe(1);
  });

  it('proves the one-registry rule against typed and independently named mutations', () => {
    const oneRegistry = inspectPublicRendererDetailed(canonicalRegistryFixture());
    const twoRegistries = inspectPublicRendererDetailed(
      canonicalRegistryFixture('primaryRegistry') + canonicalRegistryFixture('secondRegistry'),
    );
    const independentFlatRenderer = inspectPublicRendererDetailed(`
      const luxuryRenderer = {
        salonProfile: () => <section data-public-surface="salonProfile" />,
      };
    `);

    expect(oneRegistry.canonicalRendererRegistries).toBe(1);
    expect(oneRegistry.violations).toEqual([]);
    expect(twoRegistries.canonicalRendererRegistries).toBe(2);
    expect(twoRegistries.violations).toContainEqual(expect.objectContaining({
      kind: 'multiple-renderer-registries',
    }));
    expect(independentFlatRenderer.violations).toContainEqual(expect.objectContaining({
      kind: 'independent-renderer-root',
    }));
  });

  it('binds the activated hero-image alt obligation to the canonical renderer helper', () => {
    const canonical = canonicalRegistryFixture();
    const arbitraryAlt = canonical.replace(
      'alt={deriveSalonProfileHeroAlt(content.identity)}',
      'alt="Salon hero"',
    );

    expect(arbitraryAlt).not.toBe(canonical);
    expect(inspectPublicRenderer(canonical)).not.toContainEqual(expect.objectContaining({
      kind: 'hero-derived-alt-bypass',
    }));
    expect(inspectPublicRenderer(arbitraryAlt)).toContainEqual(expect.objectContaining({
      kind: 'hero-derived-alt-bypass',
    }));
  });

  it('binds grouped service categories to real labelled semantic heading groups', () => {
    const canonical = canonicalRegistryFixture();
    const genericCategoryLabel = canonical
      .replace('<h3 id=', '<div id=')
      .replace('</h3>', '</div>');

    expect(genericCategoryLabel).not.toBe(canonical);
    expect(inspectPublicRenderer(canonical)).not.toContainEqual(expect.objectContaining({
      kind: 'grouped-service-menu-heading-bypass',
    }));
    expect(inspectPublicRenderer(genericCategoryLabel)).toContainEqual(expect.objectContaining({
      kind: 'grouped-service-menu-heading-bypass',
    }));
  });

  it('pins service-menu presentation literals to their matching registry arms', () => {
    const canonical = canonicalRegistryFixture();
    const mismatchedListArm = canonical.replace('menuVariant: \'list\'', 'menuVariant: \'grouped_categories\'');
    const dynamicListArm = canonical.replace('menuVariant: \'list\'', 'menuVariant');

    expect(mismatchedListArm).not.toBe(canonical);
    expect(dynamicListArm).not.toBe(canonical);
    expect(inspectPublicRenderer(canonical)).toEqual([]);
    expect(inspectPublicRenderer(mismatchedListArm)).toContainEqual(expect.objectContaining({
      kind: 'unclassified-section',
    }));
    expect(inspectPublicRenderer(dynamicListArm)).toContainEqual(expect.objectContaining({
      kind: 'unclassified-section',
    }));
  });

  it('allows one raw layout adapter but catches layout forks and readiness bypasses', () => {
    const adapter = inspectPublicRenderer(`
      const layout = bookingPage?.layout ?? 'quick_book';
      const presentation = resolveSectionPresentation({ layout, sectionVariants, content });
    `);
    const mutated = inspectPublicRenderer(`
      const layout = bookingPage?.layout ?? 'quick_book';
      const layoutAlias = layout;
      const renderer = layoutAlias === 'editorial' ? editorialRenderers : quickBookRenderers;
      const direct = bookingPage.layout === 'quick_book' ? compact : luxury;
      const localReadiness = sectionPlan.decisions.policies.publicOutcome === 'render';
      const localResolver = SECTION_REGISTRY.hoursLocation.resolveReadiness(input);
      const localGuard = shouldRenderSection(sectionPlan, 'featuredServices');
    `);

    expect(adapter.filter(violation => violation.kind === 'independent-layout-fork')).toEqual([]);
    expect(mutated).toContainEqual(expect.objectContaining({ kind: 'independent-layout-fork' }));
    expect(mutated.filter(violation => violation.kind === 'readiness-bypass').length).toBeGreaterThanOrEqual(3);
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
      'independent-renderer-root',
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

    expect(inspected.filter(violation => violation.kind === 'independent-renderer-guard')).toEqual([]);
    expect(inspected).toContainEqual(expect.objectContaining({ kind: 'independent-renderer-root' }));
  });

  it('allows only the audited closed-prop and shared service-menu seams', () => {
    const approved = inspectPublicRendererDetailed(`
      const renderServiceMenuContent = ({ featuredServicesSlot, menuVariant, policiesSlot, socialLinksSlot }) => (
        <>
          {menuVariant === 'grouped_categories'
            ? (
                <div data-public-surface="serviceMenu">
                  <h2>Services</h2>
                  {groups.map(group => (
                    <div key={group.id} aria-labelledby={\`service-group-\${group.id}\`}>
                      <h3 id={\`service-group-\${group.id}\`}>{group.label}</h3>
                    </div>
                  ))}
                </div>
              )
            : <div data-public-surface="serviceMenu" />}
          {featuredServicesSlot}
          {policiesSlot}
          {socialLinksSlot}
        </>
      );
      const renderers: SectionVariantRenderers = {
        salonProfile: {
          compact: () => <BookingStepHeader salonName="Luster" mounted={true} title="Book" bookingFlow={flow} currentStep="service" isFirstStep={true} />,
          hero_image: () => <section data-public-surface="salonProfile"><img alt={deriveSalonProfileHeroAlt(content.identity)} /></section>,
        },
        technicianProfile: {
          full: () => <section data-public-surface="technicianProfile" />,
          cards: () => <section data-public-surface="technicianProfile" />,
        },
        featuredServices: {
          carousel: () => <>{!isSearching && <div data-public-surface="featuredServices" />}</>,
          signature: () => <section data-public-surface="featuredServices" />,
        },
        serviceMenu: {
          list: ({ renderSlot }) => {
            const serviceMenu = renderServiceMenuContent({
              featuredServicesSlot: renderSlot('featuredServices'),
              menuVariant: 'list',
              policiesSlot: renderSlot('policies'),
              socialLinksSlot: renderSlot('socialLinks'),
            });
            return sectionPresentation.serviceMenuFrame === 'services-anchor'
              ? <div id="services" ref={servicesAnchorRef} className="shell">{serviceMenu}</div>
              : serviceMenu;
          },
          grouped_categories: ({ renderSlot }) => {
            const serviceMenu = renderServiceMenuContent({
              featuredServicesSlot: renderSlot('featuredServices'),
              menuVariant: 'grouped_categories',
              policiesSlot: renderSlot('policies'),
              socialLinksSlot: renderSlot('socialLinks'),
            });
            return sectionPresentation.serviceMenuFrame === 'services-anchor'
              ? <div id="services" ref={servicesAnchorRef} className="shell">{serviceMenu}</div>
              : serviceMenu;
          },
        },
        hoursLocation: {
          full: () => <section data-public-surface="hoursLocation" />,
          location_cards: () => <section data-public-surface="hoursLocation" />,
        },
        policies: {
          card: () => <section data-public-surface="policies" />,
          inline: () => <section data-public-surface="policies" />,
        },
        socialLinks: {
          icons: () => <nav data-public-surface="socialLinks" />,
          labeled: () => <nav data-public-surface="socialLinks" />,
        },
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
    expect(approved.canonicalRendererRegistries).toBe(1);
    expect(approved.approvedRendererSeams.sort()).toEqual([
      'featuredServices:marked-fragment',
      'salonProfile:BookingStepHeader',
      'serviceMenu:grouped_categories:renderServiceMenuContent-call',
      'serviceMenu:grouped_categories:services-anchor-wrapper',
      'serviceMenu:list:renderServiceMenuContent-call',
      'serviceMenu:list:services-anchor-wrapper',
      'serviceMenu:renderServiceMenuContent-declaration',
    ]);
    expect(rejected.filter(violation => violation.kind === 'unclassified-section').length).toBeGreaterThanOrEqual(6);
  });
});
