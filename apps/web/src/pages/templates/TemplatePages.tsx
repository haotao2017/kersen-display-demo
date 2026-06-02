import { AppstoreOutlined, BgColorsOutlined, CopyOutlined, DeleteOutlined, PlusOutlined, RedoOutlined, ToTopOutlined, UndoOutlined, VerticalAlignBottomOutlined, VerticalAlignTopOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons';
import { App, Button, Card, Checkbox, Col, Descriptions, Divider, Form, Image, Input, InputNumber, List, Modal, Row, Select, Space, Table, Tag, Tooltip, Typography, Upload, message as globalMessage } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stage, Layer, Rect, Text, Image as KonvaImage, Transformer, Line, Group } from 'react-konva';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { UploadProps } from 'antd';
import { api } from '../../api';
import { useAppStore } from '../../app/store';
import { PageHeaderCard } from '../../components/common/PageHeaderCard';
import { useDesignerStore } from '../../designer/useDesignerStore';
import { useI18n } from '../../i18n';
import type { TemplateElement, TemplateSchema } from '../../types/domain';
import { API_BASE_URL, queryKeys } from '../../utils/constants';
import { generateId } from '../../utils/id';

const SAMPLE_IMAGE_URL = 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=640&q=80';
const ESL_SCREEN_PRESETS = [
  { id: 'esl-03-128x250', width: 250, height: 128, inch: '2.13', colorMode: 'bwry' as const },
  { id: 'esl-03-02-128x296', width: 296, height: 128, inch: '2.9', colorMode: 'bwry' as const },
  { id: 'esl-03-02-152x296', width: 296, height: 152, inch: '2.66', colorMode: 'bwry' as const },
  { id: 'esl-03-02-200x200', width: 200, height: 200, inch: '1.54', colorMode: 'bwry' as const },
  { id: 'esl-03-04-240x416', width: 416, height: 240, inch: '3.7', colorMode: 'bwry' as const },
  { id: 'esl-03-03-184x384', width: 384, height: 184, inch: '4.2', colorMode: 'bwry' as const },
  { id: 'esl-03-04-400x300', width: 400, height: 300, inch: '4.2', colorMode: 'bwry' as const },
  { id: 'esl-03-0a-648x480', width: 648, height: 480, inch: '5.83', colorMode: 'bwry' as const },
  { id: 'esl-0c-800x480', width: 800, height: 480, inch: '7.5', colorMode: 'bwry' as const },
];
const DEFAULT_SCREEN_PRESET = ESL_SCREEN_PRESETS.find((item) => item.id === 'esl-03-02-152x296') ?? ESL_SCREEN_PRESETS[0];
const formatScreenSize = (preset: Pick<typeof ESL_SCREEN_PRESETS[number], 'width' | 'height'> & { inch?: string }) => (
  preset.inch ? `${preset.inch}" · ${preset.width}×${preset.height}` : `${preset.width}×${preset.height}`
);
const formatTemplateScreenSize = (value?: { deviceType?: unknown; width?: unknown; height?: unknown } | null) => {
  const preset = findScreenPreset(value);
  return formatScreenSize({
    inch: preset.inch,
    width: Number(value?.width ?? preset.width),
    height: Number(value?.height ?? preset.height),
  });
};
const SCREEN_PRESET_OPTIONS = Array.from(
  new Map(ESL_SCREEN_PRESETS.map((item) => [`${item.width}x${item.height}`, item])).values(),
).map((item) => ({ label: formatScreenSize(item), value: item.id }));
const DEFAULT_COLOR_MODE: TemplateSchema['meta']['colorMode'] = 'bwr';
const COLOR_MODE_OPTIONS = [
  { label: '2色（黑白）', value: 'bw' },
  { label: '3色（黑白红）', value: 'bwr' },
  { label: '4色（黑白红黄）', value: 'bwry' },
] as const;

const normalizeColorMode = (value: unknown): TemplateSchema['meta']['colorMode'] => (
  value === 'bw' || value === 'bwr' || value === 'bwry' ? value : DEFAULT_COLOR_MODE
);

const findScreenPreset = (value?: { deviceType?: unknown; width?: unknown; height?: unknown } | null) => {
  const deviceType = String(value?.deviceType ?? '').toLowerCase();
  const byDeviceType = deviceType
    ? ESL_SCREEN_PRESETS.find((item) => item.id === deviceType || item.id.toUpperCase() === String(value?.deviceType ?? '').toUpperCase())
    : undefined;
  if (byDeviceType) return byDeviceType;

  const width = Number(value?.width);
  const height = Number(value?.height);
  return ESL_SCREEN_PRESETS.find((item) => (
    (item.width === width && item.height === height)
    || (item.width === height && item.height === width)
  )) ?? DEFAULT_SCREEN_PRESET;
};

const DESIGNER_COLOR_SWATCHES = [
  { key: 'black', value: '#111111' },
  { key: 'white', value: '#ffffff' },
  { key: 'red', value: '#ef2b2d' },
  { key: 'yellow', value: '#ffe100' },
];

const DESIGNER_TOOL_GROUPS = [
  {
    key: 'basic',
    items: [
      { type: 'text', key: 'text', size: { width: 160, height: 28 } },
      { type: 'price', key: 'price', size: { width: 140, height: 40 } },
      { type: 'label', key: 'label', size: { width: 120, height: 28 } },
      { type: 'image', key: 'image', size: { width: 120, height: 90 } },
      { type: 'barcode', key: 'barcode', size: { width: 160, height: 48 } },
      { type: 'qrcode', key: 'qrcode', size: { width: 96, height: 96 } },
    ],
  },
  {
    key: 'drawing',
    items: [
      { type: 'rect', key: 'rect', size: { width: 120, height: 60 } },
      { type: 'line', key: 'line', size: { width: 140, height: 2 } },
    ],
  },
];

const PRODUCT_BINDING_FIELDS = [
  { id: '#sourceId', key: 'sourceId' },
  { id: '#name', key: 'name' },
  { id: '#subName', key: 'subName' },
  { id: '#specification', key: 'specification' },
  { id: '#unit', key: 'unit' },
  { id: '#brand', key: 'brand' },
  { id: '#reference', key: 'reference' },
  { id: '#field1', key: 'field1' },
  { id: '#originalPrice', key: 'originalPrice' },
  { id: '#memberPrice', key: 'memberPrice' },
  { id: '#field2', key: 'field2' },
  { id: '#promotionText', key: 'promotionText' },
  ...Array.from({ length: 22 }, (_, index) => ({
    id: `#customField${index + 1}`,
    key: `customField${index + 1}`,
  })),
] as const;

const BINDABLE_ELEMENT_TYPES: TemplateElement['type'][] = ['text', 'price', 'barcode', 'qrcode', 'label'];

const isBackgroundImageElement = (
  element: TemplateElement,
  meta: { width: number; height: number },
) => (
  element.type === 'image'
  && element.x === 0
  && element.y === 0
  && element.width === meta.width
  && element.height === meta.height
  && (element.zIndex ?? 0) <= 1
);

const getTemplatePreviewFocus = (schema?: TemplateSchema | null) => {
  const meta = schema?.meta;
  const canvasWidth = Number(meta?.width ?? 0);
  const canvasHeight = Number(meta?.height ?? 0);

  if (!canvasWidth || !canvasHeight) {
    return { canvasWidth: 0, canvasHeight: 0, cropX: 0, cropY: 0, cropWidth: 0, cropHeight: 0 };
  }

  const visibleElements = (schema?.elements ?? []).filter((element) => element.visible !== false);
  const contentElements = visibleElements.filter((element) => !isBackgroundImageElement(element, { width: canvasWidth, height: canvasHeight }));

  if (!contentElements.length) {
    return {
      canvasWidth,
      canvasHeight,
      cropX: 0,
      cropY: 0,
      cropWidth: canvasWidth,
      cropHeight: canvasHeight,
    };
  }

  const left = Math.min(...contentElements.map((element) => element.x));
  const top = Math.min(...contentElements.map((element) => element.y));
  const right = Math.max(...contentElements.map((element) => element.x + element.width));
  const bottom = Math.max(...contentElements.map((element) => element.y + element.height));
  const padding = Math.max(16, Math.round(Math.min(canvasWidth, canvasHeight) * 0.08));
  const cropX = Math.max(0, left - padding);
  const cropY = Math.max(0, top - padding);
  const cropRight = Math.min(canvasWidth, right + padding);
  const cropBottom = Math.min(canvasHeight, bottom + padding);

  return {
    canvasWidth,
    canvasHeight,
    cropX,
    cropY,
    cropWidth: Math.max(1, cropRight - cropX),
    cropHeight: Math.max(1, cropBottom - cropY),
  };
};

const hasUsableFullBleedBackground = (schema?: TemplateSchema | null) => {
  const meta = schema?.meta;
  const canvasWidth = Number(meta?.width ?? 0);
  const canvasHeight = Number(meta?.height ?? 0);
  if (!canvasWidth || !canvasHeight) return false;

  return (schema?.elements ?? []).some((element) => (
    element.visible !== false
    && isBackgroundImageElement(element, { width: canvasWidth, height: canvasHeight })
    && typeof element.expression === 'string'
    && element.expression.trim().length > 0
  ));
};

const getTemplateBackgroundImageUrl = (schema?: TemplateSchema | null) => {
  const meta = schema?.meta;
  const canvasWidth = Number(meta?.width ?? 0);
  const canvasHeight = Number(meta?.height ?? 0);
  if (!canvasWidth || !canvasHeight) return '';

  const background = [...(schema?.elements ?? [])].reverse().find((element) => (
    element.visible !== false
    && isBackgroundImageElement(element, { width: canvasWidth, height: canvasHeight })
    && typeof element.expression === 'string'
    && element.expression.trim().length > 0
  ));
  return String(background?.expression ?? '').trim();
};

const TemplatePreviewThumbnail = ({
  previewImageUrl,
  name,
  schema,
}: {
  previewImageUrl?: string;
  name: string;
  schema?: TemplateSchema | null;
}) => {
  const frameWidth = 96;
  const frameHeight = 64;
  const [previewFailed, setPreviewFailed] = useState(false);
  const backgroundImageUrl = getTemplateBackgroundImageUrl(schema);
  const displayImageUrl = previewFailed && backgroundImageUrl ? backgroundImageUrl : previewImageUrl;

  useEffect(() => {
    setPreviewFailed(false);
  }, [previewImageUrl, backgroundImageUrl]);

  if (!displayImageUrl) {
    return (
      <div
        style={{
          width: frameWidth,
          height: frameHeight,
          borderRadius: 10,
          border: '1px solid #ececec',
          background: 'linear-gradient(135deg, #f7f7f7, #ececec)',
          color: '#9aa3af',
          display: 'grid',
          placeItems: 'center',
          fontSize: 12,
        }}
      >
        N/A
      </div>
    );
  }

  return (
    <div
      style={{
        width: frameWidth,
        height: frameHeight,
        borderRadius: 10,
        border: '1px solid #ececec',
        background: '#fff',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <img
        src={resolveDesignerAssetUrl(displayImageUrl)}
        alt={name}
        onError={() => setPreviewFailed(true)}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          objectFit: 'contain',
        }}
      />
    </div>
  );
};

const ensureDesignerSchema = (schema: any) => {
  const elements = Array.isArray(schema?.elements) ? schema.elements : [];
  return {
    ...schema,
    elements,
  };
};

const sanitizeDesignerSchema = (schema: any) => {
  const elements = Array.isArray(schema?.elements) ? schema.elements : [];
  const meta = schema?.meta ?? {};
  const width = Number(meta.width ?? 0);
  const height = Number(meta.height ?? 0);

  if (!width || !height) {
    return ensureDesignerSchema(schema);
  }

  const backgroundCandidates = elements.filter((item: any) => isBackgroundImageElement(item, { width, height }));
  if (!backgroundCandidates.length) {
    return ensureDesignerSchema(schema);
  }
  if (backgroundCandidates.length <= 1) {
    return schema;
  }

  const preferredBackground =
    [...backgroundCandidates].reverse().find((item: any) => String(item?.expression ?? '').trim() && String(item?.expression ?? '').trim() !== SAMPLE_IMAGE_URL)
    ?? backgroundCandidates[backgroundCandidates.length - 1];

  const dedupedElements = elements.filter((item: any) => !backgroundCandidates.includes(item) || item === preferredBackground)
    .map((item: any) => (
      item === preferredBackground
        ? {
            ...item,
            zIndex: 1,
          }
        : item
    ));

  return {
    ...schema,
    elements: dedupedElements,
  };
};

