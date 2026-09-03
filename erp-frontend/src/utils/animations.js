/**
 * Shared animation variants for Katalyst-style micro-interactions.
 * Import and use with <motion.div variants={...}> for consistent animations.
 */

/* ── Page-level entrance animations ─────────────────────────────────────────── */

/** Wrapper for stagger children — use on the parent container */
export const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.08,
    },
  },
};

/** Individual child fade + slide up — use on each direct child */
export const staggerItem = {
  hidden: { opacity: 0, y: 14 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.35,
      ease: [0.25, 0.46, 0.45, 0.94],
    },
  },
};

/** Simple fade in */
export const fadeIn = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.15, ease: [0.4, 0, 1, 1] },
  },
};

/** Fade in + scale up (for modals, dialogs) */
export const scaleIn = {
  hidden: { opacity: 0, scale: 0.95, y: 8 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: 'spring', damping: 25, stiffness: 300 },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 8,
    transition: { duration: 0.15, ease: [0.4, 0, 1, 1] },
  },
};

/** Slide up entrance (for cards, panels) */
export const slideUp = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: { duration: 0.2, ease: [0.4, 0, 1, 1] },
  },
};

/** Slide in from left (for sidebars, drawers) */
export const slideInLeft = {
  hidden: { opacity: 0, x: -24 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] },
  },
  exit: {
    opacity: 0,
    x: -24,
    transition: { duration: 0.2, ease: [0.4, 0, 1, 1] },
  },
};

/** Backdrop fade (for overlay/modal backdrops) */
export const backdropFade = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

/* ── Micro-interaction props ────────────────────────────────────────────────── */

/** Button press feedback */
export const buttonPress = {
  whileHover: { scale: 1.02 },
  whileTap: { scale: 0.97 },
  transition: { type: 'spring', stiffness: 400, damping: 20 },
};

/** Card hover lift */
export const cardHover = {
  whileHover: { y: -2, transition: { duration: 0.2 } },
};

/** Icon spin (for refresh/sync buttons) */
export const iconSpin = {
  animate: { rotate: 360 },
  transition: { repeat: Infinity, duration: 1, ease: 'linear' },
};
