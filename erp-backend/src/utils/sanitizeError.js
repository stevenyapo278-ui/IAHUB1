function sanitizeError(err) {
  if (process.env.NODE_ENV === 'production') {
    return 'Erreur interne du serveur';
  }
  return err.message || 'Erreur inconnue';
}

module.exports = { sanitizeError };
