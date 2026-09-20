import type { CustomerMenu } from './catalogue.server';
import type { CustomerAssistantLocale, CustomerAssistantResult, CustomerSelection } from './contracts';
import type { Facts } from './semanticFacts';
import { semanticCatalog } from './semanticSelection';

export type AnswerTopic = 'compare_treatments' | 'length_options' | 'service_options' | 'unknown_product' | 'service_information';

/** Facts about the starting condition never have to be products sold by a salon. */
export function desiredServices(menu: CustomerMenu, facts: Facts) {
  return menu.services.filter(service => (facts.treatment === 'unknown' || semanticCatalog.serviceFamily(service) === facts.treatment)
    && (facts.desiredApplication === 'unknown' || semanticCatalog.serviceApplication(service) === facts.desiredApplication)
    && (facts.maintenance === 'unknown' || semanticCatalog.isRefill(service) === (facts.maintenance === 'refill'))
    && !(facts.existingProduct === 'none' && semanticCatalog.isRefill(service)));
}

export function transitionFailure(menu: CustomerMenu, facts: Facts): 'unsupported_service' | 'unsupported_removal' | null {
  const services = desiredServices(menu, facts);
  if (!services.length && (facts.treatment !== 'unknown' || facts.desiredApplication !== 'unknown')) {
    return 'unsupported_service';
  }
  const changingProduct = facts.maintenance === 'new_set' && facts.treatment !== 'unknown' && facts.treatment !== facts.existingProduct;
  if ((facts.removal !== 'yes' && !(changingProduct && facts.removal !== 'no')) || facts.existingProduct === 'unknown' || facts.existingProduct === 'none') {
    return null;
  }
  const serviceIds = new Set(services.map(item => item.id));
  const allowed = new Set(menu.bindings.filter(item => serviceIds.has(item.serviceId)).map(item => item.addOnId));
  const removal = menu.addOns.filter(item => allowed.has(item.id) && semanticCatalog.isRemoval(item)
    && semanticCatalog.productMatches(item, facts.existingProduct)
    && (facts.origin === 'unknown' || semanticCatalog.isForeignRemoval(item) === (facts.origin === 'other_salon')));
  return removal.length ? null : 'unsupported_removal';
}

/** Only educational copy lives here. Prices, timing, policies and availability never come from model prose. */
export function receptionistAnswer(args: { menu: CustomerMenu; facts: Facts; topic: AnswerTopic; locale: CustomerAssistantLocale; serviceId: string | null }): Extract<CustomerAssistantResult, { kind: 'answer' }> {
  const { menu, facts, topic, locale } = args;
  const fr = locale === 'fr';
  const relevant = topic === 'compare_treatments'
    ? menu.services.filter(item => ['builder_gel', 'gel_x'].includes(semanticCatalog.serviceFamily(item)) && !semanticCatalog.isRefill(item))
    : topic === 'length_options'
      ? menu.services.filter(item => semanticCatalog.serviceApplication(item) === 'extensions' && !semanticCatalog.isRefill(item))
      : desiredServices(menu, facts).filter(item => facts.desiredApplication !== 'extensions' || facts.maintenance === 'refill' || !semanticCatalog.isRefill(item));
  const names = relevant.map(item => item.name).slice(0, 8);
  const offered = names.length ? (fr ? ` Le menu en ligne propose : ${names.join(', ')}.` : ` The online menu offers ${names.join(', ')}.`) : '';
  const explanation: Record<AnswerTopic, string> = fr
    ? {
        compare_treatments: 'Le BIAB / gel de construction renforce et structure généralement les ongles naturels. Le Gel-X utilise des capsules en gel pour ajouter de la longueur. Le choix dépend du résultat souhaité et de ce que vous portez déjà.',
        length_options: 'Vous souhaitez ajouter de la longueur. Nous pouvons partir de ce résultat, sans connaître les noms des prestations.',
        service_options: 'Voici les options du menu en ligne qui correspondent à ce que vous avez décrit. Vous pouvez aussi préciser le résultat souhaité.',
        unknown_product: 'Ce n’est pas grave si vous ne savez pas quel produit vous portez. Le salon doit l’identifier avant de choisir une dépose compatible. Nous ne choisirons pas une dépose au hasard.',
        service_information: 'Les propositions utilisent le menu actuel du salon. Le BIAB renforce généralement les ongles naturels ; le Gel-X ajoute de la longueur avec des capsules en gel. Vous pouvez me décrire le résultat souhaité.',
      }
    : {
        compare_treatments: 'BIAB / builder gel generally strengthens and structures your natural nails. Gel-X uses gel tips to add length. The right choice depends on the result you want and what is on your nails now.',
        length_options: 'You’re looking to add length. We can start with that result—you don’t need to know the service names.',
        service_options: 'These are the online menu options that fit what you’ve described. You can also tell me more about the result you want.',
        unknown_product: 'It’s okay not to know what is on your nails. The salon will need to identify it before choosing a compatible removal. We won’t guess which removal you need.',
        service_information: 'We can work from the result you want. Builder gel generally strengthens natural nails; Gel-X adds length using gel tips. The current salon menu determines which choices can be booked.',
      };
  if (topic === 'service_information') {
    const subject = menu.services.find(item => item.id === args.serviceId);
    if (subject) {
      const family = semanticCatalog.serviceFamily(subject);
      const education = fr
        ? {
            gel_polish: 'Une manucure au gel apporte une couleur en gel aux ongles naturels, sans ajouter de capsules.',
            builder_gel: 'Le BIAB / gel de construction apporte du renforcement et de la structure aux ongles naturels.',
            gel_x: 'Le Gel-X utilise des capsules en gel pour ajouter de la longueur.',
            acrylic: 'L’acrylique est un système de renforcement ou d’extension différent du gel.',
            unknown: 'Vous pouvez me dire le résultat souhaité pour vérifier les options du menu.',
          }
        : {
            gel_polish: 'A gel manicure adds gel polish to your natural nails, without adding extension tips.',
            builder_gel: 'BIAB / builder gel adds strength and structure to natural nails.',
            gel_x: 'Gel-X uses gel tips to add length.',
            acrylic: 'Acrylic is a strengthening or extension system different from gel.',
            unknown: 'Tell me the result you want and we can check the current menu options.',
          };
      explanation.service_information = `${subject.name}: ${subject.description || education[family]}`;
    }
  }
  return { kind: 'answer', topic, message: explanation[topic] + (topic === 'unknown_product' ? '' : offered), options: topic === 'unknown_product' ? [] : names };
}

