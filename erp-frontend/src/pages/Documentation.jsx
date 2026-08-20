import { motion } from 'framer-motion';
import { useTheme } from '../context/ThemeContext';
import {
  BookOpen, Award, Repeat, Cpu, Activity, GitBranch, List, CheckCircle2,
  ShieldCheck, BarChart2, Zap, BrainCircuit, RefreshCw, Users, Settings as SettingsIcon,
  Download, Lightbulb, FileText, Sparkles, AlertCircle, HelpCircle
} from 'lucide-react';

const containerVariants = {
  hidden: { opacity: 1 },
  visible: { opacity: 1 },
};
const itemVariants = {
  hidden: { opacity: 1 },
  visible: { opacity: 1 },
};

function Section({ title, icon: Icon, children, id, badge }) {
  return (
    <motion.section variants={itemVariants} id={id} className="scroll-mt-20">
      <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-3xl p-6 lg:p-7 space-y-4 shadow-sm">
        <div className="flex items-center justify-between border-b border-outline-variant/30 pb-3">
          <h3 className="text-base font-extrabold text-on-surface flex items-center gap-2.5">
            {Icon && <Icon className="w-5 h-5 text-blue-500" />}
            {title}
          </h3>
          {badge && (
            <span className="px-2.5 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 text-[10px] font-extrabold uppercase tracking-wider">
              {badge}
            </span>
          )}
        </div>
        {children}
      </div>
    </motion.section>
  );
}

