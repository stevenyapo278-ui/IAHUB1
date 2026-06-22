const express = require('express');
const cors = require('cors');

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
const draftApprovalRoutes = require('./routes/draftapproval.routes');

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

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

app.use((req, res) => res.status(404).json({ error: 'Route introuvable' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

module.exports = app;
