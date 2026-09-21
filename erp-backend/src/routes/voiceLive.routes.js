const http = require('http');
const https = require('https');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const { GoogleGenAI } = require('@google/genai');
const prisma = require('../prismaClient');
const { logger } = require('../utils/logger');
const analyticsTools = require('../services/analyticsTools');
const { searchKnowledge } = require('../services/knowledgeSearch');
const { searchTeams, searchTickets, buildSearchQuery } = require('../services/chatbotService');

const LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';
const LIVE_VOICE = 'Aoede';
const LIVE_PORT = process.env.VOICE_LIVE_PORT || 4001;

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

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'search_tickets',
        description: 'Recherche de tickets par mot-clé, statut, priorité, lieu, technicien, demandeur, période. Très flexible.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Mot-clé de recherche dans titre, contenu, lieu, catégorie' },
            status: { type: 'string', enum: ['NEW', 'OPEN', 'PLANNED', 'PENDING', 'WAITING_FOR_USER', 'SOLVED', 'CLOSED'], description: 'Filtrer par statut' },
            priority: { type: 'string', enum: ['P1', 'P2', 'P3', 'P4'], description: 'Filtrer par priorité' },
            locationName: { type: 'string', description: 'Filtrer par lieu/magasin' },
            assignedTo: { type: 'string', description: 'Nom du technicien assigné' },
            requester: { type: 'string', description: 'Nom ou email du demandeur' },
            period: { type: 'string', description: 'Période: today, yesterday, 7d, 30d, 90d' },
            limit: { type: 'integer', description: 'Nombre max (défaut 10)' },
          },
        },
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
    ],
  },
];

