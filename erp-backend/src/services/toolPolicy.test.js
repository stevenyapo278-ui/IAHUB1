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
  recordToolExecution,
  recordToolTaint,
  getSessionTaint,
  resetSessionTaint,
  TAINT_RULES,
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

// ── Mesures 5.3 : contrôle des enchaînements et marquage de provenance ───────
// Scénario de test de chaînage demandé par la feuille d'évaluation :
// lecture de données internes → tentative d'envoi à l'extérieur.
describe('toolPolicy — enchaînements et taint (mesures 5.3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidatePolicyCache();
    getSystemSettings.mockResolvedValue(baseSettings());
    hasPermission.mockResolvedValue(true);
  });

  it('propage le marquage d’un outil de lecture sensible', () => {
    const sessionKey = 'test-taint-basic';
    resetSessionTaint({ sessionKey });
    expect(getSessionTaint({ sessionKey })).toEqual([]);

    const labels = recordToolTaint({ tool: 'search_emails', user: USER, sessionKey });
    expect(labels.sort()).toEqual(['confidential', 'untrusted']);
    expect(getSessionTaint({ sessionKey }).sort()).toEqual(['confidential', 'untrusted']);
  });

  it('refuse send_ticket_report après lecture d’e-mails (exfiltration)', async () => {
    const sessionKey = 'test-sequence-deny';
    resetSessionTaint({ sessionKey });

    // 1) lecture de données internes autorisée
    const read = await authorizeToolCall({ tool: 'search_emails', user: USER, sessionKey });
    expect(read.allowed).toBe(true);
    await recordToolExecution({ tool: 'search_emails', user: USER, source: 'chat', sessionKey });

    // 2) envoi externe refusé dans la même session
    const send = await authorizeToolCall({ tool: 'send_ticket_report', user: USER, sessionKey });
    expect(send.allowed).toBe(false);
    expect(send.code).toBe('SEQUENCE_DENIED');
    expect(send.message).toMatch(/confirmation/i);
    expect(auditLog).toHaveBeenCalledWith(
      'AI_TOOL_DENIED',
      expect.objectContaining({
        targetLabel: 'send_ticket_report',
        metadata: expect.objectContaining({ code: 'SEQUENCE_DENIED' }),
      })
    );
  });

  it('bloque aussi après un contenu non fiable de ticket (indirect injection)', async () => {
    const sessionKey = 'test-sequence-untrusted';
    resetSessionTaint({ sessionKey });

    // get_ticket_summary est de risque 1 mais fait entrer du contenu rédigé par un tiers
    await recordToolExecution({ tool: 'get_ticket_summary', user: USER, sessionKey });
    expect(getSessionTaint({ sessionKey })).toContain('untrusted');

    const send = await authorizeToolCall({ tool: 'send_ticket_report', user: USER, sessionKey });
    expect(send.allowed).toBe(false);
    expect(send.code).toBe('SEQUENCE_DENIED');
  });

  it('autorise l’envoi si la session n’a rien lu de sensible', async () => {
    const sessionKey = 'test-sequence-clean';
    resetSessionTaint({ sessionKey });

    const send = await authorizeToolCall({ tool: 'send_ticket_report', user: USER, sessionKey });
    expect(send.allowed).toBe(true);
  });

  it('la confirmation humaine explicite débloque et trace AI_SEQUENCE_CONFIRMED', async () => {
    const sessionKey = 'test-sequence-confirmed';
    resetSessionTaint({ sessionKey });
    await recordToolExecution({ tool: 'search_emails', user: USER, sessionKey });

    const send = await authorizeToolCall({
      tool: 'send_ticket_report',
      user: USER,
      sessionKey,
      confirmed: true,
    });
    expect(send.allowed).toBe(true);
    expect(auditLog).toHaveBeenCalledWith(
      'AI_SEQUENCE_CONFIRMED',
      expect.objectContaining({
        targetLabel: 'send_ticket_report',
        metadata: expect.objectContaining({ taint: expect.arrayContaining(['confidential']) }),
      })
    );
  });

  it('isole le marquage par session', async () => {
    const keyA = 'test-isolation-a';
    const keyB = 'test-isolation-b';
    resetSessionTaint({ sessionKey: keyA });
    resetSessionTaint({ sessionKey: keyB });

    await recordToolExecution({ tool: 'search_emails', user: USER, sessionKey: keyA });

    const sendA = await authorizeToolCall({ tool: 'send_ticket_report', user: USER, sessionKey: keyA });
    const sendB = await authorizeToolCall({ tool: 'send_ticket_report', user: USER, sessionKey: keyB });
    expect(sendA.allowed).toBe(false);
    expect(sendB.allowed).toBe(true);
  });

  it('resetSessionTaint purge le marquage (nouvelle demande utilisateur)', async () => {
    const sessionKey = 'test-reset';
    resetSessionTaint({ sessionKey });
    await recordToolExecution({ tool: 'search_emails', user: USER, sessionKey });
    expect(getSessionTaint({ sessionKey }).length).toBeGreaterThan(0);

    resetSessionTaint({ sessionKey });
    expect(getSessionTaint({ sessionKey })).toEqual([]);
    const send = await authorizeToolCall({ tool: 'send_ticket_report', user: USER, sessionKey });
    expect(send.allowed).toBe(true);
  });

  it('déclare un marquage pour chaque outil de lecture exposant du contenu tiers', () => {
    const declared = Object.keys(TAINT_RULES);
    expect(declared).toEqual(expect.arrayContaining([
      'search_emails', 'get_ticket_summary', 'search_tickets',
      'search_users', 'search_inventory', 'analyze_root_cause',
    ]));
    for (const tool of declared) {
      expect(isKnownTool(tool)).toBe(true);
    }
  });
});
