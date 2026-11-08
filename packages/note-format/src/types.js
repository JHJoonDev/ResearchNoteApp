/**
 * @fileoverview JSDoc 타입 정의
 * @typedef {Object} Node
 * @property {string} type
 * @property {number} [schemaVersion]
 * @property {Record<string, any>} [attrs]
 * @property {Node[]} [content]
 * @property {Mark[]} [marks]
 * @property {string} [text]
 *
 * @typedef {Object} Mark
 * @property {string} type
 * @property {Record<string, any>} [attrs]
 *
 * @typedef {Object} ValidationError
 * @property {string} path
 * @property {string} message
 *
 * @typedef {Object} ValidationResult
 * @property {boolean} ok
 * @property {ValidationError[]} errors
 *
 * @typedef {Object} ValidationLimits
 * @property {number} [maxNodes]
 * @property {number} [maxDepth]
 * @property {number} [maxTextLength]
 *
 * @typedef {Object} DocReferences
 * @property {string[]} attachmentIds
 * @property {string[]} userIds
 * @property {string[]} noteIds
 * @property {string[]} reagentIds
 *
 * @typedef {'add' | 'remove' | 'change' | 'same'} DiffOp
 *
 * @typedef {Object} InlineDiff
 * @property {'add' | 'remove' | 'same'} op
 * @property {string} text
 *
 * @typedef {Object} BlockDiff
 * @property {DiffOp} op
 * @property {number} [blockIndexA]
 * @property {number} [blockIndexB]
 * @property {InlineDiff[]} [inline]
 */

export {};
