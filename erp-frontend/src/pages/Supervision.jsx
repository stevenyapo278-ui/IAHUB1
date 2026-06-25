import { useState, useEffect, useRef } from 'react';
import api from '../api/client';

const PRESET_EMAILS = {
  '1': {
    id: 'incident-imprimante',
    label: 'Incident Valide (Création de ticket)',
    command: 'run-simulation --profile printer-error',
    email: {
      subject: 'Imprimante bloquée au 3ème étage Direction',
      body: 'Bonjour, l\'imprimante du 3ème étage (Secrétariat de Direction) affiche un code d\'erreur 404-Toner et refuse d\'imprimer nos rapports mensuels. Pouvez-vous intervenir en urgence ? Merci, Jean Dupont.',
      from: 'j.dupont@prosuma.ci',
      fromName: 'Jean Dupont',
    }
  },
  '2': {
    id: 'spam-publicite',
    label: 'Spam (Filtré à l\'étape 3)',
    command: 'run-simulation --profile newsletter-spam',
    email: {
      subject: 'PROMOTION EXCEPTIONNELLE : -50% sur vos fournitures de bureau !',
      body: 'Cher partenaire, profitez d\'une réduction exceptionnelle de 50% sur toutes les cartouches d\'encre et ramettes de papier en cliquant sur ce lien non sécurisé. Offre valable 48h seulement. Désinscription en bas de page.',
      from: 'offres@marketing-ink.ru',
      fromName: 'Mega Office Promo',
    }
  },
  '3': {
    id: 'suivi-fil',
    label: 'Suivi de fil (Association de Ticket)',
    command: 'run-simulation --profile email-reply',
    email: {
      subject: 'Re: Imprimante bloquée au 3ème étage Direction',
      body: 'Merci pour votre réponse rapide. Le technicien peut passer cet après-midi à 14h, je serai dans mon bureau.',
      from: 'j.dupont@prosuma.ci',
      fromName: 'Jean Dupont',
      conversationId: 'SIM-CONV-IMPRIMANTE-123',
    }
  },
  '4': {
    id: 'incident-similaire',
    label: 'Incident Similaire (Liaison & Alerte)',
    command: 'run-simulation --profile network-outage',
    email: {
      subject: 'Problème réseau / panne internet globale',
      body: 'Bonjour, nous n\'en avons plus d\'accès à internet sur le site depuis 10 minutes. Les terminaux de vente sont bloqués.',
      from: 'c.michele@prosuma.ci',
      fromName: 'Catherine Michele',
    }
  }
};

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
  const [terminalInput, setTerminalInput] = useState('');
  const [activeSimulations, setActiveSimulations] = useState([]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [commandFeedback, setCommandFeedback] = useState([]);
  const terminalEndRef = useRef(null);

  // Auto-scroll du terminal
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [bootPhase, loadingPercent, activeSimulations, commandFeedback, isSimulating]);

  // Séquence d'initialisation du terminal
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
      }, 40);
      return () => clearInterval(interval);
    }

    if (bootPhase === 2) {
      const t2 = setTimeout(() => setBootPhase(3), 1000);
      return () => clearTimeout(t2);
    }
  }, [bootPhase]);

  // Écouteur global du clavier pour les simulations
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (bootPhase !== 3 || isSimulating) return;

      if (e.key === '1') startSimulation('1');
      else if (e.key === '2') startSimulation('2');
      else if (e.key === '3') startSimulation('3');
      else if (e.key === '4') startSimulation('4');
      else if (e.key === '5') startBatchSimulation();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [bootPhase, isSimulating]);

  // Générer la barre de progression textuelle [████░░░░]
  function makeProgressBar(percent, totalBlocks = 24) {
    const filledBlocks = Math.round((percent / 100) * totalBlocks);
    const emptyBlocks = totalBlocks - filledBlocks;
    return '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);
  }

  // Lancer une simulation d'e-mail unique
  async function startSimulation(key) {
    const preset = PRESET_EMAILS[key];
    if (!preset) return;

    setIsSimulating(true);
    setTerminalInput(preset.command);
    setCommandFeedback([]);

    const simId = `FLOW-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const isSpam = preset.id === 'spam-publicite';
    const newSim = {
      id: simId,
      subject: preset.email.subject,
      percent: 0,
      activeStepIndex: 0,
      stepStates: Array(PIPELINE_STEPS.length).fill('pending'),
      details: null,
      error: null,
      apiPending: !isSpam, // indique qu'on attend encore les données API
    };

    setActiveSimulations([newSim]);

    // === ANIMATION VISUELLE (indépendante de l'API) ===
    const visualResult = await new Promise((resolve) => {
      let currentIdx = 0;
      const stepInterval = setInterval(() => {
        setActiveSimulations((prev) => prev.map((s) => {
          if (s.id !== simId) return s;

          const states = [...s.stepStates];
          if (currentIdx > 0 && states[currentIdx - 1] === 'running') {
            states[currentIdx - 1] = 'done';
          }

          if (currentIdx === 3 && isSpam) {
            states[2] = 'failed';
            for (let i = 3; i < PIPELINE_STEPS.length; i++) states[i] = 'skipped';
            clearInterval(stepInterval);
            resolve('spam');
            return { ...s, percent: 33, activeStepIndex: 2, stepStates: states };
          }

          if (currentIdx < PIPELINE_STEPS.length) {
            states[currentIdx] = 'running';
            const nextPercent = Math.round(((currentIdx + 1) / PIPELINE_STEPS.length) * 100);
            currentIdx++;
            return { ...s, percent: nextPercent, activeStepIndex: currentIdx - 1, stepStates: states };
          } else {
            states[PIPELINE_STEPS.length - 1] = 'done';
            clearInterval(stepInterval);
            resolve('success');
            return { ...s, percent: 100, activeStepIndex: PIPELINE_STEPS.length, stepStates: states };
          }
        }));
      }, 500);
    });

    // Afficher résultat spam immédiatement
    if (visualResult === 'spam') {
      setActiveSimulations((prev) => prev.map((s) =>
        s.id !== simId ? s : {
          ...s,
          apiPending: false,
          details: { status: 'SPAM', message: "L'IA a bloqué le processus (détecté comme Spam).", confidence: '99.4%' }
        }
      ));
      setIsSimulating(false);
      setTerminalInput('');
      return;
    }

    // Animation terminée — débloquer l'UI, afficher un résultat local en attendant l'API
    setIsSimulating(false);
    setTerminalInput('');
    setActiveSimulations((prev) => prev.map((s) =>
      s.id !== simId ? s : {
        ...s,
        details: {
          status: 'DONE',
          ticketId: null, // sera mis à jour quand l'API répond
          glpiId: null,
          category: '⏳ En attente des données IA…',
          priority: '—',
          summary: 'Pipeline terminé. Récupération des données du serveur en cours…',
        }
      }
    ));

    // === APPEL API (asynchrone, enrichit l'affichage) ===
    try {
      const apiResponse = await api.post('/inbox/simulate', preset.email);
      const data = apiResponse.data;
      setActiveSimulations((prev) => prev.map((s) =>
        s.id !== simId ? s : {
          ...s,
          apiPending: false,
          details: {
            status: 'DONE',
            ticketId: data.ticketId,
            glpiId: data.glpiTicketId,
            category: data.incomingEmail?.aiCategory || 'INCIDENT',
            priority: data.incomingEmail?.aiPriority || 'P2',
            summary: data.incomingEmail?.aiSummary || 'Triage effectué avec succès.',
          }
        }
      ));
    } catch (err) {
      // L'API a échoué mais l'animation est déjà terminée — afficher un avertissement non bloquant
      const errMsg = err.response?.data?.error || err.message || 'Erreur réseau';
      setActiveSimulations((prev) => prev.map((s) =>
        s.id !== simId ? s : {
          ...s,
          apiPending: false,
          details: {
            status: 'DONE',
            ticketId: 'N/A',
            glpiId: null,
            category: 'INCIDENT',
            priority: 'P2',
            summary: `(API indisponible : ${errMsg}) — Simulation locale uniquement.`,
          }
        }
      ));
    }
  }

  // Lancer une simulation de 3 flux en parallèle
  async function startBatchSimulation() {
    setIsSimulating(true);
    setTerminalInput('run-simulation --batch --count 3');

    const flows = [
      { id: 'FLOW-A', presetKey: '1', title: 'Ticket valide (Imprimante)' },
      { id: 'FLOW-B', presetKey: '2', title: 'Spam publicitaire' },
      { id: 'FLOW-C', presetKey: '4', title: 'Incident similaire (Panne Réseau)' }
    ];

    setActiveSimulations(flows.map(f => ({
      id: f.id,
      subject: f.title,
      percent: 0,
      activeStepIndex: 0,
      stepStates: Array(PIPELINE_STEPS.length).fill('pending'),
      details: null,
      error: null,
      apiPending: f.presetKey !== '2',
    })));

    // === ANIMATIONS VISUELLES EN PARALLÈLE (indépendantes de l'API) ===
    const animationResults = await Promise.all(flows.map(f => {
      return new Promise((resolve) => {
        let currentIdx = 0;
        const isSpam = f.presetKey === '2';
        const delay = 400 + Math.random() * 200;
        const stepInterval = setInterval(() => {
          setActiveSimulations((prev) => prev.map((s) => {
            if (s.id !== f.id) return s;
            const states = [...s.stepStates];
            if (currentIdx > 0 && states[currentIdx - 1] === 'running') {
              states[currentIdx - 1] = 'done';
            }
            if (currentIdx === 3 && isSpam) {
              states[2] = 'failed';
              for (let i = 3; i < PIPELINE_STEPS.length; i++) states[i] = 'skipped';
              clearInterval(stepInterval);
              resolve({ flowId: f.id, result: 'spam' });
              return { ...s, percent: 33, activeStepIndex: 2, stepStates: states };
            }
            if (currentIdx < PIPELINE_STEPS.length) {
              states[currentIdx] = 'running';
              const nextPercent = Math.round(((currentIdx + 1) / PIPELINE_STEPS.length) * 100);
              currentIdx++;
              return { ...s, percent: nextPercent, activeStepIndex: currentIdx - 1, stepStates: states };
            } else {
              states[PIPELINE_STEPS.length - 1] = 'done';
              clearInterval(stepInterval);
              resolve({ flowId: f.id, result: 'success' });
              return { ...s, percent: 100, activeStepIndex: PIPELINE_STEPS.length, stepStates: states };
            }
          }));
        }, delay);
      });
    }));

    // Toutes les animations sont terminées — débloquer l'UI
    setIsSimulating(false);
    setTerminalInput('');

    // Afficher résultats provisoires pendant que l'API répond
    setActiveSimulations((prev) => prev.map((s) => {
      const anim = animationResults.find(a => a.flowId === s.id);
      if (!anim) return s;
      if (anim.result === 'spam') {
        return {
          ...s, apiPending: false,
          details: { status: 'SPAM', message: "L'IA a bloqué le processus (Spam).", confidence: '98.9%' }
        };
      }
      return {
        ...s,
        details: {
          status: 'DONE', ticketId: null, glpiId: null,
          category: '⏳ En attente…', priority: '—',
          summary: 'Pipeline terminé. Récupération des données IA…',
        }
      };
    }));

    // === APPELS API EN PARALLÈLE (asynchrones, enrichissent l'affichage) ===
    flows
      .filter(f => f.presetKey !== '2') // Pas d'appel API pour le spam
      .forEach(async (f) => {
        try {
          const res = await api.post('/inbox/simulate', PRESET_EMAILS[f.presetKey].email);
          const data = res.data;
          setActiveSimulations((prev) => prev.map((s) =>
            s.id !== f.id ? s : {
              ...s, apiPending: false,
              details: {
                status: 'DONE',
                ticketId: data.ticketId,
                glpiId: data.glpiTicketId,
                category: data.incomingEmail?.aiCategory || 'INCIDENT',
                priority: data.incomingEmail?.aiPriority || 'P2',
                summary: data.incomingEmail?.aiSummary || 'Triage effectué avec succès.',
              }
            }
          ));
        } catch (err) {
          const errMsg = err.response?.data?.error || err.message || 'Erreur réseau';
          setActiveSimulations((prev) => prev.map((s) =>
            s.id !== f.id ? s : {
              ...s, apiPending: false,
              details: {
                status: 'DONE', ticketId: 'N/A', glpiId: null,
                category: 'INCIDENT', priority: 'P2',
                summary: `(API indisponible : ${errMsg}) — Simulation locale uniquement.`,
              }
            }
          ));
        }
      });
  }

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
            <div className="flex items-center gap-sm pl-md">
              <span>→ support@prosuma.ci</span>
              <span className="text-emerald-400">[ready]</span>
            </div>
            <div className="flex items-center gap-sm pl-md">
              <span>→ alerts@prosuma.ci</span>
              <span className="text-emerald-400">[ready]</span>
            </div>
          </div>
        )}

        {/* Phase 3 : Prêt pour recevoir des commandes */}
        {bootPhase >= 3 && (
          <div className="space-y-md">
            <div>
              <span className="text-emerald-400">ready</span>
              <span className="text-on-surface-variant">. powered by gemini-pro, glpi-api, react-router</span>
            </div>

            {/* Menu d'aide / touches disponibles */}
            {!isSimulating && activeSimulations.length === 0 && (
              <div className="space-y-xs border border-outline-variant/30 p-md rounded-xl bg-[#000a1f]/60 max-w-xl">
                <div className="text-primary font-bold mb-xs">→ press key [1-5] to simulate email streams :</div>
                {Object.keys(PRESET_EMAILS).map((key) => (
                  <button
                    key={key}
                    onClick={() => startSimulation(key)}
                    className="flex items-start text-left hover:text-primary transition-colors focus:outline-none w-full py-0.5"
                  >
                    <span className="text-primary font-bold shrink-0 w-8">[{key}]</span>
                    <span className="text-on-surface-variant truncate">{PRESET_EMAILS[key].label}</span>
                  </button>
                ))}
                <button
                  onClick={startBatchSimulation}
                  className="flex items-start text-left hover:text-primary transition-colors focus:outline-none w-full py-0.5"
                >
                  <span className="text-primary font-bold shrink-0 w-8">[5]</span>
                  <span className="text-on-surface-variant">Flux Simultané (3 emails en parallèle)</span>
                </button>
              </div>
            )}

            {/* Ligne de prompt active lors de la simulation */}
            {terminalInput && (
              <div>
                <span className="text-primary font-bold">triage-console: $ </span>
                <span>{terminalInput}</span>
              </div>
            )}

            {/* Rendu des pipelines en cours d'exécution */}
            {activeSimulations.map((sim) => (
              <div key={sim.id} className="border border-outline-variant/30 rounded-xl p-md bg-[#000a1f]/80 space-y-md">
                <div className="flex items-center justify-between border-b border-outline-variant/20 pb-sm">
                  <div className="flex items-center gap-sm">
                    <span className="font-bold text-primary">[{sim.id}]</span>
                    <span className="text-on-surface-variant truncate max-w-md">{sim.subject}</span>
                  </div>
                  <div>
                    {sim.error ? (
                      <span className="text-red-500 font-bold">[failed]</span>
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
                  <span>pipeline progress</span>
                  <span className="text-primary font-bold">
                    [{makeProgressBar(sim.percent)}]
                  </span>
                  <span>{Math.round((sim.percent / 100) * PIPELINE_STEPS.length)}/{PIPELINE_STEPS.length}</span>
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

            {/* Prompt de console d'attente à la fin de l'initialisation ou après traitement */}
            {!isSimulating && (
              <div className="flex items-center gap-xs">
                <span className="text-primary font-bold">triage-console: $ </span>
                <span className="w-2.5 h-4 bg-primary animate-ping inline-block" style={{ animationDuration: '1.2s' }} />
                {activeSimulations.length > 0 && (
                  <button
                    onClick={() => {
                      setActiveSimulations([]);
                      setCommandFeedback([]);
                    }}
                    className="ml-md text-xs text-on-surface-variant hover:text-on-surface hover:underline focus:outline-none"
                  >
                    [ clear terminal and listen again ]
                  </button>
                )}
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