const resizeDesignerSchema = (
  schema: TemplateSchema,
  preset: typeof ESL_SCREEN_PRESETS[number],
  colorMode = normalizeColorMode(schema.meta.colorMode),
): TemplateSchema => {
  const oldWidth = Number(schema.meta.width || preset.width) || preset.width;
  const oldHeight = Number(schema.meta.height || preset.height) || preset.height;
  const scaleX = preset.width / oldWidth;
  const scaleY = preset.height / oldHeight;
  return {
    ...schema,
      meta: {
        ...schema.meta,
        deviceType: preset.id.toUpperCase(),
        width: preset.width,
        height: preset.height,
        colorMode,
    },
    elements: schema.elements.map((element) => {
      const isBackground = isBackgroundImageElement(element, { width: oldWidth, height: oldHeight });
      if (isBackground) {
        return {
          ...element,
          x: 0,
          y: 0,
          width: preset.width,
          height: preset.height,
          zIndex: 1,
        };
      }
      return {
        ...element,
        x: snapValue(Math.round(element.x * scaleX)),
        y: snapValue(Math.round(element.y * scaleY)),
        width: Math.max(1, snapValue(Math.round(element.width * scaleX))),
        height: Math.max(1, snapValue(Math.round(element.height * scaleY))),
      };
    }),
  };
};

const applyScreenPresetToSchema = (
  schema: TemplateSchema | null,
  preset: typeof ESL_SCREEN_PRESETS[number],
  colorMode = normalizeColorMode(schema?.meta.colorMode),
) => {
  if (!schema) return schema;
  if (schema.meta.width === preset.width && schema.meta.height === preset.height) {
    return {
      ...schema,
      meta: {
        ...schema.meta,
        deviceType: preset.id.toUpperCase(),
        colorMode,
      },
    };
  }
  return resizeDesignerSchema(schema, preset, colorMode);
};

const createDesignerElement = (
  type: TemplateElement['type'],
  index: number,
  canvas?: { width: number; height: number },
): TemplateElement => {
  const defaults = {
    id: generateId(),
    type,
    x: 18 + (index % 3) * 18,
    y: 18 + index * 18,
    width: 120,
    height: 28,
    rotate: 0,
    visible: true,
    zIndex: index + 1,
    bindingField: null,
    expression: null,
    style: {
      fontSize: 14,
      fontWeight: 'normal',
      textAlign: 'left',
      fill: '#111111',
      stroke: '#111111',
      background: '#ffffff',
    },
  } satisfies TemplateElement;

  if (type === 'price') {
    return {
      ...defaults,
      width: 140,
      height: 40,
      bindingField: '#field2',
      expression: '99.00',
      style: { ...defaults.style, fontSize: 26, fontWeight: 'bold', autoSize: false, textOverflow: 'clip' },
    };
  }
  if (type === 'text') {
    return { ...defaults, width: 160, bindingField: '#name', expression: 'Text', style: { ...defaults.style, autoSize: false, textOverflow: 'clip' } };
  }
  if (type === 'label') {
    return { ...defaults, width: 120, expression: 'Label', style: { ...defaults.style, autoSize: false, textOverflow: 'clip' } };
  }
  if (type === 'image') {
    return {
      ...defaults,
      x: 0,
      y: 0,
      width: canvas?.width ?? 120,
      height: canvas?.height ?? 90,
      bindingField: null,
      expression: null,
      style: { ...defaults.style, stroke: '#d0d0d0' },
    };
  }
  if (type === 'barcode') {
    return {
      ...defaults,
      width: 160,
      height: 48,
      bindingField: '#reference',
      expression: '6901234567890',
      style: { ...defaults.style, fontSize: 12, textAlign: 'center' },
    };
  }
  if (type === 'qrcode') {
    return {
      ...defaults,
      width: 96,
      height: 96,
      expression: 'QR',
      style: { ...defaults.style, textAlign: 'center' },
    };
  }
  if (type === 'rect') {
    return {
      ...defaults,
      width: 120,
      height: 60,
      style: { ...defaults.style, fill: '#ffffff', stroke: '#111111' },
    };
  }
  if (type === 'line') {
    return {
      ...defaults,
      width: 140,
      height: 2,
      style: { ...defaults.style, stroke: '#111111' },
    };
  }
  return defaults;
};

const DESIGNER_GRID_SIZE = 4;
const TEXT_PADDING_X = 4;
const TEXT_LINE_HEIGHT = 1.18;

const snapValue = (value: number, size = DESIGNER_GRID_SIZE) => Math.round(value / size) * size;

const TEXT_ELEMENT_TYPES: TemplateElement['type'][] = ['text', 'price', 'label'];

const isTextElement = (element: TemplateElement) => TEXT_ELEMENT_TYPES.includes(element.type);

const getElementPreviewText = (element: TemplateElement) => {
  const rawText = String(element.expression ?? element.bindingField ?? element.type);
  return element.type === 'price' && !rawText.trim().startsWith('￥') ? `￥${rawText}` : rawText;
};

const measureDesignerText = (element: TemplateElement, text = getElementPreviewText(element)) => {
  const fontSize = Math.max(1, Number(element.style.fontSize ?? (element.type === 'price' ? 26 : 14)));
  const fontWeight = String(element.style.fontWeight) === 'bold' ? '700' : '400';
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    return {
      width: Math.max(1, Math.ceil(text.length * fontSize * 0.62 + TEXT_PADDING_X * 2)),
      height: Math.max(1, Math.ceil(fontSize * TEXT_LINE_HEIGHT)),
    };
  }
  context.font = `${fontWeight} ${fontSize}px Arial, "Microsoft YaHei", sans-serif`;
  const lines = text.split(/\r?\n/);
  const measuredWidth = Math.max(1, ...lines.map((line) => context.measureText(line || ' ').width));
  return {
    width: Math.ceil(measuredWidth + TEXT_PADDING_X * 2),
    height: Math.ceil(lines.length * fontSize * TEXT_LINE_HEIGHT),
  };
};

const applyTextAutoSize = (element: TemplateElement): Partial<TemplateElement> => {
  const size = measureDesignerText(element);
  return {
    width: Math.max(1, snapValue(size.width)),
    height: Math.max(1, snapValue(size.height)),
  };
};

const hashDesignerText = (value: string) => {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const getDesignerBarcodeBars = (text: string) => {
  const source = text.trim() || 'barcode';
  const bars = [
    { width: 2, gap: 1 },
    { width: 1, gap: 1 },
    { width: 1, gap: 2 },
  ];
  for (const [index, char] of [...source].entries()) {
    const code = char.charCodeAt(0) + index * 17;
    bars.push({ width: code % 4 === 0 ? 3 : code % 3 === 0 ? 2 : 1, gap: code % 5 === 0 ? 2 : 1 });
    bars.push({ width: code % 7 === 0 ? 2 : 1, gap: 1 });
  }
  bars.push({ width: 2, gap: 1 }, { width: 1, gap: 1 }, { width: 2, gap: 0 });
  return bars;
};

const getDesignerQrMatrix = (text: string, size = 21) => {
  const sourceHash = hashDesignerText(text.trim() || 'QR');
  const matrix = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
  const addFinder = (startX: number, startY: number) => {
    for (let y = 0; y < 7; y += 1) {
      for (let x = 0; x < 7; x += 1) {
        const outer = x === 0 || y === 0 || x === 6 || y === 6;
        const inner = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        matrix[startY + y][startX + x] = outer || inner;
      }
    }
  };
  addFinder(0, 0);
  addFinder(size - 7, 0);
  addFinder(0, size - 7);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inFinder = (x < 8 && y < 8) || (x >= size - 8 && y < 8) || (x < 8 && y >= size - 8);
      if (!inFinder) {
        matrix[y][x] = ((Math.imul(x + 3, 1103515245) ^ Math.imul(y + 5, 12345) ^ sourceHash) & 3) === 0;
      }
    }
  }
  return matrix;
};

const resolveDesignerAssetUrl = (value?: string | null) => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('data:image/') || trimmed.startsWith('blob:') || /^https?:\/\//i.test(trimmed)) return trimmed;
  const normalizedPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const baseUrl = new URL(API_BASE_URL, window.location.origin);
  return new URL(normalizedPath, baseUrl).toString();
};

const getImageElementSource = (element: TemplateElement) => {
  const explicitImageUrl = typeof element.imageUrl === 'string' ? element.imageUrl.trim() : '';
  const expression = typeof element.expression === 'string' ? element.expression.trim() : '';
  return explicitImageUrl || expression;
};

const loadCanvasImage = (src?: string | null) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const resolvedSrc = resolveDesignerAssetUrl(src);
    if (!resolvedSrc) {
      resolve(null);
      return;
    }
    const tryLoad = (useAnonymous: boolean) => {
      const image = new window.Image();
      if (useAnonymous) {
        image.crossOrigin = 'anonymous';
      }
      image.onload = () => resolve(image);
      image.onerror = () => {
        if (useAnonymous) {
          tryLoad(false);
          return;
        }
        resolve(null);
      };
      image.src = resolvedSrc;
    };

    tryLoad(true);
  });

const getImageCoverCrop = (image: HTMLImageElement, width: number, height: number) => {
  const imageWidth = image.naturalWidth || image.width;
  const imageHeight = image.naturalHeight || image.height;
  if (!imageWidth || !imageHeight || !width || !height) {
    return undefined;
  }

  const scale = Math.max(width / imageWidth, height / imageHeight);
  const cropWidth = width / scale;
  const cropHeight = height / scale;
  return {
    x: Math.max(0, (imageWidth - cropWidth) / 2),
    y: Math.max(0, (imageHeight - cropHeight) / 2),
    width: Math.min(imageWidth, cropWidth),
    height: Math.min(imageHeight, cropHeight),
  };
};

