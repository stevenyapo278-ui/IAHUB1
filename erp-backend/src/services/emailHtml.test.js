const mockTicketAttachmentFindMany = jest.fn();
const mockIncomingEmailFindMany = jest.fn();
const mockGetSystemSettings = jest.fn();

jest.mock('../prismaClient', () => ({
  ticketAttachment: { findMany: (...args) => mockTicketAttachmentFindMany(...args) },
  incomingEmail: { findMany: (...args) => mockIncomingEmailFindMany(...args) },
}));

jest.mock('./systemSettings', () => ({
  getSystemSettings: (...args) => mockGetSystemSettings(...args),
}));

const fs = require('fs');
const path = require('path');
const {
  toPublicUploadUrl,
  normalizeUploadUrls,
  cidCandidates,
  applyCidMap,
  cleanupImgTags,
  resolveHtml,
  loadCidMap,
  resolveEmailHtml,
  resolveMessagesHtml,
} = require('./emailHtml');

// Fichiers réels : le nettoyage supprime les <img> dont le fichier n'existe pas sur le disque,
// donc les cas « conservé » doivent pointer vers des fichiers réellement présents.
const TMP_IMG = path.join(process.cwd(), 'uploads', 'emailhtml-test-tmp.png');
const TMP_ATT = path.join(process.cwd(), 'uploads', 'attachments', 'emailhtml-test-att.png');
const TMP_LOGO = path.join(process.cwd(), 'uploads', 'signature-logo', 'emailhtml-test-logo.png');
const TMP_URL = '/uploads/emailhtml-test-tmp.png';
const TMP_ATT_URL = '/uploads/attachments/emailhtml-test-att.png';
const TMP_LOGO_URL = '/uploads/signature-logo/emailhtml-test-logo.png';

const createdFiles = [];

function touch(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  createdFiles.push(filePath);
}

beforeAll(() => {
  touch(TMP_IMG);
  touch(TMP_ATT);
  touch(TMP_LOGO);
});

