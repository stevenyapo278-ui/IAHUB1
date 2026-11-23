// Tests unitaires du module « Création de comptes applicatifs ».
// Aucune connexion PostgreSQL n'est nécessaire : on teste les fonctions pures de
// validation, d'idempotence et le mapping de la réponse IA.
const {
  normalizeAccounts,
  assertNoSecret,
  buildIdempotencyKey,
  findAliasConflicts,
  resolveBudibaseEndpoint,
  getBudibaseAppId,
  buildBudibaseHeaders,
  ProvisioningError,
} = require('./accountProvisioning');
const { parseAiSuggestion, detectApplications, buildDeterministicPrefill } = require('./accountProvisioningAi');
const {
  normalizeCandidateName,
  cleanAliases,
  fieldsFromProfiles,
} = require('./accountProvisioningCandidates');

const CATALOG = [
  {
    id: 1,
    name: 'Sage X3',
    aliases: ['x3', 'sage x3'],
    fields: [{ key: 'profile', label: 'Profil', type: 'select', options: ['Comptable', 'Acheteur'] }],
  },
  { id: 2, name: 'Microsoft 365', aliases: ['m365', 'office 365'] },
  { id: 3, name: 'Sage Paie', aliases: ['sage paie', 'paie'] },
];

describe('normalizeAccounts', () => {
  it('résout une application par id, nom ou alias et calcule le total', () => {
    const result = normalizeAccounts(
      [
        { applicationId: 1, login: 'j.doe', email: 'j.doe@prosuma.ci', profile: 'Comptable', quantity: 1 },
        { applicationName: 'm365', login: 'a.kone', quantity: 3 },
        { application: 'Sage X3', login: 'service', profile: 'Comptable', type: 'service', quantity: 2 },
      ],
      CATALOG
    );

    expect(result.accounts).toHaveLength(3);
    expect(result.accounts[1].applicationId).toBe(2);
    expect(result.accounts[1].applicationName).toBe('Microsoft 365');
    expect(result.accounts[2].type).toBe('SERVICE');
    expect(result.accountsCount).toBe(6);
    expect(result.applications).toEqual([
      { id: 1, name: 'Sage X3' },
      { id: 2, name: 'Microsoft 365' },
    ]);
    expect(result.primaryApplicationId).toBe(1);
  });

  it('refuse une application hors catalogue', () => {
    expect(() => normalizeAccounts([{ applicationName: 'SAP' }], CATALOG)).toThrow(ProvisioningError);
    expect(() => normalizeAccounts([{ applicationName: 'SAP' }], CATALOG)).toThrow(/hors catalogue/i);
  });

  it('refuse un mot de passe, même imbriqué', () => {
    expect(() => assertNoSecret({ login: 'x', password: 'secret' })).toThrow(/interdit/i);
    expect(() => assertNoSecret({ login: 'x', nested: { motDePasse: 'secret' } })).toThrow(/interdit/i);
  });

  it('refuse une quantité invalide', () => {
    expect(() => normalizeAccounts([{ applicationId: 1, quantity: 0 }], CATALOG)).toThrow(/quantité/i);
    expect(() => normalizeAccounts([{ applicationId: 1, quantity: 1.5 }], CATALOG)).toThrow(/quantité/i);
  });

  it('refuse une liste vide', () => {
    expect(() => normalizeAccounts([], CATALOG)).toThrow(/au moins un compte/i);
  });

  it('canonicalise un profil issu de la liste fermée du catalogue', () => {
    const result = normalizeAccounts([{ applicationId: 1, login: 'j.doe', profile: '  comptable ' }], CATALOG);
    expect(result.accounts[0].profile).toBe('Comptable');
  });

  it('refuse un profil hors liste fermée', () => {
    expect(() =>
      normalizeAccounts([{ applicationId: 1, login: 'j.doe', profile: 'Super-admin' }], CATALOG)
    ).toThrow(/valeurs autorisées/i);
  });

  it('refuse deux lignes identiques (même application + même identifiant)', () => {
    expect(() =>
      normalizeAccounts(
        [
          { applicationId: 1, login: 'j.doe', profile: 'Comptable' },
          { applicationId: 1, login: 'J.DOE', profile: 'Comptable' },
        ],
        CATALOG
      )
    ).toThrow(/déclaré deux fois/i);
  });

  it('refuse deux lignes identiques par l’email (sans identifiant)', () => {
    expect(() =>
      normalizeAccounts(
        [
          { applicationId: 2, email: 'contact@prosuma.ci' },
          { applicationId: 2, email: 'Contact@Prosuma.ci' },
        ],
        CATALOG
      )
    ).toThrow(/déclaré deux fois/i);
  });

  it('exige au moins un identifiant ou un email', () => {
    expect(() => normalizeAccounts([{ applicationId: 1, profile: 'Comptable' }], CATALOG)).toThrow(/identifiant/i);
  });

  it('accepte un compte identifié seulement par son email', () => {
    const result = normalizeAccounts([{ applicationId: 2, email: 'boite@prosuma.ci' }], CATALOG);
    expect(result.accounts[0].login).toBe('');
    expect(result.accounts[0].email).toBe('boite@prosuma.ci');
  });

  it('rend obligatoire un profil proposé en liste fermée', () => {
    expect(() => normalizeAccounts([{ applicationId: 1, login: 'j.doe' }], CATALOG)).toThrow(/obligatoire/i);
  });

  it('refuse un champ obligatoire absent du schéma catalogue', () => {
    const catalog = [
      { id: 9, name: 'Odoo', aliases: [], fields: [{ key: 'email', label: 'Email', type: 'text', required: true }] },
    ];
    expect(() => normalizeAccounts([{ applicationId: 9, login: 'x' }], catalog)).toThrow(/obligatoire/i);
  });

  it('considère une création quand l’opération n’est pas précisée', () => {
    const result = normalizeAccounts([{ applicationId: 2, login: 'j.doe' }], CATALOG);
    expect(result.accounts[0].operation).toBe('CREATION');
    expect(result.accounts[0].rights).toBe('');
  });

  it('accepte une mise à jour de droits décrite par le droit en texte libre', () => {
    const result = normalizeAccounts(
      [{ applicationId: 1, operation: 'DROITS', login: 'j.doe', rights: 'Accès module Paie' }],
      CATALOG
    );
    expect(result.accounts[0].operation).toBe('DROITS');
    expect(result.accounts[0].rights).toBe('Accès module Paie');
    // Le droit en texte libre dispense du profil imposé par la liste fermée.
    expect(result.accounts[0].profile).toBe('');
  });

  it('accepte une mise à jour de droits décrite par le profil seul', () => {
    const result = normalizeAccounts(
      [{ operation: 'DROITS', applicationName: 'Sage X3', login: 'j.doe', profile: 'acheteur' }],
      CATALOG
    );
    expect(result.accounts[0].profile).toBe('Acheteur');
  });

  it('exige un profil ou un droit pour une mise à jour sur une liste fermée', () => {
    expect(() =>
      normalizeAccounts([{ applicationId: 1, operation: 'DROITS', login: 'j.doe' }], CATALOG)
    ).toThrow(/obligatoire/i);
  });

  it('refuse une opération inconnue', () => {
    expect(() =>
      normalizeAccounts([{ applicationId: 2, operation: 'SUPPRESSION', login: 'j.doe' }], CATALOG)
    ).toThrow(/opération invalide/i);
  });

  it('refuse une quantité supérieure à 1 pour une mise à jour de droits', () => {
    expect(() =>
      normalizeAccounts([{ applicationId: 2, operation: 'DROITS', login: 'j.doe', quantity: 5 }], CATALOG)
    ).toThrow(/quantité 1/i);
  });

  it('autorise création et mise à jour de droits sur le même compte', () => {
    const result = normalizeAccounts(
      [
        { applicationId: 2, login: 'j.doe' },
        { applicationId: 2, operation: 'DROITS', login: 'j.doe', rights: 'Boîte partagée' },
      ],
      CATALOG
    );
    expect(result.accounts).toHaveLength(2);
  });

  it('refuse deux mises à jour de droits identiques sur le même compte', () => {
    expect(() =>
      normalizeAccounts(
        [
          { applicationId: 2, operation: 'DROITS', login: 'j.doe', rights: 'A' },
          { applicationId: 2, operation: 'DROITS', login: 'J.DOE', rights: 'B' },
        ],
        CATALOG
      )
    ).toThrow(/déclaré deux fois/i);
  });
});

