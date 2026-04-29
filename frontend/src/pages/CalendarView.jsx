import React, { useEffect, useState, useMemo } from 'react';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import format from 'date-fns/format';
import parse from 'date-fns/parse';
import startOfWeek from 'date-fns/startOfWeek';
import getDay from 'date-fns/getDay';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import useAppStore from '../store/useAppStore';
import { useNavigate } from 'react-router-dom';

import { ko } from 'date-fns/locale';

const locales = {
  'ko': ko
};

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales,
});

function CalendarView() {
  const { elnData, limsData, fetchElnData, fetchLimsData } = useAppStore();
  const navigate = useNavigate();

  useEffect(() => {
    fetchElnData();
    fetchLimsData(1, 1000); // Fetch all lims items for calendar
  }, [fetchElnData, fetchLimsData]);

  const events = useMemo(() => {
    const elnEvents = elnData.map(note => ({
      id: `eln-${note.id}`,
      title: `[연구노트] ${note.title} (${note.status})`,
      start: new Date(note.date),
      end: new Date(note.date),
      allDay: true,
      resource: note,
      type: 'eln'
    }));

    const limsEvents = limsData.filter(item => item.expiryDate).map(item => ({
      id: `lims-${item.id}`,
      title: `[만료 예정] ${item.name}`,
      start: new Date(item.expiryDate),
      end: new Date(item.expiryDate),
      allDay: true,
      resource: item,
      type: 'lims'
    }));

    return [...elnEvents, ...limsEvents];
  }, [elnData, limsData]);

  const handleSelectEvent = (event) => {
    if (event.type === 'eln') {
      navigate(`/eln/${event.resource.id}`);
    } else if (event.type === 'lims') {
      navigate(`/lims`);
    }
  };

  const eventStyleGetter = (event) => {
    let backgroundColor = '#3174ad';
    if (event.type === 'lims') {
      backgroundColor = '#dc2626'; // red for expiry
    } else if (event.resource.status === '승인됨') {
      backgroundColor = '#059669'; // green for approved
    } else if (event.resource.status === '반려') {
      backgroundColor = '#b91c1c'; // dark red for rejected
    } else if (event.resource.status === '1차 승인') {
      backgroundColor = '#d97706'; // orange for 1st approved
    }
    return {
      style: {
        backgroundColor,
        borderRadius: '4px',
        opacity: 0.8,
        color: 'white',
        border: '0px',
        display: 'block'
      }
    };
  };

  return (
    <div className="dashboard-content">
      <div className="card-header" style={{ marginBottom: '1.5rem' }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>일정 캘린더</h1>
      </div>
      <div className="card" style={{ padding: '1rem', height: '700px' }}>
        <Calendar
          localizer={localizer}
          events={events}
          startAccessor="start"
          endAccessor="end"
          style={{ height: '100%' }}
          culture="ko"
          onSelectEvent={handleSelectEvent}
          eventPropGetter={eventStyleGetter}
          views={['month', 'week', 'day']}
          messages={{
            today: '오늘',
            previous: '이전',
            next: '다음',
            month: '월',
            week: '주',
            day: '일'
          }}
        />
      </div>
    </div>
  );
}

export default CalendarView;
