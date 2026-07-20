const express = require('express');
const prisma = require('../prismaClient');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { getGlpiConfig, glpiInitSession, glpiKillSession } = require('../utils/glpiSync');

const router = express.Router();
router.use(authenticate);
router.use(requirePermission('glpi.manage', ['ADMIN', 'SUPERADMIN']));

// Endpoint central du tableau de bord de transition.
// Retourne les réglages actuels, les stats d'activité, et les événements récents.
router.get('/', async (req, res) => {
  const { days } = req.query;
  const periodDays = Math.min(parseInt(days) || 7, 90);
  const since = new Date();
  since.setDate(since.getDate() - periodDays);
  since.setHours(0, 0, 0, 0);

  try {
    const [settings, emailStats, ticketStats, followupStats, recentEvents, glpiInstances, importStats, locationStats] = await Promise.all([
      // 1. Réglages système
      prisma.systemSettings.findUnique({ where: { id: 1 } }),

      // 2. Emails traités sur la période
      prisma.incomingEmail.groupBy({
        by: ['status', 'isNewTicket'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),

      // 3. Tickets ERP créés sur la période, avec/sans glpiTicketId
      prisma.ticket.groupBy({
        by: ['glpiTicketId'],
        where: {
          createdAt: { gte: since },
          ...(req.query.sourceEmail ? { sourceEmail: { not: null } } : {}),
        },
        _count: { _all: true },
        _max: { createdAt: true },
      }),

      // 4. Statistiques des événements de transition
      prisma.ticketEvent.groupBy({
        by: ['type'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),

      // 5. Événements récents
      prisma.ticketEvent.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 30,
        include: {
          ticket: { select: { id: true, title: true, glpiTicketId: true } },
        },
      }),

      // 6. Instances GLPI configurées
      prisma.apiConfig.findMany({
        where: { serviceName: { in: ['glpi', 'glpi_dev'] } },
        select: { serviceName: true, baseUrl: true, isActive: true },
      }),

      // 7. Stats d'import des données historiques
      prisma.ticket.count({
        where: { aiProcessed: false, glpiTicketId: { not: null } },
      }),

      // 8. Stats des lieux
      prisma.glpiLocation.count(),
    ]);

    // Déterminer le mode actif
    const activeInstance = settings?.activeGlpiInstance || 'glpi';
    const dryRun = settings?.dryRunMode || false;
    const creationEnabled = settings?.enableGlpiTicketCreation !== false;

    let mode = 'PRODUCTION';
    let modeLabel = 'Production';
    let modeDescription = 'La plateforme écrit dans GLPI production.';
    let modeColor = '#16a34a';

    if (dryRun && activeInstance === 'glpi') {
      mode = 'AUDIT';
      modeLabel = 'Audit';
      modeDescription = 'Analyse des emails en lecture seule. Aucune écriture dans GLPI.';
      modeColor = '#f59e0b';
    } else if (dryRun && activeInstance === 'glpi_dev') {
      mode = 'HYBRID';
      modeLabel = 'Hybride';
      modeDescription = 'Surveillance de la production + écriture dans GLPI DEV.';
      modeColor = '#8b5cf6';
    } else if (!dryRun && activeInstance === 'glpi_dev') {
      mode = 'SIMULATION';
      modeLabel = 'Simulation';
      modeDescription = 'Tests en conditions réelles dans GLPI DEV. Aucun impact sur la production.';
      modeColor = '#3b82f6';
    } else if (!dryRun && activeInstance === 'glpi' && creationEnabled) {
      mode = 'PRODUCTION';
      modeLabel = 'Production';
      modeDescription = 'La plateforme écrit directement dans GLPI production.';
      modeColor = '#16a34a';
    } else {
      // PROD + création OFF = similaire à Audit mais avec écriture possible (suivis, fermetures)
      mode = 'AUDIT';
      modeLabel = 'Audit partiel';
      modeDescription = 'Production surveillée — création de tickets désactivée. Les suivis et fermetures peuvent encore être actifs.';
      modeColor = '#f59e0b';
    }

    // Compter les tickets avec glpiTicketId (créés dans GLPI) vs sans (ERP uniquement)
    const withGlpi = ticketStats.filter(t => t.glpiTicketId !== null);
    const withoutGlpi = ticketStats.filter(t => t.glpiTicketId === null);
    const glpiCreated = withGlpi.reduce((sum, t) => sum + t._count._all, 0);
    const erpOnly = withoutGlpi.reduce((sum, t) => sum + t._count._all, 0);

    // Compter les faux IDs négatifs (dry-run)
    const dryRunTickets = withGlpi
      .filter(t => t.glpiTicketId < 0)
      .reduce((sum, t) => sum + t._count._all, 0);

    // Compter les emails par statut
    const emailsProcessed = emailStats.reduce((sum, s) => sum + s._count._all, 0);
    const emailsNewTicket = emailStats
      .filter(s => s.isNewTicket)
      .reduce((sum, s) => sum + s._count._all, 0);
    const emailsFollowup = emailStats
      .filter(s => !s.isNewTicket)
      .reduce((sum, s) => sum + s._count._all, 0);
    const emailsSpam = emailStats
      .filter(s => s.status === 'SPAM')
      .reduce((sum, s) => sum + s._count._all, 0);
    const emailsError = emailStats
      .filter(s => s.status === 'ERROR')
      .reduce((sum, s) => sum + s._count._all, 0);

    // Compter les événements par type
    const eventCounts = Object.fromEntries(
      followupStats.map(e => [e.type, e._count._all])
    );

    return res.json({
      // Mode actuel
      mode: {
        id: mode,
        label: modeLabel,
        description: modeDescription,
        color: modeColor,
      },
      // Réglages actuels
      settings: {
        activeGlpiInstance: activeInstance,
        dryRunMode: dryRun,
        enableGlpiTicketCreation: creationEnabled,
        enableGlpiFollowupCreation: settings?.enableGlpiFollowupCreation !== false,
        enableGlpiTicketClosure: settings?.enableGlpiTicketClosure !== false,
        goLiveDate: settings?.goLiveDate || null,
        closedTicketBehavior: settings?.closedTicketBehavior || 'create_new',
        reopenThresholdDays: settings?.reopenThresholdDays || 90,
        glpiSourceMarker: settings?.glpiSourceMarker || 'internal_note',
      },
      // Statistiques
      stats: {
        periodDays,
        emailsProcessed,
        emailsNewTicket,
        emailsFollowup,
        emailsSpam,
        emailsError,
        ticketsCreated: glpiCreated + erpOnly,
        glpiTicketsCreated: glpiCreated - dryRunTickets,
        dryRunTickets,
        erpOnlyTickets: erpOnly,
        events: {
          created: eventCounts['CREATED'] || 0,
          reopened: eventCounts['REOPENED'] || 0,
          followups: eventCounts['FOLLOWUP_ADDED'] || eventCounts['EMAIL_RECEIVED'] || 0,
          escalated: eventCounts['AI_CONVERSATION_ESCALATED'] || 0,
          errors: eventCounts['GLPI_SYNC_FAILED'] || 0,
          aiDrafts: eventCounts['AI_DRAFT_GENERATED'] || eventCounts['AI_FOLLOWUP_DRAFT_GENERATED'] || 0,
        },
      },
      // Instances GLPI configurées
      instances: glpiInstances.map(i => ({
        id: i.serviceName,
        label: i.serviceName === 'glpi' ? 'GLPI Production' : 'GLPI Développement',
        baseUrl: i.baseUrl,
        isActive: i.isActive,
        isConfigured: !!i.baseUrl,
      })),
      // Événements récents
      recentEvents: recentEvents.map(e => ({
        id: e.id,
        type: e.type,
        actor: e.actor,
        ticketId: e.ticket?.id || null,
        ticketTitle: e.ticket?.title || null,
        glpiTicketId: e.ticket?.glpiTicketId || null,
        payload: e.payload,
        createdAt: e.createdAt,
      })),
      // Données historiques importées
      importData: {
        ticketsImported: importStats,
        locationsImported: locationStats,
        ticketsTotal: await prisma.ticket.count(),
        ticketsWithLocation: await prisma.ticket.count({ where: { glpiLocationName: { not: null } } }),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Comparaison PROD vs DEV ──────────────────────────────────────────────
// Interroge les deux instances GLPI (glpi + glpi_dev) et retourne les stats
// côte à côte : nombre de tickets, derniers tickets créés, divergence de contenu.
router.get('/compare', async (req, res) => {
  try {
    const [prodConfig, devConfig] = await Promise.all([
      getGlpiConfig('glpi'),
      getGlpiConfig('glpi_dev'),
    ]);

    const results = {};

    for (const [instanceName, config, label] of [
      ['glpi', prodConfig, 'GLPI Production'],
      ['glpi_dev', devConfig, 'GLPI Développement'],
    ]) {
      if (!config) {
        results[instanceName] = {
          label,
          configured: false,
          ticketCount: 0,
          recentTickets: [],
          error: 'Instance non configurée',
        };
        continue;
      }

      try {
        const sessionToken = await glpiInitSession(config);
        try {
          // Récupère le nombre total de tickets
          const countRes = await fetch(`${config.baseUrl}/Ticket?range=0-0`, {
            headers: {
              'App-Token': config.appToken,
              'Session-Token': sessionToken,
              'Content-Type': 'application/json',
            },
          });
          const contentRange = countRes.headers.get('content-range');
          const totalCount = contentRange ? parseInt(contentRange.split('/')[1], 10) : 0;

          // Récupère les 20 derniers tickets
          const range = totalCount > 20 ? `${totalCount - 20}-${totalCount - 1}` : '0-19';
          const ticketsRes = await fetch(`${config.baseUrl}/Ticket?range=${range}`, {
            headers: {
              'App-Token': config.appToken,
              'Session-Token': sessionToken,
              'Content-Type': 'application/json',
            },
          });
          const recentTickets = ticketsRes.ok ? await ticketsRes.json() : [];
          const tickets = Array.isArray(recentTickets) ? recentTickets : [];

          results[instanceName] = {
            label,
            configured: true,
            ticketCount: totalCount,
            recentTickets: tickets.slice(-10).reverse().map(t => ({
              id: t.id,
              name: t.name,
              status: t.status,
              date: t.date_creation || t.date_mod,
              priority: t.priority,
            })),
            error: null,
          };
        } finally {
          await glpiKillSession(config, sessionToken);
        }
      } catch (err) {
        results[instanceName] = {
          label,
          configured: true,
          ticketCount: 0,
          recentTickets: [],
          error: err.message,
        };
      }
    }

    // Compter dans l'ERP les tickets créés par email, par instance GLPI cible
    const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
    const activeInstance = settings?.activeGlpiInstance || 'glpi';

    // Tickets ERP avec glpiTicketId > 0 (tickets réellement créés dans GLPI)
    const erpGlpiTickets = await prisma.ticket.count({
      where: {
        glpiTicketId: { not: null, gt: 0 },
        createdAt: { gte: new Date(Date.now() - 30 * 86400000) },
      },
    });

    // Tickets ERP sans glpiTicketId (ERP uniquement, dry-run ou en attente)
    const erpOnlyTickets = await prisma.ticket.count({
      where: {
        glpiTicketId: null,
        sourceEmail: { not: null },
        createdAt: { gte: new Date(Date.now() - 30 * 86400000) },
      },
    });

    return res.json({
      instances: results,
      instanceActive: activeInstance,
      erp: {
        glpiSynced: erpGlpiTickets,
        erpOnly: erpOnlyTickets,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Analyse IA des tickets PROD vs DEV ───────────────────────────────────
// Utilise le provider IA configuré pour analyser les différences entre les
// tickets des instances GLPI (glpi + glpi_dev) et proposer des améliorations.
const { analyzeTicketDifferences, makeAIRequest } = require('../services/aiTicketComparison');

router.post('/analyze', async (req, res) => {
  try {
    const { limit } = req.body;
    const ticketLimit = Math.min(Math.max(parseInt(limit) || 20, 5), 50);
    const result = await analyzeTicketDifferences({ limit: ticketLimit });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── Chat sur l analyse IA ────────────────────────────────────────────────
// Permet de discuter de l analyse effectuee (notes, recommandations, donnees
// recuperees). Le contexte de l analyse (tickets PROD/DEV, synthese IA) est
// envoye comme contexte systeme pour que l IA puisse repondre precisement.

router.post('/chat', async (req, res) => {
  try {
    const { message, history = [], analysisContext } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message vide' });
    }

    // Construire le prompt systeme avec le contexte de l analyse
    let systemPrompt = [
      'Tu es un consultant expert ITIL specialise dans la qualite des donnees ITSM.',
      'Tu analyses les tickets de deux instances GLPI (Production et Developpement)',
      'et tu aides a comprendre les ecarts, les anomalies et les recommandations.',
      'Reponds en francais, de maniere concise et technique.',
      'Utilise le contexte ci-dessous pour etayer tes reponses.',
      '',
    ];

    if (analysisContext) {
      if (analysisContext.synthese) {
        systemPrompt.push('## Synthese de l analyse');
        systemPrompt.push(analysisContext.synthese);
        systemPrompt.push('');
      }
      if (analysisContext.notes && Object.keys(analysisContext.notes).length > 0) {
        systemPrompt.push('## Notes par domaine');
        for (const [key, val] of Object.entries(analysisContext.notes)) {
          if (val) {
            systemPrompt.push(key + ' : ' + (val.note != null ? val.note + '/10' : 'N/A') + ' - ' + (val.analyse || ''));
            if (val.problemes && val.problemes.length > 0) {
              systemPrompt.push('  Problemes : ' + val.problemes.join(', '));
            }
            if (val.recommandations && val.recommandations.length > 0) {
              systemPrompt.push('  Recommandations : ' + val.recommandations.join(', '));
            }
          }
        }
        systemPrompt.push('');
      }
      if (analysisContext.ameliorationsCode && analysisContext.ameliorationsCode.length > 0) {
        systemPrompt.push('## Ameliorations de code proposees');
        for (const am of analysisContext.ameliorationsCode) {
          systemPrompt.push('- [' + am.impact + '] ' + am.description + ' (effort: ' + am.effort + ')');
        }
        systemPrompt.push('');
      }
      if (analysisContext.stats) {
        systemPrompt.push('## Statistiques');
        systemPrompt.push('- Tickets PROD analyses: ' + (analysisContext.stats.prodCount || 0));
        systemPrompt.push('- Tickets DEV analyses: ' + (analysisContext.stats.devCount || 0));
        systemPrompt.push('- Tickets ERP totaux: ' + (analysisContext.stats.erpTotal || 0));
        systemPrompt.push('');
      }
    }

    systemPrompt.push(
      'Reponds de maniere precise en utilisant les donnees fournies.',
      'Si tu ne trouves pas la reponse dans le contexte, dis-le franchement.'
    );

    // Appel IA en utilisant makeAIRequest depuis aiTicketComparison (support multi-provider)
    const providers = await prisma.aiProvider.findMany({
      where: { isActive: true },
      include: {
        keys: { where: { isActive: true }, orderBy: { isDefault: 'desc' } },
        models: { where: { isActive: true, isDefault: true, type: 'CHAT' }, take: 1 },
      },
      orderBy: { label: 'asc' },
    });

    const activeProvider = providers.find(p => p.keys.length > 0);
    if (!activeProvider) {
      return res.status(422).json({ error: 'Aucun provider IA actif configure' });
    }

    const model = activeProvider.models[0]?.name;
    const baseUrl = activeProvider.baseUrl || (
      activeProvider.name === 'openai' ? 'https://api.openai.com/v1' :
      activeProvider.name === 'mistral' ? 'https://api.mistral.ai/v1' :
      activeProvider.name === 'anthropic' ? 'https://api.anthropic.com' :
      activeProvider.name === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta' :
      activeProvider.name === 'nvidia' ? 'https://integrate.api.nvidia.com/v1' :
      null
    );
    if (!baseUrl) {
      return res.status(422).json({ error: 'Base URL du provider non reconnue' });
    }

    // Construire le prompt complet (system + historique + message)
    const promptParts = systemPrompt.concat([
      '---',
      'Historique de la conversation :',
    ]);
    for (const msg of (history || [])) {
      promptParts.push((msg.role === 'user' ? 'Utilisateur' : 'Assistant') + ' : ' + (msg.content || ''));
    }
    promptParts.push('Utilisateur : ' + message);
    promptParts.push('Assistant :');

    const prompt = promptParts.join('\n');
    const key = activeProvider.keys[0];
    const reply = await makeAIRequest(activeProvider.name, baseUrl, key.apiKey, model, prompt, 2048);

    return res.json({ reply });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
