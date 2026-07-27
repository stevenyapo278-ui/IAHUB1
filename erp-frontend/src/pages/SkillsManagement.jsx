import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import api from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';
import { useTheme } from '../context/ThemeContext';
import {
  Award, Zap, Users, Plus, Trash2, X,
  Search, Star, Table2, LayoutGrid
} from 'lucide-react';

const LEVEL_CONFIG = {
  1: { label: 'Débutant',       color: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-400 border-zinc-500/25',   dot: 'bg-zinc-400'    },
  2: { label: 'Junior',         color: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/25',   dot: 'bg-blue-400'    },
  3: { label: 'Intermédiaire',  color: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/25',  dot: 'bg-amber-400'   },
  4: { label: 'Avancé',         color: 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/25',dot: 'bg-orange-400' },
  5: { label: 'Expert',         color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/25', dot: 'bg-emerald-400' },
};

export default function SkillsManagement() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
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
  const [viewMode, setViewMode] = useState('matrix'); // 'matrix' | 'list'
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [catFilter, setCatFilter] = useState('');

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
    try {
      await api.post('/skills', { name, category: newSkillCategory.trim() || null });
      setNewSkillName(''); setNewSkillCategory(''); setShowCreateForm(false);
      toast.success(`Compétence « ${name} » créée`);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur lors de la création'); }
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

  function getUserLevel(userId, skillId) {
    const sk = skills.find(s => s.id === skillId);
    return sk?.userSkills?.find(us => us.user.id === userId)?.level ?? null;
  }

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
          {/* View toggle */}
          <div className="flex items-center p-0.5 rounded-lg border border-outline-variant/30 bg-surface-container">
            {[
              { id: 'matrix', icon: Table2,     title: 'Matrice' },
              { id: 'list',   icon: LayoutGrid, title: 'Cartes'  },
            ].map(v => {
              const Icon = v.icon;
              return (
                <button key={v.id} onClick={() => setViewMode(v.id)} title={v.title}
                  className={`p-1.5 rounded-md transition-all ${viewMode === v.id ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'text-on-surface-variant hover:text-on-surface'}`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              );
            })}
          </div>

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

      {/* ── Create form panel ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {showCreateForm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden border-b border-outline-variant/20 bg-surface-container-low/40"
          >
            <form onSubmit={handleCreateSkill} className="px-4 sm:px-6 lg:px-8 py-4 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1.5 flex-1 min-w-[160px]">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Nom *</span>
                <input required value={newSkillName} onChange={e => setNewSkillName(e.target.value)}
                  placeholder="ex: VPN, Active Directory, Kubernetes"
                  autoFocus
                  className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                />
              </label>
              <label className="flex flex-col gap-1.5 flex-1 min-w-[140px]">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Catégorie</span>
                <input value={newSkillCategory} onChange={e => setNewSkillCategory(e.target.value)}
                  placeholder="ex: Infrastructure, Sécurité"
                  className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                />
              </label>
              <div className="flex gap-2 shrink-0">
                <button type="submit"
                  className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 text-slate-950 text-sm font-bold shadow-md"
                >Créer</button>
                <motion.button type="button" onClick={() => setShowCreateForm(false)}
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  className="p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all"
                ><X className="w-4 h-4" /></motion.button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

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
        ) : viewMode === 'matrix' ? (
          /* ── Matrix View ─────────────────────────────────────────────── */
          <div className="overflow-auto rounded-2xl border border-outline-variant/30 bg-surface-container-lowest">
            <table className="w-full border-collapse" style={{ minWidth: `${200 + techs.length * 100}px` }}>
              <thead>
                <tr className="border-b border-outline-variant/20 bg-surface-container-low/60">
                  <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-on-surface-variant w-48 sticky left-0 z-10 bg-surface-container-lowest">
                    Compétence
                  </th>
                  {techs.map(tech => (
                    <th key={tech.id} className="px-2 py-3 text-center min-w-[90px]">
                      <div className="flex flex-col items-center gap-1">
                        <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 text-primary text-[11px] font-bold flex items-center justify-center">
                          {tech.fullName?.charAt(0)?.toUpperCase()}
                        </div>
                        <span className="text-[10px] font-semibold text-on-surface-variant truncate max-w-[80px] block">
                          {tech.fullName?.split(' ')[0]}
                        </span>
                      </div>
                    </th>
                  ))}
                  <th className="w-10 px-2" />
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {filteredSkills.map((skill, idx) => (
                    <>
                      <motion.tr
                        key={skill.id}
                        layout
                        initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15, delay: idx * 0.015 }}
                        className="border-b border-outline-variant/10 group hover:bg-surface-container-low/40 transition-colors"
                      >
                        <td className="px-4 py-3.5 sticky left-0 z-10 bg-surface-container-lowest group-hover:bg-surface-container-low/40 transition-colors">
                          <div className="flex items-center gap-2">
                            <div>
                              <p className="text-sm font-semibold text-on-surface">{skill.name}</p>
                              {skill.category && (
                                <span className="text-[9px] text-on-surface-variant font-medium uppercase tracking-wider">{skill.category}</span>
                              )}
                            </div>
                          </div>
                        </td>

                        {techs.map(tech => {
                          const level = getUserLevel(tech.id, skill.id);
                          const cfg = level ? LEVEL_CONFIG[level] : null;
                          return (
                            <td key={tech.id} className="px-2 py-3 text-center">
                              {cfg ? (
                                <div className="flex flex-col items-center gap-1 group/cell">
                                  <div className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-bold border ${cfg.color}`}>
                                    {[...Array(level)].map((_, i) => <Star key={i} className="w-2 h-2 fill-current" />)}
                                  </div>
                                  <button
                                    onClick={() => handleRemoveSkill(skill.id, tech.id)}
                                    className="text-[9px] text-red-500/0 group-hover/cell:text-red-500 hover:!text-red-600 transition-all font-medium"
                                  >retirer</button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => {
                                    setSelectedSkill(selectedSkill?.id === skill.id ? null : skill);
                                    setAssigningUserId(String(tech.id));
                                  }}
                                  className="w-6 h-6 rounded-full border-2 border-dashed border-outline-variant/30 flex items-center justify-center hover:border-amber-500/50 hover:bg-amber-500/5 transition-all group/add mx-auto"
                                  title={`Assigner ${skill.name} à ${tech.fullName}`}
                                >
                                  <Plus className="w-2.5 h-2.5 text-outline/30 group-hover/add:text-amber-500 transition-colors" />
                                </button>
                              )}
                            </td>
                          );
                        })}

                        <td className="px-2 py-3">
                          <button
                            onClick={() => setDeleteConfirm(skill.id)}
                            className="p-1 rounded-lg text-on-surface-variant/30 hover:text-red-500 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </motion.tr>

                      {selectedSkill?.id === skill.id && (
                        <tr key={`${skill.id}-assign`}>
                          <td colSpan={techs.length + 2} className="p-0">
                            <motion.div
                              initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="border-b border-outline-variant/20 px-4 py-3 flex flex-wrap items-center gap-3 bg-amber-500/5"
                            >
                              <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">Assigner {skill.name} à :</span>
                              <select
                                value={assigningUserId}
                                onChange={e => setAssigningUserId(e.target.value)}
                                className="bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary cursor-pointer transition-all"
                              >
                                <option value="">Choisir un technicien...</option>
                                {techs
                                  .filter(u => !skill.userSkills?.some(s => s.user.id === u.id))
                                  .map(u => <option key={u.id} value={u.id}>{u.fullName} ({u.role})</option>)
                                }
                              </select>
                              <select
                                value={assigningLevel}
                                onChange={e => setAssigningLevel(Number(e.target.value))}
                                className="bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary cursor-pointer transition-all"
                              >
                                {[1, 2, 3, 4, 5].map(l => (
                                  <option key={l} value={l}>Niveau {l} — {LEVEL_CONFIG[l].label}</option>
                                ))}
                              </select>
                              <button
                                onClick={() => handleAssignSkill(skill.id)}
                                disabled={!assigningUserId}
                                className="px-4 py-2 rounded-xl bg-amber-500 text-slate-950 text-sm font-bold disabled:opacity-40 hover:brightness-110 transition-all"
                              >Assigner</button>
                              <button onClick={() => setSelectedSkill(null)} className="p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all ml-auto">
                                <X className="w-4 h-4" />
                              </button>
                            </motion.div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        ) : (
          /* ── Card / List View ────────────────────────────────────────── */
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            <AnimatePresence initial={false}>
              {filteredSkills.map((skill, idx) => (
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
                        onClick={() => setSelectedSkill(selectedSkill?.id === skill.id ? null : skill)}
                        className={`p-1.5 rounded-lg border text-[10px] font-bold flex items-center gap-1 transition-all ${
                          selectedSkill?.id === skill.id
                            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                            : 'border-outline-variant/30 text-on-surface-variant hover:bg-surface-container'
                        }`}
                      >
                        <Plus className="w-3 h-3" />
                        Assigner
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

                  <AnimatePresence>
                    {selectedSkill?.id === skill.id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden border-t border-outline-variant/20 px-4 py-3 space-y-2 bg-amber-500/5"
                      >
                        <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">Assigner à</p>
                        <select value={assigningUserId} onChange={e => setAssigningUserId(e.target.value)}
                          className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary cursor-pointer transition-all">
                          <option value="">Choisir un technicien...</option>
                          {techs.filter(u => !skill.userSkills?.some(s => s.user.id === u.id))
                            .map(u => <option key={u.id} value={u.id}>{u.fullName} ({u.role})</option>)}
                        </select>
                        <select value={assigningLevel} onChange={e => setAssigningLevel(Number(e.target.value))}
                          className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary cursor-pointer transition-all">
                          {[1, 2, 3, 4, 5].map(l => (
                            <option key={l} value={l}>Niveau {l} — {LEVEL_CONFIG[l].label}</option>
                          ))}
                        </select>
                        <div className="flex gap-2">
                          <button onClick={() => handleAssignSkill(skill.id)} disabled={!assigningUserId}
                            className="flex-1 py-2 rounded-xl bg-amber-500 text-slate-950 text-xs font-bold disabled:opacity-40 hover:brightness-110 transition-all">
                            Assigner
                          </button>
                          <button onClick={() => setSelectedSkill(null)}
                            className="p-1.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

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
