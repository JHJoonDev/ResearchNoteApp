import crypto from 'node:crypto';
import Project from '../../models/Project.js';
import Experiment from '../../models/Experiment.js';
import { canonicalize, sha256 } from '../canonical.js';
import { openFile } from '../storage/index.js';

async function streamHash(record) {
  const digest = crypto.createHash('sha256');
  for await (const chunk of await openFile(record)) digest.update(chunk);
  return digest.digest('hex');
}

export async function verifyAttachmentFiles(files) {
  for (const file of files) {
    let actual;
    try { actual = await streamHash(file); }
    catch { throw Object.assign(new Error(`첨부파일을 읽을 수 없습니다: ${file.originalName}`), { status: 409 }); }
    if (actual !== file.sha256) throw Object.assign(new Error(`첨부파일 해시가 일치하지 않습니다: ${file.originalName}`), { status: 409 });
  }
}

export async function createManifest(note, files, { version = note.version, organization = process.env.ORG_NAME || 'LabHub' } = {}) {
  const project = note.projectId ? await Project.findById(note.projectId).select('name').lean() : null;
  const experiment = note.experimentId ? await Experiment.findById(note.experimentId).select('name').lean() : null;
  const isDoc = note.contentFormat === 'doc' && note.contentDoc;
  const manifest = {
    schemaVersion: isDoc ? 2 : 1,
    noteId: String(note._id),
    version,
    title: note.title,
    content: note.content || '',
    project: project ? { id: String(note.projectId), name: project.name } : null,
    tags: [...(note.tags || [])],
    reagentsUsed: (note.reagentsUsed || []).map((item) => ({
      reagentId: item.reagentId ? String(item.reagentId) : null,
      name: item.name || '', amount: item.amount ?? null, unit: item.unit || '',
      allocations: (item.allocations || []).map((allocation) => ({ lotId: String(allocation.lotId), lotNumber: allocation.lotNumber, amount: allocation.amount })),
    })),
    entitiesUsed: (note.entitiesUsed || []).map((item) => ({ entityId: String(item.entityId), code: item.code, name: item.name, typeName: item.typeName })),
    aiRuns: (note.aiRuns || []).map((run) => ({
      runId: String(run.runId),
      feature: run.feature,
      model: run.model,
      outputSha256: run.outputSha256,
      createdAt: new Date(run.createdAt).toISOString(),
    })),
    attachments: files.map((file) => ({
      id: String(file._id), name: file.originalName, size: file.size, sha256: file.sha256,
    })),
    organization,
    author: { id: String(note.authorId || ''), name: note.author || '' },
    createdAt: new Date(note.createdAt).toISOString(),
  };
  if (isDoc) {
    manifest.contentFormat = 'doc';
    manifest.contentDoc = note.contentDoc;
    manifest.experiment = experiment ? { id: String(note.experimentId), name: experiment.name } : null;
    manifest.protocolRun = note.protocolRun || null;
  }
  const canonical = canonicalize(manifest);
  return { manifest, canonical, manifestSha256: sha256(canonical) };
}

