import { useEffect, useRef } from 'react';
import api from '../api/client';
import { isVoiceAlertEnabled, getVoiceAlertLang } from '../utils/voiceAlertPreference';

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

function getSynth() {
  if (typeof window === 'undefined') return null;
  return window.speechSynthesis || null;
}

function safeSpeak(text, lang) {
  const synth = getSynth();
  if (!synth) return;

  synth.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 1;
  utterance.pitch = 1;

  const voices = synth.getVoices();
  const match = voices.find((v) => v.lang === lang);
  if (match) utterance.voice = match;

  utterance.onstart = () => synth.resume();
  synth.speak(utterance);
}

export function useVoiceAlerts() {
  const autoSendAiEmailsRef = useRef(false);
  const draftReminderDelayMinutesRef = useRef(30);
  const overdueAnnouncedRef = useRef(new Set());
  const seenIdsRef = useRef({ drafts: new Set(), review: new Set(), draftsOverdue: new Set() });

  function announceIfNew(kind, currentIds) {
    const seen = seenIdsRef.current[kind];
    const newOnes = currentIds.filter((id) => !seen.has(id));
    currentIds.forEach((id) => seen.add(id));

    if (newOnes.length === 0) return;
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    if (!isVoiceAlertEnabled()) return;
    if (kind === 'drafts' && autoSendAiEmailsRef.current) return;

    const lang = getVoiceAlertLang();
    const message = ANNOUNCE_MESSAGES[kind][lang] || ANNOUNCE_MESSAGES[kind]['fr-FR'];
    safeSpeak(message, lang);
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
    const synth = getSynth();
    if (synth && typeof synth.resume === 'function') synth.resume();

    if (synth && synth.onvoiceschanged !== undefined) {
      synth.onvoiceschanged = () => {};
    }

    poll();
    const intervalId = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, []);
}
