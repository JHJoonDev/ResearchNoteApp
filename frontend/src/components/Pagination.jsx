export default function Pagination({ page, limit, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <nav className="pagination" aria-label="페이지 이동">
      <button className="btn-outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        이전
      </button>
      <span>
        {page} / {pages} · {total}건
      </span>
      <button className="btn-outline" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        다음
      </button>
    </nav>
  );
}
