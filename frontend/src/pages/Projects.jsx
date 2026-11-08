import { useEffect, useState } from 'react';
import useAuthStore from '../store/useAuthStore';
import useProjectStore from '../store/useProjectStore';
import { api, errorMessage } from '../lib/api';
import Modal from '../components/Modal';
export default function Projects() {
  const { user } = useAuthStore();
  const { projects, fetchProjects, error: loadError } = useProjectStore();
  const [members, setMembers] = useState([]),
    [form, setForm] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    fetchProjects();
    api
      .get('/members')
      .then((r) => setMembers(r.data))
      .catch((e) => setError(errorMessage(e)));
  }, [fetchProjects]);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = {
        ...form,
        endDate: form.endDate ? String(form.endDate).slice(0, 10) : null,
      };
      if (form._id) await api.put(`/projects/${form._id}`, payload);
      else await api.post('/projects', payload);
      setForm(null);
      await fetchProjects();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const changeRole = (id, role) => {
    const member = members.find((m) => m.id === id);
    setForm({
      ...form,
      members: [
        ...form.members.filter((m) => m.userId !== id),
        ...(role ? [{ userId: id, name: member.name, role }] : []),
      ],
    });
  };
  return (
    <div className="dashboard-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">TEAM WORKSPACE</p>
          <h1 className="page-title">프로젝트</h1>
          <p className="muted">연구 주제별로 노트를 모으고 참여 권한을 관리합니다.</p>
        </div>
        {user.role !== 'viewer' && (
          <button
            className="btn-primary"
            onClick={() =>
              setForm({
                name: '',
                description: '',
                endDate: '',
                members: [{ userId: user.id, name: user.name, role: 'manager' }],
              })
            }
          >
            ＋ 새 프로젝트
          </button>
        )}
      </div>
      {(error || loadError) && (
        <p className="error-banner" role="alert">
          {error || loadError}
        </p>
      )}
      <div className="project-grid">
        {projects.map((p) => (
          <section className="card" key={p._id}>
            <p className="eyebrow">PROJECT</p>
            <h2>{p.name}</h2>
            <p className="muted project-description">{p.description || '설명이 없습니다.'}</p>
            {p.endDate && <p>종료일: {new Date(p.endDate).toLocaleDateString()}</p>}
            <p>{p.members.length}명 참여</p>
            <div className="tag-list">
              {p.members.map((m) => (
                <span className="tag" key={m.userId}>
                  {m.name}
                </span>
              ))}
            </div>
            {(user.role === 'admin' ||
              p.members.some((m) => m.userId === user.id && m.role === 'manager')) && (
              <button className="btn-outline" onClick={() => setForm(p)}>
                프로젝트 관리
              </button>
            )}
          </section>
        ))}
      </div>
      {!projects.length && (
        <div className="card empty-state">
          프로젝트를 만들거나 관리자에게 참여 권한을 요청하세요.
        </div>
      )}
      {form && (
        <Modal
          title={form._id ? '프로젝트 관리' : '새 프로젝트'}
          busy={busy}
          onClose={() => setForm(null)}
        >
          <form onSubmit={save}>
            <div className="modal-body">
              {error && (
                <p className="error-banner" role="alert">
                  {error}
                </p>
              )}
              <label className="form-group">
                프로젝트 이름
                <input
                  required
                  className="form-input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label className="form-group">
                설명
                <textarea
                  className="form-input"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </label>
              <label className="form-group">
                과제 종료일 (선택)
                <input
                  type="date"
                  className="form-input"
                  value={form.endDate ? String(form.endDate).slice(0, 10) : ''}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                />
              </label>
              {form._id && (
                <>
                  <h3>참여자 권한</h3>
                  <p className="muted">멤버 등록은 연구실 멤버 화면에서 관리자가 진행합니다.</p>
                  {members.filter((m) => m.isActive !== false).map((m) => (
                    <label key={m.id} className="member-role-row">
                      <span>
                        {m.name}
                        <small>{m.email}</small>
                      </span>
                      <select
                        aria-label={`${m.name} 프로젝트 권한`}
                        disabled={m.id === user.id}
                        className="form-input"
                        value={form.members.find((x) => x.userId === m.id)?.role || ''}
                        onChange={(e) => changeRole(m.id, e.target.value)}
                      >
                        <option value="">미참여</option>
                        <option value="viewer">보기</option>
                        <option value="editor">편집</option>
                        <option value="manager">관리</option>
                      </select>
                    </label>
                  ))}
                </>
              )}
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
