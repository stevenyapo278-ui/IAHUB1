// Tests de la passerelle d'autorisation des outils (politique serveur).
// Aucune base : réglages et audit sont mockés.

jest.mock('./systemSettings', () => ({
  getSystemSettings: jest.fn(),
}));

jest.mock('./auditLogService', () => ({
  auditLog: jest.fn(async () => ({})),
}));

jest.mock('../middleware/permissions', () => ({
  hasPermission: jest.fn(async () => true),
}));

const { getSystemSettings } = require('./systemSettings');
const { auditLog } = require('./auditLogService');
const { hasPermission } = require('../middleware/permissions');
const {
  authorizeToolCall,
  isKnownTool,
  invalidatePolicyCache,
  TOOL_REGISTRY,
} = require('./toolPolicy');

const USER = { sub: 7, email: 'tech@prosuma.ci', role: 'TECHNICIAN' };

const baseSettings = (overrides = {}) => ({
  aiEnabled: true,
  aiKillSwitch: false,
  aiWritesEnabled: true,
  aiDisabledTools: [],
  ...overrides,
});

describe('toolPolicy — passerelle d’autorisation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidatePolicyCache();
    getSystemSettings.mockResolvedValue(baseSettings());
    hasPermission.mockResolvedValue(true);
  });

  it('refuse par défaut un outil inconnu (le modèle ne peut pas en inventer un)', async () => {
    const decision = await authorizeToolCall({ tool: 'delete_everything', user: USER, source: 'chat' });

    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('UNKNOWN_TOOL');
    expect(auditLog).toHaveBeenCalledWith('AI_TOOL_DENIED', expect.objectContaining({
      metadata: expect.objectContaining({ tool: 'delete_everything', code: 'UNKNOWN_TOOL' }),
    }));
  });

  it('autorise un outil de lecture pour un utilisateur authentifié', async () => {
    const decision = await authorizeToolCall({ tool: 'search_tickets', user: USER, source: 'chat' });
    expect(decision.allowed).toBe(true);
    expect(decision.tool.kind).toBe('read');
  });

  it('refuse tout outil quand l’arrêt d’urgence est actif', async () => {
    getSystemSettings.mockResolvedValue(baseSettings({ aiKillSwitch: true }));

    const read = await authorizeToolCall({ tool: 'search_tickets', user: USER, source: 'chat' });
    const write = await authorizeToolCall({ tool: 'create_ticket', user: USER, source: 'voice' });

    expect(read.allowed).toBe(false);
    expect(read.code).toBe('KILL_SWITCH');
    expect(write.allowed).toBe(false);
    expect(write.code).toBe('KILL_SWITCH');
  });

  it('coupe les écritures sans bloquer la lecture (aiWritesEnabled=false)', async () => {
    getSystemSettings.mockResolvedValue(baseSettings({ aiWritesEnabled: false }));

    const read = await authorizeToolCall({ tool: 'search_tickets', user: USER, source: 'chat' });
    const write = await authorizeToolCall({ tool: 'create_ticket', user: USER, source: 'voice' });
    const external = await authorizeToolCall({ tool: 'send_ticket_report', user: USER, source: 'chat' });

    expect(read.allowed).toBe(true);
    expect(write.allowed).toBe(false);
    expect(write.code).toBe('WRITES_DISABLED');
    expect(external.allowed).toBe(false);
    expect(external.code).toBe('WRITES_DISABLED');
  });

  it('refuse un outil présent dans la liste de refus administrateur', async () => {
    getSystemSettings.mockResolvedValue(baseSettings({ aiDisabledTools: ['search_emails'] }));

    const decision = await authorizeToolCall({ tool: 'search_emails', user: USER, source: 'chat' });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('TOOL_DISABLED');
  });

  it('exige une identité pour les outils de données (session vocale anonyme)', async () => {
    const anonymous = await authorizeToolCall({ tool: 'search_tickets', user: null, source: 'voice' });
    const context = await authorizeToolCall({ tool: 'get_context', user: null, source: 'voice' });

    expect(anonymous.allowed).toBe(false);
    expect(anonymous.code).toBe('AUTH_REQUIRED');
    expect(context.allowed).toBe(true);
  });

  it('applique la permission dédiée des outils à effet externe', async () => {
    hasPermission.mockResolvedValue(false);

    const decision = await authorizeToolCall({ tool: 'send_ticket_report', user: USER, source: 'chat' });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('PERMISSION_DENIED');
    expect(hasPermission).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 'automation.manage');
  });

  it('classe chaque outil écriture/externe comme non-lisible', () => {
    const writes = Object.entries(TOOL_REGISTRY)
      .filter(([, def]) => def.kind !== 'read')
      .map(([name]) => name);

    expect(writes).toEqual(expect.arrayContaining([
      'create_ticket', 'change_ticket_status', 'assign_ticket',
      'update_ticket_status', 'add_ticket_followup', 'send_ticket_report',
    ]));
  });

  it('couvre exactement les outils exposés par le chatbot texte et le vocal', () => {
    const { CHATBOT_TOOLS, WRITE_ACTION_TOOLS } = require('./chatbotService');
    const { TOOLS } = require('../routes/voiceLive.routes');

    const chatNames = [...CHATBOT_TOOLS, ...[...WRITE_ACTION_TOOLS].map((name) => ({ function: { name } }))]
      .map((t) => t.function.name);
    const voiceNames = TOOLS[0].functionDeclarations.map((t) => t.name);

    const missing = [...chatNames, ...voiceNames].filter((name) => !isKnownTool(name));
    expect(missing).toEqual([]);
  });
});