describe('findAliasConflicts', () => {
  const others = [
    { id: 1, name: 'Sage X3', aliases: ['x3', 'sage x3'] },
    { id: 2, name: 'Sage Paie', aliases: ['sage paie', 'paie'] },
  ];

  it('signale un alias déjà utilisé par une autre application', () => {
    const conflicts = findAliasConflicts({ name: 'Sage Compta', aliases: ['x3'] }, others);
    expect(conflicts).toContainEqual(expect.objectContaining({ type: 'duplicate', alias: 'x3', application: 'Sage X3' }));
  });

  it('signale un alias contenu dans celui d’une autre application', () => {
    const conflicts = findAliasConflicts({ name: 'Nouvelle app', aliases: ['sage'] }, others);
    expect(conflicts.some((conflict) => conflict.type === 'contained')).toBe(true);
  });

  it('ignore l’application en cours de modification', () => {
    const conflicts = findAliasConflicts({ name: 'Sage X3', aliases: ['x3', 'sage x3'] }, others, 1);
    expect(conflicts.filter((conflict) => conflict.application === 'Sage X3')).toHaveLength(0);
  });

  it('signale un alias identique au nom', () => {
    const conflicts = findAliasConflicts({ name: 'Odoo', aliases: ['Odoo'] }, []);
    expect(conflicts[0].type).toBe('redundant');
  });
});

