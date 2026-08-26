jest.mock('ldapts', () => {
  const calls = { startTLS: 0 };
  // mail réel servant de cible à la recherche annuaire, par sAMAccountName
  const __mails = { ok: 'ok@prosuma.ci' };
  class Client {
    constructor() {
      this.bound = false;
    }
    async startTLS() {
      if (process.env.LDAP_STARTTLS === 'false') throw new Error('StartTLS desactive');
      calls.startTLS += 1;
      return;
    }
    async bind(dn, password) {
      const validDns = ['ok@prosuma.ci', 'ok@prosuma.lan'];
      if (validDns.includes(dn) && password === 'bon-mot-de-passe') {
        this.bound = true;
        return;
      }
      throw new Error('InvalidCredentials');
    }
    async search(base, options) {
      const m = String(options?.filter || '').match(/sAMAccountName=([^)]+)/);
      const sam = m ? m[1].trim() : null;
      if (!sam) return { searchEntries: [] };
      const mail = __mails[sam];
      return {
        searchEntries: mail
          ? [{ sAMAccountName: sam, mail, displayName: 'Ok Utilisateur' }]
          : [],
      };
    }
    async unbind() {
      this.bound = false;
    }
  }
  return { Client, __calls: calls, __mails };
});

const ldapAuth = require('./ldapAuth');
const { __calls, __mails } = require('ldapts');

describe('ldapAuth', () => {
  describe('ldapEmailFor', () => {
    it('construit l\'email UPN avec le domaine configuré', () => {
      expect(ldapAuth.ldapEmailFor('Styapo')).toBe('styapo@prosuma.ci');
    });
  });

  describe('authenticateLdap', () => {
    beforeEach(() => {
      __calls.startTLS = 0;
      __mails.ok = 'ok@prosuma.ci';
    });

    it('retourne username+email quand le bind AD réussit', async () => {
      const result = await ldapAuth.authenticateLdap('ok', 'bon-mot-de-passe');
      expect(result).toEqual({ username: 'ok', email: 'ok@prosuma.ci', fullName: 'Ok Utilisateur' });
    });

    it('monte en StartTLS avant le bind (URL ldap://, DC durci)', async () => {
      await ldapAuth.authenticateLdap('ok', 'bon-mot-de-passe');
      expect(__calls.startTLS).toBe(1);
    });

    it('n\'utilise pas StartTLS quand LDAP_STARTTLS=false', async () => {
      process.env.LDAP_STARTTLS = 'false';
      try {
        const result = await ldapAuth.authenticateLdap('ok', 'bon-mot-de-passe');
        expect(result.email).toBe('ok@prosuma.ci');
        expect(__calls.startTLS).toBe(0);
      } finally {
        delete process.env.LDAP_STARTTLS;
      }
    });

    it('retourne null quand le bind AD échoue (mauvais mot de passe)', async () => {
      const result = await ldapAuth.authenticateLdap('ok', 'mauvais');
      expect(result).toBeNull();
    });

    it('retourne null sur utilisateur inconnu', async () => {
      const result = await ldapAuth.authenticateLdap('inexistant', 'x');
      expect(result).toBeNull();
    });

    it('utilise LDAP_BIND_DOMAIN pour le bind mais garde LDAP_EMAIL_DOMAIN pour l\'email', async () => {
      process.env.LDAP_BIND_DOMAIN = 'prosuma.lan';
      try {
        const result = await ldapAuth.authenticateLdap('ok', 'bon-mot-de-passe');
        expect(result.email).toBe('ok@prosuma.ci');
      } finally {
        delete process.env.LDAP_BIND_DOMAIN;
      }
    });

    it('résout le vrai « mail » AD au lieu de construire username@domaine (bug doublon)', async () => {
      // Le login « styapo » doit retrouver le compte réel steven.yapo@…, pas créer un doublon.
      __mails.ok = 'steven.yapo@prosuma.ci';
      const result = await ldapAuth.authenticateLdap('ok', 'bon-mot-de-passe');
      expect(result.email).toBe('steven.yapo@prosuma.ci');
      expect(result.username).toBe('ok');
    });

    it('repli sur LDAP_EMAIL_DOMAIN quand l\'AD n\'a pas de champ mail', async () => {
      __mails.ok = '';
      const result = await ldapAuth.authenticateLdap('ok', 'bon-mot-de-passe');
      expect(result.email).toBe('ok@prosuma.ci');
    });

    it('retombe sur LDAP_EMAIL_DOMAIN quand le premier suffixe UPN est refusé', async () => {
      process.env.LDAP_BIND_DOMAIN = 'invalide.lan';
      try {
        const result = await ldapAuth.authenticateLdap('ok', 'bon-mot-de-passe');
        expect(result.email).toBe('ok@prosuma.ci');
      } finally {
        delete process.env.LDAP_BIND_DOMAIN;
      }
    });
  });
});
