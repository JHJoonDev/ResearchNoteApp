import { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import Modal from './Modal';
import { ShieldCheck } from 'lucide-react';
import { Callout } from './ui';

export default function SignModal({
  title,
  meaning,
  submitLabel,
  danger = false,
  requireComment = false,
  commentLabel = '',
  onCancel,
  onSubmit,
  busy = false,
}) {
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [comment, setComment] = useState('');
  const [mfaEnabled, setMfaEnabled] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api
      .get('/auth/mfa')
      .then(({ data }) => active && setMfaEnabled(Boolean(data.enabled)))
      .catch((e) => active && setError(errorMessage(e)));
    return () => {
      active = false;
    };
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await onSubmit({ password, ...(mfaEnabled ? { totp: totp.trim() } : {}), comment });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Modal title={title} busy={busy} onClose={onCancel}>
      <form className="sign-form" onSubmit={submit}>
        <div className="modal-body">
          <Callout tone={danger ? 'warning' : 'accent'} icon={<ShieldCheck />} title={title}>{meaning}</Callout>
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
          {mfaEnabled === null && !error && <p className="muted">인증 설정 확인 중…</p>}
          {(requireComment || commentLabel) && (
            <label className="form-group">
              {commentLabel || '반려 사유'}
              <textarea
                required={requireComment}
                className="form-input"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </label>
          )}
          <label className="form-group">
            비밀번호
            <input
              required
              autoFocus
              autoComplete="current-password"
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {mfaEnabled && (
            <label className="form-group">
              인증 앱 코드
              <input
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                className="form-input"
                value={totp}
                onChange={(e) => setTotp(e.target.value)}
              />
            </label>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-secondary" disabled={busy} onClick={onCancel}>
            취소
          </button>
          <button
            className={danger ? 'btn-danger' : 'btn-primary'}
            disabled={
              busy ||
              mfaEnabled === null ||
              !password ||
              (mfaEnabled && !totp.trim()) ||
              (requireComment && !comment.trim())
            }
          >
            {busy ? '처리 중…' : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
