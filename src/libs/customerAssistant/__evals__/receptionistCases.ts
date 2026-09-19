import type { CustomerAssistantResult } from '../contracts';
import type { Facts } from '../semanticFacts';

export type ReceptionistEvalTurn = { message: string; facts?: Partial<Facts>; kinds: CustomerAssistantResult['kind'][]; reason?: string; price?: number; duration?: number; forbiddenQuestion?: string; date?: string; latestBefore?: string };
export const RECEPTIONIST_CASES: Array<{ id: string; turns: ReceptionistEvalTurn[] }> = [
  { id: 'outcome-to-selection-and-corrections', turns: [
    { message: 'I was thinking making my nails longer', facts: { desiredApplication: 'extensions' }, kinds: ['answer', 'clarification'] },
    { message: 'Are those the only options?', kinds: ['answer'] },
    { message: 'Okay Gel-X', facts: { treatment: 'gel_x' }, kinds: ['clarification'], forbiddenQuestion: 'service' },
    { message: 'Probably medium and French', facts: { length: 'medium', french: 'yes' }, kinds: ['clarification'], forbiddenQuestion: 'length' },
    { message: 'Nothing currently on my nails', facts: { existingProduct: 'none', length: 'medium', french: 'yes' }, kinds: ['proposal'], price: 9000, duration: 120 },
    { message: 'Actually make them long', facts: { length: 'long', french: 'yes', existingProduct: 'none' }, kinds: ['proposal'], price: 10000, duration: 135 },
    { message: 'Actually forget French, can I do chrome?', facts: { french: 'no', length: 'long' }, kinds: ['proposal'], price: 10200, duration: 130 },
    { message: 'I broke two nails too', facts: { repairCount: 2 }, kinds: ['proposal'], price: 10800, duration: 140 },
    { message: 'What\'s the difference between BIAB and Gel-X?', facts: { treatment: 'gel_x', length: 'long', repairCount: 2 }, kinds: ['answer'] },
    { message: 'Keep Gel-X but remove chrome please', kinds: ['proposal'], price: 9600, duration: 130 },
    { message: 'Anything Saturday after 5?', kinds: ['slots'], date: '2026-09-19' },
    { message: 'That\'s too late, what about Sunday?', kinds: ['slots'], date: '2026-09-20', latestBefore: '17:00' },
  ] },
  { id: 'informational-subject-and-explicit-edit', turns: [
    { message: 'Medium Gel-X with chrome, nothing currently on my nails', kinds: ['proposal'], price: 9200, duration: 115 },
    { message: 'What is BIAB?', facts: { treatment: 'gel_x', length: 'medium' }, kinds: ['answer'] },
    { message: 'Remove chrome, and what is the difference between BIAB and Gel-X?', facts: { treatment: 'gel_x' }, kinds: ['answer'] },
    { message: 'The second one please, keep medium', facts: { treatment: 'gel_x', length: 'medium' }, kinds: ['proposal'], price: 8000, duration: 105 },
  ] },
  { id: 'medium-bare-nails', turns: [
    { message: 'Gel-X Extensions', facts: { treatment: 'gel_x' }, kinds: ['clarification'] },
    { message: 'Medium Length', facts: { length: 'medium' }, kinds: ['clarification'], forbiddenQuestion: 'length' },
    { message: 'Nothing', facts: { existingProduct: 'none' }, kinds: ['proposal'], price: 8000, duration: 105 },
    { message: 'Can we add French?', facts: { french: 'yes' }, kinds: ['proposal'], price: 9000, duration: 120 },
    { message: 'Actually remove French', facts: { french: 'no' }, kinds: ['proposal'], price: 8000, duration: 105 },
  ] },
  { id: 'current-acrylic-is-not-desired-service', turns: [
    { message: 'I currently have acrylic from another salon but want medium Gel-X with French', facts: { existingProduct: 'acrylic', origin: 'other_salon', treatment: 'gel_x', length: 'medium', french: 'yes', removal: 'yes' }, kinds: ['unavailable'], reason: 'unsupported_removal' },
    { message: 'What\'s the difference between BIAB and Gel-X?', facts: { existingProduct: 'acrylic', treatment: 'gel_x' }, kinds: ['answer'] },
  ] },
  { id: 'unknown-current-product', turns: [{ message: 'I want medium Gel-X but I don\'t know what\'s on my nails', facts: { existingProduct: 'unknown', currentProductUncertain: true, treatment: 'gel_x', length: 'medium' }, kinds: ['answer', 'unavailable', 'clarification'] }] },
  { id: 'gel-french-retained', turns: [{ message: 'Gel manicure with French on my bare natural nails please', kinds: ['proposal'], price: 5000, duration: 75 }] },
  { id: 'biab-natural-no-extension-question', turns: [{ message: 'BIAB on my bare natural nails please', kinds: ['proposal'], price: 5500, duration: 90 }] },
  { id: 'own-removal-facts-retained', turns: [{ message: 'short Gel-X + French, removing existing Gel-X from Synthetic Isla', facts: { length: 'short', origin: 'this_salon', existingProduct: 'gel_x', treatment: 'gel_x' }, kinds: ['proposal'], price: 9500, duration: 125 }] },
];
