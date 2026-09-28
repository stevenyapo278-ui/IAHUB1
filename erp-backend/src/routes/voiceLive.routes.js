const http = require('http');
const https = require('https');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const { GoogleGenAI } = require('@google/genai');
const prisma = require('../prismaClient');
const { logger } = require('../utils/logger');
const analyticsTools = require('../services/analyticsTools');
const { searchKnowledge } = require('../services/knowledgeSearch');
const { searchTeams, searchTickets, buildSearchQuery, handleMessage, executeTool: chatbotExecuteTool } = require('../services/chatbotService');
const { buildToolResultPayload, toGeminiResponse } = require('../services/voicePayloads');
const jwt = require('jsonwebtoken');

// Modèle Live officiel GA (doc Google Cloud Gemini Enterprise Agent Platform) :
// entrée attendue PCM mono 16 kHz, sortie 24 kHz.
const LIVE_MODEL = process.env.LIVE_MODEL || 'gemini-3.8-live';
const LIVE_VOICE = 'Aoede';
const LIVE_PORT = process.env.VOICE_LIVE_PORT || 4001;

// Périmètre « UI » des compteurs, aligné sur /dashboard/stats (dashboard.routes.js).
// Sans ça, les chiffres vocaux dépassent ceux de l'interface (ex. 48 « ouverts »
// annoncés alors que l'UI en affiche 45) : les tickets en attente d'approbation
// ou rejetés doivent rester hors des statistiques, comme partout ailleurs.
const OPEN_STATUSES = ['NEW', 'OPEN', 'PLANNED', 'PENDING', 'WAITING_FOR_USER'];
const UI_TICKET_BASE = { deletedAt: null, approvalStatus: { notIn: ['PENDING', 'REJECTED'] } };

async function getGeminiApiKey() {
  const provider = await prisma.aiProvider.findFirst({
    where: { name: 'gemini', isActive: true, isDeleted: false },
    include: { keys: { where: { isActive: true }, orderBy: { isDefault: 'desc' } } },
  });
  if (!provider || provider.keys.length === 0) {
    throw new Error('No active Gemini provider configured');
  }
  return provider.keys[0].apiKey;
}

const TICKET_SELECT = {
  id: true, title: true, content: true, status: true, priority: true,
  category: true, locationName: true,
  createdAt: true, updatedAt: true, solvedAt: true, closedAt: true,
  requester: { select: { fullName: true, email: true } },
  assignedTo: { select: { fullName: true, email: true } },
  team: { select: { name: true } },
};

function formatTicket(t) {
  return {
    id: t.id, titre: t.title,
    description: (t.content || '').substring(0, 200),
    statut: t.status, priorite: t.priority,
    categorie: t.category || '',
    lieu: t.locationName || '',
    creeLe: t.createdAt?.toISOString?.() || String(t.createdAt),
    demandeur: t.requester?.fullName || t.requester?.email || 'Inconnu',
    technicien: t.assignedTo?.fullName || t.assignedTo?.email || 'Non assigné',
    equipe: t.team?.name || 'Non assignée',
  };
}

