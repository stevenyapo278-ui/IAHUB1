import { useEffect, useState, Fragment } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import api from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';
import Pagination from '../components/Pagination';
import { useTheme } from '../context/ThemeContext';
import {
  Award, Plus, Trash2, X, Check,
  Search, Star, UserPlus
} from 'lucide-react';

const LEVEL_CONFIG = {
  1: { label: 'Débutant',       color: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-400 border-zinc-500/25' },
  2: { label: 'Junior',         color: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/25' },
  3: { label: 'Intermédiaire',  color: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/25' },
  4: { label: 'Avancé',         color: 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/25' },
  5: { label: 'Expert',         color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/25' },
};

export default function SkillsManagement() {
  const { theme } = useTheme();
  const [skills, setSkills] = useState([]);
  const [users, setUsers] = useState([]);
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillCategory, setNewSkillCategory] = useState('');
  const [selectedSkill, setSelectedSkill] = useState(null);
  const [assigningUserId, setAssigningUserId] = useState('');
  const [assigningLevel, setAssigningLevel] = useState(3);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [savingCreate, setSavingCreate] = useState(false);
  const [catFilter, setCatFilter] = useState('');
  const [assignModal, setAssignModal] = useState({ open: false, skill: null, tech: null });
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 12;

  function load() {
    setLoading(true);
    Promise.all([api.get('/skills'), api.get('/users')])
      .then(([sRes, uRes]) => {
        setSkills(sRes.data);
        const uList = Array.isArray(uRes.data) ? uRes.data : (uRes.data.users || []);
        setUsers(uList.filter(u => u.role !== 'REQUESTER'));
      })
      .catch(err => toast.error(err.response?.data?.error || 'Erreur de chargement'))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function handleCreateSkill(e) {
    e.preventDefault();
    const name = newSkillName.trim();
    if (!name) return;
    setSavingCreate(true);
    try {
      await api.post('/skills', { name, category: newSkillCategory.trim() || null });
      setNewSkillName(''); setNewSkillCategory(''); setShowCreateForm(false);
      toast.success(`Compétence « ${name} » créée`);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur lors de la création'); }
    finally { setSavingCreate(false); }
  }

  async function handleAssignSkill(skillId) {
    if (!assigningUserId) return;
    try {
      await api.post(`/skills/${skillId}/assign`, { userId: Number(assigningUserId), level: assigningLevel });
      toast.success('Compétence assignée');
      setAssigningUserId(''); setAssigningLevel(3); load();
    } catch (err) { toast.error(err.response?.data?.error || "Erreur lors de l'assignation"); }
  }

  async function handleRemoveSkill(skillId, userId) {
    try {
      await api.delete(`/skills/${skillId}/assign/${userId}`);
      toast.success('Compétence retirée'); load();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur lors du retrait'); }
  }

  async function handleDeleteSkill(id) {
    try {
      await api.delete(`/skills/${id}`);
      toast.success('Compétence supprimée'); setDeleteConfirm(null); load();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur lors de la suppression'); }
  }

  const totalAssignations = skills.reduce((s, sk) => s + (sk.userSkills?.length || 0), 0);
  const techs = users.filter(u => ['ADMIN', 'TECHNICIAN', 'SUPERADMIN'].includes(u.role));

  const categories = [...new Set(skills.map(s => s.category).filter(Boolean))];
  const filteredSkills = skills.filter(s => {
    const matchQ = !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.category?.toLowerCase().includes(search.toLowerCase());
    const matchCat = !catFilter || s.category === catFilter;
    return matchQ && matchCat;
  });

  const totalPages = Math.max(1, Math.ceil(filteredSkills.length / PAGE_SIZE));
  const paginatedSkills = filteredSkills.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [search, catFilter]);

  // Group by category
  const skillGroups = (() => {
    const groups = [];
    const cats = [...new Set(paginatedSkills.map(s => s.category).filter(Boolean))];
    cats.forEach(cat => {
      const catSkills = paginatedSkills.filter(s => s.category === cat);
      if (catSkills.length > 0) groups.push({ category: cat, skills: catSkills });
    });
    const uncat = paginatedSkills.filter(s => !s.category);
    if (uncat.length > 0) groups.push({ category: null, skills: uncat });
    return groups;
  })();

  return (
    <div className="flex flex-col min-h-screen">
      {/* ── Top Bar ─────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 shrink-0 border-b border-outline-variant/30 bg-surface-container-lowest/95 backdrop-blur-sm px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-amber-500/10 rounded-lg">
            <Award className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h1 className="text-base font-bold text-on-surface">Compétences</h1>
            <p className="text-[11px] text-on-surface-variant font-medium">{skills.length} compétences · {totalAssignations} assignations · {techs.length} techniciens</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-xs hidden sm:block">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50" />
          <input
            type="text"
            placeholder="Rechercher une compétence..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-surface border border-outline-variant/60 rounded-xl pl-8 pr-3 py-2 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
          />
        </div>

        {/* Category filter */}
        {categories.length > 0 && (
          <div className="flex items-center gap-1">
            <button onClick={() => setCatFilter('')}
              className={`px-2.5 py-1 rounded-full text-[10px] font-bold border transition-all ${!catFilter ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' : 'border-outline-variant/30 text-on-surface-variant hover:bg-surface-container'}`}
            >Tout</button>
            {categories.map(cat => (
              <button key={cat} onClick={() => setCatFilter(catFilter === cat ? '' : cat)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold border transition-all ${catFilter === cat ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' : 'border-outline-variant/30 text-on-surface-variant hover:bg-surface-container'}`}
              >{cat}</button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 ml-auto">
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 text-slate-950 text-xs font-bold shadow-md shadow-amber-500/20"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Nouvelle compétence</span>
          </motion.button>
        </div>
      </div>

      {/* ── Create form panel → modal ─────────────────────────────────────── */}

      {/* ── Legend ────────────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 lg:px-8 py-2.5 border-b border-outline-variant/10 flex items-center gap-4 overflow-x-auto">
        <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider shrink-0">Niveaux :</span>
        {Object.entries(LEVEL_CONFIG).map(([lvl, cfg]) => (
          <div key={lvl} className={`shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border ${cfg.color}`}>
            {[...Array(Number(lvl))].map((_, i) => <Star key={i} className="w-2 h-2 fill-current" />)}
            <span>{cfg.label}</span>
          </div>
        ))}
      </div>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6">
        {loading && skills.length === 0 ? (
          <div className="flex items-center justify-center py-20 gap-2 text-on-surface-variant">
            <div className="w-5 h-5 rounded-full border-2 border-amber-500/30 border-t-amber-500 animate-spin" />
            <span className="text-sm">Chargement...</span>
          </div>
        ) : filteredSkills.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-on-surface-variant">
            <div className="p-5 rounded-full bg-surface-container">
              <Award className="w-10 h-10 text-outline/30" />
            </div>
            <p className="text-sm italic">{search ? 'Aucune compétence trouvée.' : 'Aucune compétence définie. Créez-en une !'}</p>
          </div>
        ) : (
          <>
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            <AnimatePresence initial={false}>
              {skillGroups.map((group, gi) => (
                <Fragment key={gi}>
                  {/* Category header */}
                  {group.category && (
                    <div className="col-span-full flex items-center gap-2 py-2 first:pt-0">
                      <div className="w-1 h-4 rounded-full bg-amber-500" />
                      <span className="text-[11px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400">{group.category}</span>
                      <span className="text-[10px] text-on-surface-variant/50 font-medium">({group.skills.length})</span>
                    </div>
                  )}
                  {group.skills.map((skill, idx) => (
                    <motion.div
                      key={skill.id}
                      layout
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.18, delay: idx * 0.025 }}
                      className="rounded-2xl border border-outline-variant/30 overflow-hidden bg-surface-container-lowest"
                    >
                      <div className="flex items-center gap-3 px-4 py-3 border-b border-outline-variant/15">
                        <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                          <Award className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-on-surface truncate">{skill.name}</p>
                          {skill.category && <p className="text-[10px] text-on-surface-variant uppercase font-semibold tracking-wider">{skill.category}</p>}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => setAssignModal({ open: true, skill, tech: null })}
                            className="p-1.5 rounded-lg border border-outline-variant/30 text-[10px] font-bold flex items-center gap-1 text-on-surface-variant hover:bg-surface-container transition-all"
                          >
                            <UserPlus className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(skill.id)}
                            className="p-1.5 rounded-lg text-on-surface-variant/50 hover:text-red-500 hover:bg-red-500/10 transition-all"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="px-4 py-3 space-y-2 min-h-[60px]">
                        {skill.userSkills?.length > 0 ? skill.userSkills.map(us => {
                          const cfg = LEVEL_CONFIG[us.level] || LEVEL_CONFIG[3];
                          return (
                            <div key={us.user.id} className="flex items-center justify-between group/row">
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full bg-surface-container border border-outline-variant/40 text-on-surface text-[10px] font-bold flex items-center justify-center">
                                  {us.user.fullName?.charAt(0)?.toUpperCase()}
                                </div>
                                <span className="text-xs text-on-surface font-medium">{us.user.fullName}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-bold border ${cfg.color}`}>
                                  {[...Array(us.level)].map((_, i) => <Star key={i} className="w-2 h-2 fill-current" />)}
                                  <span className="ml-0.5">{cfg.label}</span>
                                </span>
                                <button
                                  onClick={() => handleRemoveSkill(skill.id, us.user.id)}
                                  className="text-on-surface-variant/30 hover:text-red-500 transition-colors opacity-0 group-hover/row:opacity-100"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          );
                        }) : (
                          <p className="text-xs text-on-surface-variant/50 italic">Aucun technicien assigné</p>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </Fragment>
              ))}
            </AnimatePresence>
          </div>
          {filteredSkills.length > PAGE_SIZE && (
            <div className="mt-4">
              <Pagination page={page} totalPages={totalPages} total={filteredSkills.length} label="compétences" onPageChange={setPage} />
            </div>
          )}
          </>
        )}
      </div>

      {/* ── Assignment Modal ──────────────────────────────────────────── */}
      <AnimatePresence>
        {assignModal.open && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setAssignModal({ open: false, skill: null, tech: null })}
              className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="relative w-full max-w-lg rounded-3xl border border-outline-variant/30 bg-surface shadow-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/20">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-amber-500/10">
                    <UserPlus className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-on-surface">Assigner une compétence</h2>
                    <p className="text-[11px] text-on-surface-variant">{assignModal.skill?.name}</p>
                  </div>
                </div>
                <button
                  onClick={() => setAssignModal({ open: false, skill: null, tech: null })}
                  className="p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Body */}
              <div className="px-5 py-5 space-y-5">
                {/* Tech selector */}
                <label className="flex flex-col gap-2">
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Technicien</span>
                  <select value={assigningUserId} onChange={e => setAssigningUserId(e.target.value)}
                    className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary cursor-pointer transition-all">
                    <option value="">Choisir un technicien...</option>
                    {techs.filter(u => !assignModal.skill?.userSkills?.some(s => s.user.id === u.id))
                      .map(u => <option key={u.id} value={u.id}>{u.fullName} ({u.role})</option>)}
                  </select>
                </label>

                {/* Level selector */}
                <label className="flex flex-col gap-2">
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Niveau</span>
                  <div className="grid grid-cols-5 gap-2">
                    {[1, 2, 3, 4, 5].map(lvl => (
                      <button
                        key={lvl}
                        onClick={() => setAssigningLevel(lvl)}
                        className={`py-3 rounded-xl border text-center transition-all ${
                          assigningLevel === lvl
                            ? `${LEVEL_CONFIG[lvl].color} scale-105 shadow-sm`
                            : 'border-outline-variant/30 text-on-surface-variant hover:bg-surface-container hover:border-outline-variant/50'
                        }`}
                      >
                        <div className="flex items-center justify-center gap-0.5 mb-1">
                          {[...Array(lvl)].map((_, i) => (
                            <Star key={i} className={`w-2 h-2 ${assigningLevel === lvl ? 'fill-current' : 'text-outline/40'}`} />
                          ))}
                        </div>
                        <span className="text-[9px] font-bold leading-tight">{LEVEL_CONFIG[lvl].label}</span>
                      </button>
                    ))}
                  </div>
                </label>

                {/* Description */}
                <div className={`px-3 py-2 rounded-xl border ${LEVEL_CONFIG[assigningLevel]?.color} border-current/20`}>
                  <p className="text-[11px] font-medium">
                    {assigningLevel === 1 && 'Connaissances de base, nécessite une supervision régulière.'}
                    {assigningLevel === 2 && 'Peut réaliser des tâches simples en autonomie avec des vérifications.'}
                    {assigningLevel === 3 && 'Autonome sur les tâches courantes, capable de former les débutants.'}
                    {assigningLevel === 4 && 'Maîtrise avancée, résout des problèmes complexes sans aide.'}
                    {assigningLevel === 5 && 'Expert reconnu, référence technique, conçoit des solutions.'}
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-outline-variant/20 bg-surface-container-low/40">
                <button
                  onClick={() => setAssignModal({ open: false, skill: null, tech: null })}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all"
                >
                  Annuler
                </button>
                <button
                  onClick={() => {
                    handleAssignSkill(assignModal.skill?.id);
                    setAssignModal({ open: false, skill: null, tech: null });
                  }}
                  disabled={!assigningUserId}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 text-slate-950 text-xs font-bold shadow-md hover:brightness-110 transition-all disabled:opacity-40"
                >
                  <Check className="w-3.5 h-3.5 inline-block mr-1.5 -mt-0.5" />
                  Assigner
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Modal Création compétence ──────────────────────────────────── */}
      <AnimatePresence>
        {showCreateForm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => { if (!savingCreate) setShowCreateForm(false); }}
              className="fixed inset-0 bg-black/70 backdrop-blur-md cursor-pointer"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="relative w-full max-w-md bg-surface rounded-2xl border border-outline-variant/30 shadow-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/20">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-amber-500/10">
                    <Award className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <h2 className="text-sm font-bold text-on-surface">Nouvelle compétence</h2>
                </div>
                <motion.button
                  onClick={() => setShowCreateForm(false)}
                  whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }}
                  className="p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all"
                ><X className="w-4 h-4" /></motion.button>
              </div>

              {/* Body */}
              <form onSubmit={handleCreateSkill} className="px-5 py-5 space-y-4">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Nom *</span>
                  <input required value={newSkillName} onChange={e => setNewSkillName(e.target.value)}
                    placeholder="ex: VPN, Active Directory, Kubernetes"
                    autoFocus
                    className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Catégorie</span>
                  <input value={newSkillCategory} onChange={e => setNewSkillCategory(e.target.value)}
                    placeholder="ex: Infrastructure, Sécurité"
                    className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  />
                </label>
              </form>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-outline-variant/20 bg-surface-container-low/40">
                <button type="button" onClick={() => setShowCreateForm(false)} disabled={savingCreate}
                  className="px-4 py-2 rounded-xl border border-outline-variant/40 text-on-surface text-xs font-semibold hover:bg-surface-container transition-colors disabled:opacity-50">
                  Annuler
                </button>
                <button type="button" onClick={handleCreateSkill} disabled={savingCreate || !newSkillName.trim()}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 text-slate-950 text-xs font-bold shadow-md disabled:opacity-50 flex items-center gap-2 transition-all">
                  {savingCreate ? <span className="w-3.5 h-3.5 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  {savingCreate ? 'Création...' : 'Créer'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={!!deleteConfirm}
        title="Supprimer la compétence"
        message="Supprimer définitivement cette compétence ? Toutes les assignations seront également supprimées."
        confirmLabel="Supprimer" danger
        onConfirm={() => handleDeleteSkill(deleteConfirm)}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  );
}
