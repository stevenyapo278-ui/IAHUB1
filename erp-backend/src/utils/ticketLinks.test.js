const {
  LINK_TYPES,
  normalizeLinkType,
  normalizeLinkEndpoints,
  normalizeParentChildType,
} = require('./ticketLinks');

describe('normalizeLinkType — type de lien', () => {
  it('garde les 6 types valides (dont PARENT/CHILD)', () => {
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

describe('normalizeParentChildType — direction du lien hiérarchique', () => {
  it('PARENT sans inversion : idA = le ticket courant est le parent', () => {
    expect(normalizeParentChildType(3, 9, 'PARENT')).toBe('PARENT');
    expect(normalizeParentChildType(3, 9, 'CHILD')).toBe('CHILD');
  });

  it('inverse le type quand le ticket courant a l\'id le plus grand', () => {
    // ticket 9 est le parent du ticket 3 → stocké (3, 9, CHILD) : idA (3) est l'enfant
    expect(normalizeParentChildType(9, 3, 'PARENT')).toBe('CHILD');
    // ticket 9 est l'enfant du ticket 3 → stocké (3, 9, PARENT) : idA (3) est le parent
    expect(normalizeParentChildType(9, 3, 'CHILD')).toBe('PARENT');
  });
});