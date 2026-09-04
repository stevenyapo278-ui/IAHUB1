import { motion } from 'framer-motion';

const EASE = [0.16, 1, 0.3, 1];

/**
 * FadeIn — Wrapper d'entrée animé pour les contenus de page.
 * Enveloppe un enfant unique pour le faire apparaître avec un fondu + slide-up.
 *
 * Props :
 *   delay    : délai avant l'animation (défaut: 0)
 *   y        : distance de slide en px (défaut: 12)
 *   children : contenu à animer
 */
export default function FadeIn({ delay = 0, y = 12, children, className, ...props }) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE, delay }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}
