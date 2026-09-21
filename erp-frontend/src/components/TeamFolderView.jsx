import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { X, Clock, User, MapPin, ChevronRight, Inbox } from 'lucide-react';
import SlaBadge from './SlaBadge';
import { useNavigate } from 'react-router-dom';
import './TeamFolderView.css';

const FOLDER_CSS = ['folder-amber', 'folder-blue', 'folder-emerald', 'folder-violet', 'folder-rose', 'folder-cyan', 'folder-orange', 'folder-indigo'];

function FolderCard({ team, tickets, cssClass, onClick }) {
  const count = tickets.length;
  return (
    <button
      onClick={(e) => onClick(team, tickets, e.currentTarget.getBoundingClientRect())}
      className="group flex flex-col items-center gap-2 cursor-pointer focus:outline-none"
    >
      <div className={`team-folder ${cssClass}`}>
        <div className="folder-back" />
        <div className="folder-page folder-page-4" />
        <div className="folder-page folder-page-3" />
        <div className="folder-page folder-page-2" />
        <div className="folder-front">
          <span className="text-white/90 text-[11px] font-bold truncate max-w-[120px] relative z-10">{team.name}</span>
          <span className="bg-white/25 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full min-w-[20px] text-center relative z-10">
            {count}
          </span>
        </div>
      </div>
      <p className="text-xs font-bold text-on-surface truncate max-w-[200px] text-center">{team.name}</p>
      <p className="text-[10px] text-on-surface-variant">{count} ticket{count !== 1 ? 's' : ''}</p>
    </button>
  );
}

