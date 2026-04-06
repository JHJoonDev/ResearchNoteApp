import express from 'express';
import ElnNote from '../models/ElnNote.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const notes = await ElnNote.find().sort({ createdAt: -1 });
    // Transform response so the frontend that expects 'id' is compatible
    const formattedNotes = notes.map(n => ({
      id: n._id,
      title: n.title,
      author: n.author,
      date: n.date,
      status: n.status,
      content: n.content,
      reagentsUsed: n.reagentsUsed || []
    }));
    res.json(formattedNotes);
  } catch (err) {
    res.status(500).json({ error: '데이터 로드 실패' });
  }
});

router.post('/', async (req, res) => {
  const { title, author, content, reagentsUsed } = req.body;
  try {
    const newNote = new ElnNote({
      title,
      author,
      content,
      reagentsUsed: reagentsUsed || [],
      date: new Date().toISOString().split('T')[0],
      status: '진행중'
    });
    
    const savedNote = await newNote.save();

    // Deduct stock from LimsItem
    if (reagentsUsed && reagentsUsed.length > 0) {
      for (const reagent of reagentsUsed) {
        await LimsItem.findByIdAndUpdate(
          reagent.reagentId,
          { $inc: { stockValue: -reagent.amount } }
        );
      }
    }

    res.status(201).json({
      id: savedNote._id,
      title: savedNote.title,
      author: savedNote.author,
      date: savedNote.date,
      status: savedNote.status,
      content: savedNote.content,
      reagentsUsed: savedNote.reagentsUsed
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: '데이터 저장 및 재고 차감 실패' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const updatedNote = await ElnNote.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({
      id: updatedNote._id,
      title: updatedNote.title,
      author: updatedNote.author,
      date: updatedNote.date,
      status: updatedNote.status,
      content: updatedNote.content
    });
  } catch (err) {
    res.status(400).json({ error: '데이터 수정 실패' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await ElnNote.findByIdAndDelete(req.params.id);
    res.json({ message: '삭제 완료' });
  } catch (err) {
    res.status(400).json({ error: '데이터 삭제 실패' });
  }
});

export default router;
