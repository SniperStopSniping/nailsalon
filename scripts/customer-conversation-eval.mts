/**
 * Opt-in, synthetic real-model evaluation of the complete customer
 * receptionist conversation boundary. It never opens a database, reads a
 * real salon, submits a booking, or sends a message.
 *
 * node --conditions=react-server --import tsx scripts/customer-conversation-eval.mts \
 *   --run --key-file /absolute/private/key.env --key-name OPENAI_API_KEY_CUSTOMER \
 *   --max-budget-usd 0.50 --repeat 1
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { customerAssistantCopy } = require('../src/components/customerAssistant/copy') as typeof import('../src/components/customerAssistant/copy');
const { createOpenAiResponsesProvider } = require('../src/libs/ai/openaiResponses.server') as typeof import('../src/libs/ai/openaiResponses.server');
const { projectCustomerInterpreterMenu } = require('../src/libs/customerAssistant/interpreterMenu') as typeof import('../src/libs/customerAssistant/interpreterMenu');
const { compactCustomerModelContext } = require('../src/libs/customerAssistant/boundedModelContext') as typeof import('../src/libs/customerAssistant/boundedModelContext');
const { CUSTOMER_ASSISTANT_INTERPRETATION_MODEL, CUSTOMER_ASSISTANT_MAX_INPUT_BYTES, CUSTOMER_ASSISTANT_MAX_OUTPUT_TOKENS, CUSTOMER_ASSISTANT_MODEL } = require('../src/libs/customerAssistant/contracts') as typeof import('../src/libs/customerAssistant/contracts');
const { CUSTOMER_INTERPRETATION_JSON_SCHEMA, CUSTOMER_INTERPRETATION_PROMPT, customerInterpretationSchema } = require('../src/libs/customerAssistant/interpretation') as typeof import('../src/libs/customerAssistant/interpretation');
const { RECEPTIONIST_REPLY_PROMPT, buildReplyInput, createReplySchema, fallbackReceptionistReply, parseReceptionistReply } = require('../src/libs/customerAssistant/reply') as typeof import('../src/libs/customerAssistant/reply');
const { createCustomerConversation, signCustomerConversation, verifyCustomerConversation } = require('../src/libs/customerAssistant/conversation.server') as typeof import('../src/libs/customerAssistant/conversation.server');
const { customerPartialQuoteSelection } = require('../src/libs/customerAssistant/consultation') as typeof import('../src/libs/customerAssistant/consultation');
const { emptyFacts } = require('../src/libs/customerAssistant/semanticFacts') as typeof import('../src/libs/customerAssistant/semanticFacts');
const { selectionConflictsWithExplicitFacts } = require('../src/libs/customerAssistant/semanticSelection') as typeof import('../src/libs/customerAssistant/semanticSelection');
const { evaluateReceptionistTurn } = require('../src/libs/customerAssistant/__evals__/receptionistHarness') as typeof import('../src/libs/customerAssistant/__evals__/receptionistHarness');
const { applyCustomerTurnResult } = require('../src/libs/customerAssistant/resolveTurn') as typeof import('../src/libs/customerAssistant/resolveTurn');
const { SEMANTIC_L1_MENU, SEMANTIC_L1_SNAPSHOT } = require('../src/libs/customerAssistant/__evals__/semanticCases') as typeof import('../src/libs/customerAssistant/__evals__/semanticCases');
const { CUSTOMER_CONVERSATION_EVAL_CASES } = require('../src/libs/customerAssistant/__evals__/conversationCases') as typeof import('../src/libs/customerAssistant/__evals__/conversationCases');
const { resolveCatalogSelection } = require('../src/libs/catalogResolverCore') as typeof import('../src/libs/catalogResolverCore');

const syntheticNow = Date.parse('2026-09-18T12:00:00.000Z');
const syntheticSecret = 'synthetic-evaluation-signing-secret-which-is-never-a-production-secret';
const maxReplyTokens = 800;
const timeoutMs = 12_000;
const maxOutputTokens = CUSTOMER_ASSISTANT_MAX_OUTPUT_TOKENS;

// Luna rates below; Terra interpretation uses 10x each rate per current official pricing.
// This is a transparent estimate for the evaluator budget guard,
// not a claim of a provider invoice. Provider usage is also retained per call.
const inputMicrosPerMillion = 200_000;
const cachedInputMicrosPerMillion = 20_000;
const outputMicrosPerMillion = 1_200_000;

type Options = {
  run: boolean;
  keyFile: string | null;
  keyName: string | null;
  output: string | null;
  filter: string | null;
  repeat: number;
  maxBudgetMicros: number;
  historyHeadroomBytes: number | null;
  interpretationModel: 'gpt-5.6-luna' | 'gpt-5.6-terra';
  help: boolean;
};

type SafeCall = {
  stage: 'interpretation' | 'reply';
  latencyMs: number | null;
  usage: import('../src/libs/ai/provider').ModelProviderUsage | null;
  estimatedCostMicros: number | null;
  status: 'completed' | 'failed' | 'not_run';
  error: string | null;
};

function usage(): string {
  return `Usage: node --conditions=react-server --import tsx scripts/customer-conversation-eval.mts --run --key-file <absolute path> --key-name <UPPERCASE_NAME> [--max-budget-usd <0.01-10>] [--filter <case id text>] [--repeat <1-5>] [--out <directory>] [--history-headroom-bytes <600-4000>] [--interpretation-model <gpt-5.6-luna|gpt-5.6-terra>]`;
}

function parseOptions(argv: string[]): Options | null {
  const parsed: Options = { run: false, keyFile: null, keyName: null, output: null, filter: null, repeat: 1, maxBudgetMicros: 500_000, historyHeadroomBytes: null, interpretationModel: CUSTOMER_ASSISTANT_INTERPRETATION_MODEL, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--run') {
      parsed.run = true;
    } else if (argument === '--help' || argument === '-h') {
      parsed.help = true;
    } else if (argument === '--key-file' || argument === '--key-name' || argument === '--out' || argument === '--filter' || argument === '--repeat' || argument === '--max-budget-usd' || argument === '--history-headroom-bytes' || argument === '--interpretation-model') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) {
        return null;
      }
      if (argument === '--interpretation-model') {
        if (value !== 'gpt-5.6-luna' && value !== 'gpt-5.6-terra') {
          return null;
        }
        parsed.interpretationModel = value;
      }
      if (argument === '--key-file') {
        parsed.keyFile = value;
      }
      if (argument === '--key-name') {
        parsed.keyName = value;
      }
      if (argument === '--out') {
        parsed.output = value;
      }
      if (argument === '--filter') {
        parsed.filter = value;
      }
      if (argument === '--repeat') {
        const count = Number(value);
        if (!Number.isInteger(count) || count < 1 || count > 5) {
          return null;
        }
        parsed.repeat = count;
      }
      if (argument === '--history-headroom-bytes') {
        const bytes = Number(value);
        if (!Number.isInteger(bytes) || bytes < 600 || bytes > 4000) {
          return null;
        }
        parsed.historyHeadroomBytes = bytes;
      }
      if (argument === '--max-budget-usd') {
        const dollars = Number(value);
        if (!Number.isFinite(dollars) || dollars < 0.01 || dollars > 10) {
          return null;
        }
        parsed.maxBudgetMicros = Math.round(dollars * 1_000_000);
      }
    } else {
      return null;
    }
  }
  return parsed;
}

// Evaluation-only pressure reduces available history room without inventing
// catalogue facts or raising Production caps. Default uses the exact live cap.
function compactEvaluationContext(args: Parameters<typeof compactCustomerModelContext>[0], headroom: number | null) {
  const fixedBytes = Buffer.byteLength(args.prompt + (args.additionalInput ?? '') + JSON.stringify({ ...args.context, dialogue: [] }) + (args.schema ? JSON.stringify(args.schema) : ''), 'utf8');
  return compactCustomerModelContext({ ...args, maxBytes: headroom === null ? args.maxBytes : Math.min(args.maxBytes, fixedBytes + headroom) });
}

function readNamedEnv(contents: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = contents.match(new RegExp(`^(?:export\\s+)?${escaped}\\s*=\\s*(.+?)\\s*$`, 'm'));
  if (!match?.[1]) {
    return null;
  }
  const value = match[1].trim();
  return (value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\'')) ? value.slice(1, -1) : value;
}

function estimatedCostMicros(usageValue: import('../src/libs/ai/provider').ModelProviderUsage | null, rateMultiplier = 1): number | null {
  if (!usageValue) {
    return null;
  }
  const cached = usageValue.cachedInputTokens;
  const cacheWrite = usageValue.cacheWriteInputTokens ?? 0;
  const regular = usageValue.inputTokens - cached - cacheWrite;
  if (regular < 0) {
    return null;
  }
  return Math.ceil(rateMultiplier * (regular * inputMicrosPerMillion + cached * cachedInputMicrosPerMillion + cacheWrite * 250_000 + usageValue.outputTokens * outputMicrosPerMillion) / 1_000_000);
}

function conservativeReservationMicros(input: string, outputTokens: number, rateMultiplier = 1): number {
  return Math.ceil(rateMultiplier * ((Buffer.byteLength(input, 'utf8') + 4_096) * 250_000 + outputTokens * outputMicrosPerMillion) / 1_000_000);
}

function modelText(response: Awaited<ReturnType<import('../src/libs/ai/provider').OwnerAssistantModelProvider['createResponse']>>): string {
  if (response.status !== 'completed' || response.items.some(item => item.type === 'function_call' || item.type === 'refusal')) {
    throw new Error('invalid_model_response');
  }
  const text = response.items.filter(item => item.type === 'message').map(item => item.text).join('');
  if (!text || text.length > 16_000) {
    throw new Error('invalid_model_response');
  }
  return text;
}

function syntheticPublicFacts(): import('../src/libs/customerAssistant/publicFacts.server').CustomerPublicFacts {
  const currency = 'CAD' as const;
  const money = (cents: number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(cents / 100);
  return {
    salon: {
      name: 'Synthetic Isla Nail Studio',
      description: 'A synthetic public nail studio used only for receptionist evaluation.',
      location: { locality: 'Toronto, ON' },
      hours: { today: 'Friday: 9:00 AM–6:00 PM', weekly: [{ day: 'Monday', value: '9:00 AM–6:00 PM' }, { day: 'Friday', value: '9:00 AM–6:00 PM' }] },
      policies: [{ label: 'Cancellation policy', text: 'Synthetic policy: changes require notice.' }],
    },
    catalogue: {
      currency,
      services: SEMANTIC_L1_SNAPSHOT.services.map(service => ({
        id: service.id,
        name: service.name,
        description: (service.descriptionItems ?? []).join(' ') || null,
        category: service.category,
        durationMinutes: service.durationMinutes,
        price: { baseCents: service.priceCents, baseDisplay: money(service.priceCents), displayLabel: null, range: null },
      })),
      addOns: SEMANTIC_L1_SNAPSHOT.addOns.map(addOn => ({
        id: addOn.id,
        name: addOn.name,
        description: (addOn.descriptionItems ?? []).join(' ') || null,
        category: addOn.category,
        pricingType: addOn.pricingType,
        durationMinutes: addOn.durationMinutes,
        price: { baseCents: addOn.priceCents, baseDisplay: money(addOn.priceCents), displayLabel: null, range: null },
      })),
    },
  };
}

/** Same pure L1 resolution used by the synthetic receptionist harness. */
function buildSyntheticProposal(selection: import('../src/libs/customerAssistant/contracts').CustomerSelection): import('../src/libs/customerAssistant/contracts').CustomerProposal {
  const resolved = resolveCatalogSelection(SEMANTIC_L1_SNAPSHOT, { serviceId: selection.baseServiceId, selectedAddOns: selection.selectedAddOns });
  if (!resolved.ok || resolved.selection.blocksContinue) {
    throw new Error('synthetic_invalid_selection');
  }
  const value = resolved.selection;
  const service = SEMANTIC_L1_SNAPSHOT.services.find(item => item.id === value.serviceId);
  if (!service) {
    throw new Error('synthetic_service_missing');
  }
  return {
    selection: { baseServiceId: value.serviceId, selectedAddOns: value.addOns.map(item => ({ addOnId: item.addOnId, quantity: item.quantity })) },
    fingerprint: createHash('sha256').update(JSON.stringify(value)).digest('hex'),
    service: { id: service.id, name: service.name, priceCents: service.priceCents },
    addOns: value.addOns.map((item) => {
      const addOn = SEMANTIC_L1_MENU.addOns.find(candidate => candidate.id === item.addOnId);
      if (!addOn) {
        throw new Error('synthetic_addon_missing');
      }
      return { id: item.addOnId, name: addOn.name, quantity: item.quantity, priceCents: item.lineTotalCents };
    }),
    subtotalCents: value.subtotalCents,
    durationMinutes: value.totalDurationMinutes,
    currency: 'CAD',
    expiresAt: '2026-09-18T23:59:00.000Z',
  };
}

