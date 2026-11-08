import express from 'express';
import mongoose from 'mongoose';
import Experiment from '../models/Experiment.js';
import { auth, writer } from '../middleware/auth.js';
import { audit, fail, objectId, projectAccess, text } from '../lib/core.js';

const router = express.Router();

router.get('/projects/:id/experiments', auth, async (req, res) => {
  const project = await projectAccess(req.user, req.params.id);
  res.json(await Experiment.find({ projectId: project._id, isDeleted: false }).sort({ updatedAt: -1 }));
});

router.post('/projects/:id/experiments', auth, writer, async (req, res) => {
  let experiment;
  await mongoose.connection.transaction(async (session) => {
    const project = await projectAccess(req.user, req.params.id, true, session);
    [experiment] = await Experiment.create([{ projectId: project._id, name: text(req.body.name, '실험명', 200), description: text(req.body.description || '', '설명', 4000, false), status: 'active' }], { session });
    await audit(req, 'EXPERIMENT_CREATE', 'EXPERIMENT', experiment, null, session);
  });
  res.status(201).json(experiment);
});

router.put('/experiments/:id', auth, writer, async (req, res) => {
  let experiment;
  await mongoose.connection.transaction(async (session) => {
    experiment = await Experiment.findOne({ _id: objectId(req.params.id), isDeleted: false }).session(session);
    if (!experiment) fail(404, '실험이 없습니다.');
    await projectAccess(req.user, experiment.projectId, true, session);
    const before = experiment.toObject();
    if (req.body.name !== undefined) experiment.name = text(req.body.name, '실험명', 200);
    if (req.body.description !== undefined) experiment.description = text(req.body.description || '', '설명', 4000, false);
    if (req.body.status !== undefined) {
      if (!['active', 'done', 'archived'].includes(req.body.status)) fail(400, '실험 상태를 확인해주세요.');
      experiment.status = req.body.status;
    }
    await experiment.save({ session });
    await audit(req, 'EXPERIMENT_UPDATE', 'EXPERIMENT', experiment, before, session);
  });
  res.json(experiment);
});

router.delete('/experiments/:id', auth, writer, async (req, res) => {
  await mongoose.connection.transaction(async (session) => {
    const experiment = await Experiment.findOne({ _id: objectId(req.params.id), isDeleted: false }).session(session);
    if (!experiment) fail(404, '실험이 없습니다.');
    await projectAccess(req.user, experiment.projectId, true, session);
    const before = experiment.toObject();
    experiment.isDeleted = true;
    await experiment.save({ session });
    await audit(req, 'EXPERIMENT_DELETE', 'EXPERIMENT', experiment, before, session);
  });
  res.json({ success: true });
});

export default router;