function TicketModal({ group, tickets, originRect, onClose }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [isClosing, setIsClosing] = useState(false);
  const filtered = useMemo(() => {
    if (!search.trim()) return tickets;
    const q = search.toLowerCase();
    return tickets.filter((t) =>
      `#${t.id}`.includes(q) ||
      t.title?.toLowerCase().includes(q) ||
      t.assignedTo?.fullName?.toLowerCase().includes(q) ||
      t.requester?.fullName?.toLowerCase().includes(q) ||
      t.locationName?.toLowerCase().includes(q)
    );
  }, [tickets, search]);

  function handleClose() {
    setIsClosing(true);
    setTimeout(() => onClose(), 550);
  }

  const modalW = 672;
  const modalH = window.innerHeight * 0.7;
  const modalLeft = (window.innerWidth - modalW) / 2;
  const modalTop = (window.innerHeight - modalH) / 2;

  const folderCx = originRect ? originRect.left + originRect.width / 2 : window.innerWidth / 2;
  const folderCy = originRect ? originRect.top + originRect.height / 2 : window.innerHeight / 2;
  const originX = ((folderCx - modalLeft) / modalW) * 100;
  const originY = ((folderCy - modalTop) / modalH) * 100;

  return (
    <div className="fixed inset-0 z-[9999]" onClick={handleClose}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: isClosing ? 0 : 1 }}
        transition={{ duration: isClosing ? 0.55 : 0.3 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />
      <div
        style={{
          width: modalW,
          height: modalH,
          left: modalLeft,
          top: modalTop,
          transformOrigin: `${originX}% ${originY}%`,
        }}
        onClick={(e) => e.stopPropagation()}
        className={`absolute bg-surface rounded-2xl border border-outline-variant/30 shadow-2xl flex flex-col overflow-hidden ${isClosing ? 'modal-genie-out' : 'modal-genie-in'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/20 shrink-0">
          <div>
            <h2 className="text-base font-bold text-on-surface">{group.name}</h2>
            <p className="text-[11px] text-on-surface-variant">{tickets.length} ticket{tickets.length !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-surface-container-high text-on-surface-variant transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-outline-variant/10 shrink-0">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher (#ID, titre, assigné, demandeur, lieu...)"
            className="w-full px-3 py-2 text-xs rounded-xl bg-surface-container-high border border-outline-variant/20 text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary/50 transition-colors"
            autoFocus
          />
        </div>

        {/* Ticket list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-on-surface-variant/50">
              <Inbox className="w-8 h-8" />
              <p className="text-xs font-medium">Aucun ticket trouvé</p>
            </div>
          ) : (
            filtered.map((t) => (
              <div
                key={t.id}
                onClick={() => { onClose(); navigate(`/tickets/${t.id}`); }}
                className="p-3 rounded-xl border border-outline-variant/20 bg-surface-container-lowest hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer"
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                      <span className="font-mono text-[10px] font-bold text-primary">#{t.id}</span>
                      {t.priority && (
                        <span className={`text-[9px] font-black px-1 py-0.5 rounded ${
                          t.priority === 'P1' ? 'bg-red-500/10 text-red-600 border border-red-500/25' :
                          t.priority === 'P2' ? 'bg-orange-500/10 text-orange-600 border border-orange-500/25' :
                          'bg-blue-500/10 text-blue-600 border border-blue-500/25'
                        }`}>
                          {t.priority}
                        </span>
                      )}
                      <span className="text-[9px] text-on-surface-variant bg-surface-container-high px-1 py-0.5 rounded">
                        {t.status}
                      </span>
                    </div>
                    <p className="text-xs font-bold text-on-surface line-clamp-1">{t.title}</p>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-on-surface-variant">
                      {t.assignedTo && (
                        <span className="flex items-center gap-0.5">
                          <User className="w-2.5 h-2.5" />
                          {t.assignedTo.fullName}
                        </span>
                      )}
                      {t.locationName && (
                        <span className="flex items-center gap-0.5">
                          <MapPin className="w-2.5 h-2.5" />
                          {t.locationName}
                        </span>
                      )}
                      <span className="flex items-center gap-0.5 ml-auto">
                        <Clock className="w-2.5 h-2.5" />
                        {new Date(t.createdAt).toLocaleDateString('fr-FR')}
                      </span>
                    </div>
                  </div>
                  <SlaBadge ticket={t} compact />
                  <ChevronRight className="w-3.5 h-3.5 text-on-surface-variant/40 shrink-0 mt-1" />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function TeamFolderView({ tickets, teams }) {
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [selectedTickets, setSelectedTickets] = useState([]);
  const [originRect, setOriginRect] = useState(null);
  const [groupBy, setGroupBy] = useState('team');

  const groups = useMemo(() => {
    if (groupBy === 'technician') {
      const map = {};
      const unassigned = [];
      tickets.forEach((t) => {
        if (t.assignedTo?.id) {
          if (!map[t.assignedTo.id]) {
            map[t.assignedTo.id] = { id: t.assignedTo.id, name: t.assignedTo.fullName, tickets: [] };
          }
          map[t.assignedTo.id].tickets.push(t);
        } else {
          unassigned.push(t);
        }
      });
      const result = Object.values(map)
        .filter((g) => g.tickets.length > 0)
        .map((g, i) => ({ id: g.id, name: g.name, tickets: g.tickets, cssClass: FOLDER_CSS[i % FOLDER_CSS.length] }));
      if (unassigned.length > 0) {
        result.push({ id: null, name: 'Non assignés', tickets: unassigned, cssClass: FOLDER_CSS[result.length % FOLDER_CSS.length] });
      }
      return result;
    }
    if (groupBy === 'requester') {
      const map = {};
      const unassigned = [];
      tickets.forEach((t) => {
        const r = t.requester;
        if (r?.id) {
          if (!map[r.id]) {
            map[r.id] = { id: r.id, name: r.fullName, tickets: [] };
          }
          map[r.id].tickets.push(t);
        } else {
          unassigned.push(t);
        }
      });
      const result = Object.values(map)
        .filter((g) => g.tickets.length > 0)
        .sort((a, b) => b.tickets.length - a.tickets.length)
        .map((g, i) => ({ id: g.id, name: g.name, tickets: g.tickets, cssClass: FOLDER_CSS[i % FOLDER_CSS.length] }));
      if (unassigned.length > 0) {
        result.push({ id: null, name: 'Non identifié', tickets: unassigned, cssClass: FOLDER_CSS[result.length % FOLDER_CSS.length] });
      }
      return result;
    }
    if (groupBy === 'location') {
      const map = {};
      const unassigned = [];
      tickets.forEach((t) => {
        const loc = t.locationName;
        if (loc) {
          if (!map[loc]) {
            map[loc] = { name: loc, tickets: [] };
          }
          map[loc].tickets.push(t);
        } else {
          unassigned.push(t);
        }
      });
      const result = Object.values(map)
        .filter((g) => g.tickets.length > 0)
        .sort((a, b) => b.tickets.length - a.tickets.length)
        .map((g, i) => ({ id: g.name, name: g.name, tickets: g.tickets, cssClass: FOLDER_CSS[i % FOLDER_CSS.length] }));
      if (unassigned.length > 0) {
        result.push({ id: null, name: 'Sans lieu', tickets: unassigned, cssClass: FOLDER_CSS[result.length % FOLDER_CSS.length] });
      }
      return result;
    }
    const unassigned = [];
    const map = {};
    teams.forEach((t) => { map[t.id] = []; });
    tickets.forEach((t) => {
      if (t.teamId && map[t.teamId]) {
        map[t.teamId].push(t);
      } else {
        unassigned.push(t);
      }
    });
    const result = teams.filter((t) => (map[t.id]?.length || 0) > 0).map((team, i) => ({
      id: team.id,
      name: team.name,
      tickets: map[team.id],
      cssClass: FOLDER_CSS[i % FOLDER_CSS.length],
    }));
    if (unassigned.length > 0) {
      result.push({ id: null, name: 'Non assignés', tickets: unassigned, cssClass: FOLDER_CSS[result.length % FOLDER_CSS.length] });
    }
    return result;
  }, [tickets, teams, groupBy]);

  function handleFolderClick(group, groupTickets, rect) {
    setSelectedTeam(group);
    setSelectedTickets(groupTickets);
    setOriginRect(rect);
  }

  return (
    <>
      <div className="p-6">
        <div className="flex items-center gap-2 mb-6">
          <span className="text-xs font-medium text-on-surface-variant">Regrouper par :</span>
          <button
            onClick={() => setGroupBy('team')}
            className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
              groupBy === 'team' ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
            }`}
          >
            Équipes
          </button>
          <button
            onClick={() => setGroupBy('technician')}
            className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
              groupBy === 'technician' ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
            }`}
          >
            Techniciens
          </button>
          <button
            onClick={() => setGroupBy('requester')}
            className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
              groupBy === 'requester' ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
            }`}
          >
            Demandeurs
          </button>
          <button
            onClick={() => setGroupBy('location')}
            className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
              groupBy === 'location' ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
            }`}
          >
            Lieux
          </button>
          <span className="ml-auto text-xs text-on-surface-variant">
            <span className="font-black text-on-surface">{tickets.length}</span> ticket{tickets.length !== 1 ? 's' : ''}
          </span>
        </div>

        {groups.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-on-surface-variant/50">
            <Inbox className="w-10 h-10" />
            <p className="text-sm font-medium">Aucun groupe avec des tickets</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6 justify-items-center">
            {groups.map((g) => (
              <FolderCard
                key={g.id ?? 'unassigned'}
                team={{ id: g.id, name: g.name }}
                tickets={g.tickets}
                cssClass={g.cssClass}
                onClick={handleFolderClick}
              />
            ))}
          </div>
        )}
      </div>

      {selectedTeam && (
        <TicketModal
          group={selectedTeam}
          tickets={selectedTickets}
          originRect={originRect}
          onClose={() => { setSelectedTeam(null); setSelectedTickets([]); setOriginRect(null); }}
        />
      )}
    </>
  );
}
