const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Détermine le niveau de log selon NODE_ENV
const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '..', '..', 'logs');
const LOG_FILE_MAX_SIZE = 10 * 1024 * 1024; // 10 Mo par fichier
const LOG_FILE_MAX_FILES = 7; // rotation sur 7 fichiers

// Crée le dossier de logs s'il n'existe pas
if (!fs.existsSync(LOG_DIR)) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    // Ignoré — en lecture seule ou déjà existant
  }
}

// Formateur custom : timestamp + niveau + message + métadonnées
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format((info) => {
    // Normalise les messages d'erreur pour avoir un stack trace lisible
    if (info instanceof Error || info?.message instanceof Error) {
      const err = info.message instanceof Error ? info.message : info;
      info.message = err.message || String(err);
      info.stack = err.stack;
    }
    return info;
  })(),
);

// Format console : coloré, lisible en développement
const consoleFormat = winston.format.combine(
  logFormat,
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, requestId, ...metadata }) => {
    const reqId = requestId ? ` [${requestId}]` : '';
    const meta = Object.keys(metadata).length > 0 && metadata.stack
      ? `\n${metadata.stack}`
      : Object.keys(metadata).length > 0
        ? ` ${JSON.stringify(metadata)}`
        : '';
    return `${timestamp} ${level}${reqId}: ${message}${meta}`;
  }),
);

// Format fichier : JSON structuré, facile à parser (ELK, Grafana, etc.)
const fileFormat = winston.format.combine(
  logFormat,
  winston.format.json(),
);

const logger = winston.createLogger({
  level: LOG_LEVEL,
  transports: [
    // Console : toujours active
    new winston.transports.Console({
      format: consoleFormat,
    }),
    // Fichier d'erreurs : toujours actif
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: LOG_FILE_MAX_SIZE,
      maxFiles: LOG_FILE_MAX_FILES,
    }),
    // Fichier combiné (tous les niveaux) : désactivé en test pour éviter la pollution
    ...(process.env.NODE_ENV !== 'test'
      ? [
          new winston.transports.File({
            filename: path.join(LOG_DIR, 'combined.log'),
            format: fileFormat,
            maxsize: LOG_FILE_MAX_SIZE,
            maxFiles: LOG_FILE_MAX_FILES,
          }),
        ]
      : []),
  ],
});

// Crée un child logger avec un requestId pré-attaché, pour tracker une requête à travers
// toute la chaîne (middleware → routeur → service → base de données).
function childLogger(requestId) {
  return requestId ? logger.child({ requestId }) : logger;
}

module.exports = { logger, childLogger };
