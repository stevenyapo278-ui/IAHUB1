import { useEffect, useRef } from 'react';
import api from '../api/client';
import { isVoiceAlertEnabled, getVoiceAlertLang } from '../utils/voiceAlertPreference';

// Messages d'annonce traduits — la langue affichée suit le réglage choisi par l'utilisateur dans
// Paramètres > Automatisation (préférence locale au navigateur, indépendante des autres utilisateurs).
const ANNOUNCE_MESSAGES = {
  drafts: {
    'fr-FR': 'Nouvelle réponse IA en attente de validation.',
    'en-US': 'New AI reply waiting for approval.',
    'es-ES': 'Nueva respuesta de la IA en espera de validación.',
    'de-DE': 'Neue KI-Antwort wartet auf Genehmigung.',
    'pt-PT': 'Nova resposta da IA à espera de validação.',
    'ar-SA': 'رد جديد من الذكاء الاصطناعي في انتظار الموافقة.',
  },
  review: {
    'fr-FR': "Un ticket nécessite une revue humaine, l'intelligence artificielle n'est pas certaine de la décision à prendre.",
    'en-US': 'A ticket needs human review, the AI is not confident about the decision to make.',
    'es-ES': 'Un ticket necesita revisión humana, la IA no está segura de la decisión a tomar.',
    'de-DE': 'Ein Ticket benötigt eine menschliche Überprüfung, die KI ist sich der Entscheidung nicht sicher.',
    'pt-PT': 'Um ticket precisa de revisão humana, a IA não tem certeza da decisão a tomar.',
    'ar-SA': 'تذكرة تحتاج إلى مراجعة بشرية، الذكاء الاصطناعي غير متأكد من القرار المناسب.',
  },
  draftsOverdue: {
    'fr-FR': "Rappel : une réponse IA attend toujours votre validation.",
    'en-US': 'Reminder: an AI reply is still waiting for your approval.',
    'es-ES': 'Recordatorio: una respuesta de la IA sigue esperando su validación.',
    'de-DE': 'Erinnerung: Eine KI-Antwort wartet immer noch auf Ihre Genehmigung.',
    'pt-PT': 'Lembrete: uma resposta da IA ainda está à espera da sua validação.',
    'ar-SA': 'تذكير: لا يزال هناك رد من الذكاء الاصطناعي في انتظار موافقتك.',
  },
};

const POLL_INTERVAL_MS = 15000;

// Surveille en arrière-plan les brouillons IA en attente et les tickets nécessitant une revue
// humaine, et déclenche une alerte vocale (synthèse vocale du navigateur) sur tout changement —
// monté une seule fois dans MainLayout pour fonctionner sur toutes les pages, pas seulement le
// Dashboard (qui garde son propre polling pour l'affichage détaillé, indépendant de cette alerte).
export function useVoiceAlerts() {
  const autoSendAiEmailsRef = useRef(false);
  const draftReminderDelayMinutesRef = useRef(30);
  // Brouillons déjà signalés "en retard" lors du cycle précédent — sert à ne ré-annoncer
  // que les brouillons qui viennent juste de dépasser le délai, pas à chaque rafraîchissement.
  const overdueAnnouncedRef = useRef(new Set());
  const seenIdsRef = useRef({ drafts: new Set(), review: new Set(), draftsOverdue: new Set() });

  function announceIfNew(kind, currentIds) {
    const seen = seenIdsRef.current[kind];
    const newOnes = currentIds.filter((id) => !seen.has(id));
    currentIds.forEach((id) => seen.add(id));

    if (newOnes.length === 0 || typeof window === 'undefined' || !window.speechSynthesis) return;
    if (!isVoiceAlertEnabled()) return;
    // Si l'auto-envoi des emails IA est activé (Paramètres > Automatisation), les réponses partent
    // directement sans jamais créer de brouillon en attente — annoncer "drafts" n'aurait alors aucun sens.
    if (kind === 'drafts' && autoSendAiEmailsRef.current) return;

    const lang = getVoiceAlertLang();
    const message = ANNOUNCE_MESSAGES[kind][lang] || ANNOUNCE_MESSAGES[kind]['fr-FR'];
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = lang;
    window.speechSynthesis.speak(utterance);
  }

  function poll() {
    api.get('/system-settings').then(({ data }) => {
      autoSendAiEmailsRef.current = !!data.autoSendAiEmails;
      draftReminderDelayMinutesRef.current = data.draftReminderDelayMinutes || 30;
    }).catch(() => {});

    api.get('/dashboard/pending-ai-drafts').then(({ data }) => {
      announceIfNew('drafts', data.map((d) => d.id));

      const delayMs = draftReminderDelayMinutesRef.current * 60 * 1000;
      const now = Date.now();
      const overdueIds = data.filter((d) => now - new Date(d.createdAt).getTime() >= delayMs).map((d) => d.id);
      const stillPendingIds = new Set(data.map((d) => d.id));
      for (const id of overdueAnnouncedRef.current) {
        if (!stillPendingIds.has(id)) overdueAnnouncedRef.current.delete(id);
      }
      announceIfNew('draftsOverdue', overdueIds.filter((id) => !overdueAnnouncedRef.current.has(id)));
      overdueIds.forEach((id) => overdueAnnouncedRef.current.add(id));
    }).catch(() => {});

    api.get('/dashboard/needs-human-review').then(({ data }) => {
      announceIfNew('review', data.map((e) => e.ticketId));
    }).catch(() => {});
  }

  useEffect(() => {
    poll();
    const intervalId = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, []);
}
