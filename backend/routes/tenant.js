import express from 'express';
import Tenant from '../models/Tenant.js';
import { requireRole } from '../middleware/authMiddleware.js';

const router = express.Router();

// List all tenants (admin/manager only)
router.get('/', requireRole(['admin', 'manager']), async (req, res) => {
  try {
    const tenants = await Tenant.find().select('name complianceMode');
    res.json(tenants);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch tenants' });
  }
});

// Get single tenant by ID (any authenticated user)
router.get('/:id', async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.params.id).select('name complianceMode');
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    res.json(tenant);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch tenant' });
  }
});

export default router;
