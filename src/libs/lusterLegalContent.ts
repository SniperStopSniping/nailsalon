// English policy text is retained verbatim; the French version follows the same disclosures.
export const privacyEnglish = {
  title: 'Privacy Policy',
  updated: 'October 20, 2026',
  intro: 'Luster provides free salon booking and CRM tools for nail professionals. This policy explains the information we process to operate booking pages, owner workspaces, appointment communications, and optional integrations.',
  sections: [
    {
      title: 'Information we process',
      paragraphs: [
        'We process salon profile details, services, availability, owner account information, and customer contact and appointment information supplied through Luster.',
        'Customer phone numbers are contact information and are not treated as verified identity. Transactional texting is optional and requires separate consent.',
      ],
    },
    {
      title: 'Google Calendar data',
      paragraphs: [
        'When a salon owner connects Google Calendar, Luster stores the connected account email and Google account identifier and reads the list of calendars the owner can access. The owner chooses which calendar receives Luster appointments and which calendars Luster checks for booking conflicts.',
        'For those selected calendars, Luster reads free/busy time and event information made available by Google, such as event title, date and time, description, location, status, and attendee or client contact details when present in event data. Luster stores the event information in the salon workspace to display the schedule, let the owner review or convert selected events, and keep Luster-linked appointments synchronized when they change in either system.',
        'Google refresh tokens are encrypted at rest. Access is scoped to the connected salon, and Calendar data is not sold, transferred for advertising, or used to train generalized artificial intelligence or machine learning models.',
      ],
    },
    {
      title: 'Data protection and security',
      paragraphs: [
        'To protect sensitive information, including Google user data, Luster uses HTTPS (TLS) to encrypt data in transit between your browser and our production service, and between Luster and Google’s OAuth and Calendar APIs.',
        'Google OAuth refresh tokens are encrypted with AES-256-GCM authenticated encryption before they are stored in our database. The encryption key is kept in server configuration separately from the stored tokens. Refresh tokens are decrypted only in server-side integration code when needed for the Google connection; they are not sent to public booking pages.',
        'Server-side authentication and salon-specific authorization checks protect integration settings and synchronized Google event details. Calendar connections and synchronized event records are associated with the connected salon, and access is checked against the signed-in user’s permission to manage that salon. The Google connection also uses signed, expiring authorization state to reject tampered or expired authorization responses.',
      ],
    },
    {
      title: 'Optional AI service guidance',
      paragraphs: [
        'Optional customer and owner text assistants use OpenAI to understand messages and help with services and settings. Messages you enter, relevant prior AI conversation, and salon service or setup information may be sent to OpenAI for that purpose. You can use ordinary online booking without the assistant.',
        'Luster calculates appointment availability on its own server using salon rules, appointments, and connected Google Calendar conflicts. Luster does not include application-controlled Google Calendar events, busy windows, calculated openings, selected appointment times, or booking confirmations in these text assistants’ model requests. Availability previews and booking selections, reviews, and confirmations are handled separately by Luster.',
        'If you independently type or paste scheduling or other personal information into chat, that message may still be sent to OpenAI. Luster cannot reliably identify the source of arbitrary messages. Avoid including sensitive information in chat.',
        'The AI phone receptionist and owner microphone sandbox are retired. This change does not erase historical conversations, call summaries, previously issued provider sessions, or provider records. Luster requests no stored response application state for its text assistant calls; that setting does not guarantee zero provider retention. Other provider security and abuse-monitoring retention may apply. Luster does not use Google Calendar data to train generalized AI or machine learning models.',
      ],
    },
    {
      title: 'Google API Services Limited Use',
      paragraphs: [
        'Luster’s use and transfer of information received from Google APIs to any other app adheres to the Google API Services User Data Policy, including the Limited Use requirements.',
        'For owner-connected Calendar accounts, Luster requests separate permissions to list calendars without changing them, read free and busy time, and read and synchronize event information on calendars the owner selects. Google’s event permission covers calendars accessible to the connected account; Luster uses the calendar selections described above. Luster does not request Google’s full Calendar scope for this OAuth connection.',
        'Human access to Google user data is limited to the cases the Limited Use requirements permit: with the owner’s explicit consent, for security purposes, to comply with applicable law, or where the data has been aggregated and anonymized for internal operations.',
      ],
    },
    {
      title: 'Deleting Google data',
      paragraphs: [
        'A salon owner can disconnect Google Calendar at any time from the Luster workspace. Disconnecting asks Google to revoke Luster’s access and removes the stored OAuth connection, refresh token, connected account email, and connected account identifier. Calendar event information already synchronized into the salon workspace is not automatically removed when the connection is disconnected.',
        'Owners may also revoke Luster’s access directly from their Google Account permissions page. To request deletion of a Luster workspace and the salon records associated with it, email support@lustergel.app.',
      ],
    },
    {
      title: 'How information is used',
      paragraphs: [
        'Information is used to provide bookings, salon CRM tools, reminders, appointment management links, security, support, and integration health. Luster product marketing to owners requires separate consent.',
      ],
    },
    {
      title: 'Service providers and retention',
      paragraphs: [
        'Luster uses infrastructure and account, email, Calendar, and optional messaging providers only as needed to operate the service. Access tokens, passwords, session cookies, and appointment capability tokens are never exposed through public salon APIs.',
        'Information is retained only as long as needed for the service, legal obligations, security, and legitimate salon records. Owners may disconnect Google Calendar at any time from their Luster workspace.',
      ],
    },
    {
      title: 'Your choices',
      paragraphs: [
        'Salon owners can update salon information, disconnect integrations, and request account or data support. Customers can use their secure appointment-management link to reschedule or cancel without creating an account.',
      ],
    },
  ],
};
export const termsEnglish = {
  title: 'Terms of Service',
  updated: 'October 10, 2026',
  intro: 'These terms apply when a salon owner or customer uses Luster booking pages, owner workspaces, appointment tools, or optional integrations.',
  sections: [
    {
      title: 'The Luster service',
      paragraphs: [
        'Luster provides booking, customer relationship, service, schedule, and integration tools for nail professionals. Salons remain responsible for their services, prices, schedules, customer relationships, and legal obligations.',
      ],
    },
    {
      title: 'Accounts and access',
      paragraphs: [
        'Salon owners must provide accurate account information, keep credentials secure, and use only salons they are authorized to manage. Customer appointment-management links are private capability links and must not be shared publicly.',
      ],
    },
    {
      title: 'Google Calendar and messaging',
      paragraphs: [
        'Google Calendar is optional. A connected owner chooses which calendars Luster may use to check availability and display events, and which calendar receives Luster appointments. Luster can synchronize Luster-linked appointments and show selected events for owner review or conversion. Owners can disconnect the integration at any time; event information already synchronized into the salon workspace is not automatically removed on disconnect.',
        'Twilio messaging is optional and salon-funded. Messaging failures must never be treated as proof that a booking failed; the Luster appointment record remains the source of truth.',
      ],
    },
    {
      title: 'Acceptable use',
      paragraphs: [
        'Users may not misuse the service, access another salon, send unlawful messages, interfere with security, or use customer appointment consent for unrelated marketing.',
      ],
    },
    {
      title: 'Availability and changes',
      paragraphs: [
        'Luster may improve, limit, or discontinue features and may suspend abusive or unsafe use. We work to keep bookings available, but third-party integrations and internet services may occasionally be unavailable.',
      ],
    },
    {
      title: 'Responsibility',
      paragraphs: [
        'To the extent permitted by law, Luster is provided without guarantees that every integration or delivery provider will always be available. Nothing in these terms limits rights that cannot legally be limited.',
      ],
    },
  ],
};

