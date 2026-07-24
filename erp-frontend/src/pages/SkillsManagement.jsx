import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import api from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } },
};

export default function SkillsManagement() {
  const [skills, setSkills] = useState([]);
  const [users, setUsers] = useState([]);
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillCategory, setNewSkillCategory] = useState('');
  const [selectedSkill, setSelectedSkill] = useState(null);
  const [assigningUserId, setAssigningUserId] = useState('');
  const [assigningLevel, setAssigningLevel] = useState(3);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [loading, setLoading] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([
      api.get('/skills'),
      api.get('/users'),
    ])
      .then(([skillsRes, usersRes]) => {
        setSkills(skillsRes.data);
        const uList = Array.isArray(usersRes.data) ? usersRes.data : (usersRes.data.users || []);
        setUsers(uList.filter((u) => u.role !== 'REQUESTER'));
      })
      .catch((err) => toast.error(err.response?.data?.error || 'Erreur de chargement'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleCreateSkill(e) {
    e.preventDefault();
    const name = newSkillName.trim();
    if (!name) return;
    try {
      await api.post('/skills', { name, category: newSkillCategory.trim() || null });
      setNewSkillName('');
      setNewSkillCategory('');
      toast.success(`Compétence « ${name} » créée`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la création');
    }
  }

  async function handleAssignSkill(skillId) {
    if (!assigningUserId) return;
    try {
      await api.post(`/skills/${skillId}/assign`, { userId: Number(assigningUserId), level: assigningLevel });
      toast.success('Compétence assignée');
      setAssigningUserId('');
      setAssigningLevel(3);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Erreur lors de l'assignation");
    }
  }

  async function handleRemoveSkill(skillId, userId) {
    try {
      await api.delete(`/skills/${skillId}/assign/${userId}`);
      toast.success('Compétence retirée');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors du retrait');
    }
  }

  async function handleDeleteSkill(id) {
    try {
      await api.delete(`/skills/${id}`);
      toast.success('Compétence supprimée');
      setDeleteConfirm(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la suppression');
    }
  }

  const levelLabels = { 1: 'Débutant', 2: 'Junior', 3: 'Intermédiaire', 4: 'Avancé', 5: 'Expert' };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="p-lg flex flex-col gap-lg"
    >
      <motion.header variants={itemVariants}>
        <h2 className="font-display-lg text-display-lg text-on-background font-bold">Compétences</h2>
        <p className="font-body-lg text-body-lg text-on-surface-variant mt-1">
          Définissez les domaines d'expertise des techniciens pour l'assignation intelligente des tickets.
        </p>
      </motion.header>

      {/* Statistiques */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-3 gap-gutter">
        <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-lg">
          <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Compétences</p>
          <h3 className="font-display-lg text-display-lg text-on-background font-bold mt-2">{skills.length}</h3>
        </div>
        <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-lg">
          <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Techniciens qualifiés</p>
          <h3 className="font-display-lg text-display-lg text-on-background font-bold mt-2">
            {users.filter((u) => u.role === 'TECHNICIAN' || u.role === 'ADMIN').length}
          </h3>
        </div>
        <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-lg">
          <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Assignations</p>
          <h3 className="font-display-lg text-display-lg text-on-background font-bold mt-2">
            {skills.reduce((sum, s) => sum + (s.userSkills?.length || 0), 0)}
          </h3>
        </div>
      </motion.div>

      {/* Création d'une compétence */}
      <motion.form
        variants={itemVariants}
        onSubmit={handleCreateSkill}
        className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow p-lg flex flex-col gap-md"
      >
        <h3 className="font-headline-md text-headline-md text-on-surface font-bold flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[22px]">add_circle</span>
          Nouvelle compétence
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-md">
          <label className="flex flex-col gap-1">
            <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Nom *</span>
            <input
              required
              value={newSkillName}
              onChange={(e) => setNewSkillName(e.target.value)}
              placeholder="ex: VPN, Réseau, Active Directory"
              className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold">Catégorie</span>
            <input
              value={newSkillCategory}
              onChange={(e) => setNewSkillCategory(e.target.value)}
              placeholder="ex: Infrastructure, Logiciel, Sécurité"
              className="w-full bg-surface border border-outline-variant/60 rounded-xl px-3.5 py-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              className="w-full btn-gradient font-semibold py-2.5 rounded-xl shadow-md shadow-primary/10 hover:shadow-lg transition-all text-body-sm"
            >
              Ajouter
            </button>
          </div>
        </div>
      </motion.form>

      {/* Liste des compétences */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 lg:grid-cols-2 gap-lg">
        {skills.length === 0 && !loading && (
          <div className="col-span-full flex flex-col items-center justify-center py-12 text-on-surface-variant italic">
            <span className="material-symbols-outlined text-[48px] text-outline/40 mb-2">psychology</span>
            Aucune compétence définie. Créez-en une pour commencer.
          </div>
        )}

        {skills.map((skill) => (
          <motion.div
            key={skill.id}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl card-shadow overflow-hidden"
          >
            <div className="p-md border-b border-outline-variant/40 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-primary/60" />
                <h4 className="font-headline-sm text-headline-sm text-on-surface font-semibold">{skill.name}</h4>
                {skill.category && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold border border-outline-variant/60 text-on-surface-variant bg-surface-container-low uppercase">
                    {skill.category}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedSkill(selectedSkill?.id === skill.id ? null : skill)}
                  className={`px-3 py-1.5 rounded-xl border text-[11px] font-semibold transition-all ${
                    selectedSkill?.id === skill.id
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-outline-variant/60 text-on-surface-variant hover:bg-surface-container-low'
                  }`}
                >
                  Assigner
                </button>
                <button
                  onClick={() => setDeleteConfirm(skill.id)}
                  className="text-on-surface-variant hover:text-error transition-colors p-1"
                >
                  <span className="material-symbols-outlined text-[18px]">delete</span>
                </button>
              </div>
            </div>

            {/* Techniciens assignés */}
            <div className="p-md space-y-2">
              {skill.userSkills?.length > 0 ? (
                skill.userSkills.map((us) => (
                  <div key={us.user.id} className="flex items-center justify-between py-1.5 border-b border-outline-variant/20 last:border-0">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-primary/5 border border-primary/20 text-primary flex items-center justify-center text-[10px] font-bold">
                        {us.user.fullName?.charAt(0)?.toUpperCase() || '?'}
                      </div>
                      <div>
                        <p className="text-body-sm text-on-surface font-medium">{us.user.fullName}</p>
                        <p className="text-[10px] text-on-surface-variant">{us.user.role}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-primary/20 bg-primary/5 text-primary">
                        Niv. {us.level} — {levelLabels[us.level] || us.level}
                      </span>
                      <button
                        onClick={() => handleRemoveSkill(skill.id, us.user.id)}
                        className="text-on-surface-variant/50 hover:text-error transition-colors"
                      >
                        <span className="material-symbols-outlined text-[14px]">close</span>
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-body-sm text-on-surface-variant italic">Aucun technicien assigné</p>
              )}
            </div>

            {/* Panneau d'assignation */}
            <AnimatePresence>
              {selectedSkill?.id === skill.id && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden border-t border-outline-variant/40 bg-surface-container-low/30"
                >
                  <div className="p-md flex flex-col gap-3">
                    <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Assigner à un technicien</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <select
                        value={assigningUserId}
                        onChange={(e) => setAssigningUserId(e.target.value)}
                        className="bg-surface border border-outline-variant/60 rounded-xl px-3 py-2 text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20"
                      >
                        <option value="">Choisir un technicien...</option>
                        {users
                          .filter((u) => !skill.userSkills?.some((s) => s.user.id === u.id))
                          .filter((u) => ['ADMIN', 'TECHNICIAN', 'SUPERADMIN'].includes(u.role))
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.fullName} ({u.role})
                            </option>
                          ))}
                      </select>
                      <select
                        value={assigningLevel}
                        onChange={(e) => setAssigningLevel(Number(e.target.value))}
                        className="bg-surface border border-outline-variant/60 rounded-xl px-3 py-2 text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20"
                      >
                        {[1, 2, 3, 4, 5].map((l) => (
                          <option key={l} value={l}>
                            Niveau {l} — {levelLabels[l]}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleAssignSkill(skill.id)}
                        disabled={!assigningUserId}
                        className="btn-gradient font-semibold py-2 rounded-xl text-body-sm disabled:opacity-50 shadow-sm"
                      >
                        Assigner
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ))}
      </motion.div>

      <ConfirmDialog
        open={!!deleteConfirm}
        title="Supprimer la compétence"
        message="Supprimer définitivement cette compétence ? Toutes les assignations aux techniciens seront également supprimées."
        confirmLabel="Supprimer"
        danger
        onConfirm={() => handleDeleteSkill(deleteConfirm)}
        onCancel={() => setDeleteConfirm(null)}
      />
    </motion.div>
  );
}
