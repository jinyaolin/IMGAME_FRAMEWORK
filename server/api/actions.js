// Actions API - Manage action button configurations
const fs = require('fs').promises;
const path = require('path');

class ActionsAPI {
  constructor(actionsDir) {
    this.actionsDir = actionsDir;
  }

  // Ensure actions directory exists
  async ensureDir() {
    try {
      await fs.mkdir(this.actionsDir, { recursive: true });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }

  // List all action configurations
  async listActions() {
    await this.ensureDir();
    const files = await fs.readdir(this.actionsDir);
    const actionConfigs = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const content = await fs.readFile(path.join(this.actionsDir, file), 'utf8');
          const config = JSON.parse(content);
          actionConfigs.push(config);
        } catch (err) {
          console.error(`[ActionsAPI] Failed to read ${file}:`, err);
        }
      }
    }

    return actionConfigs;
  }

  // Get a single action configuration
  async getAction(actionId) {
    await this.ensureDir();
    const filePath = path.join(this.actionsDir, `${actionId}.json`);

    try {
      const content = await fs.readFile(filePath, 'utf8');
      return JSON.parse(content);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  // Create a new action configuration
  async createAction(config) {
    await this.ensureDir();

    if (!config.id) {
      throw new Error('Action config must have an id');
    }

    const filePath = path.join(this.actionsDir, `${config.id}.json`);

    // Check if already exists
    try {
      await fs.access(filePath);
      throw new Error(`Action config "${config.id}" already exists`);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    // Add metadata
    const fullConfig = {
      ...config,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await fs.writeFile(filePath, JSON.stringify(fullConfig, null, 2));
    return fullConfig;
  }

  // Update an action configuration
  async updateAction(actionId, updates) {
    await this.ensureDir();
    const filePath = path.join(this.actionsDir, `${actionId}.json`);

    const content = await fs.readFile(filePath, 'utf8');
    const config = JSON.parse(content);

    const updatedConfig = {
      ...config,
      ...updates,
      id: actionId, // Don't allow changing ID
      updatedAt: new Date().toISOString()
    };

    await fs.writeFile(filePath, JSON.stringify(updatedConfig, null, 2));
    return updatedConfig;
  }

  // Delete an action configuration
  async deleteAction(actionId) {
    await this.ensureDir();
    const filePath = path.join(this.actionsDir, `${actionId}.json`);

    try {
      await fs.unlink(filePath);
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') {
        return false; // Already doesn't exist
      }
      throw err;
    }
  }
}

// Express router
function createRouter(actionsAPI) {
  const express = require('express');
  const router = express.Router();

  // GET /api/actions - List all action configurations
  router.get('/', async (req, res) => {
    try {
      const configs = await actionsAPI.listActions();
      res.json(configs);
    } catch (err) {
      console.error('[ActionsAPI] GET /:', err);
      res.status(500).json({ error: 'Failed to list actions' });
    }
  });

  // GET /api/actions/:id - Get a single action configuration
  router.get('/:id', async (req, res) => {
    try {
      const config = await actionsAPI.getAction(req.params.id);
      if (!config) {
        return res.status(404).json({ error: 'Action config not found' });
      }
      res.json(config);
    } catch (err) {
      console.error('[ActionsAPI] GET /:id:', err);
      res.status(500).json({ error: 'Failed to get action' });
    }
  });

  // POST /api/actions - Create a new action configuration
  router.post('/', async (req, res) => {
    try {
      const config = await actionsAPI.createAction(req.body);
      res.status(201).json(config);
    } catch (err) {
      console.error('[ActionsAPI] POST /:', err);
      res.status(400).json({ error: err.message });
    }
  });

  // PUT /api/actions/:id - Update an action configuration
  router.put('/:id', async (req, res) => {
    try {
      const config = await actionsAPI.updateAction(req.params.id, req.body);
      res.json(config);
    } catch (err) {
      console.error('[ActionsAPI] PUT /:id:', err);
      res.status(400).json({ error: err.message });
    }
  });

  // DELETE /api/actions/:id - Delete an action configuration
  router.delete('/:id', async (req, res) => {
    try {
      const deleted = await actionsAPI.deleteAction(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: 'Action config not found' });
      }
      res.status(204).send();
    } catch (err) {
      console.error('[ActionsAPI] DELETE /:id:', err);
      res.status(500).json({ error: 'Failed to delete action' });
    }
  });

  return router;
}

module.exports = { ActionsAPI, createRouter };