function formatSpokenTextFrench(text) {
  if (!text || typeof text !== 'string') return '';

  return text
    .replace(/[*_~`#]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-+*]\s+/gm, '')
    .replace(/\bNEW\b/g, 'nouveau')
    .replace(/\bOPEN\b/g, 'en cours')
    .replace(/\bPENDING\b/g, 'en attente')
    .replace(/\bWAITING_FOR_USER\b/g, 'en attente de réponse')
    .replace(/\bSOLVED\b/g, 'résolu')
    .replace(/\bCLOSED\b/g, 'fermé')
    .replace(/\bPLANNED\b/g, 'planifié')
    .replace(/\bP1\b/gi, 'priorité 1 critique')
    .replace(/\bP2\b/gi, 'priorité 2 haute')
    .replace(/\bP3\b/gi, 'priorité 3 moyenne')
    .replace(/\bP4\b/gi, 'priorité 4 basse')
    .replace(/#(\d+)/g, 'ticket numéro $1')
    .replace(/\bticket\s*n°?\s*(\d+)/gi, 'ticket numéro $1')
    .replace(/\bAD\b/g, 'Active Directory')
    .replace(/\bSSL\b/g, 'S S L')
    .replace(/\bVPN\b/g, 'V P N')
    .replace(/\bGLPI\b/g, 'G L P I')
    .replace(/\bAPI\b/g, 'A P I')
    .replace(/\bIP\b/g, 'I P')
    .replace(/\bCPU\b/g, 'C P U')
    .replace(/\bRAM\b/g, 'R A M')
    .replace(/\bERP\b/g, 'E R P')
    .replace(/\bIT\b/g, 'I T')
    .replace(/\s+/g, ' ')
    .trim();
}

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'ask_assistant',
        description: `OUTIL PRINCIPAL pour TOUTE question nécessitant des données réelles du helpdesk :
- nombre de tickets, statistiques, classements, rapports
- "mes tickets", "tickets ouverts cette semaine", "tickets de [personne]"
- recherche de tickets par statut / priorité / lieu / équipe / période
- performance, causes racines, distribution par catégorie ou équipe
- demande d'envoi d'un rapport par email (ex: "envoie-moi la liste des tickets de ce mois en xlsx") — l'assistant gère la confirmation puis l'envoi
- toute question du type "combien", "quel est le total", "classement", "rapport"

Passe la question de l'utilisateur TELLE QUELLE (transcription complète).
Ne l'utilise PAS pour créer/modifier un ticket (utilise create_ticket / update_ticket_status).
Ne réponds JAMAIS de mémoire : appelle toujours cet outil pour les chiffres.`,
        parameters: {
          type: 'object',
          properties: {
            question: {
              type: 'string',
              description: "La question exacte de l'utilisateur (transcription complète)",
            },
          },
          required: ['question'],
        },
      },
      {
        name: 'search_tickets',
        description: 'Recherche de tickets par mot-clé, statut, priorité, lieu, équipe, technicien, demandeur, période. Triés du PLUS RÉCENT au plus ancien : avec limit=1 tu obtiens le dernier ticket créé (champ "creeLe" = date de création).',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Mot-clé de recherche dans titre, contenu, lieu, catégorie' },
            status: { type: 'string', enum: ['NEW', 'OPEN', 'PLANNED', 'PENDING', 'WAITING_FOR_USER', 'SOLVED', 'CLOSED'], description: 'Filtrer par statut' },
            priority: { type: 'string', enum: ['P1', 'P2', 'P3', 'P4'], description: 'Filtrer par priorité' },
            locationName: { type: 'string', description: 'Filtrer par lieu/magasin' },
            assignedTo: { type: 'string', description: 'Nom du technicien assigné' },
            requester: { type: 'string', description: 'Nom ou email du demandeur' },
            team: { type: 'string', description: "Nom de l'équipe (ex: Système, Réseau, Sécurité)" },
            category: { type: 'string', description: 'Catégorie du ticket (ex: Réseau, Matériel)' },
            person: { type: 'string', description: 'Nom ou email de la personne (demandeur OU technicien)' },
            period: { type: 'string', description: 'Période: today, yesterday, 7d, 30d, 90d' },
            limit: { type: 'integer', description: 'Nombre max (défaut 20, max 50)' },
          },
        },
      },
      {
        name: 'get_context',
        description: "Page actuelle de l'utilisateur dans l'ERP (route courante). À APPELLER quand la question porte sur « ce ticket », « cette page », « ce que je regarde » — la route contient parfois le numéro de ticket (ex: /tickets/64).",
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'check_ticket',
        description: 'Détails complets d\'un ticket par son numéro.',
        parameters: {
          type: 'object',
          properties: { ticketId: { type: 'integer', description: 'Numéro du ticket' } },
          required: ['ticketId'],
        },
      },
      {
        name: 'get_ticket_summary',
        description: 'Résumé IA d\'un ticket (historique, résolution, etc.).',
        parameters: {
          type: 'object',
          properties: { ticketId: { type: 'integer', description: 'Numéro du ticket' } },
          required: ['ticketId'],
        },
      },
      {
        name: 'get_ticket_count',
        description: 'Nombre de tickets par statut (NEW, OPEN, PLANNED, PENDING, WAITING_FOR_USER, SOLVED, CLOSED) + totaux groupés (ouverts, enAttente, resolus, fermes). Renseigne TOUJOURS period quand l utilisateur mentionne une période (aujourd hui, cette semaine, ce mois, 7d, 30d…).',
        parameters: {
          type: 'object',
          properties: {
            period: { type: 'string', description: 'Période: today, yesterday, this_week, this_month, 7d, 30d, 90d, all (défaut all)' },
          },
        },
      },
      {
        name: 'get_ticket_time_entries',
        description: 'Temps passé sur un ticket.',
        parameters: {
          type: 'object',
          properties: { ticketId: { type: 'integer', description: 'Numéro du ticket' } },
          required: ['ticketId'],
        },
      },
      {
        name: 'get_ticket_links',
        description: 'Liens entre tickets (doublons, bloqués, liés).',
        parameters: {
          type: 'object',
          properties: { ticketId: { type: 'integer', description: 'Numéro du ticket' } },
          required: ['ticketId'],
        },
      },
      {
        name: 'create_ticket',
        description: 'Crée un nouveau ticket.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Titre du ticket' },
            content: { type: 'string', description: 'Description du problème' },
            priority: { type: 'string', enum: ['P1', 'P2', 'P3', 'P4'], description: 'Priorité (défaut P3)' },
            category: { type: 'string', description: 'Catégorie (ex: Réseau, Logiciel, Matériel)' },
            locationName: { type: 'string', description: 'Lieu' },
          },
          required: ['title', 'content'],
        },
      },
      {
        name: 'update_ticket_status',
        description: 'Change le statut d\'un ticket.',
        parameters: {
          type: 'object',
          properties: {
            ticketId: { type: 'integer', description: 'Numéro du ticket' },
            status: { type: 'string', enum: ['NEW', 'OPEN', 'PLANNED', 'PENDING', 'WAITING_FOR_USER', 'SOLVED', 'CLOSED'], description: 'Nouveau statut' },
          },
          required: ['ticketId', 'status'],
        },
      },
      {
        name: 'get_top_locations',
        description: 'Classement des magasins/lieux par nombre de tickets.',
        parameters: {
          type: 'object',
          properties: {
            period: { type: 'string', description: 'Période: today, 7d, 30d, 90d, all' },
            limit: { type: 'integer', description: 'Nombre de résultats (défaut 5)' },
          },
        },
      },
      {
        name: 'get_top_technicians',
        description: 'Classement des techniciens par tickets résolus et performance.',
        parameters: {
          type: 'object',
          properties: {
            period: { type: 'string', description: 'Période: today, 7d, 30d, 90d, all' },
            limit: { type: 'integer', description: 'Nombre de résultats (défaut 10)' },
          },
        },
      },
      {
        name: 'get_team_report',
        description: 'Répartition des tickets ouverts par équipe.',
        parameters: {
          type: 'object',
          properties: {
            period: { type: 'string', description: 'Période: today, 7d, 30d, 90d' },
          },
        },
      },
      {
        name: 'get_category_distribution',
        description: 'Distribution des tickets par catégorie.',
        parameters: {
          type: 'object',
          properties: {
            period: { type: 'string', description: 'Période' },
          },
        },
      },
      {
        name: 'analyze_root_cause',
        description: 'Analyse des causes racines des problèmes à un lieu.',
        parameters: {
          type: 'object',
          properties: {
            locationName: { type: 'string', description: 'Nom du lieu à analyser' },
            filterKeyword: { type: 'string', description: 'Mot-clé de filtrage' },
          },
        },
      },
      {
        name: 'generate_report',
        description: 'Rapport statistique global: total tickets, ouverts, résolus, par statut/priorité.',
        parameters: {
          type: 'object',
          properties: {
            period: { type: 'string', description: 'Période: today, 7d, 30d, 90d' },
          },
        },
      },
      {
        name: 'search_users',
        description: 'Recherche d\'utilisateurs par nom ou email.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Nom ou email' },
          },
          required: ['query'],
        },
      },
      {
        name: 'search_locations',
        description: 'Recherche de lieux/magasins.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Nom du lieu' },
          },
          required: ['query'],
        },
      },
      {
        name: 'search_teams',
        description: 'Recherche d\'équipes et liste de leurs membres.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Nom de l\'équipe' },
          },
          required: ['query'],
        },
      },
      {
        name: 'search_knowledge',
        description: 'Recherche dans la base de connaissances IT.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Mot-clé ou question' },
          },
          required: ['query'],
        },
      },
      {
        name: 'search_inventory',
        description: 'Recherche d\'équipements/inventaire (nom, modèle, numéro de série).',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Mot-clé' },
          },
          required: ['query'],
        },
      },
      {
        name: 'find_similar_tickets',
        description: 'Chercher des tickets similaires à un problème donné, ou à un ticket existant par son numéro (similarité sémantique).',
        parameters: {
          type: 'object',
          properties: {
            ticketId: { type: 'integer', description: 'Numéro du ticket source pour chercher des similaires (optionnel)' },
            title: { type: 'string', description: 'Titre ou description du problème (optionnel si ticketId fourni)' },
            description: { type: 'string', description: 'Description détaillée (optionnel)' },
          },
        },
      },
      {
        name: 'search_emails',
        description: 'Rechercher dans les contenus des mails (entrant + fils de ticket) : dernier mail d\'un expéditeur, fil d\'un ticket, mails d\'une période ou sur un sujet. Retourne extraits avec expéditeur, objet, date, ticket lié.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Requête sémantique (mots-clés, objet, contenu)' },
            fromEmail: { type: 'string', description: 'Filtrer par expéditeur (email ou nom)' },
            ticketId: { type: 'integer', description: 'Filtrer par ticket lié' },
            conversationId: { type: 'string', description: 'Filtrer par fil de conversation Outlook' },
            dateFrom: { type: 'string', description: 'Date début YYYY-MM-DD (inclus)' },
            dateTo: { type: 'string', description: 'Date fin YYYY-MM-DD (inclus)' },
            direction: { type: 'string', description: 'INBOUND (reçu) ou OUTBOUND (envoyé)' },
            limit: { type: 'integer', description: 'Nombre max (défaut 5, max 20)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'add_ticket_followup',
        description: 'Ajouter un commentaire/suivi sur un ticket existant (note, update, retour d\'information). Demande TOUJOURS la confirmation de l\'utilisateur avant de l\'appeler.',
        parameters: {
          type: 'object',
          properties: {
            ticketId: { type: 'integer', description: 'Numéro du ticket' },
            content: { type: 'string', description: 'Contenu du commentaire (texte libre)' },
            isPrivate: { type: 'boolean', description: 'Si true, visible uniquement par l\'équipe interne (défaut: false)' },
          },
          required: ['ticketId', 'content'],
        },
      },
      {
        name: 'send_ticket_report',
        description: "Générer et envoyer un rapport Excel (XLSX) contenant les tickets correspondants par email à l'utilisateur.",
        parameters: {
          type: 'object',
          properties: {
            period: { type: 'string', description: "Période : today, yesterday, 7d, 30d, 90d, this_month (ce mois), last_month (mois dernier)" },
            dateFrom: { type: 'string', description: 'Date de début alternative (YYYY-MM-DD)' },
            dateTo: { type: 'string', description: 'Date de fin alternative (YYYY-MM-DD)' },
            team: { type: 'string', description: "Nom de l'équipe (ex: Système, Réseau, Sécurité)" },
            category: { type: 'string', description: 'Catégorie du ticket (ex: Asten, Réseau, Matériel)' },
            status: { type: 'string', description: 'Statut (NEW, OPEN, PENDING, WAITING_FOR_USER, SOLVED, CLOSED)' },
            priority: { type: 'string', enum: ['P1', 'P2', 'P3', 'P4'], description: 'Filtrer par priorité' },
            search: { type: 'string', description: 'Mot-clé dans le titre ou le contenu des tickets' },
            cc: { type: 'array', items: { type: 'string' }, description: "Adresses email à mettre en copie (CC) — seulement si l'utilisateur en a mentionné dans sa phrase" },
            ccTeams: { type: 'array', items: { type: 'string' }, description: "Noms d'équipes dont TOUS les membres actifs doivent être mis en copie" },
          },
        },
      },
    ],
  },
];

async function executeTool(name, args, { user = null, sessionHistory = null, ws = null, toolCtx = null } = {}) {
  try {
    switch (name) {
      case 'ask_assistant': {
        const question = (args.question || '').trim();
        if (!question) return { error: 'Question vide' };
        // Contexte de navigation : le modèle n'a pas toujours la route en tête
        // (changement de page en session) — on préfixe la question envoyée au pipeline.
        const navPrefix = toolCtx && toolCtx.nav
          ? `[Contexte navigation — page actuelle de l'utilisateur : ${toolCtx.nav}] `
          : '';
        try {
          const startTime = Date.now();
          // Exécution directe sans sur-couche d'audit pour le mode vocal
          const history = Array.isArray(sessionHistory) ? sessionHistory.slice(-6) : [];
          const result = await handleMessage(navPrefix + question, history, user, null, null, { voiceMode: true });
          logger.info(`[voice-live] ask_assistant answered in ${Date.now() - startTime}ms`);

          // Notifier le client de l'état du mode brainstorming
          if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'brainstorm_mode', active: !!result.isBrainstormMode }));
          }

          // Carte « action en attente » : la confirmation d'envoi doit être VISIBLE
          // en mode vocal (badge carte dans le modal), pas seulement entendue.
          if (ws && ws.readyState === 1) {
            if (result.pendingConfirmation) {
              ws.send(JSON.stringify({
                type: 'tool_result',
                name: 'confirmation',
                data: {
                  kind: 'confirmation',
                  tool: result.pendingConfirmation.tool || null,
                  prompt: result.pendingConfirmation.prompt || result.reply || '',
                },
              }));
            } else {
              // Action résolue (exécutée / annulée) → retirer la carte de confirmation
              ws.send(JSON.stringify({ type: 'tool_cleared', name: 'confirmation' }));
            }
          }

          if (Array.isArray(sessionHistory)) {
            sessionHistory.push({ role: 'user', content: question });
            sessionHistory.push({ role: 'assistant', content: result.reply || '' });
            if (sessionHistory.length > 10) sessionHistory.splice(0, sessionHistory.length - 10);
          }
          return {
            success: true,
            answer: result.reply || "Je n'ai pas pu obtenir de réponse.",
            citedTicketIds: result.citedTicketIds || [],
          };
        } catch (err) {
          logger.error(`[voice-live] ask_assistant error: ${err.message}`);
          return {
            success: false,
            answer: 'Je rencontre un souci temporaire pour récupérer ces informations.',
          };
        }
      }
      case 'search_tickets': {
        // Même moteur que le chatbot texte : les filtres structurés (status, priority,
        // locationName, assignedTo, requester, team, category, person, period) annoncés
        // dans le schéma du tool sont réellement appliqués via buildSearchQuery. On passe
        // l'utilisateur (user) pour appliquer le cloisonnement par rôle (RBAC).
        const hasStructuredFilters = !!(args.status || args.priority || args.locationName || args.assignedTo || args.requester || args.team || args.person || args.category);
        // SANS mot-clé (ex: {limit:1} pour "le dernier ticket créé") : le chemin AI de
        // searchTickets() renvoie vide dès que query est nulle → requête Prisma directe
        // (tri createdAt desc) au lieu de perdre l'appel.
        if (hasStructuredFilters || !String(args.query || '').trim()) {
          const where = buildSearchQuery({
            teamName: args.team || undefined,
            personName: args.person || undefined,
            statuses: args.status ? [args.status] : undefined,
            priorities: args.priority ? [args.priority] : undefined,
            locationName: args.locationName || undefined,
            assignedToName: args.assignedTo || undefined,
            requesterName: args.requester || undefined,
            keyword: args.query || args.category || undefined,
            dateFrom: args.period && args.period !== 'all' ? getPeriodDate(args.period)?.toISOString?.() : undefined,
          }, user);
          const tickets = await prisma.ticket.findMany({
            where,
            take: Math.min(Number(args.limit) || 20, 50),
            orderBy: { createdAt: 'desc' },
            select: {
              id: true, title: true, status: true, priority: true, locationName: true,
              createdAt: true,
              requester: { select: { fullName: true, email: true } },
              assignedTo: { select: { fullName: true, email: true } },
              team: { select: { name: true } },
            },
          });
          return {
            total: tickets.length,
            tickets: tickets.map((t) => ({
              id: t.id, titre: t.title, statut: t.status, priorite: t.priority,
              lieu: t.locationName || '',
              demandeur: t.requester?.fullName || t.requester?.email || '',
              technicien: t.assignedTo?.fullName || t.assignedTo?.email || '',
              creeLe: t.createdAt?.toISOString?.() || '',
            })),
          };
        }
        // Sans filtre structuré : chemin classique (query texte → AI re-parsing), avec période et cloisonnement rôle (user)
        const result = await searchTickets(args.query || null, Math.min(Number(args.limit) || 20, 50), user, args.period || null);
        const ticketList = Array.isArray(result) ? result : (result?.tickets || []);
        if (!ticketList.length) return { total: 0, tickets: [], message: 'Aucun ticket trouvé' };
        const results = ticketList.map((t) => ({
          id: t.id, titre: t.title, statut: t.status, priorite: t.priority,
          lieu: t.locationName || '',
          demandeur: t.requester?.fullName || t.requester?.email || '',
          technicien: t.assignedTo?.fullName || t.assignedTo?.email || '',
          creeLe: t.createdAt?.toISOString?.() || '',
        }));
        return { total: results.length, tickets: results };
      }

      case 'get_context': {
        // Route courante de l'utilisateur (mise à jour par les messages {type:'navigation'})
        const navPath = (toolCtx && toolCtx.nav) || '';
        const ticketMatch = navPath.match(/\/tickets\/(\d+)/);
        return { page: navPath || 'inconnue', ticketId: ticketMatch ? Number(ticketMatch[1]) : null };
      }

      case 'check_ticket': {
        const ticketId = Number(args.ticketId);
        if (!ticketId || isNaN(ticketId)) return { error: 'Numéro de ticket invalide' };
        const ticket = await prisma.ticket.findUnique({
          where: { id: ticketId },
          select: {
            id: true, title: true, content: true, status: true, priority: true,
            category: true, locationName: true, requesterId: true, assignedToId: true, teamId: true,
            createdAt: true, updatedAt: true, solvedAt: true, closedAt: true,
            requester: { select: { fullName: true, email: true } },
            assignedTo: { select: { fullName: true, email: true } },
            team: { select: { name: true } },
            followups: {
              orderBy: { createdAt: 'desc' },
              take: 5,
              select: { id: true, content: true, isPrivate: true, createdAt: true, author: { select: { fullName: true } } },
            },
            timeEntries: {
              // NB : TicketTimeEntry n'a PAS de createdAt — le champ date est entryDate (cf. schema.prisma)
              orderBy: { entryDate: 'desc' },
              take: 10,
              select: { id: true, minutes: true, description: true, entryDate: true, user: { select: { fullName: true } } },
            },
          },
        });
        if (!ticket) return { error: `Ticket #${args.ticketId} non trouvé` };

        // 🛡️ Policy Gate: Restriction de lecture (Inspiré de live-dj EP3)
        const userRole = user?.role;
        const userId = user ? Number(user.sub) : null;
        let isAuthorized = false;

        if (['SUPERADMIN', 'ADMIN', 'HOTLINE'].includes(userRole)) {
          isAuthorized = true;
        } else if (userRole === 'TECHNICIAN') {
          // Un technicien peut lire si le ticket lui est assigné, s'il est demandeur ou s'il appartient à sa propre équipe
          if (ticket.assignedToId === userId || ticket.requesterId === userId) {
            isAuthorized = true;
          } else if (ticket.teamId && userId) {
            const member = await prisma.user.findFirst({
              where: { id: userId, teamId: ticket.teamId }
            });
            if (member) isAuthorized = true;
          }
        } else if (userRole === 'REQUESTER') {
          // Un demandeur ne peut lire que ses propres tickets
          if (ticket.requesterId === userId) {
            isAuthorized = true;
          }
        }

        if (!isAuthorized) {
          logger.warn(`[voice-live] Policy Gate: Bloqué check_ticket sur ticket #${ticketId} pour l'utilisateur #${userId} (${userRole})`);
          return {
            error: 'Permission refusée',
            answer: `Désolée, tu n'as pas l'autorisation d'accéder aux informations du ticket numéro ${ticketId} car tu n'es ni son demandeur ni son technicien.`,
          };
        }

        const totalTime = ticket.timeEntries?.reduce((sum, e) => sum + (e.minutes || 0), 0) || 0;
        return {
          ticket: formatTicket(ticket),
          suivi: (ticket.followups || []).map((f) => ({
            auteur: f.author?.fullName || '',
            contenu: (f.content || '').substring(0, 200),
            prive: f.isPrivate,
            date: f.createdAt?.toISOString?.() || '',
          })),
          tempsTotal: totalTime,
          entreesTemps: (ticket.timeEntries || []).length,
        };
      }

      case 'get_ticket_summary': {
        const ticketId = Number(args.ticketId);
        if (!ticketId || isNaN(ticketId)) return { error: 'Numéro de ticket invalide' };
        const ticket = await prisma.ticket.findUnique({
          where: { id: ticketId },
          select: {
            id: true, title: true, content: true, status: true, priority: true,
            category: true, locationName: true, createdAt: true, updatedAt: true,
            solvedAt: true, requesterId: true, assignedToId: true, teamId: true,
            requester: { select: { fullName: true } },
            assignedTo: { select: { fullName: true } },
            team: { select: { name: true } },
            // NB : la relation Followup s'appelle author (pas user) — cf. schema.prisma
            followups: { select: { content: true, createdAt: true, author: { select: { fullName: true } } } },
          },
        });
        if (!ticket) return { error: `Ticket #${ticketId} non trouvé` };

        // 🛡️ Policy Gate: Restriction de lecture (Inspiré de live-dj EP3)
        const userRole = user?.role;
        const userId = user ? Number(user.sub) : null;
        let isAuthorized = false;

        if (['SUPERADMIN', 'ADMIN', 'HOTLINE'].includes(userRole)) {
          isAuthorized = true;
        } else if (userRole === 'TECHNICIAN') {
          if (ticket.assignedToId === userId || ticket.requesterId === userId) {
            isAuthorized = true;
          } else if (ticket.teamId && userId) {
            const member = await prisma.user.findFirst({
              where: { id: userId, teamId: ticket.teamId }
            });
            if (member) isAuthorized = true;
          }
        } else if (userRole === 'REQUESTER') {
          if (ticket.requesterId === userId) {
            isAuthorized = true;
          }
        }

        if (!isAuthorized) {
          logger.warn(`[voice-live] Policy Gate: Bloqué get_ticket_summary sur ticket #${ticketId} pour l'utilisateur #${userId} (${userRole})`);
          return {
            error: 'Permission refusée',
            answer: `Désolée, tu n'as pas l'autorisation de consulter le résumé du ticket numéro ${ticketId} car tu n'es ni son demandeur ni son technicien.`,
          };
        }

        return {
          ticket: formatTicket(ticket),
          resume: `${ticket.title}. Statut: ${ticket.status}. Priorité: ${ticket.priority}. `
            + `${ticket.followups?.length || 0} suivi(s). `
            + (ticket.solvedAt ? `Résolu le ${ticket.solvedAt.toISOString().split('T')[0]}.` : 'Non résolu.'),
        };
      }

      case 'get_ticket_count': {
        // Même périmètre que l'UI : corbeille (deletedAt) et suggestions en attente/rejetées
        // (approvalStatus) exclus — sinon les chiffres vocaux dépassaient ceux affichés.
        const base = { deletedAt: null, approvalStatus: { notIn: ['PENDING', 'REJECTED'] } };
        // La période demandée (« cette semaine », « ce mois »…) est RÉELLEMENT appliquée :
        // avant, le tool renvoyait toujours les totaux depuis toujours.
        const startDate = args.period && args.period !== 'all' ? getPeriodDate(args.period) : null;
        const where = startDate ? { ...base, createdAt: { gte: startDate } } : base;
        const statuses = ['NEW', 'OPEN', 'PLANNED', 'PENDING', 'WAITING_FOR_USER', 'SOLVED', 'CLOSED'];
        const counts = await Promise.all(statuses.map((s) => prisma.ticket.count({ where: { ...where, status: s } })));
        const result = {};
        statuses.forEach((s, i) => { result[s] = counts[i]; });
        result.total = counts.reduce((a, b) => a + b, 0);
        // Regroupements que l'utilisateur demande naturellement à l'oral, alignés sur l'UI :
        // « ouverts » = les 5 statuts ouverts (PENDING/WAITING inclus, comme la pastille
        // du dashboard), enAttente reste un détail de sous-ensemble.
        result.ouverts = OPEN_STATUSES.reduce((sum, s) => sum + (result[s] || 0), 0);
        result.enAttente = (result.PENDING || 0) + (result.WAITING_FOR_USER || 0);
        result.resolus = result.SOLVED || 0;
        result.fermes = result.CLOSED || 0;
        if (startDate) result.periode = { depuis: startDate.toISOString() };
        return result;
      }

      case 'get_ticket_time_entries': {
        // TicketTimeEntry n'a pas de createdAt — tri/select sur entryDate (cf. schema.prisma)
        const entries = await prisma.ticketTimeEntry.findMany({
          where: { ticketId: Number(args.ticketId) },
          orderBy: { entryDate: 'desc' },
          select: { id: true, minutes: true, description: true, entryDate: true, user: { select: { fullName: true } } },
        });
        const total = entries.reduce((sum, e) => sum + (e.minutes || 0), 0);
        return {
          ticketId: args.ticketId,
          tempsTotalMinutes: total,
          entrees: entries.map((e) => ({
            auteur: e.user?.fullName || '',
            minutes: e.minutes,
            description: e.description || '',
            date: e.entryDate?.toISOString?.() || '',
          })),
        };
      }

      case 'get_ticket_links': {
        // Le select porte sur la TABLE DE LIAISON : les champs titre/statut vivent sur
        // ticketA/ticketB (relation), et la colonne s'appelle `type` (pas `linkType`).
        const ticket = await prisma.ticket.findUnique({
          where: { id: Number(args.ticketId) },
          select: {
            linksA: { select: { id: true, type: true, ticketB: { select: { id: true, title: true, status: true } } } },
            linksB: { select: { id: true, type: true, ticketA: { select: { id: true, title: true, status: true } } } },
          },
        });
        if (!ticket) return { error: `Ticket #${args.ticketId} non trouvé` };
        return {
          ticketId: args.ticketId,
          liensSortants: (ticket.linksA || []).map((l) => ({ id: l.ticketB.id, titre: l.ticketB.title, statut: l.ticketB.status, type: l.type })),
          liensEntrants: (ticket.linksB || []).map((l) => ({ id: l.ticketA.id, titre: l.ticketA.title, statut: l.ticketA.status, type: l.type })),
          total: (ticket.linksA?.length || 0) + (ticket.linksB?.length || 0),
        };
      }

      case 'create_ticket': {
        const userId = user ? Number(user.sub) : null;
        const ticket = await prisma.ticket.create({
          data: {
            title: args.title,
            content: args.content || `Créé via l'assistant vocal par ${user?.email || 'un utilisateur'}.`,
            priority: args.priority || 'P3',
            status: 'NEW',
            category: args.category || null,
            locationName: args.locationName || null,
            origin: 'CHATBOT', // 'CHATBOT' représente l'assistant vocal vocal/chatbot
            ...(userId ? { requesterId: userId, createdById: userId } : {}),
          },
          select: { id: true, title: true, status: true, priority: true },
        });

        // Logger l'événement de création dans l'historique du ticket (Inspiré de live-dj EP3)
        try {
          const { logEvent } = require('../services/ticketEvent');
          await logEvent(ticket.id, 'CREATED', user?.email || 'VOICE_ASSISTANT', { source: 'VOICE' });
        } catch (logErr) {
          logger.error(`[voice-live] Échec logEvent create_ticket: ${logErr.message}`);
        }

        return {
          success: true,
          message: `Ticket #${ticket.id} créé avec succès`,
          ticket: { id: ticket.id, titre: ticket.title, statut: ticket.status, priorite: ticket.priority },
        };
      }

      case 'update_ticket_status': {
        const ticketId = Number(args.ticketId);
        if (!ticketId || isNaN(ticketId)) return { error: 'Numéro de ticket invalide' };

        const ticket = await prisma.ticket.findUnique({
          where: { id: ticketId },
          select: { id: true, title: true, status: true, requesterId: true, assignedToId: true, teamId: true },
        });
        if (!ticket) return { error: `Ticket #${ticketId} non trouvé` };

        // 🛡️ Policy Gate : Validation de l'autorisation de mise à jour (Inspiré de live-dj EP3)
        const userRole = user?.role;
        const userId = user ? Number(user.sub) : null;
        let isAuthorized = false;

        if (['SUPERADMIN', 'ADMIN', 'HOTLINE'].includes(userRole)) {
          isAuthorized = true;
        } else if (userRole === 'TECHNICIAN') {
          // Un technicien peut modifier si le ticket lui est assigné ou s'il appartient à son équipe
          if (ticket.assignedToId === userId) {
            isAuthorized = true;
          } else if (ticket.teamId && userId) {
            const member = await prisma.user.findFirst({
              where: { id: userId, teamId: ticket.teamId }
            });
            if (member) isAuthorized = true;
          }
        } else if (userRole === 'REQUESTER') {
          // Un demandeur ne peut modifier que ses propres tickets
          if (ticket.requesterId === userId) {
            isAuthorized = true;
          }
        }

        if (!isAuthorized) {
          logger.warn(`[voice-live] Policy Gate: Bloqué update_ticket_status sur ticket #${ticketId} pour l'utilisateur #${userId} (${userRole})`);
          return {
            success: false,
            error: 'Permission refusée',
            answer: `Désolée, tu n'as pas l'autorisation de modifier le statut du ticket numéro ${ticketId} car tu n'es ni son demandeur ni son technicien assigné.`,
          };
        }

        const updated = await prisma.ticket.update({
          where: { id: ticketId },
          data: { status: args.status },
          select: { id: true, title: true, status: true },
        });

        // Logger la mise à jour (Inspiré de live-dj EP3)
        try {
          const { logEvent } = require('../services/ticketEvent');
          await logEvent(updated.id, 'STATUS_UPDATED', user?.email || 'VOICE_ASSISTANT', { oldStatus: ticket.status, newStatus: updated.status, via: 'VOICE' });
        } catch (logErr) {
          logger.error(`[voice-live] Échec logEvent update_ticket_status: ${logErr.message}`);
        }

        return {
          success: true,
          message: `Ticket #${updated.id} passé de ${ticket.status} à ${updated.status}`,
          ticket: { id: updated.id, titre: updated.title, statut: updated.status },
        };
      }

      case 'get_top_locations': {
        // analyticsTools attend un OBJET ({ period, limit, sortByUrgent }) — les anciens appels
        // positionnels perdaient period/limit => chiffres sur tout l'historique, sans filtre.
        const result = await analyticsTools.getTopLocationsStats({
          period: args.period || '30d',
          limit: Number(args.limit) || 5,
        });
        return result;
      }

      case 'get_top_technicians': {
        // Même périmètre que l'UI (corbeille + suggestions exclues) et période réellement appliquée
        const where = { deletedAt: null, approvalStatus: { notIn: ['PENDING', 'REJECTED'] } };
        if (args.period && args.period !== 'all') {
          const d = getPeriodDate(args.period);
          if (d) where.createdAt = { gte: d };
        }
        const tickets = await prisma.ticket.findMany({
          where,
          select: { status: true, priority: true, assignedTo: { select: { fullName: true } } },
        });
        const techMap = {};
        tickets.forEach((t) => {
          const name = t.assignedTo?.fullName || 'Non assigné';
          if (!techMap[name]) techMap[name] = { nom: name, total: 0, resolus: 0, urgents: 0 };
          techMap[name].total++;
          if (t.status === 'SOLVED' || t.status === 'CLOSED') techMap[name].resolus++;
          if (t.priority === 'P1' || t.priority === 'P2') techMap[name].urgents++;
        });
        const ranked = Object.values(techMap)
          .map((t) => ({ ...t, tauxResolution: t.total > 0 ? Math.round((t.resolus / t.total) * 100) : 0 }))
          .sort((a, b) => b.resolus - a.resolus)
          .slice(0, Number(args.limit) || 10);
        return { techniciens: ranked, periode: args.period || 'all' };
      }

      case 'get_team_report': {
        const result = await analyticsTools.getTeamDistribution({ period: args.period || '30d' });
        return result;
      }

      case 'get_category_distribution': {
        const result = await analyticsTools.getCategoryDistribution({ period: args.period || '30d' });
        return result;
      }

      case 'analyze_root_cause': {
        const result = await analyticsTools.analyzeRootCause({
          locationName: args.locationName || undefined,
          filterKeyword: args.filterKeyword || undefined,
        });
        return result;
      }

      case 'generate_report': {
        // Même périmètre que l'UI : corbeille et suggestions en attente/rejetées exclus
        const where = { deletedAt: null, approvalStatus: { notIn: ['PENDING', 'REJECTED'] } };
        if (args.period && args.period !== 'all') {
          const d = getPeriodDate(args.period);
          if (d) where.createdAt = { gte: d };
        }
        const [total, open, solved, closed] = await Promise.all([
          prisma.ticket.count({ where }),
          // « ouverts » = les 5 statuts ouverts (aligné dashboard), pas le seul OPEN
          prisma.ticket.count({ where: { ...where, status: { in: OPEN_STATUSES } } }),
          prisma.ticket.count({ where: { ...where, status: 'SOLVED' } }),
          prisma.ticket.count({ where: { ...where, status: 'CLOSED' } }),
        ]);
        const byStatus = await prisma.ticket.groupBy({ by: ['status'], where, _count: true });
        const byPriority = await prisma.ticket.groupBy({ by: ['priority'], where, _count: true });
        return {
          periode: args.period || 'all',
          total, ouverts: open, resolus: solved, fermes: closed,
          parStatut: byStatus.map((s) => ({ statut: s.status, nombre: s._count })),
          parPriorite: byPriority.map((p) => ({ priorite: p.priority, nombre: p._count })),
        };
      }

      case 'search_users': {
        const users = await prisma.user.findMany({
          where: {
            isActive: true,
            OR: [
              { fullName: { contains: args.query, mode: 'insensitive' } },
              { email: { contains: args.query, mode: 'insensitive' } },
            ],
          },
          select: { id: true, fullName: true, email: true, role: true, team: { select: { name: true } } },
          take: 10,
        });
        return {
          users: users.map((u) => ({
            id: u.id, nom: u.fullName || '', email: u.email, role: u.role,
            equipe: u.team?.name || '',
          })),
          total: users.length,
        };
      }

      case 'search_locations': {
        const locations = await prisma.location.findMany({
          where: { name: { contains: args.query, mode: 'insensitive' } },
          select: { id: true, name: true, parentId: true },
          take: 10,
        });
        return { locations, total: locations.length };
      }

      case 'search_teams': {
        const result = await searchTeams(args.query);
        return result;
      }

      case 'search_knowledge': {
        const result = await searchKnowledge(args.query, 5);
        if (!result || !result.length) return { total: 0, articles: [], message: 'Aucun article trouvé' };
        return {
          articles: result.map((r) => ({
            titre: r.title || r.documentTitle || '',
            contenu: (r.content || r.text || '').substring(0, 200),
            score: r.score || r.similarity || 0,
          })),
          total: result.length,
        };
      }

      case 'search_inventory': {
        const assets = await prisma.asset.findMany({
          where: {
            OR: [
              { name: { contains: args.query, mode: 'insensitive' } },
              { model: { contains: args.query, mode: 'insensitive' } },
              { serialNumber: { contains: args.query, mode: 'insensitive' } },
            ],
          },
          select: { id: true, name: true, model: true, serialNumber: true, status: true },
          take: 10,
        });
        return { equipements: assets, total: assets.length };
      }

      // ── Outils hérités du chatbot texte : délégués au MÊME moteur (schéma + exécution
      // unifiés, RBAC inclus) pour éviter toute divergence de comportement ──
      case 'find_similar_tickets':
        return await chatbotExecuteTool(name, args, user);

      case 'search_emails':
        return await chatbotExecuteTool(name, args, user);

      case 'send_ticket_report':
        return await chatbotExecuteTool(name, args, user);

      case 'add_ticket_followup': {
        // Confirmation vocale en 2 temps : le chatbot renvoie needsConfirmation → on le
        // relaie à Gemini qui demande à l'utilisateur ; à la répétition des mêmes args
        // (fenêtre de 120s), toolCtx.pendingFollowup autorise l'exécution réelle.
        const key = `${Number(args.ticketId) || args.ticketId}|${String(args.content || '')}`;
        const pending = toolCtx && toolCtx.pendingFollowup;
        if (pending && pending.key === key && Date.now() - pending.at < 120000) {
          toolCtx.pendingFollowup = null;
          return await chatbotExecuteTool(name, args, user, { confirmed: true });
        }
        const res = await chatbotExecuteTool(name, args, user);
        if (res && res.needsConfirmation) {
          if (toolCtx) toolCtx.pendingFollowup = { key, at: Date.now() };
          return { ...res, message: `${res.message} Dis « confirme » et je l'ajoute.` };
        }
        return res;
      }

      default:
        return { error: `Outil inconnu: ${name}` };
    }
  } catch (err) {
    logger.error(`[voice-live] Tool error (${name}): ${err.message}`);
    return { error: err.message || String(err) };
  }
}

