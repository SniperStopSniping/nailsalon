export type MarketingLocale = 'en' | 'fr';
export type MarketingPageKey = 'salon' | 'website' | 'reminders' | 'free';

export const LUSTER_SHOP_URL = 'https://lustergel.ca/shop';

type MarketingPageContent = {
  path: string;
  title: string;
  description: string;
  heading: string;
  intro: string;
  sections: { heading: string; body: string }[];
  questions: { question: string; answer: string }[];
};

export const marketingCopy = {
  en: {
    title: 'Nail Tech & Nail Salon Booking App | Luster',
    description: 'Create your booking website, manage appointments and clients, and sync Google Calendar. Core booking is free with Luster; optional SMS credits cost extra.',
    heading: 'The booking app built for nail techs and nail salons.',
    intro: 'Give clients a place to book, keep your appointments and client history together, and make room for the work you love. Luster brings your booking website, calendar and client management into one workspace.',
    eyebrow: 'Online booking for nail businesses',
    owner: 'Salon owner sign in',
    shop: 'Shop Luster gel',
    start: 'Build my website',
    dashboard: 'Open owner dashboard',
    invite: 'Request an invite',
    language: 'Français',
    languageLabel: 'Read this page in French',
    pricing: 'Free core booking. Optional credits when you need them.',
    pricingBody: 'Manage services, appointments and client history without a monthly booking subscription. Eligible new salons receive 100 starter SMS credits after contact verification. Additional SMS credits and optional AI design credits are separate purchases.',
    workflow: 'From a booking link to your next appointment.',
    steps: [
      { heading: 'Set up your nail business', body: 'Add your services, prices, appointment lengths and availability. Choose the look of the booking page you share with clients.' },
      { heading: 'Let clients book online', body: 'Clients choose a service and an available time without creating an account. Service lengths, buffers and connected Google busy time help keep your schedule consistent.' },
      { heading: 'Keep your day together', body: 'Use your owner workspace to manage appointments and client history. Clients can reschedule or cancel through their private appointment link, subject to your booking rules.' },
    ],
    explore: 'Find the right booking tools for your business.',
    cta: 'Make your next booking easier.',
    ctaBody: 'Start with your services and availability. Your booking website and owner workspace stay connected.',
    faq: 'Questions about Luster',
    privacy: 'Privacy policy',
    terms: 'Terms of service',
    contact: 'Contact support',
    demo: 'See a booking website come together.',
    demoBody: 'This recorded walkthrough uses a synthetic salon in an isolated demo workspace. It shows optional AI website design, an owner reviewing changes, and a customer completing the Luster booking flow. AI design uses separately purchased credits; manual setup and core booking do not use AI credits.',
    captions: 'English captions',
    videoFallback: 'Download the product walkthrough',
    transcript: 'Walkthrough transcript',
    transcriptBody: 'The owner enters business details, services, prices and hours, then asks for a website design. After previewing the design on desktop and phone, the owner reviews a service-price change and publishes. A customer then selects a service and an available time, and receives an appointment confirmation. The website-generation wait is shortened in the recording.',
  },
  fr: {
    title: 'Application de réservation pour les pros des ongles | Luster',
    description: 'Créez votre site de réservation, gérez rendez-vous et clients et synchronisez Google Agenda. Réservation de base gratuite; crédits SMS en supplément.',
    heading: 'L’application de réservation pensée pour les pros des ongles et les salons.',
    intro: 'Offrez à vos clients un endroit où réserver, regroupez vos rendez-vous et votre historique client, et consacrez-vous à votre métier. Luster réunit votre site de réservation, votre agenda et la gestion de vos clients dans un seul espace.',
    eyebrow: 'Réservation en ligne pour les professionnels des ongles',
    owner: 'Connexion propriétaire',
    shop: 'Acheter le gel Luster',
    start: 'Créer mon site web',
    dashboard: 'Ouvrir mon tableau de bord',
    invite: 'Demander une invitation',
    language: 'English',
    languageLabel: 'Lire cette page en anglais',
    pricing: 'Réservation de base gratuite. Crédits facultatifs au besoin.',
    pricingBody: 'Gérez vos services, rendez-vous et dossiers clients sans abonnement mensuel de réservation. Les nouveaux salons admissibles reçoivent 100 crédits SMS après vérification de leurs coordonnées. Les crédits SMS supplémentaires et les crédits facultatifs de conception par IA s’achètent séparément.',
    workflow: 'Du lien de réservation au prochain rendez-vous.',
    steps: [
      { heading: 'Configurez votre activité', body: 'Ajoutez vos services, tarifs, durées et disponibilités. Choisissez l’apparence de la page de réservation que vous partagerez avec vos clients.' },
      { heading: 'Proposez la réservation en ligne', body: 'Les clients choisissent un service et un créneau disponible sans créer de compte. Les durées, les marges entre rendez-vous et les périodes occupées de Google Agenda contribuent à organiser votre planning.' },
      { heading: 'Regroupez votre journée', body: 'Gérez vos rendez-vous et votre historique client dans votre espace propriétaire. Les clients peuvent déplacer ou annuler un rendez-vous à l’aide de leur lien privé, selon vos règles de réservation.' },
    ],
    explore: 'Des outils de réservation adaptés à votre activité.',
    cta: 'Simplifiez votre prochaine réservation.',
    ctaBody: 'Commencez par vos services et vos disponibilités. Votre site de réservation reste relié à votre espace propriétaire.',
    faq: 'Questions sur Luster',
    privacy: 'Politique de confidentialité',
    terms: 'Conditions d’utilisation',
    contact: 'Contacter l’assistance',
    demo: 'Découvrez la création d’un site de réservation.',
    demoBody: 'Cette démonstration enregistrée utilise un salon fictif dans un environnement de test isolé. Elle montre la conception facultative par IA, la validation des modifications par le propriétaire et une réservation client dans Luster. La conception par IA utilise des crédits achetés séparément; la configuration manuelle et la réservation de base n’en utilisent pas. La vidéo et ses sous-titres sont en anglais.',
    captions: 'Sous-titres anglais',
    videoFallback: 'Télécharger la démonstration',
    transcript: 'Transcription de la démonstration',
    transcriptBody: 'Le propriétaire saisit les coordonnées de son activité, ses services, ses tarifs et ses horaires, puis demande un site. Après avoir prévisualisé le résultat sur ordinateur et téléphone, il valide un changement de tarif et publie. Un client sélectionne ensuite un service et un créneau disponible et reçoit une confirmation. L’attente de génération du site est raccourcie dans cet enregistrement.',
  },
} as const;

