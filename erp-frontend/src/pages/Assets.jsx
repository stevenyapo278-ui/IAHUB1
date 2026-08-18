import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Boxes, Plus, Search, RefreshCw, Trash2, Pencil,
  Monitor, Printer, Network, Package, Phone, HelpCircle,
  AlertTriangle, Calendar, MapPin, User
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../utils/permissions';
import useSystemSettings from '../hooks/useSystemSettings';

const TYPE_META = {
  COMPUTER: { label: 'Ordinateur', icon: Monitor, color: 'text-blue-400', bg: 'bg-blue-500/10' },
  PRINTER: { label: 'Imprimante', icon: Printer, color: 'text-purple-400', bg: 'bg-purple-500/10' },
  NETWORK: { label: 'Réseau', icon: Network, color: 'text-teal-400', bg: 'bg-teal-500/10' },
  SOFTWARE: { label: 'Logiciel', icon: Package, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  PHONE: { label: 'Téléphone', icon: Phone, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  OTHER: { label: 'Autre', icon: HelpCircle, color: 'text-slate-400', bg: 'bg-slate-500/10' },
};

const STATUS_META = {
  IN_USE: { label: 'En service', color: 'text-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  STOCK: { label: 'En stock', color: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  BROKEN: { label: 'En panne', color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  OUT_OF_SERVICE: { label: 'Hors service', color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/20' },
};

const EMPTY_FORM = {
  name: '', assetType: 'COMPUTER', serialNumber: '', inventoryNumber: '', status: 'IN_USE',
  manufacturer: '', model: '', locationId: '', ownerId: '', teamId: '', purchaseDate: '', warrantyEnd: '', notes: '',
};

function fmtDate(d) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('fr-FR');
}

export default function Assets() {
  const { user } = useAuth();
  const { autonomousMode } = useSystemSettings();
  const [assets, setAssets] = useState([]);
  const [locations, setLocations] = useState([]);
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const canManage = hasPermission(user, 'assets.manage');

  function loadAssets() {
    setLoading(true);
    const params = new URLSearchParams();
    if (search.trim()) params.set('q', search.trim());
    if (typeFilter) params.set('assetType', typeFilter);
    if (statusFilter) params.set('status', statusFilter);
    api.get(`/assets?${params}&pageSize=200`)
      .then(({ data }) => setAssets(Array.isArray(data) ? data : (data.assets || [])))
      .catch((err) => toast.error(err.response?.data?.error || 'Erreur chargement inventaire'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadAssets();
    api.get('/glpi/locations').then(({ data }) => setLocations(data)).catch(() => {});
    api.get('/users').then(({ data }) => setUsers(Array.isArray(data) ? data : (data.users || []))).catch(() => {});
    api.get('/teams').then(({ data }) => setTeams(Array.isArray(data) ? data : (data.teams || []))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, typeFilter, statusFilter]);

  async function handleSync() {
    setSyncing(true);
    try {
      const { data } = await api.post('/assets/sync-glpi');
      toast.success(`${data.synced} équipement(s) synchronisé(s) depuis GLPI`);
      loadAssets();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur sync GLPI');
    } finally {
      setSyncing(false);
    }
  }

  function startEdit(asset) {
    setEditing(asset.id);
    setForm({
      name: asset.name, assetType: asset.assetType, serialNumber: asset.serialNumber || '',
      inventoryNumber: asset.inventoryNumber || '', status: asset.status,
      manufacturer: asset.manufacturer || '', model: asset.model || '',
      locationId: asset.glpiLocation ? String(asset.glpiLocation.id) : '',
      ownerId: asset.owner ? String(asset.owner.id) : '',
      teamId: asset.team ? String(asset.team.id) : '',
      purchaseDate: asset.purchaseDate ? asset.purchaseDate.slice(0, 10) : '',
      warrantyEnd: asset.warrantyEnd ? asset.warrantyEnd.slice(0, 10) : '',
      notes: asset.notes || '',
    });
    setShowForm(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Le nom est obligatoire');
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(), assetType: form.assetType, serialNumber: form.serialNumber || null,
        inventoryNumber: form.inventoryNumber || null, status: form.status,
        manufacturer: form.manufacturer || null, model: form.model || null,
        locationId: form.locationId ? Number(form.locationId) : null,
        ownerId: form.ownerId ? Number(form.ownerId) : null,
        teamId: form.teamId ? Number(form.teamId) : null,
        purchaseDate: form.purchaseDate || null, warrantyEnd: form.warrantyEnd || null,
        notes: form.notes || null,
      };
      if (editing) {
        await api.patch(`/assets/${editing}`, payload);
        toast.success('Équipement mis à jour');
      } else {
        await api.post('/assets', payload);
        toast.success('Équipement créé');
      }
      setShowForm(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      loadAssets();
    } catch (err) {
      toast.error(err.response?.data?.error || "Erreur lors de l'enregistrement");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(asset) {
    if (!window.confirm(`Supprimer l'équipement « ${asset.name} » ? Les liens vers les tickets seront aussi supprimés.`)) return;
    try {
      await api.delete(`/assets/${asset.id}`);
      toast.success('Équipement supprimé');
      loadAssets();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la suppression');
    }
  }

  const statusMeta = (s) => STATUS_META[s] || STATUS_META.OUT_OF_SERVICE;
  const typeMeta = (t) => TYPE_META[t] || TYPE_META.OTHER;

  const isWarrantyExpiring = (asset) => {
    if (!asset.warrantyEnd) return false;
    const days = (new Date(asset.warrantyEnd) - new Date()) / 86400000;
    return days >= 0 && days <= 60;
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-on-surface flex items-center gap-2">
            <Boxes className="w-6 h-6 text-blue-400" /> Inventaire
          </h1>
          <p className="text-sm text-on-surface/60 mt-1">
            {assets.length} équipement(s) — liez-les aux tickets pour suivre les interventions par matériel
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <button
              onClick={() => { setEditing(null); setForm(EMPTY_FORM); setShowForm(true); }}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 text-white text-xs font-bold shadow-md hover:shadow-lg flex items-center gap-2 cursor-pointer transition-all">
              <Plus className="w-4 h-4" /> Nouvel équipement
            </button>
          )}
          {!autonomousMode && canManage && (
            <button onClick={handleSync} disabled={syncing}
              className="px-4 py-2 rounded-xl border border-outline-variant/40 text-on-surface text-xs font-semibold hover:bg-surface-container transition-colors flex items-center gap-2 disabled:opacity-50 cursor-pointer">
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} /> Sync GLPI
            </button>
          )}
        </div>
      </div>

      {/* Recherche + filtres */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface/40" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par nom, n° de série ou n° d'inventaire..."
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
          />
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all">
          <option value="">Tous les types</option>
          {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all">
          <option value="">Tous les statuts</option>
          {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {/* Formulaire création / édition */}
      {showForm && canManage && (
        <form onSubmit={handleSave}
          className="mb-6 p-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low/40 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required
              placeholder="Nom de l'équipement *" className="input-field w-full px-3.5 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" />
            <select value={form.assetType} onChange={(e) => setForm({ ...form, assetType: e.target.value })}
              className="px-3.5 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all">
              {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
              className="px-3.5 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all">
              {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <input value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}
              placeholder="N° de série" className="px-3.5 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" />
            <input value={form.inventoryNumber} onChange={(e) => setForm({ ...form, inventoryNumber: e.target.value })}
              placeholder="N° d'inventaire" className="px-3.5 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" />
            <input value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
              placeholder="Constructeur" className="px-3.5 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" />
            <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder="Modèle" className="px-3.5 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" />
            <select value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })}
              className="px-3.5 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all">
              <option value="">— Lieu —</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.completename || l.name}</option>)}
            </select>
            <select value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })}
              className="px-3.5 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all">
              <option value="">— Propriétaire —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
            </select>
            <select value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })}
              className="px-3.5 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all">
              <option value="">— Équipe —</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <input type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })}
              className="px-3.5 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" />
            <input type="date" value={form.warrantyEnd} onChange={(e) => setForm({ ...form, warrantyEnd: e.target.value })}
              className="px-3.5 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" />
            <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Notes" className="px-3.5 py-2 rounded-xl border border-outline-variant/60 bg-surface text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none sm:col-span-2 lg:col-span-3" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => { setShowForm(false); setEditing(null); setForm(EMPTY_FORM); }}
              className="px-4 py-2 rounded-xl border border-outline-variant/40 text-on-surface text-xs font-semibold hover:bg-surface-container cursor-pointer transition-colors">
              Annuler
            </button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 text-white text-xs font-bold shadow-md hover:shadow-lg flex items-center gap-2 cursor-pointer transition-all disabled:opacity-50">
              <Plus className="w-4 h-4" /> {saving ? 'Enregistrement…' : (editing ? 'Mettre à jour' : 'Créer')}
            </button>
          </div>
        </form>
      )}

      {/* Liste */}
      {loading ? (
        <div className="text-center py-12 text-on-surface/40">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2" />
          Chargement...
        </div>
      ) : assets.length === 0 ? (
        <div className="text-center py-12 text-on-surface/40">
          <Boxes className="w-12 h-12 mx-auto mb-3 opacity-30" />
          {search || typeFilter || statusFilter ? 'Aucun équipement ne correspond à vos critères' : 'Aucun équipement. Créez-en un ou synchronisez l\'inventaire GLPI.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {assets.map((asset) => {
            const tm = typeMeta(asset.assetType);
            const sm = statusMeta(asset.status);
            const Icon = tm.icon;
            const expiring = isWarrantyExpiring(asset);
            return (
              <div key={asset.id}
                className="relative group p-4 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest hover:border-blue-500/30 hover:shadow-md transition-all">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`p-1.5 rounded-lg ${tm.bg} ${tm.color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-on-surface truncate">{asset.name}</p>
                      {(asset.serialNumber || asset.inventoryNumber) && (
                        <p className="text-xs text-on-surface/50 truncate">
                          {asset.inventoryNumber || asset.serialNumber}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${sm.bg} ${sm.color} border ${sm.border}`}>{sm.label}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${tm.bg} ${tm.color}`}>{tm.label}</span>
                  {expiring && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Garantie ≤ 60 j
                    </span>
                  )}
                </div>

                {(asset.model || asset.manufacturer) && (
                  <p className="text-xs text-on-surface/40 mb-1">
                    {[asset.manufacturer, asset.model].filter(Boolean).join(' — ')}
                  </p>
                )}

                <div className="flex items-center gap-3 text-xs text-on-surface/40">
                  {asset.glpiLocation && (
                    <span className="flex items-center gap-1 truncate">
                      <MapPin className="w-3 h-3" /> {asset.glpiLocation.completename || asset.glpiLocation.name}
                    </span>
                  )}
                  {asset.owner && (
                    <span className="flex items-center gap-1 truncate">
                      <User className="w-3 h-3" /> {asset.owner.fullName}
                    </span>
                  )}
                  {asset._count?.tickets > 0 && (
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> {asset._count.tickets} ticket(s)
                    </span>
                  )}
                </div>

                {asset.warrantyEnd && (
                  <p className="text-[11px] text-on-surface/40 mt-1">
                    Garantie jusqu'au {fmtDate(asset.warrantyEnd)}
                  </p>
                )}

                {canManage && (
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => startEdit(asset)} title="Modifier"
                      className="p-1.5 rounded-lg bg-surface-container text-on-surface/60 hover:bg-surface-container-high cursor-pointer transition-colors">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => handleDelete(asset)} title="Supprimer"
                      className="p-1.5 rounded-lg bg-surface-container text-on-surface/60 hover:bg-red-500/10 hover:text-red-500 cursor-pointer transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}