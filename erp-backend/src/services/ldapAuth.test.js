jest.mock('ldapts', () => {
  const calls = { startTLS: 0 };
  class Client {
    constructor() {
      this.bound = false;
    }
    async startTLS() {
      // Déclenche une erreur si la montée TLS est explicitement désactivée, pour
      // imiter un client qui ne l'exécute pas — sert de garde-fou au test « sans TLS ».
      if (process.env.LDAP_STARTTLS === 'false') throw new Error('StartTLS désactivé');
      calls.startTLS += 1;
      return;
    }
    async bind(dn, password) {
      if (dn === 'ok@prosuma.ci' && password === 'bon-mot-de-passe') {
        this.bound = true;
        return;
      }
      throw new Error('InvalidCredentials');
    }
    async unbind() {
      this.bound = false;
    }
  }
  return { Client, __calls: calls };
});

const ldapAuth = require('./ldapAuth');
const { __calls } = require('ldapts');

describe('ldapAuth', () => {
  describe('ldapEmailFor', () => {
    it('construit l\'email UPN avec le domaine configuré', () => {
      expect(ldapAuth.ldapEmailFor('Styapo')).toBe('styapo@prosuma.ci');
    });
  });

  describe('authenticateLdap', () => {
    beforeEach(() => {
      __calls.startTLS = 0;
    });

    it('retourne username+email quand le bind AD réussit', async () => {
      const result = await ldapAuth.authenticateLdap('ok', 'bon-mot-de-passe');
      expect(result).toEqual({ username: 'ok', email: 'ok@prosuma.ci' });
    });

    it('monte en StartTLS avant le bind (URL ldap://, DC durci)', async () => {
      await ldapAuth.authenticateLdap('ok', 'bon-mot-de-passe');
      expect(__calls.startTLS).toBe(1);
    });

    it('n\'utilise pas StartTLS quand LDAP_STARTTLS=false', async () => {
      process.env.LDAP_STARTTLS = 'false';
      try {
        const result = await ldapAuth.authenticateLdap('ok', 'bon-mot-de-passe');
        expect(result).toEqual({ username: 'ok', email: 'ok@prosuma.ci' });
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
  });
});
