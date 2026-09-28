import { Tooltip as RadixTooltip } from 'radix-ui';

/**
 * Tooltip — infobulle stylée (Radix) en remplacement des attributs `title=`
 * natifs (lents, non stylés, impossibles à positionner).
 *
 * Usage :
 *   <Tooltip content="Rechercher">
 *     <button …>…</button>
 *   </Tooltip>
 *
 * Le trigger est rendu via `asChild` : l'enfant doit accepter les refs
 * (boutons/éléments DOM, pas un fragment).
 */
export default function Tooltip({
  content,
  children,
  side = 'bottom',
  sideOffset = 6,
  className = '',
}) {
  if (!content) return children;

  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={sideOffset}
          className={`z-[100] max-w-xs rounded-lg border border-outline-variant/50 bg-surface-container-highest px-2.5 py-1.5 text-[11px] font-semibold text-on-surface shadow-lg data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 ${className}`}
        >
          {content}
          <RadixTooltip.Arrow className="fill-surface-container-highest" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

/** Provider global — monté une seule fois dans main.jsx. */
export function TooltipProvider({ children }) {
  return (
    <RadixTooltip.Provider delayDuration={250} skipDelayDuration={400}>
      {children}
    </RadixTooltip.Provider>
  );
}
