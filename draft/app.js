document.addEventListener('DOMContentLoaded', () => {
    // Note generation mock action
    const newNoteBtn = document.getElementById('btn-new-note');
    if (newNoteBtn) {
        newNoteBtn.addEventListener('click', () => {
            alert('새로운 웹 에디터가 열립니다. (연구노트 작성 모듈 연결 예정)');
        });
    }

    // Interactive hover logs
    const inventoryBtns = document.querySelectorAll('.btn-outline');
    inventoryBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = e.target.textContent;
            if (action.includes('주문')) {
                alert('구매/발주 관리 페이지로 이동합니다.');
            } else if (action.includes('폐기')) {
                alert('안전관리 가이드에 따라 폐기 트랜잭션을 기록합니다.');
            }
        });
    });
});
