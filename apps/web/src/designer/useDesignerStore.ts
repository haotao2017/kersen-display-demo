import { create } from 'zustand';
import type { TemplateElement, TemplateSchema } from '../types/domain';
import { generateId } from '../utils/id';

interface DesignerState {
  schema: TemplateSchema | null;
  selectedElementId: string | null;
  selectedElementIds: string[];
  zoom: number;
  history: TemplateSchema[];
  future: TemplateSchema[];
  canUndo: boolean;
  canRedo: boolean;
  setSchema: (schema: TemplateSchema) => void;
  addElement: (element: TemplateElement) => void;
  updateElement: (id: string, patch: Partial<TemplateElement>) => void;
  updateElements: (patches: Array<{ id: string; patch: Partial<TemplateElement> }>) => void;
  removeElement: (id: string) => void;
  removeElements: (ids: string[]) => void;
  duplicateElement: (id: string) => void;
  duplicateElements: (ids: string[]) => void;
  bringForward: (id: string) => void;
  sendBackward: (id: string) => void;
  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;
  select: (id: string | null, options?: { append?: boolean; toggle?: boolean }) => void;
  setSelection: (ids: string[]) => void;
  undo: () => void;
  redo: () => void;
}

const cloneSchema = (schema: TemplateSchema) => ({
  ...schema,
  meta: { ...schema.meta },
  datasource: [...schema.datasource],
  elements: schema.elements.map((item) => ({ ...item, style: { ...item.style } })),
});

const commitSchema = (state: DesignerState, updater: (schema: TemplateSchema) => TemplateSchema) => {
  if (!state.schema) return state;
  const previous = cloneSchema(state.schema);
  const next = updater(previous);
  return {
    schema: next,
    history: [...state.history, previous],
    future: [],
    canUndo: true,
    canRedo: false,
  };
};

const normalizeZIndices = (elements: TemplateElement[]) =>
  elements.map((item, index) => ({ ...item, zIndex: index + 1, style: { ...item.style } }));

