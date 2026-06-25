import { motion } from 'framer-motion';

const variants = {
  initial: { opacity: 0, x: 24, filter: 'blur(4px)' },
  animate: { opacity: 1, x: 0,  filter: 'blur(0px)' },
  exit:    { opacity: 0, x: -16, filter: 'blur(4px)' },
};

const transition = {
  duration: 0.28,
  ease: [0.32, 0.72, 0, 1],
};

export default function PageTransition({ children }) {
  return (
    <motion.div
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={transition}
      style={{ willChange: 'transform, opacity' }}
    >
      {children}
    </motion.div>
  );
}
