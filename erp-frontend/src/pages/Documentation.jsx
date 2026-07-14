import { motion } from 'framer-motion';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } },
};

function Section({ title, icon, children, id }) {
  return (
    <motion.section variants={itemVariants} id={id} className="scroll-mt-20">
      <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-lg flex flex-col gap-md">
        <h3 className="font-headline-md text-headline-md text-on-surface font-bold flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[22px]">{icon}</span>
          {title}
        </h3>
        {children}
      </div>
    </motion.section>
  );
}

function StepCard({ number, title, children }) {
  return (
    <div className="flex gap-4 p-md bg-surface-container-low/40 border border-outline-variant/40 rounded-xl">
      <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center font-bold shrink-0 text-sm">
        {number}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="font-headline-sm text-headline-sm text-on-surface font-semibold mb-1">{title}</h4>
        <div className="text-body-sm text-on-surface-variant space-y-2 leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

function Badge({ children, color = 'primary' }) {
  const colors = {
    primary: 'bg-primary/10 text-primary border-primary/20',
    emerald: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    amber: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    red: 'bg-red-500/10 text-red-500 border-red-500/20',
  };
  return (
    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold border uppercase ${colors[color] || colors.primary}`}>
      {children}
    </span>
  );
}

function Code({ children }) {
  return (
    <code className="bg-surface-container-high px-1.5 py-0.5 rounded text-[12px] font-mono text-primary">
      {children}
    </code>
  );
}

export default function Documentation() {
  const toc = [
    { id: 'overview', label: 'Vue d\'ensemble', icon: 'list_alt' },
    { id: 'skills', label: 'Compétences', icon: 'psychology' },
    { id: 'auto-assign', label: 'Assignation automatique', icon: 'swap_horiz' },
    { id: 'learning', label: 'Auto-apprentissage', icon: 'model_training' },
    { id: 'accuracy', label: 'Suivi de précision', icon: 'monitor_heart' },
    { id: 'workflow', label: 'Workflow complet', icon: 'account_tree' },
  ];

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="p-lg flex flex-col gap-lg max-w-4xl"
    >
      {/* En-tête */}
      <motion.header variants={itemVariants}>
        <h2 className="font-display-lg text-display-lg text-on-background font-bold flex items-center gap-3">
          Documentation
          <span className="text-body-sm font-normal text-on-surface-variant">— Assignation intelligente des tickets</span>
        </h2>
        <p className="font-body-lg text-body-lg text-on-surface-variant mt-1">
          Comprendre comment la plateforme assigne automatiquement les tickets aux techniciens en fonction de leurs
          compétences, et comment elle apprend de vos décisions pour devenir autonome.
        </p>
      </motion.header>

      {/* Table des matières */}
      <motion.nav variants={itemVariants} className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-lg">
        <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold mb-3">Table des matières</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {toc.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-body-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition-all"
            >
              <span className="material-symbols-outlined text-[16px] text-primary">{item.icon}</span>
              {item.label}
            </a>
          ))}
        </div>
      </motion.nav>

      {/* ════════════════════════════════════════ */}
      {/* 1. VUE D'ENSEMBLE */}
      {/* ════════════════════════════════════════ */}
      <Section title="Vue d'ensemble" icon="overview" id="overview">
        <p className="text-body-sm text-on-surface leading-relaxed">
          Le système d'assignation intelligente remplace l'assignation manuelle des tickets par un processus
          automatisé en trois couches :
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-md mt-2">
          <div className="p-md bg-surface-container-low/40 border border-outline-variant/40 rounded-xl text-center">
            <span className="material-symbols-outlined text-[32px] text-primary block mb-1">psychology</span>
            <h4 className="font-headline-sm text-headline-sm text-on-surface font-semibold mb-1">Compétences</h4>
            <p className="text-body-sm text-on-surface-variant">
              Chaque technicien déclare ses domaines d'expertise avec un niveau (1-5).
            </p>
          </div>
          <div className="p-md bg-surface-container-low/40 border border-outline-variant/40 rounded-xl text-center">
            <span className="material-symbols-outlined text-[32px] text-primary block mb-1">swap_horiz</span>
            <h4 className="font-headline-sm text-headline-sm text-on-surface font-semibold mb-1">Assignation</h4>
            <p className="text-body-sm text-on-surface-variant">
              L'IA catégorise le ticket, puis le meilleur technicien compétent est choisi.
            </p>
          </div>
          <div className="p-md bg-surface-container-low/40 border border-outline-variant/40 rounded-xl text-center">
            <span className="material-symbols-outlined text-[32px] text-primary block mb-1">model_training</span>
            <h4 className="font-headline-sm text-headline-sm text-on-surface font-semibold mb-1">Apprentissage</h4>
            <p className="text-body-sm text-on-surface-variant">
              Les réassignations manuelles sont enregistrées pour améliorer les futures suggestions.
            </p>
          </div>
        </div>
      </Section>

      {/* ════════════════════════════════════════ */}
      {/* 2. COMPÉTENCES */}
      {/* ════════════════════════════════════════ */}
      <Section title="Compétences des techniciens" icon="psychology" id="skills">
        <div className="space-y-3">
          <p className="text-body-sm text-on-surface leading-relaxed">
            Une <strong>compétence</strong> est un domaine d'expertise précis (ex: <Code>VPN</Code>, <Code>Réseau</Code>,{' '}
            <Code>Active Directory</Code>, <Code>Linux</Code>, <Code>Firewall</Code>). Chaque compétence peut être
            assignée à un ou plusieurs techniciens avec un niveau de maîtrise :
          </p>

          <div className="grid grid-cols-5 gap-2">
            {[
              { level: 1, label: 'Débutant', desc: 'Notions de base, besoin d\'accompagnement' },
              { level: 2, label: 'Junior', desc: 'Autonome sur les cas simples' },
              { level: 3, label: 'Intermédiaire', desc: 'Autonome sur la majorité des cas' },
              { level: 4, label: 'Avancé', desc: 'Résout les cas complexes' },
              { level: 5, label: 'Expert', desc: 'Référence technique, forme les autres' },
            ].map((l) => (
              <div key={l.level} className="text-center p-3 bg-surface-container-low/40 border border-outline-variant/40 rounded-xl">
                <span className="text-[24px] font-bold text-primary block">{l.level}</span>
                <p className="text-[11px] font-semibold text-on-surface mt-1">{l.label}</p>
                <p className="text-[10px] text-on-surface-variant mt-0.5">{l.desc}</p>
              </div>
            ))}
          </div>

          <div className="mt-3 p-md bg-primary/5 border border-primary/20 rounded-xl">
            <p className="text-body-sm text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-primary">info</span>
              <strong>Où configurer ?</strong> Rendez-vous dans <strong>Compétences</strong> dans le menu System
              pour créer des compétences et les assigner aux techniciens.
            </p>
          </div>
        </div>
      </Section>

      {/* ════════════════════════════════════════ */}
      {/* 3. ASSIGNATION AUTOMATIQUE */}
      {/* ════════════════════════════════════════ */}
      <Section title="Assignation automatique" icon="swap_horiz" id="auto-assign">
        <div className="space-y-3">
          <p className="text-body-sm text-on-surface leading-relaxed">
            Quand un nouveau ticket est créé (via email, formulaire, ou API), la plateforme suit cet algorithme :
          </p>

          <StepCard number={1} title="Analyse IA du ticket">
            <p>Le pipeline IA (<Code>mailAnalyzer.js</Code>) analyse le contenu de la demande et extrait :</p>
            <ul className="list-disc list-inside text-body-sm text-on-surface-variant mt-1 space-y-0.5">
              <li><strong>catégorie</strong> (ex: "Réseau", "Logiciel", "VPN")</li>
              <li><strong>priorité</strong> (P1 à P4)</li>
              <li><strong>équipe</strong> suggérée</li>
              <li><strong>confiance</strong> de l'analyse (pourcentage)</li>
            </ul>
          </StepCard>

          <StepCard number={2} title="Recherche par compétence">
            <p>Le système cherche les techniciens ayant la compétence correspondant à la catégorie :</p>
            <ul className="list-disc list-inside text-body-sm text-on-surface-variant mt-1 space-y-0.5">
              <li>Priorité au <strong>niveau de compétence</strong> le plus élevé</li>
              <li>Puis au <strong>moins chargé</strong> en tickets actifs</li>
              <li>Si trouvé → assignation directe</li>
            </ul>
          </StepCard>

          <StepCard number={3} title="Fallback par équipe">
            <p>Si aucun technicien n'a la compétence requise :</p>
            <ul className="list-disc list-inside text-body-sm text-on-surface-variant mt-1 space-y-0.5">
              <li>Utilise l'équipe correspondant à la catégorie</li>
              <li>Prend le membre le moins chargé</li>
              <li>Comportement existant conservé</li>
            </ul>
          </StepCard>

          <StepCard number={4} title="Journalisation">
            <p>Chaque assignation automatique est enregistrée dans <Code>ReassignmentLog</Code> pour permettre
            le suivi de précision et l'apprentissage futur.</p>
          </StepCard>
        </div>
      </Section>

      {/* ════════════════════════════════════════ */}
      {/* 4. AUTO-APPRENTISSAGE */}
      {/* ════════════════════════════════════════ */}
      <Section title="Auto-apprentissage & autonomie" icon="model_training" id="learning">
        <div className="space-y-3">
          <p className="text-body-sm text-on-surface leading-relaxed">
            La plateforme apprend de vos décisions pour devenir progressivement autonome. Voici les mécanismes clés :
          </p>

          <div className="p-md bg-surface-container-low/40 border border-outline-variant/40 rounded-xl">
            <h4 className="font-headline-sm text-headline-sm text-on-surface font-semibold flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-primary">feedback</span>
              Boucle de feedback par réassignation
            </h4>
            <p className="text-body-sm text-on-surface-variant mt-1">
              Quand un administrateur ou technicien réassigne manuellement un ticket (parce que le technicien
              suggéré n'était pas le bon), cette action est enregistrée avec :
            </p>
            <ul className="list-disc list-inside text-body-sm text-on-surface-variant mt-2 space-y-0.5">
              <li>Le technicien <strong>précédent</strong> (celui suggéré par l'IA)</li>
              <li>Le <strong>nouveau</strong> technicien choisi par l'humain</li>
              <li>La <strong>raison</strong> : surcharge, compétence, disponibilité, etc.</li>
              <li>Si l'assignation était <strong>automatique</strong> ou manuelle</li>
            </ul>
          </div>

          <div className="p-md bg-surface-container-low/40 border border-outline-variant/40 rounded-xl">
            <h4 className="font-headline-sm text-headline-sm text-on-surface font-semibold flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-primary">trending_up</span>
              Amélioration continue
            </h4>
            <p className="text-body-sm text-on-surface-variant mt-1">
              Au fur et à mesure que les données de réassignation s'accumulent :
            </p>
            <ul className="list-disc list-inside text-body-sm text-on-surface-variant mt-2 space-y-0.5">
              <li>Le <strong>Few-Shot learning</strong> (<Code>mailAnalyzer.js</Code>) utilise les tickets
              résolus comme exemples pour mieux classer les nouveaux tickets</li>
              <li>La <strong>précision</strong> des assignations peut être consultée dans les statistiques</li>
              <li>À long terme, les seuils de confiance peuvent être ajustés pour plus d'autonomie</li>
            </ul>
          </div>

          <div className="p-md bg-amber-500/5 border border-amber-500/20 rounded-xl">
            <p className="text-body-sm text-on-surface flex items-start gap-2">
              <span className="material-symbols-outlined text-[18px] text-amber-500 shrink-0">lightbulb</span>
              <span>
                <strong>Perspective future :</strong> Avec suffisamment de données, la plateforme pourra
                suggérer des assignations avec un niveau de confiance (<Badge color="emerald">Auto ≥ 85%</Badge>,
                <Badge color="amber">Suggestion 60-85%</Badge>, <Badge color="red">Manuel &lt; 60%</Badge>)
                et devenir entièrement autonome pour les cas les plus typiques.
              </span>
            </p>
          </div>
        </div>
      </Section>

      {/* ════════════════════════════════════════ */}
      {/* 5. SUIVI DE PRÉCISION */}
      {/* ════════════════════════════════════════ */}
      <Section title="Suivi de précision" icon="monitor_heart" id="accuracy">
        <p className="text-body-sm text-on-surface leading-relaxed">
          La précision des assignations automatiques est consultable via l'endpoint API{' '}
          <Code>GET /api/skills/stats/accuracy</Code>. Les métriques disponibles :
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-md mt-3">
          {[
            { label: 'Taux de précision', desc: 'Pourcentage d\'assignations automatiques non corrigées par un humain' },
            { label: 'Volume journalier', desc: 'Nombre d\'assignations par jour, avec la part d\'automatiques vs corrigées' },
            { label: 'Raisons de correction', desc: 'Répartition des motifs de réassignation (surcharge, compétence, etc.)' },
            { label: 'Évolution temporelle', desc: 'Graphique de progression de la précision sur 30 jours' },
          ].map((m, i) => (
            <div key={i} className="p-3 bg-surface-container-low/40 border border-outline-variant/40 rounded-xl">
              <h5 className="font-body-sm text-body-sm text-on-surface font-semibold">{m.label}</h5>
              <p className="text-body-sm text-on-surface-variant mt-0.5">{m.desc}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ════════════════════════════════════════ */}
      {/* 6. WORKFLOW COMPLET */}
      {/* ════════════════════════════════════════ */}
      <Section title="Workflow complet" icon="account_tree" id="workflow">
        <div className="relative pl-8 border-l-2 border-primary/30 space-y-6 pb-4">
          {[
            { step: 'Email entrant', detail: 'Le pipeline email reçoit un message (via Outlook/IMAP)' },
            { step: 'Analyse IA', detail: 'mailAnalyzer.js extrait catégorie, priorité, équipe, summary' },
            { step: 'Création ticket', detail: 'Un ticket est créé avec la catégorie identifiée' },
            { step: 'Assignation', detail: 'ticketAutoAssign.js cherche le meilleur technicien : par compétence d\'abord, par équipe ensuite' },
            { step: 'Notification', detail: 'Le technicien reçoit le ticket dans son tableau de bord' },
            { step: 'Traitement', detail: 'Le technicien résout le ticket' },
            { step: 'Feedback', detail: 'Si l\'assignation était incorrecte, la correction est enregistrée pour apprentissage' },
            { step: 'Amélioration', detail: 'Les données de réassignation enrichissent le modèle Few-Shot' },
          ].map((item, i) => (
            <div key={i} className="relative">
              <div className="absolute -left-[33px] w-6 h-6 rounded-full bg-primary/10 border-2 border-primary flex items-center justify-center">
                <span className="text-[10px] font-bold text-primary">{i + 1}</span>
              </div>
              <h4 className="font-headline-sm text-headline-sm text-on-surface font-semibold">{item.step}</h4>
              <p className="text-body-sm text-on-surface-variant mt-0.5">{item.detail}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Pied de page */}
      <motion.div variants={itemVariants} className="text-center text-body-sm text-on-surface-variant py-md border-t border-outline-variant/40">
        Document généré le {new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })}
        {' — '}ERP ITSM — Prosuma
      </motion.div>
    </motion.div>
  );
}