export const privacyFrench = {
  title: 'Politique de confidentialité',
  updated: '20 octobre 2026',
  intro: 'Luster propose des outils gratuits de réservation et de gestion des clients pour les professionnels des ongles. Cette politique explique les informations que nous traitons pour exploiter les pages de réservation, les espaces propriétaires, les communications de rendez-vous et les intégrations facultatives.',
  sections: [
    {
      title: 'Informations que nous traitons',
      paragraphs: [
        'Nous traitons les informations du profil du salon, ses services, ses disponibilités, les données du compte propriétaire ainsi que les coordonnées et informations de rendez-vous des clients fournies dans Luster.',
        'Les numéros de téléphone des clients sont des coordonnées et ne sont pas considérés comme une identité vérifiée. Les SMS transactionnels sont facultatifs et nécessitent un consentement distinct.',
      ],
    },
    {
      title: 'Données de Google Agenda',
      paragraphs: [
        'Lorsqu’un propriétaire connecte Google Agenda, Luster conserve l’adresse courriel et l’identifiant du compte Google connecté et lit la liste des agendas auxquels ce propriétaire a accès. Le propriétaire choisit l’agenda qui reçoit les rendez-vous Luster et ceux qui servent à vérifier les conflits de réservation.',
        'Pour ces agendas sélectionnés, Luster lit les périodes libres ou occupées et les informations d’événements fournies par Google, comme le titre, la date, l’heure, la description, le lieu, l’état et les coordonnées des participants ou clients lorsqu’elles figurent dans les données. Luster conserve ces informations dans l’espace du salon pour afficher le planning, permettre au propriétaire d’examiner ou de convertir les événements sélectionnés et synchroniser les rendez-vous liés à Luster lorsqu’ils changent dans l’un ou l’autre système.',
        'Les jetons d’actualisation Google sont chiffrés au repos. L’accès est limité au salon connecté et les données d’Agenda ne sont ni vendues, ni transférées à des fins publicitaires, ni utilisées pour entraîner des modèles généralisés d’intelligence artificielle ou d’apprentissage automatique.',
      ],
    },
    {
      title: 'Protection et sécurité des données',
      paragraphs: [
        'Pour protéger les informations sensibles, y compris les données des utilisateurs Google, Luster utilise HTTPS (TLS) pour chiffrer les données en transit entre votre navigateur et notre service de production ainsi qu’entre Luster et les API OAuth et Agenda de Google.',
        'Les jetons d’actualisation Google OAuth sont chiffrés avec le chiffrement authentifié AES-256-GCM avant leur stockage dans notre base de données. La clé est conservée dans la configuration du serveur, séparément des jetons. Les jetons ne sont déchiffrés que dans le code d’intégration côté serveur lorsque la connexion Google le nécessite; ils ne sont pas envoyés aux pages publiques de réservation.',
        'L’authentification côté serveur et les contrôles d’autorisation propres au salon protègent les paramètres d’intégration et les détails synchronisés des événements Google. Les connexions Agenda et les événements synchronisés sont associés au salon connecté. L’accès est vérifié selon l’autorisation de l’utilisateur connecté à gérer ce salon. La connexion Google utilise également un état d’autorisation signé et limité dans le temps pour refuser les réponses modifiées ou expirées.',
      ],
    },
    {
      title: 'Assistance facultative par IA',
      paragraphs: [
        'Les assistants textuels facultatifs pour les clients et propriétaires utilisent OpenAI pour comprendre les messages et aider à gérer les services et paramètres. Les messages saisis, les échanges antérieurs pertinents avec l’IA et les informations sur les services ou la configuration du salon peuvent être envoyés à OpenAI à cette fin. La réservation en ligne ordinaire reste accessible sans assistant.',
        'Luster calcule les disponibilités sur son propre serveur à partir des règles du salon, des rendez-vous et des conflits Google Agenda connectés. Luster n’inclut pas les événements Google Agenda contrôlés par l’application, les périodes occupées, les créneaux calculés, les heures de rendez-vous sélectionnées ou les confirmations dans les requêtes de modèle de ces assistants textuels. Les aperçus de disponibilité, les sélections, les vérifications et les confirmations de réservation sont traités séparément par Luster.',
        'Si vous saisissez ou collez vous-même des informations de planning ou d’autres données personnelles dans la conversation, ce message peut néanmoins être envoyé à OpenAI. Luster ne peut pas identifier de manière fiable la source de messages arbitraires. Évitez de saisir des informations sensibles dans la conversation.',
        'Le réceptionniste téléphonique par IA et l’environnement de test du microphone propriétaire sont retirés. Ce changement n’efface pas les conversations historiques, résumés d’appels, sessions fournisseur déjà émises ou dossiers du fournisseur. Pour ses appels d’assistant textuel, Luster demande de ne pas conserver l’état applicatif des réponses; ce paramètre ne garantit pas l’absence de conservation par le fournisseur. D’autres règles de conservation pour la sécurité et la surveillance des abus peuvent s’appliquer. Luster n’utilise pas les données Google Agenda pour entraîner des modèles généralisés d’intelligence artificielle ou d’apprentissage automatique.',
      ],
    },
    {
      title: 'Utilisation limitée des services API Google',
      paragraphs: [
        'L’utilisation et le transfert par Luster des informations reçues des API Google vers toute autre application respectent la politique Google API Services User Data Policy, y compris ses exigences Limited Use.',
        'Pour les comptes Agenda connectés par un propriétaire, Luster demande des autorisations distinctes pour lister les agendas sans les modifier, lire les périodes libres et occupées et lire et synchroniser les événements des agendas sélectionnés. L’autorisation d’événement de Google couvre les agendas accessibles au compte connecté; Luster utilise les sélections décrites ci-dessus. Luster ne demande pas la portée complète Google Calendar pour cette connexion OAuth.',
        'L’accès humain aux données Google se limite aux cas autorisés par les exigences Limited Use : avec le consentement explicite du propriétaire, pour la sécurité, pour respecter la loi ou lorsque les données sont agrégées et anonymisées pour les opérations internes.',
      ],
    },
    {
      title: 'Suppression des données Google',
      paragraphs: [
        'Un propriétaire peut déconnecter Google Agenda à tout moment dans son espace Luster. La déconnexion demande à Google de révoquer l’accès de Luster et supprime la connexion OAuth stockée, le jeton d’actualisation, l’adresse courriel et l’identifiant du compte connecté. Les informations d’événements déjà synchronisées dans l’espace du salon ne sont pas automatiquement supprimées lors de la déconnexion.',
        'Les propriétaires peuvent également révoquer l’accès de Luster dans la page des autorisations de leur compte Google. Pour demander la suppression d’un espace Luster et des dossiers du salon qui lui sont associés, écrivez à support@lustergel.app.',
      ],
    },
    {
      title: 'Utilisation des informations',
      paragraphs: [
        'Les informations servent aux réservations, à la gestion des clients du salon, aux rappels, aux liens de gestion de rendez-vous, à la sécurité, à l’assistance et au suivi des intégrations. Le marketing de produits Luster auprès des propriétaires nécessite un consentement distinct.',
      ],
    },
    {
      title: 'Prestataires et conservation',
      paragraphs: [
        'Luster utilise des prestataires d’infrastructure, de compte, de courriel, d’Agenda et de messagerie facultative uniquement selon les besoins du service. Les jetons d’accès, mots de passe, cookies de session et jetons privés de rendez-vous ne sont jamais exposés par les API publiques des salons.',
        'Les informations ne sont conservées que le temps nécessaire au service, aux obligations légales, à la sécurité et aux dossiers légitimes du salon. Les propriétaires peuvent déconnecter Google Agenda à tout moment dans leur espace Luster.',
      ],
    },
    {
      title: 'Vos choix',
      paragraphs: [
        'Les propriétaires peuvent modifier les informations du salon, déconnecter les intégrations et demander de l’aide pour leur compte ou leurs données. Les clients peuvent utiliser leur lien sécurisé de gestion de rendez-vous pour déplacer ou annuler sans créer de compte.',
      ],
    },
  ],
};

