/**
 * @fileoverview @labhub/label-kit 메인 엔트리
 * 브라우저 안전 순수 ESM (Node.js 내장 모듈 일체 배제)
 */

export {
  LABEL_PREFIX,
  VALID_TYPES,
  ID_REGEX,
  MAX_PAYLOAD_LENGTH,
  encodeLabel,
  decodeLabel,
} from './codec.js';

export {
  TEMPLATES,
  SHEET_TEMPLATES,
  resolveTemplate,
  resolveSheetTemplate,
} from './templates.js';

export {
  xmlEscape,
  estimateTextEmWidth,
  wrapOrTruncateText,
  qrToSvgPath,
  renderLabelSvg,
} from './svg.js';

export {
  zplEscape,
  renderZpl,
} from './zpl.js';
