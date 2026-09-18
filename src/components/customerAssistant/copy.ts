import type { CustomerAssistantLocale } from '@/libs/customerAssistant/contracts';

type CustomerAssistantCopy = {
  launcher: string;
  title: string;
  close: string;
  continueManually: string;
  introduction: string;
  placeholder: string;
  send: string;
  loading: string;
  restart: string;
  retry: string;
  networkError: string;
  tokenError: string;
  contactChanged: string;
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
    launcher: 'Help me choose & book',
    title: 'Help me choose',
    close: 'Close assistant',
    continueManually: 'Continue manually',
    introduction: 'Tell us what you would like. I can help you choose services and find an available time.',
    placeholder: 'Describe the nails you want',
    send: 'Send',
    loading: 'Finding the best match…',
    restart: 'Start over',
    retry: 'Try again',
    networkError: 'We could not reach the assistant. Your previous conversation was kept. Please try again.',
    tokenError: 'This conversation is no longer available. Start over to continue.',
    contactChanged: 'Your contact details changed. Review the booking details again.',
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
      length: 'What length would you like?',
      finish: 'Which finish would you like?',
      quantity: 'How many would you like?',
      details: 'Could you share one more detail?',
    },
    unavailable: {
      no_match: 'We could not find a matching service. Try describing what you would like another way.',
      unavailable: 'That selection is not available right now. Try another option.',
      rate_limited: 'Please wait a moment before trying again.',
      conversation_used: 'This conversation is no longer available. Start over to continue.',
      selection_changed: 'The salon menu changed. Please choose again so we can show current details.',
      invalid_conversation: 'This conversation is no longer available. Start over to continue.',
    },
  },
  fr: {
    launcher: 'M’aider à choisir et réserver',
    title: 'M’aider à choisir',
    close: 'Fermer l’assistant',
    continueManually: 'Continuer manuellement',
    introduction: 'Dites-nous ce que vous souhaitez. Je peux vous aider à choisir des services et à trouver une heure disponible.',
    placeholder: 'Décrivez les ongles que vous voulez',
    send: 'Envoyer',
    loading: 'Recherche de la meilleure option…',
    restart: 'Recommencer',
    retry: 'Réessayer',
    networkError: 'Nous ne pouvons pas joindre l’assistant. Votre conversation précédente a été conservée. Réessayez.',
    tokenError: 'Cette conversation n’est plus disponible. Recommencez pour continuer.',
    contactChanged: 'Vos coordonnées ont changé. Vérifiez les détails de réservation à nouveau.',
    proposal: 'Services suggérés',
    services: 'Service',
    addOns: 'Ajouts',
    duration: 'Durée',
    subtotal: 'Sous-total',
    subtotalNote: 'Avant les taxes et les rabais conditionnels.',
    questions: {
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
      unavailable: 'Cette sélection n’est pas offerte présentement. Essayez une autre option.',
      rate_limited: 'Veuillez attendre un instant avant de réessayer.',
      conversation_used: 'Cette conversation n’est plus disponible. Recommencez pour continuer.',
      selection_changed: 'Le menu du salon a changé. Choisissez de nouveau pour afficher les détails actuels.',
      invalid_conversation: 'Cette conversation n’est plus disponible. Recommencez pour continuer.',
    },
  },
};
