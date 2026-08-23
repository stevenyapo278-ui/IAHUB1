const { calculatePriority } = require('./emailPriorityMatrix');

describe('emailPriorityMatrix', () => {
  test('devrait calculer P1 pour Impact CRITICAL et Urgence CRITICAL / HIGH', () => {
    expect(calculatePriority('CRITICAL', 'CRITICAL', 'INCIDENT')).toBe('P1');
    expect(calculatePriority('CRITICAL', 'HIGH', 'INCIDENT')).toBe('P1');
  });

  test('devrait calculer P2 pour Impact HIGH et Urgence HIGH / CRITICAL ou CRITICAL x MEDIUM', () => {
    expect(calculatePriority('HIGH', 'HIGH', 'INCIDENT')).toBe('P2');
    expect(calculatePriority('HIGH', 'CRITICAL', 'INCIDENT')).toBe('P2');
    expect(calculatePriority('CRITICAL', 'MEDIUM', 'INCIDENT')).toBe('P2');
  });

  test('devrait calculer P3 pour les cas normaux', () => {
    expect(calculatePriority('MEDIUM', 'MEDIUM', 'INCIDENT')).toBe('P3');
    expect(calculatePriority('HIGH', 'LOW', 'INCIDENT')).toBe('P3');
    expect(calculatePriority('MEDIUM', 'HIGH', 'SERVICE_REQUEST')).toBe('P3');
  });

  test('devrait calculer P4 pour LOW x LOW et INFORMATION', () => {
    expect(calculatePriority('LOW', 'LOW', 'INCIDENT')).toBe('P4');
    expect(calculatePriority('HIGH', 'HIGH', 'INFORMATION')).toBe('P4');
  });

  test('devrait gérer les valeurs manquantes ou inattendues avec un fallback P3', () => {
    expect(calculatePriority(null, null)).toBe('P3');
    expect(calculatePriority('UNKNOWN', 'INVALID')).toBe('P3');
  });
});
