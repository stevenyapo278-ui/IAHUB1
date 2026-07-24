const express = require('express');
const cors = require('cors');
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

const { requestId } = require('./middleware/requestId');
const { logger, childLogger } = require('./utils/logger');

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());
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
app.use('/api/chat', chatbotRoutes);
app.use('/api/logs', logsRoutes);

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
