
export const enforceCompliance = async (req, res, next) => {
  const tenantId = req.user?.tenantId;
  if (!tenantId) return next();
  // load tenant
  try {
    const Tenant = (await import('../models/Tenant.js')).default;
    const tenant = await Tenant.findById(tenantId);
    if (tenant?.complianceMode && ['POST', 'PUT', 'DELETE'].includes(req.method)) {
      return res.status(403).json({ error: 'GLP/GMP compliance mode: write operations are blocked.' });
    }
  } catch (e) {
    console.error('Compliance check error:', e);
  }
  next();
};
