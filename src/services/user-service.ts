import express from 'express';

const router = express.Router();

router.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

export default router;

// - **What it does**:
//   This file adds a **healthcheck endpoint** (e.g., `/health`) to the service, which returns a status like `"OK"` or `"DOWN"`.
//   - Used by monitoring tools, Kubernetes, or other services to check if your app is running.
//   - Example: `GET /health` returns `{"status": "OK"}` if the service is up.