import api from '../api/client';

// Libellés humains des outils agentic — affichés pendant l'exécution (streaming SSE).
export const TOOL_LABELS = {
  search_tickets: 'Recherche de tickets',
  search_knowledge: 'Consultation de la base de connaissances',
  search_emails: 'Lecture des mails',
  search_locations: 'Recherche de sites',
  search_teams: 'Recherche d\'équipes',
  search_users: 'Recherche d\'utilisateurs',
  search_inventory: 'Recherche d\'équipements',
  find_similar_tickets: 'Comparaison d\'incidents similaires',
  get_ticket_details: 'Lecture du ticket',
  create_ticket: 'Création du ticket',
  add_ticket_followup: 'Ajout du suivi',
  update_ticket: 'Mise à jour du ticket',
  send_ticket_report: 'Génération du rapport',
  get_user_profile: 'Lecture du profil',
  get_my_tickets: 'Lecture de vos tickets',
  get_open_tickets: 'Lecture des tickets ouverts',
  get_ticket_stats: 'Calcul des statistiques',
  analytics_query: 'Analyse des données',
  escalation_check: 'Vérification d\'escalade',
  sla_check: 'Vérification des SLA',
};

// POST /api/chat en mode SSE.
//
// La boucle agentic du chatbot peut enchaîner jusqu'à 6 tours d'outils LLM, soit
// plusieurs dizaines de secondes pendant lesquelles un appel axios classique ne
// renvoie RIEN. Ce client lit le flux d'événements et remonte chaque outil au fil
// de l'eau via `onTool`, puis résout la réponse finale.
//
// Repli gracieux : si le serveur ne renvoie pas `text/event-stream` (proxy qui
// dégrade, back ancien), on rejoue la même requête en JSON simple pour ne pas
// perdre le message de l'utilisateur.
export async function postChatWithStream(body, { onTool } = {}) {
  const token = localStorage.getItem('token');
  // On dérive l'URL du baseURL axios (VITE_API_URL en prod, proxy /api en dev)
  // plutôt que de durcir « /api », qui casserait selon l'environnement.
  const base = (api.defaults.baseURL || '/api').replace(/\/+$/, '');

  const res = await fetch(`${base}/chat?stream=1`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  const contentType = res.headers.get('content-type') || '';
  if (!res.ok || !contentType.includes('text/event-stream')) {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalData = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Les événements SSE sont séparés par une ligne vide ; on garde le dernier
    // fragment (potentiellement incomplet) dans le buffer.
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';

    for (const part of parts) {
      let eventName = 'message';
      let dataLine = '';
      for (const line of part.split('\n')) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLine += line.slice(5).trim();
      }
      if (!dataLine) continue;

      let payload;
      try { payload = JSON.parse(dataLine); } catch { continue; }

      if (eventName === 'tool') {
        onTool?.(payload);
      } else if (eventName === 'final') {
        finalData = payload;
      } else if (eventName === 'error') {
        throw new Error(payload.error || 'Erreur du chatbot');
      }
    }
  }

  onTool?.(null);
  if (!finalData) throw new Error('Réponse stream incomplète');
  return finalData;
}