const DesignerElementNode = ({
  element,
  isSelected,
  locked = false,
  onSelect,
  onMove,
  onEditText,
  onNodeReady,
}: {
  element: TemplateElement;
  isSelected: boolean;
  locked?: boolean;
  onSelect: (event?: any) => void;
  onMove: (patch: Partial<TemplateElement>) => void;
  onEditText: () => void;
  onNodeReady: (id: string, node: any | null) => void;
}) => {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [node, setNode] = useState<any>(null);
  const [isHovering, setIsHovering] = useState(false);

  useEffect(() => {
    if (element.type !== 'image') {
      setImage(null);
      return;
    }
    const imageUrl = getImageElementSource(element);
    void loadCanvasImage(imageUrl).then(setImage);
  }, [element.type, element.expression, element.imageUrl]);

  useEffect(() => {
    onNodeReady(element.id, node ?? null);
    return () => onNodeReady(element.id, null);
  }, [element.id, node, onNodeReady]);

  const commonDragProps = {
    x: 20 + element.x,
    y: 20 + element.y,
    draggable: !locked,
    onClick: onSelect,
    onTap: onSelect,
    onDblClick: onEditText,
    onDblTap: onEditText,
    onMouseEnter: () => {
      setIsHovering(true);
      document.body.style.cursor = locked ? 'default' : 'move';
    },
    onMouseLeave: () => {
      setIsHovering(false);
      document.body.style.cursor = 'default';
    },
    onDragEnd: (event: any) => {
      onMove({
        x: Math.max(0, snapValue(Math.round(event.target.x() - 20))),
        y: Math.max(0, snapValue(Math.round(event.target.y() - 20))),
      });
    },
  };
  const fill = String(element.style.fill ?? '#111111');
  const stroke = String(element.style.stroke ?? '#111111');
  const background = String(element.style.background ?? '#ffffff');
  const activeStroke = isSelected ? '#1677ff' : isHovering ? '#7cb3ff' : stroke;
  const activeShadow = isSelected || isHovering ? 'rgba(22,119,255,0.18)' : undefined;
  const imageCrop = image && element.type === 'image' ? getImageCoverCrop(image, element.width, element.height) : undefined;
  const autoSizeText = isTextElement(element) && element.style.autoSize === true;
  const textOverflow = String(element.style.textOverflow ?? 'clip');
  const previewText = getElementPreviewText(element);

  if (element.type === 'rect') {
    return (
      <>
        <Rect
          key={element.id}
          ref={setNode}
          {...commonDragProps}
          width={element.width}
          height={element.height}
          stroke={activeStroke}
          strokeWidth={2}
          fill={background}
          shadowColor={activeShadow}
          shadowBlur={isSelected ? 8 : isHovering ? 4 : 0}
        />
      </>
    );
  }

  if (element.type === 'line') {
    return (
      <>
        <Line
          key={element.id}
          ref={setNode}
          {...commonDragProps}
          points={[0, 0, element.width, 0]}
          stroke={activeStroke}
          strokeWidth={Math.max(2, element.height)}
          shadowColor={activeShadow}
          shadowBlur={isSelected ? 6 : isHovering ? 4 : 0}
        />
      </>
    );
  }

  if (element.type === 'image') {
    return image ? (
      <>
        <Group
          key={element.id}
          ref={setNode}
          {...commonDragProps}
        >
          <Rect
            width={element.width}
            height={element.height}
            fill="rgba(0,0,0,0.001)"
            stroke={isSelected || isHovering ? activeStroke : 'transparent'}
            strokeWidth={isSelected ? 2 : isHovering ? 1 : 0}
            cornerRadius={6}
            shadowColor={activeShadow}
            shadowBlur={isSelected ? 8 : isHovering ? 4 : 0}
          />
          {imageCrop ? (
            <KonvaImage
              image={image}
              x={0}
              y={0}
              width={element.width}
              height={element.height}
              crop={imageCrop}
              cornerRadius={6}
              listening={false}
            />
          ) : null}
        </Group>
      </>
    ) : (
      <>
        <Rect
          key={element.id}
          ref={setNode}
          {...commonDragProps}
          width={element.width}
          height={element.height}
          stroke={activeStroke}
          fill="#f1f3f5"
          shadowColor={activeShadow}
          shadowBlur={isSelected ? 8 : isHovering ? 4 : 0}
        />
      </>
    );
  }

  if (element.type === 'qrcode') {
    const text = String(element.expression ?? element.bindingField ?? 'QR');
    const matrix = getDesignerQrMatrix(text);
    const qrPadding = 4;
    const qrSize = Math.max(1, Math.min(element.width, element.height) - qrPadding * 2);
    const cellSize = qrSize / matrix.length;
    const qrX = (element.width - qrSize) / 2;
    const qrY = (element.height - qrSize) / 2;
    return (
      <>
        <Group
          key={element.id}
          {...commonDragProps}
          ref={setNode}
        >
          <Rect
            width={element.width}
            height={element.height}
            fill={background}
            stroke={activeStroke}
            strokeWidth={2}
            shadowColor={activeShadow}
            shadowBlur={isSelected ? 8 : isHovering ? 4 : 0}
          />
          <Rect x={qrX} y={qrY} width={qrSize} height={qrSize} fill="#ffffff" listening={false} />
          {matrix.flatMap((row, rowIndex) => row.map((filled, colIndex) => filled ? (
            <Rect
              key={`${rowIndex}-${colIndex}`}
              x={qrX + colIndex * cellSize}
              y={qrY + rowIndex * cellSize}
              width={Math.ceil(cellSize)}
              height={Math.ceil(cellSize)}
              fill={fill}
              listening={false}
            />
          ) : null))}
        </Group>
      </>
    );
  }

  if (element.type === 'barcode') {
    const text = String(element.expression ?? element.bindingField ?? '6901234567890');
    const bars = getDesignerBarcodeBars(text);
    const totalUnits = bars.reduce((sum, bar) => sum + bar.width + bar.gap, 0) || 1;
    const barAreaHeight = Math.max(8, element.height - (element.height >= 34 ? 14 : 8));
    let cursor = 4;
    return (
      <>
        <Group
          key={element.id}
          {...commonDragProps}
          ref={setNode}
        >
          <Rect
            width={element.width}
            height={element.height}
            fill={background}
            stroke={activeStroke}
            strokeWidth={1}
            shadowColor={activeShadow}
            shadowBlur={isSelected ? 8 : isHovering ? 4 : 0}
          />
          {bars.map((bar, index) => {
            const availableWidth = Math.max(1, element.width - 8);
            const unitWidth = availableWidth / totalUnits;
            const x = cursor;
            const width = Math.max(1, bar.width * unitWidth);
            cursor += (bar.width + bar.gap) * unitWidth;
            return (
              <Rect
                key={index}
                x={x}
                y={4}
                width={width}
                height={barAreaHeight}
                fill={fill}
                listening={false}
              />
            );
          })}
          {element.height >= 34 ? (
            <Text
              x={4}
              y={Math.max(4, element.height - 13)}
              width={Math.max(1, element.width - 8)}
              height={10}
              text={text}
              fontSize={9}
              align="center"
              fill={fill}
              listening={false}
            />
          ) : null}
        </Group>
      </>
    );
  }

  return (
    <>
      <Rect
        key={`${element.id}-text-bg`}
        x={20 + element.x}
        y={20 + element.y}
        width={element.width}
        height={element.height}
        fill={background}
        stroke={activeStroke}
        strokeWidth={1}
        listening={false}
      />
      <Text
        key={element.id}
        ref={setNode}
        {...commonDragProps}
        width={element.width}
        height={element.height}
        text={previewText}
        fontSize={Number(element.style.fontSize ?? 14)}
        fontStyle={String(element.style.fontWeight) === 'bold' ? 'bold' : 'normal'}
        align={String(element.style.textAlign ?? 'left') as 'left' | 'center' | 'right'}
        fill={fill}
        wrap={autoSizeText ? 'none' : textOverflow === 'wrap' ? 'word' : 'none'}
        ellipsis={!autoSizeText && textOverflow !== 'wrap'}
        verticalAlign="top"
        padding={TEXT_PADDING_X}
        shadowColor={activeShadow}
        shadowBlur={isSelected ? 8 : isHovering ? 4 : 0}
      />
    </>
  );
};

export const TemplateListPage = () => {
  const { tx } = useI18n();
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentUser = useAppStore((state) => state.user);
  const isAdmin = currentUser?.role === 'ADMIN';
  const [filters, setFilters] = useState<{ ownerUserId?: string; keyword?: string }>({});
  const { data, isPending } = useQuery({ queryKey: [...queryKeys.templates, filters], queryFn: () => api.templates(filters) });
  const { data: users } = useQuery({ queryKey: queryKeys.users, queryFn: () => api.users({ pageSize: 200 }), enabled: isAdmin });
  const userOptions = useMemo(() => (users?.items ?? []).map((user) => ({ label: `${user.displayName || user.username} / ${user.username}`, value: user.id })), [users]);
  const publish = useMutation({
    mutationFn: (id: string) => api.publishTemplate(id, true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.templates });
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      queryClient.invalidateQueries({ queryKey: queryKeys.devices });
      message.success(tx('模板已发布', 'Template published'));
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.templates });
      queryClient.invalidateQueries({ queryKey: queryKeys.products });
      queryClient.invalidateQueries({ queryKey: queryKeys.devices });
      message.success(tx('模板已删除', 'Template deleted'));
    },
  });
  const describeTemplateImpact = (row: any) => tx(
    `删除后只删除这个模板，并解除 ${row.useDeviceCount ?? 0} 个显示节点/商品默认模板与它的关联；不会删除显示节点、商品或任务记录。`,
    `This deletes only this template and clears links from ${row.useDeviceCount ?? 0} display node(s)/data source defaults. Display nodes, data sources, and task records are kept.`,
  );
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <PageHeaderCard title={tx('模板管理', 'Templates')} extra={<Button type="primary" onClick={() => navigate('/templates/create')}>{tx('新增模板', 'New Template')}</Button>} />
      <Card>
        <Space wrap style={{ marginBottom: 16 }}>
          {isAdmin ? (
            <Select
              allowClear
              placeholder={tx('按用户筛选', 'Filter by user')}
              style={{ width: 240 }}
              options={userOptions}
              value={filters.ownerUserId}
              onChange={(ownerUserId) => setFilters((current) => ({ ...current, ownerUserId }))}
            />
          ) : null}
          <Input.Search
            allowClear
            placeholder={tx('搜索名称/编码/设备型号', 'Search name/code/device model')}
            style={{ width: 280 }}
            onSearch={(keyword) => setFilters((current) => ({ ...current, keyword: keyword.trim() || undefined }))}
          />
        </Space>
        <Table
          rowKey="id"
          loading={isPending}
          dataSource={data?.items ?? []}
          columns={[
            ...(isAdmin ? [{ title: tx('归属账号', 'Owner'), render: (_: unknown, row: any) => row.owner?.displayName || row.owner?.username || row.ownerUserId || '-' }] : []),
            {
              title: tx('缩略图', 'Preview'),
              width: 140,
              render: (_, row: any) => (
                <TemplatePreviewThumbnail
                  previewImageUrl={row.previewImageUrl}
                  name={row.name}
                  schema={row.schema ?? row.schemaJson ?? null}
                />
              ),
            },
            { title: tx('名称', 'Name'), dataIndex: 'name' },
            { title: tx('屏幕规格', 'Screen Size'), render: (_, row: any) => formatTemplateScreenSize(row) },
            { title: tx('编码', 'Code'), dataIndex: 'code' },
            { title: tx('版本', 'Version'), dataIndex: 'version' },
            { title: tx('状态', 'Status'), dataIndex: 'status' },
            { title: tx('使用设备数', 'Devices Using It'), dataIndex: 'useDeviceCount' },
            {
              title: tx('操作', 'Actions'),
              render: (_, row: any) => (
                <Space>
                  <Button
                    icon={<CopyOutlined />}
                    onClick={() => {
                      navigator.clipboard.writeText(row.id);
                      modal.success({ title: tx('ID 已复制', 'ID copied'), content: row.id, width: 480 });
                    }}
                  >
                    {tx('复制 ID', 'Copy ID')}
                  </Button>
                  <Button onClick={() => navigate(`/templates/${row.id}/designer`)}>{tx('设计', 'Design')}</Button>
                  <Button onClick={() => publish.mutate(row.id)} loading={publish.isPending && publish.variables === row.id}>{tx('发布', 'Publish')}</Button>
                  <Button
                    danger
                    onClick={() => {
                      modal.confirm({
                        title: tx('删除模板？', 'Delete template?'),
                        content: describeTemplateImpact(row),
                        okButtonProps: { danger: true, loading: remove.isPending && remove.variables === row.id },
                        okText: tx('删除', 'Delete'),
                        cancelText: tx('取消', 'Cancel'),
                        width: 620,
                        onOk: async () => remove.mutateAsync(row.id),
                      });
                    }}
                  >
                    {tx('删除', 'Delete')}
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>
    </Space>
  );
};

export const TemplateFormPage = () => {
  const { tx } = useI18n();
  const { id } = useParams();
  const navigate = useNavigate();
  const currentUser = useAppStore((state) => state.user);
  const isAdmin = currentUser?.role === 'ADMIN';
  const [form] = Form.useForm();
  const isEdit = Boolean(id);
  const { data, isPending } = useQuery({ queryKey: id ? queryKeys.template(id) : ['template-create'], queryFn: () => api.template(id!), enabled: isEdit });
  const { data: users } = useQuery({ queryKey: queryKeys.users, queryFn: () => api.users({ pageSize: 200 }), enabled: isAdmin && !isEdit });
  const mutation = useMutation({
    mutationFn: (values: any) => (isEdit ? api.updateTemplate(id!, values) : api.createTemplate(values)),
    onSuccess: (result: any) => navigate(`/templates/${result.id}/designer`),
  });
  const currentPresetId = useMemo(() => {
    const current = findScreenPreset(data);
    return current?.id ?? DEFAULT_SCREEN_PRESET.id;
  }, [data]);

  useEffect(() => {
    const preset = ESL_SCREEN_PRESETS.find((item) => item.id === currentPresetId) ?? DEFAULT_SCREEN_PRESET;
    form.setFieldsValue({
      ...data,
      screenPreset: preset.id,
      width: data?.width ?? preset.width,
      height: data?.height ?? preset.height,
      colorMode: normalizeColorMode(data?.colorMode),
      deviceType: data?.deviceType ?? preset.id.toUpperCase(),
    });
  }, [currentPresetId, data, form]);

  const userOptions = (users?.items ?? []).map((user) => ({ label: `${user.displayName || user.username} / ${user.username}`, value: user.id }));

  return (
    <Card loading={isEdit && isPending}>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ screenPreset: DEFAULT_SCREEN_PRESET.id, deviceType: DEFAULT_SCREEN_PRESET.id.toUpperCase(), width: DEFAULT_SCREEN_PRESET.width, height: DEFAULT_SCREEN_PRESET.height, colorMode: DEFAULT_COLOR_MODE, status: 'draft' }}
        onFinish={(values) => {
          const preset = ESL_SCREEN_PRESETS.find((item) => item.id === values.screenPreset) ?? DEFAULT_SCREEN_PRESET;
          mutation.mutate({
            ...values,
            deviceType: preset.id.toUpperCase(),
            width: preset.width,
            height: preset.height,
            colorMode: normalizeColorMode(values.colorMode),
          });
        }}
      >
        <Form.Item name="name" label={tx('模板名称', 'Template Name')} rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="code" label={tx('模板编码', 'Template Code')} rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item
          name="screenPreset"
          label={tx('屏幕规格', 'Screen Preset')}
          rules={[{ required: true, message: tx('请选择屏幕规格', 'Please select a screen preset') }]}
        >
          <Select
            options={SCREEN_PRESET_OPTIONS}
            onChange={(value) => {
              const preset = ESL_SCREEN_PRESETS.find((item) => item.id === value);
              if (!preset) return;
              form.setFieldsValue({
                deviceType: preset.id.toUpperCase(),
                width: preset.width,
                height: preset.height,
              });
            }}
          />
        </Form.Item>
        {isAdmin && !isEdit ? (
          <Form.Item name="ownerUserId" label={tx('归属账号', 'Owner')}>
            <Select allowClear options={userOptions} placeholder={tx('默认当前账号', 'Default to current user')} />
          </Form.Item>
        ) : null}
        <Form.Item name="deviceType" label={tx('设备型号', 'Device Model')}>
          <Input disabled />
        </Form.Item>
        <Form.Item name="width" label={tx('宽', 'Width')}>
          <InputNumber min={1} style={{ width: '100%' }} disabled />
        </Form.Item>
        <Form.Item name="height" label={tx('高', 'Height')}>
          <InputNumber min={1} style={{ width: '100%' }} disabled />
        </Form.Item>
        <Form.Item name="colorMode" label={tx('色彩模式', 'Color Mode')}>
          <Select options={COLOR_MODE_OPTIONS.map((item) => ({ ...item, label: tx(item.label, item.label) }))} />
        </Form.Item>
        <Button htmlType="submit" type="primary">{tx('保存模板', 'Save Template')}</Button>
      </Form>
    </Card>
  );
};