/** Apply explicit design changes without losing compatible choices on a follow-up. */
export function mergeCatalogChoices(args: {
  menu: CustomerMenu;
  previous: CustomerSelection | null;
  serviceId: string | null;
  addOns: CustomerSelection['selectedAddOns'];
  updates?: { add: CustomerSelection['selectedAddOns']; remove: string[] };
}): CustomerSelection | null {
  const serviceId = args.serviceId ?? args.previous?.baseServiceId;
  if (!serviceId) {
    return null;
  }
  // Older model/evaluation output has a full selection rather than a patch.
  if (!args.updates) {
    return { baseServiceId: serviceId, selectedAddOns: args.addOns };
  }
  const publicIds = new Set(args.menu.addOns.map(item => item.id));
  if (args.updates.remove.some(id => !publicIds.has(id))) {
    throw new Error('CUSTOMER_SELECTION_INVALID');
  }
  const choices = new Map((args.previous?.baseServiceId === serviceId ? args.previous.selectedAddOns : []).map(item => [item.addOnId, item.quantity]));
  for (const item of args.addOns) {
    choices.set(item.addOnId, item.quantity);
  }
  for (const id of args.updates.remove) {
    choices.delete(id);
  }
  for (const item of args.updates.add) {
    choices.set(item.addOnId, item.quantity);
  }
  return { baseServiceId: serviceId, selectedAddOns: [...choices].map(([addOnId, quantity]) => ({ addOnId, quantity })) };
}

export function clarificationChoices(question: string, labels: string[], locale: CustomerAssistantLocale): string[] {
  if (question === 'product') {
    return locale === 'fr' ? ['Rien', 'Gel-X', 'BIAB / gel de construction', 'Autre / je ne sais pas'] : ['Nothing', 'Gel-X', 'BIAB / Builder Gel', 'Other / Not sure'];
  }
  if (question === 'origin') {
    return locale === 'fr' ? ['Ici', 'Un autre salon', 'Je ne sais pas'] : ['From here', 'Another salon', 'Not sure'];
  }
  return labels;
}

/** Interpret a rejected offered time separately from a date-only correction. */
export function applyTimingFeedback(preference: import('./contracts').CustomerDatePreference, feedback: 'none' | 'too_late' | 'too_early', offered: readonly Pick<import('./contracts').CustomerAvailableSlot, 'time'>[]): import('./contracts').CustomerDatePreference {
  if (feedback === 'none' || !offered.length) {
    return preference;
  }
  const times = offered.map(slot => slot.time).sort();
  const rejected = feedback === 'too_late' ? times[0]! : times[times.length - 1]!;
  const [hours = 0, minutes = 0] = rejected.split(':').map(Number);
  const boundary = Math.max(0, Math.min(1439, hours * 60 + minutes + (feedback === 'too_late' ? -1 : 1)));
  const time = `${String(Math.floor(boundary / 60)).padStart(2, '0')}:${String(boundary % 60).padStart(2, '0')}`;
  return feedback === 'too_late' ? { ...preference, earliest: '00:00', latest: time } : { ...preference, earliest: time, latest: '23:59' };
}