afterAll(() => {
  for (const file of createdFiles) {
    try { fs.unlinkSync(file); } catch { /* déjà supprimé */ }
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  mockIncomingEmailFindMany.mockResolvedValue([]);
  mockTicketAttachmentFindMany.mockResolvedValue([]);
  mockGetSystemSettings.mockResolvedValue({ signatureLogos: [], signatureLogoUrl: null });
});

describe('toPublicUploadUrl', () => {
  it('convertit un chemin absolu du conteneur', () => {
    expect(toPublicUploadUrl('/app/erp-backend/uploads/attachments/a.png')).toBe('/uploads/attachments/a.png');
  });

  it('convertit un chemin relatif', () => {
    expect(toPublicUploadUrl('uploads/attachments/a.png')).toBe('/uploads/attachments/a.png');
  });

  it('ignore un chemin hors uploads', () => {
    expect(toPublicUploadUrl('/var/data/a.png')).toBe(null);
    expect(toPublicUploadUrl(null)).toBe(null);
  });
});

describe('normalizeUploadUrls', () => {
  it('réécrit une URL absolue HTTP en relative (mixed content)', () => {
    expect(normalizeUploadUrls('<img src="http://192.168.1.10:4000/uploads/a.png">'))
      .toBe('<img src="/uploads/a.png">');
  });

  it('réécrit une URL localhost en relative', () => {
    expect(normalizeUploadUrls('https://localhost:4000/uploads/b.png')).toBe('/uploads/b.png');
    expect(normalizeUploadUrls('http://127.0.0.1/uploads/c.png')).toBe('/uploads/c.png');
  });

  it('conserve les URL d un autre hote en HTTPS', () => {
    expect(normalizeUploadUrls('https://cdn.example.com/uploads/d.png')).toBe('https://cdn.example.com/uploads/d.png');
    expect(normalizeUploadUrls('https://cdn.example.com/logo.png')).toBe('https://cdn.example.com/logo.png');
  });
});

describe('cidCandidates', () => {
  it('retire les chevrons et met en minuscules', () => {
    expect(cidCandidates('<Image001.PNG>')).toEqual(['image001.png']);
  });

  it('propose la partie avant @ (cid opaque Outlook)', () => {
    expect(cidCandidates('image001.7d3c@corp.local')).toEqual(['image001.7d3c@corp.local', 'image001.7d3c']);
  });
});

describe('applyCidMap', () => {
  it('résout insensible a la casse et avec chevrons', () => {
    const map = new Map([['image001.png', '/uploads/attachments/1-image001.png']]);
    expect(applyCidMap('<img src="cid:Image001.PNG">', map))
      .toBe('<img src="/uploads/attachments/1-image001.png">');
    expect(applyCidMap('<img src="cid:<image001.png>">', map))
      .toBe('<img src="/uploads/attachments/1-image001.png">');
  });

  it('résout un cid opaque via la clé avant @', () => {
    const map = new Map([['image001.7d3c', '/uploads/attachments/2-capture.png']]);
    expect(applyCidMap('<img src="cid:image001.7d3c@corp.local">', map))
      .toBe('<img src="/uploads/attachments/2-capture.png">');
  });

  it('laisse tel quel un cid inconnu', () => {
    expect(applyCidMap('<img src="cid:missing@x">', new Map())).toContain('cid:missing@x');
  });
});

describe('cleanupImgTags', () => {
  it('retire les <img> dont le cid n a pas ete resolu', () => {
    expect(cleanupImgTags('<p>ok</p><img src="cid:missing@x" alt="x">'))
      .toBe('<p>ok</p>');
  });

  it('retire les <img> srcset contenant un cid', () => {
    expect(cleanupImgTags('<img srcset="cid:a.png 2x" src="https://x/y.png">')).toBe('');
  });

  it('retire un /uploads dont le fichier est absent du disque', () => {
    expect(cleanupImgTags('<img src="/uploads/attachments/inexistant.png">')).toBe('');
  });

  it('conserve un /uploads existant et une image distante', () => {
    const html = `<img src="${TMP_URL}"><img src="https://cdn.example.com/p.png">`;
    expect(cleanupImgTags(html)).toBe(html);
  });
});

describe('resolveHtml', () => {
  it('resout le cid, normalise l URL puis supprime ce qui reste casse', () => {
    const map = new Map([['logo-signature', TMP_LOGO_URL]]);
    const html = '<p>x</p><img src="cid:logo-signature"><img src="cid:other"><img src="http://10.0.0.5/uploads/a.png">';
    const out = resolveHtml(html, map);
    expect(out).toContain(`src="${TMP_LOGO_URL}"`);
    expect(out).not.toContain('cid:other');
    expect(out).not.toContain('http://10.0.0.5');
  });
});

describe('loadCidMap', () => {
  it('indexe les fichiers des pieces jointes et les logos de signature', async () => {
    mockTicketAttachmentFindMany.mockResolvedValue([
      { filename: 'capture.png', localFilepath: '/app/erp-backend/uploads/attachments/9-capture.png' },
    ]);
    mockGetSystemSettings.mockResolvedValue({
      signatureLogos: [
        { url: 'https://ci.example.com/uploads/signature-logo/a.png' },
        { url: 'https://ci.example.com/uploads/signature-logo/b.png' },
      ],
    });

    const map = await loadCidMap({ ticketIds: [7], incomingEmailIds: [] });

    expect(map.get('capture.png')).toBe('/uploads/attachments/9-capture.png');
    expect(map.get('capture')).toBe('/uploads/attachments/9-capture.png');
    expect(map.get('logo-signature')).toBe('/uploads/signature-logo/a.png');
    expect(map.get('logo-signature-1')).toBe('/uploads/signature-logo/b.png');
    expect(mockIncomingEmailFindMany).toHaveBeenCalled();
  });

  it('ne requete pas les emails lies si aucun ticket', async () => {
    await loadCidMap({ ticketIds: [], incomingEmailIds: [3] });
    expect(mockIncomingEmailFindMany).not.toHaveBeenCalled();
  });
});

describe('resolveEmailHtml', () => {
  it('remplace la signature cid par le fichier de signature', async () => {
    mockGetSystemSettings.mockResolvedValue({
      signatureLogos: [{ url: 'http://localhost:4000/uploads/signature-logo/emailhtml-test-logo.png' }],
    });
    const out = await resolveEmailHtml('<b>ok</b><img src="cid:logo-signature">', { incomingEmailIds: [1] });
    expect(out).toBe(`<b>ok</b><img src="${TMP_LOGO_URL}">`);
  });

  it('supprime l image inline si aucune piece jointe en base', async () => {
    const out = await resolveEmailHtml('<p>salut</p><img src="cid:image001@corp">', { ticketId: 5 });
    expect(out).toBe('<p>salut</p>');
  });
});

describe('resolveMessagesHtml', () => {
  it('resout tous les bodyHtml en une seule passe', async () => {
    mockTicketAttachmentFindMany.mockResolvedValue([
      { filename: 'emailhtml-test-att.png', localFilepath: 'uploads/attachments/emailhtml-test-att.png' },
    ]);
    const messages = [
      { id: 1, kind: 'inbound', emailId: 11, bodyHtml: '<img src="cid:emailhtml-test-att.png">' },
      { id: 2, kind: 'sent', ticketId: 4, bodyHtml: '<p>sans image</p>' },
      { id: 3, kind: 'sent', ticketId: 4, bodyHtml: null },
    ];
    await resolveMessagesHtml(messages, { ticketId: 4 });
    expect(messages[0].bodyHtml).toBe(`<img src="${TMP_ATT_URL}">`);
    expect(messages[1].bodyHtml).toBe('<p>sans image</p>');
    expect(mockTicketAttachmentFindMany).toHaveBeenCalledTimes(1);
  });
});
