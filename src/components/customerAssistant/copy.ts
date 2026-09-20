import type { CustomerAssistantLocale } from '@/libs/customerAssistant/contracts';

type CustomerAssistantCopy = {
  launcher: string;
  title: string;
  close: string;
  continueManually: string;
  introduction: string;
  placeholder: string;
  changePlaceholder: string;
  answerPlaceholder: string;
  send: string;
  selectedAnswer: string;
  loading: string;
  restart: string;
  retry: string;
  networkError: string;
  tokenError: string;
  availability: string;
  proposal: string;
  services: string;
  addOns: string;
  duration: string;
  subtotal: string;
  subtotalNote: string;
  questions: Record<string, string>;
  unavailable: Record<string, string>;
};

export const customerAssistantCopy: Record<CustomerAssistantLocale, CustomerAssistantCopy> = {
  en: {
    launcher: 'Help me choose',
    title: 'Help me choose',
    close: 'Close assistant',
    continueManually: 'Continue manually',
    introduction: 'Ask me about services, prices or the salon—or tell me what you have in mind.',
    placeholder: 'Tell me what you would like',
    changePlaceholder: 'Add or change anything…',
    answerPlaceholder: 'Type an answer or choose below',
    send: 'Send',
    selectedAnswer: 'You chose',
    loading: 'Thinking…',
    restart: 'Start over',
    retry: 'Try again',
    networkError: 'We could not reach the assistant. Your previous conversation was kept. Please try again.',
    tokenError: 'This conversation is no longer available. Start over to continue.',
    availability: 'Available times to consider',
    proposal: 'Suggested services',
    services: 'Service',
    addOns: 'Add-ons',
    duration: 'Duration',
    subtotal: 'Subtotal',
    subtotalNote: 'Before tax and any conditional discounts.',
    questions: {
      date: 'What day works for you?',
      service: 'Which service are you looking for?',
      removal: 'Do you need a removal?',
      product: 'What product is currently on your nails?',
      origin: 'Was your existing set done here or at another salon?',
      length: 'What length would you like?',
      finish: 'Which finish would you like?',
      quantity: 'How many would you like?',
      details: 'Could you share one more detail?',
    },
    unavailable: {
      no_match: 'We could not find a matching service. Try describing what you would like another way.',
      unavailable: 'I couldn’t check that right now. Please try again or continue with the regular booking menu.',
      rate_limited: 'Please wait a moment before trying again.',
      conversation_used: 'This conversation is no longer available. Start over to continue.',
      selection_changed: 'The salon menu changed. Please choose again so we can show current details.',
      invalid_conversation: 'This conversation is no longer available. Start over to continue.',
      conversation_expired: 'This conversation has expired. Start over and we will check the current menu again.',
      session_limit: 'This conversation has reached its limit. Start over to continue.',
      stale_conversation: 'A newer reply was already processed. Reopen the latest conversation to continue.',
      unsupported_service: 'That service is not available for online booking. Please choose another option.',
      unsupported_removal: 'That removal is not available to book online with your chosen service. Please check with the salon, or tell me if it will already be removed before your visit.',
      transition_needs_confirmation: 'I can’t yet confirm this change is compatible with what’s on your nails. Tell me if the current product will be removed before your visit, or check with the salon.',
      incompatible_selection: 'Those options cannot be booked together. Please choose another option.',
      unknown_product: 'It’s okay not to know. The salon will need to identify what is on your nails before choosing a compatible removal. We won’t guess.',
      no_availability: 'There are no matching times right now. Try another day or time.',
      handoff_expired: 'Please review the current booking details again before continuing.',
      invalid_handoff: 'Please choose the services again before continuing.',
    },
  },
  fr: {
    launcher: 'M’aider à choisir',
    title: 'M’aider à choisir',
    close: 'Fermer l’assistant',
    continueManually: 'Continuer manuellement',
    introduction: 'Posez-moi vos questions sur les services, les prix ou le salon, ou décrivez ce que vous souhaitez.',
    placeholder: 'Dites-moi ce que vous voulez',
    changePlaceholder: 'Ajoutez ou modifiez quelque chose…',
    answerPlaceholder: 'Répondez ou choisissez ci-dessous',
    send: 'Envoyer',
    selectedAnswer: 'Votre choix',
    loading: 'Un instant…',
    restart: 'Recommencer',
    retry: 'Réessayer',
    networkError: 'Nous ne pouvons pas joindre l’assistant. Votre conversation précédente a été conservée. Réessayez.',
    tokenError: 'Cette conversation n’est plus disponible. Recommencez pour continuer.',
    availability: 'Heures disponibles à considérer',
    proposal: 'Services suggérés',
    services: 'Service',
    addOns: 'Ajouts',
    duration: 'Durée',
    subtotal: 'Sous-total',
    subtotalNote: 'Avant les taxes et les rabais conditionnels.',
    questions: {
      product: 'Quel produit avez-vous actuellement sur les ongles ?',
      origin: 'Votre pose actuelle a-t-elle été faite ici ou dans un autre salon ?',
      date: 'Quel jour vous convient ?',
      service: 'Quel service recherchez-vous?',
      removal: 'Avez-vous besoin d’un retrait?',
      length: 'Quelle longueur souhaitez-vous?',
      finish: 'Quelle finition souhaitez-vous?',
      quantity: 'Combien en souhaitez-vous?',
      details: 'Pouvez-vous partager un détail de plus?',
    },
    unavailable: {
      no_match: 'Nous n’avons pas trouvé de service correspondant. Essayez de décrire ce que vous souhaitez autrement.',
      unavailable: 'Je n’ai pas pu vérifier cela pour le moment. Réessayez ou continuez avec le menu de réservation habituel.',
      rate_limited: 'Veuillez attendre un instant avant de réessayer.',
      conversation_used: 'Cette conversation n’est plus disponible. Recommencez pour continuer.',
      selection_changed: 'Le menu du salon a changé. Choisissez de nouveau pour afficher les détails actuels.',
      invalid_conversation: 'Cette conversation n’est plus disponible. Recommencez pour continuer.',
      conversation_expired: 'Cette conversation a expiré. Recommencez et nous vérifierons le menu actuel.',
      session_limit: 'Cette conversation a atteint sa limite. Recommencez pour continuer.',
      stale_conversation: 'Une réponse plus récente a déjà été traitée. Rouvrez la conversation la plus récente pour continuer.',
      unsupported_service: 'Ce service n’est pas offert en ligne. Choisissez une autre option.',
      unsupported_removal: 'Ce retrait n’est pas offert avec ce service. Choisissez une autre option.',
      transition_needs_confirmation: 'Je ne peux pas encore confirmer que ce changement est compatible avec le produit sur vos ongles. Dites-moi s’il sera retiré avant votre rendez-vous, ou vérifiez avec le salon.',
      incompatible_selection: 'Ces options ne peuvent pas être réservées ensemble. Choisissez une autre option.',
      unknown_product: 'Ce n’est pas grave si vous ne savez pas. Le salon doit identifier le produit avant de choisir une dépose compatible. Nous ne choisirons pas au hasard.',
      no_availability: 'Aucune heure ne correspond présentement. Essayez une autre journée ou heure.',
      handoff_expired: 'Vérifiez les détails de réservation actuels avant de continuer.',
      invalid_handoff: 'Choisissez de nouveau les services avant de continuer.',
    },
  },
};
