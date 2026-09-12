// Small, shared client-side copy for the date picker and reading preference.
// Keep English and French keys together so every control has both variants.
const en = {
  easierToRead: 'Easier to read',
  readingOn: 'On',
  readingOff: 'Off',
  readingHelp: 'Larger text, clear backgrounds and a simple font. Saved on this device.',
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
  easierToRead: 'Lecture facilitée',
  readingOn: 'Activée',
  readingOff: 'Désactivée',
  readingHelp: 'Texte agrandi, fonds unis et police simple. Enregistré sur cet appareil.',
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