function getPeriodDate(period) {
  // Délégue à parsePeriod (analyticsTools) qui couvre aussi this_week/this_month/last_week/…
  // — l'ancien switch local ignorait ces périodes (retour null => filtre perdu => chiffres
  // « depuis toujours » au lieu de « cette semaine »/« ce mois »).
  const { parsePeriod } = require('../services/analyticsTools');
  return parsePeriod(period);
}

// ── Snapshot pré-chargé (contexte temps réel injecté dans le prompt) ──
// Même périmètre que /dashboard/stats : corbeille et suggestions en attente/rejetées
// exclues, et les 5 statuts ouverts (OPEN_STATUSES). Sans ça, le vocal annonçait
// 48 « ouverts » (et Total=85) alors que l'UI affiche 45 (et 81) — bug constaté.
async function fetchVoiceSnapshot(currentUser) {
  const [total, open, newCount, p1Count, solvedCount, myCount, myRecentTickets, topLocs, topCategories, teamStats] = await Promise.all([
    prisma.ticket.count({ where: UI_TICKET_BASE }).catch(() => null),
    prisma.ticket.count({ where: { ...UI_TICKET_BASE, status: { in: OPEN_STATUSES } } }).catch(() => null),
    prisma.ticket.count({ where: { ...UI_TICKET_BASE, status: 'NEW' } }).catch(() => null),
    prisma.ticket.count({ where: { ...UI_TICKET_BASE, priority: 'P1', status: { in: OPEN_STATUSES } } }).catch(() => null),
    prisma.ticket.count({ where: { ...UI_TICKET_BASE, status: { in: ['SOLVED', 'CLOSED'] } } }).catch(() => null),
    currentUser ? prisma.ticket.count({ where: { ...UI_TICKET_BASE, OR: [{ requesterId: currentUser.sub }, { assignedToId: currentUser.sub }] } }).catch(() => null) : null,
    currentUser
      ? prisma.ticket.findMany({
          where: { ...UI_TICKET_BASE, OR: [{ requesterId: currentUser.sub }, { assignedToId: currentUser.sub }] },
          take: 10,
          orderBy: { updatedAt: 'desc' },
          select: {
            id: true, title: true, status: true, priority: true, category: true, locationName: true,
            assignedTo: { select: { fullName: true } },
            requester: { select: { fullName: true } },
          },
        }).catch(() => [])
      : [],
    prisma.ticket.groupBy({
      by: ['locationName'],
      where: { ...UI_TICKET_BASE, locationName: { not: null }, status: { in: OPEN_STATUSES } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 4,
    }).catch(() => []),
    prisma.ticket.groupBy({
      by: ['category'],
      where: { ...UI_TICKET_BASE, category: { not: null }, status: { in: OPEN_STATUSES } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 4,
    }).catch(() => []),
    prisma.team.findMany({
      select: { name: true, _count: { select: { tickets: { where: { ...UI_TICKET_BASE, status: { in: OPEN_STATUSES } } } } } },
      take: 5,
    }).catch(() => []),
  ]);
  return { total, open, newCount, p1Count, solvedCount, myCount, myRecentTickets, topLocs, topCategories, teamStats, at: new Date().toISOString().slice(0, 16).replace('T', ' ') };
}

function setupVoiceLive() {
  const tlsCertPath = process.env.TLS_CERT_PATH;
  const tlsKeyPath = process.env.TLS_KEY_PATH;
  let server;
  if (tlsCertPath && tlsKeyPath && fs.existsSync(tlsCertPath) && fs.existsSync(tlsKeyPath)) {
    try {
      server = https.createServer({ cert: fs.readFileSync(tlsCertPath), key: fs.readFileSync(tlsKeyPath) });
      logger.info('[voice-live] HTTPS activé');
    } catch (err) {
      logger.error(`[voice-live] Impossible de charger TLS, fallback HTTP : ${err.message}`);
      server = http.createServer();
    }
  } else {
    server = http.createServer();
  }
  const wss = new WebSocketServer({ server, maxPayload: 1024 * 1024 });
  const keepAliveInterval = setInterval(() => {
    wss.clients.forEach((c) => {
      if (c.readyState === 1) { try { c.ping(); } catch {} }
      else if (c.readyState !== 0) { try { c.terminate(); } catch {} }
    });
  }, 30000);
  wss.on('close', () => clearInterval(keepAliveInterval));
  const userSessionCount = new Map();

  wss.on('connection', async (ws, req) => {
    logger.info('[voice-live] Client connected');
    let session = null;

    // ── Authentification (JWT envoyé par le front via ?token=) ──
    // Même logique que utils/socket.js : le JWT n'est qu'une preuve de connexion, le rôle et
    // l'état du compte sont RELUS en base — un changement de rôle prend effet à la prochaine
    // session vocale. Sans token valide : currentUser = null (pipeline chatbot non filtré,
    // comportement identique à l'ancien fonctionnement).
    let currentUser = null;
    let sessionHistory = [];
    // État de confirmation des outils d'écriture à 2 temps (add_ticket_followup)
    // + navigation courante : route reçue à la connexion (&path=) puis mise à jour
    // par les messages {type:'navigation'} — lue par l'outil get_context.
    const toolCtx = { pendingFollowup: null, nav: '' };
    let sessionNav = '';
    // Journal des tours finaux (transcripts) pour le résumé de session (get_summary)
    const sessionLog = [];
    let audioOutChunks = 0; // Preuve de diagnostics : chunks PCM relays au client par tour
    let audioOutBytes = 0;
    try {
      const url = new URL(req.url, 'http://localhost');
      sessionNav = (url.searchParams.get('path') || '').slice(0, 300);
      toolCtx.nav = sessionNav;
      const token = url.searchParams.get('token')
        || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const dbUser = await prisma.user.findUnique({
          where: { id: Number(decoded.sub) },
          select: { id: true, email: true, role: true, teamId: true, isActive: true },
        });
        if (dbUser?.isActive) {
          currentUser = { sub: dbUser.id, email: dbUser.email, role: dbUser.role, teamId: dbUser.teamId };
          logger.info(`[voice-live] Auth OK : user #${currentUser.sub} (${currentUser.role})`);
        } else {
          logger.warn('[voice-live] Auth : compte inactif ou introuvable');
        }
      } else {
        logger.warn('[voice-live] Aucun token fourni — session non authentifiée');
      }
    } catch (authErr) {
      logger.warn(`[voice-live] Auth failed: ${authErr.message}`);
    }

    // Tampons de transcription pour le tour en cours (Gemini envoie les transcriptions
    // par fragments ; on accumule pour reconstruire la phrase complète à turnComplete).
    // ── Snapshot pré-chargé (contexte temps-réel injecté dans le prompt) ──
    let snapshotBlock = '';
    try {
      const snapCache = global._voiceSnapshotCache || (global._voiceSnapshotCache = { data: {}, at: {} });
      const now = Date.now();
      const SNAP_TTL = 30_000;
      const userKey = currentUser ? `u:${currentUser.sub}` : 'anon';
      const cached = snapCache.data[userKey];
      const cachedAt = snapCache.at[userKey] || 0;
      let snap;
      if (cached && now - cachedAt < SNAP_TTL) {
        snap = cached;
      } else {
        snap = await fetchVoiceSnapshot(currentUser);
        snapCache.data[userKey] = snap;
        snapCache.at[userKey] = now;
        if (Object.keys(snapCache.data).length > 50) {
          const oldest = Object.entries(snapCache.at).sort((a, b) => a[1] - b[1])[0];
          if (oldest) { delete snapCache.data[oldest[0]]; delete snapCache.at[oldest[0]]; }
        }
      }
      const parts = [];
      if (snap.total != null) parts.push(`METRIQUES GLOBALES: Total=${snap.total}, Ouverts=${snap.open}, Nouveaux=${snap.newCount}, P1 Critiques=${snap.p1Count || 0}, Résolus=${snap.solvedCount || 0}`);
      if (currentUser) {
        parts.push(`UTILISATEUR CONNECTÉ: #${currentUser.sub} (${currentUser.role}) | Total de ses tickets=${snap.myCount || 0}`);
      }
      if (snap.myRecentTickets?.length) {
        const ticketSummaryList = snap.myRecentTickets.map(t => `#${t.id} "${t.title}" [Statut: ${t.status}, Priorité: ${t.priority}, Catégorie: ${t.category || 'N/A'}, Lieu: ${t.locationName || 'N/A'}, Tech: ${t.assignedTo?.fullName || 'non assigné'}]`).join('\n  - ');
        parts.push(`LISTE DÉTAILLÉE DE TES TICKETS RÉCENTS :\n  - ${ticketSummaryList}`);
      }
      if (snap.topLocs?.length) parts.push(`SITES LES PLUS IMPACTES: ${snap.topLocs.map((l) => `${l.locationName} (${l._count.id} tickets)`).join(', ')}`);
      if (snap.topCategories?.length) parts.push(`CATEGORIES PRINCIPALES: ${snap.topCategories.map((c) => `${c.category} (${c._count.id})`).join(', ')}`);
      if (snap.teamStats?.length) parts.push(`EQUIPES: ${snap.teamStats.map((t) => `${t.name} (${t._count.tickets} ouverts)`).join(', ')}`);

      if (parts.length) {
        snapshotBlock = `\n\n--- DONNÉES TEMPS RÉEL PRÉCHARGÉES (${snap.at}) ---\n${parts.join('\n')}\n\nRÈGLE ABSOLUE POUR LES DONNÉES : Toutes les informations ci-dessus sur les tickets de l'utilisateur, leurs statuts, priorités et catégories sont 100% EXACTES. Quand l'utilisateur pose une question sur ses tickets ou les chiffres globaux du helpdesk, RÉPONDS DIRECTEMENT À L'ORAL en utilisant ce bloc SANS faire aucun appel d'outil !\n`;
      }
    } catch (snapErr) {
      logger.warn('[voice-live] Snapshot échoué:', snapErr.message);
    }

    let inputTranscriptBuf = '';
    let outputTranscriptBuf = '';

    // ── Résumé de session (message client {type:'get_summary'}) ──
    // Synthétise les transcripts finaux accumulés via le chatbot texte (même
    // pipeline IA que ask_assistant) — indépendant de la session Gemini en cours.
    const handleSessionSummary = async () => {
      const send = (payload) => { if (ws.readyState === 1) ws.send(JSON.stringify(payload)); };
      if (sessionLog.length === 0) {
        send({ type: 'session_summary', text: '' });
        return;
      }
      const transcript = sessionLog
        .map((m) => `${m.role === 'user' ? 'Utilisateur' : 'MARIE'} : ${m.text}`)
        .join('\n');
      try {
        const result = await handleMessage(
          "Résume en 4 à 6 phrases cet échange entre un utilisateur et l'assistance vocale MARIE : "
          + 'contexte, demandes exprimées, réponses apportées, suites à donner. '
          + 'Phrases simples en français, pas de markdown, pas de liste à puces.',
          [{ role: 'user', content: transcript }],
          currentUser, null, null, { voiceMode: false },
        );
        send({ type: 'session_summary', text: (result && result.reply) || '' });
      } catch (sumErr) {
        logger.warn(`[voice-live] Résumé échoué: ${sumErr.message}`);
        send({ type: 'session_summary', text: '' });
      }
    };

    // ── Handlers côté client, enregistrés AVANT genai.live.connect() ──
    // connect() ne se résout qu'au setupComplete : s'il échoue ou reste bloqué, ces
    // handlers n'existeraient jamais → session morte sans log, sans {type:'error'}
    // envoyé au front et sans reconnexion (constaté : 48 sessions ouvertes / 43 setupComplete).
    // `session` est null tant que connect n'a pas résolu : les frames mic reçues avant
    // le ready sont simplement ignorées (garde ci-dessous).
    ws.on('message', async (data) => {
      try {
        if (Buffer.isBuffer(data) && data.length > 2 && session) {
          // Vérifier si c'est du JSON (ping, bargeIn) ou du PCM brut
          if (data[0] === 0x7B) {
            let parsed = null;
            try {
              parsed = JSON.parse(data.toString());
            } catch { /* Pas du JSON valide → PCM brut (0x7B peut être une donnée audio) */ }
            if (parsed) {
              if (parsed.type === 'ping') {
                // Keep-alive : rien à faire côté Gemini
              } else if (parsed.type === 'bargeIn') {
                // L'utilisateur a interrompu → signaler à Gemini de s'arrêter
                logger.info('[voice-live] bargeIn received from client');
              } else if (parsed.type === 'navigation') {
                // L'utilisateur a navigué (mini-orbe) → Marie doit savoir où il en est
                sessionNav = String(parsed.path || '').slice(0, 300);
                toolCtx.nav = sessionNav;
                logger.info(`[voice-live] Navigation → ${sessionNav || '(inconnue)'}`);
              } else if (parsed.type === 'get_summary') {
                // Résumé de fin de session : généré hors Gemini via les transcripts
                handleSessionSummary().catch((sumErr) => {
                  logger.warn(`[voice-live] get_summary failed: ${sumErr.message}`);
                });
              }
              return; // JSON traité — seuls les vrais messages JSON sont ignorés par le flux PCM
            }
            // Sinon : on tombe au-dessus et on traite ce buffer comme du PCM
          }
          await session.sendRealtimeInput({
            audio: { data: data.toString('base64'), mimeType: 'audio/pcm;rate=16000' },
          });
        }
      } catch (err) {
        logger.error('[voice-live] upstream error:', err.message);
      }
    });

    ws.on('close', () => {
      logger.info('[voice-live] Client disconnected');
      try { session?.close?.(); } catch {}
    });

    ws.on('error', (err) => {
      logger.error('[voice-live] WS error:', err.message);
      try { session?.close?.(); } catch {}
    });

    try {
      const apiKey = await getGeminiApiKey();
      const genai = new GoogleGenAI({ apiKey });

      // connect() ne se résout qu'au setupComplete : sans timeout, un refus ou une
      // session fermée par Google laisse le client dans le vide (jamais de ready,
      // jamais d'erreur côté front, jamais de log côté serveur).
      const CONNECT_TIMEOUT_MS = 10000;
      let connectTimedOut = false;
      let connectTimeoutHandle;
      const connectPromise = genai.live.connect({
        model: LIVE_MODEL,
        config: {
          responseModalities: ['AUDIO'],
          systemInstruction: [
            'Tu es MARIE, assistante vocale amicale et professionnelle du helpdesk IT Prosuma.',
            'Tu parles en français, de manière claire, concise et naturelle à l\'oral.',
            '',
            '══ RÈGLE ABSOLUE — DONNÉES EN TEMPS RÉEL ══',
            'Le bloc SNAPSHOT ci-dessous contient les métriques EXACTES et À JOUR du helpdesk.',
            'Pour TOUTE question sur les CHIFFRES globaux (total tickets, ouverts, nouveaux, critiques, résolus),',
            'les sites les plus impactés, les catégories principales ou les équipes,',
            'TU DOIS répondre IMMÉDIATEMENT et DIRECTEMENT en utilisant ces chiffres — SANS appeler aucun outil.',
            'ATTENTION : le snapshot ne contient que des AGRÉGATS — JAMAIS de titres, de techniciens ni de liste de tickets.',
            '',
            '══ QUAND UTILISER UN OUTIL ══',
            '- Contenu ou détail d\'un sous-ensemble (« ça concerne quoi », titres, techniciens assignés, liste des P1 ou d\'une équipe/catégorie/personne) → search_tickets IMMÉDIATEMENT (params priority / team / category / person / status), SANS attendre. Ne dis JAMAIS « je ne dispose pas des détails » : va chercher.',
            '- Liste complète demandée → search_tickets avec limit=20 pour tout couvrir.',
            '- Détails d\'un ticket spécifique non listé dans le snapshot → check_ticket ou search_tickets',
            '- Question portant sur « ce ticket », « cette page », « ce que je regarde » → get_context d\'abord (route courante ; /tickets/64 = ticket numéro 64)',
            '- Date de création, "dernier ticket créé", "tickets récents" → search_tickets avec limit=1 (tri du plus récent, champ "creeLe" = date)',
            '- Tickets d\'une équipe, d\'une catégorie ou d\'une personne → search_tickets (params team / category / person)',
            '- Mails (dernier mail, fil d\'un ticket) → search_emails',
            '- Tickets similaires / doublons → find_similar_tickets',
            '- Ajouter un suivi/commentaire sur un ticket → add_ticket_followup (demande d\'abord la confirmation)',
            '- Classements détaillés techniciens/lieux → get_top_technicians / get_top_locations',
            '- Création ou modification de ticket → create_ticket / update_ticket_status',
            '- Question qui nécessite une vraie analyse → ask_assistant',
            '- NE PAS appeler d\'outil si la réponse EST un chiffre déjà présent dans le snapshot.',
            '- Les chiffres du snapshot = tickets ACTIFS ; si un outil renvoie aussi des tickets résolus/fermés, distingue-les clairement.',
            '',
            '══ ACTIONS EN ATTENTE DE CONFIRMATION ══',
            'Si une action est en attente de confirmation (ex: envoi de rapport par email),',
            'lorsque l\'utilisateur répond (par exemple par "oui", "confirme", "non", "annule"),',
            'TU DOIS IMPÉRATIVEMENT appeler l\'outil ask_assistant avec la réponse de l\'utilisateur (ex: {"question": "oui"})',
            'afin que le système puisse réellement exécuter l\'action (ou l\'annuler) et mettre à jour l\'interface.',
            'Ne confirme JAMAIS que l\'action a été effectuée sans avoir d\'abord appelé ask_assistant.',
            '',
            '══ COMPORTEMENT FACE AUX ERREURS OU ABSENCE DE DONNÉES ══',
            'Si un outil retourne une erreur, indique qu\'aucune donnée ne correspond, ou dit que l\'action n\'a pas été exécutée (ex: "Aucun ticket ne correspond...", "erreur...", "email non envoyé"),',
            'TU DOIS IMPÉRATIVEMENT informer l\'utilisateur de cet état de fait (ex: "Il n\'y a aucun ticket ce week-end, l\'email n\'a donc pas été envoyé").',
            'Ne dis JAMAIS que l\'envoi a réussi ou que tout est en ordre si l\'outil a renvoyé un message d\'absence de données ou d\'échec.',
            '',
            '══ FORMAT DE RÉPONSE VOCALE ══',
            '- Réponds en 1 à 3 phrases concises, fluides et naturelles à l\'oral (réponses générales).',
            '- LISTES COMPLÈTES : quand on te demande de lister (titres, techniciens, « tous les X »), annonce le total puis énumère TOUS les éléments — une phrase par ticket si besoin. Ne tronque JAMAIS : si le snapshot annonce 8 tickets, couvre bien les 8.',
            '- JAMAIS de markdown : pas d\'astérisques, pas de tirets listes, pas de dièses.',
            '- Les numéros de tickets : dis toujours "ticket numéro X", jamais "#X".',
            '- JAMAIS "je vérifie", "un instant", "laissez-moi chercher" — réponds directement.',
            '- Si tu ne sais pas : dis-le simplement en une phrase.',
            '',
            `PAGE ACTUELLE DE L\'UTILISATEUR (au démarrage) : ${sessionNav || 'inconnue'} — mets à jour mentalement via get_context si l\'utilisateur navigue.`,
            snapshotBlock,
          ].join('\n'),
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: LIVE_VOICE },
            },
          },
          // ── Détection de fin de parole — compromis rapidité / précision (Inspiré de live-dj & Google Best Practices) ──
          // Passer prefixPaddingMs à 200ms permet de capturer les consonnes d'attaque (T, P, C, etc.) au début des phrases.
          // Passer silenceDurationMs de 800ms (un peu trop lent, forçait l'utilisateur à attendre trop longtemps) à 500ms (le "sweet-spot" standard).
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: false,
              startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
              endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
              prefixPaddingMs: 200,
              silenceDurationMs: 500,
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: TOOLS,
        },
        callbacks: {
          onopen: () => {
            logger.info('[voice-live] Gemini session opened');
          },
          onmessage: async (msg) => {
            if (ws.readyState !== 1) return;

            try {
              if (msg.setupComplete) {
                logger.info('[voice-live] Gemini setupComplete');
                ws.send(JSON.stringify({ type: 'ready' }));
                return;
              }

              const sc = msg.serverContent;
              if (sc) {
                // Les transcriptions Gemini arrivent par FRAGMENTS (un mot à la fois).
                // On accumule par tour et on relaie : fragment brut (partial) + tour comité
                // (final) pour que le front affiche une bulle qui grossit au lieu d'une
                // bulle par mot.
                if (sc.inputTranscription?.text) {
                  inputTranscriptBuf += sc.inputTranscription.text;
                  if (inputTranscriptBuf.length > 10000) inputTranscriptBuf = inputTranscriptBuf.slice(-10000);
                  // partial = phrase accumulée depuis le début du tour (le front l'affiche
                  // dans UNE bulle qui grossit, au lieu d'une bulle par fragment)
                  ws.send(JSON.stringify({ type: 'transcript', role: 'user', text: inputTranscriptBuf, partial: true }));
                }
                if (sc.outputTranscription?.text) {
                  outputTranscriptBuf += sc.outputTranscription.text;
                  if (outputTranscriptBuf.length > 10000) outputTranscriptBuf = outputTranscriptBuf.slice(-10000);
                  const formattedOutput = formatSpokenTextFrench(outputTranscriptBuf);
                  ws.send(JSON.stringify({ type: 'transcript', role: 'assistant', text: formattedOutput, partial: true }));
                }
                if (sc.turnComplete || sc.interrupted) {
                  if (audioOutChunks > 0) {
                    logger.info(`[voice-live] audio out (tour): ${audioOutChunks} chunk(s), ${audioOutBytes} octets envoyés au client`);
                    audioOutChunks = 0;
                    audioOutBytes = 0;
                  }
                  if (inputTranscriptBuf) {
                    ws.send(JSON.stringify({ type: 'transcript', role: 'user', text: inputTranscriptBuf, final: true }));
                    sessionLog.push({ role: 'user', text: inputTranscriptBuf });
                    if (sessionLog.length > 60) sessionLog.shift();
                    inputTranscriptBuf = '';
                  }
                  if (outputTranscriptBuf) {
                    const formattedOutput = formatSpokenTextFrench(outputTranscriptBuf);
                    ws.send(JSON.stringify({ type: 'transcript', role: 'assistant', text: formattedOutput, final: true }));
                    sessionLog.push({ role: 'assistant', text: formattedOutput });
                    if (sessionLog.length > 60) sessionLog.shift();
                    outputTranscriptBuf = '';
                  }
                }
                if (sc.modelTurn?.parts) {
                  // serverContent est INCRÉMENTAL : chaque message porte les NOUVELLES parties
                  // du tour. On relaie TOUTES les parts — l'ancien compteur de dédup (slice)
                  // supprimait tout l'audio après le 1er chunk de chaque tour (voix muette).
                  const pcmParts = sc.modelTurn.parts.filter((p) => p.inlineData?.data);
                  if (pcmParts.length) {
                    const combined = Buffer.concat(pcmParts.map((p) => Buffer.from(p.inlineData.data, 'base64')));
                    ws.send(combined);
                    audioOutChunks += pcmParts.length;
                    audioOutBytes += combined.length;
                  }
                }
                if (sc.interrupted) {
                  ws.send(JSON.stringify({ type: 'interrupted' }));
                }
              }

              if (msg.toolCall) {
                const fcs = msg.toolCall.functionCalls;
                if (fcs && typeof fcs[Symbol.iterator] === 'function') {
                  const fcList = [...fcs];
                  // ── Exécution PARALLÈLE de tous les tool calls du tour ──
                  // Avant : exécution séquentielle (chaque outil attendait le précédent)
                  // Maintenant : tous les outils démarrent en même temps → latence = max(outils)
                  // au lieu de sum(outils). Gain typique : 200-500ms sur des questions multi-outils.
                  const t0 = Date.now();
                  const results = await Promise.allSettled(
                    fcList.map(async (fc) => {
                      const fcName = String(fc.name || '');
                      const fcArgs = JSON.parse(JSON.stringify(fc.args || {}));
                      const fcId = String(fc.id || '');
                      logger.info(`[voice-live] Tool (parallel): ${fcName} ${JSON.stringify(fcArgs).substring(0, 200)}`);

                      // Notifier le client du démarrage de l'outil (transitions vocales d'attente V2)
                      if (ws && ws.readyState === 1) {
                        ws.send(JSON.stringify({ type: 'tool_starting', name: fcName }));
                      }

                      try {
                        const result = await executeTool(fcName, fcArgs, { user: currentUser, sessionHistory, ws, toolCtx });
                        // Retour visuel côté front : fin du chip « Marie utilise… » + payload
                        // sanitisé (cartes) si l'outil a un résultat affichable.
                        if (ws && ws.readyState === 1) {
                          ws.send(JSON.stringify({ type: 'tool_finished', name: fcName }));
                          const payload = buildToolResultPayload(fcName, result);
                          if (payload) {
                            ws.send(JSON.stringify({ type: 'tool_result', name: fcName, data: payload }));
                          }
                        }
                        return { id: fcId, name: fcName, response: result };
                      } catch (toolErr) {
                        logger.error(`[voice-live] Tool ${fcName} error: ${toolErr.message}`);
                        if (ws && ws.readyState === 1) {
                          ws.send(JSON.stringify({ type: 'tool_finished', name: fcName }));
                        }
                        return { id: fcId, name: fcName, response: { error: toolErr.message, success: false } };
                      }
                    })
                  );
                  logger.info(`[voice-live] ${fcList.length} tool(s) executed in ${Date.now() - t0}ms`);
                  // Chaque response doit être un objet plat (Struct proto Gemini) :
                  // search_teams renvoie un tableau → sinon session fermée en code 1007.
                  const functionResponses = results.map((r) => toGeminiResponse(r.value || r.reason));
                  try {
                    await session.sendToolResponse({ functionResponses });
                  } catch (respErr) {
                    logger.error('[voice-live] sendToolResponse error:', respErr.message);
                  }
                }
              }
            } catch (err) {
              logger.error('[voice-live] Message error:', err.message);
            }
          },
          onerror: (err) => {
            logger.error('[voice-live] Gemini error:', err?.message || 'unknown');
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({ type: 'error', message: err?.message || 'Gemini error' }));
            }
          },
          onclose: (e) => {
            // e.code/e.reason : SEULE trace d'un refus de session Google (les fermetures
            // avant setupComplete n'arrivaient jamais dans le catch → zéro log avant).
            logger.info(`[voice-live] Gemini session closed${e ? ` code=${e.code} reason=${e.reason || '(aucune)'}` : ''}`);
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({ type: 'session_closed' }));
              ws.close();
            }
          },
        },
      });
      // Si le timeout gagne la course mais que connect finit par résoudre plus tard,
      // fermer la session orpheline. On teste `connectTimedOut` (positionné par le timer)
      // et NON un "connectOk" qui serait encore false à la résolution normale de la
      // promesse (ordre des microtasks) — cela fermait la session aussitôt ouverte.
      connectPromise.then((s) => { if (connectTimedOut) { try { s?.close?.(); } catch {} } }).catch(() => {});
      try {
        session = await Promise.race([
          connectPromise,
          new Promise((_, reject) => {
            connectTimeoutHandle = setTimeout(() => {
              connectTimedOut = true;
              reject(new Error(`Gemini connect timeout (${CONNECT_TIMEOUT_MS}ms)`));
            }, CONNECT_TIMEOUT_MS);
          }),
        ]);
      } finally {
        clearTimeout(connectTimeoutHandle);
      }
    } catch (err) {
      logger.error('[voice-live] Setup error:', err.message);
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
        ws.close();
      }
    }
  });

  server.listen(LIVE_PORT, () => {
    logger.info(`[voice-live] WebSocket server listening on port ${LIVE_PORT}`);
  });
}

function invalidateVoiceCache(userIds = []) {
  try {
    const snapCache = global._voiceSnapshotCache;
    if (!snapCache || !snapCache.data) return;
    if (!userIds || userIds.length === 0) {
      snapCache.data = {};
      snapCache.at = {};
      return;
    }
    delete snapCache.data['anon'];
    delete snapCache.at['anon'];
    for (const id of userIds) {
      if (!id) continue;
      delete snapCache.data[`u:${id}`];
      delete snapCache.at[`u:${id}`];
    }
  } catch (err) {
    logger.warn('[voice-live] Cache invalidation error:', err.message);
  }
}

module.exports = { setupVoiceLive, invalidateVoiceCache, executeTool, fetchVoiceSnapshot };
