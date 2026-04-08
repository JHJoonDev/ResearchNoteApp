import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useAppStore from '../store/useAppStore';
import useAuthStore from '../store/useAuthStore';

function ELNEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { 
    limsData, 
    fetchLimsData, 
    fetchSingleNote, 
    createElnNote, 
    updateElnNote 
  } = useAppStore();
  
  const user = useAuthStore(state => state.user);
  const userName = user?.name || '연구원';

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [reagentsUsed, setReagentsUsed] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [status, setStatus] = useState('진행중');
  const [isLoading, setIsLoading] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  const [lastAutoSaved, setLastAutoSaved] = useState(null);
  
  const [reagentSearch, setReagentSearch] = useState('');
  const [selectedReagentId, setSelectedReagentId] = useState('');
  const [useAmount, setUseAmount] = useState(0);

  const textareaRef = useRef(null);
  const isEditMode = !!id;

  useEffect(() => {
    fetchLimsData();
    if (isEditMode) {
      loadNote();
    }
  }, [id]);

  // Auto-save timer (10 minutes = 600,000ms)
  useEffect(() => {
    const timer = setInterval(() => {
      if (title && content) {
          handleAutoSave();
      }
    }, 600000); 
    return () => clearInterval(timer);
  }, [title, content, reagentsUsed, attachments]);

  const loadNote = async () => {
    setIsLoading(true);
    const note = await fetchSingleNote(id);
    if (note) {
      setTitle(note.title);
      setContent(note.content || '');
      setReagentsUsed(note.reagentsUsed || []);
      setAttachments(note.attachments || []);
      setStatus(note.status);
    } else {
      alert('노트를 불러올 수 없습니다.');
      navigate('/eln');
    }
    setIsLoading(false);
  };

  const handleAutoSave = async () => {
    const noteData = { title, author: userName, content, reagentsUsed, attachments, status };
    try {
      if (isEditMode) {
        await updateElnNote(id, noteData);
      } else {
        const res = await createElnNote(noteData);
        if (res?.id) navigate(`/eln/${res.id}`, { replace: true });
      }
      setLastAutoSaved(new Date().toLocaleTimeString());
    } catch (err) {
      console.error('Auto-save failed');
    }
  };

  const handleSave = async () => {
    if (!title) {
      alert('제목을 입력해 주세요.');
      return;
    }

    const noteData = {
      title,
      author: userName,
      content,
      reagentsUsed,
      attachments,
      status
    };

    setIsLoading(true);
    try {
      if (isEditMode) {
        await updateElnNote(id, noteData);
      } else {
        await createElnNote(noteData);
      }
      alert('저장되었습니다.');
      navigate('/eln');
    } catch (err) {
      alert('저장 도중 오류가 발생했습니다.');
    }
    setIsLoading(false);
  };

  const injectTag = (tag, closingTag = null) => {
    if (!textareaRef.current) return;
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const text = textareaRef.current.value;
    const before = text.substring(0, start);
    const after = text.substring(end, text.length);
    const selection = text.substring(start, end);
    
    let newText;
    if (closingTag) {
        newText = `${before}${tag}${selection}${closingTag}${after}`;
    } else {
        newText = `${before}<${tag}>${selection}</${tag}>${after}`;
    }
    
    setContent(newText);
    textareaRef.current.focus();
  };

  const handleAddReagent = () => {
    if (!selectedReagentId || useAmount <= 0) {
        console.warn('Selection missing or amount invalid:', { selectedReagentId, useAmount });
        return;
    }
    
    const item = limsData.find(i => i.id === selectedReagentId);
    if (!item) {
        console.error('Reagent not found in limsData:', selectedReagentId);
        return;
    }

    const newReagent = {
      reagentId: item.id,
      name: item.name,
      amount: Number(useAmount),
      unit: item.unit
    };

    console.log('Adding reagent:', newReagent);
    setReagentsUsed(prev => [...prev, newReagent]);
    setSelectedReagentId('');
    setUseAmount(0);
  };

  const handleRemoveReagent = (idx) => {
    setReagentsUsed(reagentsUsed.filter((_, i) => i !== idx));
  };

  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files);
    const newAttachments = files.map(file => ({
        name: file.name,
        size: Math.round(file.size / 1024), 
        type: file.type,
        url: '#', // Mock URL
        uploadedAt: new Date()
    }));
    setAttachments([...attachments, ...newAttachments]);
  };

  const handleRemoveAttachment = (idx) => {
    setAttachments(attachments.filter((_, i) => i !== idx));
  };

  const filteredReagents = limsData.filter(item => 
    item.name.toLowerCase().includes(reagentSearch.toLowerCase()) || 
    item.cas?.includes(reagentSearch)
  );

  return (
    <div className="editor-page-container">
      <div className="editor-main-area">
        <div className="editor-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button className="btn-icon" onClick={() => navigate('/eln')}>
              <i className="fa-solid fa-arrow-left"></i>
            </button>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              연구노트 / {isEditMode ? '노트 편집' : '새 노트 작성'}
              {lastAutoSaved && <span style={{ marginLeft: '1rem', color: 'var(--success)', fontSize: '0.8rem' }}><i className="fa-solid fa-check-circle"></i> {lastAutoSaved}에 자동 저장됨</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <span className={`item-status status-${status === '승인됨' ? 'done' : 'progress'}`}>{status}</span>
            <button className="editor-save-btn" onClick={handleSave}>
              <i className="fa-solid fa-save"></i> 저장하기
            </button>
          </div>
        </div>

        <input 
          type="text" 
          className="editor-title-input" 
          placeholder="실험 제목을 입력하세요..." 
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <div className="editor-toolbar" style={{ borderBottom: '1px solid var(--border-color)', marginBottom: '1rem', display: 'flex', gap: '0.5rem', paddingBottom: '0.5rem' }}>
            <button className="btn-icon" title="Bold" onClick={() => injectTag('strong')}><i className="fa-solid fa-bold"></i></button>
            <button className="btn-icon" title="Italic" onClick={() => injectTag('em')}><i className="fa-solid fa-italic"></i></button>
            <button className="btn-icon" title="Header" onClick={() => injectTag('h2')}><i className="fa-solid fa-heading"></i></button>
            <button className="btn-icon" title="List" onClick={() => injectTag('ul><li>', '</li></ul>')}><i className="fa-solid fa-list"></i></button>
            <div style={{ width: '1px', background: '#E5E7EB', margin: '0 0.5rem' }}></div>
            <button className={`btn-icon ${isPreview ? 'active' : ''}`} title="Preview" onClick={() => setIsPreview(!isPreview)}>
                <i className={`fa-solid ${isPreview ? 'fa-eye-slash' : 'fa-eye'}`}></i> {isPreview ? '편집' : '미리보기'}
            </button>
        </div>

        <div className="editor-content-wrapper" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {isPreview ? (
            <div 
              className="ql-editor" 
              dangerouslySetInnerHTML={{ __html: content }} 
              style={{ padding: '0', minHeight: '500px', backgroundColor: 'transparent', outline: 'none' }}
            >
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              className="editor-textarea"
              placeholder="연구 내용을 자유롭게 기록하세요... (HTML 태그 지원)"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              style={{ 
                flex: 1, 
                width: '100%', 
                border: 'none', 
                outline: 'none', 
                fontSize: '1.1rem', 
                lineHeight: '1.8', 
                color: '#374151',
                resize: 'none',
                minHeight: '500px',
                fontFamily: 'inherit'
              }}
            />
          )}
        </div>
      </div>

      <aside className="editor-sidebar">
        <div className="sidebar-widget">
          <h3><i className="fa-solid fa-paperclip"></i> 첨부 파일</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <label className="btn-secondary" style={{ cursor: 'pointer', textAlign: 'center', fontSize: '0.85rem', display: 'block' }}>
                <i className="fa-solid fa-upload"></i> 파일 업로드
                <input type="file" multiple onChange={handleFileUpload} style={{ display: 'none' }} />
            </label>
            <div className="attachment-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {attachments.map((file, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white', padding: '0.5rem', borderRadius: '6px', border: '1px solid #E5E7EB', fontSize: '0.8rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', overflow: 'hidden' }}>
                            <i className="fa-regular fa-file" style={{ color: 'var(--primary-color)' }}></i>
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.name} ({file.size}KB)</span>
                        </div>
                        <button onClick={() => handleRemoveAttachment(idx)} style={{ color: 'var(--danger)', border: 'none', background: 'none', cursor: 'pointer' }}>&times;</button>
                    </div>
                ))}
                {attachments.length === 0 && <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem', padding: '0.5rem' }}>첨부된 파일이 없습니다.</div>}
            </div>
          </div>
        </div>

        <div className="sidebar-widget">
          <h3><i className="fa-solid fa-flask-vial"></i> 소모 시약 내역</h3>
          <div className="reagent-selector-mini">
            <div className="search-bar" style={{ width: '100%', borderRadius: '8px', padding: '0.4rem 0.8rem' }}>
              <i className="fa-solid fa-magnifying-glass"></i>
              <input 
                type="text" 
                placeholder="시약 이름 검색..." 
                value={reagentSearch}
                onChange={(e) => setReagentSearch(e.target.value)}
                style={{ fontSize: '0.85rem' }}
              />
            </div>
            
            <div style={{ maxHeight: '150px', overflowY: 'auto', border: '1px solid #E5E7EB', borderRadius: '8px', background: 'white' }}>
              {filteredReagents.map(item => (
                <div 
                  key={item.id} 
                  onClick={() => {
                      setSelectedReagentId(item.id);
                      if (useAmount <= 0) setUseAmount(0.1);
                  }}
                  style={{ 
                    padding: '0.5rem', 
                    cursor: 'pointer', 
                    borderBottom: '1px solid #F3F4F6',
                    background: selectedReagentId === item.id ? '#EFF6FF' : 'transparent',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <div style={{ fontSize: '0.8rem' }}>
                    <div style={{ fontWeight: '600' }}>{item.name}</div>
                  </div>
                  <span className={`stock-indicator ${item.stockValue > 10 ? 'stock-high' : item.stockValue > 0 ? 'stock-low' : 'stock-none'}`} style={{ fontSize: '0.7rem' }}>
                    {item.stockValue} {item.unit}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <input 
                type="number" 
                className="form-input" 
                placeholder="사용량" 
                value={useAmount}
                onChange={(e) => setUseAmount(e.target.value)}
                style={{ flex: 1, fontSize: '0.8rem' }}
              />
              <button 
                className="btn-primary" 
                style={{ padding: '0 0.75rem', fontSize: '0.8rem' }}
                onClick={handleAddReagent}
              >추가</button>
            </div>
          </div>

          <div className="reagent-tag-list" style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {reagentsUsed.map((r, idx) => (
              <div key={idx} className="reagent-tag" style={{ border: '1px solid #E5E7EB', color: 'var(--text-main)', borderRadius: '8px', width: '100%', justifyContent: 'space-between', padding: '0.4rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}>
                    <i className="fa-solid fa-vial" style={{ color: 'var(--primary-color)' }}></i>
                    <span>{r.name} <strong>{r.amount}{r.unit}</strong></span>
                </div>
                <button type="button" onClick={() => handleRemoveReagent(idx)} style={{ color: 'var(--danger)' }}>&times;</button>
              </div>
            ))}
          </div>
           <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.75rem', lineHeight: '1.4' }}>
            <i className="fa-solid fa-info-circle"></i> 시약 재고는 연구노트 <strong>승인 완료</strong> 시점에 실제 차감됩니다.
          </p>
        </div>
      </aside>
    </div>
  );
}

export default ELNEditor;
