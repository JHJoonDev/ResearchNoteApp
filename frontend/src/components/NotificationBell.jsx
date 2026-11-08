import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';

export default function NotificationBell() {
  const [data, setData] = useState({ items: [], unread: 0 });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      const response = await api.get('/notifications?page=1&limit=10');
      setData({ items: response.data.items || [], unread: response.data.unread || 0 });
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    const initialTimer = window.setTimeout(refresh, 0);
    const timer = window.setInterval(refresh, 30_000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  const markRead = async (item) => {
    if (!item.readAt) {
      try {
        await api.post(`/notifications/${item.id || item._id}/read`, {});
        await refresh();
      } catch (e) {
        setError(errorMessage(e));
      }
    }
    setOpen(false);
  };
  const markAllRead = async () => {
    try {
      await api.post('/notifications/read-all', {});
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="notification-menu">
      <button
        className="notification-trigger"
        aria-label={`알림 ${data.unread}건`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        알림{data.unread > 0 && <span className="notification-count">{data.unread}</span>}
      </button>
      {open && (
        <section className="notification-popover" aria-label="알림 목록">
          <div className="card-header">
            <strong>알림</strong>
            <button className="btn-outline" disabled={!data.unread} onClick={markAllRead}>
              모두 읽음
            </button>
          </div>
          {error && <p role="alert" className="error-banner">{error}</p>}
          {data.items.length ? (
            data.items.map((item) => (
              <Link
                className={`notification-item ${item.readAt ? '' : 'is-unread'}`}
                key={item.id || item._id}
                to={item.noteId ? `/eln?noteId=${encodeURIComponent(item.noteId)}` : '/approvals'}
                onClick={() => markRead(item)}
              >
                <span>{item.message || '새 알림'}</span>
                <small>{item.actorName || ''} · {item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}</small>
              </Link>
            ))
          ) : (
            <p className="muted">새 알림이 없습니다.</p>
          )}
        </section>
      )}
    </div>
  );
}
