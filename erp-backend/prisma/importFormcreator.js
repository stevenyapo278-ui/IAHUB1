const fs = require('fs');
const path = require('path');
const prisma = require('../src/prismaClient');

async function importForm() {
  // Try multiple paths (local + docker)
  let raw = null;
  for (const p of [path.join(__dirname, '../../export_formcreator_20260922_1611.json'), '/tmp/form.json', '/app/export_formcreator_20260922_1611.json']) {
    try { raw = fs.readFileSync(p, 'utf8'); break; } catch {}
  }
  if (!raw) throw new Error('JSON not found');
  const data = JSON.parse(raw);

  for (const form of data.forms) {
    const sections = form._sections.map((sec) => ({
      name: sec.name,
      order: sec.order,
      uuid: sec.uuid,
      showRule: sec.show_rule,
      questions: sec._questions.map((q) => ({
        name: q.name,
        fieldtype: q.fieldtype,
        required: !!q.required,
        showEmpty: !!q.show_empty,
        defaultValues: q.default_values,
        values: q.values,
        description: q.description || '',
        row: q.row,
        col: q.col,
        width: q.width,
        uuid: q.uuid,
        showRule: q.show_rule,
      })),
    }));

    const existing = await prisma.formDefinition.findUnique({ where: { glpiUuid: form.uuid } });
    if (existing) {
      await prisma.formDefinition.update({
        where: { glpiUuid: form.uuid },
        data: {
          name: form.name.trim(),
          description: form.description || null,
          icon: form.icon || null,
          iconColor: form.icon_color || null,
          bgColor: form.background_color || null,
          category: form._plugin_formcreator_category || null,
          sections,
        },
      });
      console.log(`Updated: ${form.name.trim()}`);
    } else {
      await prisma.formDefinition.create({
        data: {
          name: form.name.trim(),
          description: form.description || null,
          icon: form.icon || null,
          iconColor: form.icon_color || null,
          bgColor: form.background_color || null,
          category: form._plugin_formcreator_category || null,
          glpiUuid: form.uuid,
          sections,
        },
      });
      console.log(`Created: ${form.name.trim()}`);
    }
  }
  console.log('Import terminé.');
}

importForm().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