export const marketingPages: Record<MarketingLocale, Record<MarketingPageKey, MarketingPageContent>> = {
  en: {
    salon: {
      path: '/nail-salon-booking-software',
      title: 'Nail Salon Booking Software | Luster',
      description: 'Keep nail salon services, staff availability, appointments and client history together. Explore Luster’s online booking software for nail businesses.',
      heading: 'Nail salon booking software for the way your team works.',
      intro: 'A salon schedule needs to account for the service, its duration and the people who can provide it. Luster connects your public booking page with the services and availability managed in your owner workspace.',
      sections: [
        { heading: 'Build a service menu that fits your salon', body: 'Set appointment lengths and prices for your services, assign the technicians who offer them, and manage availability. Clients start with your service menu so the booking follows the work your salon actually provides.' },
        { heading: 'Keep appointments and availability in one place', body: 'Manage appointments from your salon workspace. Connect Google Calendar when you want Luster to account for busy time from selected calendars. Buffers and service durations help determine which times clients can book.' },
        { heading: 'Keep client context close to the appointment', body: 'Use client records and appointment history when planning a return visit. Clients manage their own appointments through private links, without needing a separate customer account.' },
      ],
      questions: [
        { question: 'Can I use Luster as a solo nail tech?', answer: 'Yes. You can set up your own services and availability, then share your booking page with clients. You do not need to run a salon team to use core booking.' },
        { question: 'Do clients need to download an app?', answer: 'No. Clients open your booking page in their browser and can book without creating an account.' },
      ],
    },
    website: {
      path: '/features/booking-website',
      title: 'Booking Website for Nail Techs | Luster',
      description: 'Create a nail tech booking website with your services, photos and availability. Let clients book through a link connected to your Luster workspace.',
      heading: 'Your nail tech booking website, connected to your calendar.',
      intro: 'Give clients one link to learn about your services and choose an appointment. Your Luster booking page uses the same service information and scheduling rules you manage in your owner workspace.',
      sections: [
        { heading: 'Show the details clients need to choose', body: 'Add your services, descriptions, prices, appointment lengths and photos. Choose your page style and publish a booking page that represents your nail business.' },
        { heading: 'Share a booking link wherever clients find you', body: 'Put your link in your social profile, send it to a returning client or include it in your business information. Clients choose a service and an available time in their browser, without a customer account.' },
        { heading: 'Choose manual setup or optional AI design', body: 'Manual setup and core booking do not require AI credits. Optional AI design uses separately purchased credits. Review proposed changes before publishing; a website design remains connected to Luster’s booking flow.' },
      ],
      questions: [
        { question: 'Will website changes replace my booking system?', answer: 'Your website is the public entry to Luster booking. Services and availability remain managed through your Luster workspace rather than a separate appointment tool.' },
        { question: 'Can clients manage a booking after they leave the page?', answer: 'Clients use the private appointment link in their confirmation to view, reschedule or cancel, subject to your salon’s rules.' },
      ],
    },
    reminders: {
      path: '/features/appointment-reminders',
      title: 'Appointment Reminders for Nail Techs | Luster',
      description: 'Understand Luster appointment confirmations, email reminders and optional paid SMS credits for nail techs and nail salons.',
      heading: 'Appointment reminders that stay connected to your nail business.',
      intro: 'Keep appointment information and customer communications together. Luster supports appointment emails and optional SMS, with messaging preferences and delivery information in the owner workspace.',
      sections: [
        { heading: 'Start with appointment emails', body: 'Core booking includes email confirmations and reminders. Customers can use their secure appointment link to find the details of their visit and manage a booking according to your rules.' },
        { heading: 'Use SMS when it fits your business', body: 'SMS is optional and requires customer texting consent. Eligible new salons receive 100 starter SMS credits after contact verification. Further texts use credits purchased separately from core booking.' },
        { heading: 'Understand what a text credit covers', body: 'SMS usage is measured in message segments. Longer messages can use more than one credit, and sending depends on consent, your settings and the available balance. Review current top-up prices and applicable taxes before paying in Usage & SMS.' },
      ],
      questions: [
        { question: 'Are unlimited text messages included?', answer: 'No. Core booking is free; SMS uses a credit balance. Longer messages may use multiple credits. Any additional credit purchase is optional.' },
        { question: 'Does a messaging problem mean an appointment failed?', answer: 'No. Check the appointment record in Luster. A delivery problem is separate from the status of the booking.' },
      ],
    },
    free: {
      path: '/free-booking',
      title: 'Free Nail Tech Booking Software: What’s Included | Luster',
      description: 'See what Luster’s free core booking includes and how optional SMS and AI credits work. No monthly core booking subscription is required.',
      heading: 'Free core booking for your nail business. Clear choices for extras.',
      intro: 'Start with a booking page, services, appointments and client management. A monthly core booking subscription is not required. Optional SMS and AI design credits are separate purchases.',
      sections: [
        { heading: 'Run your core booking without a monthly subscription', body: 'Manage services, availability, online bookings and client history in Luster. Email confirmations and reminders are included. Clients can book through your website without creating an account.' },
        { heading: 'Add text credits when you choose', body: 'Eligible new salons receive 100 starter SMS credits once after contact verification. Additional SMS credits are one-time purchases. Usage is measured in message segments, and the current price and applicable taxes appear before you pay.' },
        { heading: 'Keep optional AI design separate', body: 'Manual website setup and ordinary bookings do not use AI credits. If you choose optional AI design, it uses a separate credit balance. Review the purchase details and proposed changes before continuing.' },
      ],
      questions: [
        { question: 'Do I need to buy SMS credits to take bookings?', answer: 'No. SMS is optional. Core online booking and appointment emails do not require a paid SMS credit purchase.' },
        { question: 'Where can I see the current cost of extras?', answer: 'Your workspace shows current SMS top-up prices in Usage & SMS and the purchase details for optional AI credits before payment. This page does not introduce a subscription or promise a fixed credit price.' },
      ],
    },
  },
  fr: {
    salon: {
      path: '/nail-salon-booking-software',
      title: 'Logiciel de réservation pour salon d’ongles | Luster',
      description: 'Regroupez services, disponibilités de l’équipe, rendez-vous et historique client. Découvrez le logiciel de réservation Luster pour les salons d’ongles.',
      heading: 'Un logiciel de réservation adapté à votre salon d’ongles.',
      intro: 'Un planning de salon doit tenir compte du service, de sa durée et des personnes qui le proposent. Luster relie votre page de réservation publique aux services et disponibilités gérés dans votre espace propriétaire.',
      sections: [
        { heading: 'Créez un menu adapté à votre salon', body: 'Définissez les durées et tarifs de vos services, associez les professionnels qui les proposent et gérez les disponibilités. Les clients commencent par votre menu pour réserver les prestations que votre salon offre réellement.' },
        { heading: 'Regroupez rendez-vous et disponibilités', body: 'Gérez les rendez-vous dans votre espace salon. Connectez Google Agenda pour tenir compte des périodes occupées des agendas sélectionnés. Les durées des services et les marges entre rendez-vous contribuent au calcul des créneaux réservables.' },
        { heading: 'Gardez le contexte client à portée de main', body: 'Consultez les dossiers clients et l’historique des rendez-vous pour préparer une prochaine visite. Les clients gèrent leurs réservations à l’aide de liens privés, sans compte client distinct.' },
      ],
      questions: [
        { question: 'Puis-je utiliser Luster si je travaille en solo?', answer: 'Oui. Configurez vos services et disponibilités, puis partagez votre page de réservation. Il n’est pas nécessaire de diriger une équipe pour utiliser la réservation de base.' },
        { question: 'Les clients doivent-ils télécharger une application?', answer: 'Non. Ils ouvrent votre page dans leur navigateur et peuvent réserver sans créer de compte.' },
      ],
    },
    website: {
      path: '/features/booking-website',
      title: 'Site de réservation pour les pros des ongles | Luster',
      description: 'Créez un site avec vos services, photos et disponibilités. Vos clients réservent grâce à un lien connecté à votre espace Luster.',
      heading: 'Votre site de réservation, relié à votre agenda.',
      intro: 'Offrez à vos clients un lien pour découvrir vos services et choisir un rendez-vous. Votre page Luster utilise les mêmes informations et règles de planning que votre espace propriétaire.',
      sections: [
        { heading: 'Présentez les détails utiles pour choisir', body: 'Ajoutez vos services, descriptions, tarifs, durées et photos. Choisissez un style et publiez une page de réservation à l’image de votre activité.' },
        { heading: 'Partagez votre lien là où vos clients vous trouvent', body: 'Ajoutez le lien à votre profil social, envoyez-le à un client fidèle ou intégrez-le aux informations de votre entreprise. Les clients choisissent un service et un créneau dans leur navigateur, sans compte client.' },
        { heading: 'Choisissez la configuration manuelle ou l’IA facultative', body: 'La configuration manuelle et la réservation de base ne nécessitent pas de crédits IA. La conception facultative par IA utilise des crédits achetés séparément. Vérifiez les modifications proposées avant de publier; votre site reste relié au parcours de réservation Luster.' },
      ],
      questions: [
        { question: 'Les changements de site remplacent-ils mon système de réservation?', answer: 'Votre site est le point d’entrée public de Luster. Les services et disponibilités restent gérés dans votre espace Luster plutôt que dans un autre outil de rendez-vous.' },
        { question: 'Les clients peuvent-ils gérer leur réservation ensuite?', answer: 'Ils utilisent le lien privé de leur confirmation pour consulter, déplacer ou annuler leur rendez-vous, selon les règles du salon.' },
      ],
    },
    reminders: {
      path: '/features/appointment-reminders',
      title: 'Rappels de rendez-vous pour les pros des ongles | Luster',
      description: 'Découvrez les confirmations, rappels par courriel et crédits SMS facultatifs de Luster pour les professionnels des ongles et les salons.',
      heading: 'Des rappels reliés à votre activité ongulaire.',
      intro: 'Regroupez les informations de rendez-vous et les communications clients. Luster propose des courriels et des SMS facultatifs, avec les préférences et informations de livraison dans votre espace propriétaire.',
      sections: [
        { heading: 'Commencez par les courriels de rendez-vous', body: 'La réservation de base inclut les confirmations et rappels par courriel. Les clients peuvent consulter les détails de leur visite et gérer leur réservation à l’aide de leur lien sécurisé, selon vos règles.' },
        { heading: 'Utilisez les SMS selon vos besoins', body: 'Les SMS sont facultatifs et nécessitent le consentement du client. Les nouveaux salons admissibles reçoivent 100 crédits SMS après vérification de leurs coordonnées. Les messages supplémentaires utilisent des crédits achetés séparément.' },
        { heading: 'Comprenez ce que couvre un crédit SMS', body: 'L’utilisation des SMS est mesurée en segments. Un message long peut utiliser plusieurs crédits. L’envoi dépend du consentement, de vos paramètres et du solde disponible. Consultez les tarifs et taxes applicables avant de payer dans Usage & SMS.' },
      ],
      questions: [
        { question: 'Les SMS illimités sont-ils inclus?', answer: 'Non. La réservation de base est gratuite; les SMS utilisent un solde de crédits. Un message long peut utiliser plusieurs crédits. Tout achat supplémentaire est facultatif.' },
        { question: 'Un problème de livraison signifie-t-il que le rendez-vous a échoué?', answer: 'Non. Consultez le rendez-vous dans Luster. Un problème de livraison est distinct de l’état de la réservation.' },
      ],
    },
    free: {
      path: '/free-booking',
      title: 'Réservation gratuite pour les pros des ongles | Luster',
      description: 'Découvrez la réservation de base gratuite de Luster et les crédits SMS et IA facultatifs. Aucun abonnement mensuel de réservation n’est requis.',
      heading: 'La réservation de base gratuite. Des options clairement expliquées.',
      intro: 'Commencez avec une page de réservation, vos services, vos rendez-vous et la gestion des clients. Aucun abonnement mensuel de réservation de base n’est requis. Les crédits SMS et de conception par IA sont facultatifs et s’achètent séparément.',
      sections: [
        { heading: 'Gérez vos réservations sans abonnement mensuel', body: 'Gérez services, disponibilités, réservations en ligne et historique client dans Luster. Les confirmations et rappels par courriel sont inclus. Les clients peuvent réserver depuis votre site sans créer de compte.' },
        { heading: 'Ajoutez des crédits SMS si vous le souhaitez', body: 'Les nouveaux salons admissibles reçoivent 100 crédits SMS une seule fois après vérification de leurs coordonnées. Les crédits supplémentaires sont des achats ponctuels. L’utilisation est mesurée en segments et le prix ainsi que les taxes applicables sont affichés avant le paiement.' },
        { heading: 'Gardez la conception par IA facultative', body: 'La configuration manuelle du site et les réservations ordinaires n’utilisent pas de crédits IA. Si vous choisissez la conception par IA, elle utilise un solde distinct. Vérifiez les détails de l’achat et les modifications proposées avant de continuer.' },
      ],
      questions: [
        { question: 'Faut-il acheter des crédits SMS pour recevoir des réservations?', answer: 'Non. Les SMS sont facultatifs. La réservation en ligne de base et les courriels de rendez-vous ne nécessitent pas d’achat de crédits SMS.' },
        { question: 'Où consulter le prix actuel des options?', answer: 'Votre espace affiche les tarifs SMS dans Usage & SMS et les détails d’achat des crédits IA avant paiement. Cette page ne crée pas d’abonnement et ne garantit pas un prix fixe par crédit.' },
      ],
    },
  },
};

export function getMarketingLocale(locale: string): MarketingLocale {
  return locale === 'fr' ? 'fr' : 'en';
}
