# Onboarding feedback boundary

This folder owns transient, accessible feedback for the standalone onboarding UX Lab.

- Screens send semantic events (`selection`, `added`, `completed`, `stage_complete`, or `milestone`).
- `FeedbackProvider` renders one transient visual status and one deduplicated polite live region. Onboarding screens clear obsolete queued visuals when routing, and dialogs suppress shell-level visuals while preserving announcements and capability feedback. It is not a second queued toast system.
- `feedback.css` keeps screen-level visuals above the sticky action footer through one responsive clearance token; dialog actions are never covered.
- `lab-feedback-port.ts` capability-detects `navigator.vibrate`. It silently no-ops on iOS Safari and other unsupported browsers, while visual/text feedback always remains.
- Reduced-motion and test modes suppress haptic/nonessential motion. Navigation is never delayed.
- Screens may persist only milestone IDs in the existing onboarding draft. Transient animation state is never serialized.

Production integration can replace `LAB_FEEDBACK_CAPABILITY_PORT` with a native-shell or PWA bridge. Delete that Lab port when the native capability is authoritative; the semantic screen calls and accessible visual fallback remain.
