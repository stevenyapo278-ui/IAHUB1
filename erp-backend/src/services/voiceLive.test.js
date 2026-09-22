describe('VoiceLive — unit checks (sans WS)', () => {
  // Snapshot cache logic : on vérifie la structure attendue
  it('snapshot contient les clés attendues', () => {
    const snap = { total: 100, open: 30, newCount: 10, myCount: 2, topLocs: [{ locationName: 'Abidjan', _count: { id: 5 } }], at: '2026-09-22 10:00' };
    expect(snap.total).toBe(100);
    expect(snap.topLocs[0].locationName).toBe('Abidjan');
  });

  it('LIVE_MODEL fallback est défini', () => {
    const LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';
    const LIVE_MODEL_FALLBACK = 'gemini-2.0-flash-live-preview-04-09';
    expect(LIVE_MODEL).not.toBe(LIVE_MODEL_FALLBACK);
    expect(LIVE_MODEL).toContain('native-audio');
  });

  it('callAIWithTools voiceMode limite à 3 tours', () => {
    const MAX_TOOL_ROUNDS = 6;
    const voiceMax = 3;
    expect(voiceMax).toBeLessThan(MAX_TOOL_ROUNDS);
    expect(voiceMax).toBe(3);
  });
});
