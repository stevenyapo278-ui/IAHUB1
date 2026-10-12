const { sanitizeTicketHtml } = require('./security');

describe('sanitizeTicketHtml — protocoles dangereux (audit images, point 1)', () => {
  test('supprime javascript: dans href entre guillemets doubles', () => {
    const out = sanitizeTicketHtml('<a href="javascript:alert(1)">k</a>');
    expect(out).not.toMatch(/javascript:/i);
  });

  test('supprime javascript: dans href sans guillemets', () => {
    const out = sanitizeTicketHtml('<a href=javascript:alert(1)>k</a>');
    expect(out).not.toMatch(/javascript:/i);
  });

  test("supprime data: non image dans <img src> (c'était annoncé mais non appliqué)", () => {
    const out = sanitizeTicketHtml('<img src="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">');
    expect(out).not.toMatch(/data:/i);
    expect(out).not.toMatch(/<script/i);
  });

  test('supprime data: dans href', () => {
    const out = sanitizeTicketHtml('<a href="data:text/html,<script>alert(1)</script>">k</a>');
    expect(out).not.toMatch(/data:/i);
    expect(out).not.toMatch(/<script/i);
  });

  test('conserve une image raster data:image/png collée dans un <img>', () => {
    const out = sanitizeTicketHtml('<img src="data:image/png;base64,iVBORw0KGgo=" alt="capture">');
    expect(out).toContain('data:image/png;base64,iVBORw0KGgo=');
  });

  test('conserve les images /uploads/ et cid: existantes', () => {
    expect(sanitizeTicketHtml('<img src="/uploads/attachments/a.png" alt="">')).toContain('/uploads/attachments/a.png');
    expect(sanitizeTicketHtml('<img src="cid:abc@x" alt="">')).toContain('cid:abc@x');
  });

  test('retire les event handlers et les balises dangereuses', () => {
    const out = sanitizeTicketHtml('<p onclick="evil()">ok</p><script>evil()</script><iframe src="x"></iframe>');
    expect(out).not.toMatch(/onclick/i);
    expect(out).not.toMatch(/<script|<iframe/i);
  });
});