export const useDesignerStore = create<DesignerState>((set) => ({
  schema: null,
  selectedElementId: null,
  selectedElementIds: [],
  zoom: 1,
  history: [],
  future: [],
  canUndo: false,
  canRedo: false,
  setSchema: (schema) => set({ schema: cloneSchema(schema), selectedElementId: null, selectedElementIds: [], history: [], future: [], canUndo: false, canRedo: false }),
  addElement: (element) => set((state) => commitSchema(state, (schema) => ({
    ...schema,
    elements: [...schema.elements, element],
  }))),
  updateElement: (id, patch) => set((state) => commitSchema(state, (schema) => ({
    ...schema,
    elements: schema.elements.map((item) => item.id === id ? { ...item, ...patch, style: patch.style ? { ...item.style, ...patch.style } : item.style } : item),
  }))),
  updateElements: (patches) => set((state) => commitSchema(state, (schema) => {
    const patchMap = new Map(patches.map((item) => [item.id, item.patch]));
    return {
      ...schema,
      elements: schema.elements.map((item) => {
        const patch = patchMap.get(item.id);
        return patch ? { ...item, ...patch, style: patch.style ? { ...item.style, ...patch.style } : item.style } : item;
      }),
    };
  })),
  removeElement: (id) => set((state) => {
    const next = commitSchema(state, (schema) => ({
      ...schema,
      elements: schema.elements.filter((item) => item.id !== id),
    }));
    return {
      ...next,
      selectedElementId: state.selectedElementId === id ? null : state.selectedElementId,
      selectedElementIds: state.selectedElementIds.filter((item) => item !== id),
    };
  }),
  removeElements: (ids) => set((state) => {
    if (!ids.length) return state;
    const idSet = new Set(ids);
    const next = commitSchema(state, (schema) => ({
      ...schema,
      elements: schema.elements.filter((item) => !idSet.has(item.id)),
    }));
    return {
      ...next,
      selectedElementId: null,
      selectedElementIds: [],
    };
  }),
  duplicateElement: (id) => set((state) => {
    const source = state.schema?.elements.find((item) => item.id === id);
    if (!source) return state;
    const duplicated = {
      ...source,
      id: generateId(),
      x: source.x + 16,
      y: source.y + 16,
      zIndex: (state.schema?.elements.length ?? 0) + 1,
      style: { ...source.style },
    };
    const next = commitSchema(state, (schema) => ({
      ...schema,
      elements: [...schema.elements, duplicated],
    }));
    return { ...next, selectedElementId: duplicated.id, selectedElementIds: [duplicated.id] };
  }),
  duplicateElements: (ids) => set((state) => {
    if (!state.schema || !ids.length) return state;
    const selectedSet = new Set(ids);
    const sources = state.schema.elements
      .filter((item) => selectedSet.has(item.id))
      .sort((a, b) => a.zIndex - b.zIndex);
    if (!sources.length) return state;
    const baseZIndex = state.schema.elements.length;
    const duplicates = sources.map((source, index) => ({
      ...source,
      id: generateId(),
      x: source.x + 16,
      y: source.y + 16,
      zIndex: baseZIndex + index + 1,
      style: { ...source.style },
    }));
    const next = commitSchema(state, (schema) => ({
      ...schema,
      elements: [...schema.elements, ...duplicates],
    }));
    return {
      ...next,
      selectedElementId: duplicates[duplicates.length - 1]?.id ?? null,
      selectedElementIds: duplicates.map((item) => item.id),
    };
  }),
  bringForward: (id) => set((state) => commitSchema(state, (schema) => {
    const items = schema.elements.slice().sort((a, b) => a.zIndex - b.zIndex);
    const index = items.findIndex((item) => item.id === id);
    if (index < 0 || index === items.length - 1) return schema;
    [items[index], items[index + 1]] = [items[index + 1], items[index]];
    return { ...schema, elements: normalizeZIndices(items) };
  })),
  sendBackward: (id) => set((state) => commitSchema(state, (schema) => {
    const items = schema.elements.slice().sort((a, b) => a.zIndex - b.zIndex);
    const index = items.findIndex((item) => item.id === id);
    if (index <= 0) return schema;
    [items[index], items[index - 1]] = [items[index - 1], items[index]];
    return { ...schema, elements: normalizeZIndices(items) };
  })),
  bringToFront: (id) => set((state) => commitSchema(state, (schema) => {
    const items = schema.elements.slice().sort((a, b) => a.zIndex - b.zIndex);
    const index = items.findIndex((item) => item.id === id);
    if (index < 0 || index === items.length - 1) return schema;
    const [target] = items.splice(index, 1);
    items.push(target);
    return { ...schema, elements: normalizeZIndices(items) };
  })),
  sendToBack: (id) => set((state) => commitSchema(state, (schema) => {
    const items = schema.elements.slice().sort((a, b) => a.zIndex - b.zIndex);
    const index = items.findIndex((item) => item.id === id);
    if (index <= 0) return schema;
    const [target] = items.splice(index, 1);
    items.unshift(target);
    return { ...schema, elements: normalizeZIndices(items) };
  })),
  select: (selectedElementId, options) => set((state) => {
    if (!selectedElementId) return { selectedElementId: null, selectedElementIds: [] };
    if (options?.toggle) {
      const exists = state.selectedElementIds.includes(selectedElementId);
      const nextIds = exists
        ? state.selectedElementIds.filter((item) => item !== selectedElementId)
        : [...state.selectedElementIds, selectedElementId];
      return {
        selectedElementId: nextIds[nextIds.length - 1] ?? null,
        selectedElementIds: nextIds,
      };
    }
    if (options?.append) {
      const nextIds = state.selectedElementIds.includes(selectedElementId)
        ? state.selectedElementIds
        : [...state.selectedElementIds, selectedElementId];
      return {
        selectedElementId,
        selectedElementIds: nextIds,
      };
    }
    return { selectedElementId, selectedElementIds: [selectedElementId] };
  }),
  setSelection: (ids) => set({
    selectedElementId: ids[ids.length - 1] ?? null,
    selectedElementIds: ids,
  }),
  undo: () => set((state) => {
    if (!state.history.length || !state.schema) return state;
    const previous = state.history[state.history.length - 1];
    return {
      schema: cloneSchema(previous),
      history: state.history.slice(0, -1),
      future: [cloneSchema(state.schema), ...state.future],
      canUndo: state.history.length > 1,
      canRedo: true,
    };
  }),
  redo: () => set((state) => {
    if (!state.future.length || !state.schema) return state;
    const nextSchema = state.future[0];
    return {
      schema: cloneSchema(nextSchema),
      history: [...state.history, cloneSchema(state.schema)],
      future: state.future.slice(1),
      canUndo: true,
      canRedo: state.future.length > 1,
    };
  }),
}));
