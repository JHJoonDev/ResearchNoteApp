/**
 * @fileoverview AI Core 구조화 출력용 JSON Schemas (비재귀, additionalProperties: false, required 명시)
 */

export const draftNoteSchema = Object.freeze({
  type: 'object',
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          heading: { type: 'string' },
          blocks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['paragraph', 'bullets', 'table'] },
                text: { type: 'string' },
                items: {
                  type: 'array',
                  items: { type: 'string' },
                },
                header: {
                  type: 'array',
                  items: { type: 'string' },
                },
                rows: {
                  type: 'array',
                  items: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                },
              },
              required: ['kind'],
              additionalProperties: false,
            },
          },
        },
        required: ['heading', 'blocks'],
        additionalProperties: false,
      },
    },
    missing: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['sections', 'missing'],
  additionalProperties: false,
});

export const generateProtocolSchema = Object.freeze({
  type: 'object',
  properties: {
    title: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          instructions: { type: 'string' },
          checklist: {
            type: 'array',
            items: { type: 'string' },
          },
          resultFields: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                unit: { type: 'string' },
              },
              required: ['name', 'unit'],
              additionalProperties: false,
            },
          },
        },
        required: ['title', 'instructions', 'checklist', 'resultFields'],
        additionalProperties: false,
      },
    },
    safetyNotes: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['title', 'steps', 'safetyNotes'],
  additionalProperties: false,
});

export const extractTablesSchema = Object.freeze({
  type: 'object',
  properties: {
    tables: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          header: {
            type: 'array',
            items: { type: 'string' },
          },
          rows: {
            type: 'array',
            items: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
        required: ['title', 'header', 'rows'],
        additionalProperties: false,
      },
    },
  },
  required: ['tables'],
  additionalProperties: false,
});

export const checkNoteSchema = Object.freeze({
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['error', 'warning', 'info'] },
          category: {
            type: 'string',
            enum: [
              'missing_method',
              'missing_amount',
              'missing_condition',
              'missing_result',
              'reproducibility',
              'other',
            ],
          },
          message: { type: 'string' },
          blockIndex: { type: 'integer' },
        },
        required: ['severity', 'category', 'message', 'blockIndex'],
        additionalProperties: false,
      },
    },
  },
  required: ['findings'],
  additionalProperties: false,
});