function folded(value: string): string {
  return value.toLocaleLowerCase('en-CA').replace(/[’‘]/g, String.fromCharCode(39)).replace(/\s+/g, ' ').trim();
}

function evaluateTurn(args: {
  turn: import('../src/libs/customerAssistant/__evals__/conversationCases').ConversationEvalTurn;
  result: import('../src/libs/customerAssistant/contracts').CustomerAssistantResult;
  next: import('../src/libs/customerAssistant/conversation.server').CustomerConversation;
  reply: string;
  publicFacts: import('../src/libs/customerAssistant/publicFacts.server').CustomerPublicFacts;
  previous: import('../src/libs/customerAssistant/conversation.server').CustomerConversation;
  currentProposal?: import('../src/libs/customerAssistant/contracts').CustomerProposal;
}): string[] {
  const failures: string[] = [];
  const { expect } = args.turn;
  if (!args.reply.trim()) {
    failures.push('reply_empty');
  }
  if (!expect.resultKinds.includes(args.result.kind)) {
    failures.push(`result:${args.result.kind}`);
  }
  const checkAvailability = !expect.availability?.whenSlotsOnly || args.result.kind === 'slots';
  if (checkAvailability && expect.availability?.requested) {
    const actual = args.result.kind === 'slots' ? args.result.search?.requestedPreference : undefined;
    for (const [key, value] of Object.entries(expect.availability.requested)) {
      if (actual?.[key as keyof NonNullable<typeof actual>] !== value) {
        failures.push(`availability_requested_${key}`);
      }
    }
  }
  if (checkAvailability && expect.availability?.fallback !== undefined && (args.result.kind !== 'slots' || args.result.search?.fallback !== expect.availability.fallback)) {
    failures.push('availability_fallback');
  }
  if (expect.availability?.clarificationDirection && !folded(args.reply).includes(expect.availability.clarificationDirection)) {
    failures.push('availability_clarification_direction');
  }
  const expectedTopics = expect.permittedAnswerTopics ?? (expect.answerTopic ? [expect.answerTopic] : []);
  if (expectedTopics.length && (args.result.kind !== 'answer' || !expectedTopics.includes(args.result.topic as typeof expectedTopics[number]))) {
    failures.push(`topic:${args.result.kind === 'answer' ? args.result.topic ?? 'none' : args.result.kind}`);
  }
  for (const [key, value] of Object.entries(expect.facts ?? {})) {
    if (args.next.facts?.[key as keyof NonNullable<typeof args.next.facts>] !== value) {
      failures.push(`fact:${key}`);
    }
  }
  if (expect.subjects && JSON.stringify(args.next.subjects ?? []) !== JSON.stringify(expect.subjects)) {
    failures.push('subjects');
  }
  if (expect.proposal && !(args.result.kind === 'clarification' && expect.resultKinds.includes('clarification'))) {
    if (args.result.kind !== 'proposal') {
      failures.push('proposal_missing');
    } else {
      if (args.result.proposal.service.id !== expect.proposal.serviceId) {
        failures.push('proposal_service');
      }
      const addOnIds = new Set(args.result.proposal.addOns.map(item => item.id));
      if (expect.proposal.addOnIds?.some(id => !addOnIds.has(id))) {
        failures.push('proposal_addons');
      }
      if (expect.proposal.subtotalCents !== undefined && args.result.proposal.subtotalCents !== expect.proposal.subtotalCents) {
        failures.push('proposal_price');
      }
      if (expect.proposal.durationMinutes !== undefined && args.result.proposal.durationMinutes !== expect.proposal.durationMinutes) {
        failures.push('proposal_duration');
      }
    }
  }
  if (expect.preservesSelection) {
    const selection = args.next.requestedSelection;
    if (!selection || selection.baseServiceId !== expect.preservesSelection.serviceId) {
      failures.push('selection_not_preserved');
    } else if (expect.preservesSelection.addOnIds?.some(id => !selection.selectedAddOns.some(item => item.addOnId === id))) {
      failures.push('selection_addons_not_preserved');
    }
  }
  if (expect.clarificationQuestion && (args.result.kind !== 'clarification' || args.result.question !== expect.clarificationQuestion)) {
    failures.push('clarification_question');
  }
  if (expect.noRepeatedQuestion && args.result.kind === 'clarification' && args.result.question === expect.noRepeatedQuestion) {
    failures.push('repeated_known_question');
  }
  if (expect.handoffReady && (args.result.kind !== 'proposal' || args.result.proposal.fingerprint.length !== 64 || args.next.context?.selection?.baseServiceId !== args.result.proposal.selection.baseServiceId)) {
    failures.push('handoff_not_ready');
  }

  const reply = folded(args.reply);
  if (expect.reply?.nonEmpty && !reply) {
    failures.push('reply_empty');
  }
  const service = (id: string) => args.publicFacts.catalogue.services.find(item => item.id === id);
  if (expect.reply?.priceForServiceId) {
    const item = service(expect.reply.priceForServiceId);
    if (!item || !reply.includes(folded(item.price.baseDisplay))) {
      failures.push('reply_price_not_grounded');
    }
  }
  if (expect.reply?.durationForServiceId) {
    const item = service(expect.reply.durationForServiceId);
    if (!item || !new RegExp(`\\b${item.durationMinutes}\\b`).test(reply)) {
      failures.push('reply_duration_not_grounded');
    }
  }
  if (expect.reply?.noRepeatedServiceId) {
    const item = service(expect.reply.noRepeatedServiceId);
    if (!item) {
      failures.push('reply_subject_unknown');
    } else {
      const subject = folded(item.name);
      const mentions = reply.split(subject).length - 1;
      if (mentions > 1) {
        failures.push('reply_subject_repeated');
      }
    }
  }
  if (expect.reply?.comparisonForServiceIds) {
    const [leftId, rightId] = expect.reply.comparisonForServiceIds;
    const left = service(leftId);
    const right = service(rightId);
    const replyFacts = require('../src/libs/customerAssistant/reply').buildReplyFacts({ menu: SEMANTIC_L1_MENU, publicFacts: args.publicFacts, result: args.result, conversation: args.previous, nextState: args.next, message: args.turn.message, locale: 'en', currentProposal: args.currentProposal }) as Record<string, string>;
    const comparison = Object.values(replyFacts).find(value => left && right && value.includes(left.name) && value.includes(right.name));
    if (!comparison || !reply.includes(folded(comparison))) {
      failures.push('reply_comparison_not_grounded');
    }
  }
  if (expect.reply?.configuredTotalCents !== undefined && args.result.kind === 'proposal') {
    if (args.result.proposal.subtotalCents !== expect.reply.configuredTotalCents) {
      failures.push('proposal_configured_total');
    }
  } else if (expect.reply?.configuredTotalCents !== undefined) {
    const replyFacts = require('../src/libs/customerAssistant/reply').buildReplyFacts({ menu: SEMANTIC_L1_MENU, publicFacts: args.publicFacts, result: args.result, conversation: args.previous, nextState: args.next, message: args.turn.message, locale: 'en', currentProposal: args.currentProposal }) as Record<string, string>;
    const expectedTotal = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(expect.reply.configuredTotalCents / 100);
    if (!replyFacts.selection?.includes(expectedTotal) || !reply.includes(folded(replyFacts.selection))) {
      failures.push('reply_configured_total_not_grounded');
    }
  }
  if (expect.reply?.configuredDurationMinutes !== undefined && args.result.kind === 'proposal') {
    if (args.result.proposal.durationMinutes !== expect.reply.configuredDurationMinutes) {
      failures.push('proposal_configured_duration');
    }
  } else if (expect.reply?.configuredDurationMinutes !== undefined) {
    const replyFacts = require('../src/libs/customerAssistant/reply').buildReplyFacts({ menu: SEMANTIC_L1_MENU, publicFacts: args.publicFacts, result: args.result, conversation: args.previous, nextState: args.next, message: args.turn.message, locale: 'en', currentProposal: args.currentProposal }) as Record<string, string>;
    if (!replyFacts.selection?.includes(`${expect.reply.configuredDurationMinutes} minutes`) || !reply.includes(folded(replyFacts.selection))) {
      failures.push('reply_configured_duration_not_grounded');
    }
  }
  if (expect.reply?.publicFactKey) {
    const replyFacts = require('../src/libs/customerAssistant/reply').buildReplyFacts({ menu: SEMANTIC_L1_MENU, publicFacts: args.publicFacts, result: args.result, conversation: args.previous, nextState: args.next, message: args.turn.message, locale: 'en', currentProposal: args.currentProposal }) as Record<string, string>;
    const fact = replyFacts[expect.reply.publicFactKey];
    if (!fact || !reply.includes(folded(fact))) {
      failures.push('reply_public_fact_missing');
    }
  }
  if (expect.reply?.mentionsAny && !expect.reply.mentionsAny.some(term => reply.includes(folded(term)))) {
    failures.push('reply_subject_missing');
  }
  if (expect.reply?.excludes?.some(term => reply.includes(folded(term)))) {
    failures.push('reply_forbidden_copy');
  }
  if (expect.reply?.recallsLastUserQuestion) {
    const previousQuestion = args.previous.dialogue?.filter(item => item.role === 'user').at(-1)?.content ?? args.previous.messages.at(-1);
    if (!previousQuestion || !reply.includes(folded(previousQuestion))) {
      failures.push('reply_recall_missing');
    }
  }
  if (expect.reply?.explainsUnsupported && args.result.kind === 'unavailable') {
    const limitation = require('../src/libs/customerAssistant/reply').buildReplyFacts({ menu: SEMANTIC_L1_MENU, publicFacts: args.publicFacts, result: args.result, conversation: args.previous, nextState: args.next, message: args.turn.message, locale: 'en', currentProposal: args.currentProposal }).limitation;
    if (!limitation || !reply.includes(folded(limitation))) {
      failures.push('reply_limitation_missing');
    }
  }
  return failures;
}

