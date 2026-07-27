import DOMPurify from 'dompurify';

DOMPurify.setConfig({
  ALLOWED_TAGS: [
    'p', 'br', 'b', 'i', 'u', 'em', 'strong', 'a', 'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'div', 'span',
    'img', 'sup', 'sub', 'dl', 'dt', 'dd',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'class', 'style', 'width', 'height', 'cid'],
  ALLOW_DATA_ATTR: false,
  ALLOWED_URI_REGEXP: /^(?:(?:https?|ftp|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
});

export function sanitizeHtml(html) {
  if (!html) return '';
  return DOMPurify.sanitize(html);
}
