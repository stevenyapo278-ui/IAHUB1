require('express-async-errors');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const authRoutes = require('./routes/auth.routes');
const ticketRoutes = require('./routes/ticket.routes');
const teamRoutes = require('./routes/team.routes');
const userRoutes = require('./routes/user.routes');
const permissionGroupRoutes = require('./routes/permissiongroup.routes');
const apiConfigRoutes = require('./routes/apiconfig.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const aiProviderRoutes = require('./routes/aiprovider.routes');
const emailAccountRoutes = require('./routes/emailaccount.routes');
const n8nRoutes = require('./routes/n8n.routes');
const glpiRoutes = require('./routes/glpi.routes');
const aiEmailDraftRoutes = require('./routes/aiemaildraft.routes');
const aiTicketSuggestionRoutes = require('./routes/aiticketsuggestion.routes');
const n8nConfigRoutes = require('./routes/n8nconfig.routes');
const knowledgeRoutes = require('./routes/knowledge.routes');
const outlookOAuthRoutes = require('./routes/outlookoauth.routes');
const inboxRoutes = require('./routes/inbox.routes');
const ticketIntelligenceRoutes = require('./routes/ticketintelligence.routes');
const systemSettingsRoutes = require('./routes/systemsettings.routes');
const advancedSettingsRoutes = require('./routes/advancedsettings.routes');
const promptTemplateRoutes = require('./routes/prompttemplate.routes');
const skillRoutes = require('./routes/skill.routes');
const reassignmentRoutes = require('./routes/reassignment.routes');
const notificationRoutes = require('./routes/notification.routes');
const draftApprovalRoutes = require('./routes/draftapproval.routes');
const triageRuleRoutes = require('./routes/triageRule.routes');
const chatbotRoutes = require('./routes/chatbot.routes');
const logsRoutes = require('./routes/logs.routes');
const auditLogRoutes = require('./routes/auditLog.routes');
const locationRoutes = require('./routes/location.routes');
const { allBreakerStatuses } = require('./utils/circuitBreaker');

const aiWeeklyReportRoutes = require('./routes/aiweeklyreport.routes');

const { requestId } = require('./middleware/requestId');
const { logger, childLogger } = require('./utils/logger');

const app = express();

// Si l'app est derrière un reverse proxy (Traefik/Nginx/Dokploy avec domaine),
// activer trust proxy pour que req.protocol retourne 'https' correctement.
// En accès direct IP:port, cette option n'est pas nécessaire.
if (process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },

  // Helmet v8 ajoute upgrade-insecure-requests par défaut dans la CSP.
  // Cela force le navigateur à charger tous les assets en HTTPS,
  // ce qui provoque ERR_CONNECTION_CLOSED quand l'app tourne en HTTP pur (IP locale).
  // On le désactive explicitement avec `null`.
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: null, // désactivé : obligatoire en HTTP sans TLS
    },
  },

  // HSTS dit au navigateur de forcer HTTPS pour toutes les visites futures.
  // Désactivé en HTTP pur — à réactiver uniquement si un vrai certificat TLS est en place.
  strictTransportSecurity: false,

  // COOP same-origin génère des warnings dans la console sur les origines HTTP non sécurisées.
  // On le désactive pour éviter la confusion en environnement local/IP.
  crossOriginOpenerPolicy: false,
}));
const corsOrigin = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()) : '*';
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '10mb' }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, standardHeaders: true, legacyHeaders: false });
app.use('/api', limiter);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' } });
app.use('/api/auth/login', authLimiter);

app.use(requestId);

// Middleware de logging HTTP : enregistre chaque requête avec son temps d'exécution
app.use((req, res, next) => {
  const start = Date.now();
  const log = childLogger(req.requestId);

  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    log[level](`${req.method} ${req.originalUrl} → ${res.statusCode} (${duration}ms)`, {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration,
    });
  });

  next();
});

// Fichiers persistants servis statiquement (ex: logo de signature email, voir systemsettings.routes.js)
app.use('/uploads', express.static('uploads'));

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/api/system/circuit-breakers', (req, res) => res.json(allBreakerStatuses()));

app.use('/api/auth', authRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/users', userRoutes);
app.use('/api/permission-groups', permissionGroupRoutes);
app.use('/api/api-configs', apiConfigRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/ai-providers', aiProviderRoutes);
app.use('/api/email-accounts', emailAccountRoutes);
app.use('/api/n8n-workflows', n8nRoutes);
app.use('/api/glpi', glpiRoutes);
app.use('/api/ai-email-drafts', aiEmailDraftRoutes);
app.use('/api/ai-ticket-suggestions', aiTicketSuggestionRoutes);
app.use('/api/n8n-config', n8nConfigRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/draft-approval', draftApprovalRoutes); // doit être monté avant les routers génériques /api (ligne suivante), qui appliquent authenticate à toute requête entrante peu importe si une de leurs routes internes matche
app.use('/api', outlookOAuthRoutes);
app.use('/api/inbox', inboxRoutes);
app.use('/api', ticketIntelligenceRoutes);
app.use('/api/system-settings', systemSettingsRoutes);
app.use('/api/advanced-settings', advancedSettingsRoutes);
app.use('/api/prompt-templates', promptTemplateRoutes);
app.use('/api/skills', skillRoutes);
app.use('/api/reassignments', reassignmentRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/triage-rules', triageRuleRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/ai-weekly-reports', aiWeeklyReportRoutes);
app.use('/api/chat', chatbotRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/audit-logs', auditLogRoutes);

// Serve frontend static files in production
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction) {
    const distPath = process.env.FRONTEND_DIST_PATH || path.join(__dirname, '..', '..', 'erp-frontend', 'dist');
    
    if (fs.existsSync(distPath)) {
        app.use(express.static(distPath));
        
        // Support React Router (SPA) by serving index.html for unknown routes
        app.get('*', (req, res, next) => {
            if (req.url.startsWith('/api') || req.url.includes('.')) {
                return next();
            }
            res.sendFile(path.join(distPath, 'index.html'));
        });
        logger.info(`Frontend servis depuis : ${distPath}`);
    } else {
        logger.warn(`Dossier frontend introuvable : ${distPath}`);
    }
}

app.use((req, res) => {
  const log = childLogger(req.requestId);
  log.warn(`Route introuvable : ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: 'Route introuvable' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const log = childLogger(req.requestId);
  log.error('Erreur non gérée', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

module.exports = app;
