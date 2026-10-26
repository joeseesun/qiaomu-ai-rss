'use strict';

function mountLabModeration(app, { store, deleteEntry, moveEntry, getSources }) {
  app.get('/api/lab/entries/deleted', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const ids = [...new Set(String(req.query?.ids || '').split(',').filter(Boolean))];
    if (ids.length > 100 || ids.some(id => id.length > 128)) return res.status(400).json({ error: 'invalid_ids' });
    return res.json({ deletedIds: ids.filter(id => store.isEntryDeleted(id)) });
  });
  app.get('/api/lab/admin/channels', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const user = store.getUserBySessionToken(String(req.get('authorization') || '').replace(/^Bearer /, ''));
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'admin_required' });
    return res.json({ sources: getSources().map(({ id, name, category, siteUrl }) => ({ id, name, category, siteUrl })) });
  });
  app.post('/api/lab/admin/move-entry', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const user = store.getUserBySessionToken(String(req.get('authorization') || '').replace(/^Bearer /, ''));
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'admin_required' });
    const { entryId, sourceId } = req.body || {};
    if (typeof entryId !== 'string' || !entryId || entryId.length > 128 || typeof sourceId !== 'string' || !sourceId || sourceId.length > 200) return res.status(400).json({ error: 'invalid_target' });
    try {
      const result = moveEntry(entryId, sourceId, user.id);
      return result ? res.json({ ok: true, ...result }) : res.status(404).json({ error: 'entry_not_found' });
    } catch (error) { return res.status(error.statusCode === 400 ? 400 : 500).json({ error: error.statusCode === 400 ? 'invalid_source' : 'move_failed' }); }
  });
  app.post('/api/lab/admin/delete-entry', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const token = String(req.get('authorization') || '').replace(/^Bearer /, '');
    const user = store.getUserBySessionToken(token);
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'admin_required' });
    const id = req.body?.entryId;
    if (typeof id !== 'string' || !id || id.length > 128) return res.status(400).json({ error: 'invalid_id' });
    try {
      const result = deleteEntry(id, { userId: user.id, reason: 'Obsidian administrator deletion' });
      if (!result) return res.status(404).json({ error: 'entry_not_found' });
      return res.json({ ok: true, entryId: result.id });
    } catch { return res.status(500).json({ error: 'delete_failed' }); }
  });
}
module.exports = { mountLabModeration };