async function executeTool(name, args) {
  try {
    switch (name) {
      case 'search_tickets': {
        // Même moteur que le chatbot texte : les filtres structurés (status, priority,
        // locationName, assignedTo, requester, period) annoncés dans le schéma du tool sont
        // réellement appliqués via buildSearchQuery. Avant, seuls query/period étaient pris
        // en compte — les réponses chiffrées ne correspondaient pas à la question posée.
        const hasStructuredFilters = !!(args.status || args.priority || args.locationName || args.assignedTo || args.requester);
        if (hasStructuredFilters) {
          const where = buildSearchQuery({
            statuses: args.status ? [args.status] : undefined,
            priorities: args.priority ? [args.priority] : undefined,
            locationName: args.locationName || undefined,
            assignedToName: args.assignedTo || undefined,
            requesterName: args.requester || undefined,
            keyword: args.query || undefined,
            dateFrom: args.period && args.period !== 'all' ? getPeriodDate(args.period)?.toISOString?.() : undefined,
          }, null);
          const tickets = await prisma.ticket.findMany({
            where,
            take: Math.min(Number(args.limit) || 10, 50),
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
        // Sans filtre structuré : chemin classique (query texte → AI re-parsing), avec période
        const result = await searchTickets(args.query || null, Math.min(Number(args.limit) || 10, 50), null, args.period || null);
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

      case 'check_ticket': {
        const ticketId = Number(args.ticketId);
        if (!ticketId || isNaN(ticketId)) return { error: 'Numéro de ticket invalide' };
        const ticket = await prisma.ticket.findUnique({
          where: { id: ticketId },
          select: {
            id: true, title: true, content: true, status: true, priority: true,
            category: true, locationName: true,
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
              orderBy: { createdAt: 'desc' },
              take: 10,
              select: { id: true, minutes: true, description: true, createdAt: true, user: { select: { fullName: true } } },
            },
          },
        });
        if (!ticket) return { error: `Ticket #${args.ticketId} non trouvé` };
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
        const ticket = await prisma.ticket.findUnique({
          where: { id: Number(args.ticketId) },
          select: {
            id: true, title: true, content: true, status: true, priority: true,
            category: true, locationName: true, createdAt: true, updatedAt: true,
            solvedAt: true, requester: { select: { fullName: true } },
            assignedTo: { select: { fullName: true } },
            team: { select: { name: true } },
            followups: { select: { content: true, createdAt: true, user: { select: { fullName: true } } } },
          },
        });
        if (!ticket) return { error: `Ticket #${args.ticketId} non trouvé` };
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
        // Regroupements que l'utilisateur demande naturellement à l'oral, alignés sur l'UI
        result.ouverts = (result.NEW || 0) + (result.OPEN || 0) + (result.PLANNED || 0);
        result.enAttente = (result.PENDING || 0) + (result.WAITING_FOR_USER || 0);
        result.resolus = result.SOLVED || 0;
        result.fermes = result.CLOSED || 0;
        if (startDate) result.periode = { depuis: startDate.toISOString() };
        return result;
      }

      case 'get_ticket_time_entries': {
        const entries = await prisma.ticketTimeEntry.findMany({
          where: { ticketId: Number(args.ticketId) },
          orderBy: { createdAt: 'desc' },
          select: { id: true, minutes: true, description: true, createdAt: true, user: { select: { fullName: true } } },
        });
        const total = entries.reduce((sum, e) => sum + (e.minutes || 0), 0);
        return {
          ticketId: args.ticketId,
          tempsTotalMinutes: total,
          entrees: entries.map((e) => ({
            auteur: e.user?.fullName || '',
            minutes: e.minutes,
            description: e.description || '',
            date: e.createdAt?.toISOString?.() || '',
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
        const ticket = await prisma.ticket.create({
          data: {
            title: args.title, content: args.content,
            priority: args.priority || 'P3', status: 'NEW',
            category: args.category || null,
            locationName: args.locationName || null,
          },
          select: { id: true, title: true, status: true, priority: true },
        });
        return {
          success: true,
          message: `Ticket #${ticket.id} créé avec succès`,
          ticket: { id: ticket.id, titre: ticket.title, statut: ticket.status, priorite: ticket.priority },
        };
      }

      case 'update_ticket_status': {
        const ticket = await prisma.ticket.findUnique({
          where: { id: Number(args.ticketId) },
          select: { id: true, title: true, status: true },
        });
        if (!ticket) return { error: `Ticket #${args.ticketId} non trouvé` };
        const updated = await prisma.ticket.update({
          where: { id: Number(args.ticketId) },
          data: { status: args.status },
          select: { id: true, title: true, status: true },
        });
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
          prisma.ticket.count({ where: { ...where, status: 'OPEN' } }),
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
  const wss = new WebSocketServer({ server, pingInterval: 30000, pingTimeout: 10000 });

  wss.on('connection', async (ws, req) => {
    logger.info('[voice-live] Client connected');
    let session = null;

    try {
      const apiKey = await getGeminiApiKey();
      const genai = new GoogleGenAI({ apiKey });

      session = await genai.live.connect({
        model: LIVE_MODEL,
        config: {
          responseModalities: ['AUDIO'],
          systemInstruction: [
            'Tu es MARIE, un assistant vocal amical et professionnel pour un système ITSM/ERP.',
            'Tu parles en français, de manière concise et utile.',
            'Tu as accès à TOUS les outils du système: tickets, utilisateurs, équipes, lieux, inventaire, base de connaissances, rapports et statistiques.',
            'Utilise les outils quand on te pose des questions sur les tickets, utilisateurs, équipements, magasins, équipes, ou la base de connaissances.',
            'Quand tu crées ou modifies un ticket, confirme le numéro et le résultat.',
            'Pour les rapports et statistiques, synthétise les données de façon claire.',
            // ── Exactitude des chiffres ──
            'RÈGLE ABSOLUE : pour toute question chiffrée (combien, total, nombre, statistiques, classement), tu DOIS appeler un outil et répondre UNIQUEMENT avec les chiffres qu il renvoie.',
            'Ne devine JAMAIS un chiffre de mémoire et n arrondis pas : si l outil ne renvoie pas l information, dis que tu ne peux pas la vérifier.',
            'Lis les données renvoyées avec attention : le champ « total » est la source de vérité, pas un des sous-totaux.',
            // ── Rythme de la conversation ──
            'Laisse toujours l utilisateur TERMINER sa question : écoute jusqu au bout, puis réponds.',
            'Avant d annoncer un chiffre ou un résultat, dis brièvement « je vérifie » : cela masque le délai de l appel d outil.',
          ].join(' '),
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: LIVE_VOICE },
            },
          },
          // ── Détection de fin de parole plus patiente ──
          // Par défaut (END_SENSITIVITY_HIGH), le modèle coupe dès ~300 ms de silence :
          // une hésitation ou une respiration mid-phrase déclenche la réponse trop tôt, souvent
          // avec une question incomplète => chiffres hors sujet. END_SENSITIVITY_LOW + 900 ms
          // de silence requis laissent le temps de finir sa phrase (et sa pause de réflexion).
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: false,
              startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
              endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
              prefixPaddingMs: 100,
              silenceDurationMs: 900,
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
                if (sc.inputTranscription?.text) {
                  ws.send(JSON.stringify({ type: 'transcript', role: 'user', text: sc.inputTranscription.text }));
                }
                if (sc.outputTranscription?.text) {
                  ws.send(JSON.stringify({ type: 'transcript', role: 'assistant', text: sc.outputTranscription.text }));
                }
                if (sc.modelTurn?.parts) {
                  for (const part of sc.modelTurn.parts) {
                    if (part.inlineData?.data) {
                      ws.send(Buffer.from(part.inlineData.data, 'base64'));
                    }
                  }
                }
                if (sc.interrupted) {
                  ws.send(JSON.stringify({ type: 'interrupted' }));
                }
              }

              if (msg.toolCall) {
                try {
                  const fcs = msg.toolCall.functionCalls;
                  if (fcs && typeof fcs[Symbol.iterator] === 'function') {
                    for (const fc of fcs) {
                      const fcName = String(fc.name || '');
                      const fcArgs = JSON.parse(JSON.stringify(fc.args || {}));
                      const fcId = String(fc.id || '');
                      logger.info(`[voice-live] Tool: ${fcName}`);
                      const result = await executeTool(fcName, fcArgs);
                      await session.sendToolResponse({
                        functionResponses: [{ id: fcId, name: fcName, response: result }],
                      });
                    }
                  }
                } catch (toolErr) {
                  logger.error(`[voice-live] Tool error: ${toolErr.message}`);
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
          onclose: () => {
            logger.info('[voice-live] Gemini session closed');
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({ type: 'session_closed' }));
              ws.close();
            }
          },
        },
      });

      ws.on('message', async (data) => {
        try {
          if (Buffer.isBuffer(data) && session) {
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

module.exports = { setupVoiceLive };
