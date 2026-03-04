export type ElementType = 'text' | 'multiline' | 'line' | 'rect' | 'image' | 'barcode' | 'checkbox' | 'table';
export type FieldType = 'string' | 'date' | 'number';

export interface TemplateElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  text?: string;
  fieldId?: string;
  fieldType?: FieldType;
  fontSize?: number;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  stroke?: string;
  fill?: string;
  padding?: number;
  lineHeight?: number;
  translationText?: string;
  checked?: boolean;
  rows?: number;
  cols?: number;
  src?: string;
}

export interface TemplateDocument {
  templateName: string;
  version: string;
  page: {
    format: 'A4';
    orientation: 'portrait';
    widthMm: number;
    heightMm: number;
  };
  styles: {
    defaultFont: string;
  };
  fields: { id: string; type: FieldType }[];
  elements: TemplateElement[];
}