export const TemplateDetailPage = () => {
  const { tx } = useI18n();
  const { message } = App.useApp();
  const { id = '' } = useParams();
  const [previewOpen, setPreviewOpen] = useState(false);
  const { data, isPending } = useQuery({ queryKey: queryKeys.template(id), queryFn: () => api.template(id) });
  const preview = useMutation({
    mutationFn: () => api.previewTemplate(id, {
      sku: 'SKU-001',
      sourceId: 'SKU-001',
      name: tx('苹果', 'Apple'),
      subName: tx('云南红富士', 'Yunnan Red Fuji'),
      specification: tx('500g/袋', '500g/bag'),
      unit: tx('袋', 'bag'),
      brand: tx('鲜果优选', 'Fresh Choice'),
      price: 5.99,
      field1: 5.99,
      originalPrice: 6.99,
      memberPrice: 4.59,
      promotionPrice: 4.99,
      field2: 4.99,
      promotionText: tx('会员特价', 'Member Special'),
      barcode: '1234567890',
      reference: '1234567890',
      imageUrl: SAMPLE_IMAGE_URL,
    }),
    onSuccess: () => message.success(tx('预览已生成', 'Preview generated')),
  });

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <PageHeaderCard title={`${tx('模板详情', 'Template Details')} · ${data?.name ?? ''}`} extra={<Button loading={preview.isPending} onClick={() => { setPreviewOpen(true); preview.mutate(); }}>{tx('预览', 'Preview')}</Button>} />
      <Card loading={isPending}>
        <List dataSource={[`${tx('编码', 'Code')}: ${data?.code}`, `${tx('设备类型', 'Device Type')}: ${data?.deviceType}`, `${tx('版本', 'Version')}: ${data?.version}`, `${tx('状态', 'Status')}: ${data?.status}`]} renderItem={(item) => <List.Item>{item}</List.Item>} />
      </Card>
      <Modal open={previewOpen} onCancel={() => setPreviewOpen(false)} footer={null} width={480}>
        {preview.data?.previewImageUrl ? <Image src={preview.data.previewImageUrl} /> : null}
      </Modal>
    </Space>
  );
};

