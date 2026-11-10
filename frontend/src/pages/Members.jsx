import { PageHeader, Card, StatusPill } from '../components/ui';
import { Plus } from 'lucide-react';
import '../styles/operations.css';
import { useEffect, useState } from 'react';
import useAppStore from '../store/useAppStore';
import useAuthStore from '../store/useAuthStore';
import Modal from '../components/Modal';
export default function Members() {
  const { membersData, fetchMembers, createMember, updateMember, deleteMember, error } =
    useAppStore();
  const { user } = useAuthStore();
  const [form, setForm] = useState(null),
    [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);
  const save = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const payload = form.id ? form : { ...form, invite: Boolean(form.invite), password: form.invite ? undefined : form.password };
    const ok = form.id ? await updateMember(form.id, payload) : await createMember(payload);
    setBusy(false);
    if (ok) {
      if (!form.id && form.invite) setNotice('초대 요청을 처리했습니다. 메일 설정에 따라 초대 안내가 전송됩니다.');
      setForm(null);
    }
  };
  return (
    <div className="dashboard-content operations-page">
      <PageHeader breadcrumbs={[{ label: '연구 공간', to: '/' }, { label: '연구실' }, { label: '연구실 멤버' }]} title="연구실 멤버" description="관리자가 계정을 등록하고 프로젝트별 접근 권한을 부여합니다." actions={<>{user.role === 'admin' && (
          <button
            className="btn-primary"
            onClick={() => setForm({ name: '', email: '', role: 'researcher', password: '', invite: false })}
          >
            <Plus aria-hidden="true" /> 멤버 등록
          </button>
        )}</>} />
      {notice && <p role="status" className="notice-banner">{notice}</p>}
      <Card className="card operations-members" padded={false}>
        <div className="table-scroll"><table className="ui-table data-table">
          <thead><tr><th>멤버</th><th>계정 권한</th><th>상태</th><th>작업</th></tr></thead>
          <tbody>{membersData.map((m) => <tr key={m.id}>
            <td><div className="ui-cell-title"><span className="operations-member-avatar" aria-hidden="true">{m.name.slice(0, 1)}</span><div><h3 className="operations-member-name">{m.name}</h3><small>{m.email}</small></div></div></td>
            <td><StatusPill tone={m.role === 'admin' ? 'accent' : m.role === 'researcher' ? 'info' : 'neutral'}>{m.role === 'admin' ? '관리자' : m.role === 'researcher' ? '연구원' : '읽기 전용'}</StatusPill></td>
            <td>{m.isActive === false ? <StatusPill tone="neutral">비활성</StatusPill> : <StatusPill tone="success">활성</StatusPill>}</td>
            <td>{user.role === 'admin' && (
              <div className="button-row">
                <button
                  className="btn-outline"
                  disabled={busy}
                  onClick={() => setForm({ ...m, password: '' })}
                >
                  수정
                </button>
                {m.id !== user.id && m.isActive !== false && (
                  <button
                    className="btn-outline"
                    disabled={busy}
                    onClick={async () => {
                      if (window.confirm(`${m.name} 계정을 비활성화할까요? 작성·서명 기록은 유지됩니다.`)) {
                        setBusy(true);
                        await deleteMember(m.id);
                        setBusy(false);
                      }
                    }}
                  >
                    비활성화
                  </button>
                )}
                {m.id !== user.id && m.isActive === false && (
                  <button
                    className="btn-outline"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      await updateMember(m.id, { ...m, isActive: true });
                      setBusy(false);
                    }}
                  >
                    재활성화
                  </button>
                )}
              </div>
            )}</td>
          </tr>)}</tbody>
        </table></div>
      </Card>
      {form && (
        <Modal
          title={form.id ? '멤버 수정' : '멤버 등록'}
          busy={busy}
          onClose={() => setForm(null)}
        >
          <form onSubmit={save}>
            <div className="modal-body">
              {error && (
                <p role="alert" className="error-banner">
                  {error}
                </p>
              )}
              {[
                ['name', '이름', 'text'],
                ['email', '이메일', 'email'],
                ...(!form.id && form.invite ? [] : [[
                  'password',
                  form.id ? '새 비밀번호 (변경할 때만 입력)' : '초기 비밀번호 (12자 이상)',
                  'password',
                ]]),
              ].map(([key, label, type]) => (
                <label className="form-group" key={key}>
                  {label}
                  <input
                    className="form-input"
                    type={type}
                    required={key !== 'password' || !form.id}
                    minLength={key === 'password' ? 12 : undefined}
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  />
                </label>
              ))}
              <label>
                계정 권한
                <select
                  className="form-input"
                  disabled={form.id === user.id}
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                >
                  <option value="researcher">연구원</option>
                  <option value="viewer">읽기 전용</option>
                  <option value="admin">관리자</option>
                </select>
              </label>
              {!form.id && <label className="checkbox-row"><input type="checkbox" checked={form.invite} onChange={(e) => setForm({ ...form, invite: e.target.checked })} />초대 메일 전송 (메일 미설정 시 계정은 만들어지지 않습니다)</label>}
              <p className="muted">관리자가 비밀번호를 직접 설정하거나, 7일 유효한 초대 링크를 보낼 수 있습니다.</p>
            </div>
            <div className="modal-footer">
              <button className="btn-primary" disabled={busy}>
                {busy ? '저장 중…' : '저장'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
