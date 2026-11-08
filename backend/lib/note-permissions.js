import Project from '../models/Project.js';

export async function reviewerAllowed(note, user, session) {
  if (String(note.authorId) === user.id) return false;
  if (user.role === 'viewer') return false;
  if (user.role === 'admin') return true;
  if (!note.projectId) return false;
  const project = await Project.findOne({ _id: note.projectId, isDeleted: false }).session(session || null);
  return Boolean(project?.members.some((member) => String(member.userId) === user.id && member.role === 'manager'));
}

export async function projectManagerAllowed(note, user, session) {
  if (user.role === 'admin') return true;
  if (!note.projectId) return false;
  const project = await Project.findOne({ _id: note.projectId, isDeleted: false }).session(session || null);
  return Boolean(project?.members.some((member) => String(member.userId) === user.id && member.role === 'manager'));
}
