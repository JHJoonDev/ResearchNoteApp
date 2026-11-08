/**
 * @fileoverview 자동완성 제안 팝업 및 키보드 탐색 렌더러
 */

import React, { useState, useEffect, forwardRef, useImperativeHandle } from 'react';

export const SuggestionList = forwardRef(({ items, command, char }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  const selectItem = (index) => {
    const item = items[index];
    if (item) {
      command(item);
    }
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((prev) => (prev + items.length - 1) % items.length);
        return true;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % items.length);
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        selectItem(selectedIndex);
        return true;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        return true;
      }
      return false;
    },
  }));

  if (!items || items.length === 0) {
    return (
      <div className="note-suggestion-popup is-empty">
        <div className="suggestion-item no-result">검색 결과가 없습니다.</div>
      </div>
    );
  }

  const getPrefix = () => {
    if (char === '@') return '👤 ';
    if (char === '#') return '📄 ';
    if (char === '$') return '🧪 ';
    return '';
  };

  return (
    <div className="note-suggestion-popup" role="listbox">
      {items.map((item, index) => (
        <button
          key={item.id || item.userId || item.noteId || item.reagentId || index}
          type="button"
          className={`suggestion-item ${index === selectedIndex ? 'is-selected' : ''}`}
          onClick={() => selectItem(index)}
          onMouseEnter={() => setSelectedIndex(index)}
        >
          <span className="suggestion-icon">{getPrefix()}</span>
          <span className="suggestion-label">{item.label || item.name || item.title}</span>
        </button>
      ))}
    </div>
  );
});
