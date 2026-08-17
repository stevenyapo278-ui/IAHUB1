const {
  LINK_TYPES,
  normalizeLinkType,
  normalizeLinkEndpoints,
} = require('./ticketLinks');

describe('normalizeLinkType — type de lien', () => {
  it('garde les 4 types valides', () => {
    for (const t of LINK_TYPES) {
      expect(normalizeLinkType(t)).toBe(t);
    }
  });

  it('retombe sur RELATED pour un type inconnu ou absent', () => {
    expect(normalizeLinkType('TOTALLY_INVALID')).toBe('RELATED');
    expect(normalizeLinkType(undefined)).toBe('RELATED');
    expect(normalizeLinkType(null)).toBe('RELATED');
    expect(normalizeLinkType('')).toBe('RELATED');
  });
});

describe('normalizeLinkEndpoints — ordre canonique des extrémités', () => {
  it('ordonne toujours idA < idB', () => {
    const forward = normalizeLinkEndpoints(3, 9);
    expect(forward).toEqual({ idA: 3, idB: 9, reversed: false });

    const backward = normalizeLinkEndpoints(9, 3);
    expect(backward).toEqual({ idA: 3, idB: 9, reversed: true });
  });

  it('les deux sens produisent la même clé d\'unicité (lien inverse identique)', () => {
    const f1 = normalizeLinkEndpoints(42, 7);
    const f2 = normalizeLinkEndpoints(7, 42);
    expect(f1.idA).toBe(f2.idA);
    expect(f1.idB).toBe(f2.idB);
    expect(f1.reversed).toBe(!f2.reversed);
  });

  it('conserve le sens pour BLOCKS/BLOCKED_BY via reversed', () => {
    // Le ticket 42 bloque le ticket 7 : stocké (7, 42, BLOCKS) + reversed=true → affichable correctement
    const { idA, idB, reversed } = normalizeLinkEndpoints(42, 7);
    expect(idA).toBe(7);
    expect(idB).toBe(42);
    expect(reversed).toBe(true);
    expect(normalizeLinkEndpoints(7, 42).reversed).toBe(false);
  });
});