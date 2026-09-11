import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function preprocessMarkdown(content) {
  if (!content || typeof content !== 'string') return '';

  // Convertir les références #123456 en liens cliquables
  let formatted = content.replace(/#(\d{2,6})\b/g, '[#$1](/tickets/$1)');

  // 1) Séparer les lignes de tableau concaténées sur une même ligne
  //    Pattern: "| cell | cell | | cell | cell |" → lignes séparées
  //    On matche "| " suivi de contenu non-pipe, puis " |" suivi de " |" ou " | "
  formatted = formatted.replace(
    /(\|[^\n|]+\|)\s+\|\s+(\|)/g,
    '$1\n$2'
  );

  // 2) Séparer les doubles pipes vides (ex: "Urgents || :--- |")
  formatted = formatted.replace(/\|[ \t]*\|/g, '|\n|');

  // 3) Ajouter une ligne vide AVANT le début d'un tableau (seulement si la ligne précédente ne fait PAS partie du tableau)
  formatted = formatted.replace(/([^\n|])\n(\|[^\n]+\|)/g, '$1\n\n$2');

  // 4) Ajouter une ligne vide APRÈS la fin d'un tableau (seulement si la ligne suivante ne fait PAS partie du tableau)
  formatted = formatted.replace(/(\|[^\n]+\|)\n([^\n\|])/g, '$1\n\n$2');

  // 5) Supprimer les titres markdown excessifs (# ## ###) sauf en début de réponse
  formatted = formatted.replace(/\n#{1,6}\s+/g, '\n');

  // 6) Limiter les sauts de ligne consécutifs à 2 max
  formatted = formatted.replace(/\n{3,}/g, '\n\n');

  // 7) Supprimer les emojis de début de ligne si présente en double
  formatted = formatted.replace(/^📊\s*📊/gm, '📊');
  formatted = formatted.replace(/^📈\s*📈/gm, '📈');

  return formatted;
}

const markdownComponents = {
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="my-1 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1 ml-4 space-y-0.5 list-decimal">{children}</ol>,
  li: ({ children }) => <li className="ml-4 list-disc text-[13px]">{children}</li>,
  a: ({ href, children }) => (
    <a href={href} target={href?.startsWith('http') ? '_blank' : '_self'} rel="noreferrer" className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-primary/10 text-primary font-bold hover:underline transition-colors text-[11px]">
      {children}
    </a>
  ),
  code: ({ children, className }) => {
    if (className) return <code className={`${className} bg-surface-container-high px-1 rounded text-[12px]`}>{children}</code>;
    return <code className="bg-surface-container-high px-1 rounded text-[12px]">{children}</code>;
  },
  p: ({ children }) => <p className="mb-1.5 last:mb-0 leading-relaxed">{children}</p>,
  h1: ({ children }) => <h1 className="text-base font-bold mt-3 mb-1.5">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-bold mt-2 mb-1">{children}</h2>,
  h3: ({ children }) => <h3 className="text-xs font-bold mt-1.5 mb-1">{children}</h3>,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-primary/50 pl-2.5 italic text-on-surface-variant my-1 text-[12.5px]">{children}</blockquote>,
  table: ({ children }) => (
    <div className="overflow-x-auto my-2 rounded-xl border border-outline-variant/40 bg-surface-container/30 shadow-sm">
      <table className="w-full text-[12px] text-left border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-surface-container-high text-on-surface font-semibold border-b border-outline-variant/50">{children}</thead>
  ),
  tbody: ({ children }) => (
    <tbody className="divide-y divide-outline-variant/20">{children}</tbody>
  ),
  tr: ({ children }) => (
    <tr className="hover:bg-surface-container-high/40 transition-colors">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-3 py-2 font-bold text-on-surface border-r border-outline-variant/30 last:border-r-0 text-[11px] uppercase tracking-wider whitespace-nowrap">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 text-on-surface border-r border-outline-variant/20 last:border-r-0">{children}</td>
  ),
};

export default function MarkdownContent({ content }) {
  const formattedContent = preprocessMarkdown(content);
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {formattedContent}
    </ReactMarkdown>
  );
}