describe('buildIdempotencyKey', () => {
  it('est stable quel que soit l’ordre des clés', () => {
    const a = buildIdempotencyKey(12, [{ applicationId: 1, login: 'x', quantity: 1 }]);
    const b = buildIdempotencyKey(12, [{ quantity: 1, login: 'x', applicationId: 1 }]);
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('change quand le contenu change', () => {
    const a = buildIdempotencyKey(12, [{ applicationId: 1, login: 'x' }]);
    const b = buildIdempotencyKey(12, [{ applicationId: 1, login: 'y' }]);
    expect(a).not.toBe(b);
  });
});

describe('resolveBudibaseEndpoint', () => {
  it('construit l’URL avec le tableId et supprime le slash final', () => {
    const url = resolveBudibaseEndpoint({
      baseUrl: 'https://budibase.example.com/',
      extra: { tableId: 'ta_123' },
    });
    // API publique v4 : /api/public/v1 (l’ancien /api/v1 renvoie 404).
    expect(url).toBe('https://budibase.example.com/api/public/v1/tables/ta_123/rows');
  });

  it('accepte un chemin personnalisé', () => {
    const url = resolveBudibaseEndpoint({
      baseUrl: 'https://bb.local',
      extra: { tableId: 'ta_9', rowsPath: '/api/v1/tables/{tableId}/rows' },
    });
    expect(url).toBe('https://bb.local/api/v1/tables/ta_9/rows');
  });

  it('renvoie null sans tableId ou sans URL', () => {
    expect(resolveBudibaseEndpoint({ baseUrl: 'https://bb.local', extra: {} })).toBeNull();
    expect(resolveBudibaseEndpoint({ baseUrl: '', extra: { tableId: 'x' } })).toBeNull();
  });
});

describe('en-têtes Budibase', () => {
  it('ajoute x-budibase-app-id quand l’App ID est configuré', () => {
    const headers = buildBudibaseHeaders({
      apiKey: 'k',
      extra: { appId: 'app_dev_123', tableId: 'ta_1' },
    });
    expect(headers['x-budibase-api-key']).toBe('k');
    expect(headers['x-budibase-app-id']).toBe('app_dev_123');
  });

  it('omet l’en-tête app-id quand il n’est pas configuré', () => {
    const headers = buildBudibaseHeaders({ apiKey: 'k', extra: {} });
    expect(headers['x-budibase-app-id']).toBeUndefined();
    expect(getBudibaseAppId({ extra: {} })).toBe('');
  });
});

describe('parseAiSuggestion', () => {
  it('parse un JSON entouré de fences et mappe les alias', () => {
    const raw = '```json\n' + JSON.stringify({
      isAccountProvisioning: true,
      confidence: 0.91,
      reason: 'deux comptes créés',
      accounts: [
        { application: 'm365', login: 'j.doe', email: 'j.doe@prosuma.ci', profile: 'E3', type: 'NOMINAL', quantity: 1 },
        { application: 'Sage X3', login: 'a.kone', quantity: 2 },
      ],
    }) + '\n```';

    const result = parseAiSuggestion(raw, CATALOG);
    expect(result.ok).toBe(true);
    expect(result.isAccountProvisioning).toBe(true);
    expect(result.confidence).toBeCloseTo(0.91);
    expect(result.accounts).toHaveLength(2);
    expect(result.accounts[0].applicationId).toBe(2);
    expect(result.accounts[1].quantity).toBe(2);
    expect(result.applications).toHaveLength(2);
  });

  it('ignore une application inventée et la signale', () => {
    const raw = JSON.stringify({
      isAccountProvisioning: true,
      confidence: 0.8,
      accounts: [{ application: 'SAP R/3', login: 'x' }],
    });
    const result = parseAiSuggestion(raw, CATALOG);
    expect(result.accounts).toHaveLength(0);
    expect(result.ignoredApplications).toEqual(['SAP R/3']);
  });

  it('accepte une confiance en pourcentage et la borne à 1', () => {
    const result = parseAiSuggestion('{"confidence": 140, "accounts": []}', CATALOG);
    expect(result.confidence).toBe(1);
  });

  it('signale un JSON invalide sans lever', () => {
    const result = parseAiSuggestion('pas du json', CATALOG);
    expect(result.ok).toBe(false);
  });

  it('conserve la preuve textuelle renvoyée par l’IA', () => {
    const raw = JSON.stringify({
      isAccountProvisioning: true,
      confidence: 0.88,
      evidence: 'Compte Sage X3 créé pour M. Doe',
      accounts: [{ application: 'Sage X3', login: 'j.doe' }],
    });
    const result = parseAiSuggestion(raw, CATALOG);
    expect(result.evidence).toBe('Compte Sage X3 créé pour M. Doe');
  });

  it('respecte un booléen false explicite même si des comptes sont listés', () => {
    const raw = JSON.stringify({
      isAccountProvisioning: false,
      confidence: 0.9,
      accounts: [{ application: 'Sage X3', login: 'j.doe' }],
    });
    const result = parseAiSuggestion(raw, CATALOG);
    expect(result.isAccountProvisioning).toBe(false);
    // Le filtrage final appartient à suggestProvisioning (décision IA).
    expect(result.accounts).toHaveLength(1);
  });

  it('conserve l’opération et le droit renvoyés par l’IA', () => {
    const raw = JSON.stringify({
      isAccountProvisioning: true,
      confidence: 0.82,
      accounts: [{
        application: 'Sage Paie',
        operation: 'DROITS',
        login: 'j.doe',
        rights: 'Validation des bulletins',
        quantity: 4,
      }],
    });
    const result = parseAiSuggestion(raw, CATALOG);
    expect(result.accounts[0].operation).toBe('DROITS');
    expect(result.accounts[0].rights).toBe('Validation des bulletins');
    // Une mise à jour de droits porte sur un compte nommé : la quantité est forcée à 1.
    expect(result.accounts[0].quantity).toBe(1);
  });

  it('retombe sur une création quand l’opération est absente ou inconnue', () => {
    const raw = JSON.stringify({
      isAccountProvisioning: true,
      confidence: 0.7,
      accounts: [
        { application: 'Microsoft 365', login: 'a.kone' },
        { application: 'Microsoft 365', login: 'b.kone', operation: 'SUPPRESSION' },
      ],
    });
    const result = parseAiSuggestion(raw, CATALOG);
    expect(result.accounts.map((account) => account.operation)).toEqual(['CREATION', 'CREATION']);
  });

  it('collecte les applications hors catalogue signalées par l’IA', () => {
    const raw = JSON.stringify({
      isAccountProvisioning: true,
      confidence: 0.6,
      accounts: [{ application: 'SAP R/3', operation: 'CREATION', login: 'j.doe' }],
      unknownApplications: ['SAP R/3', 'CRM maison', 'm365'],
    });
    const result = parseAiSuggestion(raw, CATALOG);
    expect(result.accounts).toHaveLength(0);
    // Dédupliqué, et jamais une application du catalogue (« m365 » est un alias).
    expect(result.ignoredApplications).toEqual(['SAP R/3', 'CRM maison']);
  });
});

describe('applications candidates', () => {
  it('normalise casse, accents et ponctuation pour dédupliquer', () => {
    expect(normalizeCandidateName('Sage-X3')).toBe('sage x3');
    expect(normalizeCandidateName('  SAGE   X3 ')).toBe('sage x3');
    expect(normalizeCandidateName('SAP R/3')).toBe('sap r 3');
    expect(normalizeCandidateName('SAP R3')).toBe('sap r3');
    expect(normalizeCandidateName('')).toBe('');
  });

  it('déduplique les alias sans tenir compte de la casse ni des espaces', () => {
    expect(cleanAliases(['Zoho Test', 'zoho test', '  Zoho   TEST ', 'ztest', '']))
      .toEqual(['Zoho Test', 'ztest']);
    expect(cleanAliases(null)).toEqual([]);
  });

  it('construit un schéma de profils fermé et dédupliqué', () => {
    expect(fieldsFromProfiles(['Comptable', ' comptable ', 'Acheteur'])).toEqual([
      { key: 'profile', label: 'Profil', type: 'select', options: ['Comptable', 'Acheteur'] },
    ]);
    expect(fieldsFromProfiles([])).toEqual([]);
    expect(fieldsFromProfiles(null)).toEqual([]);
  });
});

describe('détection déterministe', () => {  it('détecte un alias avec accents et frontières de mots', () => {
    const apps = detectApplications('J’ai créé un accès à M365 pour le service comptabilité', CATALOG);
    expect(apps).toEqual([{ id: 2, name: 'Microsoft 365' }]);
  });

  it('ne confond pas un alias avec un fragment de mot', () => {
    const apps = detectApplications('message passage prudent', CATALOG);
    expect(apps).toEqual([]);
  });

  it('ne remonte que Sage Paie quand les alias se chevauchent', () => {
    const apps = detectApplications('Merci de créer un compte Sage Paie pour juillet', CATALOG);
    expect(apps).toEqual([{ id: 3, name: 'Sage Paie' }]);
  });

  it('ne déduit pas Sage X3 du seul mot « sage »', () => {
    expect(detectApplications('Le sage du village a parlé', CATALOG)).toEqual([]);
  });

  it('reste déterministe sur Sage X3 explicite', () => {
    expect(detectApplications('Ouverture d’un compte sage x3', CATALOG)).toEqual([{ id: 1, name: 'Sage X3' }]);
  });

  it('classe une demande comme non réalisée (aucun pré-remplissage de comptes)', () => {
    const prefill = buildDeterministicPrefill(
      { title: 'Création de compte Sage X3', content: 'Merci de créer le compte de M. Doe.' },
      [],
      CATALOG
    );
    expect(prefill.isAccountProvisioning).toBe(false);
    expect(prefill.aiUsed).toBe(false);
    expect(prefill.applications).toEqual([{ id: 1, name: 'Sage X3' }]);
    expect(prefill.confidence).toBeLessThan(0.3);
  });

  it('reconnaît une création attestée', () => {
    const prefill = buildDeterministicPrefill(
      { title: 'Compte Sage X3 créé', content: 'Le compte X3 a été créé pour M. Doe, identifiants remis en main propre.' },
      [],
      CATALOG
    );
    expect(prefill.isAccountProvisioning).toBe(true);
    expect(prefill.applications).toEqual([{ id: 1, name: 'Sage X3' }]);
  });

  it('reconnaît une négation', () => {
    const prefill = buildDeterministicPrefill(
      { title: 'Aucun compte créé', content: 'Le demandeur avait déjà un compte Odoo, aucune création nécessaire.' },
      [],
      CATALOG
    );
    expect(prefill.isAccountProvisioning).toBe(false);
  });

  it('ne déclenche rien sur un ticket hors sujet', () => {
    const prefill = buildDeterministicPrefill(
      { title: 'Imprimante hors service', content: 'L’imprimante du 2e étage ne répond plus.' },
      [],
      CATALOG
    );
    expect(prefill.isAccountProvisioning).toBe(false);
    // Hors sujet explicite : le pré-vol de résolution s'en sert pour ne pas
    // afficher la modale (contrairement à une simple négation ou demande).
    expect(prefill.explicitlyIrrelevant).toBe(true);
  });

  it('ne marque pas « hors sujet » un ticket qui parle de comptes', () => {
    const prefill = buildDeterministicPrefill(
      { title: 'Aucun compte créé', content: 'Le demandeur avait déjà un compte Odoo, aucune création nécessaire.' },
      [],
      CATALOG
    );
    expect(prefill.explicitlyIrrelevant).toBe(false);
  });

  it('reconnaît une mise à jour de droits attestée', () => {
    const prefill = buildDeterministicPrefill(
      { title: 'Droits Sage Paie', content: 'Les droits de validation ont été ajoutés au compte de j.doe sur Sage Paie.' },
      [],
      CATALOG
    );
    expect(prefill.isAccountProvisioning).toBe(true);
    expect(prefill.applications).toEqual([{ id: 3, name: 'Sage Paie' }]);
    expect(prefill.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('ne pré-remplit pas sur une demande de droits sans preuve', () => {
    const prefill = buildDeterministicPrefill(
      { title: 'Demande d’accès Odoo', content: 'Merci de donner les droits de consultation à M. Doe.' },
      [],
      CATALOG
    );
    expect(prefill.isAccountProvisioning).toBe(false);
  });

  it('reconnaît une négation portant sur les droits', () => {
    const prefill = buildDeterministicPrefill(
      { title: 'Aucun droit accordé', content: 'Aucun droit ajouté sur Sage X3, le profil actuel suffit.' },
      [],
      CATALOG
    );
    expect(prefill.isAccountProvisioning).toBe(false);
  });
});
