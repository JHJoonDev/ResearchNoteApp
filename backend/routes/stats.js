import express from 'express';
import ElnNote from '../models/ElnNote.js';
import LimsItem from '../models/LimsItem.js';

const router = express.Router();

// GET /api/stats — 대시보드용 통합 통계
router.get('/', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let query = { isTemplate: { $ne: true } };
    
    if (startDate && endDate) {
      // Set time to beginning of start date and end of end date
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      
      query.createdAt = {
        $gte: start,
        $lte: end
      };
    }

    const notes = await ElnNote.find(query).sort({ createdAt: -1 });
    const items = await LimsItem.find();

    // 1. 결재 현황 (파이 차트용)
    const statusCounts = { '진행중': 0, '1차 승인': 0, '승인됨': 0, '반려': 0 };
    notes.forEach(n => {
      if (statusCounts[n.status] !== undefined) statusCounts[n.status]++;
    });
    const approvalStats = Object.entries(statusCounts).map(([name, value]) => ({ name, value }));

    // 2. 월별 연구노트 작성 추이 (라인 차트용, 최근 6개월)
    const now = new Date();
    const monthlyTrend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = `${d.getMonth() + 1}월`;
      const count = notes.filter(n => {
        if (!n.date) return false;
        return n.date.startsWith(yearMonth);
      }).length;
      monthlyTrend.push({ month: label, count });
    }

    // 3. 시약 소비 Top 5 (바 차트용) - 연구노트에서 사용된 시약 집계
    const reagentUsage = {};
    notes.forEach(n => {
      (n.reagentsUsed || []).forEach(r => {
        const name = r.name || r.reagentName || 'Unknown';
        if (!reagentUsage[name]) reagentUsage[name] = 0;
        reagentUsage[name] += (r.amount || 0);
      });
    });
    const reagentTop5 = Object.entries(reagentUsage)
      .map(([name, usage]) => ({ name, usage: Math.round(usage * 100) / 100 }))
      .sort((a, b) => b.usage - a.usage)
      .slice(0, 5);

    // 4. 연구원별 활동량 (작성 건수)
    const authorCounts = {};
    notes.forEach(n => {
      if (!authorCounts[n.author]) authorCounts[n.author] = 0;
      authorCounts[n.author]++;
    });
    const authorRanking = Object.entries(authorCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // 5. 재고 현황 요약
    const inventorySummary = {
      total: items.length,
      good: items.filter(i => i.status === '양호').length,
      low: items.filter(i => i.status === '부족').length,
      expiring: items.filter(i => i.status === '만료 예정').length,
      expired: items.filter(i => i.status === '만료').length,
    };

    res.json({
      approvalStats,
      monthlyTrend,
      reagentTop5,
      authorRanking,
      inventorySummary,
      totalNotes: notes.length,
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: '통계 데이터 로드 실패' });
  }
});

export default router;
