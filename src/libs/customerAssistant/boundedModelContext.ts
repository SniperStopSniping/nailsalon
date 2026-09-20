export type CustomerModelDialogueTurn = {
  role: 'user' | 'assistant';
  content: string;
};

type BoundedModelContext = Record<string, unknown> & {
  dialogue?: CustomerModelDialogueTurn[];
  customerMessages?: string[];
};

/**
 * Model history is presentation context only. Keep all authoritative menu,
 * facts and booking state intact; trim only oldest dialogue pairs by UTF-8
 * bytes when a provider input must fit its existing cap.
 */
export function compactCustomerModelContext(args: {
  context: BoundedModelContext;
  prompt: string;
  additionalInput?: string;
  schema?: unknown;
  maxBytes: number;
  legacyMessages?: readonly string[];
}): { data: string; dialogue: CustomerModelDialogueTurn[]; compacted: boolean; fits: boolean } {
  const suppliedDialogue = args.context.dialogue;
  const dialogue = (suppliedDialogue?.length
    ? suppliedDialogue
    : (args.legacyMessages ?? args.context.customerMessages ?? []).map(content => ({ role: 'user' as const, content })))
    .map(turn => ({ role: turn.role, content: turn.content }));
  // A role-labelled history supersedes the legacy user-only mirror. Sending
  // both wastes the bounded context and can make the model overweight it.
  const { customerMessages: _legacyMessages, ...withoutLegacyMessages } = args.context;
  const context: BoundedModelContext = { ...withoutLegacyMessages, dialogue };
  const serialized = () => JSON.stringify(context);
  const size = (data: string) => Buffer.byteLength(args.prompt + data + (args.additionalInput ?? '') + (args.schema ? JSON.stringify(args.schema) : ''), 'utf8');
  let data = serialized();
  let compacted = false;
  // Conversation entries are normally user/assistant pairs. Preserve the
  // newest exchange while discarding only the oldest pair at a time.
  while (size(data) > args.maxBytes && dialogue.length > 2) {
    // A legacy or interrupted history may have an odd entry count. Keep the
    // newest two turns intact rather than removing both entries blindly.
    dialogue.splice(0, Math.min(2, dialogue.length - 2));
    compacted = true;
    data = serialized();
  }
  return { data, dialogue, compacted, fits: size(data) <= args.maxBytes };
}