function StepCard({ number, title, children }) {
  return (
    <div className="flex gap-4 p-4 bg-surface border border-outline-variant/30 rounded-2xl">
      <div className="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center font-black shrink-0 text-xs">
        {number}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="text-xs font-bold text-on-surface mb-1">{title}</h4>
        <div className="text-xs text-on-surface-variant space-y-1.5 leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, desc, tag }) {
  return (
    <div className="p-4 bg-surface border border-outline-variant/30 rounded-2xl space-y-2">
      <div className="flex items-center justify-between">
        <div className="p-2 rounded-xl bg-blue-500/10 text-blue-500">
          <Icon className="w-4 h-4" />
        </div>
        {tag && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant">{tag}</span>}
      </div>
      <h4 className="text-xs font-bold text-on-surface">{title}</h4>
      <p className="text-[11px] text-on-surface-variant leading-relaxed">{desc}</p>
    </div>
  );
}

function Code({ children }) {
  return (
    <code className="bg-surface-container border border-outline-variant/30 px-1.5 py-0.5 rounded text-[11px] font-mono text-blue-600 dark:text-blue-400">
      {children}
    </code>
  );
}

export default function Documentation() {
  const { theme } = useTheme();

  const toc = [
    { id: 'overview', label: 'Architecture', icon: List },
    { id: 'validation', label: 'Centre de Validation', icon: ShieldCheck },
    { id: 'analytics', label: 'Assistant IA Stats BI', icon: BarChart2 },
    { id: 'kb', label: 'Base de Connaissances', icon: BookOpen },
    { id: 'triage', label: 'Triage Intelligent', icon: Zap },
    { id: 'glpi-sync', label: 'Synchro GLPI', icon: RefreshCw },
    { id: 'users-roles', label: 'Habilitations & Hotline', icon: Users },
  ];

  return (
    <div className="flex flex-col min-h-screen">
      {/* ── Header Flottant ─────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 shrink-0 border-b border-outline-variant/30 bg-surface-container-lowest/95 backdrop-blur-md px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/10 text-blue-500 rounded-2xl border border-blue-500/20">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-extrabold text-on-surface">Guide & Documentation Platforme ERP ITSM</h1>
            <p className="text-[11px] text-on-surface-variant font-medium">Référentiel complet des modules, automatisations et assistants IA</p>
          </div>
        </div>

        {/* Pilules de navigation TOC */}
        <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-surface border border-outline-variant/30 overflow-x-auto no-scrollbar">
          {toc.map((item) => {
            const Icon = item.icon;
            return (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-all whitespace-nowrap"
              >
                <Icon className="w-3.5 h-3.5 text-blue-500" />
                <span>{item.label}</span>
              </a>
            );
          })}
        </div>
      </div>

      {/* ── Contenu Principal ───────────────────────────────────────────── */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="flex-1 px-4 sm:px-6 lg:px-8 py-6 space-y-6 max-w-5xl mx-auto w-full"
      >
        {/* 1. VUE D'ENSEMBLE */}
        <Section title="1. Architecture & Principes Fondateurs" icon={List} id="overview" badge="Vue globale">
          <p className="text-xs text-on-surface leading-relaxed">
            La plateforme <strong>ERP ITSM — IA Hub</strong> réunit la gestion du Helpdesk, la qualification Hotline, et l'orchestration des modèles de langage Gemini. Les demandeurs (magasins et utilisateurs) interagissent par email et via GLPI, tandis que les techniciens et agents Hotline disposent d'une console unifiée d'approbation et d'analyse.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
            <FeatureCard
              icon={ShieldCheck}
              title="Centre de Validation"
              desc="Qualification Hotline 1-clic pour créer les tickets dans GLPI et relire les réponses IA."
              tag="Hotline"
            />
            <FeatureCard
              icon={BarChart2}
              title="Assistant IA Analyste BI"
              desc="Requêtes statistiques en langage naturel, graphiques Recharts et exports CSV par magasin."
              tag="Analytics"
            />
            <FeatureCard
              icon={BrainCircuit}
              title="Base de Connaissances RAG"
              desc="Référentiel de procédures alimenté en 1-clic depuis la résolution des tickets."
              tag="Savoir IT"
            />
          </div>
        </Section>

        {/* 2. CENTRE DE VALIDATION */}
        <Section title="2. Centre de Validation & Approbations Hotline" icon={ShieldCheck} id="validation" badge="Qualification Hotline">
          <div className="space-y-4">
            <p className="text-xs text-on-surface leading-relaxed">
              Le **Centre de Validation** (<Code>/validation-center</Code> ou <Code>/email-drafts</Code>) réunit toutes les tâches d'approbation en 2 onglets :
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-surface border border-outline-variant/30 rounded-2xl space-y-2">
                <h4 className="text-xs font-bold text-on-surface flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-amber-500" />
                  Onglet 1 : Tickets en attente GLPI
                </h4>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  Liste les tickets qualifiés en statut <Code>PENDING</Code>. Permet d'approuver 1-clic pour créer le ticket dans GLPI Prod avec son numéro officiel ou de rejeter la demande avec motif.
                </p>
              </div>

              <div className="p-4 bg-surface border border-outline-variant/30 rounded-2xl space-y-2">
                <h4 className="text-xs font-bold text-on-surface flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-500" />
                  Onglet 2 : Réponses Email IA
                </h4>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  Présente les propositions de réponses rédigées par Gemini. Chaque carte affiche un badge explicite : <Code>🔗 GLPI #...</Code> ou <Code>🛡️ En attente GLPI</Code>.
                </p>
              </div>
            </div>

            <div className="p-4 bg-gradient-to-r from-blue-500/10 via-indigo-500/10 to-purple-500/10 border border-blue-500/20 rounded-2xl flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-xs font-bold text-on-surface">Approbation Combinée 1-Clic</h4>
                <p className="text-xs text-on-surface-variant mt-0.5 leading-relaxed">
                  Si un agent valide une réponse IA pour un ticket non encore créé dans GLPI, une modale propose d'**Approuver le ticket GLPI ET d'envoyer la réponse IA** en une seule opération !
                </p>
              </div>
            </div>
          </div>
        </Section>

        {/* 3. ASSISTANT IA STATISTIQUES & BI */}
        <Section title="3. Assistant IA Analyste Statistiques & Business Intelligence" icon={BarChart2} id="analytics" badge="Text-to-Analytics">
          <div className="space-y-4">
            <p className="text-xs text-on-surface leading-relaxed">
              L'Assistant IA intégré dans le chatbot (<Code>ChatWidget.jsx</Code>) embarque un moteur de **Tool-Calling d'analyse statistique** (<Code>analyticsTools.js</Code>).
            </p>

            <div className="space-y-3">
              <StepCard number={1} title="Poser des questions en langage naturel">
                Exemples : <em>« Quel est le magasin qui a remonté le plus de problèmes par rapport à Asten ? »</em> ou <em>« Donne-moi les statistiques d'incidents caisse du mois »</em>.
              </StepCard>
              <StepCard number={2} title="Rendu dynamique de graphiques Recharts">
                L'assistant génère automatiquement un **Histogramme interactif** ou un **Camembert** directement dans la bulle de chat.
              </StepCard>
              <StepCard number={3} title="Export CSV 1-Clic">
                Chaque graphique généré s'accompagne d'un bouton **« 📥 CSV »** pour télécharger les données brutes sous format Excel.
              </StepCard>
              <StepCard number={4} title="Analyse de Cause Racine ('Pourquoi ?')">
                En posant la question <em>« Pourquoi ce magasin a eu autant de pannes ? »</em>, l'IA lit le contenu des incidents et résume la cause principale.
              </StepCard>
            </div>
          </div>
        </Section>

        {/* 4. BASE DE CONNAISSANCES & COPILOTE */}
        <Section title="4. Base de Connaissances & Copilote Hotline" icon={BookOpen} id="kb" badge="RAG Hybride">
          <div className="space-y-4">
            <p className="text-xs text-on-surface leading-relaxed">
              La Base de Connaissances (<Code>/knowledge-base</Code>) utilise une recherche hybride vectorielle (<Code>pgvector</Code> + mots-clés + reranking).
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-surface border border-outline-variant/30 rounded-2xl space-y-2">
                <h4 className="text-xs font-bold text-on-surface flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-500" />
                  Capture 1-Clic depuis les Tickets
                </h4>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  Sur la vue de détail d'un ticket (<Code>/tickets/:id</Code>), le bouton **« 🪄 Capturer dans la KB »** génère automatiquement une fiche de procédure à partir de la résolution du ticket.
                </p>
              </div>

              <div className="p-4 bg-surface border border-outline-variant/30 rounded-2xl space-y-2">
                <h4 className="text-xs font-bold text-on-surface flex items-center gap-2">
                  <BrainCircuit className="w-4 h-4 text-teal-500" />
                  Alimentation des Brouillons IA
                </h4>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  Lorsqu'un email arrive d'un magasin, Gemini consulte la Base de Connaissances pour pré-rédiger la réponse idéale dans le Centre de Validation.
                </p>
              </div>
            </div>
          </div>
        </Section>

        {/* 5. TRIAGE INTELLIGENT */}
        <Section title="5. Moteur de Triage Automatique Hyper-Intelligent" icon={Zap} id="triage" badge="Automatisations">
          <div className="space-y-3">
            <p className="text-xs text-on-surface leading-relaxed">
              Configurable dans **Paramètres → Règles de Triage** (<Code>AdvancedTab.jsx</Code>), le moteur <Code>emailRuleEngine.js</Code> évalue chaque email entrant selon :
            </p>
            <ul className="list-disc list-inside text-xs text-on-surface-variant space-y-1.5 pl-2">
              <li><strong>Analyse de Sentiment IA</strong> : Détection de frustration ou d'urgence prioritaire.</li>
              <li><strong>Plage Horaire (Time Window)</strong> : Heures ouvrées vs Nuit / Off-Hours.</li>
              <li><strong>Domaine / VIP</strong> : Règles d'escalade automatique pour les emails de direction.</li>
              <li><strong>Load-Balancing Technicien</strong> : Affectation automatique au technicien le moins chargé (<Code>LEAST_BUSY</Code>).</li>
            </ul>
          </div>
        </Section>

        {/* 6. SYNCHRO GLPI */}
        <Section title="6. Synchronisation Bi-directionnelle & Import GLPI Prod" icon={RefreshCw} id="glpi-sync" badge="Intégration GLPI">
          <div className="space-y-3">
            <p className="text-xs text-on-surface leading-relaxed">
              Le module <Code>glpiSync.js</Code> maintient la plateforme en phase avec votre GLPI de production :
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="p-3 bg-surface border border-outline-variant/30 rounded-xl">
                <h5 className="text-xs font-bold text-on-surface mb-1">Synchro Lieux / Magasins</h5>
                <p className="text-[11px] text-on-surface-variant">Importe l'arborescence complète des sites GLPI (<Code>GlpiLocation</Code>).</p>
              </div>
              <div className="p-3 bg-surface border border-outline-variant/30 rounded-xl">
                <h5 className="text-xs font-bold text-on-surface mb-1">Synchro Utilisateurs</h5>
                <p className="text-[11px] text-on-surface-variant">Mappe les demandeurs et techniciens Active Directory / GLPI.</p>
              </div>
              <div className="p-3 bg-surface border border-outline-variant/30 rounded-xl">
                <h5 className="text-xs font-bold text-on-surface mb-1">Réimport Massif</h5>
                <p className="text-[11px] text-on-surface-variant">Aspiration complète de l'historique sur une période personnalisée.</p>
              </div>
            </div>
          </div>
        </Section>

        {/* 7. HABILITATIONS & HOTLINE */}
        <Section title="7. Gestion des Utilisateurs & Équipe Hotline" icon={Users} id="users-roles" badge="Permissions">
          <div className="space-y-3">
            <p className="text-xs text-on-surface leading-relaxed">
              Dans **Utilisateurs** (<Code>/users</Code>) et **Groupes de Droits** (<Code>/permission-groups</Code>), la plateforme intègre un groupe système pré-configuré :
            </p>
            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center gap-3">
              <Award className="w-5 h-5 text-amber-500 shrink-0" />
              <div>
                <h4 className="text-xs font-bold text-on-surface">Groupe Système "Équipe Hotline"</h4>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  Bénéficie de l'accès au Centre de Validation, à la qualification des tickets <Code>PENDING</Code>, à la relecture des brouillons IA et à la gestion des rapports hebdomadaires.
                </p>
              </div>
            </div>
          </div>
        </Section>

        {/* Footer */}
        <div className="text-center text-xs text-on-surface-variant py-8 border-t border-outline-variant/20 font-medium">
          ERP ITSM — IA Hub Platform &bull; Guide Opérationnel v2.4.0
        </div>
      </motion.div>
    </div>
  );
}

