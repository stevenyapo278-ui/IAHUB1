import { useNavigate } from 'react-router-dom';
import { Mail, MailCheck, BookOpen } from 'lucide-react';

const QUICK_LINKS = [
  { label: 'Boîte mail', path: '/inbox', icon: Mail, color: 'text-sky-500' },
  { label: 'Brouillons IA', path: '/email-drafts', icon: MailCheck, color: 'text-primary' },
  { label: 'Base conn.', path: '/knowledge-base', icon: BookOpen, color: 'text-purple-500' },
];

export default function QuickAccessWidget({ config }) {
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-2 gap-2.5 h-full w-full">
      {QUICK_LINKS.map(item => (
        <button
          key={item.label}
          onClick={() => navigate(item.path)}
          className="flex items-center gap-2 p-3 rounded-xl border border-outline-variant/30 bg-surface-container-low/40 hover:bg-surface-container hover:border-primary/30 transition-all text-left group"
        >
          <item.icon className={`w-4 h-4 ${item.color}`} />
          <span className="text-xs font-semibold text-on-surface group-hover:text-primary transition-colors">{item.label}</span>
        </button>
      ))}
    </div>
  );
}
