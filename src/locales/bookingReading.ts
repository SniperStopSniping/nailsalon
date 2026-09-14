// Small, shared client-side copy for the date picker.
// Keep English and French keys together so every control has both variants.
const en = {
  previousWeek: 'Previous week',
  nextWeek: 'Next week',
  previousMonth: 'Previous month',
  nextMonth: 'Next month',
  fullCalendar: 'View full calendar',
  dateHelp: 'Choose a date, then a time.',
  showWeek: 'Show one week',
  closed: 'closed',
};

const fr: typeof en = {
  previousWeek: 'Semaine précédente',
  nextWeek: 'Semaine suivante',
  previousMonth: 'Mois précédent',
  nextMonth: 'Mois suivant',
  fullCalendar: 'Voir le calendrier complet',
  dateHelp: 'Choisissez une date, puis une heure.',
  showWeek: 'Afficher une semaine',
  closed: 'fermé',
};

export const bookingReadingCopy = (locale: string) => locale === 'fr' ? fr : en;
