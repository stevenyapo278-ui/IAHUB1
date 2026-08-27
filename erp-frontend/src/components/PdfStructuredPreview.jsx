import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, Table2, List, Type, Hash, FileText, Eye, X } from 'lucide-react';

const BLOCK_ICONS = {
  heading: Hash,
  paragraph: FileText,
  table: Table2,
  list: List,
};

const HEADING_COLORS = {
  1: 'text-on-surface font-black text-lg',
  2: 'text-on-surface font-bold text-base',
  3: 'text-on-surface font-semibold text-sm',
  4: 'text-on-surface-variant font-semibold text-sm',
  5: 'text-on-surface-variant font-medium text-xs',
  6: 'text-on-surface-variant font-medium text-xs',
};

export default function PdfStructuredPreview({ structured, onClose }) {
  const [expandedTables, setExpandedTables] = useState(new Set());

  if (!structured) return null;

  function toggleTable(idx) {
    setExpandedTables(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
      className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest overflow-hidden shadow-sm"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/20 bg-surface-container-low/40">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <span className="text-xs font-bold text-on-surface">Contenu structuré du PDF</span>
          <span className="text-[10px] text-on-surface-variant font-medium px-2 py-0.5 rounded-full bg-surface-container border border-outline-variant/30">
            {structured.pageCount} page{structured.pageCount > 1 ? 's' : ''} · {structured.blockCount} bloc{structured.blockCount > 1 ? 's' : ''}
          </span>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Stats pills */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-outline-variant/10">
        {structured.headingCount > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 text-[10px] font-bold">
            <Hash className="w-2.5 h-2.5" /> {structured.headingCount} titre{structured.headingCount > 1 ? 's' : ''}
          </span>
        )}
        {structured.tableCount > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] font-bold">
            <Table2 className="w-2.5 h-2.5" /> {structured.tableCount} tableau{structured.tableCount > 1 ? 'x' : ''}
          </span>
        )}
        {structured.paragraphCount > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 text-[10px] font-bold">
            <FileText className="w-2.5 h-2.5" /> {structured.paragraphCount} paragraphe{structured.paragraphCount > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Blocks */}
      <div className="max-h-[500px] overflow-y-auto p-4 space-y-3">
        {structured.blocks.map((block, idx) => {
          if (block.type === 'heading') {
            const level = Math.min(block.level || 2, 6);
            return (
              <div key={idx} className={`flex items-center gap-2 ${HEADING_COLORS[level] || 'text-on-surface font-semibold text-sm'}`}>
                <span className="text-[10px] text-on-surface-variant/50 font-mono shrink-0">H{level}</span>
                <span>{block.content}</span>
              </div>
            );
          }

          if (block.type === 'table') {
            const isExpanded = expandedTables.has(idx);
            return (
              <div key={idx} className="rounded-xl border border-outline-variant/30 overflow-hidden">
                <button
                  onClick={() => toggleTable(idx)}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-emerald-500/5 hover:bg-emerald-500/10 transition-colors text-left"
                >
                  <Table2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    Tableau ({block.headers?.length || 0} colonnes, {block.rows?.length || 0} lignes)
                  </span>
                  {isExpanded ? <ChevronDown className="w-3.5 h-3.5 ml-auto text-on-surface-variant" /> : <ChevronRight className="w-3.5 h-3.5 ml-auto text-on-surface-variant" />}
                </button>
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-surface-container-low">
                              {block.headers?.map((h, i) => (
                                <th key={i} className="px-3 py-1.5 text-left font-bold text-on-surface-variant border-b border-outline-variant/20">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {block.rows?.map((row, ri) => (
                              <tr key={ri} className="border-b border-outline-variant/10 hover:bg-surface-container-low/50">
                                {row.map((cell, ci) => (
                                  <td key={ci} className="px-3 py-1.5 text-on-surface">{cell}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          }

          if (block.type === 'list') {
            return (
              <div key={idx} className="flex items-start gap-2 pl-2">
                <List className="w-3.5 h-3.5 text-on-surface-variant mt-0.5 shrink-0" />
                <ul className="space-y-0.5">
                  {block.items?.map((item, li) => (
                    <li key={li} className="text-xs text-on-surface flex items-start gap-1.5">
                      <span className="text-on-surface-variant/40 mt-0.5 shrink-0">{block.ordered ? `${li + 1}.` : '•'}</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          }

          // Paragraph (default)
          return (
            <p key={idx} className="text-xs text-on-surface leading-relaxed">
              {block.content}
            </p>
          );
        })}
      </div>
    </motion.div>
  );
}
