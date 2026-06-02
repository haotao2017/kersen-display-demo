/**
 * DataHub field-mapping templates — persisted in localStorage.
 *
 * A template stores:
 *   mapping: { sourceColumnName → productFieldKey | '__skip__' }
 *
 * When a template is applied to a new dataset:
 *  - Columns whose names match the template get the saved mapping.
 *  - Unknown columns default to '__skip__'.
 */

export interface MappingTemplate {
  id: string;
  name: string;
  /** sourceColumnName → productFieldKey | '__skip__' */
  mapping: Record<string, string>;
  savedAt: string;
  /** number of non-skip mapped fields */
  fieldCount: number;
}

const KEY = 'datahub_mapping_templates_v1';

export function listTemplates(): MappingTemplate[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as MappingTemplate[];
  } catch {
    return [];
  }
}

export function saveTemplate(name: string, mapping: Record<string, string>): MappingTemplate {
  const all = listTemplates();
  const tpl: MappingTemplate = {
    id: `tpl_${Date.now()}`,
    name: name.trim(),
    mapping,
    savedAt: new Date().toISOString(),
    fieldCount: Object.values(mapping).filter(v => v !== '__skip__').length,
  };
  localStorage.setItem(KEY, JSON.stringify([tpl, ...all]));
  return tpl;
}

export function deleteTemplate(id: string): void {
  localStorage.setItem(KEY, JSON.stringify(listTemplates().filter(t => t.id !== id)));
}

/**
 * Apply a template to a new set of columns.
 * - Columns present in the template → use saved mapping.
 * - Columns NOT in the template → '__skip__'.
 */
export function applyTemplate(
  tpl: MappingTemplate,
  currentColumns: string[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const col of currentColumns) {
    result[col] = tpl.mapping[col] ?? '__skip__';
  }
  return result;
}
