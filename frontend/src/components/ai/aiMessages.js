import { errorMessage } from '../../lib/api';

export function aiErrorMessage(error) {
  const status = error.response?.status;
  if (status === 503) return 'AI 기능이 비활성화되어 있습니다.';
  if (status === 413) return '입력 크기가 허용 한도를 초과했습니다. 내용을 줄여 다시 시도해주세요.';
  if (status === 429) return 'AI 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.';
  if (status === 422) return 'AI가 이 요청에 답변할 수 없습니다. 입력을 바꿔 다시 시도해주세요.';
  return errorMessage(error);
}
