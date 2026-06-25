import { useState, useEffect, useRef } from 'react';
import api from '../api/client';
import anime from 'animejs';

const PIPELINE_STEPS = [
  'Réception email',
  'Extraction signature',
  'Filtre Anti-Spam',
  'Liaison fil',
  'Détection doublon',
  'Analyse intention',
  'Création Ticket',
  'Génération réponse',
  'Finalisation'
];

export default function Supervision() {
  const [bootPhase, setBootPhase] = useState(0); // 0: init, 1: loading modules, 2: mailboxes, 3: ready
  const [loadingPercent, setLoadingPercent] = useState(0);
  
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);

  const pageLoadTime = useRef(new Date());
  const [pipelineStates, setPipelineStates] = useState({});
  const animationRef = useRef(null);
  const terminalEndRef = useRef(null);
  const [activeEmailId, setActiveEmailId] = useState(null);
  const [emailAccounts, setEmailAccounts] = useState([]);
  const [activeEnginesText, setActiveEnginesText] = useState('gemini-pro, glpi-api, react-router');

  // Charger les informations système réelles (boîtes mail et modèles d'IA configurés)
  useEffect(() => {
    const loadSystemInfo = async () => {
      try {
        const [accountsRes, providersRes] = await Promise.all([
          api.get('/email-accounts'),
          api.get('/ai-providers')
        ]);
        
        // Comptes email actifs
        const activeAccounts = (accountsRes.data || []).filter(acc => acc.isActive);
        setEmailAccounts(activeAccounts);

        // Modèles d'IA configurés par défaut
        const activeModels = [];
        (providersRes.data || []).forEach(p => {
          if (p.isActive) {
            const defModel = (p.models || []).find(m => m.isActive && m.isDefault && m.type === 'CHAT');
            if (defModel) {
              activeModels.push(defModel.name);
            }
          }
        });
        
        if (activeModels.length > 0) {
          setActiveEnginesText(`${activeModels.join(', ')}, glpi-api, react-router`);
        } else {
          setActiveEnginesText('glpi-api, react-router');
        }
      } catch (err) {
        console.error('Erreur lors du chargement des informations système :', err);
      }
    };

    loadSystemInfo();
  }, []);

  // Mettre à jour l'e-mail actif lors du défilement
  const handleScroll = (e) => {
    const container = e.target;
    const containerCenter = container.getBoundingClientRect().top + container.clientHeight / 2;
    
    let closestId = null;
    let minDistance = Infinity;

    emails.forEach(email => {
      const el = document.getElementById(`card-${email.id}`);
      if (el) {
        const rect = el.getBoundingClientRect();
        const cardCenter = rect.top + rect.height / 2;
        const distance = Math.abs(cardCenter - containerCenter);
        if (distance < minDistance) {
          minDistance = distance;
          closestId = email.id;
        }
      }
    });

    if (closestId && closestId !== activeEmailId) {
      setActiveEmailId(closestId);
    }
  };

  // Initialiser l'e-mail actif quand la liste change
  useEffect(() => {
    if (emails.length > 0 && !activeEmailId) {
      setActiveEmailId(emails[0].id);
    }
  }, [emails, activeEmailId]);

  // Auto-scroll du terminal
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [bootPhase, loadingPercent, emails, error, syncing]);

  // Séquence d'initialisation du terminal (retro boot phase)
  useEffect(() => {
    if (bootPhase === 0) {
      const t1 = setTimeout(() => setBootPhase(1), 400);
      return () => clearTimeout(t1);
    }

    if (bootPhase === 1) {
      let percent = 0;
      const interval = setInterval(() => {
        percent += 4;
        if (percent >= 100) {
          percent = 100;
          clearInterval(interval);
          setBootPhase(2);
        }
        setLoadingPercent(percent);
      }, 30);
      return () => clearInterval(interval);
    }

    if (bootPhase === 2) {
      const t2 = setTimeout(() => setBootPhase(3), 800);
      return () => clearTimeout(t2);
    }
  }, [bootPhase]);

  // Charger les emails réels
  const loadEmails = async (isFirstLoad = false) => {
    try {
      if (isFirstLoad) setLoading(true);
      const res = await api.get('/inbox?page=1&limit=10');
      setEmails(res.data.items || []);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Erreur de chargement des e-mails');
    } finally {
      if (isFirstLoad) setLoading(false);
    }
  };

  // Déclencher le polling des emails après le boot
  useEffect(() => {
    if (bootPhase !== 3) return;

    loadEmails(true);

    const interval = setInterval(() => {
      loadEmails(false);
    }, 5000);

    return () => clearInterval(interval);
  }, [bootPhase]);

  // Déterminer l'état final visuel d'un e-mail
  function getFinalPipelineState(email) {
    const isSpam = email.aiIsSpam || email.status === 'SPAM';
    const isError = email.status === 'ERROR';

    if (isSpam) {
      const states = Array(PIPELINE_STEPS.length).fill('skipped');
      states[0] = 'done';
      states[1] = 'done';
      states[2] = 'failed';
      return {
        id: email.id,
        percent: 33,
        activeStepIndex: 2,
        stepStates: states,
        details: {
          status: 'SPAM',
          message: "L'IA a bloqué le processus (détecté comme Spam).",
          confidence: email.aiConfidence != null ? `${Math.round(email.aiConfidence * 100)}%` : '—'
        }
      };
    } else if (isError) {
      const states = Array(PIPELINE_STEPS.length).fill('skipped');
      for (let i = 0; i < 6; i++) states[i] = 'done';
      states[6] = 'failed';
      return {
        id: email.id,
        percent: 77,
        activeStepIndex: 6,
        stepStates: states,
        error: email.error || 'Erreur inconnue lors du traitement'
      };
    } else {
      const states = Array(PIPELINE_STEPS.length).fill('done');
      return {
        id: email.id,
        percent: 100,
        activeStepIndex: PIPELINE_STEPS.length,
        stepStates: states,
        details: {
          status: 'DONE',
          ticketId: email.erpTicketId,
          glpiId: email.glpiTicketId,
          category: email.aiCategory || 'INCIDENT',
          priority: email.aiPriority || 'P3',
          summary: email.aiSummary || 'Triage effectué avec succès.'
        }
      };
    }
  }

  // Initialiser et mettre à jour les pipelines d'animation
  useEffect(() => {
    if (emails.length === 0) return;

    setPipelineStates(prev => {
      const next = { ...prev };
      let updated = false;

      emails.forEach(email => {
        if (!next[email.id]) {
          const isOld = new Date(email.createdAt) < pageLoadTime.current;
          if (isOld) {
            next[email.id] = getFinalPipelineState(email);
          } else {
            next[email.id] = {
              id: email.id,
              percent: 0,
              activeStepIndex: 0,
              stepStates: Array(PIPELINE_STEPS.length).fill('pending'),
              isAnimating: true,
              targetState: getFinalPipelineState(email)
            };
          }
          updated = true;
        } else if (!next[email.id].isAnimating) {
          // Si l'e-mail a été mis à jour en base (ex: fini son traitement), on met à jour son état cible final
          const finalState = getFinalPipelineState(email);
          if (next[email.id].percent !== finalState.percent || next[email.id].details?.ticketId !== finalState.details?.ticketId) {
            next[email.id] = finalState;
            updated = true;
          }
        }
      });

      return updated ? next : prev;
    });
  }, [emails]);

  // Gérer l'animation pas-à-pas des nouveaux e-mails
  useEffect(() => {
    const animatingIds = Object.keys(pipelineStates).filter(id => pipelineStates[id].isAnimating);
    if (animatingIds.length === 0) return;

    const interval = setInterval(() => {
      setPipelineStates(prev => {
        const next = { ...prev };
        let updated = false;

        animatingIds.forEach(id => {
          const state = next[id];
          if (!state || !state.isAnimating) return;

          const currentIdx = state.activeStepIndex;
          const target = state.targetState;
          const states = [...state.stepStates];

          if (currentIdx > 0 && states[currentIdx - 1] === 'running') {
            states[currentIdx - 1] = 'done';
          }

          const maxIdx = target.activeStepIndex;

          if (currentIdx < maxIdx) {
            states[currentIdx] = 'running';
            const nextPercent = Math.round(((currentIdx + 1) / PIPELINE_STEPS.length) * 100);
            next[id] = {
              ...state,
              percent: nextPercent,
              activeStepIndex: currentIdx + 1,
              stepStates: states
            };
            updated = true;
          } else {
            next[id] = {
              ...target,
              isAnimating: false
            };
            updated = true;
          }
        });

        return updated ? next : prev;
      });
    }, 450);

    return () => clearInterval(interval);
  }, [pipelineStates]);

  // Animation anime.js pour l'état vide (radar / constellation)
  useEffect(() => {
    if (emails.length > 0 || loading || bootPhase < 3) {
      if (animationRef.current) {
        animationRef.current.pause();
        animationRef.current = null;
      }
      return;
    }

    // Lancement des animations anime.js individuelles sur les éléments SVG
    const radarSweepAnim = anime({
      targets: '.radar-sweep',
      rotate: '360deg',
      duration: 6000,
      easing: 'linear',
      loop: true
    });

    const orbit1Anim = anime({
      targets: '.orbit-1',
      rotate: '360deg',
      duration: 25000,
      easing: 'linear',
      loop: true
    });

    const orbit2Anim = anime({
      targets: '.orbit-2',
      rotate: '-360deg',
      duration: 18000,
      easing: 'linear',
      loop: true
    });

    const coreGlowAnim = anime({
      targets: '.core-glow',
      scale: [1, 1.2],
      opacity: [0.4, 0.9],
      duration: 2000,
      direction: 'alternate',
      easing: 'easeInOutQuad',
      loop: true
    });

    const networkNodesAnim = anime({
      targets: '.network-node',
      translateX: () => anime.random(-8, 8),
      translateY: () => anime.random(-8, 8),
      scale: () => anime.random(0.9, 1.1),
      duration: () => anime.random(3000, 5000),
      direction: 'alternate',
      easing: 'easeInOutQuad',
      loop: true
    });

    const networkLinesAnim = anime({
      targets: '.network-line',
      strokeDashoffset: [anime.setDashoffset, 0],
      duration: 4000,
      delay: () => anime.random(0, 1000),
      direction: 'alternate',
      easing: 'easeInOutSine',
      loop: true
    });

    animationRef.current = {
      pause: () => {
        radarSweepAnim.pause();
        orbit1Anim.pause();
        orbit2Anim.pause();
        coreGlowAnim.pause();
        networkNodesAnim.pause();
        networkLinesAnim.pause();
      }
    };

    return () => {
      if (animationRef.current) {
        animationRef.current.pause();
        animationRef.current = null;
      }
    };
  }, [emails, loading, bootPhase]);

  // Synchronisation manuelle déclenchée par l'utilisateur
  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      await api.post('/inbox/sync');
      await loadEmails(false);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Erreur lors de la synchronisation');
    } finally {
      setSyncing(false);
    }
  };

  // Générer la barre de progression textuelle [████░░░░]
  function makeProgressBar(percent, totalBlocks = 24) {
    const filledBlocks = Math.round((percent / 100) * totalBlocks);
    const emptyBlocks = totalBlocks - filledBlocks;
    return '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);
  }

  // Mapper le state des emails vers les pipelines de rendu
  const activePipelines = emails.map(email => {
    const state = pipelineStates[email.id];
    if (!state) {
      return {
        id: email.id,
        subject: email.subject,
        percent: 0,
        activeStepIndex: 0,
        stepStates: Array(PIPELINE_STEPS.length).fill('pending')
      };
    }
    return {
      ...state,
      subject: email.subject
    };
  });

  return (
    <div className="min-h-[calc(100vh-140px)] flex flex-col items-center justify-center p-md font-mono bg-[#000511] font-medium selection:bg-primary/20 text-[#f1f5f9] select-none">
      <div className="w-full max-w-3xl text-[14px] leading-relaxed space-y-md">
        
        {/* Ligne de commande initiale */}
        <div>
          <span className="text-primary font-bold">~ $ </span>
          <span>itsm-triage-daemon --monitor</span>
        </div>

        {/* Phase 0 & 1 : En-têtes du terminal */}
        {bootPhase >= 1 && (
          <div className="space-y-sm">
            <div>itsm-triage v1.0.0</div>
            <div>initializing triage engines...</div>
            <div className="flex items-center gap-xs">
              <span>loading neural engines</span>
              <span className="text-primary font-bold">
                [{makeProgressBar(loadingPercent)}]
              </span>
              <span>{Math.round((loadingPercent / 100) * 9)}/9</span>
            </div>
          </div>
        )}

        {/* Phase 2 & 3 : Connexion aux boîtes mail */}
        {bootPhase >= 2 && (
          <div className="space-y-xs">
            <div>connecting to active mailboxes...</div>
            {emailAccounts.length === 0 ? (
              <div className="flex items-center gap-sm pl-md">
                <span className="text-amber-500">→ [no active mailbox configured]</span>
              </div>
            ) : (
              emailAccounts.map(acc => (
                <div key={acc.id} className="flex items-center gap-sm pl-md">
                  <span>→ {acc.emailAddress}</span>
                  <span className="text-emerald-400">[ready]</span>
                </div>
              ))
            )}
          </div>
        )}

        {/* Phase 3 : Prêt pour recevoir des commandes / monitoring réel */}
        {bootPhase >= 3 && (
          <div className="space-y-md w-full">
            <div>
              <span className="text-emerald-400">ready</span>
              <span className="text-on-surface-variant">. powered by {activeEnginesText}</span>
            </div>

            {/* Barre de statut du Moniteur */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-sm border border-outline-variant/30 p-md rounded-xl bg-[#000a1f]/60 w-full">
              <div className="flex items-center gap-sm">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                </span>
                <div>
                  <div className="text-[#f1f5f9] font-bold">Moniteur en temps réel</div>
                  <div className="text-xs text-slate-400">Daemon de triage IA actif (mise à jour 5s)</div>
                </div>
              </div>
              
              <div className="flex items-center gap-md">
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="flex items-center gap-xs px-md py-sm rounded-lg bg-primary hover:bg-primary/80 disabled:opacity-50 text-white text-xs font-bold transition-all font-mono shadow-md shadow-primary/20 hover:shadow-lg"
                >
                  <span className="material-symbols-outlined text-[16px] animate-spin" style={{ animationDuration: syncing ? '2s' : '0s' }}>sync</span>
                  {syncing ? 'Synchronisation...' : 'Synchroniser'}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-red-500 font-bold border border-red-500/20 bg-red-500/5 p-md rounded-xl text-sm">
                [erreur] Échec de la communication avec le daemon : {error}
              </div>
            )}

            {/* État vide : Anime.js Radar / Constellation */}
            {!loading && emails.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 px-4 text-center max-w-xl mx-auto border border-outline-variant/20 rounded-xl bg-[#000a1f]/40 relative overflow-hidden">
                <div className="relative w-80 h-80 flex items-center justify-center mb-4">
                  
                  {/* SVG de Radar & Réseau de Neurones */}
                  <svg className="w-full h-full overflow-visible" viewBox="0 0 200 200">
                    <defs>
                      <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.8" />
                        <stop offset="100%" stopColor="#4f46e5" stopOpacity="0" />
                      </radialGradient>
                      <linearGradient id="radarSweepGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="#4f46e5" stopOpacity="0" />
                      </linearGradient>
                    </defs>

                    {/* Cercles concentriques */}
                    <circle cx="100" cy="100" r="90" fill="none" stroke="#1e293b" strokeWidth="1" />
                    <circle cx="100" cy="100" r="70" fill="none" stroke="#1e293b" strokeWidth="1" strokeDasharray="4, 4" className="orbit-1 origin-center" />
                    <circle cx="100" cy="100" r="50" fill="none" stroke="#1e293b" strokeWidth="1" />
                    <circle cx="100" cy="100" r="30" fill="none" stroke="#1e293b" strokeWidth="1" strokeDasharray="3, 3" className="orbit-2 origin-center" />

                    {/* Axes de radar */}
                    <line x1="100" y1="10" x2="100" y2="190" stroke="#1e293b" strokeWidth="0.5" />
                    <line x1="10" y1="100" x2="190" y2="100" stroke="#1e293b" strokeWidth="0.5" />

                    {/* Ligne de balayage */}
                    <g className="radar-sweep origin-center">
                      <line x1="100" y1="100" x2="100" y2="10" stroke="#4f46e5" strokeWidth="2" strokeLinecap="round" />
                      <polygon points="100,100 100,10 60,20" fill="url(#radarSweepGrad)" opacity="0.5" />
                    </g>

                    {/* Connexions & Nœuds */}
                    <g>
                      <line x1="100" y1="100" x2="50" y2="60" stroke="#818cf8" strokeWidth="1" strokeOpacity="0.3" className="network-line" strokeDasharray="100" />
                      <line x1="100" y1="100" x2="150" y2="70" stroke="#818cf8" strokeWidth="1" strokeOpacity="0.3" className="network-line" strokeDasharray="100" />
                      <line x1="100" y1="100" x2="70" y2="140" stroke="#818cf8" strokeWidth="1" strokeOpacity="0.3" className="network-line" strokeDasharray="100" />
                      <line x1="100" y1="100" x2="130" y2="150" stroke="#818cf8" strokeWidth="1" strokeOpacity="0.3" className="network-line" strokeDasharray="100" />

                      <circle cx="50" cy="60" r="5" fill="#38bdf8" className="network-node origin-center" />
                      <circle cx="150" cy="70" r="4" fill="#818cf8" className="network-node origin-center" />
                      <circle cx="70" cy="140" r="6" fill="#6366f1" className="network-node origin-center" />
                      <circle cx="130" cy="150" r="5" fill="#06b6d4" className="network-node origin-center" />
                    </g>

                    {/* Noyau central */}
                    <circle cx="100" cy="100" r="24" fill="url(#coreGlow)" className="core-glow origin-center" />
                    <circle cx="100" cy="100" r="8" fill="#4f46e5" />
                    <circle cx="100" cy="100" r="3" fill="#ffffff" />
                  </svg>

                  {/* Lettre flottante au centre */}
                  <div className="absolute flex items-center justify-center pointer-events-none">
                    <span className="material-symbols-outlined text-white text-3xl animate-bounce" style={{ animationDuration: '3s' }}>
                      mail
                    </span>
                  </div>
                </div>

                <h3 className="text-md font-bold text-[#f1f5f9] mb-2 tracking-wide font-mono uppercase">
                  Moniteur en veille active
                </h3>
                <p className="text-slate-400 font-mono text-xs leading-relaxed max-w-xs">
                  Daemon de triage en écoute. Aucun e-mail dans la boîte de réception à analyser.
                </p>
              </div>
            ) : (
              /* Mise en page Flex pour la liste d'e-mails avec effet de fondu et la chronologie */
              <div className="flex gap-md items-stretch w-full relative">
                {/* 1. Liste déroulante des e-mails avec effet de fondu */}
                <div className="flex-1 min-w-0" style={{
                  WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 8%, black 92%, transparent 100%)',
                  maskImage: 'linear-gradient(to bottom, transparent 0%, black 8%, black 92%, transparent 100%)'
                }}>
                  <div onScroll={handleScroll} className="scroll-fade-container max-h-[70vh] overflow-y-auto py-lg pr-sm space-y-md">
                    {activePipelines.map((sim) => (
                      <div key={sim.id} id={`card-${sim.id}`} className="border border-outline-variant/30 rounded-xl p-md bg-[#000a1f]/80 space-y-md w-full">
                        <div className="flex items-center justify-between border-b border-outline-variant/20 pb-sm">
                          <div className="flex items-center gap-sm min-w-0">
                            <span className="font-bold text-primary shrink-0">[ID: {sim.id}]</span>
                            <span className="text-on-surface-variant truncate block max-w-xs sm:max-w-md">{sim.subject}</span>
                          </div>
                          <div className="shrink-0">
                            {sim.error ? (
                              <span className="text-red-500 font-bold">[erreur]</span>
                            ) : sim.details?.status === 'SPAM' ? (
                              <span className="text-red-500 font-bold">[spam halt]</span>
                            ) : sim.percent >= 100 ? (
                              <span className="text-emerald-400 font-bold">[ready]</span>
                            ) : (
                              <span className="text-primary font-bold animate-pulse">[processing]</span>
                            )}
                          </div>
                        </div>

                        {/* Progress bar du flux */}
                        <div className="flex items-center gap-xs">
                          <span className="shrink-0">pipeline progress</span>
                          <span className="text-primary font-bold overflow-hidden text-ellipsis whitespace-nowrap">
                            [{makeProgressBar(sim.percent)}]
                          </span>
                          <span className="shrink-0">{Math.round((sim.percent / 100) * PIPELINE_STEPS.length)}/{PIPELINE_STEPS.length}</span>
                        </div>

                        {/* Étapes détaillées */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-lg gap-y-1 text-xs text-on-surface-variant pl-sm font-mono">
                          {PIPELINE_STEPS.map((step, idx) => {
                            const state = sim.stepStates[idx];
                            let icon = '░';
                            let color = 'opacity-40';

                            if (state === 'running') {
                              icon = '▶';
                              color = 'text-primary font-bold animate-pulse';
                            } else if (state === 'done') {
                              icon = '✓';
                              color = 'text-emerald-400';
                            } else if (state === 'failed') {
                              icon = '✗';
                              color = 'text-red-500 font-bold';
                            } else if (state === 'skipped') {
                              icon = '»';
                              color = 'opacity-20';
                            }

                            return (
                              <div key={idx} className={`flex items-center gap-sm ${color}`}>
                                <span className="shrink-0 font-bold">{icon}</span>
                                <span>{idx + 1}. {step}</span>
                              </div>
                            );
                          })}
                        </div>

                        {/* Résultats de traitement */}
                        {sim.details && (
                          <div className="border-t border-outline-variant/20 pt-md mt-sm space-y-sm text-sm">
                            {sim.details.status === 'SPAM' ? (
                              <div className="text-red-500 font-semibold flex items-center gap-2">
                                <span>✗</span>
                                <span>{sim.details.message} (Confidence: {sim.details.confidence})</span>
                              </div>
                            ) : (
                              <div className="space-y-sm pl-sm">
                                <div className="flex items-center gap-sm">
                                  <span className="text-emerald-400 font-bold">✓</span>
                                  <span>Ticket ERP créé : <strong className="text-primary">#{sim.details.ticketId}</strong> (GLPI : <strong className="text-primary">#{sim.details.glpiId || 'N/A'}</strong>)</span>
                                </div>
                                <div className="flex items-center gap-sm text-[13px]">
                                  <span className="text-on-surface-variant">Catégorie: <strong className="text-secondary font-semibold uppercase">{sim.details.category}</strong></span>
                                  <span>|</span>
                                  <span className="text-on-surface-variant">Priorité: <strong className={`font-semibold uppercase ${sim.details.priority === 'p1' ? 'text-red-500' : 'text-on-surface'}`}>{sim.details.priority}</strong></span>
                                </div>
                                <div className="text-[13px] text-on-surface-variant leading-relaxed italic max-w-2xl bg-surface-container-low/20 p-sm rounded-lg border border-outline-variant/20">
                                  {sim.details.summary}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Affichage des erreurs réseau */}
                        {sim.error && (
                          <div className="text-red-500 font-bold pl-sm flex items-center gap-2">
                            <span>✗</span>
                            <span>Erreur : {sim.error}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* 2. Chronologie / Ticks de navigation sur la droite */}
                <div className="w-8 shrink-0 flex flex-col justify-center items-end gap-2 border-l border-outline-variant/20 pl-2 self-center">
                  {activePipelines.map((sim) => {
                    const isActive = sim.id === activeEmailId;

                    // Choix de la couleur selon le statut
                    let statusColor = "bg-slate-600/30 hover:bg-slate-500/60"; // PENDING
                    if (sim.error) statusColor = "bg-red-500/50 hover:bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]";
                    else if (sim.details?.status === 'SPAM') statusColor = "bg-amber-500/50 hover:bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]";
                    else if (sim.percent >= 100) statusColor = "bg-emerald-500/50 hover:bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]";
                    else statusColor = "bg-primary/50 animate-pulse"; // PROCESSING

                    const activeStyle = isActive 
                      ? "w-8 h-2.5 bg-white shadow-[0_0_12px_rgba(255,255,255,1)] opacity-100 z-10" 
                      : `w-4 h-1.5 ${statusColor} opacity-50 hover:opacity-100 hover:w-6 hover:h-2`;

                    return (
                      <div key={sim.id} className="relative group">
                        {/* Tiret interactif */}
                        <button
                          onClick={() => {
                            const card = document.getElementById(`card-${sim.id}`);
                            if (card) {
                              card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }
                            setActiveEmailId(sim.id);
                          }}
                          className={`${activeStyle} rounded-sm transition-all duration-200 cursor-pointer focus:outline-none`}
                        />

                        {/* Infobulle CSS au survol */}
                        <div className="absolute right-8 top-1/2 -translate-y-1/2 hidden group-hover:flex flex-col items-end bg-[#000a1f] border border-outline-variant/40 px-md py-sm rounded-lg text-xs font-mono whitespace-nowrap z-50 shadow-xl pointer-events-none select-none text-[#f1f5f9] min-w-[220px]">
                          <span className="font-bold text-primary truncate w-full text-right">{sim.subject || '(sans objet)'}</span>
                          <span className="text-[10px] text-slate-400 mt-1 uppercase text-right">
                            ID: {sim.id} | {sim.error ? 'ERREUR' : sim.details?.status || 'TRAITEMENT'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Prompt de console d'attente à la fin de l'initialisation ou après traitement */}
            {!loading && (
              <div className="flex items-center gap-xs">
                <span className="text-primary font-bold">triage-console: $ </span>
                <span className="w-2.5 h-4 bg-primary animate-ping inline-block" style={{ animationDuration: '1.2s' }} />
              </div>
            )}
          </div>
        )}

        {/* Ref de scroll de fin de terminal */}
        <div ref={terminalEndRef} />
      </div>
    </div>
  );
}