export const termsFrench = {
  title: 'Conditions d’utilisation',
  updated: '10 octobre 2026',
  intro: 'Ces conditions s’appliquent lorsqu’un propriétaire de salon ou un client utilise les pages de réservation Luster, les espaces propriétaires, les outils de rendez-vous ou les intégrations facultatives.',
  sections: [
    {
      title: 'Le service Luster',
      paragraphs: ['Luster propose aux professionnels des ongles des outils de réservation, de gestion des clients, de services, de planning et d’intégration. Les salons restent responsables de leurs services, tarifs, horaires, relations clients et obligations légales.'],
    },
    {
      title: 'Comptes et accès',
      paragraphs: ['Les propriétaires doivent fournir des informations exactes, protéger leurs identifiants et utiliser uniquement les salons qu’ils sont autorisés à gérer. Les liens de gestion de rendez-vous des clients donnent un accès privé et ne doivent pas être partagés publiquement.'],
    },
    {
      title: 'Google Agenda et messagerie',
      paragraphs: [
        'Google Agenda est facultatif. Un propriétaire connecté choisit les agendas que Luster peut utiliser pour vérifier les disponibilités et afficher des événements, ainsi que celui qui reçoit les rendez-vous Luster. Luster peut synchroniser les rendez-vous liés à Luster et afficher les événements sélectionnés pour examen ou conversion par le propriétaire. Les propriétaires peuvent déconnecter l’intégration à tout moment; les informations d’événements déjà synchronisées dans l’espace du salon ne sont pas automatiquement supprimées lors de la déconnexion.',
        'La messagerie Twilio est facultative et financée par le salon. Un échec de messagerie ne doit jamais être considéré comme la preuve qu’une réservation a échoué; le dossier de rendez-vous Luster reste la référence.',
      ],
    },
    {
      title: 'Utilisation acceptable',
      paragraphs: ['Les utilisateurs ne peuvent pas détourner le service, accéder à un autre salon, envoyer des messages illégaux, compromettre la sécurité ou utiliser le consentement aux communications de rendez-vous pour du marketing sans rapport.'],
    },
    {
      title: 'Disponibilité et modifications',
      paragraphs: ['Luster peut améliorer, limiter ou interrompre certaines fonctions et suspendre une utilisation abusive ou dangereuse. Nous travaillons à maintenir les réservations disponibles, mais les intégrations tierces et services internet peuvent parfois être indisponibles.'],
    },
    {
      title: 'Responsabilité',
      paragraphs: ['Dans la mesure permise par la loi, Luster est fourni sans garantie que chaque intégration ou prestataire de livraison sera toujours disponible. Ces conditions ne limitent aucun droit qui ne peut légalement être limité.'],
    },
  ],
};
