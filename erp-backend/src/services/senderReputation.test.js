const {
  computeReputation,
  computeClosureReputation,
  extractDomain,
  MIN_REJECTIONS,
  REJECTION_RATE_THRESHOLD,
  MIN_CLOSURE_REJECTIONS,
  CLOSURE_REJECTION_RATE_THRESHOLD,
  STATUS_NORMAL,
  STATUS_LOW_TRUST,
  STATUS_LOW_TRUST_CLOSURE,
} = require('./senderReputation');

describe('senderReputation', () => {
  describe('computeReputation', () => {
    it('reste NORMAL sans aucun ticket', () => {
      expect(computeReputation({ ticketsTotal: 0, ticketsRejected: 0 })).toBe(STATUS_NORMAL);
    });

    it('reste NORMAL quand tous les tickets sont approuvés', () => {
      expect(computeReputation({ ticketsTotal: 10, ticketsRejected: 0 })).toBe(STATUS_NORMAL);
    });

    it('reste NORMAL en dessous du seuil de rejets, même avec 100% de rejets', () => {
      // 2 rejets < MIN_REJECTIONS (3) : un expéditeur ne doit pas être dégradé sur un volume trop faible
      expect(computeReputation({ ticketsTotal: 2, ticketsRejected: 2 })).toBe(STATUS_NORMAL);
    });

    it('reste NORMAL avec assez de rejets mais un taux trop faible', () => {
      // 4 rejets sur 10 = 40% < REJECTION_RATE_THRESHOLD (50%)
      expect(computeReputation({ ticketsTotal: 10, ticketsRejected: 4 })).toBe(STATUS_NORMAL);
    });

    it('passe LOW_TRUST quand rejets >= MIN et taux >= seuil', () => {
      // 3 rejets sur 5 = 60% : dégradé
      expect(computeReputation({ ticketsTotal: 5, ticketsRejected: 3 })).toBe(STATUS_LOW_TRUST);
    });

    it('passe LOW_TRUST exactement au seuil', () => {
      // 3 rejets sur 6 = 50% : au seuil exact, dégradé
      expect(computeReputation({ ticketsTotal: 6, ticketsRejected: 3 })).toBe(STATUS_LOW_TRUST);
    });

    it(`seuil de rejets en adéquation avec la constante exportée (${MIN_REJECTIONS})`, () => {
      expect(MIN_REJECTIONS).toBe(3);
      expect(REJECTION_RATE_THRESHOLD).toBe(0.5);
    });
  });

  describe('computeClosureReputation', () => {
    it('reste NORMAL sans aucune décision de clôture', () => {
      expect(computeClosureReputation({ closureTotal: 0, closureRejected: 0 })).toBe(STATUS_NORMAL);
    });

    it('reste NORMAL quand toutes les clôtures sont validées', () => {
      expect(computeClosureReputation({ closureTotal: 10, closureRejected: 0 })).toBe(STATUS_NORMAL);
    });

    it('reste NORMAL sous le seuil minimal de rejets (1 rejet seul ne dégrade pas)', () => {
      expect(computeClosureReputation({ closureTotal: 1, closureRejected: 1 })).toBe(STATUS_NORMAL);
    });

    it('passe LOW_TRUST_CLOSURE dès 2 rejets avec un taux >= 60%', () => {
      // 2 rejets sur 3 = 66% : dégradé (une clôture à tort coûte plus cher qu'un ticket créé)
      expect(computeClosureReputation({ closureTotal: 3, closureRejected: 2 })).toBe(STATUS_LOW_TRUST_CLOSURE);
    });

    it('reste NORMAL avec 2 rejets mais un taux trop faible', () => {
      // 2 rejets sur 6 = 33% < 60%
      expect(computeClosureReputation({ closureTotal: 6, closureRejected: 2 })).toBe(STATUS_NORMAL);
    });

    it(`seuils en adéquation avec les constantes exportées (${MIN_CLOSURE_REJECTIONS} / ${CLOSURE_REJECTION_RATE_THRESHOLD})`, () => {
      expect(MIN_CLOSURE_REJECTIONS).toBe(2);
      expect(CLOSURE_REJECTION_RATE_THRESHOLD).toBe(0.6);
    });
  });

  describe('extractDomain', () => {
    it('extrait le domaine d\'une adresse standard', () => {
      expect(extractDomain('user@example.com')).toBe('example.com');
    });

    it('normalise en minuscules', () => {
      expect(extractDomain('User@Example.COM')).toBe('example.com');
    });

    it('retourne null sans @', () => {
      expect(extractDomain('pas-un-email')).toBeNull();
    });

    it('retourne null si l\'email est vide', () => {
      expect(extractDomain('')).toBeNull();
      expect(extractDomain(null)).toBeNull();
    });

    it('retourne null si le domaine est vide (trailing @)', () => {
      expect(extractDomain('user@')).toBeNull();
    });
  });
});