function percentile(values: number[], ratio: number): number | null {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))] ?? null;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (!options || options.help) {
    process.stdout.write(`${usage()}\n`);
    if (!options) {
      process.exitCode = 1;
    }
    return;
  }
  if (!options.run || !options.keyFile || !options.keyName || !path.isAbsolute(options.keyFile) || !/^[A-Z][A-Z0-9_]*$/.test(options.keyName)) {
    process.stderr.write(`Refused: --run, an absolute --key-file, and uppercase --key-name are required.\n${usage()}\n`);
    process.exitCode = 1;
    return;
  }
  const apiKey = readNamedEnv(await readFile(options.keyFile, 'utf8'), options.keyName);
  if (!apiKey) {
    process.stderr.write('Refused: the named credential was absent or blank.\n');
    process.exitCode = 1;
    return;
  }
  const filter = options.filter?.toLocaleLowerCase('en-CA') ?? null;
  const cases = CUSTOMER_CONVERSATION_EVAL_CASES.filter(item => !filter || `${item.id} ${item.category}`.toLocaleLowerCase('en-CA').includes(filter));
  if (!cases.length) {
    process.stderr.write('Refused: no synthetic evaluation cases matched --filter.\n');
    process.exitCode = 1;
    return;
  }

  const provider = createOpenAiResponsesProvider({ apiKey });
  const publicFacts = syntheticPublicFacts();
  const calls: SafeCall[] = [];
  const results: Array<Record<string, unknown>> = [];
  let reservedMicros = 0;
  let stop = false;
  const output = path.resolve(repositoryRoot, options.output ?? 'artifacts/customer-assistant/conversation-evaluation');
  await mkdir(output, { recursive: true, mode: 0o700 });
  const checkpoint = path.join(output, 'in-progress.json');
  for (let repeatIndex = 1; repeatIndex <= options.repeat; repeatIndex += 1) {
    for (const testCase of cases) {
      let conversation = createCustomerConversation('synthetic-isla', syntheticSecret, syntheticNow);
      conversation.facts = emptyFacts();
      for (const [turnIndex, turn] of testCase.turns.entries()) {
        if (stop) {
          results.push({ caseId: testCase.id, category: testCase.category, repeat: repeatIndex, turn: turnIndex + 1, status: 'not_run', reason: 'spend_ceiling' });
          continue;
        }
        if (turn.session === 'reopen') {
          conversation = verifyCustomerConversation(signCustomerConversation(conversation, syntheticSecret), 'synthetic-isla', syntheticSecret, syntheticNow);
        }
        if (turn.priorFailure) {
          // The failed turn is injected, not counted as an executed model turn.
          // Unit tests independently cover the server's failure serialization.
          conversation = { ...conversation, messages: [...conversation.messages, turn.priorFailure.message].slice(-16), dialogue: [
            ...(conversation.dialogue ?? conversation.messages.map(content => ({ role: 'user' as const, content }))),
            { role: 'user' as const, content: turn.priorFailure.message },
            { role: 'assistant' as const, content: customerAssistantCopy.en.unavailable.unavailable! },
          ].slice(-24) };
        }
        const priorDialogue: NonNullable<import('../src/libs/customerAssistant/conversation.server').CustomerConversation['dialogue']> = conversation.dialogue
          ? [...conversation.dialogue]
          : conversation.messages.map(content => ({ role: 'user' as const, content }));
        const interpretationContext = compactEvaluationContext({ prompt: CUSTOMER_INTERPRETATION_PROMPT, additionalInput: turn.message, maxBytes: CUSTOMER_ASSISTANT_MAX_INPUT_BYTES, context: {
          locale: 'en',
          bookingSalon: { name: publicFacts.salon.name, slug: 'synthetic-isla' },
          menu: projectCustomerInterpreterMenu(SEMANTIC_L1_MENU),
          previousFacts: conversation.facts ?? emptyFacts(),
          requestedSelection: conversation.requestedSelection ?? null,
          dialogue: priorDialogue,
          conversationalSubjects: conversation.subjects ?? [],
          priorConversationalSubjects: conversation.priorSubjects ?? [],
          lastShown: conversation.context ?? null,
          bookingState: conversation.booking ?? null,
          availabilitySearch: conversation.availabilitySearch ?? null,
          today: '2026-09-18',
          timeZone: 'America/Toronto',
        } }, options.historyHeadroomBytes);
        if (!interpretationContext.fits) {
          throw new Error('SYNTHETIC_INTERPRETATION_CONTEXT_TOO_LARGE');
        }
        const interpretationInput = interpretationContext.data;
        const interpretationReservation = conservativeReservationMicros(CUSTOMER_INTERPRETATION_PROMPT + interpretationInput + turn.message, maxOutputTokens, options.interpretationModel === 'gpt-5.6-terra' ? 10 : 1);
        // The reply facts include every permitted public fact. Reserve against
        // the full synthetic projection rather than the smaller interpreter
        // input so --max-budget-usd remains a hard ceiling.
        const replyReservation = conservativeReservationMicros(RECEPTIONIST_REPLY_PROMPT + interpretationInput + JSON.stringify(publicFacts), maxReplyTokens);
        if (reservedMicros + interpretationReservation + replyReservation > options.maxBudgetMicros) {
          stop = true;
          results.push({ caseId: testCase.id, category: testCase.category, repeat: repeatIndex, turn: turnIndex + 1, status: 'not_run', reason: 'spend_ceiling' });
          continue;
        }
        reservedMicros += interpretationReservation + replyReservation;
        const previous = conversation;
        let intent: import('zod').z.infer<typeof customerInterpretationSchema> | null = null;
        let rawReply: string | null = null;
        let rawInterpretation: string | null = null;
        let replyFallback = false;
        let replyParseFailure: string | null = null;
        let result: import('../src/libs/customerAssistant/contracts').CustomerAssistantResult | null = null;
        let next: import('../src/libs/customerAssistant/conversation.server').CustomerConversation | null = null;
        const failures: string[] = [];
        try {
          const started = performance.now();
          const modelResponse = await provider.createResponse({ model: options.interpretationModel, input: [{ role: 'system', content: CUSTOMER_INTERPRETATION_PROMPT }, { role: 'user', content: interpretationInput }, { role: 'user', content: turn.message }], tools: [], toolChoice: 'none', reasoningEffort: 'low', jsonMode: 'schema', jsonSchema: CUSTOMER_INTERPRETATION_JSON_SCHEMA, maxOutputTokens, timeoutMs });
          const interpretationCall: SafeCall = { stage: 'interpretation', latencyMs: Math.round(performance.now() - started), usage: modelResponse.usage, estimatedCostMicros: estimatedCostMicros(modelResponse.usage, options.interpretationModel === 'gpt-5.6-terra' ? 10 : 1), status: 'completed', error: null };
          calls.push(interpretationCall);
          rawInterpretation = modelText(modelResponse);
          const parsedIntent = customerInterpretationSchema.parse(JSON.parse(rawInterpretation));
          intent = parsedIntent;
          const resolved = await evaluateReceptionistTurn(parsedIntent, conversation, { message: turn.message, kinds: ['answer', 'proposal', 'clarification', 'unavailable', 'slots', 'date_prompt', 'slot_selected'], availabilityFixture: testCase.availabilityFixture });
          result = resolved.result;
          next = { ...resolved.next, dialogue: priorDialogue };
          let currentProposal: import('../src/libs/customerAssistant/contracts').CustomerProposal | undefined;
          let quoteIsDraft = false;
          if (result.kind === 'answer') {
            try {
              const quoteSelection = next.context?.selection ?? customerPartialQuoteSelection({ menu: SEMANTIC_L1_MENU, snapshot: SEMANTIC_L1_SNAPSHOT, facts: next.facts ?? emptyFacts(), candidate: next.requestedSelection ?? null });
              if (!quoteSelection) {
                throw new Error('CUSTOMER_CONFIGURED_QUOTE_UNAVAILABLE');
              }
              quoteIsDraft = !next.context?.selection;
              const checked = buildSyntheticProposal(quoteSelection);
              if (!selectionConflictsWithExplicitFacts(SEMANTIC_L1_MENU, next.facts ?? emptyFacts(), {
                baseServiceId: checked.service.id,
                selectedAddOns: checked.addOns.map(item => ({ addOnId: item.id, quantity: item.quantity })),
              })) {
                currentProposal = checked;
              }
            } catch {
              // Incomplete synthetic drafts have no configured total.
            }
          }
          const replyInput = buildReplyInput({ menu: SEMANTIC_L1_MENU, publicFacts, result, conversation, nextState: next, message: turn.message, locale: 'en', currentProposal, quoteIsDraft });
          const replySchema = createReplySchema(replyInput.facts);
          const replyContext = compactEvaluationContext({ context: JSON.parse(replyInput.data), prompt: RECEPTIONIST_REPLY_PROMPT, schema: replySchema, maxBytes: 24_000 }, options.historyHeadroomBytes);
          if (!replyContext.fits) {
            throw new Error('SYNTHETIC_REPLY_CONTEXT_TOO_LARGE');
          }
          const replyStarted = performance.now();
          const replyResponse = await provider.createResponse({ model: CUSTOMER_ASSISTANT_MODEL, input: [{ role: 'system', content: RECEPTIONIST_REPLY_PROMPT }, { role: 'user', content: replyContext.data }], tools: [], toolChoice: 'none', reasoningEffort: 'low', jsonMode: 'schema', jsonSchema: replySchema, maxOutputTokens: maxReplyTokens, timeoutMs });
          calls.push({ stage: 'reply', latencyMs: Math.round(performance.now() - replyStarted), usage: replyResponse.usage, estimatedCostMicros: estimatedCostMicros(replyResponse.usage), status: 'completed', error: null });
          rawReply = modelText(replyResponse);
          const guidanceOptions = result.kind === 'clarification' && result.question === 'service' ? result.options : null;
          let parsedReply: { message: string; options: string[] };
          try {
            parsedReply = parseReceptionistReply(rawReply, replyInput.facts, SEMANTIC_L1_MENU, replyInput.requiredFactKeys);
            if (guidanceOptions && parsedReply.options.some(option => !guidanceOptions.includes(option))) {
              throw new Error('CUSTOMER_REPLY_INCOMPATIBLE_GUIDANCE_OPTION');
            }
          } catch (error) {
            // The customer-visible path has a deterministic, fact-grounded
            // fallback. Keep raw-model contract reliability separate from the
            // customer outcome rather than pretending an invalid reply was
            // shown to a visitor.
            replyFallback = true;
            replyParseFailure = error instanceof Error && /^CUSTOMER_REPLY_[A-Z_]+$/.test(error.message) ? error.message : 'CUSTOMER_REPLY_INVALID';
            parsedReply = { message: fallbackReceptionistReply({ menu: SEMANTIC_L1_MENU, publicFacts, result, conversation, nextState: next, message: turn.message, locale: 'en', currentProposal, quoteIsDraft }, replyInput.facts), options: [] };
          }
          result = { ...result, message: parsedReply.message, ...(result.kind === 'answer' || guidanceOptions ? { options: parsedReply.options } : {}) };
          // Match the live turn: sign the choices actually rendered after composition.
          applyCustomerTurnResult(next, result);
          const nextDialogue: NonNullable<import('../src/libs/customerAssistant/conversation.server').CustomerConversation['dialogue']> = [...priorDialogue, { role: 'user' as const, content: turn.message }, { role: 'assistant' as const, content: parsedReply.message }].slice(-24);
          next.dialogue = nextDialogue;
          failures.push(...evaluateTurn({ turn, result, next, reply: parsedReply.message, publicFacts, previous, currentProposal }));
          conversation = next;
          results.push({ caseId: testCase.id, category: testCase.category, repeat: repeatIndex, turn: turnIndex + 1, customer: turn.message, injectedPriorFailure: turn.priorFailure?.message ?? null, contextCompaction: { interpretation: interpretationContext.compacted, reply: replyContext.compacted }, status: failures.length ? 'review' : 'passed', failures, modelReplyFallback: replyFallback, replyParseFailure, intent, rawModelInterpretation: rawInterpretation, result, rawModelReply: rawReply, reply: parsedReply.message, nextFacts: next.facts, subjects: next.subjects ?? [], calls: calls.slice(-2) });
        } catch (error) {
          const stage = result ? 'reply' : 'interpretation';
          calls.push({ stage, latencyMs: null, usage: null, estimatedCostMicros: null, status: 'failed', error: error instanceof Error ? error.name : 'unknown' });
          results.push({ caseId: testCase.id, category: testCase.category, repeat: repeatIndex, turn: turnIndex + 1, customer: turn.message, status: 'failed', failures: ['provider_or_contract_failure'], stage, intent, result, rawReply, error: error instanceof Error ? error.name : 'unknown' });
          break;
        }
        await writeFile(checkpoint, JSON.stringify({ results, calls, reservedMicros }, null, 2), { mode: 0o600 });
      }
    }
  }
  const completedCalls = calls.filter(call => call.status === 'completed');
  const latencies = completedCalls.flatMap(call => call.latencyMs === null ? [] : [call.latencyMs]);
  const report = {
    generatedAt: new Date().toISOString(),
    model: options.interpretationModel,
    replyModel: CUSTOMER_ASSISTANT_MODEL,
    store: false,
    scope: 'synthetic public salon/catalogue and synthetic customer text only; no database, real salon, booking, payment, availability hold, or message',
    promptSha256: { interpretation: createHash('sha256').update(CUSTOMER_INTERPRETATION_PROMPT).digest('hex'), receptionist: createHash('sha256').update(RECEPTIONIST_REPLY_PROMPT).digest('hex') },
    fixtureSha256: createHash('sha256').update(JSON.stringify(CUSTOMER_CONVERSATION_EVAL_CASES)).digest('hex'),
    limits: { maxBudgetMicros: options.maxBudgetMicros, reservedMicros, maxOutputTokens, maxReplyTokens, timeoutMs, repeat: options.repeat, filter: options.filter, historyHeadroomBytes: options.historyHeadroomBytes },
    summary: {
      turns: results.length,
      passed: results.filter(item => item.status === 'passed').length,
      review: results.filter(item => item.status === 'review').length,
      failed: results.filter(item => item.status === 'failed').length,
      notRun: results.filter(item => item.status === 'not_run').length,
      calls: calls.length,
      modelReplyFallbacks: results.filter(item => item.modelReplyFallback === true).length,
      unknownUsageCalls: completedCalls.filter(call => call.estimatedCostMicros === null).length,
      estimatedCostMicros: completedCalls.reduce((sum, call) => sum + (call.estimatedCostMicros ?? 0), 0),
      latencyP50Ms: percentile(latencies, 0.5),
      latencyP95Ms: percentile(latencies, 0.95),
    },
    results,
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = path.join(output, `evaluation-${stamp}.json`);
  await writeFile(filename, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ file: filename, ...report.summary })}\n`);
}

void main().catch((error: unknown) => {
  const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : error instanceof Error ? error.name : 'unknown';
  process.stderr.write(`Customer conversation evaluation stopped: ${code}. Inspect its checkpoint for completed calls.\n`);
  process.exitCode = 1;
});
