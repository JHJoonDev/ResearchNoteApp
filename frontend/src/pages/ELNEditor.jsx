import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import useAppStore from '../store/useAppStore';
import useAuthStore from '../store/useAuthStore';

function ELNEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(window.location.search);
  const templateId = searchParams.get('templateId');

  const { 
    limsData, 
    elnData,
    fetchLimsData, 
    fetchElnData,
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
  const [tags, setTags] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [history, setHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  const [lastAutoSaved, setLastAutoSaved] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  
  const [reagentSearch, setReagentSearch] = useState('');
  const [selectedReagentId, setSelectedReagentId] = useState('');
  const [useAmount, setUseAmount] = useState(0);

  const textareaRef = useRef(null);
  const isEditMode = !!id;

  useEffect(() => {
    fetchLimsData();
    fetchElnData();
    if (isEditMode) {
      loadNote();
    } else if (templateId) {
      loadTemplate();
    }
  }, [id, templateId]);

  const loadTemplate = async () => {
    setIsLoading(true);
    const template = await fetchSingleNote(templateId);
    if (template) {
      setTitle(`${template.title} (복사본)`);
      setContent(template.content || '');
      // 템플릿의 소모 시약, 첨부파일은 가져갈 수 있도록 하되 상태는 진행중으로 리셋
      setReagentsUsed(template.reagentsUsed || []);
      setAttachments(template.attachments || []);
      setTags(template.tags || []);
    }
    setIsLoading(false);
  };

  // Auto-save timer (10 minutes = 600,000ms)
  useEffect(() => {
    const timer = setInterval(() => {
      if (title && content) {
          handleAutoSave();
      }
    }, 600000); 
    return () => clearInterval(timer);
  }, [title, content, reagentsUsed, attachments, tags]);

const loadNote = async () => {
    setIsLoading(true);
    const note = await fetchSingleNote(id);
    if (note) {
      setTitle(note.title);
      setContent(note.content || '');
      setReagentsUsed(note.reagentsUsed || []);
      setAttachments(note.attachments || []);
      setStatus(note.status);
      setTags(note.tags || []);
      setHistory(note.history || []);
    } else {
      alert('노트를 불러올 수 없습니다.');
      navigate('/eln');
    }
    setIsLoading(false);
  };

  const handleAutoSave = async () => {
    const noteData = { title, author: userName, content, reagentsUsed, attachments, status, editorName: userName, tags };
    try {
      if (isEditMode) {
        await updateElnNote(id, noteData);
      } else {
        const res = await createElnNote({ ...noteData, history: [] });
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
      status,
      editorName: userName,
      tags
    };

    setIsLoading(true);
    try {
      if (isEditMode) {
        await updateElnNote(id, noteData);
      } else {
        await createElnNote({ ...noteData, history: [] });
      }
      alert('저장되었습니다.');
      navigate('/eln');
    } catch (err) {
      alert('저장 도중 오류가 발생했습니다.');
    }
    setIsLoading(false);
  };

  const handleSaveAsTemplate = async () => {
    if (!title) {
      alert('템플릿 제목을 입력해 주세요 (현재 제목 기반으로 복사됩니다).');
      return;
    }
    const noteData = {
      title: `${title} (템플릿)`,
      author: userName,
      content,
      reagentsUsed,
      attachments,
      status: '진행중',
      isTemplate: true,
      history: [],
      tags
    };
    setIsLoading(true);
    try {
      await createElnNote(noteData);
      alert('템플릿으로 저장되었습니다.');
    } catch (err) {
      alert('템플릿 저장 도중 오류가 발생했습니다.');
    }
    setIsLoading(false);
  };
  
  const handleRestoreVersion = (v) => {
    if (window.confirm(`버전 ${v.version}으로 복원하시겠습니까? 현재 작성 중인 내용은 덮어씌워집니다.`)) {
      setTitle(v.title || title);
      setContent(v.content || '');
      setShowHistory(false);
      alert(`버전 ${v.version} 내용이 에디터에 로드되었습니다. '저장하기'를 누르면 최종 반영됩니다.`);
    }
  };

  const handleExportPDF = () => {
    const element = document.getElementById('eln-printable-area');
    if (!element) {
      alert('인쇄할 내용을 찾을 수 없습니다.');
      return;
    }

    setIsLoading(true);
    import('html2pdf.js').then((m) => {
      const html2pdf = m.default;
      const opt = {
        margin:       10,
        filename:     `${title}_연구노트.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };
      return html2pdf().set(opt).from(element).save();
    }).then(() => {
      setIsLoading(false);
    }).catch(err => {
      console.error("PDF Export failed", err);
      setIsLoading(false);
      alert('PDF 생성 도중 오류가 발생했습니다.');
    });
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

  const handleTagInputKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = tagInput.trim();
      if (val && !tags.includes(val)) {
        setTags([...tags, val]);
      }
      setTagInput('');
    }
  };

  const removeTag = (tagToRemove) => {
    setTags(tags.filter(t => t !== tagToRemove));
  };

  // Cross-reference: parse [[Title]] and convert to links
  const renderContentWithRefs = (html) => {
    if (!html) return '';
    return html.replace(/\[\[([^\]]+)\]\]/g, (match, noteTitle) => {
      const found = elnData.find(n => n.title === noteTitle && n.id !== id);
      if (found) {
        return `<a href="/eln/${found.id}" class="cross-ref-link" title="참조 노트: ${noteTitle}">📎 ${noteTitle}</a>`;
      }
      return `<span class="cross-ref-broken" title="존재하지 않는 노트">⚠️ ${noteTitle}</span>`;
    });
  };

  // Find backlinks: other notes that reference this note's title
  const backlinks = isEditMode ? elnData.filter(n => 
    n.id !== id && n.content && n.content.includes(`[[${title}]]`)
  ) : [];

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
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <span className={`item-status status-${status === '승인됨' ? 'done' : 'progress'}`}>{status}</span>
            <button className="btn-outline" onClick={() => setShowHistory(!showHistory)} title="버전 이력 보기">
              <i className="fa-solid fa-clock-rotate-left"></i> 이력
            </button>
            <button className="btn-outline" onClick={handleSaveAsTemplate} title="템플릿으로 저장">
              <i className="fa-solid fa-copy"></i> 템플릿화
            </button>
            {status === '승인됨' && (
              <button className="btn-outline" onClick={handleExportPDF} title="PDF 다운로드">
                <i className="fa-solid fa-file-pdf"></i> PDF 저장
              </button>
            )}
            <button className="editor-save-btn" onClick={handleSave}>
              <i className="fa-solid fa-save"></i> 저장하기
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
          <input 
            type="text" 
            className="editor-title-input" 
            placeholder="실험 제목을 입력하세요..." 
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ marginBottom: 0, flex: 1 }}
          />
          <button className={`btn-icon ${isPreview ? 'active' : ''}`} title="Preview" onClick={() => setIsPreview(!isPreview)} style={{ width: 'auto', padding: '0 1rem', borderRadius: '12px', height: '48px', display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0, background: 'var(--bg-color)', border: '1px solid var(--border-color)' }}>
              <i className={`fa-solid ${isPreview ? 'fa-eye-slash' : 'fa-eye'}`} style={{ color: 'var(--primary-color)' }}></i> 
              <span style={{ fontWeight: '600', fontSize: '0.95rem' }}>{isPreview ? '편집' : '미리보기'}</span>
          </button>
        </div>

        <div className="editor-tags-area" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem', alignItems: 'center' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <i className="fa-solid fa-tags"></i> 태그:
          </div>
          {tags.map(tag => (
            <span key={tag} className="tag-badge" style={{ 
              backgroundColor: 'rgba(var(--primary-color-rgb), 0.1)', 
              color: 'var(--primary-color)', 
              padding: '0.2rem 0.6rem', 
              borderRadius: '20px', 
              fontSize: '0.8rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem',
              fontWeight: '500'
            }}>
              #{tag}
              {!isPreview && <i className="fa-solid fa-xmark" style={{ cursor: 'pointer', fontSize: '0.7rem' }} onClick={() => removeTag(tag)}></i>}
            </span>
          ))}
          {!isPreview && (
            <input 
              type="text" 
              placeholder="태그 입력 (엔터/콤마)..."
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagInputKeyDown}
              style={{ 
                border: 'none', 
                background: 'transparent', 
                fontSize: '0.85rem', 
                outline: 'none', 
                color: 'var(--text-main)',
                minWidth: '150px'
              }}
            />
          )}
        </div>

        <div className="editor-content-wrapper" style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
          {/* Printable Area (Always in DOM for PDF export, but hidden if not in preview) */}
          <div 
            id="eln-printable-area" 
            className="ql-container ql-snow" 
            style={{ 
              flex: 1, 
              display: isPreview ? 'flex' : 'none', 
              flexDirection: 'column', 
              border: '1px solid var(--border-color)', 
              borderRadius: '8px', 
              backgroundColor: 'var(--surface-color)' 
            }}
          >
            {/* PDF 인쇄 시 헤더 공간 */}
            <div style={{ display: 'none' }} className="pdf-header-print-only">
              <h1>{title}</h1>
              <p>작성자: {userName} | 상태: {status}</p>
              <hr/>
            </div>
            <div 
              className="ql-editor eln-preview" 
              dangerouslySetInnerHTML={{ __html: renderContentWithRefs(content) }} 
              style={{ padding: '1.5rem', minHeight: '500px' }}
            >
            </div>
          </div>

          {!isPreview && (
            <div style={{ flex: 1, minHeight: '500px', display: 'flex', flexDirection: 'column' }}>
              <ReactQuill 
                theme="snow"
                value={content}
                modules={{
                  toolbar: [
                    [{ 'header': [1, 2, 3, false] }],
                    ['bold', 'italic', 'underline', 'strike', 'blockquote'],
                    [{'list': 'ordered'}, {'list': 'bullet'}],
                    [{ 'script': 'sub'}, { 'script': 'super' }],
                    [{ 'indent': '-1'}, { 'indent': '+1' }], 
                    ['link', 'image'],
                    ['clean']
                  ]
                }}
                onChange={setContent}
                style={{ flex: 1, height: '100%', minHeight: '500px', backgroundColor: 'var(--surface-color)' }}
                placeholder="연구 내용을 자유롭게 기록하세요..."
              />
            </div>
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
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface-color)', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.8rem' }}>
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
            
            <div style={{ maxHeight: '150px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px', background: 'var(--surface-color)' }}>
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
                    borderBottom: '1px solid var(--border-color)',
                    background: selectedReagentId === item.id ? 'var(--bg-color)' : 'transparent',
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
              <div key={idx} className="reagent-tag" style={{ border: '1px solid var(--border-color)', color: 'var(--text-main)', borderRadius: '8px', width: '100%', justifyContent: 'space-between', padding: '0.4rem' }}>
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

          {/* Cross-Reference Section */}
          <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
            <h3 style={{ fontSize: '0.95rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <i className="fa-solid fa-link" style={{ color: 'var(--primary-color)' }}></i> 상호 참조
            </h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
              다른 노트를 참조하려면 본문에 <code style={{ background: 'var(--bg-color)', padding: '0.1rem 0.3rem', borderRadius: '4px' }}>[[노트 제목]]</code>을 입력하세요.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', maxHeight: '150px', overflowY: 'auto', marginTop: '0.5rem' }}>
              {elnData.filter(n => !n.isTemplate && n.id !== id).slice(0, 8).map(note => (
                <button 
                  key={note.id} 
                  className="btn-outline"
                  style={{ fontSize: '0.75rem', padding: '0.3rem 0.5rem', textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  onClick={() => {
                    const ref = `[[${note.title}]]`;
                    setContent(prev => prev + `<p>${ref}</p>`);
                  }}
                  title={`클릭하여 "${note.title}" 참조 삽입`}
                >
                  <i className="fa-regular fa-file-lines" style={{ marginRight: '0.3rem' }}></i>
                  {note.title}
                </button>
              ))}
            </div>

            {/* Backlinks */}
            {backlinks.length > 0 && (
              <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
                <h4 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  <i className="fa-solid fa-arrow-left" style={{ marginRight: '0.3rem' }}></i> 역참조 ({backlinks.length})
                </h4>
                {backlinks.map(bl => (
                  <div
                    key={bl.id}
                    style={{ fontSize: '0.8rem', padding: '0.3rem 0.5rem', cursor: 'pointer', color: 'var(--primary-color)', borderRadius: '4px' }}
                    onClick={() => navigate(`/eln/${bl.id}`)}
                  >
                    📎 {bl.title}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* History (Audit Trail) Sidebar Overlay */}
      {showHistory && (
        <div className="history-sidebar" style={{ 
            position: 'absolute', top: 0, right: 0, width: '350px', height: '100%', 
            background: 'var(--surface-color)', borderLeft: '1px solid var(--border-color)', 
            boxShadow: '-4px 0 15px rgba(0,0,0,0.1)', zIndex: 100, display: 'flex', flexDirection: 'column' 
          }}>
          <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem' }}><i className="fa-solid fa-clock-rotate-left"></i> 버전 이력 (Audit Trail)</h3>
            <button className="btn-icon" onClick={() => setShowHistory(false)}><i className="fa-solid fa-xmark"></i></button>
          </div>
          <div style={{ flex: 1, padding: '1rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {history.length === 0 ? (
              <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '2rem' }}>기록된 이력이 없습니다.</p>
            ) : (
              [...history].reverse().map((h, i) => (
                <div key={i} style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '1rem', background: 'var(--bg-color)', position: 'relative' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                    <span style={{ fontWeight: 'bold', color: 'var(--primary-color)', fontSize: '0.9rem' }}>Version {h.version}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{new Date(h.updatedAt).toLocaleString()}</span>
                  </div>
                  <div style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                    <strong>수정자:</strong> {h.updatedBy || '알 수 없음'} <br/>
                    <strong>제목:</strong> {h.title}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button 
                      className="btn-outline" 
                      style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', flex: 1 }}
                      onClick={() => handleRestoreVersion(h)}
                    >
                      <i className="fa-solid fa-undo"></i> 복원하기
                    </button>
                    <button 
                      className="btn-outline" 
                      style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', flex: 1 }}
                      onClick={() => {
                        const win = window.open('', '_blank');
                        win.document.write(`<html><head><title>Version ${h.version} Preview</title><style>body{font-family:sans-serif;padding:40px;} .content{border:1px solid #ddd;padding:20px;}</style></head><body><h1>${h.title}</h1><div class="content">${h.content}</div></body></html>`);
                      }}
                    >
                      <i className="fa-solid fa-eye"></i> 내용 보기
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ELNEditor;
