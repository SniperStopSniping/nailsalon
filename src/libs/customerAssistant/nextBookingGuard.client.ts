/** Snapshot every pointer that starting another booking can clear. */
export function captureNextBookingGuard(salonId: string, salonSlug: string, capability?: string): () => void {
  const handoffKey = `luster.normal-confirm-handoff.v1.${salonId}`;
  const legacyKey = `luster.customer-booking.operation.${salonId}`;
  const conversationKey = `luster.customer-assistant.conversation.${salonSlug}`;
  const handoff = sessionStorage.getItem(handoffKey);
  const legacy = localStorage.getItem(legacyKey);
  const conversation = sessionStorage.getItem(conversationKey);
  const flowToken = handoff ? JSON.parse(handoff).flowToken : null;
  if (handoff && typeof flowToken !== 'string') {
    throw new Error('BOOKING_RECOVERY_CHANGED');
  }
  const operationKey = flowToken ? `luster.normal-booking.operation.${salonId}.${flowToken.split('.')[1]}` : null;
  const operation = operationKey ? localStorage.getItem(operationKey) : null;
  const confirming = operationKey ? localStorage.getItem(`${operationKey}.confirming`) : null;
  if (capability) {
    if ((!operation && !legacy)
      || (operation && JSON.parse(operation).capability !== capability)
      || (legacy && JSON.parse(legacy).capability !== capability)
      || confirming) {
      throw new Error('BOOKING_RECOVERY_CHANGED');
    }
  } else if (handoff || legacy) {
    throw new Error('BOOKING_RECOVERY_CHANGED');
  }
  return () => {
    if (sessionStorage.getItem(handoffKey) !== handoff
      || localStorage.getItem(legacyKey) !== legacy
      || sessionStorage.getItem(conversationKey) !== conversation
      || (operationKey && localStorage.getItem(operationKey) !== operation)
      || (operationKey && localStorage.getItem(`${operationKey}.confirming`) !== confirming)) {
      throw new Error('BOOKING_RECOVERY_CHANGED');
    }
  };
}
