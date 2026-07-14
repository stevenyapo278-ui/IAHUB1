import { motion } from 'framer-motion';

/**
 * Variants directionnels — la page entre depuis la droite (forward) ou la gauche (back).
 * Combiné à un scale subtil pour un effet « depth » plus premium qu'un simple slide.
 *
 * direction = 1  → forward (clic lien) : entre par la droite, sort par la gauche
 * direction = -1 → backward (retour)   : entre par la gauche, sort par la droite
 */
const variants = {
  enter: {
    opacity: 0,
    y: 12,
    scale: 0.985,
  },
  center: {
    opacity: 1,
    y: 0,
    scale: 1,
  },
  exit: {
    opacity: 0,
    y: -12,
    scale: 0.985,
  },
};

const transition = {
  default: {
    duration: 0.3,
    ease: [0.22, 1, 0.36, 1],
  },
  opacity: {
    duration: 0.25,
    ease: [0.22, 1, 0.36, 1],
  },
};

export default function PageTransition({ children }) {
  return (
    <motion.div
      variants={variants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={transition}
      style={{ willChange: 'transform, opacity' }}
    >
      {children}
    </motion.div>
  );
}
