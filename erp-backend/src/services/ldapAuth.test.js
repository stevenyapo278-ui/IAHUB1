jest.mock('ldapts', () => {
  class Client {
    constructor() {
      this.bound = false;
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
  return { Client };
});

const ldapAuth = require('./ldapAuth');

describe('ldapAuth', () => {
  describe('ldapEmailFor', () => {
    it('construit l\'email UPN avec le domaine configuré', () => {
      expect(ldapAuth.ldapEmailFor('Styapo')).toBe('styapo@prosuma.ci');
    });
  });

  describe('authenticateLdap', () => {
    it('retourne username+email quand le bind AD réussit', async () => {
      const result = await ldapAuth.authenticateLdap('ok', 'bon-mot-de-passe');
      expect(result).toEqual({ username: 'ok', email: 'ok@prosuma.ci' });
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