export const TemplateDesignerPage = () => {
  const { tx } = useI18n();
  const { message } = App.useApp();
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const [templateForm] = Form.useForm();
  const transformerRef = useRef<any>(null);
  const [textEditorOpen, setTextEditorOpen] = useState(false);
  const [textDraft, setTextDraft] = useState('');
  const [zoom, setZoom] = useState(1);
  const [activeLeftPanel, setActiveLeftPanel] = useState<'elements' | 'palette' | 'templates' | 'help'>('elements');
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [nodeRegistry, setNodeRegistry] = useState<Record<string, any>>({});
  const [selectedPreviewKey, setSelectedPreviewKey] = useState<string>('current');
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [pendingPreviewItemKey, setPendingPreviewItemKey] = useState<string | null>(null);
  const [currentPreviewOverride, setCurrentPreviewOverride] = useState<{ previewImageUrl?: string; subtitle?: string; schema?: any } | null>(null);
  const { data } = useQuery({ queryKey: queryKeys.templateSchema(id), queryFn: () => api.templateSchema(id) });
  const { data: templateDetail } = useQuery({ queryKey: queryKeys.template(id), queryFn: () => api.template(id) });
  const {
    schema,
    setSchema,
    addElement,
    selectedElementId,
    selectedElementIds,
    select,
    setSelection,
    updateElement,
    updateElements,
    removeElements,
    duplicateElements,
    bringForward,
    sendBackward,
    bringToFront,
    sendToBack,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useDesignerStore();
  const saveTemplateMeta = async () => {
    const values = await templateForm.validateFields();
    const preset = ESL_SCREEN_PRESETS.find((item) => item.id === values.screenPreset) ?? DEFAULT_SCREEN_PRESET;
    const colorMode = normalizeColorMode(values.colorMode);
    await api.updateTemplate(id, {
      name: values.name,
      code: values.code,
      status: values.status,
      deviceType: preset.id.toUpperCase(),
      width: preset.width,
      height: preset.height,
      colorMode,
    });
    return { preset, colorMode };
  };
  const save = useMutation({
    mutationFn: async () => {
      const { preset, colorMode } = await saveTemplateMeta();
      const nextSchema = sanitizeDesignerSchema(applyScreenPresetToSchema(schema!, preset, colorMode));
      return api.saveTemplateSchema(id, nextSchema);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.templateSchema(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.template(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.templates });
      message.success(tx('模板已保存', 'Template saved'));
    },
  });
  const publishTemplate = useMutation({
    mutationFn: async () => {
      const { preset, colorMode } = await saveTemplateMeta();
      await api.saveTemplateSchema(id, sanitizeDesignerSchema(applyScreenPresetToSchema(schema!, preset, colorMode)));
      return api.publishTemplate(id, true);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.templateSchema(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.template(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.templates });
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      queryClient.invalidateQueries({ queryKey: queryKeys.devices });
      if (result.refresh?.createdTaskCount) {
        message.success(tx(
          `模板已保存并发布，并创建 ${result.refresh.createdTaskCount} 个标签刷新任务`,
          `Template saved and published; queued ${result.refresh.createdTaskCount} label refresh task(s)`,
        ));
      } else {
        message.success(tx('模板已保存并发布', 'Template saved and published'));
      }
    },
  });
  const deleteVersion = useMutation({
    mutationFn: (versionId: string) => api.deleteTemplateVersion(id, versionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.template(id) });
      setSelectedPreviewKey('current');
      message.success(tx('历史版本已删除', 'Historical version deleted'));
    },
  });
  const selectedElement = schema?.elements.find((item) => item.id === selectedElementId) ?? null;
  const uploadPreviewImage = useMutation({ mutationFn: api.uploadImage });
  const selectedElements = schema?.elements.filter((item) => selectedElementIds.includes(item.id)) ?? [];
  const allElementIds = schema?.elements.map((item) => item.id) ?? [];
  const selectedBounds = useMemo(() => {
    if (!selectedElements.length) return null;
    const left = Math.min(...selectedElements.map((item) => item.x));
    const top = Math.min(...selectedElements.map((item) => item.y));
    const right = Math.max(...selectedElements.map((item) => item.x + item.width));
    const bottom = Math.max(...selectedElements.map((item) => item.y + item.height));
    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    };
  }, [selectedElements]);
  const templatePreviewItems = useMemo(() => {
    const currentItem = {
      key: 'current',
      title: tx('当前模板', 'Current Template'),
      subtitle: currentPreviewOverride?.subtitle ?? (templateDetail ? `${tx('版本', 'Version')} ${templateDetail.version}` : ''),
      previewImageUrl: currentPreviewOverride?.previewImageUrl ?? templateDetail?.previewImageUrl,
      schema: currentPreviewOverride?.schema ?? data?.schema,
      isHistory: false,
      versionId: null as string | null,
    };
    const versionItems = (templateDetail?.recentVersions ?? [])
      .filter((item) => item.previewImageUrl)
      .map((item) => ({
        key: item.id,
        title: `${tx('历史版本', 'History')} v${item.version}`,
        subtitle: new Date(item.createdAt).toLocaleString(),
        previewImageUrl: item.previewImageUrl,
        schema: item.schema,
        isHistory: true,
        versionId: item.id,
        version: item.version,
      }));
    return [currentItem, ...versionItems];
  }, [currentPreviewOverride, data?.schema, templateDetail, tx]);
  const activePreviewItem = useMemo(
    () => templatePreviewItems.find((item) => item.key === selectedPreviewKey) ?? templatePreviewItems[0] ?? null,
    [selectedPreviewKey, templatePreviewItems],
  );
  const pendingPreviewItem = useMemo(
    () => templatePreviewItems.find((item) => item.key === pendingPreviewItemKey) ?? null,
    [pendingPreviewItemKey, templatePreviewItems],
  );
  const bindingOptions = PRODUCT_BINDING_FIELDS.map((field) => ({
    label: `${field.id} · ${(
      {
        sourceId: tx('来源编号', 'Source ID'),
        name: tx('商品名', 'Product Name'),
        subName: tx('副标题', 'Subtitle'),
        specification: tx('规格', 'Specification'),
        unit: tx('单位', 'Unit'),
        brand: tx('品牌/厂商', 'Brand/Manufacturer'),
        reference: tx('参考值', 'Reference'),
        field1: tx('字段 1', 'Field 1'),
        originalPrice: tx('原价', 'Original Price'),
        memberPrice: tx('会员价', 'Member Price'),
        field2: tx('字段 2', 'Field 2'),
        promotionText: tx('促销文案', 'Promotion Text'),
      } as Record<string, string>
    )[field.key] ?? `${tx('自定义', 'Custom')} ${field.key.replace('customField', '')}`}`,
    value: field.id,
  }));
  const selectedStyle = useMemo(() => selectedElement?.style ?? {}, [selectedElement]);
  const editableSelectedIds = selectedElementIds;
  const editableSelectedElements = selectedElements;
  const selectedKind = selectedElement?.type === 'image'
    ? 'image'
    : selectedElement?.type === 'rect' || selectedElement?.type === 'line'
      ? 'shape'
      : 'text';
  const selectedCanBind = selectedElement ? BINDABLE_ELEMENT_TYPES.includes(selectedElement.type) : false;
  const selectedIsTextElement = selectedElement ? isTextElement(selectedElement) : false;
  const updateSelectedTextStyle = (patch: Record<string, unknown>) => {
    if (!selectedElement) return;
    const nextElement = {
      ...selectedElement,
      style: { ...selectedElement.style, ...patch },
    };
    updateElement(selectedElement.id, {
      ...(nextElement.style.autoSize === true ? applyTextAutoSize(nextElement) : {}),
      style: nextElement.style,
    });
  };
  const previewUploadProps: UploadProps = {
    accept: 'image/*',
    maxCount: 1,
    showUploadList: false,
    customRequest: async ({ file, onError, onSuccess }) => {
      if (!selectedElement || selectedElement.type !== 'image') {
        globalMessage.warning(tx('请先选中一个图片元素', 'Please select an image element first'));
        onError?.(new Error('No image element selected'));
        return;
      }
      try {
        const result = await uploadPreviewImage.mutateAsync(file as File);
        const imageUrl = resolveDesignerAssetUrl(result.url);
        updateElement(selectedElement.id, { expression: result.url, imageUrl });
        globalMessage.success(tx('模板预览图片已上传', 'Template preview image uploaded'));
        onSuccess?.(result);
      } catch (error) {
        globalMessage.error(tx('模板预览图片上传失败', 'Failed to upload template preview image'));
        onError?.(error as Error);
      }
    },
  };
  const openTextEditor = (element: TemplateElement) => {
    if (element.type === 'image' || element.type === 'rect') return;
    select(element.id);
    setTextDraft(typeof element.expression === 'string' ? element.expression : '');
    setTextEditorOpen(true);
  };

  useEffect(() => {
    if (!schema) return;
    const patches = schema.elements
      .filter((element) => isTextElement(element) && element.style.autoSize === true)
      .map((element) => {
        const sizePatch = applyTextAutoSize(element);
        if (sizePatch.width === element.width && sizePatch.height === element.height) return null;
        return { id: element.id, patch: sizePatch };
      })
      .filter(Boolean) as Array<{ id: string; patch: Partial<TemplateElement> }>;
    if (patches.length) {
      updateElements(patches);
    }
  }, [schema?.elements, updateElements]);

  useEffect(() => {
    if (!data?.schema) return;
    const preset = templateDetail ? findScreenPreset(templateDetail) : DEFAULT_SCREEN_PRESET;
    const sizedSchema = applyScreenPresetToSchema(data.schema, preset) ?? data.schema;
    const sanitizedSchema = sanitizeDesignerSchema(sizedSchema);
    const nextElements = (sanitizedSchema.elements ?? []).map((item: any) => {
      if (item.type !== 'image') return item;
      const source = getImageElementSource(item);
      const resolvedImageUrl = resolveDesignerAssetUrl(source);
      return resolvedImageUrl ? { ...item, imageUrl: resolvedImageUrl } : item;
    });
    setSchema({ ...sanitizedSchema, elements: nextElements });
  }, [data, templateDetail?.width, templateDetail?.height, setSchema]);

  useEffect(() => {
    if (!templateDetail) return;
    const preset = findScreenPreset(templateDetail);
    templateForm.setFieldsValue({
      name: templateDetail.name,
      code: templateDetail.code,
      status: templateDetail.status,
      screenPreset: preset.id,
      deviceType: preset.id.toUpperCase(),
      width: preset.width,
      height: preset.height,
      colorMode: normalizeColorMode(templateDetail.colorMode),
    });
  }, [templateDetail, templateForm]);

  useEffect(() => {
    setSelectedPreviewKey('current');
    setCurrentPreviewOverride(null);
  }, [templateDetail?.id, templateDetail?.previewImageUrl, data?.schema]);

  const requestRestorePreviewItem = (item: { key: string; schema?: any; isHistory?: boolean }) => {
    setPendingPreviewItemKey(item.key);
    setRestoreModalOpen(true);
  };

  const confirmRestorePreviewItem = () => {
    if (!pendingPreviewItem?.schema) {
      setRestoreModalOpen(false);
      setPendingPreviewItemKey(null);
      return;
    }
    setSchema(sanitizeDesignerSchema(pendingPreviewItem.schema));
    if (pendingPreviewItem.isHistory) {
      setCurrentPreviewOverride({
        previewImageUrl: pendingPreviewItem.previewImageUrl,
        subtitle: `${tx('基于历史版本恢复，未保存', 'Restored from history, unsaved')} · ${pendingPreviewItem.subtitle ?? ''}`,
        schema: pendingPreviewItem.schema,
      });
    } else {
      setCurrentPreviewOverride(null);
    }
    setSelectedPreviewKey('current');
    setRestoreModalOpen(false);
    setPendingPreviewItemKey(null);
    message.success(tx('已切换到选中的模板画布', 'Switched to the selected template canvas'));
  };

  const registerNode = useCallback((elementId: string, node: any | null) => {
    setNodeRegistry((current) => {
      if (!node && !current[elementId]) return current;
      if (node && current[elementId] === node) return current;
      if (!node) {
        const next = { ...current };
        delete next[elementId];
        return next;
      }
      return { ...current, [elementId]: node };
    });
  }, []);

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    const nodes = editableSelectedIds
      .map((item) => nodeRegistry[item])
      .filter(Boolean);
    transformer.nodes(nodes);
    transformer.getLayer()?.batchDraw();
  }, [editableSelectedIds, nodeRegistry]);

  useEffect(() => {
    if (!schema) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isTyping = tagName === 'input' || tagName === 'textarea' || Boolean(target?.closest('.ant-select'));
      if (isTyping) return;

      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === 'z' && event.shiftKey) {
        event.preventDefault();
        redo();
        return;
      }
      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undo();
        return;
      }
      if (modifier && event.key.toLowerCase() === 'c' && selectedElementIds.length) {
        event.preventDefault();
        if (editableSelectedIds.length) duplicateElements(editableSelectedIds);
        return;
      }
      if (modifier && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setSelection(allElementIds);
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedElementIds.length) {
        event.preventDefault();
        removeElements(selectedElementIds);
        return;
      }
      if (editableSelectedIds.length && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const step = event.shiftKey ? DESIGNER_GRID_SIZE * 2 : DESIGNER_GRID_SIZE;
        const deltaX = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const deltaY = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        updateElements(editableSelectedElements.map((item) => ({
          id: item.id,
          patch: {
            x: Math.max(0, snapValue(item.x + deltaX)),
            y: Math.max(0, snapValue(item.y + deltaY)),
          },
        })));
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [allElementIds, duplicateElements, editableSelectedElements, editableSelectedIds, redo, removeElements, schema, selectedElementIds, setSelection, undo, updateElements]);

  if (!schema) return null;

  const getCanvasPoint = (event: any) => {
    const stage = event.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!pointer) return null;
    return {
      x: Math.max(0, (pointer.x - 20) / zoom),
      y: Math.max(0, (pointer.y - 20) / zoom),
    };
  };

  const handleStageMouseDown = (event: any) => {
    const clickedOnStage = event.target === event.target.getStage() || event.target.attrs?.name === 'canvas-bg';
    if (!clickedOnStage) return;
    const point = getCanvasPoint(event);
    if (!point) return;
    setSelectionStart(point);
    setSelectionBox({ x: point.x, y: point.y, width: 0, height: 0 });
    if (!event.evt.shiftKey) select(null);
  };

  const handleStageMouseMove = (event: any) => {
    if (!selectionStart) return;
    const point = getCanvasPoint(event);
    if (!point) return;
    setSelectionBox({
      x: Math.min(selectionStart.x, point.x),
      y: Math.min(selectionStart.y, point.y),
      width: Math.abs(point.x - selectionStart.x),
      height: Math.abs(point.y - selectionStart.y),
    });
  };

  const handleStageMouseUp = () => {
    if (!selectionBox) {
      setSelectionStart(null);
      return;
    }
    if (selectionBox.width < 2 && selectionBox.height < 2) {
      setSelectionBox(null);
      setSelectionStart(null);
      return;
    }
    const selectedIds = schema.elements
      .filter((element) => {
        const left = element.x;
        const top = element.y;
        const right = element.x + element.width;
        const bottom = element.y + element.height;
        return right >= selectionBox.x
          && left <= selectionBox.x + selectionBox.width
          && bottom >= selectionBox.y
          && top <= selectionBox.y + selectionBox.height;
      })
      .map((element) => element.id);
    setSelection(selectedIds);
    setSelectionBox(null);
    setSelectionStart(null);
  };

  const canvasWidth = Math.max(640, schema.meta.width * zoom + 220);
  const canvasHeight = Math.max(460, schema.meta.height * zoom + 180);
  const rulerXCount = Math.max(8, Math.ceil(schema.meta.width / 25));
  const rulerYCount = Math.max(6, Math.ceil(schema.meta.height / 25));
  const selectedCenterX = selectedBounds ? selectedBounds.x + selectedBounds.width / 2 : null;
  const selectedCenterY = selectedBounds ? selectedBounds.y + selectedBounds.height / 2 : null;
  const showVerticalGuide = selectedCenterX !== null && Math.abs(selectedCenterX - schema.meta.width / 2) <= DESIGNER_GRID_SIZE;
  const showHorizontalGuide = selectedCenterY !== null && Math.abs(selectedCenterY - schema.meta.height / 2) <= DESIGNER_GRID_SIZE;

  const commitTransformerChanges = () => {
    if (!selectedElementIds.length) return;
    const patches = editableSelectedIds
      .map((item) => {
        const node = nodeRegistry[item];
        const source = schema.elements.find((element) => element.id === item);
        if (!node || !source) return null;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);
        return {
          id: item,
          patch: {
            x: Math.max(0, snapValue(Math.round(node.x() - 20))),
            y: Math.max(0, snapValue(Math.round(node.y() - 20))),
            width: Math.max(8, snapValue(Math.round(source.width * scaleX))),
            height: Math.max(8, snapValue(Math.round(source.height * scaleY))),
          },
        };
      })
      .filter(Boolean) as Array<{ id: string; patch: Partial<TemplateElement> }>;
    if (patches.length) updateElements(patches);
  };

  const alignSelectedElement = (mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
    if (!editableSelectedElements.length) return;
    const patches = editableSelectedElements.map((item) => {
      if (mode === 'left') return { id: item.id, patch: { x: 0 } };
      if (mode === 'center') return { id: item.id, patch: { x: snapValue((schema.meta.width - item.width) / 2) } };
      if (mode === 'right') return { id: item.id, patch: { x: Math.max(0, snapValue(schema.meta.width - item.width)) } };
      if (mode === 'top') return { id: item.id, patch: { y: 0 } };
      if (mode === 'middle') return { id: item.id, patch: { y: snapValue((schema.meta.height - item.height) / 2) } };
      return { id: item.id, patch: { y: Math.max(0, snapValue(schema.meta.height - item.height)) } };
    });
    updateElements(patches);
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <PageHeaderCard
        title={`${tx('模板设计器', 'Template Designer')} · ${templateDetail?.name ?? ''}`}
        extra={(
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              flexWrap: 'wrap',
              gap: 8,
              padding: '6px 10px',
              borderRadius: 16,
              background: 'linear-gradient(180deg, #ffffff, #f7f9fc)',
              border: '1px solid #e8edf4',
              boxShadow: '0 10px 24px rgba(15,23,42,0.05)',
              maxWidth: '100%',
            }}
          >
            <Space wrap size={[8, 8]}>
              <Tag color="blue">{schema.meta.width} × {schema.meta.height}</Tag>
              <Tag color="gold">{schema.meta.colorMode.toUpperCase()}</Tag>
            </Space>
            <Space wrap size={[4, 4]}>
              <Tooltip title={tx('撤销', 'Undo')}>
                <Button type="text" icon={<UndoOutlined />} onClick={() => undo()} disabled={!canUndo} />
              </Tooltip>
              <Tooltip title={tx('重做', 'Redo')}>
                <Button type="text" icon={<RedoOutlined />} onClick={() => redo()} disabled={!canRedo} />
              </Tooltip>
              <Tooltip title={tx('复制选中元素', 'Copy Selected Elements')}>
                <Button type="text" icon={<CopyOutlined />} onClick={() => editableSelectedIds.length && duplicateElements(editableSelectedIds)} disabled={!editableSelectedIds.length} />
              </Tooltip>
              <Button
                icon={<DeleteOutlined />}
                onClick={() => editableSelectedIds.length && removeElements(editableSelectedIds)}
                danger
                disabled={!editableSelectedIds.length}
              >
                {tx('删除', 'Delete')}
              </Button>
            </Space>
            <Space wrap size={[4, 4]}>
              <Button type="text" onClick={() => setZoom((value) => Math.max(0.5, Number((value - 0.1).toFixed(1))))} icon={<ZoomOutOutlined />} />
              <Tag>{Math.round(zoom * 100)}%</Tag>
              <Button type="text" onClick={() => setZoom((value) => Math.min(2, Number((value + 0.1).toFixed(1))))} icon={<ZoomInOutlined />} />
              <Button onClick={() => publishTemplate.mutate()} loading={publishTemplate.isPending}>{tx('发布', 'Publish')}</Button>
              <Button onClick={() => save.mutate()} type="primary" loading={save.isPending}>{tx('保存', 'Save')}</Button>
            </Space>
          </div>
        )}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '260px minmax(0, 1fr) 300px', gap: 16, alignItems: 'start' }}>
        <Card
          bodyStyle={{ padding: 0, height: 'calc(100vh - 220px)', overflow: 'auto' }}
          style={{ borderRadius: 16 }}
        >
          <div style={{ display: 'flex', minHeight: '100%' }}>
            <div style={{ width: 54, borderRight: '1px solid #edf0f4', background: '#fbfcfe', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '14px 10px' }}>
              <Tooltip title={tx('元素', 'Elements')}>
                <Button type={activeLeftPanel === 'elements' ? 'primary' : 'text'} icon={<AppstoreOutlined />} onClick={() => setActiveLeftPanel('elements')} />
              </Tooltip>
              <Tooltip title={tx('颜色', 'Colors')}>
                <Button type={activeLeftPanel === 'palette' ? 'primary' : 'text'} icon={<BgColorsOutlined />} onClick={() => setActiveLeftPanel('palette')} />
              </Tooltip>
              <Tooltip title={tx('模板', 'Templates')}>
                <Button type={activeLeftPanel === 'templates' ? 'primary' : 'text'} onClick={() => setActiveLeftPanel('templates')}>{tx('版', 'Tpl')}</Button>
              </Tooltip>
              <Tooltip title={tx('帮助', 'Help')}>
                <Button type={activeLeftPanel === 'help' ? 'primary' : 'text'} onClick={() => setActiveLeftPanel('help')}>?</Button>
              </Tooltip>
            </div>
            <div style={{ flex: 1, minWidth: 0, padding: 16, overflowX: 'hidden' }}>
              {activeLeftPanel === 'elements' ? (
                <Space direction="vertical" size={18} style={{ width: '100%' }}>
                  {DESIGNER_TOOL_GROUPS.map((group) => (
                    <div key={group.key} style={{ minWidth: 0 }}>
                      <Typography.Title level={3} style={{ margin: 0, marginBottom: 14, fontSize: 18, fontWeight: 700, lineHeight: 1.2 }}>
                        {group.key === 'basic' ? tx('基础元素', 'Basic Elements') : tx('绘制元素', 'Drawing Elements')}
                      </Typography.Title>
                      <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
                        {group.items.map((item) => (
                          <button
                            key={item.type}
                            type="button"
                            onClick={() => addElement(createDesignerElement(item.type as TemplateElement['type'], schema.elements.length, schema.meta))}
                            style={{
                              width: '100%',
                              minWidth: 0,
                              border: '1px solid #d7d7d3',
                              borderRadius: 18,
                              background: '#fcfcfb',
                              padding: '14px 16px',
                              cursor: 'pointer',
                              textAlign: 'left',
                              display: 'flex',
                              alignItems: 'flex-start',
                              justifyContent: 'space-between',
                              gap: 12,
                              boxShadow: '0 1px 0 rgba(16,24,40,0.02)',
                            }}
                          >
                              <div style={{ display: 'flex', gap: 12, minWidth: 0, flex: 1 }}>
                                <div
                                  style={{
                                    width: 34,
                                  height: 34,
                                  borderRadius: 10,
                                  border: '1px solid #b8bcc4',
                                  color: '#6b7280',
                                  display: 'grid',
                                  placeItems: 'center',
                                  fontSize: 18,
                                  fontWeight: 600,
                                  background: '#fff',
                                  flexShrink: 0,
                                }}
                              >
                                {item.type === 'text' ? 'T' : item.type === 'price' ? '#' : item.type === 'label' ? '⌂' : item.type === 'image' ? '◫' : item.type === 'barcode' ? '▥' : item.type === 'qrcode' ? '◫' : item.type === 'rect' ? '▭' : '─'}
                              </div>
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ fontSize: 16, lineHeight: 1.1, fontWeight: 600, color: '#171717', wordBreak: 'break-word' }}>
                                  {{
                                    text: tx('文本', 'Text'),
                                    price: tx('价格', 'Peice'),
                                    label: tx('标签', 'Label'),
                                    image: tx('图片', 'Image'),
                                    barcode: tx('条码', 'Barcode'),
                                    qrcode: tx('二维码', 'QR Code'),
                                    rect: tx('矩形', 'Rectangle'),
                                    line: tx('线条', 'Line'),
                                  }[item.key]}
                                </div>
                                <div style={{ marginTop: 8, fontSize: 14, color: '#b0b3ba' }}>
                                  {item.size.width} × {item.size.height}
                                </div>
                              </div>
                            </div>
                            <PlusOutlined style={{ color: '#8d9199', fontSize: 18, marginTop: 4, flexShrink: 0 }} />
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </Space>
              ) : null}

              {activeLeftPanel === 'palette' ? (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 12 }}>{tx('颜色面板', 'Color Panel')}</Typography.Title>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                    {DESIGNER_COLOR_SWATCHES.map((color) => (
                      <button
                        key={color.value}
                        type="button"
                        onClick={() => selectedElement && updateElement(selectedElement.id, { style: { ...selectedStyle, fill: color.value, stroke: color.value } })}
                        style={{
                          border: '1px solid #e5e9f0',
                          borderRadius: 14,
                          padding: 12,
                          background: '#fff',
                          cursor: selectedElement ? 'pointer' : 'not-allowed',
                          textAlign: 'left',
                        }}
                        disabled={!selectedElement}
                      >
                        <div style={{ width: '100%', height: 42, borderRadius: 10, background: color.value, border: '1px solid #dfe5ec' }} />
                        <div style={{ marginTop: 8, fontSize: 12, color: '#667085' }}>
                          {{
                            black: tx('黑', 'Black'),
                            white: tx('白', 'White'),
                            red: tx('红', 'Red'),
                            yellow: tx('黄', 'Yellow'),
                          }[color.key]}
                        </div>
                      </button>
                    ))}
                  </div>
                </Space>
              ) : null}

              {activeLeftPanel === 'templates' ? (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 12 }}>{tx('模板缩略', 'Template Thumbnails')}</Typography.Title>
                  <Card size="small" bodyStyle={{ padding: 10 }} style={{ borderRadius: 12, background: '#fffdf7' }}>
                    {activePreviewItem?.previewImageUrl ? (
                      <img
                        src={activePreviewItem.previewImageUrl}
                        alt={activePreviewItem.title}
                        style={{ width: '100%', borderRadius: 10, display: 'block', marginBottom: 10 }}
                      />
                    ) : (
                      <div style={{ height: 120, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, #f7f7f7, #ececec)', color: '#999', marginBottom: 10 }}>
                        {tx('暂无预览图', 'No preview available')}
                      </div>
                    )}
                    <Typography.Text strong style={{ display: 'block' }}>{activePreviewItem?.title ?? tx('当前模板', 'Current Template')}</Typography.Text>
                    {activePreviewItem?.subtitle ? (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {activePreviewItem.subtitle}
                      </Typography.Text>
                    ) : null}
                  </Card>
                  <div style={{ display: 'grid', gap: 12 }}>
                    {templatePreviewItems.map((item) => (
                      <div
                        key={item.key}
                        onClick={() => {
                          setSelectedPreviewKey(item.key);
                          if (!item.schema) return;
                          requestRestorePreviewItem(item);
                        }}
                        style={{
                          border: item.key === activePreviewItem?.key ? '1px solid #1677ff' : '1px solid #edf0f4',
                          borderRadius: 12,
                          padding: 10,
                          background: item.key === activePreviewItem?.key ? '#f0f7ff' : '#fff',
                          cursor: 'pointer',
                          textAlign: 'left',
                          position: 'relative',
                        }}
                      >
                        {item.isHistory ? (
                          <Button
                            size="small"
                            type="text"
                            danger
                            icon={<DeleteOutlined />}
                            loading={deleteVersion.isPending && deleteVersion.variables === item.versionId}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (!item.versionId) return;
                              Modal.confirm({
                                title: tx('删除历史版本', 'Delete historical version'),
                                content: tx('确认删除这个历史版本吗？删除后将无法恢复。', 'Delete this historical version? This action cannot be undone.'),
                                okText: tx('确认删除', 'Delete'),
                                cancelText: tx('取消', 'Cancel'),
                                okButtonProps: { danger: true },
                                centered: true,
                                onOk: () => deleteVersion.mutate(item.versionId!),
                              });
                            }}
                            style={{ position: 'absolute', top: 6, right: 6, zIndex: 1 }}
                          />
                        ) : null}
                        {item.previewImageUrl ? (
                          <img src={item.previewImageUrl} alt={item.title} style={{ width: '100%', borderRadius: 8, display: 'block' }} />
                        ) : (
                          <div style={{ height: 92, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, #f7f7f7, #ececec)', color: '#999' }}>
                            {tx('暂无预览图', 'No preview available')}
                          </div>
                        )}
                        <Typography.Text style={{ display: 'block', marginTop: 8 }}>
                          {item.title}
                        </Typography.Text>
                        {item.subtitle ? (
                          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                            {item.subtitle}
                          </Typography.Text>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </Space>
              ) : null}

              {activeLeftPanel === 'help' ? (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 12 }}>{tx('使用说明', 'Instructions')}</Typography.Title>
                  <List
                    dataSource={[
                      tx('单击选中元素，拖动可移动位置。', 'Click to select an element and drag to move it.'),
                      tx('Shift + 点击可以多选，Ctrl/Cmd + A 可以全选。', 'Use Shift+Click for multi-select, and Ctrl/Cmd+A for select all.'),
                      tx('拖动元素四角控制点可以改变大小。', 'Drag the corner handles to resize an element.'),
                      tx('多选后会出现统一外框，可以整体缩放。', 'Multi-selection shows a unified box so you can resize as a group.'),
                      tx('双击文字元素可以快速编辑示例内容。', 'Double-click a text element to edit sample content quickly.'),
                      tx('顶部支持撤销、重做、批量复制和批量删除。', 'The top bar supports undo, redo, batch copy, and batch delete.'),
                      tx('右侧属性面板可以精确输入坐标、宽高和样式。', 'Use the right panel to fine-tune position, size, and style.'),
                    ]}
                    renderItem={(item) => <List.Item>{item}</List.Item>}
                  />
                </Space>
              ) : null}
            </div>
          </div>
        </Card>

        <Card bodyStyle={{ padding: 0 }} style={{ borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ borderBottom: '1px solid #edf0f4', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', background: '#f9fafc' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, minWidth: 0, flex: '1 1 280px' }}>
              <Typography.Text strong>{tx('画布区域', 'Canvas')}</Typography.Text>
              <Divider type="vertical" style={{ marginInline: 0 }} />
              <Typography.Text type="secondary" style={{ wordBreak: 'break-word' }}>
                {tx('双击文字可编辑示例文案', 'Double-click text to edit sample content')}
              </Typography.Text>
            </div>
            <Space wrap size={[6, 6]} style={{ justifyContent: 'flex-end' }}>
              <Button size="small" onClick={() => alignSelectedElement('left')} disabled={!editableSelectedIds.length}>{tx('左对齐', 'Align Left')}</Button>
              <Button size="small" onClick={() => alignSelectedElement('center')} disabled={!editableSelectedIds.length}>{tx('水平居中', 'Align Center')}</Button>
              <Button size="small" onClick={() => alignSelectedElement('right')} disabled={!editableSelectedIds.length}>{tx('右对齐', 'Align Right')}</Button>
              <Button size="small" onClick={() => alignSelectedElement('top')} disabled={!editableSelectedIds.length}>{tx('顶对齐', 'Align Top')}</Button>
              <Button size="small" onClick={() => alignSelectedElement('middle')} disabled={!editableSelectedIds.length}>{tx('垂直居中', 'Align Middle')}</Button>
              <Button size="small" onClick={() => alignSelectedElement('bottom')} disabled={!editableSelectedIds.length}>{tx('底对齐', 'Align Bottom')}</Button>
              <Divider type="vertical" style={{ marginInline: 0 }} />
              <Tooltip title={tx('上移一层', 'Bring Forward')}>
                <Button size="small" icon={<VerticalAlignTopOutlined />} onClick={() => selectedElementId && bringForward(selectedElementId)} disabled={!selectedElementId} />
              </Tooltip>
              <Tooltip title={tx('下移一层', 'Send Backward')}>
                <Button size="small" icon={<VerticalAlignBottomOutlined />} onClick={() => selectedElementId && sendBackward(selectedElementId)} disabled={!selectedElementId} />
              </Tooltip>
              <Tooltip title={tx('置于最上层', 'Bring to Front')}>
                <Button size="small" icon={<ToTopOutlined rotate={180} />} onClick={() => selectedElementId && bringToFront(selectedElementId)} disabled={!selectedElementId} />
              </Tooltip>
              <Tooltip title={tx('置于最下层', 'Send to Back')}>
                <Button size="small" icon={<ToTopOutlined />} onClick={() => selectedElementId && sendToBack(selectedElementId)} disabled={!selectedElementId} />
              </Tooltip>
              <Tag color="processing">{tx('元素', 'Elements')} {schema.elements.length} / {tx('已选', 'Selected')} {selectedElementIds.length}</Tag>
            </Space>
          </div>
          <div
            style={{
              position: 'relative',
              height: 'calc(100vh - 220px)',
              overflow: 'auto',
              backgroundImage:
                'linear-gradient(45deg, #eef1f4 25%, transparent 25%), linear-gradient(-45deg, #eef1f4 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #eef1f4 75%), linear-gradient(-45deg, transparent 75%, #eef1f4 75%)',
              backgroundSize: '20px 20px',
              backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
            }}
          >
            <div style={{ position: 'absolute', top: 0, left: 48, right: 0, height: 26, background: 'rgba(255,255,255,0.95)', borderBottom: '1px solid #e8ecf1', display: 'flex' }}>
              {Array.from({ length: rulerXCount + 1 }).map((_, index) => (
                <div key={index} style={{ width: 25 * zoom, borderLeft: '1px solid #e8ecf1', fontSize: 11, color: '#8a94a6', paddingLeft: 4 }}>
                  {index * 25}
                </div>
              ))}
            </div>
            <div style={{ position: 'absolute', top: 26, left: 0, bottom: 0, width: 48, background: 'rgba(255,255,255,0.95)', borderRight: '1px solid #e8ecf1' }}>
              {Array.from({ length: rulerYCount + 1 }).map((_, index) => (
                <div key={index} style={{ height: 25 * zoom, borderTop: '1px solid #e8ecf1', fontSize: 11, color: '#8a94a6', paddingTop: 4, textAlign: 'center' }}>
                  {index * 25}
                </div>
              ))}
            </div>

            <div style={{ marginLeft: 48, marginTop: 26, minWidth: canvasWidth, minHeight: canvasHeight, padding: 40 }}>
              <div style={{ width: schema.meta.width * zoom + 40, height: schema.meta.height * zoom + 40, boxShadow: '0 24px 60px rgba(31,45,61,0.12)', borderRadius: 16, background: '#fff' }}>
                <Stage
                  width={schema.meta.width * zoom + 40}
                  height={schema.meta.height * zoom + 40}
                  scaleX={zoom}
                  scaleY={zoom}
                  onMouseDown={handleStageMouseDown}
                  onMouseMove={handleStageMouseMove}
                  onMouseUp={handleStageMouseUp}
                >
                  <Layer>
                    <Rect x={20} y={20} width={schema.meta.width} height={schema.meta.height} fill="#fffdf8" stroke="#2e3138" cornerRadius={8} name="canvas-bg" />
                    {showVerticalGuide ? (
                      <Line
                        points={[20 + schema.meta.width / 2, 20, 20 + schema.meta.width / 2, 20 + schema.meta.height]}
                        stroke="#1677ff"
                        strokeWidth={1}
                        dash={[6, 6]}
                        listening={false}
                      />
                    ) : null}
                    {showHorizontalGuide ? (
                      <Line
                        points={[20, 20 + schema.meta.height / 2, 20 + schema.meta.width, 20 + schema.meta.height / 2]}
                        stroke="#1677ff"
                        strokeWidth={1}
                        dash={[6, 6]}
                        listening={false}
                      />
                    ) : null}
                    {schema.elements
                      .slice()
                      .sort((a, b) => a.zIndex - b.zIndex)
                      .map((element) => (
                        <DesignerElementNode
                          key={element.id}
                          element={element}
                          isSelected={selectedElementIds.includes(element.id)}
                          locked={false}
                          onSelect={(evt) => select(element.id, evt?.evt?.shiftKey ? { toggle: true } : undefined)}
                          onNodeReady={registerNode}
                          onMove={(patch) => {
                            const targetX = typeof patch.x === 'number' ? patch.x : element.x;
                            const targetY = typeof patch.y === 'number' ? patch.y : element.y;
                            const deltaX = targetX - element.x;
                            const deltaY = targetY - element.y;
                            if (editableSelectedIds.length > 1 && editableSelectedIds.includes(element.id) && (deltaX !== 0 || deltaY !== 0)) {
                              updateElements(
                                editableSelectedElements.map((item) => ({
                                  id: item.id,
                                  patch: {
                                    x: Math.max(0, snapValue(item.x + deltaX)),
                                    y: Math.max(0, snapValue(item.y + deltaY)),
                                  },
                                })),
                              );
                              return;
                            }
                            updateElement(element.id, patch);
                          }}
                          onEditText={() => openTextEditor(element)}
                        />
                      ))}
                    <Transformer
                      ref={transformerRef}
                      rotateEnabled={false}
                      flipEnabled={false}
                      anchorCornerRadius={6}
                      anchorFill="#ffffff"
                      anchorStroke="#1677ff"
                      anchorStrokeWidth={1.5}
                      borderStroke="#1677ff"
                      borderStrokeWidth={1.5}
                      borderDash={[6, 4]}
                      onTransformEnd={commitTransformerChanges}
                      boundBoxFunc={(_, newBox) => ({
                        ...newBox,
                        width: Math.max(8, newBox.width),
                        height: Math.max(8, newBox.height),
                      })}
                    />
                    {selectionBox ? (
                      <Rect
                        x={20 + selectionBox.x}
                        y={20 + selectionBox.y}
                        width={selectionBox.width}
                        height={selectionBox.height}
                        fill="rgba(22,119,255,0.12)"
                        stroke="#1677ff"
                        dash={[6, 4]}
                        listening={false}
                      />
                    ) : null}
                  </Layer>
                </Stage>
              </div>
            </div>
          </div>
        </Card>

        <Card bodyStyle={{ padding: 0, height: 'calc(100vh - 220px)', overflow: 'auto' }} style={{ borderRadius: 16 }}>
          <div style={{ padding: 16, borderBottom: '1px solid #edf0f4', background: '#fafbfd' }}>
            <Typography.Title level={5} style={{ margin: 0 }}>{tx('属性设置', 'Properties')}</Typography.Title>
            <Typography.Text type="secondary">{tx('选中元素后，在这里精确调整样式和位置。', 'Select an element to fine-tune its style and position here.')}</Typography.Text>
          </div>
          <div style={{ padding: 16 }}>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Card size="small" title={tx('模板信息', 'Template Info')}>
                <Form form={templateForm} layout="vertical" size="small">
                  <Form.Item name="name" label={tx('模板名称', 'Template Name')} rules={[{ required: true }]}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="code" label={tx('模板编码', 'Template Code')} rules={[{ required: true }]}>
                    <Input />
                  </Form.Item>
                  <Form.Item
                    name="screenPreset"
                    label={tx('屏幕规格', 'Screen Preset')}
                    rules={[{ required: true, message: tx('请选择屏幕规格', 'Please select a screen preset') }]}
                  >
                    <Select
                      options={SCREEN_PRESET_OPTIONS}
                      onChange={(value) => {
                        const preset = ESL_SCREEN_PRESETS.find((item) => item.id === value);
                        if (!preset) return;
                        const colorMode = normalizeColorMode(templateForm.getFieldValue('colorMode'));
                        const nextSchema = applyScreenPresetToSchema(schema, preset, colorMode);
                        if (nextSchema) {
                          setSchema(nextSchema);
                        }
                        templateForm.setFieldsValue({
                          deviceType: preset.id.toUpperCase(),
                          width: preset.width,
                          height: preset.height,
                        });
                      }}
                    />
                  </Form.Item>
                  <Form.Item name="status" label={tx('状态', 'Status')}>
                    <Select options={[{ label: 'draft', value: 'draft' }, { label: 'published', value: 'published' }]} />
                  </Form.Item>
                  <Form.Item name="deviceType" label={tx('设备型号', 'Device Model')}>
                    <Input disabled />
                  </Form.Item>
                  <Row gutter={10}>
                    <Col span={12}>
                      <Form.Item name="width" label={tx('宽', 'Width')}>
                        <InputNumber style={{ width: '100%' }} disabled />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="height" label={tx('高', 'Height')}>
                        <InputNumber style={{ width: '100%' }} disabled />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item name="colorMode" label={tx('色彩模式', 'Color Mode')}>
                    <Select
                      options={COLOR_MODE_OPTIONS.map((item) => ({ ...item, label: tx(item.label, item.label) }))}
                      onChange={(value) => {
                        const colorMode = normalizeColorMode(value);
                        if (schema) {
                          setSchema({
                            ...schema,
                            meta: {
                              ...schema.meta,
                              colorMode,
                            },
                          });
                        }
                      }}
                    />
                  </Form.Item>
                </Form>
              </Card>

              <Card size="small" title={tx('标识', 'Element Info')}>
                {selectedElement ? (
                  <Form layout="vertical" size="small">
                    <Form.Item label={tx('类型', 'Type')}>
                      <Input value={selectedElement.type} disabled />
                    </Form.Item>
                    {selectedCanBind ? (
                      <Form.Item label={tx('绑定字段', 'Binding Field')}>
                        <Select
                          value={selectedElement.bindingField ?? undefined}
                          allowClear
                          options={bindingOptions}
                          onChange={(value) => updateElement(selectedElement.id, { bindingField: value ?? null })}
                        />
                      </Form.Item>
                    ) : null}
                    {selectedElement.type === 'image' ? (
                      <Form.Item label={tx('图片预览地址', 'Preview Image URL')}>
                        <Input
                          value={getImageElementSource(selectedElement)}
                          addonAfter={(
                            <Upload {...previewUploadProps}>
                              <Button size="small" loading={uploadPreviewImage.isPending}>
                                {tx('上传图片', 'Upload Image')}
                              </Button>
                            </Upload>
                          )}
                          onChange={(event) => updateElement(selectedElement.id, { expression: event.target.value, imageUrl: resolveDesignerAssetUrl(event.target.value) })}
                          placeholder={tx('设计器预览底图，实际渲染优先使用商品图片', 'Used only for designer preview. Real rendering prefers the product image.')}
                        />
                      </Form.Item>
                    ) : selectedCanBind ? (
                      <Form.Item label={tx('示例内容', 'Sample Content')}>
                        <Input
                          value={typeof selectedElement.expression === 'string' ? selectedElement.expression : ''}
                          onChange={(event) => updateElement(selectedElement.id, { expression: event.target.value })}
                          placeholder={tx('设计时预览内容', 'Preview content for design time')}
                        />
                      </Form.Item>
                    ) : null}

                    {selectedKind === 'text' ? (
                      <Tag color="blue" style={{ marginBottom: 12 }}>{tx('文字元素设置', 'Text Element Settings')}</Tag>
                    ) : null}
                    {selectedKind === 'image' ? (
                      <Tag color="purple" style={{ marginBottom: 12 }}>{tx('图片元素设置', 'Image Element Settings')}</Tag>
                    ) : null}
                    {selectedKind === 'shape' ? (
                      <Tag color="gold" style={{ marginBottom: 12 }}>{tx('图形元素设置', 'Shape Settings')}</Tag>
                    ) : null}

                    <Row gutter={10}>
                      <Col span={12}>
                        <Form.Item label="X">
                          <InputNumber style={{ width: '100%' }} value={selectedElement.x} onChange={(value) => updateElement(selectedElement.id, { x: Number(value ?? 0) })} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item label="Y">
                          <InputNumber style={{ width: '100%' }} value={selectedElement.y} onChange={(value) => updateElement(selectedElement.id, { y: Number(value ?? 0) })} />
                        </Form.Item>
                      </Col>
                    </Row>

                    <Row gutter={10}>
                      <Col span={12}>
                        <Form.Item label={tx('宽', 'Width')}>
                          <InputNumber style={{ width: '100%' }} value={selectedElement.width} onChange={(value) => updateElement(selectedElement.id, { width: Math.max(1, Number(value ?? 1)) })} disabled={selectedIsTextElement && selectedStyle.autoSize === true} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item label={tx('高', 'Height')}>
                          <InputNumber style={{ width: '100%' }} value={selectedElement.height} onChange={(value) => updateElement(selectedElement.id, { height: Math.max(1, Number(value ?? 1)) })} disabled={selectedIsTextElement && selectedStyle.autoSize === true} />
                        </Form.Item>
                      </Col>
                    </Row>

                    {selectedKind === 'text' ? (
                      <>
                        {selectedIsTextElement ? (
                          <>
                            <Form.Item>
                              <Checkbox
                                checked={selectedStyle.autoSize === true}
                                onChange={(event) => updateSelectedTextStyle({ autoSize: event.target.checked })}
                              >
                                {tx('宽高自适应内容', 'Auto size to content')}
                              </Checkbox>
                            </Form.Item>
                            <Form.Item label={tx('固定宽高文字处理', 'Fixed Size Text Handling')}>
                              <Select
                                value={String(selectedStyle.textOverflow ?? 'clip')}
                                disabled={selectedStyle.autoSize === true}
                                options={[
                                  { label: tx('按高度换行显示，超出高度裁剪', 'Wrap by width, clip extra lines'), value: 'wrap' },
                                  { label: tx('不换行，超出范围裁剪', 'No wrap, clip overflow'), value: 'clip' },
                                ]}
                                onChange={(value) => updateSelectedTextStyle({ textOverflow: value })}
                              />
                            </Form.Item>
                          </>
                        ) : null}
                        <Form.Item label={tx('字体大小', 'Font Size')}>
                          <InputNumber
                            style={{ width: '100%' }}
                            min={8}
                            max={96}
                            value={Number(selectedStyle.fontSize ?? 14)}
                            onChange={(value) => updateSelectedTextStyle({ fontSize: Number(value ?? 14) })}
                          />
                        </Form.Item>
                        <Form.Item label={tx('字重', 'Font Weight')}>
                          <Select
                            value={String(selectedStyle.fontWeight ?? 'normal')}
                            options={[
                              { label: tx('常规', 'Regular'), value: 'normal' },
                              { label: tx('加粗', 'Bold'), value: 'bold' },
                            ]}
                            onChange={(value) => updateSelectedTextStyle({ fontWeight: value })}
                          />
                        </Form.Item>
                        <Form.Item label={tx('对齐', 'Alignment')}>
                          <Select
                            value={String(selectedStyle.textAlign ?? 'left')}
                            options={[
                              { label: tx('左对齐', 'Left'), value: 'left' },
                              { label: tx('居中', 'Center'), value: 'center' },
                              { label: tx('右对齐', 'Right'), value: 'right' },
                            ]}
                            onChange={(value) => updateSelectedTextStyle({ textAlign: value })}
                          />
                        </Form.Item>
                        <Form.Item label={tx('文字颜色', 'Text Color')}>
                          <div style={{ display: 'flex', gap: 8 }}>
                            {DESIGNER_COLOR_SWATCHES.map((color) => (
                              <button
                                key={color.value}
                                type="button"
                                onClick={() => updateSelectedTextStyle({ fill: color.value })}
                                style={{
                                  width: 26,
                                  height: 26,
                                  borderRadius: 8,
                                  border: selectedStyle.fill === color.value ? '2px solid #1677ff' : '1px solid #d8dee8',
                                  background: color.value,
                                  cursor: 'pointer',
                                }}
                              />
                            ))}
                          </div>
                        </Form.Item>
                        <Form.Item label={tx('背景颜色', 'Background Color')}>
                          <div style={{ display: 'flex', gap: 8 }}>
                            {DESIGNER_COLOR_SWATCHES.map((color) => (
                              <button
                                key={color.value}
                                type="button"
                                onClick={() => updateSelectedTextStyle({ background: color.value })}
                                style={{
                                  width: 26,
                                  height: 26,
                                  borderRadius: 8,
                                  border: selectedStyle.background === color.value ? '2px solid #1677ff' : '1px solid #d8dee8',
                                  background: color.value,
                                  cursor: 'pointer',
                                }}
                              />
                            ))}
                          </div>
                        </Form.Item>
                        <Form.Item label={tx('边框颜色', 'Border Color')}>
                          <div style={{ display: 'flex', gap: 8 }}>
                            {DESIGNER_COLOR_SWATCHES.map((color) => (
                              <button
                                key={color.value}
                                type="button"
                                onClick={() => updateSelectedTextStyle({ stroke: color.value })}
                                style={{
                                  width: 26,
                                  height: 26,
                                  borderRadius: 8,
                                  border: selectedStyle.stroke === color.value ? '2px solid #1677ff' : '1px solid #d8dee8',
                                  background: color.value,
                                  cursor: 'pointer',
                                }}
                              />
                            ))}
                          </div>
                        </Form.Item>
                      </>
                    ) : null}

                    {selectedKind === 'image' ? (
                      <>
                        <Form.Item label={tx('边框颜色', 'Border Color')}>
                          <div style={{ display: 'flex', gap: 8 }}>
                            {DESIGNER_COLOR_SWATCHES.map((color) => (
                              <button
                                key={color.value}
                                type="button"
                                onClick={() => updateElement(selectedElement.id, { style: { ...selectedStyle, stroke: color.value } })}
                                style={{
                                  width: 26,
                                  height: 26,
                                  borderRadius: 8,
                                  border: selectedStyle.stroke === color.value ? '2px solid #1677ff' : '1px solid #d8dee8',
                                  background: color.value,
                                  cursor: 'pointer',
                                }}
                              />
                            ))}
                          </div>
                        </Form.Item>
                        <Form.Item label={tx('图片说明', 'Image Notes')}>
                          <Input.TextArea
                            rows={3}
                            value={tx('该图片层默认为整张标签底图。实际渲染时会优先使用商品上传的图片，并自动全屏铺满。', 'This image layer is the full-label background by default. Real rendering prefers the uploaded product image and fills the full screen automatically.')}
                            disabled
                          />
                        </Form.Item>
                      </>
                    ) : null}

                    {selectedKind === 'shape' ? (
                      <>
                        <Form.Item label={tx('填充颜色', 'Fill Color')}>
                          <div style={{ display: 'flex', gap: 8 }}>
                            {DESIGNER_COLOR_SWATCHES.map((color) => (
                              <button
                                key={color.value}
                                type="button"
                                onClick={() => updateElement(selectedElement.id, { style: { ...selectedStyle, background: color.value, fill: color.value } })}
                                style={{
                                  width: 26,
                                  height: 26,
                                  borderRadius: 8,
                                  border: selectedStyle.background === color.value || selectedStyle.fill === color.value ? '2px solid #1677ff' : '1px solid #d8dee8',
                                  background: color.value,
                                  cursor: 'pointer',
                                }}
                              />
                            ))}
                          </div>
                        </Form.Item>
                        <Form.Item label={tx('描边颜色', 'Stroke Color')}>
                          <div style={{ display: 'flex', gap: 8 }}>
                            {DESIGNER_COLOR_SWATCHES.map((color) => (
                              <button
                                key={color.value}
                                type="button"
                                onClick={() => updateElement(selectedElement.id, { style: { ...selectedStyle, stroke: color.value } })}
                                style={{
                                  width: 26,
                                  height: 26,
                                  borderRadius: 8,
                                  border: selectedStyle.stroke === color.value ? '2px solid #1677ff' : '1px solid #d8dee8',
                                  background: color.value,
                                  cursor: 'pointer',
                                }}
                              />
                            ))}
                          </div>
                        </Form.Item>
                      </>
                    ) : null}
                  </Form>
                ) : (
                  <List dataSource={[tx('先在中间画布里选中一个元素，再到这里调整属性。', 'Select an element on the canvas first, then adjust its properties here.')]} renderItem={(item) => <List.Item>{item}</List.Item>} />
                )}
              </Card>
            </Space>
          </div>
        </Card>
      </div>
      <Modal
        open={restoreModalOpen}
        centered
        title={pendingPreviewItem?.isHistory ? tx('恢复历史版本', 'Restore historical version') : tx('切换到当前模板', 'Switch to current template')}
        okText={tx('确认切换', 'Restore')}
        cancelText={tx('取消', 'Cancel')}
        onOk={confirmRestorePreviewItem}
        onCancel={() => {
          setRestoreModalOpen(false);
          setPendingPreviewItemKey(null);
        }}
      >
        <Typography.Text>
          {pendingPreviewItem?.isHistory
            ? tx('确认将当前画布切换为这个历史版本吗？未保存的当前编辑会被覆盖。', 'Switch the current canvas to this historical version? Any unsaved changes will be overwritten.')
            : tx('确认切换回当前模板画布吗？未保存的当前编辑会被覆盖。', 'Switch the current canvas back to the current template? Any unsaved changes will be overwritten.')}
        </Typography.Text>
      </Modal>
      <Modal
        open={textEditorOpen}
        title={tx('编辑示例文案', 'Edit Sample Content')}
        onCancel={() => setTextEditorOpen(false)}
        onOk={() => {
          if (selectedElementId) {
            updateElement(selectedElementId, { expression: textDraft.trim() || null });
          }
          setTextEditorOpen(false);
        }}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <span>{tx('这里填写的是设计时预览文案，真实下发时仍然优先使用绑定字段里的内容。', 'This text is for design-time preview only. Real delivery still prefers the bound field value.')}</span>
          <Input.TextArea rows={4} value={textDraft} onChange={(event) => setTextDraft(event.target.value)} placeholder={tx('输入示例文案', 'Enter sample content')} />
        </Space>
      </Modal>
    </Space>
  );
};
